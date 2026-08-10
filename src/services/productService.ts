import type { Product } from '@prisma/client';
import { productRepository } from '../repositories/productRepository.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { hasProductImageFile } from './productPhotoStorage.js';

type ProductQueryRow = Pick<
  Product,
  | 'id'
  | 'reference'
  | 'description'
  | 'stock'
  | 'stockLocation'
  | 'cashPrice'
  | 'creditPrice'
  | 'imagePath'
>;

function mapProductToQueryResult(product: ProductQueryRow): QueriedProduct {
  return {
    id: product.id,
    reference: product.reference,
    description: product.description,
    stock: product.stock,
    stockLocation: product.stockLocation,
    cashPrice: Number(product.cashPrice),
    creditPrice: Number(product.creditPrice),
    hasPhoto: hasProductImageFile(product.imagePath),
  };
}

function addCandidate(candidates: Set<string>, reference: string): void {
  const value = reference.trim();
  if (value) candidates.add(value);
}

function buildNumericFirstPartVariants(first: string): string[] {
  const variants = new Set([first]);
  const integerMatch = first.match(/^\d{1,4}$/);

  if (integerMatch) {
    const numericValue = Number(first);

    if (first.length <= 2) {
      variants.add(`${first}.00`);
      if (numericValue >= 5 && numericValue <= 19) {
        variants.add(`${first}00`);
      }
    } else {
      const whole = first.slice(0, -2);
      const fraction = first.slice(-2);
      const wholeValue = Number(whole);

      // Commercial sizes such as 600, 900 and 1400 are shorthand for
      // 6.00, 9.00 and 14.00. Restrict the range to avoid treating metric
      // widths such as 185 or 205 as decimal sizes.
      if (wholeValue >= 5 && wholeValue <= 19) {
        variants.add(`${whole}.${fraction}`);
      }
    }
  }

  const decimalMatch = first.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (decimalMatch) {
    const [, whole, rawFraction] = decimalMatch;
    const fraction = rawFraction.padEnd(2, '0');
    variants.add(`${whole}.${fraction}`);

    const wholeValue = Number(whole);
    if (wholeValue >= 5 && wholeValue <= 19) {
      variants.add(`${whole}${fraction}`);
    }
  }

  return [...variants];
}

export function buildReferenceCandidates(reference: string): string[] {
  const candidates = new Set<string>();
  addCandidate(candidates, reference);

  const metricMatch = reference.match(
    /^(\d{3})\/(\d{2}) R(\d{2}(?:\.\d)?)([A-Z]?)$/
  );
  if (metricMatch) {
    const [, width, height, rim, suffix] = metricMatch;
    const addMetricFormats = (rimSuffix: string) => {
      addCandidate(candidates, `${width}/${height} R${rim}${rimSuffix}`);
      addCandidate(candidates, `${width}/${height}R${rim}${rimSuffix}`);
      addCandidate(candidates, `${width}/${height}/${rim}${rimSuffix}`);
      addCandidate(candidates, `${width}/${height}-${rim}${rimSuffix}`);
    };

    addMetricFormats(suffix);

    // A size without a suffix represents the complete geometric measure.
    // Include its commercial/load "C" variant, but keep an explicit C query strict.
    if (!suffix) {
      addMetricFormats('C');
    }
  }

  const threePartMatch = reference.match(/^(\d{1,2}(?:\.\d{1,2})?)\/(\d{2})([\/\-])(\d{2}(?:\.\d)?)$/);
  if (threePartMatch) {
    const [, width, height, , rim] = threePartMatch;
    addCandidate(candidates, `${width}/${height}/${rim}`);
    addCandidate(candidates, `${width}/${height}-${rim}`);
    addCandidate(candidates, `${width}/${height} R${rim}`);
  }

  const twoPartMatch = reference.match(
    /^(\d{1,4}(?:\.\d{1,2})?[A-Z]?)[\/\-](\d{1,2}(?:\.\d)?)$/
  );
  if (twoPartMatch) {
    const [, first, second] = twoPartMatch;

    for (const firstVariant of buildNumericFirstPartVariants(first)) {
      addCandidate(candidates, `${firstVariant}/${second}`);
      addCandidate(candidates, `${firstVariant}-${second}`);
    }

    const dottedFirstMatch = first.match(/^(\d{1,2}\.\d)(?:0)?$/);
    if (dottedFirstMatch && !dottedFirstMatch[1].endsWith('.0')) {
      addCandidate(candidates, `${dottedFirstMatch[1]}.${second}`);
    }
  }

  const dottedBiasMatch = reference.match(/^(\d{1,2}\.\d)\.(\d{2})$/);
  if (dottedBiasMatch) {
    addCandidate(candidates, `${dottedBiasMatch[1]}/${dottedBiasMatch[2]}`);
  }

  return [...candidates];
}

function buildReferenceSignature(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/R/g, '')
    .replace(/[^0-9A-Z]/g, '');
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function rankReferenceSuggestions(
  input: string,
  references: string[],
  limit = 3
): string[] {
  const inputSignature = buildReferenceSignature(input);
  const digitCount = (inputSignature.match(/\d/g) ?? []).length;

  if (digitCount < 4 || limit <= 0) {
    return [];
  }

  const inputRequestsCommercial = inputSignature.endsWith('C');
  const maxDistance = inputSignature.length <= 7 ? 2 : 3;
  const bestByGeometricMeasure = new Map<
    string,
    { reference: string; distance: number }
  >();

  for (const reference of new Set(references)) {
    const signature = buildReferenceSignature(reference);
    if (!signature) continue;

    const referenceIsCommercial = signature.endsWith('C');
    if (inputRequestsCommercial && !referenceIsCommercial) continue;

    const distance = levenshteinDistance(inputSignature, signature);
    if (distance > maxDistance) continue;

    const geometricKey = signature.replace(/C$/, '');
    const existing = bestByGeometricMeasure.get(geometricKey);
    const shouldReplace =
      !existing ||
      distance < existing.distance ||
      (distance === existing.distance &&
        reference.localeCompare(existing.reference, 'pt-BR') < 0);

    if (shouldReplace) {
      bestByGeometricMeasure.set(geometricKey, { reference, distance });
    }
  }

  return [...bestByGeometricMeasure.values()]
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.reference.localeCompare(right.reference, 'pt-BR')
    )
    .slice(0, limit)
    .map((suggestion) => suggestion.reference);
}

export async function findSuggestedActiveReferences(
  input: string,
  limit = 3
): Promise<string[]> {
  const signature = buildReferenceSignature(input);
  if ((signature.match(/\d/g) ?? []).length < 4) {
    return [];
  }

  const references = await productRepository.findDistinctActiveReferences();
  return rankReferenceSuggestions(
    input,
    references.map((product) => product.reference),
    limit
  );
}

export async function findAvailableProductsByReference(reference: string): Promise<QueriedProduct[]> {
  const products = await productRepository.findAvailableByReferences(buildReferenceCandidates(reference));
  return products.map(mapProductToQueryResult);
}

export async function findActiveProductsByReference(reference: string): Promise<QueriedProduct[]> {
  const products = await productRepository.findActiveByReferences(buildReferenceCandidates(reference));
  return products.map(mapProductToQueryResult);
}
