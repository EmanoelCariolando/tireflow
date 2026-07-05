export type MovementCodePrefix = 'V' | 'E' | 'A' | 'P';

export function generateMovementCode(prefix: MovementCodePrefix, sequence: number): string {
  return `#${prefix}-${String(sequence).padStart(6, '0')}`;
}
