export function formatSupplierQuestion(): string {
  return [
    '🚚 *FORNECEDOR*',
    'Informe o fornecedor:',
  ].join('\n');
}

export function formatQuantityQuestion(): string {
  return [
    '📦 *QUANTIDADE*',
    'Quantos pneus?',
  ].join('\n');
}

export function formatCashPriceQuestion(): string {
  return [
    '💰 *PREÇO À VISTA*',
    'Digite o preço à vista:',
  ].join('\n');
}

export function formatAdditionalTireQuestion(): string {
  return [
    '➕ *ADICIONAR PNEU*',
    '*Digite a medida do outro pneu:*',
    'Ex.: *275 80 22.5*',
  ].join('\n');
}
