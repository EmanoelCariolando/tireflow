/**
 * Formata valores monetários no padrão usado nas mensagens do bot.
 */
export function formatCurrency(value: number): string {
  return `R$${value.toFixed(2).replace('.', ',')}`;
}
