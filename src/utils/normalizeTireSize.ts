/**
 * Normalize tire size input to the reference format used by the product table.
 * 
 * Fase 2 requirement.
 * 
 * Accepts variations:
 * - 175/70/14
 * - 175 70 14
 * - 175-70-14
 * - 175/70 R14
 * - 175/70R14
 * - 275/80 R22.5
 * - 18.4/34
 * - 14.00/24
 * - 12.5/80-18
 * - 6.00-9
 * - 31X10.50R15
 * - RODA
 * - AGRICOLA
 */
export function normalizeTireSize(input: string): string | null {
  if (!input || typeof input !== 'string') return null;

  // Clean: keep digits, letters and tire-size separators.
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(',', '.')
    .replace(/[^0-9A-Z\/\-\. X R]/g, '')
    .replace(/\s+/g, ' ');

  if (cleaned === 'RODA' || cleaned === 'AGRICOLA') {
    return cleaned;
  }

  const flotationMatch = cleaned.match(/^(\d{2})\s*X\s*(\d{1,2}(?:\.\d{1,2})?)\s*R\s*(\d{2}(?:\.\d)?[A-Z]?)$/);
  if (flotationMatch) {
    return `${flotationMatch[1]}X${flotationMatch[2]}R${flotationMatch[3]}`;
  }

  const metricWithRMatch = cleaned.match(/^(\d{3})\s*[\/\- ]?\s*(\d{2})\s*(?:[\/\- ]?\s*)?R\s*(\d{2}(?:\.\d)?[A-Z]?)$/);
  if (metricWithRMatch) {
    return `${metricWithRMatch[1]}/${metricWithRMatch[2]} R${metricWithRMatch[3]}`;
  }

  const metricWithoutRMatch = cleaned.match(/^(\d{3})\s*[\/\- ]\s*(\d{2})\s*[\/\- ]\s*(\d{2}(?:\.\d)?[A-Z]?)$/);
  if (metricWithoutRMatch) {
    return `${metricWithoutRMatch[1]}/${metricWithoutRMatch[2]} R${metricWithoutRMatch[3]}`;
  }

  const compactMetricMatch = cleaned.match(/^(\d{3})(\d{2})(\d{2}(?:\.\d)?[A-Z]?)$/);
  if (compactMetricMatch) {
    return `${compactMetricMatch[1]}/${compactMetricMatch[2]} R${compactMetricMatch[3]}`;
  }

  const metricWithoutAspectMatch = cleaned.match(/^(\d{3})\s*R\s*(\d{2}(?:\.\d)?[A-Z]?)$/);
  if (metricWithoutAspectMatch) {
    return `${metricWithoutAspectMatch[1]} R${metricWithoutAspectMatch[2]}`;
  }

  const threePartWithRMatch = cleaned.match(/^(\d{1,2}(?:\.\d{1,2})?)\s*[\/\- ]\s*(\d{2})\s*(?:[\/\- ]?\s*)?R\s*(\d{2}(?:\.\d)?)$/);
  if (threePartWithRMatch) {
    return `${threePartWithRMatch[1]}/${threePartWithRMatch[2]} R${threePartWithRMatch[3]}`;
  }

  const threePartMatch = cleaned.match(/^(\d{1,2}(?:\.\d{1,2})?)\s*[\/ ]\s*(\d{2})\s*([\/\- ])\s*(\d{2}(?:\.\d)?)$/);
  if (threePartMatch) {
    const separator = threePartMatch[3] === '-' ? '-' : '/';
    return `${threePartMatch[1]}/${threePartMatch[2]}${separator}${threePartMatch[4]}`;
  }

  const dottedBiasMatch = cleaned.match(/^(\d{1,2}\.\d)\.(\d{2})$/);
  if (dottedBiasMatch) {
    return `${dottedBiasMatch[1]}.${dottedBiasMatch[2]}`;
  }

  const twoPartMatch = cleaned.match(/^(\d{1,4}(?:\.\d{1,2})?[A-Z]?)\s*([\/\- ])\s*(\d{1,2}(?:\.\d)?)$/);
  if (twoPartMatch) {
    const separator = twoPartMatch[2] === '-' ? '-' : '/';
    return `${twoPartMatch[1]}${separator}${twoPartMatch[3]}`;
  }

  const singleNumberMatch = cleaned.match(/^\d{3,4}$/);
  if (singleNumberMatch) {
    return cleaned;
  }

  return null;
}
