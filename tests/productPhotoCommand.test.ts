import assert from 'node:assert/strict';
import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Message, MessageMedia } from 'whatsapp-web.js';
import {
  handleAddPhotoCommand,
  handleAddPhotoConversation,
  handlePhotoCommand,
} from '../src/commands/productPhotoCommand.js';
import {
  ADD_PHOTO_SESSION_TTL_MS,
  clearAddPhotoSession,
  getAddPhotoSession,
  saveAddPhotoSession,
} from '../src/utils/addPhotoSessionStore.js';
import { clearLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  ProductImageTooLargeError,
} from '../src/services/productPhotoStorage.js';
import {
  buildMediaDownloadUrl,
  decryptWhatsAppMedia,
  downloadMessageMediaResilient,
} from '../src/services/whatsappMediaDownloadService.js';

interface FakeMessageOptions {
  userId: string;
  body?: string;
  hasMedia?: boolean;
  type?: string;
  downloadMedia?: () => Promise<MessageMedia | undefined>;
}

interface FakeMessageResult {
  message: Message;
  replies: unknown[][];
}

const jpegMedia = {
  mimetype: 'image/jpeg',
  data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
  filename: 'untrusted-name.jpg',
} as MessageMedia;

function fakeMessage(options: FakeMessageOptions): FakeMessageResult {
  const replies: unknown[][] = [];
  const message = {
    from: 'official-group@g.us',
    author: options.userId,
    body: options.body ?? '',
    hasMedia: options.hasMedia ?? false,
    type: options.type ?? 'chat',
    reply: async (...args: unknown[]) => {
      replies.push(args);
      return undefined;
    },
    downloadMedia: options.downloadMedia ?? (async () => undefined),
  } as unknown as Message;

  return { message, replies };
}

function queryProduct(userId: string): void {
  saveLastQuery(userId, 'official-group@g.us', '175/70/14', [
    {
      id: `product-${userId}`,
      reference: '175/70/14',
      description: 'ITARO 203',
      stock: 9,
      cashPrice: 299,
      creditPrice: 313.95,
    },
  ]);
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getProduct: async (productId: string) => ({
      id: productId,
      description: 'ITARO 203',
      stock: 9,
      cashPrice: 299,
      creditPrice: 313.95,
      imagePath: 'uploads/products/product.jpg',
    }),
    replacePhoto: async () => ({ replaced: false }),
    downloadMedia: (message: Message) => message.downloadMedia(),
    createMedia: () => jpegMedia,
    ...overrides,
  };
}

test('foto envia a imagem cadastrada com estoque, preços e atalho da venda', async () => {
  const userId = 'photo-with-image';
  queryProduct(userId);
  const { message, replies } = fakeMessage({ userId });

  await handlePhotoCommand(message, 'foto 1', dependencies());

  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.[0], jpegMedia);
  assert.match(String((replies[0]?.[2] as { caption?: string }).caption), /🛞 ITARO 203/);
  assert.match(String((replies[0]?.[2] as { caption?: string }).caption), /venda 1 <quantidade>/);
  assert.match(String((replies[0]?.[2] as { caption?: string }).caption), /Exemplo: venda 1 2$/);
  clearLastQuery(userId);
});

test('foto informa quando o produto não possui imagem', async () => {
  const userId = 'photo-without-image';
  queryProduct(userId);
  const { message, replies } = fakeMessage({ userId });
  const deps = dependencies({
    getProduct: async () => ({
      id: 'product', description: 'ITARO 203', stock: 9, cashPrice: 299,
      creditPrice: 313.95, imagePath: null,
    }),
  });

  await handlePhotoCommand(message, 'foto 1', deps);

  assert.equal(replies[0]?.[0], '📷 Este produto ainda não possui foto cadastrada.');
  clearLastQuery(userId);
});

test('foto informa amigavelmente quando o arquivo cadastrado sumiu do disco', async () => {
  const userId = 'photo-missing-on-disk';
  queryProduct(userId);
  const { message, replies } = fakeMessage({ userId });
  await handlePhotoCommand(message, 'foto 1', dependencies({ createMedia: () => null }));
  assert.equal(
    replies[0]?.[0],
    '📷 A foto cadastrada não foi encontrada. Avise o responsável para cadastrar novamente.'
  );
  clearLastQuery(userId);
});

