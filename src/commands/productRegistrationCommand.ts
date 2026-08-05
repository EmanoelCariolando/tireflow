import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  hasExpiredProductRegistrationSession,
  ProductRegistrationSession,
  saveProductRegistrationSession,
} from '../utils/productRegistrationSessionStore.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
} from '../utils/operationSessionCoordinator.js';
import {
  ProductAlreadyExistsError,
  registerNewProduct,
} from '../services/productRegistrationService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { sendBossTextNotification } from '../services/notificationService.js';
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';

const PRODUCT_REGISTRATION_COMMAND_REGEX = /^(cadastrar|adicionar)\s+pneu$/i;
const MAX_TEXT_LENGTH = 120;

export function isProductRegistrationCommand(body: string): boolean {
  return PRODUCT_REGISTRATION_COMMAND_REGEX.test(body.trim());
}

export async function handleProductRegistrationStart(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredProductRegistrationSession(userId, chatId)) {
    await message.reply('⏳ O cadastro anterior foi cancelado por inatividade. Inicie novamente pela opção 4 do menu.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  saveProductRegistrationSession({
    userId,
    chatId,
    step: 'awaiting_measure',
    updatedAt: Date.now(),
  });

  await message.reply(formatMeasureQuestion());
}

export async function handleProductRegistrationConversation(
  message: Message,
  body: string
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredProductRegistrationSession(userId, chatId)) {
    await message.reply('⏳ Cadastro cancelado por inatividade. Abra o menu e escolha a opção 4 para começar novamente.');
    return true;
  }

  const session = getProductRegistrationSession(userId, chatId);

  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ Cadastro de pneu cancelado. Nenhuma informação foi salva.');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply(
      '⚠️ Existe um cadastro de pneu em andamento.\n\nContinue respondendo à pergunta atual ou digite: cancelar'
    );
    return true;
  }

  switch (session.step) {
    case 'awaiting_measure':
      await handleMeasureStep(message, session, body);
      return true;
    case 'awaiting_description':
      await handleDescriptionStep(message, session, body);
      return true;
    case 'awaiting_initial_stock':
      await handleInitialStockStep(message, session, body);
      return true;
    case 'awaiting_supplier':
      await handleSupplierStep(message, session, body);
      return true;
    case 'awaiting_cash_price':
      await handleCashPriceStep(message, session, body);
      return true;
    case 'awaiting_location':
      await handleLocationStep(message, session, body);
      return true;
    case 'awaiting_confirmation':
      await handleConfirmationStep(message, session, normalizedBody);
      return true;
    case 'processing':
      await message.reply('⏳ Cadastro em processamento. Aguarde um instante.');
      return true;
  }
}

async function handleMeasureStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const reference = normalizeTireSize(body);

  if (!reference) {
    await message.reply(
      [
        '❌ *MEDIDA INVÁLIDA*',
        '',
        'Digite somente a medida, sem marca, modelo, LT, índice de carga ou quantidade de lonas.',
        '',
        'Exemplos aceitos:',
        '• Carro: 175/70 R14 ou 175 70 14',
        '• Moto: 110/90-17 ou 110 90 17',
        '• Agrícola: 18.4/30 ou 18,4-30',
        '• Americana: 31x10.50R15',
        '',
        'Tente novamente ou digite: cancelar',
      ].join('\n')
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_description',
    reference,
    updatedAt: Date.now(),
  });

  await message.reply(formatDescriptionQuestion(reference));
}

async function handleDescriptionStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const description = normalizeProductDescription(body);

  if (!description) {
    await message.reply(
      [
        '❌ *DESCRIÇÃO INVÁLIDA*',
        '',
        `Digite de 2 a ${MAX_TEXT_LENGTH} caracteres com a marca e o modelo do pneu.`,
        'Exemplos:',
        '• PIRELLI MT60 TRASEIRO 60P',
        '• SPEEDMAXII R-2 10 LONAS',
        '',
        'Tente novamente ou digite: cancelar',
      ].join('\n')
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_initial_stock',
    description,
    updatedAt: Date.now(),
  });

  await message.reply(
    [
      '📦 *ESTOQUE INICIAL*',
      '',
      'Quantas unidades deste pneu existem agora?',
      'Digite somente um número inteiro, sem sinal.',
      '',
      'Exemplos:',
      '• Digite 0 se ainda não recebeu o pneu',
      '• Digite 4 se já possui quatro unidades',
      '',
      'Digite: cancelar para sair',
    ].join('\n')
  );
}

async function handleInitialStockStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const initialStock = parseNonNegativeInteger(body);

  if (initialStock === null) {
    await message.reply(
      '❌ Estoque inválido.\n\nDigite somente um número inteiro igual ou maior que zero.\nExemplos: 0, 1 ou 20'
    );
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: initialStock > 0 ? 'awaiting_supplier' : 'awaiting_cash_price',
    initialStock,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);

  if (initialStock > 0) {
    await message.reply(
      [
        '🚚 *FORNECEDOR DO ESTOQUE INICIAL*',
        '',
        'Digite o nome do fornecedor das unidades que estão entrando no estoque.',
        'Essa informação ficará registrada no histórico da entrada.',
        '',
        'Exemplo: JTR Pneus',
        '',
        'Digite: cancelar para sair',
      ].join('\n')
    );
    return;
  }

  await message.reply(formatCashPriceQuestion());
}

