import type { PaymentBreakdownPart } from './saleSessionStore.js';

export function allocateAmountByWeights(
  amountInCents: number,
  weightsInCents: number[]
): number[] {
  if (
    !Number.isSafeInteger(amountInCents) ||
    amountInCents < 0 ||
    weightsInCents.length === 0 ||
    weightsInCents.some((weight) => !Number.isSafeInteger(weight) || weight < 0)
  ) {
    throw new Error('Invalid amount allocation.');
  }

  const totalWeight = weightsInCents.reduce((total, weight) => total + weight, 0);
  if (totalWeight === 0) {
    if (amountInCents === 0) {
      return weightsInCents.map(() => 0);
    }
    throw new Error('Cannot allocate a positive amount without positive weights.');
  }
  const exactAllocations = weightsInCents.map((weight) => amountInCents * weight / totalWeight);
  const allocations = exactAllocations.map(Math.floor);
  const remainder = amountInCents - allocations.reduce((total, value) => total + value, 0);

  const remainderOrder = exactAllocations
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let index = 0; index < remainder; index += 1) {
    allocations[remainderOrder[index % remainderOrder.length]!.index] += 1;
  }

  return allocations;
}

export function allocatePaymentBreakdownAcrossTotals(
  breakdown: PaymentBreakdownPart[],
  itemTotalsInCents: number[]
): PaymentBreakdownPart[][] {
  const remainingParts = breakdown.map((part) => ({
    method: part.method,
    amountInCents: Math.round(part.amount * 100),
  }));
  const breakdownTotal = remainingParts.reduce((total, part) => total + part.amountInCents, 0);
  const itemsTotal = itemTotalsInCents.reduce((total, value) => total + value, 0);

  if (
    breakdown.length === 0 ||
    itemTotalsInCents.length === 0 ||
    itemTotalsInCents.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    remainingParts.some((part) => part.amountInCents <= 0) ||
    breakdownTotal !== itemsTotal
  ) {
    throw new Error('Invalid payment breakdown allocation.');
  }

  let paymentIndex = 0;
  return itemTotalsInCents.map((itemTotal) => {
    let remainingItemTotal = itemTotal;
    const itemBreakdown: PaymentBreakdownPart[] = [];

    while (remainingItemTotal > 0) {
      const payment = remainingParts[paymentIndex];
      if (!payment) {
        throw new Error('Payment breakdown is smaller than the sale total.');
      }

      const allocated = Math.min(remainingItemTotal, payment.amountInCents);
      if (allocated > 0) {
        itemBreakdown.push({ method: payment.method, amount: allocated / 100 });
        remainingItemTotal -= allocated;
        payment.amountInCents -= allocated;
      }

      if (payment.amountInCents === 0) {
        paymentIndex += 1;
      }
    }

    return itemBreakdown;
  });
}
