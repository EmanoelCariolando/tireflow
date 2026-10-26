const offlineError = () => new Error('Network and real WhatsApp operations are disabled in tests.');
const disabled = () => { throw offlineError(); };
globalThis.fetch = async () => disabled();
require('node:net').Socket.prototype.connect = function () {
  // Match net's asynchronous errors so tsx can abandon its optional IPC connection.
  process.nextTick(() => this.destroy(offlineError()));
  return this;
};
for (const module of [require('node:http'), require('node:https')]) {
  module.request = disabled;
  module.get = disabled;
}
const { Client, Message } = require('whatsapp-web.js');
for (const method of ['initialize', 'sendMessage', 'getNumberId', 'getMessageById', 'getPinnedMessages']) {
  Client.prototype[method] = async () => disabled();
}
for (const method of ['reply', 'forward', 'downloadMedia', 'pin', 'unpin']) Message.prototype[method] = async () => disabled();
