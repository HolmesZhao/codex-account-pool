export class MaintenanceScheduler {
  constructor({ listAccountIds, maintain, initialDelayMs = 30_000, intervalMs = 3_600_000, concurrency = 2, timers = globalThis } = {}) {
    this.listAccountIds = listAccountIds; this.maintain = maintain;
    this.initialDelayMs = positive(initialDelayMs, 30_000); this.intervalMs = positive(intervalMs, 3_600_000); this.concurrency = Math.min(16, positive(concurrency, 2));
    this.timers = timers; this.timer = null; this.running = null; this.stopped = true;
  }
  start() { if (!this.stopped) return; this.stopped = false; this.schedule(this.initialDelayMs); }
  schedule(delay) {
    if (this.stopped) return;
    this.timer = this.timers.setTimeout(async () => {
      this.timer = null;
      try { await this.runOnce(); } catch { /* Next scan retries repository failures. */ }
      finally { this.schedule(this.intervalMs); }
    }, delay);
    this.timer?.unref?.();
  }
  async runOnce() {
    if (this.running) return this.running;
    this.running = (async () => {
      const stopWhenRequested = !this.stopped;
      const queue = [...await this.listAccountIds()];
      await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
        while (queue.length && (!stopWhenRequested || !this.stopped)) { const id = queue.shift(); try { await this.maintain(id); } catch { /* One account must not abort the scan. */ } }
      }));
    })();
    try { await this.running; } finally { this.running = null; }
  }
  async stop() { this.stopped = true; if (this.timer) this.timers.clearTimeout(this.timer); this.timer = null; if (this.running) await this.running; }
}
function positive(value, fallback) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback; }
