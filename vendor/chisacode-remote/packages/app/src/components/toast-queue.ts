import type { ToastState } from "./toast-host";

/**
 * 回调：队列可见项变化时触发，通知外部同步 UI 状态。
 */
type OnUpdate = (visible: ToastState[]) => void;

/** 队列控制器，暴露给外部调用方。 */
export interface ToastQueue {
  /** 将一条 toast 加入队列（溢出时进入等待队列）。 */
  push: (item: ToastState) => void;
  /** 按 id 移除一条 toast，并从等待队列中补齐。 */
  remove: (id: number) => void;
  /** 清空所有可见和等待的 toast，停止所有定时器。 */
  clear: () => void;
  /** 返回当前可见的 toast 列表（只读快照）。 */
  getVisible: () => ToastState[];
  /** 返回当前等待队列长度。 */
  getPendingCount: () => number;
}

/**
 * 创建 Toast 队列。
 * @param maxVisible 同时最多显示的条数，默认 3
 * @param onUpdate 队列可见项变化时调用，用于同步 React state
 */
export function createToastQueue(maxVisible: number = 3, onUpdate: OnUpdate): ToastQueue {
  let visible: ToastState[] = [];
  let pending: ToastState[] = [];
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function notify() {
    onUpdate(visible.slice());
  }

  function clearTimer(id: number) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function startTimer(item: ToastState) {
    clearTimer(item.id);
    if (item.durationMs === null) return; // sticky toast
    const timer = setTimeout(() => {
      remove(item.id);
    }, item.durationMs);
    timers.set(item.id, timer);
  }

  /** 将等待队列中的下一项提升为可见。 */
  function promote() {
    while (visible.length < maxVisible && pending.length > 0) {
      const next = pending.shift()!;
      visible.push(next);
      startTimer(next);
    }
    notify();
  }

  function push(item: ToastState) {
    if (visible.length < maxVisible) {
      visible.push(item);
      startTimer(item);
      notify();
    } else {
      pending.push(item);
      notify();
    }
  }

  function remove(id: number) {
    clearTimer(id);
    visible = visible.filter((v) => v.id !== id);
    pending = pending.filter((p) => p.id !== id);
    promote();
  }

  function clear() {
    for (const v of visible) clearTimer(v.id);
    for (const p of pending) clearTimer(p.id);
    visible = [];
    pending = [];
    notify();
  }

  return {
    push,
    remove,
    clear,
    getVisible: () => visible,
    getPendingCount: () => pending.length,
  };
}
