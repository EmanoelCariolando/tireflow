import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  AdjustmentKind,
  AdjustmentSession,
  clearAdjustmentSession,
  getAdjustmentSession,
  hasExpiredAdjustmentSession,
  saveAdjustmentSession,
} from '../utils/adjustmentSessionStore.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
  isNewOperationConversationCommand as isNewOperationCommand,
} from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  AdjustmentInsufficientStockError,
  AdjustmentProductNotFoundError,
  AdjustmentSameProductError,
  AdjustmentStockChangedError,
  registerAdjustment,
  registerStockTransfer,
} from '../services/adjustmentService.js';
import { getCurrentProductStock } from '../services/saleService.js';
import { sendBossNotification } from '../services/notificationService.js';
import {
  formatConfirmationOptions,
  isBackResponse,
  isCancellationResponse,
  parseConfirmationAction,
} from '../utils/operationResponse.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  findActiveProductsByReference,
  findSuggestedActiveReferences,
} from '../services/productService.js';
import { formatReferenceSuggestions } from './pneuCommand.js';
import { getProductIcon, isBatteryCategory } from '../utils/productCategory.js';

const ADJUSTMENT_COMMAND_REGEX = /^ajuste\s+(\d+)$/i;

export function isAdjustmentCommand(body: string): boolean {
  return ADJUSTMENT_COMMAND_REGEX.test(body.trim());
}

export function formatAdjustmentTypeQuestion(
  session: Pick<AdjustmentSession, 'reference' | 'description' | 'previousStock' | 'category'>
): string {
  return [
    '🧮 *AJUSTE DE ESTOQUE*',
    '',
    `${getProductIcon(session.category)} *${session.reference} — ${session.description}*`,
    `📦 Estoque atual: *${session.previousStock}*`,
    '',
    'O que deseja fazer?',
    '',
    '1️⃣ Informar o estoque contado (saldo final)',
    '2️⃣ Adicionar unidades',
    '3️⃣ Retirar unidades',
    ...(isBatteryCategory(session.category) ? [] : ['4️⃣ Transferir para outro pneu']),
    '0️⃣ Cancelar',
  ].join('\n');
}

export async function handleAdjustmentCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredAdjustmentSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  const match = body.trim().match(ADJUSTMENT_COMMAND_REGEX);
  if (!match) return;

  const optionNumber = Number(match[1]);
  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('❌ Comando inválido. Use: *ajuste 1*');
    return;
  }

  const lastQuery = getLastQuery(userId, chatId);
  if (!lastQuery) {
    await message.reply(
      '⌛ *CONSULTA EXPIRADA*\nPesquise novamente: *pneu 175/70 R14* ou *baixo estoque*.'
    );
    return;
  }

  const product = lastQuery.products[optionNumber - 1];
  if (!product) {
    await message.reply('❌ Item inválido. Use um número da última consulta.');
    return;
  }

  const currentStock = await getCurrentProductStock(product.id);
  if (currentStock === null) {
    await message.reply('⚠️ Produto indisponível. Faça uma nova consulta.');
    return;
  }

  const session: AdjustmentSession = {
    userId,
    chatId,
    step: 'awaiting_adjustment_type',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    category: product.category,
    previousStock: currentStock,
    updatedAt: Date.now(),
  };
  saveAdjustmentSession(session);
  await message.reply(formatAdjustmentTypeQuestion(session));
}

export async function handleAdjustmentConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredAdjustmentSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return true;
  }

  const session = getAdjustmentSession(userId, chatId);
  if (!session) return false;

  const normalizedBody = body.trim().toLowerCase();
  if (
    isCancellationResponse(normalizedBody) ||
    (normalizedBody === '0' && session.step === 'awaiting_adjustment_type')
  ) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (isBackResponse(normalizedBody) && (await handleBackNavigation(message, session))) {
    return true;
  }

  // A reason is free text and may legitimately start with words such as "venda".
  if (session.step === 'awaiting_reason') {
    await handleReasonStep(message, session, body);
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nContinue o ajuste ou digite *cancelar*.');
    return true;
  }

  switch (session.step) {
    case 'awaiting_adjustment_type':
      await handleAdjustmentTypeStep(message, session, normalizedBody);
      return true;
    case 'awaiting_new_stock':
      await handleNewStockStep(message, session, normalizedBody);
      return true;
    case 'awaiting_quantity':
      await handleQuantityStep(message, session, normalizedBody);
      return true;
    case 'awaiting_transfer_measure':
      await handleTransferMeasureStep(message, session, body);
      return true;
    case 'awaiting_transfer_product':
      await handleTransferProductStep(message, session, normalizedBody);
      return true;
    case 'awaiting_confirmation':
      await handleConfirmationStep(message, session, normalizedBody);
      return true;
    case 'processing':
      await message.reply('⏳ *REGISTRANDO AJUSTE...*');
      return true;
  }
}