test('foto rejeita item inexistente', async () => {
  const userId = 'invalid-photo-item';
  queryProduct(userId);
  const { message, replies } = fakeMessage({ userId });
  await handlePhotoCommand(message, 'foto 99', dependencies());
  assert.equal(replies[0]?.[0], '⚠️ O item 99 não existe na última consulta.');
  clearLastQuery(userId);
});

test('foto orienta a consultar primeiro quando não há última consulta', async () => {
  const userId = 'photo-without-query';
  clearLastQuery(userId);
  const { message, replies } = fakeMessage({ userId });
  await handlePhotoCommand(message, 'foto 1', dependencies());
  assert.equal(replies[0]?.[0], 'Faça primeiro uma consulta, por exemplo:\npneu 175 70 14');
});

test('usuário autorizado adiciona uma foto nova', async () => {
  const userId = 'user-add-photo';
  queryProduct(userId);
  const command = fakeMessage({ userId });
  await handleAddPhotoCommand(command.message, 'addfoto 1', dependencies());
  assert.equal(command.replies[0]?.[0], '📷 Envie a foto do pneu:\n\nITARO 203');

  const upload = fakeMessage({
    userId,
    hasMedia: true,
    type: 'image',
    downloadMedia: async () => jpegMedia,
  });
  await handleAddPhotoConversation(upload.message, '', dependencies());
  assert.equal(upload.replies[0]?.[0], '✅ Foto adicionada com sucesso.\n\n🛞 ITARO 203');
  assert.equal(getAddPhotoSession(userId, 'official-group@g.us'), null);
  clearLastQuery(userId);
});

test('usuário autorizado substitui uma foto existente', async () => {
  const userId = 'user-replace-photo';
  queryProduct(userId);
  const command = fakeMessage({ userId });
  await handleAddPhotoCommand(command.message, 'addfoto 1', dependencies());

  const upload = fakeMessage({
    userId,
    hasMedia: true,
    type: 'image',
    downloadMedia: async () => jpegMedia,
  });
  await handleAddPhotoConversation(
    upload.message,
    '',
    dependencies({ replacePhoto: async () => ({ replaced: true }) })
  );
  assert.equal(upload.replies[0]?.[0], '✅ Foto substituída com sucesso.\n\n🛞 ITARO 203');
  clearLastQuery(userId);
});

test('addfoto não exige permissão de administrador', async () => {
  const userId = 'non-admin-add-photo';
  queryProduct(userId);
  const { message, replies } = fakeMessage({ userId });
  await handleAddPhotoCommand(message, 'addfoto 1', dependencies());
  assert.equal(replies[0]?.[0], '📷 Envie a foto do pneu:\n\nITARO 203');
  assert.ok(getAddPhotoSession(userId, 'official-group@g.us'));
  clearAddPhotoSession(userId, 'official-group@g.us');
  clearLastQuery(userId);
});

test('texto durante addfoto é rejeitado e a sessão continua', async () => {
  const userId = 'text-during-upload';
  savePendingSession(userId);
  const { message, replies } = fakeMessage({ userId, body: 'texto' });
  assert.equal(await handleAddPhotoConversation(message, 'texto', dependencies()), true);
  assert.equal(replies[0]?.[0], 'Envie uma imagem válida do pneu.');
  assert.ok(getAddPhotoSession(userId, 'official-group@g.us'));
  clearAddPhotoSession(userId, 'official-group@g.us');
});

test('falha em downloadMedia mantém a sessão para nova tentativa', async () => {
  const userId = 'download-failure';
  savePendingSession(userId);
  const { message, replies } = fakeMessage({
    userId,
    hasMedia: true,
    type: 'image',
    downloadMedia: async () => { throw new Error('download failed'); },
  });
  await handleAddPhotoConversation(message, '', dependencies());
  assert.equal(replies[0]?.[0], 'Não consegui receber a imagem.\nEnvie a foto novamente.');
  assert.ok(getAddPhotoSession(userId, 'official-group@g.us'));
  clearAddPhotoSession(userId, 'official-group@g.us');
});

