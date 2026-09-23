// dsh-remote — single-flight async task manager for long-running operations
// (rw_sync / rw_push / rw_search with async:true). Tasks run one at a time
// (the SSH pool is shared), report progress, and can be cancelled cooperatively.

export class TaskManager {
  constructor() {
    this.tasks = new Map()
    this.nextId = 1
    this.queue = []
    this.running = false
  }

  /** Start a task. `fn(ctx)` where ctx = { progress(partial), cancelled }.
   * The task must poll ctx.cancelled between batches and return a result. */
  start(kind, label, fn) {
    const id = 'task-' + this.nextId++
    const task = {
      id,
      kind,
      label,
      status: 'queued',
      progress: {},
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    }
    this.tasks.set(id, task)
    this.queue.push({ task, fn })
    this._pump()
    return task
  }

  get(id) {
    return this.tasks.get(id) || null
  }

  list() {
    return [...this.tasks.values()].map((t) => ({
      id: t.id,
      kind: t.kind,
      label: t.label,
      status: t.status,
      progress: t.progress,
      error: t.error,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
    }))
  }

  cancel(id) {
    const t = this.tasks.get(id)
    if (!t) return false
    if (t.status === 'queued') {
      t.status = 'cancelled'
      t.finishedAt = new Date().toISOString()
      const qi = this.queue.findIndex((q) => q.task === t)
      if (qi >= 0) this.queue.splice(qi, 1)
      return true
    }
    if (t.status === 'running') {
      t.cancelled = true
      return true
    }
    return false
  }

  async _pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const { task, fn } = this.queue.shift()
        if (task.status === 'cancelled') continue
        task.status = 'running'
        task.startedAt = new Date().toISOString()
        const ctx = {
          progress: (p) => { task.progress = { ...task.progress, ...p } },
          get cancelled() { return !!task.cancelled },
        }
        try {
          task.result = await fn(ctx)
          if (task.cancelled) task.status = 'cancelled'
          else task.status = 'done'
        } catch (err) {
          if (task.cancelled) task.status = 'cancelled'
          else { task.status = 'failed'; task.error = String((err && err.message) || err) }
        }
        task.finishedAt = new Date().toISOString()
      }
    } finally {
      this.running = false
    }
  }
}
