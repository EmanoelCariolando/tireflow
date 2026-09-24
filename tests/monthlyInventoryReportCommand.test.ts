import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, MessageMedia } from 'whatsapp-web.js';
import {
  createInventoryReportPeriod,
  handleMonthlyInventoryReportCommand,
  handleMonthlyInventoryReportConversation,
  isMonthlyInventoryReportCommand,
  parseBrazilianReportDate,
  type MonthlyInventoryReportCommandDependencies,
} from '../src/commands/monthlyInventoryReportCommand.js';
import { handleMenuCommand, handleMenuSelection } from '../src/commands/menuCommand.js';
import type {
  InventoryReportPdfDelivery,
  MonthlyPeriod,
} from '../src/services/monthlyReportService.js';
import { clearMenuSession, getMenuSession } from '../src/utils/menuSessionStore.js';
import {
  clearMonthlyInventoryReportSession,
  getMonthlyInventoryReportSession,
} from '../src/utils/monthlyInventoryReportSessionStore.js';

const DEFAULT_USER_ID = 'monthly-report-user';
const DEFAULT_CHAT_ID = 'monthly-report-group@g.us';

function createMessage(
  replies: unknown[],
  userId = DEFAULT_USER_ID,
  chatId = DEFAULT_CHAT_ID
): Message {
  return {
    author: userId,
    from: chatId,
    reply: async (content: unknown) => {
      replies.push(content);
      return undefined;
    },
  } as unknown as Message;
}

function createReport(): InventoryReportPdfDelivery {
  return {
    pdfBuffer: Buffer.from('%PDF-test'),
    pdfFileName: 'relatorio-estoque-2026-09-01-a-2026-09-12.pdf',
  };
}

function createDependencies(
  overrides: Partial<MonthlyInventoryReportCommandDependencies> = {}
): MonthlyInventoryReportCommandDependencies {
  return {
    async buildReport() {
      return createReport();
    },
    createPdfMedia() {
      return { mimetype: 'application/pdf' } as MessageMedia;
    },
    now: () => new Date(2026, 8, 13, 9, 30),
    ...overrides,
  };
}

test('recognizes the monthly PDF command and parses only complete valid Brazilian dates', () => {
  assert.equal(isMonthlyInventoryReportCommand('relatorio mensal'), true);
  assert.equal(isMonthlyInventoryReportCommand('relatório estoque'), true);
  assert.equal(isMonthlyInventoryReportCommand('  RELATÓRIO   MENSAL  '), true);
  assert.equal(isMonthlyInventoryReportCommand('relatorio hoje'), false);
  assert.deepEqual(parseBrazilianReportDate('29/02/2024'), new Date(2024, 1, 29));
  assert.equal(parseBrazilianReportDate('29/02/2026'), null);
  assert.equal(parseBrazilianReportDate('1/09/2026'), null);
  assert.equal(parseBrazilianReportDate('01/09'), null);
});

test('creates an inclusive report period with an exclusive repository end date', () => {
  const period = createInventoryReportPeriod(new Date(2026, 8, 1), new Date(2026, 8, 12));
  assert.equal(period.start.getTime(), new Date(2026, 8, 1).getTime());
  assert.equal(period.end.getTime(), new Date(2026, 8, 13).getTime());
  assert.equal(period.key, '2026-09-01_a_2026-09-12');
});

test('guides a custom period through confirmation and sends the generated PDF', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  const report = createReport();
  const media = { mimetype: 'application/pdf' } as MessageMedia;
  let receivedPeriod: MonthlyPeriod | undefined;
  let receivedGeneratedAt: Date | undefined;
  const generatedAt = new Date(2026, 8, 13, 9, 30);
  const dependencies = createDependencies({
    async buildReport(period, date) {
      receivedPeriod = period;
      receivedGeneratedAt = date;
      return report;
    },
    createPdfMedia(input) {
      assert.equal(input, report);
      return media;
    },
    now: () => generatedAt,
  });

  try {
    await handleMonthlyInventoryReportCommand(message);
    assert.match(String(replies.at(-1)), /Último mês fechado/);
    assert.match(String(replies.at(-1)), /Escolher período/);

    assert.equal(await handleMonthlyInventoryReportConversation(message, '2', dependencies), true);
    assert.match(String(replies.at(-1)), /DATA INICIAL/);

    await handleMonthlyInventoryReportConversation(message, '01/09/2026', dependencies);
    assert.match(String(replies.at(-1)), /DATA FINAL/);

    await handleMonthlyInventoryReportConversation(message, '12/09/2026', dependencies);
    assert.match(String(replies.at(-1)), /CONFIRMAR RELATÓRIO/);
    assert.match(String(replies.at(-1)), /01\/09\/2026 a 12\/09\/2026/);

    await handleMonthlyInventoryReportConversation(message, '1', dependencies);
    assert.equal(receivedPeriod?.start.getTime(), new Date(2026, 8, 1).getTime());
    assert.equal(receivedPeriod?.end.getTime(), new Date(2026, 8, 13).getTime());
    assert.equal(receivedGeneratedAt, generatedAt);
    assert.equal(replies.at(-1), media);
    assert.equal(getMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID), null);
  } finally {
    clearMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID);
  }
});

