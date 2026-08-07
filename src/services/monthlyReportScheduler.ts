import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import env from '../config/env.js';
import {
  COMMISSION_REPORT_STATE_PATH,
  MONTHLY_REPORT_STATE_PATH,
} from '../config/appPaths.js';
import { sendRequiredBossTextNotification } from './notificationService.js';
import {
  buildCommissionReport,
  buildMonthlyReport,
  getCommissionPeriod,
  getPreviousMonthPeriod,
} from './monthlyReportService.js';

const CHECK_INTERVAL_MS = 30_000;

interface MonthlyReportState {
  periodKey: string;
  sentParts: number;
  completed: boolean;
}

let scheduler: NodeJS.Timeout | null = null;
let sendInProgress = false;
let completedMonthlyPeriodKey: string | null = null;
let completedCommissionPeriodKey: string | null = null;

export function startMonthlyReportScheduler(): void {
  if (scheduler) {
    return;
  }

  if (!env.monthlyReportTime.trim()) {
    console.log('[MONTHLY_REPORT] Scheduler disabled. MONTHLY_REPORT_TIME is not configured.');
    return;
  }

  if (!parseReportTime(env.monthlyReportTime) || env.monthlyCommissionPercent <= 0) {
    console.warn('[MONTHLY_REPORT] Invalid time or commission configuration.');
    return;
  }

  scheduler = setInterval(() => {
    void sendReportsIfDue();
  }, CHECK_INTERVAL_MS);

  void sendReportsIfDue();
  console.log(
    `[MONTHLY_REPORT] Scheduler enabled at ${env.monthlyReportTime}: monthly report on day 1; commissions on day 20 at ${env.monthlyCommissionPercent}%.`
  );
}

export function stopMonthlyReportScheduler(): void {
  if (!scheduler) {
    return;
  }

  clearInterval(scheduler);
  scheduler = null;
}

export function isMonthlyReportDue(now: Date, configuredTime: string): boolean {
  const reportTime = parseReportTime(configuredTime);
  if (!reportTime) {
    return false;
  }

  const firstAvailableTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    reportTime.hour,
    reportTime.minute,
    0,
    0
  );
  return now.getTime() >= firstAvailableTime.getTime();
}

export function isCommissionReportDue(now: Date, configuredTime: string): boolean {
  const reportTime = parseReportTime(configuredTime);
  if (!reportTime) {
    return false;
  }

  const period = getCommissionPeriod(now);
  const firstAvailableTime = new Date(
    period.end.getFullYear(),
    period.end.getMonth(),
    period.end.getDate(),
    reportTime.hour,
    reportTime.minute,
    0,
    0
  );
  return now.getTime() >= firstAvailableTime.getTime();
}

async function sendReportsIfDue(now = new Date()): Promise<void> {
  if (sendInProgress) {
    return;
  }

  const monthlyDue = isMonthlyReportDue(now, env.monthlyReportTime);
  const commissionDue = isCommissionReportDue(now, env.monthlyReportTime);
  if (!monthlyDue && !commissionDue) {
    return;
  }

  sendInProgress = true;
  try {
    if (monthlyDue) {
      await sendMonthlyReport(now);
    }
    if (commissionDue) {
      await sendCommissionReport(now);
    }
  } finally {
    sendInProgress = false;
  }
}

async function sendMonthlyReport(now: Date): Promise<void> {
  const periodKey = getPreviousMonthPeriod(now).key;
  if (completedMonthlyPeriodKey === periodKey) {
    return;
  }

  try {
    const storedState = await readState(MONTHLY_REPORT_STATE_PATH);
    if (storedState?.periodKey === periodKey && storedState.completed) {
      completedMonthlyPeriodKey = periodKey;
      return;
    }
    const messages = await buildMonthlyReport(now, env.monthlyCommissionPercent);
    const sentParts = storedState?.periodKey === periodKey
      ? Math.min(storedState.sentParts, messages.length)
      : 0;

    for (let index = sentParts; index < messages.length; index++) {
      await sendRequiredBossTextNotification(messages[index]!);
      const nextSentParts = index + 1;
      await writeState(MONTHLY_REPORT_STATE_PATH, {
        periodKey,
        sentParts: nextSentParts,
        completed: nextSentParts === messages.length,
      });
    }

    completedMonthlyPeriodKey = periodKey;
    console.log(
      `[MONTHLY_REPORT] Report for ${periodKey} sent privately to BOSS_PRIVATE_NUMBER (${messages.length} parts).`
    );
  } catch (error) {
    console.error('[MONTHLY_REPORT] Error sending monthly report:', error);
  }
}

async function sendCommissionReport(now: Date): Promise<void> {
  const periodKey = getCommissionPeriod(now).key;
  if (completedCommissionPeriodKey === periodKey) {
    return;
  }

  try {
    const storedState = await readState(COMMISSION_REPORT_STATE_PATH);
    if (storedState?.periodKey === periodKey && storedState.completed) {
      completedCommissionPeriodKey = periodKey;
      return;
    }

    const messages = [await buildCommissionReport(now, env.monthlyCommissionPercent)];
    const sentParts = storedState?.periodKey === periodKey
      ? Math.min(storedState.sentParts, messages.length)
      : 0;

    for (let index = sentParts; index < messages.length; index++) {
      await sendRequiredBossTextNotification(messages[index]!);
      const nextSentParts = index + 1;
      await writeState(COMMISSION_REPORT_STATE_PATH, {
        periodKey,
        sentParts: nextSentParts,
        completed: nextSentParts === messages.length,
      });
    }

    completedCommissionPeriodKey = periodKey;
    console.log(
      `[COMMISSION_REPORT] Report for ${periodKey} sent privately to BOSS_PRIVATE_NUMBER.`
    );
  } catch (error) {
    console.error('[COMMISSION_REPORT] Error sending commission report:', error);
  }
}

function parseReportTime(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

async function readState(statePath: string): Promise<MonthlyReportState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(statePath, 'utf8')
    ) as Partial<MonthlyReportState>;
    if (
      typeof parsed.periodKey !== 'string' ||
      !Number.isSafeInteger(parsed.sentParts) ||
      (parsed.sentParts ?? -1) < 0 ||
      typeof parsed.completed !== 'boolean'
    ) {
      return null;
    }
    return parsed as MonthlyReportState;
  } catch {
    return null;
  }
}

async function writeState(statePath: string, state: MonthlyReportState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(state, null, 2),
    'utf8'
  );
}
