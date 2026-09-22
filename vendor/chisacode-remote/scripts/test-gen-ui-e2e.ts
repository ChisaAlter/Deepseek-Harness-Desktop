/**
 * Generative UI end-to-end daemon test.
 *
 * Prerequisites: daemon running on localhost:6767 (npm run dev:server)
 *
 * Usage: npx tsx scripts/test-gen-ui-e2e.ts
 */
/* eslint-disable unicorn/prefer-add-event-listener */

const DAEMON_URL = "ws://localhost:6767/ws";

// ─── helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(level: string, msg: string) {
  process.stdout.write(`[${level}] ${msg}\n`);
}
const ok = (m: string) => log("PASS", m);
const fl = (m: string) => log("FAIL", m);
const info = (m: string) => log("INFO", m);

// ─── Session ────────────────────────────────────────────────────────────────

function connect(): Promise<{
  rpc(type: string, extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DAEMON_URL);
    const pending = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let ready = false;

    ws.onopen = () => {
      info(`Connected`);
      // Send hello handshake
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: uid(),
          clientType: "cli",
          protocolVersion: 1,
          capabilities: {},
        }),
      );
    };

    ws.onmessage = (event) => {
      const raw = event.data as string;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Server hello response
      if (msg.type === "hello" && !ready) {
        ready = true;
        info(`Handshake done`);
        return;
      }

      // Session wrapper
      if (msg.type === "session") {
        const sm = msg.message as Record<string, unknown> | undefined;
        if (!sm) return;

        // RPC response matching
        const pl = sm.payload as Record<string, unknown> | undefined;
        const rid = pl?.requestId as string | undefined;
        if (rid && pending.has(rid)) {
          pending.get(rid)!.resolve(sm);
          pending.delete(rid);
          return;
        }

        // Server info status
        if (sm.type === "server_info_status") {
          info(`Server ready`);
          return;
        }
      }

      // Direct response (no session wrapper)
      if (msg.type?.endsWith && msg.type.endsWith("_response")) {
        const pl = msg.payload as Record<string, unknown> | undefined;
        const rid = pl?.requestId as string | undefined;
        if (rid && pending.has(rid)) {
          pending.get(rid)!.resolve(msg);
          pending.delete(rid);
          return;
        }
      }
    };

    ws.onerror = () => reject(new Error("WebSocket error"));
    ws.onclose = ({ code }) => info(`Closed (${code})`);

    // Resolve when handshake completes
    setTimeout(() => {
      resolve({
        rpc(type, extra = {}) {
          return new Promise<Record<string, unknown>>((res, rej) => {
            const requestId = uid();
            pending.set(requestId, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ type: "session", message: { ...extra, type, requestId } }));
            setTimeout(() => {
              if (pending.has(requestId)) {
                pending.delete(requestId);
                rej(new Error(`RPC timeout: ${type}`));
              }
            }, 15000);
          });
        },
        close() {
          ws.close();
        },
      });
    }, 2000);
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

async function listAgents(
  rpc: (t: string, e?: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  info("Listing agents...");
  const resp = await rpc("fetch_agents_request");
  const agents: Array<{ id?: string; agentId?: string; status: string }> =
    resp.payload?.agents ?? [];
  info(`Found ${agents.length}`);
  for (const a of agents.slice(0, 5)) info(`  ${a.id ?? a.agentId} [${a.status}]`);
  if (agents.length > 0) ok(`${agents.length} agents`);
  else fl("No agents");
  return agents;
}

async function testGenUiInvalid(
  rpc: (t: string, e?: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  info("gen_ui.action → invalid agent...");
  const resp = await rpc("generative_ui.action", {
    agentId: "non-existent",
    instanceId: "i1",
    action: "click",
    payload: {},
    timestamp: Date.now(),
  });
  if (!resp.payload?.received && resp.payload?.error?.includes("agent not found")) {
    ok("Rejected (agent not found)");
  } else {
    fl(`Unexpected: ${JSON.stringify(resp)}`);
  }
}

async function testGenUiValid(
  rpc: (t: string, e?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  agentId: string,
) {
  info(`gen_ui.action → ${agentId}...`);
  const resp = await rpc("generative_ui.action", {
    agentId,
    instanceId: `e2e-${uid()}`,
    action: "submit",
    payload: { values: { name: "E2E" } },
    timestamp: Date.now(),
  });
  if (resp.payload?.received) {
    ok(`Accepted by ${agentId}`);
  } else {
    fl(`Rejected: ${resp.payload?.error}`);
  }
}

async function testTriggerGenUi(
  rpc: (t: string, e?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  agentId: string,
) {
  info(`Sending gen_ui prompt to ${agentId}...`);
  await rpc("send_agent_message_request", {
    agentId,
    text: "用表格展示：列=姓名,分数。张三90,李四85,王五92。如果支持生成式UI，请用表格组件展示",
  });
  ok("Prompt sent → check Electron app");
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  info("=== Gen UI Daemon E2E ===");
  info("");

  let s: Awaited<ReturnType<typeof connect>>;
  try {
    s = await connect();
  } catch (e: unknown) {
    fl(`Connect failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  info("");

  // 1. List agents
  const agents = await listAgents(s.rpc);
  info("");

  // 2. Invalid agent test
  await testGenUiInvalid(s.rpc);
  info("");

  // 3. Valid agent test + gen_ui trigger prompt
  const active = agents.filter((a) => a.status === "running" || a.status === "idle");
  if (active.length === 0) {
    fl("No active agent — create one in the desktop app first");
  } else {
    const aid = active[0].id ?? active[0].agentId!;
    await testGenUiValid(s.rpc, aid);
    info("");
    await testTriggerGenUi(s.rpc, aid);
  }

  info("");
  info("=== Done ===");
  s.close();
}

main().catch((e) => {
  fl(`Fatal: ${e.message}`);
  process.exit(1);
});
