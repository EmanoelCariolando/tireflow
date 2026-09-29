import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync('node_modules/whatsapp-web.js/src/util/Injected/Utils.js', 'utf8');
const start = source.indexOf('        const message = {');
const end = source.indexOf("        // Bot's won't reply", start);
assert.ok(start >= 0 && end > start);
const construction = source.slice(start, end);

function construct(mediaOptions: object, code = construction) {
  const key = { id: 'outgoing-message', from: 'sender', to: 'group' };
  const result = runInNewContext(`${code}\nmessage;`, {
    options: {}, newMsgKey: key, content: '', from: 'sender', chat: { id: 'group' },
    mediaOptions, ephemeralFields: {}, quotedMsgOptions: { quotedStanzaID: 'confirmation' },
    locationOptions: {}, pollOptions: {}, eventOptions: {}, vcardOptions: {},
    buttonOptions: {}, listOptions: {}, botOptions: {}, extraOptions: {},
  });
  // Reproduce the model's private-field precedence when initializing Msg.
  const effectiveId = Object.hasOwn(result, '__x_id') ? result.__x_id : result.id;
  assert.equal(effectiveId, key, 'MediaData must not replace the outgoing message identity');
  assert.equal(result.quotedStanzaID, 'confirmation');
  return result;
}

test('PDF media retains its outgoing ID even when MediaData includes an undefined private ID', () => {
  const media = { __x_id: undefined, toJSON: () => ({ type: 'document', mimetype: 'application/pdf', filehash: 'hash' }) };
  assert.throws(() => construct(media, construction.replace('delete message.__x_id;', '')), /must not replace/);
  const message = construct(media);
  assert.equal(message.mimetype, 'application/pdf');
  assert.equal(message.filehash, 'hash');
  assert.equal(Object.hasOwn(message, '__x_id'), false);
});

test('private media IDs are removed for images and plain text retains its ID', () => {
  assert.equal(construct({ __x_id: 'media-id', toJSON: () => ({ type: 'image' }) }).type, 'image');
  assert.equal(construct({}).type, 'chat');
});
