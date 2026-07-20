import whatsappWeb, { type Message, type MessageMedia } from 'whatsapp-web.js';
import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { whatsappClient } from '../whatsapp/client.js';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  ProductImageTooLargeError,
} from './productPhotoStorage.js';

const { MessageMedia: WhatsAppMessageMedia } = whatsappWeb;
const MODERN_DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export interface DownloadedMediaData {
  data: string;
  mimetype: string;
  filename?: string;
  filesize?: number;
}

export interface RawMediaDownloadData {
  directPath: string;
  mediaUrl?: string;
  encFilehash?: string;
  filehash?: string;
  mediaKey: string;
  mediaKeyTimestamp?: number;
  type: string;
  mimetype: string;
  filename?: string;
  filesize?: number;
}

export interface MediaDownloadDependencies {
  downloadUsingRawDataInBrowser?(media: RawMediaDownloadData): Promise<DownloadedMediaData | undefined>;
  downloadUsingRawDataInNode?(media: RawMediaDownloadData): Promise<DownloadedMediaData | undefined>;
  downloadUsingBlobCache(messageId: string): Promise<DownloadedMediaData | undefined>;
  downloadUsingDirectPath?(messageId: string): Promise<DownloadedMediaData | undefined>;
  downloadUsingLibrary(message: Message): Promise<MessageMedia | undefined>;
  wait(milliseconds: number): Promise<void>;
}

const defaultDependencies: MediaDownloadDependencies = {
  downloadUsingRawDataInBrowser,
  downloadUsingRawDataInNode,
  downloadUsingBlobCache,
  downloadUsingDirectPath,
  downloadUsingLibrary: (message) => message.downloadMedia(),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/**
 * Downloads incoming media using the current WhatsApp Web blob cache flow.
 * Falls back to whatsapp-web.js' public method for older web versions.
 */
export async function downloadMessageMediaResilient(
  message: Message,
  dependencies: MediaDownloadDependencies = defaultDependencies
): Promise<MessageMedia | undefined> {
  const messageId = getSerializedMessageId(message);
  const rawMedia = getRawMediaDownloadData(message);
  let rawBrowserDownloadError: unknown;
  let rawNodeDownloadError: unknown;
  let modernDownloadError: unknown;
  let directPathDownloadError: unknown;

  if (rawMedia?.filesize && rawMedia.filesize > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ProductImageTooLargeError();
  }

  if (rawMedia && dependencies.downloadUsingRawDataInBrowser) {
    try {
      const downloaded = await dependencies.downloadUsingRawDataInBrowser(rawMedia);
      if (downloaded?.data && downloaded.mimetype) {
        return createMessageMedia(downloaded);
      }
      rawBrowserDownloadError = new Error('Browser direct download returned no media.');
    } catch (error) {
      rawBrowserDownloadError = error;
    }
  }

  if (rawMedia && dependencies.downloadUsingRawDataInNode) {
    try {
      const downloaded = await dependencies.downloadUsingRawDataInNode(rawMedia);
      if (downloaded?.data && downloaded.mimetype) {
        return createMessageMedia(downloaded);
      }
      rawNodeDownloadError = new Error('Node direct download returned no media.');
    } catch (error) {
      rawNodeDownloadError = error;
    }
  }

  if (messageId) {
    for (let attempt = 1; attempt <= MODERN_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const downloaded = await dependencies.downloadUsingBlobCache(messageId);
        if (downloaded?.data && downloaded.mimetype) {
          return createMessageMedia(downloaded);
        }
        modernDownloadError = new Error('WhatsApp blob cache returned no media.');
      } catch (error) {
        modernDownloadError = error;
      }

      if (attempt < MODERN_DOWNLOAD_ATTEMPTS) {
        await dependencies.wait(RETRY_DELAY_MS);
      }
    }
  }

  if (messageId && dependencies.downloadUsingDirectPath) {
    try {
      const downloaded = await dependencies.downloadUsingDirectPath(messageId);
      if (downloaded?.data && downloaded.mimetype) {
        return createMessageMedia(downloaded);
      }
      directPathDownloadError = new Error('Message lookup returned no direct media.');
    } catch (error) {
      directPathDownloadError = error;
    }
  }

  try {
    const downloaded = await dependencies.downloadUsingLibrary(message);
    if (downloaded) {
      assertDownloadedMediaSize({
        data: downloaded.data,
        mimetype: downloaded.mimetype,
        filename: downloaded.filename ?? undefined,
        filesize: downloaded.filesize ?? undefined,
      });
    }
    return downloaded;
  } catch (legacyDownloadError) {
    console.warn('[MEDIA_DOWNLOAD] All WhatsApp media download strategies failed.', {
      rawBrowserError: getErrorMessage(rawBrowserDownloadError),
      rawNodeError: getErrorMessage(rawNodeDownloadError),
      modernError: getErrorMessage(modernDownloadError),
      directPathError: getErrorMessage(directPathDownloadError),
      libraryError: getErrorMessage(legacyDownloadError),
      messageType: message.type,
    });
    throw legacyDownloadError;
  }
}