async function handleSupplierStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const supplier = normalizeShortText(body);

  if (!supplier) {
    await message.reply(
      `❌ Fornecedor inválido.\n\nDigite um nome de 2 a ${MAX_TEXT_LENGTH} caracteres.\nExemplo: JTR Pneus`
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_cash_price',
    supplier,
    updatedAt: Date.now(),
  });
  await message.reply(formatCashPriceQuestion());
}

async function handleCashPriceStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const cashPrice = parseProductRegistrationPrice(body);

  if (cashPrice === null) {
    await message.reply(formatInvalidPriceMessage('à vista', '899,90'));
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: env.inventoryLocationsEnabled ? 'awaiting_location' : 'awaiting_confirmation',
    cashPrice,
    creditPrice: calculateCreditPrice(cashPrice),
    stockLocation: null,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);

  if (env.inventoryLocationsEnabled) {
    await message.reply(
      [
        '📍 *LOCAL DO ESTOQUE*',
        '',
        'Digite o código do local físico onde o pneu ficará guardado.',
        'Use de 1 a 20 letras ou números, sem espaços.',
        '',
        'Exemplos: CG, W3 ou PMAIS',
        'Se ainda não souber o local, digite: pular',
        '',
        'Digite: cancelar para sair',
      ].join('\n')
    );
    return;
  }

  await message.reply(formatProductRegistrationConfirmation(nextSession));
}

async function handleLocationStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const normalizedBody = body.trim().toLowerCase();
  const stockLocation = normalizedBody === 'pular' ? null : normalizeStockLocation(body);

  if (normalizedBody !== 'pular' && !stockLocation) {
    await message.reply(
      [
        '❌ *LOCAL INVÁLIDO*',
        '',
        'Use de 1 a 20 letras ou números, sem espaços.',
        'Exemplos: CG, W3 ou PMAIS',
        '',
        'Se ainda não souber o local, digite: pular',
      ].join('\n')
    );
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: 'awaiting_confirmation',
    stockLocation,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);
  await message.reply(formatProductRegistrationConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: ProductRegistrationSession,
  normalizedBody: string
): Promise<void> {
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply(
      'Para salvar exatamente os dados mostrados, digite: confirmar\n\nPara sair sem salvar, digite: cancelar'
    );
    return;
  }

  if (!isCompleteSession(session)) {
    clearProductRegistrationSession(session.userId, session.chatId);
    await message.reply(
      'Ocorreu um erro nos dados do cadastro. Nenhum pneu foi criado. Abra o menu e tente novamente.'
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  try {
    const registered = await registerNewProduct({
      reference: session.reference,
      description: session.description,
      initialStock: session.initialStock,
      supplier: session.supplier,
      cashPrice: session.cashPrice,
      stockLocation: session.stockLocation,
      responsiblePhone: session.userId,
      responsibleName,
    });

    await Promise.all([
      runPostCommitTask('product registration group confirmation', () =>
        message.reply(formatRegisteredProduct(session, registered.movementCode))
      ),
      runPostCommitTask('product registration private owner notification', () =>
        sendBossTextNotification(
          formatBossProductRegistrationNotification(
            session,
            registered.movementCode,
            responsibleName
          )
        )
      ),
    ]);
  } catch (error) {
    if (error instanceof ProductAlreadyExistsError) {
      await message.reply(
        [
          '⚠️ *PNEU JÁ CADASTRADO*',
          '',
          `Medida: ${error.reference}`,
          `Descrição: ${error.description}`,
          `Situação: ${error.isActive ? 'ativo' : 'inativo'}`,
          '',
          'Nenhum cadastro duplicado foi criado.',
          error.isActive
            ? `Para consultar, digite: pneu ${error.reference}`
            : 'O cadastro existente está inativo e precisa ser verificado no banco antes de ser reutilizado.',
        ].join('\n')
      );
    } else {
      console.error('[PRODUCT_REGISTRATION] Error registering product:', error);
      await message.reply(
        'Ocorreu um erro ao cadastrar o pneu. Nenhuma confirmação adicional é necessária. Consulte a medida antes de tentar novamente.'
      );
    }
  } finally {
    clearProductRegistrationSession(session.userId, session.chatId);
  }
}

export function normalizeProductDescription(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized.length >= 2 && normalized.length <= MAX_TEXT_LENGTH ? normalized : null;
}

function normalizeShortText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && normalized.length <= MAX_TEXT_LENGTH ? normalized : null;
}

export function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseProductRegistrationPrice(value: string): number | null {
  const compact = value.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let normalized: string;

  if (/^\d+$/.test(compact)) {
    normalized = compact;
  } else if (/^\d+,\d{1,2}$/.test(compact)) {
    normalized = compact.replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(compact)) {
    normalized = compact;
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/,/g, '');
  } else {
    return null;
  }

  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}