test('offers the previous closed month and allows correcting it before generation', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  const dependencies = createDependencies();

  try {
    await handleMonthlyInventoryReportCommand(message);
    await handleMonthlyInventoryReportConversation(message, '1', dependencies);
    assert.match(String(replies.at(-1)), /01\/08\/2026 a 31\/08\/2026/);
    assert.equal(
      getMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID)?.step,
      'awaiting_confirmation'
    );

    await handleMonthlyInventoryReportConversation(message, '2', dependencies);
    assert.match(String(replies.at(-1)), /DATA INICIAL/);
    assert.equal(
      getMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID)?.step,
      'awaiting_start_date'
    );
  } finally {
    clearMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID);
  }
});

test('rejects invalid, future, reversed and longer-than-31-day periods', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  const dependencies = createDependencies();

  try {
    await handleMonthlyInventoryReportCommand(message);
    await handleMonthlyInventoryReportConversation(message, '2', dependencies);
    await handleMonthlyInventoryReportConversation(message, '31/02/2026', dependencies);
    assert.match(String(replies.at(-1)), /Data inicial inválida/);

    await handleMonthlyInventoryReportConversation(message, '14/09/2026', dependencies);
    assert.match(String(replies.at(-1)), /posterior ao dia atual/);

    await handleMonthlyInventoryReportConversation(message, '01/07/2026', dependencies);
    await handleMonthlyInventoryReportConversation(message, '30/06/2026', dependencies);
    assert.match(String(replies.at(-1)), /anterior à data inicial/);

    await handleMonthlyInventoryReportConversation(message, '01/09/2026', dependencies);
    assert.match(String(replies.at(-1)), /no máximo 31 dias/);
    assert.equal(
      getMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID)?.step,
      'awaiting_end_date'
    );
  } finally {
    clearMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID);
  }
});

test('keeps the confirmed period available for a safe retry after generation fails', async () => {
  const replies: unknown[] = [];
  const message = createMessage(replies);
  let mediaCreationCalls = 0;
  const dependencies = createDependencies({
    async buildReport() {
      throw new Error('database unavailable');
    },
    createPdfMedia() {
      mediaCreationCalls += 1;
      return {} as MessageMedia;
    },
  });

  try {
    await handleMonthlyInventoryReportCommand(message);
    await handleMonthlyInventoryReportConversation(message, '2', dependencies);
    await handleMonthlyInventoryReportConversation(message, '01/09/2026', dependencies);
    await handleMonthlyInventoryReportConversation(message, '12/09/2026', dependencies);
    await handleMonthlyInventoryReportConversation(message, '1', dependencies);

    assert.equal(mediaCreationCalls, 0);
    assert.match(String(replies.at(-1)), /Nenhuma informação foi alterada/);
    assert.equal(
      getMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID)?.step,
      'awaiting_confirmation'
    );
  } finally {
    clearMonthlyInventoryReportSession(DEFAULT_USER_ID, DEFAULT_CHAT_ID);
  }
});

test('runs the report flow from menu option 4 and closes the menu session', async () => {
  const replies: unknown[] = [];
  const userId = 'monthly-menu-user';
  const chatId = 'monthly-menu-group@g.us';
  const message = createMessage(replies, userId, chatId);
  let handlerCalls = 0;

  try {
    await handleMenuCommand(message);
    assert.ok(getMenuSession(userId, chatId));

    const handled = await handleMenuSelection(message, '4', {
      async handleMonthlyInventoryReport(receivedMessage) {
        handlerCalls += 1;
        assert.equal(receivedMessage, message);
      },
    });

    assert.equal(handled, true);
    assert.equal(handlerCalls, 1);
    assert.equal(getMenuSession(userId, chatId), null);
  } finally {
    clearMenuSession(userId, chatId);
    clearMonthlyInventoryReportSession(userId, chatId);
  }
});

test('runs the commission report flow from menu option 5 and closes the menu session', async () => {
  const replies: unknown[] = [];
  const userId = 'commission-menu-user';
  const chatId = 'commission-menu-group@g.us';
  const message = createMessage(replies, userId, chatId);
  let handlerCalls = 0;

  try {
    await handleMenuCommand(message);
    const handled = await handleMenuSelection(message, '5', {
      async handleMonthlyInventoryReport() {},
      async handleMonthlyCommissionReport(receivedMessage) {
        handlerCalls += 1;
        assert.equal(receivedMessage, message);
      },
    });

    assert.equal(handled, true);
    assert.equal(handlerCalls, 1);
    assert.equal(getMenuSession(userId, chatId), null);
  } finally {
    clearMenuSession(userId, chatId);
  }
});