async function handleAdjustmentTypeStep(
  message: Message,
  session: AdjustmentSession,
  body: string
): Promise<void> {
  const kind = parseAdjustmentKind(body);
  if (!kind) {
    await message.reply(`❌ Opção inválida.\n\n${formatAdjustmentTypeQuestion(session)}`);
    return;
  }

  if (kind === 'transfer' && isBatteryCategory(session.category)) {
    await message.reply(`❌ Opção inválida.\n\n${formatAdjustmentTypeQuestion(session)}`);
    return;
  }

  if ((kind === 'remove' || kind === 'transfer') && session.previousStock <= 0) {
    await message.reply(
      `⚠️ ${isBatteryCategory(session.category) ? 'Esta bateria' : 'Este pneu'} está com estoque *0* e não possui unidades para ${
        kind === 'remove' ? 'retirar' : 'transferir'
      }.\n\n${formatAdjustmentTypeQuestion(session)}`
    );
    return;
  }

  if (kind === 'set') {
    saveAdjustmentSession({
      ...session,
      kind,
      step: 'awaiting_new_stock',
      updatedAt: Date.now(),
    });
    await message.reply(formatFinalStockQuestion(session));
    return;
  }

  if (kind === 'transfer') {
    saveAdjustmentSession({
      ...session,
      kind,
      step: 'awaiting_transfer_measure',
      updatedAt: Date.now(),
    });
    await message.reply(formatTransferMeasureQuestion());
    return;
  }

  saveAdjustmentSession({
    ...session,
    kind,
    step: 'awaiting_quantity',
    updatedAt: Date.now(),
  });
  await message.reply(formatAdjustmentQuantityQuestion(kind, session.previousStock));
}

function parseAdjustmentKind(body: string): AdjustmentKind | null {
  if (/^(1|saldo|contagem|contado|corrigir)$/.test(body)) return 'set';
  if (/^(2|adicionar|somar)$/.test(body)) return 'add';
  if (/^(3|retirar|remover|baixar|baixa)$/.test(body)) return 'remove';
  if (/^(4|transferir|transferencia|transferência)$/.test(body)) return 'transfer';
  return null;
}

async function handleNewStockStep(
  message: Message,
  session: AdjustmentSession,
  normalizedBody: string
): Promise<void> {
  const newStock = Number(normalizedBody);
  if (!Number.isInteger(newStock) || newStock < 0) {
    await message.reply(
      `❌ Estoque inválido. Digite um inteiro maior ou igual a zero.\n\n${formatFinalStockQuestion(
        session
      )}`
    );
    return;
  }
  if (newStock === session.previousStock) {
    await message.reply(
      `ℹ️ O estoque informado já é *${session.previousStock}*. Digite um saldo diferente ou *cancelar*.`
    );
    return;
  }

  saveAdjustmentSession({
    ...session,
    kind: session.kind ?? 'set',
    step: 'awaiting_reason',
    newStock,
    quantity: Math.abs(newStock - session.previousStock),
    updatedAt: Date.now(),
  });
  await message.reply(formatReasonQuestion(session.kind ?? 'set'));
}

