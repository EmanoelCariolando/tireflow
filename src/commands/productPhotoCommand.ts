import whatsappWeb, { type Message, type MessageMedia } from 'whatsapp-web.js';
import { existsSync } from 'node:fs';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearAddPhotoSession,
  getAddPhotoSession,
  hasExpiredAddPhotoSession,
  saveAddPhotoSession,
} from '../utils/addPhotoSessionStore.js';
import {
  getActiveProductForPhoto,
  ProductPhotoProductNotFoundError,
  replaceProductPhoto,
} from '../services/productPhotoService.js';
import {
  ProductImageTooLargeError,
  resolveProductImagePath,
  UnsupportedProductImageError,
} from '../services/productPhotoStorage.js';
import { downloadMessageMediaResilient } from '../services/whatsappMediaDownloadService.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';

const { MessageMedia: WhatsAppMessageMedia } = whatsappWeb;
const PHOTO_COMMAND_REGEX = /^foto\s+(\d+)$/i;
const ADD_PHOTO_COMMAND_REGEX = /^addfoto\s+(\d+)$/i;

interface PhotoProduct {
  id: string;
  description: string;
  stock: number;
  cashPrice: unknown;
  creditPrice: unknown;
  imagePath: string | null;
}

interface ProductPhotoCommandDependencies {
  getProduct(productId: string): Promise<PhotoProduct | null>;
  replacePhoto(
    productId: string,
    mimeType: string,
    base64Data: string
  ): Promise<{ replaced: boolean }>;
  downloadMedia(message: Message): Promise<MessageMedia | undefined>;
  createMedia(imagePath: string): MessageMedia | null;
}

const defaultDependencies: ProductPhotoCommandDependencies = {
  getProduct: getActiveProductForPhoto,
  replacePhoto: replaceProductPhoto,
  downloadMedia: downloadMessageMediaResilient,
  createMedia(imagePath: string): MessageMedia | null {
    const absolutePath = resolveProductImagePath(imagePath);
    return absolutePath && existsSync(absolutePath)
      ? WhatsAppMessageMedia.fromFilePath(absolutePath)
      : null;
  },
};

export function isPhotoCommand(body: string): boolean {
  return PHOTO_COMMAND_REGEX.test(body.trim());
}

export function isAddPhotoCommand(body: string): boolean {
  return ADD_PHOTO_COMMAND_REGEX.test(body.trim());
}

export async function handlePhotoCommand(
  message: Message,
  body: string,
  dependencies: ProductPhotoCommandDependencies = defaultDependencies
): Promise<void> {
  const optionNumber = parseOptionNumber(body, PHOTO_COMMAND_REGEX);
  if (optionNumber === null) {
    return;
  }

  if (!Number.isSafeInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('⚠️ O item informado não existe na última consulta.');
    return;
  }

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const lastQuery = getLastQuery(userId, chatId);
  if (!lastQuery) {
    await replyConsultationGuidance(message);
    return;
  }

  const queriedProduct = lastQuery.products[optionNumber - 1];
  if (!queriedProduct) {
    await message.reply(`⚠️ O item ${optionNumber} não existe na última consulta.`);
    return;
  }

  try {
    const product = await dependencies.getProduct(queriedProduct.id);
    if (!product?.imagePath) {
      await message.reply('📷 Este produto ainda não possui foto cadastrada.');
      return;
    }

    const media = dependencies.createMedia(product.imagePath);
    if (!media) {
      console.warn('[PRODUCT_PHOTO] Stored image path is invalid or the file is missing.', {
        productId: queriedProduct.id,
      });
      await message.reply('📷 A foto cadastrada não foi encontrada. Avise o responsável para cadastrar novamente.');
      return;
    }

    await message.reply(media, undefined, {
      caption: formatProductPhotoCaption(product),
    });
  } catch (error) {
    console.error('[PRODUCT_PHOTO] Could not send product image.', {
      productId: queriedProduct.id,
      error,
    });
    await message.reply('Não consegui enviar a foto do produto. Tente novamente.');
  }
}

