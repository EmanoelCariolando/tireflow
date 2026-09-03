import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PENDING_REMINDER_STATE_PATH } from '../config/appPaths.js';
import { findOpenPendingSales } from './pendingSaleService.js';
import { sendOfficialGroupNotification } from './notificationService.js';
import {
  formatPendingReminder,
  getPendingMentionIds,
} from '../commands/pendingSaleFormatting.js';

const CHECK_INTERVAL_MS = 30_000;
export const PENDING_REMINDER_TIMES = ['09:30', '16:00'] as const;
let scheduler: NodeJS.Timeout | null = null;
let sendInProgress = false;
let lastSentKey: string | null = null;

interface ReminderState {
  lastSentKey: string;
}

export function startPendingSaleReminderScheduler(): void {
  if (scheduler) return;
  scheduler = setInterval(() => void sendReminderIfDue(), CHECK_INTERVAL_MS);
  void sendReminderIfDue();
  console.log(`[PENDING_SALE] Reminders enabled at ${PENDING_REMINDER_TIMES.join(' and ')}.`);
}

export function stopPendingSaleReminderScheduler(): void {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}

export function getPendingReminderSlot(now: Date): string | null {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return PENDING_REMINDER_TIMES.includes(time as typeof PENDING_REMINDER_TIMES[number])
    ? time
    : null;
}

async function sendReminderIfDue(now = new Date()): Promise<void> {
  if (sendInProgress) return;
  const slot = getPendingReminderSlot(now);
  if (!slot) return;

  const reminderKey = `${formatDateKey(now)}@${slot}`;
  if (lastSentKey === reminderKey || (await readState())?.lastSentKey === reminderKey) return;

  sendInProgress = true;
  try {
    const pendingSales = await findOpenPendingSales();
    if (pendingSales.length === 0) {
      lastSentKey = reminderKey;
      await writeState({ lastSentKey: reminderKey });
      return;
    }

    await sendOfficialGroupNotification(
      formatPendingReminder(pendingSales),
      getPendingMentionIds(pendingSales)
    );
    lastSentKey = reminderKey;
    await writeState({ lastSentKey: reminderKey });
    console.log(`[PENDING_SALE] Reminder ${reminderKey} sent with ${pendingSales.length} open sale(s).`);
  } catch (error) {
    console.error('[PENDING_SALE] Error sending reminder:', error);
  } finally {
    sendInProgress = false;
  }
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

async function readState(): Promise<ReminderState | null> {
  try {
    const parsed = JSON.parse(await readFile(PENDING_REMINDER_STATE_PATH, 'utf8')) as Partial<ReminderState>;
    return typeof parsed.lastSentKey === 'string'
      ? { lastSentKey: parsed.lastSentKey }
      : null;
  } catch {
    return null;
  }
}

async function writeState(state: ReminderState): Promise<void> {
  await mkdir(dirname(PENDING_REMINDER_STATE_PATH), { recursive: true });
  await writeFile(PENDING_REMINDER_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
