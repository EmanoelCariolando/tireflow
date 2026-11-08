export function getFinancialPeriod(key: string): { key: string; start: Date; end: Date } {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(key)) throw new Error('Use um mês no formato MM/AAAA.');
  const [year, month] = key.split('-').map(Number);
  // TireFlow operates in São Paulo; financial periods start at local midnight.
  const start = new Date(`${key}-01T00:00:00-03:00`);
  const next = new Date(Date.UTC(year, month, 1, 3));
  return { key, start, end: next };
}

export function getFinancialMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}
