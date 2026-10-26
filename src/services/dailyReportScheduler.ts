import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import whatsappWeb from 'whatsapp-web.js';
import env from '../config/env.js';
import { DAILY_REPORT_STATE_PATH, STOCK_REPORT_STATE_PATH } from '../config/appPaths.js';
import { buildTodayReport } from './reportService.js';
import { sendOwnerNotification, sendOfficialGroupStockPdf, pinOfficialGroupStockPdf } from './notificationService.js';
import { buildCurrentStockReportPdf } from './monthlyReportService.js';
import { isGroupChatId } from '../utils/messageContext.js';

const { MessageMedia } = whatsappWeb;
const STOCK_REPORT_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;
interface StockReportState { groupId: string; sentAt: string; pinnedMessageId: string | null }
let stockSendInProgress = false;
let lastStockSent: Pick<StockReportState, 'groupId' | 'sentAt'> | null = null;

const CHECK_INTERVAL_MS = 30_000;
let scheduler: NodeJS.Timeout | null = null;
let lastSentDateKey: string | null = null;
let reportSendInProgress = false;

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
    void sendStockReportIfDue();
  }, CHECK_INTERVAL_MS);

  void sendReportIfDue();
  void sendStockReportIfDue();
  console.log(`[REPORT] Daily report scheduler enabled for ${env.dailyReportTime}.`);
}

export function stopDailyReportScheduler(): void {
  if (!scheduler) {
    return;
  }

  clearInterval(scheduler);
  scheduler = null;
}

export async function sendReportIfDue(now = new Date()): Promise<void> {
  if (reportSendInProgress) {
    return;
  }

  const reportTime = parseDailyReportTime(env.dailyReportTime);

  if (!reportTime || !isReportTime(now, reportTime)) {
    return;
  }

  const todayKey = getDateKey(now);

  reportSendInProgress = true;
  try {
    if (lastSentDateKey === todayKey || (await readLastSentDateKey()) === todayKey) return;
    const report = await buildTodayReport(now);
    await sendOwnerNotification(report);
    lastSentDateKey = todayKey;
    await writeLastSentDateKey(todayKey);
    console.log(`[REPORT] Daily report sent for ${todayKey}.`);
  } catch (error) {
    console.error('[REPORT] Error sending daily report:', error);
  } finally {
    reportSendInProgress = false;
  }
}

export async function sendStockReportIfDue(now = new Date()): Promise<void> {
  const reportTime = parseDailyReportTime(env.dailyReportTime);
  const groupId = env.whatsappOfficialGroupId.trim();
  if (stockSendInProgress || !reportTime || !isReportTime(now, reportTime) || !isGroupChatId(groupId)) return;
  if (lastStockSent?.groupId === groupId && now.getTime() - Date.parse(lastStockSent.sentAt) < STOCK_REPORT_INTERVAL_MS) return;
  stockSendInProgress = true;
  try {
    const stored = await readStockReportState();
    const previous = stored?.groupId === groupId ? stored : null;
    if (previous && now.getTime() - Date.parse(previous.sentAt) < STOCK_REPORT_INTERVAL_MS) return;
    const report = await buildCurrentStockReportPdf(now);
    const caption = `📦 Estoque de pneus — ${env.branchName}\n` +
      `Gerado em ${now.toLocaleString('pt-BR')}.\nBaixe o PDF para consultar sem internet. ` +
      'Os saldos representam a posição desta geração; confira movimentações posteriores.';
    const message = await sendOfficialGroupStockPdf(new MessageMedia('application/pdf', report.pdfBuffer.toString('base64'),
      report.pdfFileName, report.pdfBuffer.length), caption);
    const state: StockReportState = { groupId, sentAt: now.toISOString(), pinnedMessageId: previous?.pinnedMessageId ?? null };
    // The send succeeded: pin failures must never resend the same PDF.
    lastStockSent = state;
    await writeStockReportState(state);
    if (await pinOfficialGroupStockPdf(message, state.pinnedMessageId)) {
      state.pinnedMessageId = message.id._serialized;
      await writeStockReportState(state);
    }
    console.log('[STOCK_PDF] PDF enviado ao grupo oficial; próximo envio em cinco dias.');
  } catch (error) { console.error('[STOCK_PDF] Falha no envio ou na fixação do PDF de estoque.', error); }
  finally { stockSendInProgress = false; }
}

async function readStockReportState(): Promise<StockReportState | null> {
  let content: string;
  try { content = await readFile(STOCK_REPORT_STATE_PATH, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const state = JSON.parse(content) as Partial<StockReportState>;
  if (!state || !isGroupChatId(state.groupId) || typeof state.sentAt !== 'string' || !Number.isFinite(Date.parse(state.sentAt)) ||
      (state.pinnedMessageId != null && (typeof state.pinnedMessageId !== 'string' || !state.pinnedMessageId.trim()))) {
    throw new Error('Estado do PDF de estoque inválido; revise o arquivo antes de reenviar.');
  }
  return { groupId: state.groupId, sentAt: state.sentAt, pinnedMessageId: state.pinnedMessageId ?? null };
}

async function writeStockReportState(state: StockReportState): Promise<void> {
  await mkdir(dirname(STOCK_REPORT_STATE_PATH), { recursive: true });
  await writeFile(`${STOCK_REPORT_STATE_PATH}.tmp`, JSON.stringify(state), 'utf8');
  await rename(`${STOCK_REPORT_STATE_PATH}.tmp`, STOCK_REPORT_STATE_PATH);
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
  return date.getHours() * 60 + date.getMinutes() >= reportTime.hour * 60 + reportTime.minute;
}

function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function readLastSentDateKey(): Promise<string | null> {
  try {
    const content = await readFile(DAILY_REPORT_STATE_PATH, 'utf8');
    const parsed = JSON.parse(content) as { lastSentDateKey?: unknown };

    return typeof parsed.lastSentDateKey === 'string' ? parsed.lastSentDateKey : null;
  } catch {
    return null;
  }
}

async function writeLastSentDateKey(dateKey: string): Promise<void> {
  await mkdir(dirname(DAILY_REPORT_STATE_PATH), { recursive: true });
  await writeFile(
    DAILY_REPORT_STATE_PATH,
    JSON.stringify({ lastSentDateKey: dateKey }, null, 2),
    'utf8'
  );
}
