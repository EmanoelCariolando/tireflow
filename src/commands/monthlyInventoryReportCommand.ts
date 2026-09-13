import whatsappWeb, { type Message, type MessageMedia } from 'whatsapp-web.js';
import {
  buildInventoryReportPdf,
  getPreviousMonthPeriod,
  type InventoryReportPdfDelivery,
  type MonthlyPeriod,
} from '../services/monthlyReportService.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { parseConfirmationAction } from '../utils/operationResponse.js';
import {
  clearMonthlyInventoryReportSession,
  getMonthlyInventoryReportSession,
  saveMonthlyInventoryReportSession,
  type MonthlyInventoryReportSession,
} from '../utils/monthlyInventoryReportSessionStore.js';

const { MessageMedia: WhatsAppMessageMedia } = whatsappWeb;

export const MAX_INVENTORY_REPORT_PERIOD_DAYS = 31;

export interface MonthlyInventoryReportCommandDependencies {
  buildReport(period: MonthlyPeriod, generatedAt: Date): Promise<InventoryReportPdfDelivery>;
  createPdfMedia(report: InventoryReportPdfDelivery): MessageMedia;
  now(): Date;
}

const defaultDependencies: MonthlyInventoryReportCommandDependencies = {
  buildReport: buildInventoryReportPdf,
  createPdfMedia(report): MessageMedia {
    return new WhatsAppMessageMedia(
      'application/pdf',
      report.pdfBuffer.toString('base64'),
      report.pdfFileName,
      report.pdfBuffer.length
    );
  },
  now: () => new Date(),
};

export function isMonthlyInventoryReportCommand(body: string): boolean {
  const command = normalizeCommand(body);
  return command === 'relatorio estoque' || command === 'relatorio mensal';
}

export async function handleMonthlyInventoryReportCommand(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  saveMonthlyInventoryReportSession({
    userId,
    chatId,
    step: 'awaiting_report_type',
    updatedAt: Date.now(),
  });
  await message.reply(formatReportTypeQuestion());
}

export async function handleMonthlyInventoryReportConversation(
  message: Message,
  body: string,
  dependencies: MonthlyInventoryReportCommandDependencies = defaultDependencies
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const session = getMonthlyInventoryReportSession(userId, chatId);
  if (!session) return false;

  if (normalizeCommand(body) === 'menu') {
    clearMonthlyInventoryReportSession(userId, chatId);
    return false;
  }

  if (session.step === 'awaiting_report_type') {
    await handleReportTypeSelection(message, body, session, dependencies.now());
    return true;
  }

  if (session.step === 'awaiting_start_date') {
    await handleStartDate(message, body, session, dependencies.now());
    return true;
  }

  if (session.step === 'awaiting_end_date') {
    await handleEndDate(message, body, session, dependencies.now());
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmation(message, body, session, dependencies);
    return true;
  }

  await message.reply('⏳ O relatório já está sendo gerado. Aguarde alguns instantes.');
  return true;
}

async function handleReportTypeSelection(
  message: Message,
  body: string,
  session: MonthlyInventoryReportSession,
  now: Date
): Promise<void> {
  const selection = body.trim();
  if (selection === '0') {
    clearMonthlyInventoryReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }

  if (selection === '1') {
    const period = getPreviousMonthPeriod(now);
    const endDate = previousDay(period.end);
    saveMonthlyInventoryReportSession({
      ...session,
      step: 'awaiting_confirmation',
      startDate: period.start,
      endDate,
    });
    await message.reply(formatConfirmation(period.start, endDate));
    return;
  }

  if (selection === '2') {
    saveMonthlyInventoryReportSession({
      ...session,
      step: 'awaiting_start_date',
      startDate: undefined,
      endDate: undefined,
    });
    await message.reply(formatStartDateQuestion(now));
    return;
  }

  await message.reply(`❌ Opção inválida.\n\n${formatReportTypeQuestion()}`);
}

async function handleStartDate(
  message: Message,
  body: string,
  session: MonthlyInventoryReportSession,
  now: Date
): Promise<void> {
  if (body.trim() === '0') {
    clearMonthlyInventoryReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }

  const startDate = parseBrazilianReportDate(body);
  if (!startDate) {
    await message.reply(`❌ Data inicial inválida.\n\n${formatStartDateQuestion(now)}`);
    return;
  }
  if (isAfterToday(startDate, now)) {
    await message.reply('❌ A data inicial não pode ser posterior ao dia atual.');
    return;
  }

  saveMonthlyInventoryReportSession({
    ...session,
    step: 'awaiting_end_date',
    startDate,
    endDate: undefined,
  });
  await message.reply(formatEndDateQuestion(now));
}

