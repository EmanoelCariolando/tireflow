import type { Product } from '@prisma/client';
import { productRepository } from '../repositories/productRepository.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';

function mapProductToQueryResult(product: Product): QueriedProduct {
  return {
    id: product.id,
    reference: product.reference,
    description: product.description,
    stock: product.stock,
    cashPrice: Number(product.cashPrice),
    creditPrice: Number(product.creditPrice),
  };
}

function addCandidate(candidates: Set<string>, reference: string): void {
  const value = reference.trim();
  if (value) candidates.add(value);
}

function buildReferenceCandidates(reference: string): string[] {
  const candidates = new Set<string>();
  addCandidate(candidates, reference);

  const threePartMatch = reference.match(/^(\d{1,2}(?:\.\d{1,2})?)\/(\d{2})([\/\-])(\d{2}(?:\.\d)?)$/);
  if (threePartMatch) {
    const [, width, height, , rim] = threePartMatch;
    addCandidate(candidates, `${width}/${height}/${rim}`);
    addCandidate(candidates, `${width}/${height}-${rim}`);
    addCandidate(candidates, `${width}/${height} R${rim}`);
  }

  const twoPartSlashMatch = reference.match(/^(\d{1,4}(?:\.\d{1,2})?[A-Z]?)\/(\d{1,2}(?:\.\d)?)$/);
  if (twoPartSlashMatch) {
    const [, first, second] = twoPartSlashMatch;
    addCandidate(candidates, `${first}-${second}`);

    if (/^\d{1,2}\.\d$/.test(first)) {
      addCandidate(candidates, `${first}.${second}`);
    }

    if (/^\d{1,2}$/.test(first)) {
      addCandidate(candidates, `${first}.00/${second}`);
      addCandidate(candidates, `${first}.00-${second}`);
    }
  }

  const twoPartHyphenMatch = reference.match(/^(\d{1,4}(?:\.\d{1,2})?[A-Z]?)-(\d{1,2}(?:\.\d)?)$/);
  if (twoPartHyphenMatch) {
    const [, first, second] = twoPartHyphenMatch;
    addCandidate(candidates, `${first}/${second}`);

    if (/^\d{1,2}$/.test(first)) {
      addCandidate(candidates, `${first}.00/${second}`);
      addCandidate(candidates, `${first}.00-${second}`);
    }
  }

  const dottedBiasMatch = reference.match(/^(\d{1,2}\.\d)\.(\d{2})$/);
  if (dottedBiasMatch) {
    addCandidate(candidates, `${dottedBiasMatch[1]}/${dottedBiasMatch[2]}`);
  }

  return [...candidates];
}

export async function findAvailableProductsByReference(reference: string): Promise<QueriedProduct[]> {
  const products = await productRepository.findAvailableByReferences(buildReferenceCandidates(reference));
  return products.map(mapProductToQueryResult);
}
