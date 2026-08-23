import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatConfirmationOptions,
  formatOperationConfirmation,
  isBackResponse,
  isCancellationResponse,
  isConfirmationResponse,
  parseConfirmationAction,
} from '../src/utils/operationResponse.js';

test('accepts both infinitive and conversational confirmation words', () => {
  assert.equal(isConfirmationResponse('confirmar'), true);
  assert.equal(isConfirmationResponse('CONFIRMA'), true);
  assert.equal(isConfirmationResponse(' confirma '), true);
  assert.equal(isConfirmationResponse('confirmado'), false);
  assert.equal(isConfirmationResponse('sim'), false);
});

test('accepts both infinitive and conversational cancellation words', () => {
  assert.equal(isCancellationResponse('cancelar'), true);
  assert.equal(isCancellationResponse('CANCELA'), true);
  assert.equal(isCancellationResponse(' cancela '), true);
  assert.equal(isCancellationResponse('cancelado'), false);
  assert.equal(isCancellationResponse('não'), false);
});

test('recognizes only voltar as the safe back command', () => {
  assert.equal(isBackResponse('voltar'), true);
  assert.equal(isBackResponse(' VOLTAR '), true);
  assert.equal(isBackResponse('cancelar'), false);
  assert.equal(isBackResponse('volta'), false);
});

test('parses numeric shortcuts only in confirmation context', () => {
  assert.equal(parseConfirmationAction('1'), 'confirm');
  assert.equal(parseConfirmationAction('confirmar'), 'confirm');
  assert.equal(parseConfirmationAction('2'), 'back');
  assert.equal(parseConfirmationAction('voltar'), 'back');
  assert.equal(parseConfirmationAction('0'), 'cancel');
  assert.equal(parseConfirmationAction('cancelar'), 'cancel');
  assert.equal(parseConfirmationAction('sim'), null);

  assert.equal(isConfirmationResponse('1'), false);
  assert.equal(isBackResponse('2'), false);
  assert.equal(isCancellationResponse('0'), false);
});

test('formats the standard confirmation actions', () => {
  assert.equal(
    formatConfirmationOptions(),
    '1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar'
  );
});

test('formats confirmation content in consistently separated sections', () => {
  assert.equal(
    formatOperationConfirmation('🧾 *TESTE — CONFIRMAR*', [
      ['Primeira linha', 'Segunda linha'],
      [],
      ['Última linha'],
    ]),
    '🧾 *TESTE — CONFIRMAR*\n\nPrimeira linha\nSegunda linha\n\nÚltima linha\n\n' +
      '1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar'
  );
});
