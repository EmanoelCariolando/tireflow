export function isConfirmationResponse(value: string): boolean {
  return /^(confirmar|confirma)$/i.test(value.trim());
}

export function isCancellationResponse(value: string): boolean {
  return /^(cancelar|cancela)$/i.test(value.trim());
}
