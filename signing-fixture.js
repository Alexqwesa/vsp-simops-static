'use strict';
// Shared by the browser tests: loads signing-browser.js into a sandbox with a fake authenticator, and plays the
// SIMOPS server's part (signing invitations and receipts with the test key).
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');

// The test key of the SIMOPS server tests (vsp_dsno_server/test/signing/document_key_fixture.dart): the same
// private key signs here, and signatures made by the Dart server verify against its public half.
const TEST_KEY = { kty: 'EC', crv: 'P-256', x: '0j6z1kgeydHgFsxAMqSAEGKdDBYsYkmslQ9LVwwzDFs',
  y: 'PsKfvyYQCBhdIgLSByqON5PlfwlfeSVefGrpMUn-llI', d: 'dGVzdC1rZXktZm9yLXRlc3RzLW9ubHktMzItYnl0ZXM' };
const TRUSTED = Object.freeze([{ kid: 'test-key-1', environment: 'dev', alg: 'ES256',
  jwk: { kty: 'EC', crv: 'P-256', x: TEST_KEY.x, y: TEST_KEY.y } }]);

function fixture({ trusted = TRUSTED, site = 'dev' } = {}) {
  const calls = [], messages = [];
  const credential = { rawId: new Uint8Array([1, 2, 3]), response: {
    clientDataJSON: new Uint8Array([4]), authenticatorData: new Uint8Array([5]), signature: new Uint8Array([6]),
  }};
  const context = {
    crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Blob, Response, CompressionStream, DecompressionStream, atob, btoa,
    Uint8Array, setTimeout, console: { info() {} }, isSecureContext: true, location: { origin: 'https://sign.example', hostname: 'sign.example' },
    navigator: { credentials: {
      async get(options) { calls.push(options); return credential; },
      async create() { throw Error('Unexpected registration'); },
    } }, window: { opener: { postMessage: (...args) => messages.push(args) } }, module: { exports: {} },
    simopsTrustedKeys: trusted,
    simopsSiteEnvironment: site,
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, 'signing-browser.js'), 'utf8'), context);
  const api = context.module.exports;
  const signingKey = webcrypto.subtle.importKey('jwk', TEST_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // What the SIMOPS server does to a document: sign "<purpose>\n<canonical JSON>" and attach it as vspSignature.
  async function vspSign(purpose, document, { kid = 'test-key-1' } = {}) {
    const raw = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey,
      new TextEncoder().encode(purpose + '\n' + api.canonical(document)));
    return { ...document, vspSignature: { v: 1, alg: 'ES256', kid, sig: Buffer.from(raw).toString('base64url') } };
  }
  // An invitation as the server issues it: environment, challenge over everything else, then the signature.
  async function request(extra = {}, { kid } = {}) {
    const payload = { v: 1, requestId: 10, kind: 'approve', origin: 'https://sign.example', rpId: 'sign.example',
      expiresAt: new Date(Date.now() + 600000).toISOString(), credentialIds: ['AQID'], document: { id: 1 },
      environment: 'dev', ...extra };
    return JSON.stringify(await vspSign('simops-invitation-v1', { ...payload, challenge: await api.hash(api.canonical(payload)) }, { kid }));
  }
  return { api, context, calls, messages, request, vspSign };
}

module.exports = { fixture, TRUSTED, TEST_KEY };
