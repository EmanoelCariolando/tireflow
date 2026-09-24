import type { Message } from 'whatsapp-web.js';
import {
  buildCommissionReportForPeriod,
  getPreviousMonthPeriod,
  type MonthlyPeriod,
} from '../services/monthlyReportService.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { parseConfirmationAction } from '../utils/operationResponse.js';
import {
  clearMonthlyCommissionReportSession,
  getMonthlyCommissionReportSession,
  saveMonthlyCommissionReportSession,
  type MonthlyCommissionReportSession,
} from '../utils/monthlyCommissionReportSessionStore.js';
import {
  MAX_INVENTORY_REPORT_PERIOD_DAYS,
  createInventoryReportPeriod,
  parseBrazilianReportDate,
} from './monthlyInventoryReportCommand.js';

export interface MonthlyCommissionReportCommandDependencies {
  buildReport(period: MonthlyPeriod): Promise<string>;
  now(): Date;
}

const defaultDependencies: MonthlyCommissionReportCommandDependencies = {
  buildReport: buildCommissionReportForPeriod,
  now: () => new Date(),
};

export function isMonthlyCommissionReportCommand(body: string): boolean {
  return normalizeCommand(body) === 'relatorio comissoes';
}

export async function handleMonthlyCommissionReportCommand(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  saveMonthlyCommissionReportSession({
    userId,
    chatId,
    step: 'awaiting_report_type',
    updatedAt: Date.now(),
  });
  await message.reply(formatReportTypeQuestion());
}

export async function handleMonthlyCommissionReportConversation(
  message: Message,
  body: string,
  dependencies: MonthlyCommissionReportCommandDependencies = defaultDependencies
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const session = getMonthlyCommissionReportSession(userId, chatId);
  if (!session) return false;

  if (normalizeCommand(body) === 'menu') {
    clearMonthlyCommissionReportSession(userId, chatId);
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

  await message.reply('⏳ O relatório de comissões já está sendo gerado. Aguarde alguns instantes.');
  return true;
}

async function handleReportTypeSelection(
  message: Message,
  body: string,
  session: MonthlyCommissionReportSession,
  now: Date
): Promise<void> {
  if (body.trim() === '0') {
    clearMonthlyCommissionReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }
  if (body.trim() === '1') {
    const period = getPreviousMonthPeriod(now);
    const endDate = previousDay(period.end);
    saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_confirmation', startDate: period.start, endDate });
    await message.reply(formatConfirmation(period.start, endDate));
    return;
  }
  if (body.trim() === '2') {
    saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_start_date', startDate: undefined, endDate: undefined });
    await message.reply(formatStartDateQuestion(now));
    return;
  }
  await message.reply(`❌ Opção inválida.\n\n${formatReportTypeQuestion()}`);
}

async function handleStartDate(
  message: Message,
  body: string,
  session: MonthlyCommissionReportSession,
  now: Date
): Promise<void> {
  if (body.trim() === '0') {
    clearMonthlyCommissionReportSession(session.userId, session.chatId);
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
  saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_end_date', startDate, endDate: undefined });
  await message.reply(formatEndDateQuestion(now));
}

async function handleEndDate(
  message: Message,
  body: string,
  session: MonthlyCommissionReportSession,
  now: Date
): Promise<void> {
  if (body.trim() === '0') {
    clearMonthlyCommissionReportSession(session.userId, session.chatId);
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
    saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_start_date' });
    await message.reply(formatStartDateQuestion(now));
    return;
  }
  if (endDate.getTime() < session.startDate.getTime()) {
    await message.reply('❌ A data final não pode ser anterior à data inicial.');
    return;
  }
  if (countInclusiveCalendarDays(session.startDate, endDate) > MAX_INVENTORY_REPORT_PERIOD_DAYS) {
    await message.reply(`❌ O período pode ter no máximo ${MAX_INVENTORY_REPORT_PERIOD_DAYS} dias. Digite outra data final.`);
    return;
  }
  saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_confirmation', endDate });
  await message.reply(formatConfirmation(session.startDate, endDate));
}

async function handleConfirmation(
  message: Message,
  body: string,
  session: MonthlyCommissionReportSession,
  dependencies: MonthlyCommissionReportCommandDependencies
): Promise<void> {
  const action = parseConfirmationAction(body);
  if (action === 'cancel') {
    clearMonthlyCommissionReportSession(session.userId, session.chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }
  if (action === 'back') {
    saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_start_date', startDate: undefined, endDate: undefined });
    await message.reply(formatStartDateQuestion(dependencies.now()));
    return;
  }
  if (action !== 'confirm' || !session.startDate || !session.endDate) {
    await message.reply(formatConfirmationRequired(session));
    return;
  }

  saveMonthlyCommissionReportSession({ ...session, step: 'processing' });
  await message.reply('⏳ *GERANDO RELATÓRIO DE COMISSÕES*\nIsso pode levar alguns instantes.');
  try {
    const report = await dependencies.buildReport(createInventoryReportPeriod(session.startDate, session.endDate));
    await message.reply(report);
    clearMonthlyCommissionReportSession(session.userId, session.chatId);
  } catch (error) {
    console.error('[MONTHLY_COMMISSION_REPORT] Error:', error);
    saveMonthlyCommissionReportSession({ ...session, step: 'awaiting_confirmation' });
    await message.reply('Não foi possível gerar o relatório de comissões. Nenhuma informação foi alterada. Tente novamente com *1* ou digite *0* para cancelar.');
  }
}

function formatReportTypeQuestion(): string {
  return ['💵 *RELATÓRIO DE COMISSÕES*', '', '1️⃣ Último mês fechado', '2️⃣ Escolher período', '0️⃣ Cancelar'].join('\n');
}

function formatStartDateQuestion(referenceDate: Date): string {
  return ['📅 *DATA INICIAL*', '', 'Digite no formato: *DD/MM/AAAA*', `Exemplo: *01/09/${referenceDate.getFullYear()}*`, '', '0️⃣ Cancelar'].join('\n');
}

function formatEndDateQuestion(referenceDate: Date): string {
  return ['📅 *DATA FINAL*', '', 'Digite no formato: *DD/MM/AAAA*', `Exemplo: *12/09/${referenceDate.getFullYear()}*`, '', '0️⃣ Cancelar'].join('\n');
}

function formatConfirmation(startDate: Date, endDate: Date): string {
  return ['💵 *CONFIRMAR RELATÓRIO DE COMISSÕES*', '', `Período: *${formatDate(startDate)} a ${formatDate(endDate)}*`, '', '1️⃣ ✅ Gerar relatório', '2️⃣ ↩️ Corrigir período', '0️⃣ ❌ Cancelar'].join('\n');
}

function formatConfirmationRequired(session: MonthlyCommissionReportSession): string {
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
  return date.getTime() > new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function previousDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function normalizeCommand(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
