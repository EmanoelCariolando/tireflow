import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import {
  ProductLocationChangedError,
  ProductLocationNotFoundError,
  registerProductLocation,
} from '../services/productLocationService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { sendBossTextNotification } from '../services/notificationService.js';
import {
  getLastQuery,
  updateLastQueryProductLocation,
} from '../utils/lastQueryStore.js';
import {
  clearLocationSession,
  getLocationSession,
  hasExpiredLocationSession,
  LocationSession,
  saveLocationSession,
} from '../utils/locationSessionStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
} from '../utils/operationSessionCoordinator.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';

const LOCATION_COMMAND_REGEX = /^local\s+(\d+)$/i;

export function isLocationCommand(body: string): boolean {
  return LOCATION_COMMAND_REGEX.test(body.trim());
}

export async function handleLocationCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (!env.inventoryLocationsEnabled) {
    await message.reply('O cadastro de locais não está habilitado nesta unidade.');
    return;
  }

  if (hasExpiredLocationSession(userId, chatId)) {
    await message.reply('⌛ *LOCALIZAÇÃO EXPIRADA*\nFaça uma nova consulta.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  const match = body.trim().match(LOCATION_COMMAND_REGEX);

  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('❌ Comando inválido. Use: *local 1*');
    return;
  }

  const lastQuery = getLastQuery(userId, chatId);

  if (!lastQuery) {
    await message.reply(
      '⌛ *CONSULTA EXPIRADA*\nPesquise novamente: *pneu 175/70/14* ou *baixo estoque*.'
    );
    return;
  }

  const product = lastQuery.products[optionNumber - 1];

  if (!product) {
    await message.reply('❌ Opção inválida. Escolha um item da última consulta.');
    return;
  }

  const previousLocation = normalizeStockLocation(product.stockLocation);
  const reference = product.reference || lastQuery.normalizedMeasure;
  saveLocationSession({
    userId,
    chatId,
    step: 'awaiting_location',
    productId: product.id,
    reference,
    description: product.description,
    previousLocation,
    updatedAt: Date.now(),
  });

  await message.reply(
    formatLocationQuestion(reference, product.description, previousLocation)
  );
}

export async function handleLocationConversation(
  message: Message,
  body: string
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredLocationSession(userId, chatId)) {
    await message.reply('⌛ *LOCALIZAÇÃO EXPIRADA*\nFaça uma nova consulta.');
    return true;
  }

  const session = getLocationSession(userId, chatId);

  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *LOCALIZAÇÃO CANCELADA*');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return true;
  }

  if (session.step === 'awaiting_location') {
    await handleLocationStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ *ATUALIZANDO LOCAL...*');
    return true;
  }

  return false;
}

async function handleLocationStep(
  message: Message,
  session: LocationSession,
  body: string
): Promise<void> {
  const newLocation = normalizeStockLocation(body);

  if (!newLocation) {
    await message.reply(
      [
        'Local inválido.',
        '',
        'Use de 1 a 20 letras ou números, sem espaços.',
        'Exemplos: CG, W3 ou PMAIS',
      ].join('\n')
    );
    return;
  }

  if (newLocation === session.previousLocation) {
    clearLocationSession(session.userId, session.chatId);
    await message.reply(`✅ Este pneu já está cadastrado no local *${newLocation}*.`);
    return;
  }

  const nextSession: LocationSession = {
    ...session,
    step: 'awaiting_confirmation',
    newLocation,
    updatedAt: Date.now(),
  };
  saveLocationSession(nextSession);
  await message.reply(formatLocationConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: LocationSession,
  normalizedBody: string
): Promise<void> {
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply('Responda: *confirmar* ou *cancelar*.');
    return;
  }

  if (!session.newLocation) {
    clearLocationSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão de local. Faça a consulta novamente.');
    return;
  }

  saveLocationSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  let registeredLocation: Awaited<ReturnType<typeof registerProductLocation>>;

  try {
    registeredLocation = await registerProductLocation({
      productId: session.productId,
      expectedLocation: session.previousLocation,
      newLocation: session.newLocation,
    });
  } catch (error) {
    clearLocationSession(session.userId, session.chatId);

    if (error instanceof ProductLocationNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    if (error instanceof ProductLocationChangedError) {
      await message.reply(
        [
          '⚠️ O local deste pneu foi alterado por outra pessoa.',
          `Local atual: *${formatLocation(error.currentLocation)}*`,
          '',
          'Pesquise novamente antes de alterar.',
        ].join('\n')
      );
      return;
    }

    console.error('[LOCATION] Error updating product location:', error);
    await message.reply('Ocorreu um erro ao atualizar o local. Tente novamente.');
    return;
  }

  updateLastQueryProductLocation(
    session.userId,
    session.chatId,
    session.productId,
    registeredLocation.currentLocation
  );
  const responsibleName = await getResponsibleName(message, session.userId);

  await Promise.all([
    runPostCommitTask('location group confirmation', () =>
      message.reply(formatRegisteredLocation(session, registeredLocation.currentLocation))
    ),
    runPostCommitTask('location private owner notification', () =>
      sendBossTextNotification(
        formatBossLocationNotification(
          session,
          registeredLocation.previousLocation,
          registeredLocation.currentLocation,
          responsibleName
        )
      )
    ),
  ]);

  clearLocationSession(session.userId, session.chatId);
}

function formatLocationQuestion(
  reference: string,
  description: string,
  previousLocation: string | null
): string {
  return [
    '📍 *LOCALIZAÇÃO — NOVO LOCAL*',
    '',
    `🛞 *${reference} — ${description}*`,
    '',
    `📍 Local atual: *${formatLocation(previousLocation)}*`,
    '',
    'Digite o novo local. Ex.: *CG*, *W3* ou *PMAIS*',
    'Para sair: *cancelar*',
  ].join('\n');
}

export function formatLocationConfirmation(session: LocationSession): string {
  return [
    '📍 *LOCALIZAÇÃO — CONFIRMAR*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📍 Local: *${formatLocation(session.previousLocation)} → ${formatLocation(session.newLocation ?? null)}*`,
    '',
    'Responda: *confirmar* ou *cancelar*.',
  ].join('\n');
}

function formatRegisteredLocation(session: LocationSession, currentLocation: string): string {
  return [
    '✅ *LOCAL ATUALIZADO*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📍 Local: *${currentLocation}*`,
  ].join('\n');
}

function formatBossLocationNotification(
  session: LocationSession,
  previousLocation: string | null,
  currentLocation: string,
  responsibleName: string
): string {
  return [
    '📍 *LOCALIZAÇÃO ATUALIZADA*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📍 Local: *${formatLocation(previousLocation)} → ${currentLocation}*`,
    '',
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatLocation(location: string | null): string {
  return location ?? 'não cadastrado';
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|pre[cç]o|local)\b/i.test(normalizedBody);
}

async function getResponsibleName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