async function handleQuantityStep(
  message: Message,
  session: AdjustmentSession,
  normalizedBody: string
): Promise<void> {
  const quantity = Number(normalizedBody);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    await message.reply(
      `❌ Quantidade inválida. Digite um inteiro positivo.\n\n${formatAdjustmentQuantityQuestion(
        session.kind ?? 'add',
        session.previousStock
      )}`
    );
    return;
  }

  if (session.kind === 'remove' && quantity > session.previousStock) {
    await message.reply(
      `⚠️ Não é possível retirar *${quantity}*. Estoque disponível: *${
        session.previousStock
      }*.\n\n${formatAdjustmentQuantityQuestion('remove', session.previousStock)}`
    );
    return;
  }

  if (session.kind === 'transfer') {
    if (quantity > session.previousStock) {
      await message.reply(
        `⚠️ Não é possível transferir *${quantity}*. Estoque de origem: *${
          session.previousStock
        }*.\n\n${formatAdjustmentQuantityQuestion('transfer', session.previousStock)}`
      );
      return;
    }
    const targetPreviousStock = session.targetPreviousStock;
    if (targetPreviousStock === undefined) {
      clearAdjustmentSession(session.userId, session.chatId);
      await message.reply('Ocorreu um erro na sessão da transferência. Inicie o ajuste novamente.');
      return;
    }
    saveAdjustmentSession({
      ...session,
      step: 'awaiting_reason',
      quantity,
      newStock: session.previousStock - quantity,
      targetNewStock: targetPreviousStock + quantity,
      updatedAt: Date.now(),
    });
    await message.reply(formatReasonQuestion('transfer'));
    return;
  }

  const kind = session.kind ?? 'add';
  const newStock =
    kind === 'remove' ? session.previousStock - quantity : session.previousStock + quantity;
  saveAdjustmentSession({
    ...session,
    step: 'awaiting_reason',
    quantity,
    newStock,
    updatedAt: Date.now(),
  });
  await message.reply(formatReasonQuestion(kind));
}

async function handleTransferMeasureStep(
  message: Message,
  session: AdjustmentSession,
  body: string
): Promise<void> {
  const normalized = normalizeTireSize(body);
  if (!normalized) {
    const suggestions = await findSuggestedActiveReferences(body);
    const suggestionText = formatReferenceSuggestions(suggestions);
    await message.reply(
      `❌ Medida inválida. Ex.: *175 70 14*${
        suggestionText ? `\n\n${suggestionText}` : `\n\n${formatTransferMeasureQuestion()}`
      }`
    );
    return;
  }

  const matches = (await findActiveProductsByReference(normalized))
    .filter((product) => product.id !== session.productId)
    .map((product) => ({
      id: product.id,
      reference: product.reference,
      description: product.description,
      stock: product.stock,
    }));

  if (matches.length === 0) {
    const suggestions = await findSuggestedActiveReferences(body);
    const suggestionText = formatReferenceSuggestions(suggestions);
    await message.reply(
      `🔎 Nenhum outro pneu encontrado para *${normalized}*.${
        suggestionText ? `\n\n${suggestionText}` : `\n\n${formatTransferMeasureQuestion()}`
      }`
    );
    return;
  }

  saveAdjustmentSession({
    ...session,
    step: 'awaiting_transfer_product',
    transferCandidates: matches,
    updatedAt: Date.now(),
  });
  await message.reply(formatTransferProductQuestion(matches));
}

async function handleTransferProductStep(
  message: Message,
  session: AdjustmentSession,
  body: string
): Promise<void> {
  const selection = Number(body);
  const candidate =
    Number.isSafeInteger(selection) && selection > 0
      ? session.transferCandidates?.[selection - 1]
      : undefined;
  if (!candidate) {
    await message.reply(
      `❌ Pneu de destino inválido.\n\n${formatTransferProductQuestion(
        session.transferCandidates ?? []
      )}`
    );
    return;
  }

  saveAdjustmentSession({
    ...session,
    step: 'awaiting_quantity',
    targetProductId: candidate.id,
    targetReference: candidate.reference,
    targetDescription: candidate.description,
    targetPreviousStock: candidate.stock,
    transferCandidates: undefined,
    updatedAt: Date.now(),
  });
  await message.reply(formatAdjustmentQuantityQuestion('transfer', session.previousStock));
}

