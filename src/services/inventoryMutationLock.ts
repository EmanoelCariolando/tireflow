let pendingMutation: Promise<void> = Promise.resolve();

/**
 * SQLite allows a single writer. TireFlow runs one service instance and serializes
 * stock/price mutations to avoid lock races and count-based movement collisions.
 */
export async function withInventoryMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previousMutation = pendingMutation;
  let releaseCurrentMutation!: () => void;
  pendingMutation = new Promise<void>((resolve) => {
    releaseCurrentMutation = resolve;
  });

  await previousMutation;
  try {
    return await operation();
  } finally {
    releaseCurrentMutation();
  }
}
