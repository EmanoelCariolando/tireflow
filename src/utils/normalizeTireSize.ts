/**
 * Normalize tire size input to canonical format "175/70 R14".
 * 
 * Fase 2 requirement.
 * 
 * Accepts variations:
 * - 175/70/14
 * - 175 70 14
 * - 175-70-14
 * - 175/70 R14
 * - 175/70R14
 */
export function normalizeTireSize(input: string): string | null {
  if (!input || typeof input !== 'string') return null;

  // Clean: keep digits, letters, separators
  let cleaned = input.trim().toUpperCase().replace(/[^0-9A-Z\/\- R]/g, '');

  // Match width / height / rim
  const match = cleaned.match(/(\d{3})\s*[\/\- ]?\s*(\d{2})\s*[\/\- ]?\s*(?:R\s*)?(\d{2})/);

  if (!match) {
    return null;
  }

  const width = match[1];
  const height = match[2];
  const rim = match[3];

  return `${width}/${height} R${rim}`;
}
