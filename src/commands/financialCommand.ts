import type { Message } from 'whatsapp-web.js';
import { randomUUID } from 'node:crypto';
import {
  assertFinancialAdministrator, closeFinancialMonth, FinancialOperationError,
  formatClosingCommissions, formatFinancialClosing, markClosingCommissionPaid,
  previewFinancialClosing, previewSaleReversal, readFinancialClosing, readSaleReversal,
  registerReversalReturn, registerSaleReversal, type ReversalSelection,
} from '../services/financialService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { getMessageChatId, getMessageUserId, getSerializedMessageId } from '../utils/messageContext.js';
import { clearFinancialSession, getFinancialSession, saveFinancialSession, type FinancialAction } from '../utils/financialSessionStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { parseConfirmationAction } from '../utils/operationResponse.js';

const HELP = [
  '📒 *FINANCEIRO — ADMINISTRADOR*',
  'Consultar itens: *estorno #V-000001*',
  'Estorno total sem retorno ao estoque: *estorno #V-000001 total motivo: cancelamento*',
  'Parcial: *estorno #V-000001 itens 1:2:1 motivo: devolução parcial*',
  'Cada item usa *número:quantidade estornada:quantidade recebida*. Separe itens por vírgula.',
  'Receber produto depois: *retorno estorno #E-000001 1 1* (item e quantidade).',
  'Fechar mês: *fechar mes 10/2026*',
  'Consultar fechamento: *fechamento 10/2026*',
  'Marcar pagamento integral: *pagar comissao 10/2026 1* (número do vendedor no fechamento).',
  'Operações de gravação exigem *confirmar*. Para desistir: *cancelar*.',
].join('\n\n');

export function isFinancialCommand(body: string): boolean {
  return /^(financeiro|estorno|retorno\s+estorno|fechar\s+m[eê]s|fechamento|pagar\s+comiss[aã]o)\b/i.test(body.trim());
}

function periodKey(value: string): string {
  const match = value.match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (!match) throw new FinancialOperationError('Use um mês no formato MM/AAAA.');
  return `${match[2]}-${match[1]}`;
}

