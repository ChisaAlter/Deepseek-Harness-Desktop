/**
 * Bounded keyed FIFO lanes for order-sensitive WebSocket session messages.
 *
 * Different keys run concurrently. Same-key messages run FIFO.
 * Cancel / permission / ping-class messages use preempt keys or bypass lanes.
 */

export type MessageLaneClass = "strict-ordered" | "keyed-ordered" | "concurrent" | "preempt";

export interface LaneEnqueueResult {
  ok: true;
  laneKey: string;
  waitForTurn: Promise<void>;
  release: () => void;
}

export interface LaneOverflowResult {
  ok: false;
  reason: "lane_overflow" | "closed";
  laneKey: string;
}

export type LaneScheduleResult = LaneEnqueueResult | LaneOverflowResult;

export interface MessageLaneExecutorOptions {
  maxDepthPerLane: number;
  onOverflow?: (laneKey: string, depth: number) => void;
}

interface LaneWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface LaneState {
  running: boolean;
  queue: LaneWaiter[];
}

/**
 * Classify a session inbound message type into a concurrency class and lane key.
 * @param messageType Session message type string
 * @param fields Optional identifiers from the message payload
 */
function includesAny(type: string, parts: string[]): boolean {
  for (const part of parts) {
    if (type.includes(part)) {
      return true;
    }
  }
  return false;
}

export function classifySessionMessageLane(
  messageType: string,
  fields: {
    requestId?: string | null;
    terminalId?: string | null;
    streamId?: string | null;
    agentId?: string | null;
  } = {},
): { class: MessageLaneClass; laneKey: string } {
  const type = messageType.toLowerCase();

  if (
    includesAny(type, ["cancel", "permission", "abort"]) ||
    type === "ping" ||
    type.endsWith(".ping")
  ) {
    return { class: "preempt", laneKey: `preempt:${type}` };
  }

  if (includesAny(type, ["dictation", "voice", "speech"])) {
    return {
      class: "keyed-ordered",
      laneKey: `voice:${fields.streamId ?? fields.requestId ?? "default"}`,
    };
  }
  if (type.includes("terminal")) {
    return {
      class: "keyed-ordered",
      laneKey: `terminal:${fields.terminalId ?? fields.requestId ?? "default"}`,
    };
  }
  if (includesAny(type, ["file", "upload", "transfer"])) {
    return { class: "keyed-ordered", laneKey: `file:${fields.requestId ?? "default"}` };
  }
  if (includesAny(type, ["agent", "turn", "prompt"])) {
    return {
      class: "keyed-ordered",
      laneKey: `agent:${fields.agentId ?? fields.requestId ?? type}`,
    };
  }
  if (fields.requestId) {
    return { class: "concurrent", laneKey: `rpc:${fields.requestId}` };
  }
  return { class: "concurrent", laneKey: `misc:${type}` };
}

/**
 * Per-connection bounded keyed FIFO executor.
 */
export class MessageLaneExecutor {
  private readonly lanes = new Map<string, LaneState>();
  private readonly maxDepthPerLane: number;
  private readonly onOverflow?: (laneKey: string, depth: number) => void;
  private closed = false;

  constructor(options: MessageLaneExecutorOptions) {
    this.maxDepthPerLane = Math.max(1, options.maxDepthPerLane);
    this.onOverflow = options.onOverflow;
  }

  /**
   * Schedule work on a lane. Caller must await waitForTurn then call release in finally.
   * @param laneKey Lane identity
   */
  schedule(laneKey: string): LaneScheduleResult {
    if (this.closed) {
      return { ok: false, reason: "closed", laneKey };
    }
    let lane = this.lanes.get(laneKey);
    if (!lane) {
      lane = { running: false, queue: [] };
      this.lanes.set(laneKey, lane);
    }

    // Depth counts running + queued waiters.
    const depth = lane.queue.length + (lane.running ? 1 : 0);
    if (depth >= this.maxDepthPerLane) {
      this.onOverflow?.(laneKey, depth);
      return { ok: false, reason: "lane_overflow", laneKey };
    }

    if (!lane.running && lane.queue.length === 0) {
      lane.running = true;
      return {
        ok: true,
        laneKey,
        waitForTurn: Promise.resolve(),
        release: () => this.release(laneKey),
      };
    }

    let release!: () => void;
    let resolveWait!: () => void;
    let rejectWait!: (error: Error) => void;
    const waitForTurn = new Promise<void>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    const waiter: LaneWaiter = {
      resolve: resolveWait,
      reject: rejectWait,
    };
    lane.queue.push(waiter);
    release = () => this.release(laneKey);
    return { ok: true, laneKey, waitForTurn, release };
  }

  /**
   * Close the executor and reject queued waiters.
   */
  close(reason = "connection closed"): void {
    this.closed = true;
    for (const [key, lane] of this.lanes) {
      for (const waiter of lane.queue) {
        waiter.reject(new Error(reason));
      }
      lane.queue = [];
      lane.running = false;
      this.lanes.delete(key);
    }
  }

  /**
   * Current depth for observability.
   * @param laneKey Lane identity
   */
  depth(laneKey: string): number {
    const lane = this.lanes.get(laneKey);
    if (!lane) {
      return 0;
    }
    return lane.queue.length + (lane.running ? 1 : 0);
  }

  private release(laneKey: string): void {
    const lane = this.lanes.get(laneKey);
    if (!lane) {
      return;
    }
    const next = lane.queue.shift();
    if (next) {
      lane.running = true;
      next.resolve();
      return;
    }
    lane.running = false;
    this.lanes.delete(laneKey);
  }
}
