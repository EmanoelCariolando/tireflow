export function parseBinaryResponse(value: string): boolean | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === '1' || normalized === 's' || normalized === 'sim') return true;
  if (normalized === '2' || normalized === 'n' || normalized === 'nao') return false;
  return null;
}

export function formatBinaryOptions(): string {
  return '1️⃣*Sim* | 2️⃣*Não*';
}