export async function handleFinancialCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  try {
    await assertFinancialAdministrator(userId);
    const operationId = `financial:${getSerializedMessageId(message) ?? randomUUID()}`;
    let action: FinancialAction | undefined;
    let preview = '';
    let match: RegExpMatchArray | null;
    if ((match = body.match(/^fechar\s+m[eê]s\s+(\S+)$/i))) {
      const period = periodKey(match[1]);
      const closing = await previewFinancialClosing(userId, period);
      action = { kind: 'close', period, hash: closing.hash };
      preview = `${formatFinancialClosing(closing.snapshot)}\n\n${formatClosingCommissions(closing.snapshot)}\n\nO fechamento será imutável.`;
    } else if ((match = body.match(/^fechamento\s+(\S+)$/i))) {
      const closing = await readFinancialClosing(userId, periodKey(match[1]));
      await message.reply([closing.financialText, closing.commissionText,
        closing.sellers.map((seller, index) => `${index + 1}. ${seller.seller.name}: ${seller.paidAt ? 'paga' : 'não marcada como paga'}`).join('\n')].join('\n\n'));
      return;
    } else if ((match = body.match(/^pagar\s+comiss[aã]o\s+(\S+)\s+(\d+)$/i))) {
      const period = periodKey(match[1]);
      const position = Number(match[2]);
      const closing = await readFinancialClosing(userId, period);
      const seller = closing.sellers[position - 1];
      if (!seller || Number(seller.amount) <= 0) throw new FinancialOperationError('Selecione uma comissão positiva do fechamento.');
      action = { kind: 'paid', period, position };
      preview = `Marcar comissão de *${seller.seller.name}* como PAGA: *${formatCurrency(Number(seller.amount))}*.\nIsto registra um pagamento já realizado; não transfere dinheiro.`;
    } else if ((match = body.match(/^estorno\s+(#V-\d+)$/i))) {
      const sale = await previewSaleReversal({ actorPhone: userId, operationId, saleCode: match[1].toUpperCase(), reason: '', selections: 'all' });
      await message.reply([`🧾 *ITENS DA VENDA ${sale.saleGroupCode}*`, ...sale.lines, HELP].join('\n\n'));
      return;
    } else if ((match = body.match(/^estorno\s+(#V-\d+)\s+(total|itens\s+[\d:,\s]+)\s+motivo:\s*(.+)$/i))) {
      const selections: ReversalSelection[] | 'all' = match[2].toLowerCase() === 'total' ? 'all'
        : match[2].replace(/^itens\s+/i, '').split(',').map(value => {
          const numbers = value.trim().match(/^(\d+):(\d+):(\d+)$/);
          if (!numbers) throw new FinancialOperationError('Use número:quantidade estornada:quantidade recebida.');
          return { position: Number(numbers[1]), quantity: Number(numbers[2]), returnedQuantity: Number(numbers[3]) };
        });
      const request = { actorPhone: userId, operationId, saleCode: match[1].toUpperCase(), reason: match[3], selections };
      const sale = await previewSaleReversal(request);
      action = { kind: 'reversal', request: { ...request, selections: sale.selections, expectedAmounts: sale.expectedAmounts } };
      preview = [`↩️ *ESTORNO — CONFIRMAR*`, ...sale.lines, `Total: *${formatCurrency(sale.amount)}*`,
        'Só as quantidades informadas como recebidas voltarão ao estoque.', `Motivo: ${request.reason}`].join('\n\n');
    } else if ((match = body.match(/^retorno\s+estorno\s+(#E-\d+)\s+(\d+)\s+(\d+)$/i))) {
      const reversalCode = match[1].toUpperCase();
      const reversal = await readSaleReversal(userId, reversalCode);
      const position = Number(match[2]);
      const quantity = Number(match[3]);
      const item = reversal.items.find(item => item.position === position);
      if (!item || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        item.returns.reduce((sum, returned) => sum + returned.quantity, 0) + quantity > item.quantity) {
        throw new FinancialOperationError('Quantidade de devolução indisponível.');
      }
      action = { kind: 'return', request: { actorPhone: userId, operationId, reversalCode, position, quantity } };
      preview = `📦 Receber *${quantity} un.* de ${item.movement.product.reference} — ${item.movement.product.description}.\nO recebimento altera somente o estoque; não cria outro estorno financeiro.`;
    } else {
      await message.reply(HELP);
      return;
    }
    saveFinancialSession(userId, chatId, action);
    await message.reply(`${preview}\n\nDigite *confirmar* ou *cancelar*.`);
  } catch (error) {
    if (!(error instanceof FinancialOperationError)) throw error;
    await message.reply(error.message);
  }
}

export async function handleFinancialConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const action = getFinancialSession(userId, chatId);
  if (!action) return false;
  try {
    await assertFinancialAdministrator(userId);
    const confirmation = parseConfirmationAction(body.trim().toLowerCase());
    if (confirmation === 'cancel' || confirmation === 'back') {
      clearFinancialSession(userId, chatId);
      await message.reply('❌ Operação financeira cancelada.');
      return true;
    }
    if (confirmation !== 'confirm') {
      await message.reply('Responda *confirmar* ou *cancelar* antes de iniciar outra operação.');
      return true;
    }
    let result: string;
    switch (action.kind) {
      case 'reversal': {
        const reversal = await registerSaleReversal(action.request);
        result = `✅ *ESTORNO REGISTRADO ${reversal.code}*\nVenda: ${reversal.saleGroupCode}\nValor: ${formatCurrency(Number(reversal.amount))}\nA comissão será ajustada no fechamento, preservando o original.`;
        break;
      }
      case 'return':
        await registerReversalReturn(action.request);
        result = '✅ Devolução física registrada. O estoque foi atualizado uma única vez.';
        break;
      case 'close': {
        const closing = await closeFinancialMonth(userId, action.period, action.hash);
        result = `✅ *FECHAMENTO REGISTRADO*\n\n${closing.financialText}\n\n${closing.commissionText}`;
        break;
      }
      case 'paid':
        await markClosingCommissionPaid(userId, action.period, action.position);
        result = '✅ Comissão marcada como paga. Os valores do fechamento foram preservados.';
        break;
    }
    clearFinancialSession(userId, chatId);
    await runPostCommitTask('financial operation confirmation', () => message.reply(result));
  } catch (error) {
    if (error instanceof FinancialOperationError) {
      clearFinancialSession(userId, chatId);
      await message.reply(error.message);
    } else {
      console.error('[FINANCIAL] Operation failed; retaining its operation key for a safe retry.');
      await runPostCommitTask('financial retry notice', () => message.reply('Não foi possível confirmar o resultado. Envie *confirmar* novamente para conferir a mesma operação, sem iniciar outra.'));
    }
  }
  return true;
}
