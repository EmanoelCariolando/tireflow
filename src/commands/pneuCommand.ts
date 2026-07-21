import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import {
  findActiveProductsByReference,
  findAvailableProductsByReference,
} from '../services/productService.js';

/**
 * Pneu Command - Fase 6 (Consulta real no banco)
 * 
 * Responsibilities:
 * - Detect "pneu <medida>"
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of active matching products with stock
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation by itself.
 * Sale is handled by saleCommand.
 */

export function formatProductList(products: QueriedProduct[], normalized: string): string {
  let text = `🛞 ${normalized}\n\n`;

  products.forEach((product, index) => {
    const num = index + 1;
    text += `${num}️⃣ ${product.description}\n`;
    text += `📦 Estoque: ${product.stock}\n`;
    text += `💰 À vista: ${formatCurrency(product.cashPrice)}\n`;
    text += `💳 A prazo: ${formatCurrency(product.creditPrice)}\n`;
    if (product.hasPhoto) text += '📷\n';

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  text += '\nPara vender digite:\nvenda 1 5';
  

  return text;
}

export function isPneuHelpCommand(body: string): boolean {
  return /^(pneu|pneus)$/i.test(body.trim());
}

export function isPneuCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized.startsWith('pneu ');
}

export async function handlePneuHelpCommand(message: Message): Promise<void> {
  await message.reply(
    [
      '🛞 COMANDOS DE PNEUS',
      '',
      'Primeiro, consulte uma medida:',
      'pneu <medida>',
      '↳ Pesquisa os pneus disponíveis dessa medida.',
      'Exemplo: pneu 175/70 R14',
      '',
      'Depois da consulta, use o número do produto mostrado na lista:',
      '',
      'venda <número> <quantidade>',
      '↳ Inicia a venda do produto e da quantidade informados.',
      'Exemplo: venda 1 2',
      '',
      'entrada <número>',
      '↳ Registra a chegada de novas unidades ao estoque.',
      'Exemplo: entrada 1',
      '',
      'ajuste <número>',
      '↳ Corrige manualmente o estoque atual do produto.',
      'Exemplo: ajuste 1',
      '',
      'preco <número>',
      '↳ Altera os preços à vista e a prazo do produto.',
      'Exemplo: preco 1',
      '',
      'foto <número>',
      '↳ Mostra a foto cadastrada do produto escolhido.',
      'Exemplo: foto 1',
      '',
      'addfoto <número>',
      '↳ Adiciona uma foto ou substitui a foto atual do produto.',
      'Depois do comando, envie a imagem solicitada.',
      'Exemplo: addfoto 1',
      '',
      'ℹ️ O número é a posição do produto na última consulta.',
    ].join('\n')
  );
}

export async function handlePneuCommand(message: Message, rawMeasure: string): Promise<void> {
  const startedAt = Date.now();

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);

  try {
    const normalized = normalizeTireSize(rawMeasure);

    if (!normalized) {
      await message.reply('Medida inválida. Exemplo: pneu 175/70 R14');
      return;
    }

    const queryStartedAt = Date.now();
    const matches = await findAvailableProductsByReference(normalized);
    const queryMs = Date.now() - queryStartedAt;

    if (matches.length === 0) {
      const activeMatches = await findActiveProductsByReference(normalized);

      if (activeMatches.length > 0) {
        const totalStock = activeMatches.reduce((sum, product) => sum + product.stock, 0);
        const replyStartedAt = Date.now();

        if (totalStock <= 0) {
          await message.reply(`A medida ${normalized} existe, mas está com estoque 0 no momento.`);
        } else {
          await message.reply(`Nenhum pneu disponível para ${normalized} no momento.`);
        }

        const replyMs = Date.now() - replyStartedAt;
        console.log(
          `[PNEU] ${message.from} -> ${normalized} (0 disponíveis, ${activeMatches.length} ativos, estoque=${totalStock}) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
            Date.now() - startedAt
          }`
        );
        return;
      }

      const replyStartedAt = Date.now();
      await message.reply(`Nenhum pneu encontrado para ${normalized}.`);
      const replyMs = Date.now() - replyStartedAt;
      console.log(
        `[PNEU] ${message.from} -> ${normalized} (0 produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
          Date.now() - startedAt
        }`
      );
      return;
    }

    // Save last consultation (5 minute TTL) - required for indexed commands
    saveLastQuery(userId, chatId, normalized, matches);

    const response = formatProductList(matches, normalized);
    const replyStartedAt = Date.now();
    await message.reply(response);
    const replyMs = Date.now() - replyStartedAt;

    console.log(
      `[PNEU] ${message.from} -> ${normalized} (${matches.length} produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
        Date.now() - startedAt
      }`
    );
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('Ocorreu um erro ao consultar os pneus. Tente novamente.');
  }
}
