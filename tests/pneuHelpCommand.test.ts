import assert from 'node:assert/strict';
import test from 'node:test';
import { Message } from 'whatsapp-web.js';
import {
  formatProductList,
  handlePneuHelpCommand,
  isPneuHelpCommand,
} from '../src/commands/pneuCommand.js';

test('accepts both pneu and pneus as the tire command help', () => {
  assert.equal(isPneuHelpCommand('pneu'), true);
  assert.equal(isPneuHelpCommand('PNEUS'), true);
  assert.equal(isPneuHelpCommand('pneu 175/70 R14'), false);
});

test('explains foto and addfoto in the tire command help', async () => {
  let replyText = '';
  const message = {
    reply: async (text: string) => {
      replyText = text;
    },
  } as unknown as Message;

  await handlePneuHelpCommand(message);

  assert.match(replyText, /foto <número>\n↳ Mostra a foto cadastrada/);
  assert.match(replyText, /addfoto <número>\n↳ Adiciona uma foto ou substitui a foto atual/);
  assert.match(replyText, /Depois do comando, envie a imagem solicitada/);
  assert.match(replyText, /O número é a posição do produto na última consulta/);
});

test('shows the camera only beside products whose photo file exists', () => {
  const text = formatProductList(
    [
      {
        id: 'with-photo',
        reference: '175/70 R14',
        description: 'APOLO AMAZER 84T',
        stock: 1,
        cashPrice: 349.5,
        creditPrice: 366,
        hasPhoto: true,
      },
      {
        id: 'without-photo',
        reference: '175/70 R14',
        description: 'DYNAMO STREET-H MH01 84T',
        stock: 23,
        cashPrice: 319,
        creditPrice: 334.95,
        hasPhoto: false,
      },
    ],
    '175/70 R14'
  );

  assert.match(text, /APOLO AMAZER 84T[\s\S]*A prazo: R\$366,00\n📷/);
  assert.doesNotMatch(text, /DYNAMO STREET-H MH01 84T[\s\S]*A prazo: R\$334,95\n📷/);
  assert.equal((text.match(/📷/g) ?? []).length, 1);
});