export async function handleAddPhotoCommand(
  message: Message,
  body: string,
  dependencies: ProductPhotoCommandDependencies = defaultDependencies
): Promise<void> {
  const optionNumber = parseOptionNumber(body, ADD_PHOTO_COMMAND_REGEX);
  if (optionNumber === null) {
    return;
  }

  if (!Number.isSafeInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('⚠️ O item informado não existe na última consulta.');
    return;
  }

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  const lastQuery = getLastQuery(userId, chatId);
  if (!lastQuery) {
    await replyConsultationGuidance(message);
    return;
  }

  const queriedProduct = lastQuery.products[optionNumber - 1];
  if (!queriedProduct) {
    await message.reply(`⚠️ O item ${optionNumber} não existe na última consulta.`);
    return;
  }

  try {
    const product = await dependencies.getProduct(queriedProduct.id);
    if (!product) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }
  } catch (error) {
    console.error('[PRODUCT_PHOTO] Could not load product before image upload.', {
      productId: queriedProduct.id,
      error,
    });
    await message.reply('Ocorreu um erro ao localizar o produto. Tente novamente.');
    return;
  }

  saveAddPhotoSession({
    userId,
    chatId,
    step: 'awaiting_image',
    productId: queriedProduct.id,
    itemNumber: optionNumber,
    description: queriedProduct.description,
    startedAt: Date.now(),
  });

  await message.reply(`📷 Envie a foto do pneu:\n\n${queriedProduct.description}`);
}

export async function handleAddPhotoConversation(
  message: Message,
  body: string,
  dependencies: ProductPhotoCommandDependencies = defaultDependencies
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredAddPhotoSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return true;
  }

  const session = getAddPhotoSession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();
  if (normalizedBody === 'cancelar') {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (normalizedBody === 'pneu' || normalizedBody.startsWith('pneu ')) {
    clearAddPhotoSession(userId, chatId);
    return false;
  }

  if (!message.hasMedia || (message.type !== 'image' && message.type !== 'document')) {
    await message.reply('Envie uma imagem válida do pneu.');
    return true;
  }

  let downloadedMedia: MessageMedia | undefined;
  try {
    downloadedMedia = await dependencies.downloadMedia(message);
  } catch (error) {
    if (error instanceof ProductImageTooLargeError) {
      await message.reply('A imagem é muito grande. Envie uma foto de até 20 MB.');
      return true;
    }

    console.warn('[PRODUCT_PHOTO] Product image download failed.', {
      productId: session.productId,
      error,
    });
  }

  if (!downloadedMedia) {
    await message.reply('Não consegui receber a imagem.\nEnvie a foto novamente.');
    return true;
  }

  try {
    const result = await dependencies.replacePhoto(
      session.productId,
      downloadedMedia.mimetype,
      downloadedMedia.data
    );

    clearAddPhotoSession(userId, chatId);
    const confirmation = result.replaced
      ? '✅ Foto substituída com sucesso.'
      : '✅ Foto adicionada com sucesso.';
    await message.reply(`${confirmation}\n\n🛞 ${session.description}`);
  } catch (error) {
    if (error instanceof ProductImageTooLargeError) {
      await message.reply('A imagem é muito grande. Envie uma foto de até 20 MB.');
      return true;
    }

    if (error instanceof UnsupportedProductImageError) {
      await message.reply('Envie uma imagem válida do pneu.');
      return true;
    }

    if (error instanceof ProductPhotoProductNotFoundError) {
      clearAddPhotoSession(userId, chatId);
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return true;
    }

    console.error('[PRODUCT_PHOTO] Could not save product image.', {
      productId: session.productId,
      error,
    });
    await message.reply('Não consegui salvar a imagem.\nEnvie a foto novamente.');
  }

  return true;
}

export function formatProductPhotoCaption(product: PhotoProduct): string {
  return [
    `🛞 ${product.description}`,
    '',
    `📦 Estoque: ${product.stock}`,
    `💰 À vista: ${formatCurrency(Number(product.cashPrice))}`,
    `💳 A prazo: ${formatCurrency(Number(product.creditPrice))}`
  ].join('\n');
}

function parseOptionNumber(body: string, commandRegex: RegExp): number | null {
  const match = body.trim().match(commandRegex);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

async function replyConsultationGuidance(message: Message): Promise<void> {
  await message.reply('Faça primeiro uma consulta, por exemplo:\npneu 175 70 14');
}