export function formatProductRegistrationConfirmation(
  session: ProductRegistrationSession
): string {
  return [
    '🧾 *REVISE O CADASTRO*',
    '',
    `Medida: *${session.reference}*`,
    `Descrição: *${session.description}*`,
    `Estoque inicial: *${session.initialStock}*`,
    ...(session.initialStock
      ? [`Fornecedor: *${session.supplier}*`]
      : []),
    `Preço à vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `Preço a prazo (+5,8%): *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled
      ? [`Local: *${session.stockLocation ?? 'não cadastrado'}*`]
      : []),
    '',
    'Confira principalmente a medida, a descrição, o estoque e os preços.',
    '',
    'Para salvar, digite: confirmar',
    'Para sair sem salvar, digite: cancelar',
  ].join('\n');
}

function formatMeasureQuestion(): string {
  return [
    '🆕 *CADASTRO DE PNEU*',
    '',
    '📏 *ETAPA: MEDIDA*',
    '',
    'Digite somente a medida do pneu.',
    'Não inclua marca, modelo, LT, índice de carga, velocidade ou quantidade de lonas.',
    '',
    'Exemplos:',
    '• Carro: 175/70 R14',
    '• Moto: 110/90-17 ou 110 90 17',
    '• Agrícola: 18.4/30',
    '• Americana: 31x10.50R15',
    '',
    'Você poderá revisar tudo antes de salvar.',
    'Digite: cancelar para sair',
  ].join('\n');
}

function formatDescriptionQuestion(reference: string): string {
  return [
    '🏷️ *ETAPA: DESCRIÇÃO*',
    '',
    `Medida identificada: *${reference}*`,
    '',
    'Digite a marca e o modelo que diferenciam este pneu dos outros da mesma medida.',
    'Inclua informações úteis, como desenho, índice ou quantidade de lonas.',
    '',
    'Exemplos:',
    '• PIRELLI MT60 TRASEIRO 60P',
    '• SPEEDMAXII R-2 10 LONAS',
    '',
    'Não repita a medida na descrição.',
    'Digite: cancelar para sair',
  ].join('\n');
}

function formatCashPriceQuestion(): string {
  return [
    '💰 *PREÇO À VISTA*',
    '',
    'Digite o preço unitário à vista deste pneu.',
    'O preço a prazo será calculado automaticamente com acréscimo de 5,8%.',
    '',
    'Exemplos aceitos: 899,90 | 899.90 | 899',
    'Para um valor acima de mil: 1.299,90',
    '',
    'Digite: cancelar para sair',
  ].join('\n');
}

function formatInvalidPriceMessage(label: string, example: string): string {
  return `❌ Preço ${label} inválido.\n\nDigite somente o valor, sem parcelas.\nExemplo: ${example}`;
}

function isCompleteSession(session: ProductRegistrationSession): session is ProductRegistrationSession & {
  reference: string;
  description: string;
  initialStock: number;
  cashPrice: number;
  creditPrice: number;
  stockLocation: string | null;
} {
  return Boolean(
    session.reference &&
      session.description &&
      session.initialStock !== undefined &&
      (session.initialStock === 0 || session.supplier) &&
      session.cashPrice !== undefined &&
      session.creditPrice !== undefined &&
      session.stockLocation !== undefined
  );
}

function formatRegisteredProduct(
  session: ProductRegistrationSession,
  movementCode: string | null
): string {
  return [
    '✅ *PNEU CADASTRADO*',
    '',
    `Medida: *${session.reference}*`,
    `Descrição: *${session.description}*`,
    `Estoque atual: *${session.initialStock}*`,
    ...(movementCode ? [`Entrada inicial: *${movementCode}*`] : []),
    `À vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled
      ? [`Local: *${session.stockLocation ?? 'não cadastrado'}*`]
      : []),
    '',
    `Para consultar essa medida, digite: pneu ${session.reference}`,
    ...(session.initialStock === 0
      ? ['', 'ℹ️ O pneu foi cadastrado, mas a consulta informará estoque zero até que seja feita uma entrada.']
      : []),
  ].join('\n');
}

function formatBossProductRegistrationNotification(
  session: ProductRegistrationSession,
  movementCode: string | null,
  responsibleName: string
): string {
  return [
    '🆕 *NOVO PNEU CADASTRADO*',
    '',
    `Medida: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Estoque inicial: ${session.initialStock}`,
    ...(movementCode ? [`Entrada inicial: ${movementCode}`] : []),
    `À vista: ${formatCurrency(session.cashPrice ?? 0)}`,
    `A prazo: ${formatCurrency(session.creditPrice ?? 0)}`,
    `Responsável: ${responsibleName}`,
  ].join('\n');
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(menu|venda|entrada|ajuste|pre[cç]o|local|addfoto|cadastrar\s+pneu|adicionar\s+pneu)\b/i.test(
    normalizedBody
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
