// Os códigos continuam sendo gerados e salvos; esta chave controla apenas sua exibição.
const MOVEMENT_NUMBERS_IN_MESSAGES_ENABLED = false;

export function formatMovementNumberMessage(
  enabledText: string,
  disabledText?: string
): string[] {
  const text = MOVEMENT_NUMBERS_IN_MESSAGES_ENABLED ? enabledText : disabledText;
  return text ? [text] : [];
}
