import { getDb } from '../database/db.js';
import { crawlWebsite } from './websiteCrawler.js';
import { embedPendingWebsiteChunks } from './semanticRag.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function runScheduledSync() {
  if (running) return;
  const db = getDb();
  const settings = db.prepare("SELECT * FROM website_knowledge_settings WHERE id = 'main'").get() as any;
  if (!settings?.is_scheduled_sync || Number(settings.scheduled_interval_hours) <= 0) return;

  const latest = db.prepare("SELECT completed_at FROM crawl_jobs WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1").get() as any;
  const intervalMs = Number(settings.scheduled_interval_hours) * 60 * 60 * 1000;
  const last = latest?.completed_at ? Date.parse(latest.completed_at) : 0;
  if (last && Date.now() - last < intervalMs) return;

  running = true;
  try {
    const startUrl = 'https://necn.ac.in/';
    const result = await crawlWebsite({
      startUrl,
      maxPages: Number(settings.crawl_limit ?? 0),
      type: 'INCREMENTAL'
    });
    // Process only missing/changed chunks. This is local and bounded so the
    // scheduled crawl remains responsive even during a first full index.
    for (let i = 0; i < 10; i++) {
      const batch = await embedPendingWebsiteChunks(25);
      if (!batch.processed) break;
    }
    console.log(`[WEBSITE SYNC] Scheduled sync completed: discovered=${result.discovered}, crawled=${result.crawled}, updated=${result.updated}, failed=${result.failed}.`);
  } catch (error) {
    console.error('[WEBSITE SYNC] Scheduled sync failed:', error);
  } finally {
    running = false;
  }
}

export function startWebsiteSyncScheduler() {
  if (timer) return;
  // Check once on startup, then every 5 minutes. The interval setting controls when a real crawl occurs.
  void runScheduledSync();
  timer = setInterval(() => void runScheduledSync(), 5 * 60 * 1000);
  timer.unref?.();
  console.log('[WEBSITE SYNC] Automatic incremental synchronization scheduler started.');
}

export function stopWebsiteSyncScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
