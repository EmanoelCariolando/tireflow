import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBackResponse,
  isCancellationResponse,
  isConfirmationResponse,
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
