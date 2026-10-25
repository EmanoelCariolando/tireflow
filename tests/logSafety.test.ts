import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function run(source: string): string {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    input: source, env: process.env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  return child.stdout;
}

for (const interactive of [false, true]) test(`QR rendering requires an interactive terminal (${interactive})`, () => {
  const output = run(`
    import qrcode from 'qrcode-terminal';
    const {whatsappClient,initializeWhatsAppClient}=await import('./src/whatsapp/client.ts');
    Object.defineProperty(process.stdout,'isTTY',{value:${interactive},configurable:true});
    qrcode.generate=(_qr,_options,callback)=>callback('QR_RENDERED_MARKER');
    initializeWhatsAppClient();
    whatsappClient.emit('qr','FAKE_TEST_QR');
  `);
  assert.equal(output.includes('QR_RENDERED_MARKER'), interactive);
});

test('receipt lookup errors and logged SDK errors do not expose WhatsApp identities', () => {
  run(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const {default:env}=await import('./src/config/env.ts');
    const {LOG_DIRECTORY}=await import('./src/config/appPaths.ts');
    const {whatsappClient}=await import('./src/whatsapp/client.ts');
    const {forwardMessageToBoss}=await import('./src/services/notificationService.ts');
    env.bossPrivateNumber='5583000000098';
    whatsappClient.getNumberId=async()=>({_serialized:'5583000000098@c.us'});
    whatsappClient.getMessageById=async()=>null;
    const identifier='false_5583000000097@lid_FAKE_INTERNAL_ID';
    let lookupError;
    try { await forwardMessageToBoss(identifier); } catch(error) { lookupError=error; }
    assert.ok(lookupError);
    assert.ok(!lookupError.message.includes(identifier));
    const {installStructuredLogging}=await import('./src/services/logger.ts');
    installStructuredLogging();
    console.error(lookupError);
    console.error(new Error('SDK failed for 5583000000096@c.us and 5583000000095@lid'));
    const logs=fs.readdirSync(LOG_DIRECTORY).filter(name=>name.endsWith('.log'))
      .map(name=>fs.readFileSync(LOG_DIRECTORY+'/'+name,'utf8')).join('');
    for(const secret of [identifier,'5583000000096@c.us','5583000000095@lid']) assert.ok(!logs.includes(secret));
  `);
});

test('existing log retention runs again on the first write of a new day without restarting', () => {
  run(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const RealDate=Date;
    let now=Date.parse('2001-01-01T12:00:00Z');
    globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
    const {default:env}=await import('./src/config/env.ts');
    env.logRetentionDays=1;
    const {LOG_DIRECTORY}=await import('./src/config/appPaths.ts');
    fs.mkdirSync(LOG_DIRECTORY,{recursive:true});
    const expired=LOG_DIRECTORY+'/tireflow-2000-12-31-991.log';
    const unrelated=LOG_DIRECTORY+'/keep-admin.log';
    fs.writeFileSync(expired,'previous day'); fs.utimesSync(expired,new RealDate(now),new RealDate(now));
    fs.writeFileSync(unrelated,'keep'); fs.utimesSync(unrelated,new RealDate(0),new RealDate(0));
    const {installStructuredLogging}=await import('./src/services/logger.ts');
    installStructuredLogging(); console.log('initial');
    assert.ok(fs.existsSync(expired));
    now+=2*24*60*60*1000;
    console.log('next day');
    assert.ok(!fs.existsSync(expired)); assert.ok(fs.existsSync(unrelated));
    const invalid=LOG_DIRECTORY+'/tireflow-2000-12-31-992.log';
    fs.mkdirSync(invalid); fs.utimesSync(invalid,new RealDate(0),new RealDate(0));
    now+=24*60*60*1000;
    console.log('cleanup failure must not stop logging');
    assert.match(fs.readFileSync(LOG_DIRECTORY+'/tireflow-2001-01-04.log','utf8'),/cleanup failure/);
  `);
});
