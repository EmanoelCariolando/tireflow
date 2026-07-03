import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageUserId } from '../utils/messageContext.js';

/**
 * Pneu Command - Fase 2 (Consulta fake)
 * 
 * Responsibilities:
 * - Detect "pneu <medida>"
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of fake matching products
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation by itself.
 * Sale is handled by saleCommand in Fase 3.
 */

// Fake product list used until the real database query is implemented.
// This will be replaced by real DB query in Fase 6.
const fakeProducts: QueriedProduct[] = [
  {
    id: 'p1',
    reference: '175/70 R14',
    description: 'SpeedMax Street MH01',
    stock: 12,
    cashPrice: 320,
    creditPrice: 350,
  },
  {
    id: 'p2',
    reference: '175/70 R14',
    description: 'Pirelli Cinturato P7',
    stock: 8,
    cashPrice: 395,
    creditPrice: 430,
  },
  {
    id: 'p3',
    reference: '175/70 R14',
    description: 'Goodyear Assurance',
    stock: 15,
    cashPrice: 380,
    creditPrice: 410,
  },
  {
    id: 'p4',
    reference: '195/65 R15',
    description: 'Michelin Primacy 4',
    stock: 20,
    cashPrice: 450,
    creditPrice: 490,
  },
  {
    id: 'p5',
    reference: '195/65 R15',
    description: 'Continental PremiumContact 6',
    stock: 5,
    cashPrice: 470,
    creditPrice: 510,
  },
];

export function getFakeProductById(productId: string): QueriedProduct | null {
  return fakeProducts.find((product) => product.id === productId) || null;
}

export function decreaseFakeProductStock(productId: string, quantity: number): QueriedProduct | null {
  const product = getFakeProductById(productId);

  if (!product || product.stock < quantity) {
    return null;
  }

  product.stock -= quantity;
  return product;
}

function formatProductList(products: QueriedProduct[], normalized: string): string {
  let text = `🛞 ${normalized}\n\n`;

  products.forEach((product, index) => {
    const num = index + 1;
    text += `${num}️⃣ ${product.description}\n`;
    text += `📦 Estoque: ${product.stock}\n`;
    text += `💰 À vista: ${formatCurrency(product.cashPrice)}\n`;
    text += `💳 A prazo: ${formatCurrency(product.creditPrice)}\n`;

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  text += '\nPara vender digite:\nvenda 1 5';

  return text;
}

export function isPneuCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized.startsWith('pneu ');
}

export async function handlePneuCommand(message: Message, rawMeasure: string): Promise<void> {
  try {
    const normalized = normalizeTireSize(rawMeasure);

    if (!normalized) {
      await message.reply('Medida inválida. Exemplo: pneu 175/70 R14');
      return;
    }

    const matches = fakeProducts.filter((p) => p.reference === normalized);

    if (matches.length === 0) {
      await message.reply(`Nenhum pneu encontrado para ${normalized}.`);
      return;
    }

    // Save last consultation (5 minute TTL) - required for Fase 2
    saveLastQuery(getMessageUserId(message), normalized, matches);

    const response = formatProductList(matches, normalized);
    await message.reply(response);

    console.log(`[PNEU] ${message.from} → ${normalized} (${matches.length} produtos)`);
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('Ocorreu um erro ao consultar os pneus. Tente novamente.');
  }
}