async function handleReasonStep(
  message: Message,
  session: AdjustmentSession,
  body: string
): Promise<void> {
  const reason = body.trim();
  if (!reason) {
    await message.reply(formatReasonQuestion(session.kind ?? 'set', true));
    return;
  }

  const nextSession: AdjustmentSession = {
    ...session,
    step: 'awaiting_confirmation',
    reason,
    updatedAt: Date.now(),
  };
  saveAdjustmentSession(nextSession);
  await message.reply(formatAdjustmentConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: AdjustmentSession,
  normalizedBody: string
): Promise<void> {
  const action = parseConfirmationAction(normalizedBody);
  if (action === 'cancel') {
    clearAllOperationSessions(session.userId, session.chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return;
  }
  if (action === 'back') {
    saveAdjustmentSession({ ...session, step: 'awaiting_reason', updatedAt: Date.now() });
    await message.reply(formatReasonQuestion(session.kind ?? 'set'));
    return;
  }
  if (action !== 'confirm') {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
    return;
  }

  if (session.newStock === undefined || !session.reason) {
    clearAdjustmentSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão do ajuste. Faça a consulta novamente.');
    return;
  }

  const kind = session.kind ?? 'set';
  const compatibleSession = { ...session, kind };
  saveAdjustmentSession({ ...compatibleSession, step: 'processing', updatedAt: Date.now() });
  const responsibleName = await getResponsibleName(message, session.userId);

  try {
    if (kind === 'transfer') {
      await confirmTransfer(message, compatibleSession, responsibleName);
    } else {
      await confirmSingleAdjustment(message, compatibleSession, responsibleName);
    }
  } catch (error) {
    clearAdjustmentSession(session.userId, session.chatId);
    if (error instanceof AdjustmentProductNotFoundError) {
      await message.reply('⚠️ Um dos produtos não está mais disponível. Faça uma nova consulta.');
      return;
    }
    if (error instanceof AdjustmentStockChangedError) {
      await message.reply(
        '⚠️ O estoque mudou enquanto o ajuste era preenchido. Nada foi alterado; consulte novamente para usar os saldos atuais.'
      );
      return;
    }
    if (error instanceof AdjustmentInsufficientStockError) {
      await message.reply(
        '⚠️ O pneu de origem não possui mais estoque suficiente. Nada foi alterado; consulte novamente.'
      );
      return;
    }
    if (error instanceof AdjustmentSameProductError) {
      await message.reply('⚠️ Origem e destino precisam ser pneus diferentes. Nada foi alterado.');
      return;
    }
    console.error('[ADJUSTMENT] Error registering adjustment:', error);
    await message.reply('Ocorreu um erro ao registrar o ajuste. Tente novamente.');
    return;
  }

  clearAdjustmentSession(session.userId, session.chatId);
}

async function confirmSingleAdjustment(
  message: Message,
  session: AdjustmentSession,
  responsibleName: string
): Promise<void> {
  const registered = await registerAdjustment({
    productId: session.productId,
    responsiblePhone: session.userId,
    responsibleName,
    newStock: session.newStock!,
    reason: session.reason!,
    expectedStock: session.previousStock,
  });
  const confirmation = formatRegisteredAdjustment(
    session,
    registered.movementCode,
    responsibleName,
    registered.previousStock,
    registered.currentStock
  );
  await runPostCommitTask('adjustment group confirmation', () => message.reply(confirmation));
  await runPostCommitTask('adjustment private owner notification', () =>
    sendBossNotification(
      formatBossAdjustmentNotification(
        session,
        registered.movementCode,
        responsibleName,
        registered.previousStock,
        registered.currentStock
      )
    )
  );
}

async function confirmTransfer(
  message: Message,
  session: AdjustmentSession,
  responsibleName: string
): Promise<void> {
  if (!session.targetProductId || session.targetPreviousStock === undefined || !session.quantity) {
    throw new Error('Incomplete stock transfer session.');
  }
  const registered = await registerStockTransfer({
    sourceProductId: session.productId,
    targetProductId: session.targetProductId,
    responsiblePhone: session.userId,
    responsibleName,
    quantity: session.quantity,
    reason: session.reason!,
    expectedSourceStock: session.previousStock,
    expectedTargetStock: session.targetPreviousStock,
  });
  const confirmation = formatRegisteredTransfer(session, registered, responsibleName);
  await runPostCommitTask('stock transfer group confirmation', () => message.reply(confirmation));
  await runPostCommitTask('stock transfer private owner notification', () =>
    sendBossNotification(formatBossTransferNotification(session, registered, responsibleName))
  );
}

async function handleBackNavigation(
  message: Message,
  session: AdjustmentSession
): Promise<boolean> {
  if (session.step === 'awaiting_transfer_product') {
    saveAdjustmentSession({
      ...session,
      step: 'awaiting_transfer_measure',
      transferCandidates: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatTransferMeasureQuestion());
    return true;
  }
  if (session.step === 'awaiting_reason') {
    if (session.kind === 'set' || !session.kind) {
      saveAdjustmentSession({ ...session, step: 'awaiting_new_stock', updatedAt: Date.now() });
      await message.reply(formatFinalStockQuestion(session));
      return true;
    }
    if (session.kind === 'transfer') {
      saveAdjustmentSession({ ...session, step: 'awaiting_quantity', updatedAt: Date.now() });
      await message.reply(formatAdjustmentQuantityQuestion('transfer', session.previousStock));
      return true;
    }
    saveAdjustmentSession({ ...session, step: 'awaiting_quantity', updatedAt: Date.now() });
    await message.reply(formatAdjustmentQuantityQuestion(session.kind, session.previousStock));
    return true;
  }
  if (session.step === 'awaiting_quantity' && session.kind === 'transfer') {
    saveAdjustmentSession({
      ...session,
      step: 'awaiting_transfer_measure',
      targetProductId: undefined,
      targetReference: undefined,
      targetDescription: undefined,
      targetPreviousStock: undefined,
      targetNewStock: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatTransferMeasureQuestion());
    return true;
  }
  if (
    session.step === 'awaiting_transfer_measure' ||
    session.step === 'awaiting_new_stock' ||
    session.step === 'awaiting_quantity'
  ) {
    const reset: AdjustmentSession = {
      userId: session.userId,
      chatId: session.chatId,
      step: 'awaiting_adjustment_type',
      productId: session.productId,
      reference: session.reference,
      description: session.description,
      category: session.category,
      previousStock: session.previousStock,
      updatedAt: Date.now(),
    };
    saveAdjustmentSession(reset);
    await message.reply(formatAdjustmentTypeQuestion(reset));
    return true;
  }
  return false;
}

function formatFinalStockQuestion(session: Pick<AdjustmentSession, 'previousStock'>): string {
  return [
    '📦 *ESTOQUE CONTADO*',
    `Estoque atual no sistema: *${session.previousStock}*`,
    '',
    'Digite o saldo final encontrado na contagem.',
    'Ex.: se contou 7 pneus, digite *7*.',
    '',
    'Digite *voltar* para escolher outro tipo de ajuste.',
  ].join('\n');
}

function formatAdjustmentQuantityQuestion(kind: AdjustmentKind, currentStock: number): string {
  const verb =
    kind === 'remove' ? 'retirar' : kind === 'transfer' ? 'transferir' : 'adicionar';
  return [
    '📦 *QUANTIDADE*',
    `Estoque de origem: *${currentStock}*`,
    '',
    `Quantas unidades deseja ${verb}?`,
    ...(kind === 'remove' || kind === 'transfer' ? [`Máximo: *${currentStock}*`] : []),
    '',
    'Digite *voltar* para retornar.',
  ].join('\n');
}

function formatTransferMeasureQuestion(): string {
  return [
    '🔄 *TRANSFERÊNCIA — DESTINO*',
    '',
    'Digite a medida do pneu que deve receber o estoque.',
    'Ex.: *175 70 14*',
    '',
    'Digite *voltar* para escolher outro tipo de ajuste.',
  ].join('\n');
}

function formatTransferProductQuestion(
  candidates: NonNullable<AdjustmentSession['transferCandidates']>
): string {
  return [
    '🔄 *ESCOLHA O PNEU DE DESTINO*',
    '',
    ...candidates.flatMap((candidate, index) => [
      `${index + 1}️⃣ *${candidate.reference} — ${candidate.description}*`,
      `📦 Estoque: *${candidate.stock}*`,
      ...(index < candidates.length - 1 ? [''] : []),
    ]),
    '',
    'Digite o número do pneu ou *voltar*.',
  ].join('\n');
}

function formatReasonQuestion(kind: AdjustmentKind, invalid = false): string {
  const example =
    kind === 'transfer'
      ? 'Venda baixada no pneu semelhante'
      : kind === 'remove'
        ? 'Avaria identificada na conferência'
        : kind === 'add'
          ? 'Unidade encontrada na conferência'
          : 'Conferência semanal';
  return [
    ...(invalid ? ['❌ Informe o motivo.', ''] : []),
    '📝 *AJUSTE — MOTIVO*',
    '',
    'Informe o motivo para manter o histórico correto.',
    `Ex.: *${example}*`,
  ].join('\n');
}

function formatAdjustmentConfirmation(session: AdjustmentSession): string {
  const operationLabel = getAdjustmentKindLabel(session.kind ?? 'set');
  const lines =
    session.kind === 'transfer'
      ? [
          `📤 Origem: *${session.reference} — ${session.description}*`,
          `   Estoque: *${session.previousStock} → ${session.newStock}*`,
          `📥 Destino: *${session.targetReference} — ${session.targetDescription}*`,
          `   Estoque: *${session.targetPreviousStock} → ${session.targetNewStock}*`,
          `🔢 Quantidade: *${session.quantity}*`,
        ]
      : [
          `${getProductIcon(session.category)} *${session.reference} — ${session.description}*`,
          `📦 Estoque: *${session.previousStock} → ${session.newStock}*`,
          ...(session.kind === 'add' || session.kind === 'remove'
            ? [`🔢 Quantidade: *${session.quantity}*`]
            : []),
        ];
  return [
    '🧮 *AJUSTE — CONFIRMAR*',
    '',
    `⚙️ Operação: *${operationLabel}*`,
    '',
    ...lines,
    `📝 Motivo: *${session.reason}*`,
    '',
    formatConfirmationOptions(),
  ].join('\n');
}

function getAdjustmentKindLabel(kind: AdjustmentKind): string {
  return {
    set: 'Corrigir saldo final',
    add: 'Adicionar unidades',
    remove: 'Retirar unidades',
    transfer: 'Transferir entre pneus',
  }[kind];
}

function formatRegisteredAdjustment(
  session: AdjustmentSession,
  movementCode: string,
  responsibleName: string,
  previousStock: number,
  currentStock: number
): string {
  return [
    '✅ *AJUSTE REGISTRADO*',
    '',
    `⚙️ Operação: *${getAdjustmentKindLabel(session.kind ?? 'set')}*`,
    `${getProductIcon(session.category)} *${session.reference} — ${session.description}*`,
    `📦 Estoque: *${previousStock} → ${currentStock}*`,
    ...(session.quantity ? [`🔢 Quantidade: *${session.quantity}*`] : []),
    `📝 Motivo: *${session.reason}*`,
    '',
    ...formatMovementNumberMessage(`🧾 Movimentação: *${movementCode}*`),
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatBossAdjustmentNotification(
  session: AdjustmentSession,
  movementCode: string,
  responsibleName: string,
  previousStock: number,
  currentStock: number
): string {
  return formatRegisteredAdjustment(
    session,
    movementCode,
    responsibleName,
    previousStock,
    currentStock
  ).replace('✅ *AJUSTE REGISTRADO*', '🧮 *AJUSTE DE ESTOQUE*');
}

type RegisteredTransfer = Awaited<ReturnType<typeof registerStockTransfer>>;

function formatRegisteredTransfer(
  session: AdjustmentSession,
  registered: RegisteredTransfer,
  responsibleName: string
): string {
  return [
    '✅ *TRANSFERÊNCIA REGISTRADA*',
    '',
    `📤 Origem: *${session.reference} — ${session.description}*`,
    `   Estoque: *${registered.sourcePreviousStock} → ${registered.sourceCurrentStock}*`,
    `📥 Destino: *${session.targetReference} — ${session.targetDescription}*`,
    `   Estoque: *${registered.targetPreviousStock} → ${registered.targetCurrentStock}*`,
    `🔢 Quantidade transferida: *${session.quantity}*`,
    `📝 Motivo: *${session.reason}*`,
    '',
    ...formatMovementNumberMessage(
      `🧾 Movimentações: *${registered.sourceMovementCode}* e *${registered.targetMovementCode}*`
    ),
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatBossTransferNotification(
  session: AdjustmentSession,
  registered: RegisteredTransfer,
  responsibleName: string
): string {
  return formatRegisteredTransfer(session, registered, responsibleName).replace(
    '✅ *TRANSFERÊNCIA REGISTRADA*',
    '🔄 *TRANSFERÊNCIA DE ESTOQUE*'
  );
}

async function getResponsibleName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
