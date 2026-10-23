'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { signingBytes, signingBase64, signingCanonical } = require('./external-signing.js');
const { authorizationChallenge, aloc } = require('./external-signing.js');
const { compactRequestUrl, readRequestFragment } = require('./external-signing.js');
const qrcode = require('./qrcode.js');

test('base64url transports a UTF-8 SIMOPS document without padding', () => {
  const bytes = new TextEncoder().encode('SIMOPS: công việc / работа');
  const encoded = signingBase64(bytes);
  assert(!/[+/=]/.test(encoded));
  assert.deepEqual(signingBytes(encoded), bytes);
});
test('key-change authorization cannot be substituted with new-key possession', async () => {
  const challenge = 'document-and-action-bound-challenge';
  const credentialId = 'new-credential';
  const publicKey = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
  const authorization = await authorizationChallenge(challenge, credentialId, publicKey);
  assert.notEqual(authorization, challenge);
  assert.equal(authorization, crypto.createHash('sha256').update(`authorize:${challenge}:${signingCanonical({ credentialId, publicKey })}`).digest('base64url'));
  assert.notEqual(authorization, await authorizationChallenge(challenge, 'attacker-key', publicKey));
  assert.notEqual(authorization, await authorizationChallenge(challenge, credentialId, { ...publicKey, x: 'other' }));
});
test('aloc selects a localized message rather than exposing pipe-separated text', () => {
  assert(['Secure sign', 'Ký an toàn', 'Подписать безопасно'].includes(aloc('Secure sign|Ký an toàn|Подписать безопасно')));
});
test('canonical request digest binds document, version, slot, signer, action and nonce', () => {
  const request = { v: 1, nonce: 'random', kind: 'approve', documentId: 1, versionId: 2, signId: 3, signerId: 4, document: { name: 'SIMOPS', operations: [] } };
  const digest = v => crypto.createHash('sha256').update(signingCanonical(v)).digest('base64url');
  const challenge = digest(request);
  assert.equal(digest(Object.fromEntries(Object.entries(request).reverse())), challenge);
  for (const key of ['nonce', 'kind', 'documentId', 'versionId', 'signId', 'signerId', 'document']) {
    assert.notEqual(digest({ ...request, [key]: 'changed' }), challenge);
  }
});

test('large document invitation compresses into a scannable QR and restores exactly', async () => {
  const request = { v: 1, kind: 'approve', document: { operations: Array.from({ length: 45 }, (_, i) => ({
    id: i, title: `Operation ${i}`, notes: 'Review isolation and permit controls before work begins.'
  })) } };
  const original = `https://alexqwesa.github.io/vsp-simops-static/external-signing.html#request=${signingBase64(new TextEncoder().encode(JSON.stringify(request)))}`;
  assert(original.length > 2400);
  const compact = await compactRequestUrl(original);
  assert(compact.length < original.length);
  const qr = qrcode(0, 'M');
  qr.addData(compact);
  assert.doesNotThrow(() => qr.make());
  assert.deepEqual(await readRequestFragment(new URL(compact).hash), request);
  assert.deepEqual(await readRequestFragment(new URL(original).hash), request);
});

test('login asks for an existing key only after explicit consent and returns no approval', async () => {
  const handlers = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        checked: false,
        hidden: false,
        disabled: false,
        textContent: '',
        append() {},
        addEventListener(name, callback) { handlers.set(`${id}:${name}`, callback); },
      });
    }
    return elements.get(id);
  };
  const request = {v: 1, flow: 'login', kind: 'login', requestId: 42, signerId: 7, nonce: 'random',
    origin: 'https://alexqwesa.github.io', rpId: 'alexqwesa.github.io', expiresAt: new Date(Date.now() + 60000).toISOString(),
    credentialIds: ['dGVzdA'], returnOrigin: 'http://192.168.1.10:8080'};
  request.challenge = crypto.createHash('sha256').update(signingCanonical(request)).digest('base64url');
  let assertions = 0, registrations = 0, posted;
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'external-signing.js'), 'utf8'), {
    document: {documentElement: {}, querySelectorAll: () => [], getElementById: element},
    location: {hash: '#request=' + Buffer.from(JSON.stringify(request)).toString('base64url'), origin: request.origin, hostname: request.rpId, href: 'https://alexqwesa.github.io/external-signing.html#x'},
    navigator: {language: 'en', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', credentials: {
      async create() { registrations++; throw new Error('Login must not enroll'); },
      async get(options) { assertions++; assert.equal(options.publicKey.userVerification, 'required');
        return {rawId: new TextEncoder().encode('test'), response: {clientDataJSON: new Uint8Array([1]), authenticatorData: new Uint8Array([2]), signature: new Uint8Array([3])}}; },
    }},
    window: {PublicKeyCredential: {}, opener: {postMessage(message, origin) { posted = {message: JSON.parse(message), origin}; }}},
    isSecureContext: true, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa, URL, URLSearchParams,
  });
  assert.equal(assertions, 0);
  assert.match(element('consent').textContent, /does not approve any SIMOPS/);
  element('reviewed').checked = true;
  handlers.get('reviewed:change')();
  await handlers.get('confirm:click')();
  assert.equal(assertions, 1);
  assert.equal(registrations, 0);
  assert.equal(posted.origin, request.returnOrigin);
  assert.equal(posted.message.response.requestId, 42);
  assert.equal(posted.message.response.documentId, undefined);
  assert.equal(posted.message.response.publicKey, undefined);
});
