export function isConfirmationResponse(value: string): boolean {
  return /^(confirmar|confirma)$/i.test(value.trim());
}

export function isCancellationResponse(value: string): boolean {
  return /^(cancelar|cancela)$/i.test(value.trim());
}

export function isBackResponse(value: string): boolean {
  return /^voltar$/i.test(value.trim());
}

export type ConfirmationAction = 'confirm' | 'back' | 'cancel';

export function parseConfirmationAction(value: string): ConfirmationAction | null {
  const normalized = value.trim();

  if (normalized === '1' || isConfirmationResponse(normalized)) {
    return 'confirm';
  }

  if (normalized === '2' || isBackResponse(normalized)) {
    return 'back';
  }

  if (normalized === '0' || isCancellationResponse(normalized)) {
    return 'cancel';
  }

  return null;
}

export function formatConfirmationOptions(): string {
  return [
    '1️⃣ ✅ Confirmar',
    '2️⃣ ↩️ Voltar',
    '0️⃣ ❌ Cancelar',
  ].join('\n');
}

export function formatOperationConfirmation(
  title: string,
  sections: ReadonlyArray<ReadonlyArray<string>>
): string {
  const content = sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) => [
      ...(index > 0 ? [''] : []),
      ...section,
    ]);

  return [
    title,
    '',
    ...content,
    '',
    formatConfirmationOptions(),
  ].join('\n');
}
