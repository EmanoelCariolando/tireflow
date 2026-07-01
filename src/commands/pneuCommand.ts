import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';

/**
 * Pneu Command - Fase 2 (Consulta fake)
 * 
 * Responsibilities:
 * - Detect "pneu <medida>"
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of fake matching products
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation.
 * Does NOT implement venda, entrada, etc. (Fase 3+)
 */

interface FakeProduct extends QueriedProduct {
  reference: string;
}

// Fake product list for Fase 2 only.
// This will be replaced by real DB query in Fase 6.
const fakeProducts: FakeProduct[] = [
  {
    reference: '175/70 R14',
    description: 'SpeedMax Street MH01',
    stock: 12,
    cashPrice: 320,
    creditPrice: 350,
  },
  {
    reference: '175/70 R14',
    description: 'Pirelli Cinturato P7',
    stock: 8,
    cashPrice: 395,
    creditPrice: 430,
  },
  {
    reference: '175/70 R14',
    description: 'Goodyear Assurance',
    stock: 15,
    cashPrice: 380,
    creditPrice: 410,
  },
  {
    reference: '195/65 R15',
    description: 'Michelin Primacy 4',
    stock: 20,
    cashPrice: 450,
    creditPrice: 490,
  },
  {
    reference: '195/65 R15',
    description: 'Continental PremiumContact 6',
    stock: 5,
    cashPrice: 470,
    creditPrice: 510,
  },
];

function formatPrice(value: number): string {
  return `R$${value.toFixed(2).replace('.', ',')}`;
}

function formatProductList(products: FakeProduct[], normalized: string): string {
  let text = `🛞 ${normalized}\n\n`;

  products.forEach((product, index) => {
    const num = index + 1;
    text += `${num}️⃣ ${product.description}\n`;
    text += `📦 Estoque: ${product.stock}\n`;
    text += `💰 À vista: ${formatPrice(product.cashPrice)}\n`;
    text += `💳 A prazo: ${formatPrice(product.creditPrice)}\n`;

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  text += '\nPara vender:\nvenda 1 5';

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
    saveLastQuery(message.from, normalized, matches);

    const response = formatProductList(matches, normalized);
    await message.reply(response);

    console.log(`[PNEU] ${message.from} → ${normalized} (${matches.length} produtos)`);
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('Ocorreu um erro ao consultar os pneus. Tente novamente.');
  }
}