async function downloadUsingRawDataInBrowser(
  media: RawMediaDownloadData
): Promise<DownloadedMediaData | undefined> {
  const page = whatsappClient.pupPage;
  if (!page) {
    return undefined;
  }

  const serializedMedia = JSON.stringify(media);
  const result = await page.evaluate(`
    (async () => {
      const media = ${serializedMedia};
      const downloadQpl = {
        addAnnotations() { return this; },
        addPoint() { return this; },
      };
      const decryptedMedia = await window
        .require('WAWebDownloadManager')
        .downloadManager.downloadAndMaybeDecrypt({
          directPath: media.directPath,
          encFilehash: media.encFilehash,
          filehash: media.filehash,
          mediaKey: media.mediaKey,
          mediaKeyTimestamp: media.mediaKeyTimestamp,
          type: media.type,
          signal: new AbortController().signal,
          downloadQpl,
        });

      return {
        data: await window.WWebJS.arrayBufferToBase64Async(decryptedMedia),
        mimetype: media.mimetype,
        filename: media.filename,
        filesize: media.filesize,
      };
    })()
  `) as DownloadedMediaData | null;

  return result ?? undefined;
}

async function downloadUsingRawDataInNode(
  media: RawMediaDownloadData
): Promise<DownloadedMediaData | undefined> {
  const downloadUrl = buildMediaDownloadUrl(media);
  const response = await fetchTrustedWhatsAppMedia(downloadUrl);

  if (!response.ok) {
    throw new Error(`WhatsApp media server returned HTTP ${response.status}.`);
  }

  const encryptedMedia = await readResponseWithLimit(response, MAX_PRODUCT_IMAGE_BYTES + 64);
  const decryptedMedia = decryptWhatsAppMedia(encryptedMedia, media.mediaKey, media.type);

  if (media.filehash) {
    const actualFileHash = createHash('sha256').update(decryptedMedia).digest();
    const expectedFileHash = Buffer.from(media.filehash, 'base64');
    if (
      actualFileHash.length !== expectedFileHash.length ||
      !timingSafeEqual(actualFileHash, expectedFileHash)
    ) {
      throw new Error('Downloaded WhatsApp media failed plaintext hash validation.');
    }
  }

  return {
    data: decryptedMedia.toString('base64'),
    mimetype: media.mimetype,
    filename: media.filename,
    filesize: media.filesize,
  };
}

export function buildMediaDownloadUrl(media: RawMediaDownloadData): string {
  if (/^https:\/\//i.test(media.directPath)) {
    const directUrl = new URL(media.directPath);
    assertTrustedWhatsAppMediaHost(directUrl);
    return directUrl.toString();
  }

  let host = 'mmg.whatsapp.net';
  if (media.mediaUrl) {
    try {
      const mediaUrl = new URL(media.mediaUrl);
      assertTrustedWhatsAppMediaHost(mediaUrl);
      host = mediaUrl.host || host;
    } catch {
      // The signed directPath still works with WhatsApp's default media host.
    }
  }

  const normalizedPath = media.directPath.startsWith('/')
    ? media.directPath
    : `/${media.directPath}`;
  return `https://${host}${normalizedPath}`;
}