test('imagem muito grande é rejeitada sem encerrar a sessão addfoto', async () => {
  const userId = 'oversized-download';
  savePendingSession(userId);
  const { message, replies } = fakeMessage({ userId, hasMedia: true, type: 'image' });

  await handleAddPhotoConversation(
    message,
    '',
    dependencies({
      downloadMedia: async () => { throw new ProductImageTooLargeError(); },
    })
  );

  assert.equal(replies[0]?.[0], 'A imagem é muito grande. Envie uma foto de até 20 MB.');
  assert.ok(getAddPhotoSession(userId, 'official-group@g.us'));
  clearAddPhotoSession(userId, 'official-group@g.us');
});

test('sessão addfoto expira após cinco minutos', async () => {
  const userId = 'upload-timeout';
  savePendingSession(userId, Date.now() - ADD_PHOTO_SESSION_TTL_MS - 1);
  const { message, replies } = fakeMessage({ userId });
  assert.equal(await handleAddPhotoConversation(message, '', dependencies()), true);
  assert.equal(replies[0]?.[0], '⏳ Operação cancelada por inatividade.');
  assert.equal(getAddPhotoSession(userId, 'official-group@g.us'), null);
});

test('cancelar encerra o fluxo addfoto', async () => {
  const userId = 'cancel-upload';
  savePendingSession(userId);
  const { message, replies } = fakeMessage({ userId, body: 'cancelar' });
  await handleAddPhotoConversation(message, 'cancelar', dependencies());
  assert.equal(replies[0]?.[0], '❌ Operação cancelada.');
  assert.equal(getAddPhotoSession(userId, 'official-group@g.us'), null);
});

test('nova consulta de pneu cancela addfoto e segue para o roteador', async () => {
  const userId = 'query-cancels-upload';
  savePendingSession(userId);
  const { message, replies } = fakeMessage({ userId, body: 'pneu 175 70 14' });
  assert.equal(await handleAddPhotoConversation(message, 'pneu 175 70 14', dependencies()), false);
  assert.equal(replies.length, 0);
  assert.equal(getAddPhotoSession(userId, 'official-group@g.us'), null);
});

test('download resiliente usa o cache de blobs atual do WhatsApp Web', async () => {
  const { message } = fakeMessage({ userId: 'modern-media-download', hasMedia: true, type: 'image' });
  (message as unknown as { id: { _serialized: string } }).id = { _serialized: 'message-id' };
  let libraryCalls = 0;

  const media = await downloadMessageMediaResilient(message, {
    downloadUsingBlobCache: async () => ({
      mimetype: jpegMedia.mimetype,
      data: jpegMedia.data,
      filename: 'photo.jpg',
    }),
    downloadUsingLibrary: async () => {
      libraryCalls += 1;
      return undefined;
    },
    wait: async () => undefined,
  });

  assert.equal(media?.mimetype, 'image/jpeg');
  assert.equal(media?.data, jpegMedia.data);
  assert.equal(libraryCalls, 0);
});

test('download resiliente mantém compatibilidade com versões antigas do WhatsApp Web', async () => {
  const { message } = fakeMessage({ userId: 'legacy-media-download', hasMedia: true, type: 'image' });
  (message as unknown as { id: { _serialized: string } }).id = { _serialized: 'message-id' };
  let modernCalls = 0;

  const media = await downloadMessageMediaResilient(message, {
    downloadUsingBlobCache: async () => {
      modernCalls += 1;
      return undefined;
    },
    downloadUsingLibrary: async () => jpegMedia,
    wait: async () => undefined,
  });

  assert.equal(modernCalls, 3);
  assert.equal(media, jpegMedia);
});

test('download resiliente usa directPath quando o cache de blobs está vazio', async () => {
  const { message } = fakeMessage({ userId: 'direct-path-download', hasMedia: true, type: 'image' });
  (message as unknown as { id: { _serialized: string } }).id = { _serialized: 'message-id' };
  let libraryCalls = 0;

  const media = await downloadMessageMediaResilient(message, {
    downloadUsingBlobCache: async () => undefined,
    downloadUsingDirectPath: async () => ({
      mimetype: jpegMedia.mimetype,
      data: jpegMedia.data,
      filename: 'photo.jpg',
    }),
    downloadUsingLibrary: async () => {
      libraryCalls += 1;
      return undefined;
    },
    wait: async () => undefined,
  });

  assert.equal(media?.data, jpegMedia.data);
  assert.equal(libraryCalls, 0);
});

