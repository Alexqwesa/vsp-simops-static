'use strict';
// Browser cryptographic operations only. All visible UI is Flutter.
(() => {
  const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')), c => c.charCodeAt(0));
  // Passkey providers do not all answer with the browser's own types: an extension
  // such as LastPass returns its own credential object, whose binary fields may be
  // base64 strings, plain arrays or buffers from another script context.
  // Copy whatever arrives into a plain Uint8Array of this page.
  const binary = x => {
    if (typeof x === 'string') return bytes(x);
    if (ArrayBuffer.isView(x)) return Uint8Array.from(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    if (Object.prototype.toString.call(x) === '[object ArrayBuffer]') return Uint8Array.from(new Uint8Array(x));
    if (Array.isArray(x)) return Uint8Array.from(x);
    throw Error('Unexpected binary value from the passkey provider');
  };
  const base64 = b => btoa(Array.from(binary(b), c => String.fromCharCode(c)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Minimal CBOR reader (unsigned/negative ints, byte/text strings, arrays, maps,
  // simple values): enough for a WebAuthn attestationObject and its COSE key.
  function cbor(data) {
    let at = 0;
    const length = info => {
      if (info < 24) return info;
      const size = { 24: 1, 25: 2, 26: 4 }[info];
      if (!size) throw Error('Unsupported CBOR length');
      let n = 0;
      for (let i = 0; i < size; i++) n = n * 256 + data[at++];
      return n;
    };
    const item = () => {
      const head = data[at++], major = head >> 5, n = length(head & 31);
      switch (major) {
        case 0: return n;
        case 1: return -1 - n;
        case 2: return data.slice(at, at += n);
        case 3: return new TextDecoder().decode(data.slice(at, at += n));
        case 4: return Array.from({ length: n }, item);
        case 5: { const m = new Map(); for (let i = 0; i < n; i++) m.set(item(), item()); return m; }
        case 7: return { 20: false, 21: true, 22: null }[head & 31];
        default: throw Error('Unsupported CBOR value');
      }
    };
    return { value: item(), end: at };
  }
  // The credential public key as stored by the authenticator: authData holds
  // rpIdHash(32) flags(1) signCount(4) aaguid(16) idLength(2) id, then a COSE key.
  function coseKeyFromAttestation(attestationObject) {
    const authData = cbor(binary(attestationObject)).value.get('authData');
    if (!authData || !(authData[32] & 0x40)) throw Error('The passkey response has no public key');
    const idLength = authData[53] * 256 + authData[54];
    const key = cbor(authData.slice(55 + idLength)).value;
    if (key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1) throw Error('An ES256 passkey is required');
    return { kty: 'EC', crv: 'P-256', x: base64(key.get(-2)), y: base64(key.get(-3)) };
  }
  // ES256 public key of a new credential as a JWK: from getPublicKey() when the
  // provider implements it usably, else from the attestationObject itself.
  async function publicKeyOf(created) {
    const response = created.response;
    try {
      if (typeof response.getPublicKey === 'function' && response.getPublicKeyAlgorithm?.() === -7) {
        const key = await crypto.subtle.importKey('spki', binary(response.getPublicKey()),
          { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
        return await crypto.subtle.exportKey('jwk', key);
      }
    } catch (e) {
      console.info('SIMOPS passkey: getPublicKey() unusable, reading the attestation instead', reason(e));
    }
    const key = await crypto.subtle.importKey('jwk', coseKeyFromAttestation(response.attestationObject),
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    return crypto.subtle.exportKey('jwk', key);
  }
  const canonical = v => JSON.stringify((function sort(x) {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])]));
    return x;
  })(v));
  const hash = async text => base64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  // ---- VSP signatures ---------------------------------------------------------------
  // The SIMOPS server signs invitations and receipts (ECDSA P-256, SHA-256, signature r||s). What is signed
  // is the purpose, a line break, then the canonical JSON without vspSignature. The keys come only from vsp-trusted-keys.js,
  // which ships with this site.
  const INVITATION_PURPOSE = 'simops-invitation-v1', RECEIPT_PURPOSE = 'simops-receipt-v1';
  // The page tells a document it cannot trust apart from an ordinary error by this code.
  const notAuthentic = message => Object.assign(Error(message), { code: 'vsp-signature' });
  async function verifyVspSignature(purpose, document) {
    const record = document && document.vspSignature;
    if (!record || record.v !== 1 || record.alg !== 'ES256' || typeof record.kid !== 'string' || typeof record.sig !== 'string') {
      throw notAuthentic('This document is not signed by VSP');
    }
    const list = Array.isArray(globalThis.simopsTrustedKeys) ? globalThis.simopsTrustedKeys : [];
    const trusted = list.find(k => k && k.kid === record.kid && k.alg === 'ES256' && k.jwk && k.jwk.kty === 'EC' && k.jwk.crv === 'P-256');
    if (!trusted) throw notAuthentic('The document is signed with a key this site does not trust');
    // The key must be for the document's environment, and the document for the environment of this page
    // (prod, or dev when the page was opened with ?flavor=dev). The page announces its own; none means no trust.
    const site = globalThis.simopsSiteEnvironment;
    if (site !== 'prod' && site !== 'dev') throw notAuthentic('This page does not know its SIMOPS environment');
    if (document.environment !== trusted.environment || document.environment !== site) {
      throw notAuthentic('The document belongs to another SIMOPS environment');
    }
    let valid = false;
    try {
      const raw = bytes(record.sig);
      const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: trusted.jwk.x, y: trusted.jwk.y, ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const { vspSignature, ...rest } = document;
      valid = raw.length === 64 && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw,
        new TextEncoder().encode(purpose + '\n' + canonical(rest)));
    } catch { valid = false; }
    if (!valid) throw notAuthentic('The VSP signature of this document is not valid');
    return trusted;
  }
  // A signature receipt: what the SIMOPS server says became of one signature. Returns the verified receipt as JSON.
  async function verifyReceipt(raw) {
    const r = JSON.parse(raw);
    if (r.v !== 1 || r.kind !== 'simops-signature-receipt') throw notAuthentic('This is not a signature receipt');
    await verifyVspSignature(RECEIPT_PURPOSE, r);
    return JSON.stringify(r);
  }
  async function validate(raw) {
    const r = JSON.parse(raw);
    if (r.v !== 1 || !['enroll', 'approve', 'add', 'replace', 'remove', 'recover', 'login'].includes(r.kind)
        || r.origin !== location.origin || r.rpId !== location.hostname) throw Error('Invalid signing site or request');
    // Authenticity first: nothing about an unsigned or forged invitation is shown or acted on.
    await verifyVspSignature(INVITATION_PURPOSE, r);
    if (!Number.isFinite(Date.parse(r.expiresAt)) || Date.now() >= Date.parse(r.expiresAt)) throw Error('Invitation expired');
    const { challenge, vspSignature, ...bound } = r;
    if (await hash(canonical(bound)) !== challenge) throw Error('Invitation content was changed');
    if (!globalThis.isSecureContext || !navigator.credentials) throw Error('A secure browser with passkey support is required');
    return r;
  }
  async function read(fragment) {
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    const encoded = params.get('request'), packed = params.get('packed');
    if ((encoded === null) === (packed === null) || (encoded || packed).length > 2000000) throw Error('Invalid invitation');
    if (encoded) return new TextDecoder('utf-8', { fatal: true }).decode(bytes(encoded));
    const reader = new Blob([bytes(packed)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 2000000) { await reader.cancel(); throw Error('Invitation too large'); }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Right after a passkey is created, Chrome (or a password-manager extension that
  // wraps navigator.credentials) may still be closing that prompt and rejects the
  // next one with "A request is already pending". That is not the person's answer,
  // so try again shortly; a real cancel (NotAllowedError) is never retried.
  // True when an extension (e.g. LastPass) replaced the browser's passkey
  // functions on this page. Such wrappers can leave their own prompt open.
  const wrappedByExtension = () => {
    try {
      const native = fn => /\[native code\]/.test(Function.prototype.toString.call(fn));
      return !native(navigator.credentials.create) || !native(navigator.credentials.get);
    } catch { return false; }
  };
  async function getCredential(options) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await navigator.credentials.get(options);
      } catch (e) {
        const pending = /already pending/i.test(e?.message || '');
        if (pending && attempt >= 5 && wrappedByExtension()) {
          throw Error('A browser extension (for example LastPass) handles passkeys on this page and left its own passkey prompt open. '
            + 'Close or cancel that prompt, or turn off the extension\'s passkey option for this site, then press the button again.');
        }
        if (attempt >= 5 || !pending) throw e;
        console.info(`SIMOPS passkey: previous prompt still open, retrying (${attempt})`);
        await wait(600 * attempt);
      }
    }
  }
  async function assertion(r, challenge, ids) {
    if (!ids?.length || ids.some(id => typeof id !== 'string')) throw Error('No registered passkey');
    console.info('SIMOPS passkey: confirm', ids);
    const a = await getCredential({ publicKey: { challenge: bytes(challenge), rpId: r.rpId,
      allowCredentials: ids.map(id => ({ type: 'public-key', id: bytes(id) })), userVerification: 'required', timeout: 120000 } });
    if (!a) throw Error('Passkey confirmation cancelled');
    return { credentialId: base64(a.rawId), clientDataJSON: base64(a.response.clientDataJSON),
      authenticatorData: base64(a.response.authenticatorData), signature: base64(a.response.signature),
      userHandle: a.response.userHandle ? base64(a.response.userHandle) : null };
  }
  // Username-less sign-in for the signer inbox: no credential list is sent, the
  // authenticator offers the passkeys it holds for this site and the person picks one.
  // The relay checks the assertion against the public keys the SIMOPS server gave it.
  async function discover(challenge) {
    if (!globalThis.isSecureContext || !navigator.credentials) throw Error('A secure browser with passkey support is required');
    const a = await getCredential({ publicKey: { challenge: bytes(challenge), rpId: location.hostname,
      allowCredentials: [], userVerification: 'required', timeout: 120000 } });
    if (!a) throw Error('Passkey confirmation cancelled');
    return JSON.stringify({ credentialId: base64(a.rawId), clientDataJSON: base64(a.response.clientDataJSON),
      authenticatorData: base64(a.response.authenticatorData), signature: base64(a.response.signature) });
  }
  async function compact(link) {
    const url = new URL(link), params = new URLSearchParams(url.hash.slice(1));
    const raw = params.get('request');
    if (!raw || typeof CompressionStream === 'undefined') return link;
    const compressed = await new Response(new Blob([bytes(raw)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    params.delete('request'); params.set('packed', base64(compressed));
    url.hash = params.toString();
    return url.href.length < link.length ? url.href : link;
  }
  async function sign(raw) {
    const r = await validate(raw);
    const adding = ['enroll', 'add', 'replace', 'recover'].includes(r.kind);
    let id = r.credentialId, publicKey, registration, authorization;
    if (adding) {
      const created = await navigator.credentials.create({ publicKey: {
        challenge: bytes(r.challenge), rp: { id: r.rpId, name: 'SIMOPS' },
        user: { id: new TextEncoder().encode(`simops:${r.signerId}`), name: r.signerEmail || `simops-${r.signerId}`, displayName: r.signerName || `SIMOPS ${r.signerId}` },
        excludeCredentials: (r.excludeCredentialIds || []).map(id => ({ type: 'public-key', id: bytes(id) })),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
        attestation: 'none', timeout: 120000, hints: ['client-device'],
      }});
      if (!created?.response) throw Error('The passkey provider returned no credential');
      id = base64(created.rawId);
      publicKey = await publicKeyOf(created);
      registration = { clientDataJSON: base64(created.response.clientDataJSON), attestationObject: base64(created.response.attestationObject) };
      if (r.flow === 'selfService' && ['add', 'replace', 'recover'].includes(r.kind)) {
        authorization = await assertion(r, await hash(`authorize:${r.challenge}:${canonical({ credentialId: id, publicKey })}`), r.credentialIds);
      }
    }
    if (Date.now() >= Date.parse(r.expiresAt)) throw Error('Invitation expired');
    return JSON.stringify({ v: 1, requestId: r.requestId,
      ...await assertion(r, r.challenge, adding ? [id] : r.credentialIds || [id]),
      ...(publicKey ? { publicKey, registration } : {}), ...(authorization ? { authorization } : {}) });
  }
  // The browser's own reason ("NotAllowedError: ...") so the page can show it.
  const reason = e => (e && e.name && e.name !== 'Error' ? `${e.name}: ` : '') + (e && e.message ? e.message : String(e));
  // Registrations, and the lost-passkey recovery request that carries a new candidate key.
  const REGISTRATION_KINDS = new Set(['external-registration', 'external-profile-request', 'external-passkey-change']);
  // Offline registration, step 1: creates a passkey bound to the registration data.
  // Returns the new key without the possession proof, so a failed or cancelled
  // step 2 can be repeated for this same passkey instead of creating another one.
  async function createRegistrationPasskey(raw) {
    const r = JSON.parse(raw);
    if (r.v !== 1 || !REGISTRATION_KINDS.has(r.kind) || r.origin !== location.origin || r.rpId !== location.hostname) {
      throw Error('Invalid registration site');
    }
    if (!globalThis.isSecureContext || !navigator.credentials) throw Error('A secure browser with passkey support is required');
    const challenge = await hash(canonical(r));
    let created;
    console.info('SIMOPS passkey: create', wrappedByExtension() ? '(navigator.credentials is wrapped by an extension)' : '');
    try {
      created = await navigator.credentials.create({ publicKey: {
        challenge: bytes(challenge), rp: { id: r.rpId, name: 'SIMOPS' },
        user: { id: new TextEncoder().encode(`simops-registration:${challenge.slice(0, 32)}`), name: r.email || 'SIMOPS passkey', displayName: r.fullName || r.email || 'SIMOPS passkey' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
        attestation: 'none', timeout: 120000, hints: ['client-device'],
      }});
    } catch (e) { throw Error(reason(e)); }
    if (!created?.response) throw Error('The passkey provider returned no credential');
    console.info('SIMOPS passkey: created', base64(created.rawId));
    try {
      return JSON.stringify({ request: r, challenge, credentialId: base64(created.rawId),
        publicKey: await publicKeyOf(created),
        registration: { clientDataJSON: base64(created.response.clientDataJSON), attestationObject: base64(created.response.attestationObject) } });
    } catch (e) { throw Error(reason(e)); }
  }
  // Step 2: proves possession of exactly the passkey from step 1. The server
  // verifies the proof; the key only becomes usable after VSP approval.
  async function confirmRegistrationPasskey(createdJson) {
    const c = JSON.parse(createdJson), r = c.request;
    let proof;
    try { proof = await assertion(r, c.challenge, [c.credentialId]); } catch (e) { throw Error(reason(e)); }
    return JSON.stringify({ ...r, challenge: c.challenge, passkey: { ...proof, publicKey: c.publicKey, registration: c.registration } });
  }
  // ---- Passkey changes (add, replace, revoke) -----------------------------------
  // A worker who still has a passkey changes their keys without VSP. The request is
  // bound to a challenge (step 1), a new key proves possession of it (reusing the
  // registration steps), and an existing key authorizes the exact new key (step 3).
  const randomNonce = () => base64(crypto.getRandomValues(new Uint8Array(16)));
  // Step 1: the request data. `target` is the key to replace or revoke.
  function newPasskeyChange(action, target, enrollmentId) {
    if (!['add', 'replace', 'revoke'].includes(action)) throw Error('Unknown passkey action');
    return JSON.stringify({ v: 1, kind: 'external-passkey-change', action, origin: location.origin, rpId: location.hostname,
      issuedAt: Date.now(), nonce: randomNonce(), ...(target ? { targetCredentialId: target } : {}),
      ...(enrollmentId ? { enrollmentId } : {}) });
  }
  // The challenge an existing key signs. For a new key it covers that key's credential
  // ID and public key as well, matching the SIMOPS server's passkeyAuthorizationChallenge.
  async function authorizationChallenge(change) {
    if (!change.passkey) return change.challenge;
    return hash(`authorize:${change.challenge}:${canonical({ credentialId: change.passkey.credentialId, publicKey: change.passkey.publicKey })}`);
  }
  // Step 3: an existing, registered key (one of `ids`) signs the change. For revoke there
  // is no new key, so the change gets its challenge here.
  async function authorizePasskeyChange(changeJson, ids) {
    const change = JSON.parse(changeJson);
    if (change.v !== 1 || change.kind !== 'external-passkey-change' || change.origin !== location.origin || change.rpId !== location.hostname) {
      throw Error('Invalid passkey change');
    }
    if (!change.challenge) {
      const { challenge, passkey, authorization, ...bound } = change;
      change.challenge = await hash(canonical(bound));
    }
    let proof;
    try { proof = await assertion({ rpId: change.rpId }, await authorizationChallenge(change), ids); } catch (e) { throw Error(reason(e)); }
    return JSON.stringify({ ...change, authorization: proof });
  }
  const registerPasskey = async raw => confirmRegistrationPasskey(await createRegistrationPasskey(raw));
  function deliver(requestJson, responseJson) {
    const r = JSON.parse(requestJson), response = JSON.parse(responseJson);
    if (response.requestId !== r.requestId) throw Error('Response belongs to another request');
    if (r.returnOrigin && window.opener && new URL(r.returnOrigin).origin === r.returnOrigin) {
      window.opener.postMessage(JSON.stringify({ type: 'simops-passkey-response', response }), r.returnOrigin);
      return true;
    }
    return false;
  }
  const api = { read, compact, discover, validate: async raw => { await validate(raw); return raw; }, verifyReceipt, sign, registerPasskey,
    createRegistrationPasskey, confirmRegistrationPasskey, newPasskeyChange, authorizePasskeyChange, deliver };
  globalThis.simopsSigning = api;
  if (typeof module !== 'undefined') module.exports = { ...api, canonical, hash, authorizationChallenge, verifyVspSignature };
})();
