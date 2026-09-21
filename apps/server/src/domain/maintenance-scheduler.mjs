export class MaintenanceScheduler {
  constructor({ listAccountIds, maintain, initialDelayMs = 30_000, intervalMs = 3_600_000, concurrency = 2, timers = globalThis } = {}) {
    this.listAccountIds = listAccountIds; this.maintain = maintain; this.initialDelayMs = Number(initialDelayMs); this.intervalMs = Number(intervalMs); this.concurrency = Math.max(1, Number(concurrency)); this.timers = timers; this.timer = null; this.running = null;
  }
  start() { if (!this.timer) this.timer = this.timers.setTimeout(() => this.#tick(), this.initialDelayMs); }
  async #tick() { try { await this.runOnce(); } finally { this.timer = this.timers.setTimeout(() => this.#tick(), this.intervalMs); } }
  async runOnce() {
    if (this.running) return this.running;
    this.running = (async () => {
      const queue = [...await this.listAccountIds()];
      await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
        while (queue.length) await this.maintain(queue.shift());
      }));
    })();
    try { await this.running; } finally { this.running = null; }
  }
  async stop() { if (this.timer) this.timers.clearTimeout(this.timer); this.timer = null; if (this.running) await this.running; }
}
