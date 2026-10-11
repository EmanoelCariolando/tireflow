import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStartupErrorPage, isRetryableStartupFailure, startupNetworkRetryDelay,
  WhatsAppStartupPageError, type StartupPageState,
} from '../src/whatsapp/startupFailure.js';

const reportedPage: StartupPageState = {
  url: 'https://web.whatsapp.com/', title: 'Error', readyState: 'complete',
  authStore: 'undefined', wwebjs: 'undefined', require: 'undefined',
};

test('the reported boot error page triggers recovery', () => {
  assert.equal(isStartupErrorPage(reportedPage), true);
  assert.equal(isRetryableStartupFailure(new WhatsAppStartupPageError()), true);
  assert.equal(isStartupErrorPage({ ...reportedPage, url: 'chrome-error://chromewebdata/' }), true);
});

test('loading, QR pairing and synchronized pages are not mistaken for an error page', () => {
  assert.equal(isStartupErrorPage(undefined), false);
  assert.equal(isStartupErrorPage({ ...reportedPage, readyState: 'loading' }), false);
  assert.equal(isStartupErrorPage({ ...reportedPage, title: 'WhatsApp' }), false);
  assert.equal(isStartupErrorPage({ ...reportedPage, require: 'function' }), false);
  assert.equal(isStartupErrorPage({ ...reportedPage, authStore: 'available' }), false);
  assert.equal(isStartupErrorPage({ ...reportedPage, url: 'about:blank' }), false);
});

test('transient network failures retry while authentication and configuration errors surface', () => {
  for (const code of ['INTERNET_DISCONNECTED', 'NAME_NOT_RESOLVED', 'CONNECTION_REFUSED', 'NETWORK_CHANGED', 'TIMED_OUT']) {
    assert.equal(isRetryableStartupFailure(new Error(`net::ERR_${code} at https://web.whatsapp.com/`)), true);
  }
  for (const message of ['WhatsApp authentication failed', 'Chrome executable missing', 'net::ERR_CERT_AUTHORITY_INVALID', 'auth timeout']) {
    assert.equal(isRetryableStartupFailure(new Error(message)), false);
  }
});

test('repeated boot network failures back off and cap at two minutes', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 100].map(startupNetworkRetryDelay), [15000, 30000, 60000, 120000, 120000, 120000]);
});
