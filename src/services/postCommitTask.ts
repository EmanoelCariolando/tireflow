/** Runs notifications/replies after a committed movement without undoing business data on failure. */
export async function runPostCommitTask(
  label: string,
  task: () => Promise<unknown>,
  timeoutMs = 30_000
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs
        );
      }),
    ]);
    return true;
  } catch (error) {
    console.error(`[POST_COMMIT] ${label} failed; committed data was preserved.`, error);
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