async function handleEndDate(
  message: Message,
  body: string,
  session: MonthlyInventoryReportSession,
  now: Date
): Promise<void> {
  if (body.trim() === '0') {
    clearMonthlyInventoryReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }

  const endDate = parseBrazilianReportDate(body);
  if (!endDate) {
    await message.reply(`❌ Data final inválida.\n\n${formatEndDateQuestion(now)}`);
    return;
  }
  if (isAfterToday(endDate, now)) {
    await message.reply('❌ A data final não pode ser posterior ao dia atual.');
    return;
  }
  if (!session.startDate) {
    saveMonthlyInventoryReportSession({ ...session, step: 'awaiting_start_date' });
    await message.reply(formatStartDateQuestion(now));
    return;
  }
  if (endDate.getTime() < session.startDate.getTime()) {
    await message.reply('❌ A data final não pode ser anterior à data inicial.');
    return;
  }

  const dayCount = countInclusiveCalendarDays(session.startDate, endDate);
  if (dayCount > MAX_INVENTORY_REPORT_PERIOD_DAYS) {
    await message.reply(
      `❌ O período pode ter no máximo ${MAX_INVENTORY_REPORT_PERIOD_DAYS} dias. Digite outra data final.`
    );
    return;
  }

  saveMonthlyInventoryReportSession({
    ...session,
    step: 'awaiting_confirmation',
    endDate,
  });
  await message.reply(formatConfirmation(session.startDate, endDate));
}

async function handleConfirmation(
  message: Message,
  body: string,
  session: MonthlyInventoryReportSession,
  dependencies: MonthlyInventoryReportCommandDependencies
): Promise<void> {
  const action = parseConfirmationAction(body);
  if (action === 'cancel') {
    clearMonthlyInventoryReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }
  if (action === 'back') {
    saveMonthlyInventoryReportSession({
      ...session,
      step: 'awaiting_start_date',
      startDate: undefined,
      endDate: undefined,
    });
    await message.reply(formatStartDateQuestion(dependencies.now()));
    return;
  }
  if (action !== 'confirm' || !session.startDate || !session.endDate) {
    await message.reply(formatConfirmationRequired(session));
    return;
  }

  saveMonthlyInventoryReportSession({ ...session, step: 'processing' });
  await message.reply('⏳ *GERANDO RELATÓRIO EM PDF*\nIsso pode levar alguns instantes.');

  try {
    const generatedAt = dependencies.now();
    const period = createInventoryReportPeriod(session.startDate, session.endDate);
    const report = await dependencies.buildReport(period, generatedAt);
    const media = dependencies.createPdfMedia(report);
    await message.reply(media, undefined, {
      caption: `📄 *RELATÓRIO DE ESTOQUE*\nPeríodo: ${formatDate(session.startDate)} a ${formatDate(session.endDate)}`,
    });
    clearMonthlyInventoryReportSession(session.userId, session.chatId);
  } catch (error) {
    console.error('[MONTHLY_INVENTORY_REPORT] Error:', error);
    saveMonthlyInventoryReportSession({ ...session, step: 'awaiting_confirmation' });
    await message.reply(
      'Não foi possível gerar o relatório em PDF. Nenhuma informação foi alterada. Tente novamente com *1* ou digite *0* para cancelar.'
    );
  }
}

export function parseBrazilianReportDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function createInventoryReportPeriod(startDate: Date, endDate: Date): MonthlyPeriod {
  const start = startOfDay(startDate);
  const inclusiveEnd = startOfDay(endDate);
  const end = new Date(
    inclusiveEnd.getFullYear(),
    inclusiveEnd.getMonth(),
    inclusiveEnd.getDate() + 1
  );
  return {
    start,
    end,
    key: `${formatDateKey(start)}_a_${formatDateKey(inclusiveEnd)}`,
  };
}

function formatReportTypeQuestion(): string {
  return [
    '📄 *RELATÓRIO EM PDF*',
    '',
    '1️⃣ Último mês fechado',
    '2️⃣ Escolher período',
    '0️⃣ Cancelar',
  ].join('\n');
}

function formatStartDateQuestion(referenceDate: Date): string {
  return [
    '📅 *DATA INICIAL*',
    '',
    'Digite no formato: *DD/MM/AAAA*',
    `Exemplo: *01/09/${referenceDate.getFullYear()}*`,
    '',
    '0️⃣ Cancelar',
  ].join('\n');
}

function formatEndDateQuestion(referenceDate: Date): string {
  return [
    '📅 *DATA FINAL*',
    '',
    'Digite no formato: *DD/MM/AAAA*',
    `Exemplo: *12/09/${referenceDate.getFullYear()}*`,
    '',
    '0️⃣ Cancelar',
  ].join('\n');
}

function formatConfirmation(startDate: Date, endDate: Date): string {
  return [
    '📄 *CONFIRMAR RELATÓRIO*',
    '',
    `Período: *${formatDate(startDate)} a ${formatDate(endDate)}*`,
    '',
    '1️⃣ ✅ Gerar PDF',
    '2️⃣ ↩️ Corrigir período',
    '0️⃣ ❌ Cancelar',
  ].join('\n');
}

function formatConfirmationRequired(session: MonthlyInventoryReportSession): string {
  return session.startDate && session.endDate
    ? `❌ Opção inválida.\n\n${formatConfirmation(session.startDate, session.endDate)}`
    : '❌ O período não está completo. Digite *2* para informar novamente.';
}

function countInclusiveCalendarDays(startDate: Date, endDate: Date): number {
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((endUtc - startUtc) / 86_400_000) + 1;
}

function isAfterToday(date: Date, now: Date): boolean {
  return date.getTime() > startOfDay(now).getTime();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function previousDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeCommand(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
