import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import env from '../config/env.js';
import { buildTodayReport } from './reportService.js';
import { sendOwnerNotification } from './notificationService.js';

const CHECK_INTERVAL_MS = 30_000;
const STATE_FILE_PATH = join(process.cwd(), 'data', 'daily-report-state.json');

let scheduler: NodeJS.Timeout | null = null;
let lastSentDateKey: string | null = null;

export function startDailyReportScheduler(): void {
  if (scheduler) {
    return;
  }

  if (!env.dailyReportTime.trim()) {
    console.log('[REPORT] Daily report scheduler disabled. DAILY_REPORT_TIME is not configured.');
    return;
  }

  if (!parseDailyReportTime(env.dailyReportTime)) {
    console.warn('[REPORT] Invalid DAILY_REPORT_TIME. Use HH:mm, for example 18:00.');
    return;
  }

  scheduler = setInterval(() => {
    void sendReportIfDue();
  }, CHECK_INTERVAL_MS);

  void sendReportIfDue();
  console.log(`[REPORT] Daily report scheduler enabled for ${env.dailyReportTime}.`);
}

export function stopDailyReportScheduler(): void {
  if (!scheduler) {
    return;
  }

  clearInterval(scheduler);
  scheduler = null;
}

async function sendReportIfDue(now = new Date()): Promise<void> {
  const reportTime = parseDailyReportTime(env.dailyReportTime);

  if (!reportTime || !isReportTime(now, reportTime)) {
    return;
  }

  const todayKey = getDateKey(now);

  if (lastSentDateKey === todayKey || (await readLastSentDateKey()) === todayKey) {
    return;
  }

  try {
    const report = await buildTodayReport(now);
    await sendOwnerNotification(report);
    lastSentDateKey = todayKey;
    await writeLastSentDateKey(todayKey);
    console.log(`[REPORT] Daily report sent for ${todayKey}.`);
  } catch (error) {
    console.error('[REPORT] Error sending daily report:', error);
  }
}

function parseDailyReportTime(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function isReportTime(date: Date, reportTime: { hour: number; minute: number }): boolean {
  return date.getHours() === reportTime.hour && date.getMinutes() === reportTime.minute;
}

function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function readLastSentDateKey(): Promise<string | null> {
  try {
    const content = await readFile(STATE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(content) as { lastSentDateKey?: unknown };

    return typeof parsed.lastSentDateKey === 'string' ? parsed.lastSentDateKey : null;
  } catch {
    return null;
  }
}

async function writeLastSentDateKey(dateKey: string): Promise<void> {
  await mkdir(dirname(STATE_FILE_PATH), { recursive: true });
  await writeFile(
    STATE_FILE_PATH,
    JSON.stringify({ lastSentDateKey: dateKey }, null, 2),
    'utf8'
  );
}
