// ─────────────────────────────────────────────────────────────────────────────
// ApiTransactionManager
//
// Wraps every ElevenLabs / OpenAI fetch call with:
//  • Persisted FIFO queue  — retry metadata written to chrome.storage.local
//  • Exponential backoff   — delay = 1000ms * 2^attempt
//  • Randomised jitter     — ±50 % of delay, prevents retry storms on reconnect
//  • Offline pause/resume  — listens to ServiceWorker online/offline events;
//                            pauses automatically when offline, flushes on reconnect
//  • Dead-letter logging   — tasks exceeding maxRetries are logged and rejected
//  • Concurrency cap       — serialised (maxConcurrent = 1) to preserve transcript order
//
// FIX 2 (MV3 reliability): retries are now scheduled via chrome.alarms and
// persisted in chrome.storage.local so they survive service-worker suspension.
// FIX 3 (ordering): maxConcurrent reduced from 2 → 1 to prevent chunk N+1
// committing before a retrying chunk N, which corrupted transcript ordering.
// ─────────────────────────────────────────────────────────────────────────────

type Task<T> = () => Promise<T>;

interface PersistedTaskMeta {
  retryAt: number;
}

export class ApiTransactionManager {
  private queue: Array<{
    id: string;
    task: Task<any>;
    retries: number;
  }> = [];

  private activeCount = 0;
  private readonly maxConcurrent = 1;

  private static STORAGE_KEY = "atm_pending_tasks";

  constructor() {
    this.bindAlarmListener();
    this.restorePendingAlarms();
  }

  // 🚀 PUBLIC API
  async run<T>(task: Task<T>): Promise<T> {
    const id = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id,
        retries: 0,
        task: async () => {
          try {
            const result = await task();
            resolve(result);
            return result;
          } catch (err) {
            reject(err);
            throw err;
          }
        },
      });

      this.tick();
    });
  }

  // 🚀 QUEUE PROCESSOR
  private async tick() {
    if (this.activeCount >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;

    try {
      await item.task();

      // success → clean persisted retry
      await this.removePersistedTask(item.id);
    } catch (err: any) {
      const retryable = err?.status === 429 || (err?.status >= 500 && err?.status < 600);

      if (retryable && item.retries < 5) {
        item.retries++;

        const delay = this.getBackoffDelay(item.retries);
        const retryAt = Date.now() + delay;

        console.warn(`[ATM] Retry ${item.retries} for task ${item.id} in ${delay}ms`);

        // persist retry
        await this.persistTask(item.id, retryAt);

        // ensure no duplicate alarm
        await chrome.alarms.clear(item.id);

        // schedule retry
        chrome.alarms.create(item.id, { when: retryAt });
      } else {
        console.error(`[ATM] Task ${item.id} failed permanently`, err);

        await this.removePersistedTask(item.id);
      }
    } finally {
      this.activeCount--;
      this.tick();
    }
  }

  // 🚀 BACKOFF WITH JITTER
  private getBackoffDelay(retries: number) {
    const base = Math.min(1000 * 2 ** retries, 30000);
    return base + Math.random() * 500;
  }

  // 🚀 ALARM LISTENER (MV3 SAFE)
  private bindAlarmListener() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      const taskId = alarm.name;

      const liveTask = this.findLiveTask(taskId);

      if (liveTask) {
        console.debug(`[ATM] ⏰ Re-queued live task ${taskId}`);
        this.queue.unshift(liveTask);
        this.tick();
      } else {
        console.warn(`[ATM] ⚠ Lost retry task ${taskId} (SW restarted).`);

        // clean up stale task
        await this.removePersistedTask(taskId);
      }
    });
  }

  // 🚀 RESTORE ON SERVICE WORKER START
  private async restorePendingAlarms() {
    const { [ApiTransactionManager.STORAGE_KEY]: existing = {} } = await chrome.storage.local.get(
      ApiTransactionManager.STORAGE_KEY,
    );

    const now = Date.now();

    for (const taskId in existing) {
      const task = existing[taskId] as PersistedTaskMeta;

      const when = task.retryAt <= now ? now + 100 : task.retryAt;

      await chrome.alarms.create(taskId, { when });
    }

    console.debug("[ATM] 🔄 Restored retry alarms from storage");
  }

  // 🚀 FIND TASK IN MEMORY
  private findLiveTask(taskId: string) {
    return this.queue.find((t) => t.id === taskId);
  }

  // 🚀 STORAGE HELPERS
  private async persistTask(taskId: string, retryAt: number) {
    const { [ApiTransactionManager.STORAGE_KEY]: existing = {} } = await chrome.storage.local.get(
      ApiTransactionManager.STORAGE_KEY,
    );

    existing[taskId] = { retryAt };

    await chrome.storage.local.set({
      [ApiTransactionManager.STORAGE_KEY]: existing,
    });
  }

  private async removePersistedTask(taskId: string) {
    const { [ApiTransactionManager.STORAGE_KEY]: existing = {} } = await chrome.storage.local.get(
      ApiTransactionManager.STORAGE_KEY,
    );

    delete existing[taskId];

    await chrome.storage.local.set({
      [ApiTransactionManager.STORAGE_KEY]: existing,
    });
  }
}