async function fetchTrustedWhatsAppMedia(url: string, redirectCount = 0): Promise<Response> {
  if (redirectCount > 3) {
    throw new Error('Too many redirects while downloading WhatsApp media.');
  }

  const parsedUrl = new URL(url);
  assertTrustedWhatsAppMediaHost(parsedUrl);
  const response = await fetch(parsedUrl, {
    headers: {
      Origin: 'https://web.whatsapp.com',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('WhatsApp media redirect did not provide a destination.');
    }
    return fetchTrustedWhatsAppMedia(new URL(location, parsedUrl).toString(), redirectCount + 1);
  }

  return response;
}

function assertTrustedWhatsAppMediaHost(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (hostname !== 'whatsapp.net' && !hostname.endsWith('.whatsapp.net'))) {
    throw new Error('Untrusted WhatsApp media URL was rejected.');
  }
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('WhatsApp media exceeds the maximum allowed size.');
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error('WhatsApp media exceeds the maximum allowed size.');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export function decryptWhatsAppMedia(
  encryptedMedia: Buffer,
  mediaKeyBase64: string,
  type: string
): Buffer {
  const mediaKey = Buffer.from(mediaKeyBase64.replace('data:;base64,', ''), 'base64');
  if (mediaKey.length !== 32) {
    throw new Error('WhatsApp media key has an invalid length.');
  }

  const mediaInfo = getMediaHkdfInfo(type);
  const expandedKey = Buffer.from(
    hkdfSync('sha256', mediaKey, Buffer.alloc(32), `WhatsApp ${mediaInfo} Keys`, 112)
  );
  const iv = expandedKey.subarray(0, 16);
  const cipherKey = expandedKey.subarray(16, 48);
  const macKey = expandedKey.subarray(48, 80);

  let ciphertext = encryptedMedia;
  if (encryptedMedia.length % 16 === 10 && encryptedMedia.length > 10) {
    ciphertext = encryptedMedia.subarray(0, encryptedMedia.length - 10);
    const receivedMac = encryptedMedia.subarray(encryptedMedia.length - 10);
    const calculatedMac = createHmac('sha256', macKey)
      .update(Buffer.concat([iv, ciphertext]))
      .digest()
      .subarray(0, 10);

    if (!timingSafeEqual(receivedMac, calculatedMac)) {
      throw new Error('Downloaded WhatsApp media failed MAC validation.');
    }
  }

  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error('Encrypted WhatsApp media has an invalid length.');
  }

  const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function getMediaHkdfInfo(type: string): string {
  if (type === 'video' || type === 'gif' || type === 'ptv') return 'Video';
  if (type === 'audio' || type === 'ptt') return 'Audio';
  if (type === 'document') return 'Document';
  return 'Image';
}

async function downloadUsingDirectPath(messageId: string): Promise<DownloadedMediaData | undefined> {
  const page = whatsappClient.pupPage;
  if (!page) {
    return undefined;
  }

  const serializedId = JSON.stringify(messageId);
  const result = await page.evaluate(`
    (async () => {
      const messageId = ${serializedId};
      const { Msg } = window.require('WAWebCollections');
      const message =
        Msg.get(messageId) ||
        (await Msg.getMessagesById([messageId]))?.messages?.[0];

      if (!message?.directPath || !message?.mediaKey) {
        return null;
      }

      const downloadQpl = {
        addAnnotations() { return this; },
        addPoint() { return this; },
      };
      const decryptedMedia = await window
        .require('WAWebDownloadManager')
        .downloadManager.downloadAndMaybeDecrypt({
          directPath: message.directPath,
          encFilehash: message.encFilehash,
          filehash: message.filehash,
          mediaKey: message.mediaKey,
          mediaKeyTimestamp: message.mediaKeyTimestamp,
          type: message.type,
          signal: new AbortController().signal,
          downloadQpl,
        });

      return {
        data: await window.WWebJS.arrayBufferToBase64Async(decryptedMedia),
        mimetype: message.mimetype,
        filename: message.filename,
        filesize: message.size,
      };
    })()
  `) as DownloadedMediaData | null;

  return result ?? undefined;
}

async function downloadUsingBlobCache(messageId: string): Promise<DownloadedMediaData | undefined> {
  const page = whatsappClient.pupPage;
  if (!page) {
    return undefined;
  }

  const serializedId = JSON.stringify(messageId);
  const result = await page.evaluate(`
    (async () => {
      const messageId = ${serializedId};
      const { Msg } = window.require('WAWebCollections');
      const message =
        Msg.get(messageId) ||
        (await Msg.getMessagesById([messageId]))?.messages?.[0];

      if (
        !message ||
        !message.mediaData ||
        message.mediaData.mediaStage === 'REUPLOADING'
      ) {
        return null;
      }

      await message.downloadMedia({
        downloadEvenIfExpensive: true,
        rmrReason: 1,
        isUserInitiated: true,
      });

      const mediaStage = message.mediaData.mediaStage || '';
      if (mediaStage.includes('ERROR') || mediaStage === 'FETCHING') {
        return null;
      }

      const cachedBlob = window
        .require('WAWebMediaInMemoryBlobCache')
        .InMemoryMediaBlobCache.get(message.mediaObject?.filehash);
      const mediaBlob = cachedBlob || message.mediaObject?.mediaBlob?.forceToBlob?.();

      if (!mediaBlob) {
        return null;
      }

      return {
        data: await window.WWebJS.arrayBufferToBase64Async(
          await mediaBlob.arrayBuffer()
        ),
        mimetype: message.mimetype,
        filename: message.filename,
        filesize: message.size,
      };
    })()
  `) as DownloadedMediaData | null;

  return result ?? undefined;
}

function createMessageMedia(downloaded: DownloadedMediaData): MessageMedia {
  assertDownloadedMediaSize(downloaded);
  return new WhatsAppMessageMedia(
    downloaded.mimetype,
    downloaded.data,
    downloaded.filename,
    downloaded.filesize
  );
}

function assertDownloadedMediaSize(downloaded: DownloadedMediaData): void {
  const estimatedDecodedBytes = Math.floor((downloaded.data.length * 3) / 4);
  if (
    (downloaded.filesize !== undefined && downloaded.filesize > MAX_PRODUCT_IMAGE_BYTES) ||
    estimatedDecodedBytes > MAX_PRODUCT_IMAGE_BYTES
  ) {
    throw new ProductImageTooLargeError();
  }
}

function getRawMediaDownloadData(message: Message): RawMediaDownloadData | null {
  const rawData = (message.rawData ?? {}) as Record<string, unknown>;
  const directPath = getString(rawData.directPath);
  const mediaKey = getString(rawData.mediaKey) || message.mediaKey;
  const mimetype = getString(rawData.mimetype);

  if (!directPath || !mediaKey || !mimetype) {
    return null;
  }

  return {
    directPath,
    mediaKey,
    mimetype,
    type: getString(rawData.type) || message.type || 'image',
    mediaUrl: getString(rawData.clientUrl) || getString(rawData.deprecatedMms3Url) || undefined,
    encFilehash: getString(rawData.encFilehash) || undefined,
    filehash: getString(rawData.filehash) || undefined,
    mediaKeyTimestamp: getNumber(rawData.mediaKeyTimestamp),
    filename: getString(rawData.filename) || undefined,
    filesize: getNumber(rawData.size),
  };
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function getNumber(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function getSerializedMessageId(message: Message): string | null {
  const id = message.id as { _serialized?: string } | undefined;
  return id?._serialized || null;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error === undefined) {
    return undefined;
  }
  return error instanceof Error ? error.message : String(error);
}
