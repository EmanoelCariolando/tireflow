import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  handleMonthlyCommissionReportCommand,
  handleMonthlyCommissionReportConversation,
  isMonthlyCommissionReportCommand,
  type MonthlyCommissionReportCommandDependencies,
} from '../src/commands/monthlyCommissionReportCommand.js';
import { clearMonthlyCommissionReportSession } from '../src/utils/monthlyCommissionReportSessionStore.js';

const USER_ID = 'commission-report-user';
const CHAT_ID = 'commission-report-group@g.us';

function createMessage(replies: unknown[]): Message {
  return {
    author: USER_ID,
    from: CHAT_ID,
    reply: async (content: unknown) => {
      replies.push(content);
      return undefined;
    },
  } as unknown as Message;
}

function createDependencies(
  buildReport: MonthlyCommissionReportCommandDependencies['buildReport']
): MonthlyCommissionReportCommandDependencies {
  return {
    buildReport,
    now: () => new Date(2026, 8, 23, 9, 30),
  };
}

test('generates a commission report for the selected inclusive period', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  let receivedPeriod: { start: Date; end: Date } | undefined;
  const dependencies = createDependencies(async (period) => {
    receivedPeriod = period;
    return '💵 *RELATÓRIO DE COMISSÕES*\nPeríodo: 01/09/2026 a 12/09/2026';
  });

  try {
    assert.equal(isMonthlyCommissionReportCommand('relatório comissões'), true);
    assert.equal(isMonthlyCommissionReportCommand('relatorio estoque'), false);

    await handleMonthlyCommissionReportCommand(message);
    assert.match(String(replies.at(-1)), /Último mês fechado/);

    await handleMonthlyCommissionReportConversation(message, '2', dependencies);
    await handleMonthlyCommissionReportConversation(message, '01/09/2026', dependencies);
    await handleMonthlyCommissionReportConversation(message, '12/09/2026', dependencies);
    assert.match(String(replies.at(-1)), /CONFIRMAR RELATÓRIO DE COMISSÕES/);

    await handleMonthlyCommissionReportConversation(message, '1', dependencies);
    assert.equal(receivedPeriod?.start.getTime(), new Date(2026, 8, 1).getTime());
    assert.equal(receivedPeriod?.end.getTime(), new Date(2026, 8, 13).getTime());
    assert.match(String(replies.at(-1)), /01\/09\/2026 a 12\/09\/2026/);
  } finally {
    clearMonthlyCommissionReportSession(USER_ID, CHAT_ID);
  }
});

test('offers the complete previous month and keeps failed generation retryable', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  const dependencies = createDependencies(async () => {
    throw new Error('database unavailable');
  });

  try {
    await handleMonthlyCommissionReportCommand(message);
    await handleMonthlyCommissionReportConversation(message, '1', dependencies);
    assert.match(String(replies.at(-1)), /01\/08\/2026 a 31\/08\/2026/);

    await handleMonthlyCommissionReportConversation(message, '1', dependencies);
    assert.match(String(replies.at(-1)), /Nenhuma informação foi alterada/);
  } finally {
    clearMonthlyCommissionReportSession(USER_ID, CHAT_ID);
  }
});