test('download usa rawData diretamente sem procurar mensagem @lid na coleção interna', async () => {
  const { message } = fakeMessage({ userId: 'raw-lid-download', hasMedia: true, type: 'image' });
  (message as unknown as { rawData: Record<string, unknown> }).rawData = {
    directPath: '/v/t62/test-media.enc',
    mediaKey: randomBytes(32).toString('base64'),
    mimetype: 'image/jpeg',
    type: 'image',
    filehash: randomBytes(32).toString('base64'),
  };
  let receivedDirectPath: string | undefined;

  const media = await downloadMessageMediaResilient(message, {
    downloadUsingRawDataInBrowser: async (rawMedia) => {
      receivedDirectPath = rawMedia.directPath;
      return { mimetype: jpegMedia.mimetype, data: jpegMedia.data };
    },
    downloadUsingBlobCache: async () => undefined,
    downloadUsingLibrary: async () => undefined,
    wait: async () => undefined,
  });

  assert.equal(receivedDirectPath, '/v/t62/test-media.enc');
  assert.equal(media?.data, jpegMedia.data);
});

test('download rejeita tamanho anunciado acima do limite antes de acessar a rede', async () => {
  const { message } = fakeMessage({ userId: 'raw-oversized-download', hasMedia: true, type: 'image' });
  (message as unknown as { rawData: Record<string, unknown> }).rawData = {
    directPath: '/v/t62/oversized-media.enc',
    mediaKey: randomBytes(32).toString('base64'),
    mimetype: 'image/jpeg',
    type: 'image',
    size: MAX_PRODUCT_IMAGE_BYTES + 1,
  };
  let strategyCalls = 0;

  await assert.rejects(
    downloadMessageMediaResilient(message, {
      downloadUsingRawDataInBrowser: async () => {
        strategyCalls += 1;
        return undefined;
      },
      downloadUsingBlobCache: async () => undefined,
      downloadUsingLibrary: async () => undefined,
      wait: async () => undefined,
    }),
    ProductImageTooLargeError
  );
  assert.equal(strategyCalls, 0);
});

test('fallback Node descriptografa mídia do WhatsApp com HKDF e AES-256-CBC', () => {
  const plaintext = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03, 0xff, 0xd9]);
  const mediaKey = randomBytes(32);
  const expandedKey = Buffer.from(
    hkdfSync('sha256', mediaKey, Buffer.alloc(32), 'WhatsApp Image Keys', 112)
  );
  const iv = expandedKey.subarray(0, 16);
  const cipherKey = expandedKey.subarray(16, 48);
  const macKey = expandedKey.subarray(48, 80);
  const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = createHmac('sha256', macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);

  const decrypted = decryptWhatsAppMedia(
    Buffer.concat([ciphertext, mac]),
    mediaKey.toString('base64'),
    'image'
  );

  assert.deepEqual(decrypted, plaintext);
});

test('fallback Node rejeita mídia criptografada adulterada', () => {
  const mediaKey = randomBytes(32);
  const invalidEncryptedMedia = randomBytes(42);

  assert.throws(
    () => decryptWhatsAppMedia(invalidEncryptedMedia, mediaKey.toString('base64'), 'image'),
    /MAC validation/
  );
});

test('fallback Node aceita somente hosts de mídia do WhatsApp', () => {
  const baseMedia = {
    directPath: '/v/t62/test-media.enc',
    mediaKey: randomBytes(32).toString('base64'),
    mimetype: 'image/jpeg',
    type: 'image',
  };

  assert.equal(
    buildMediaDownloadUrl(baseMedia),
    'https://mmg.whatsapp.net/v/t62/test-media.enc'
  );
  assert.match(
    buildMediaDownloadUrl({ ...baseMedia, mediaUrl: 'https://mmg-fna.whatsapp.net/source' }),
    /^https:\/\/mmg-fna\.whatsapp\.net\//
  );
  assert.throws(
    () => buildMediaDownloadUrl({ ...baseMedia, directPath: 'https://example.com/media.enc' }),
    /Untrusted WhatsApp media URL/
  );
});

function savePendingSession(userId: string, startedAt = Date.now()): void {
  saveAddPhotoSession({
    userId,
    chatId: 'official-group@g.us',
    step: 'awaiting_image',
    productId: `product-${userId}`,
    itemNumber: 1,
    description: 'ITARO 203',
    startedAt,
  });
}
