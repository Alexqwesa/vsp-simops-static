'use strict';
// Browser cryptographic operations only. All visible UI is Flutter.
(() => {
  const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const base64 = b => btoa(Array.from(new Uint8Array(b), c => String.fromCharCode(c)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const canonical = v => JSON.stringify((function sort(x) {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])]));
    return x;
  })(v));
  const hash = async text => base64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  async function validate(raw) {
    const r = JSON.parse(raw);
    if (r.v !== 1 || !['enroll', 'approve', 'add', 'replace', 'remove', 'recover', 'login'].includes(r.kind)
        || r.origin !== location.origin || r.rpId !== location.hostname) throw Error('Invalid signing site or request');
    if (!Number.isFinite(Date.parse(r.expiresAt)) || Date.now() >= Date.parse(r.expiresAt)) throw Error('Invitation expired');
    const { challenge, ...bound } = r;
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
  async function assertion(r, challenge, ids) {
    if (!ids?.length || ids.some(id => typeof id !== 'string')) throw Error('No registered passkey');
    const a = await navigator.credentials.get({ publicKey: { challenge: bytes(challenge), rpId: r.rpId,
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
    const a = await navigator.credentials.get({ publicKey: { challenge: bytes(challenge), rpId: location.hostname,
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
      if (!created?.response?.getPublicKey || created.response.getPublicKeyAlgorithm() !== -7) throw Error('An ES256 passkey is required');
      id = base64(created.rawId);
      const key = await crypto.subtle.importKey('spki', created.response.getPublicKey(), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      publicKey = await crypto.subtle.exportKey('jwk', key);
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
  // Offline registration, step 1: creates a passkey bound to the registration data.
  // Returns the new key without the possession proof, so a failed or cancelled
  // step 2 can be repeated for this same passkey instead of creating another one.
  async function createRegistrationPasskey(raw) {
    const r = JSON.parse(raw);
    if (r.v !== 1 || r.kind !== 'external-registration' || r.origin !== location.origin || r.rpId !== location.hostname) {
      throw Error('Invalid registration site');
    }
    if (!globalThis.isSecureContext || !navigator.credentials) throw Error('A secure browser with passkey support is required');
    const challenge = await hash(canonical(r));
    let created;
    try {
      created = await navigator.credentials.create({ publicKey: {
        challenge: bytes(challenge), rp: { id: r.rpId, name: 'SIMOPS' },
        user: { id: new TextEncoder().encode(`simops-registration:${challenge.slice(0, 32)}`), name: r.email, displayName: r.fullName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
        attestation: 'none', timeout: 120000, hints: ['client-device'],
      }});
    } catch (e) { throw Error(reason(e)); }
    if (!created?.response?.getPublicKey || created.response.getPublicKeyAlgorithm() !== -7) throw Error('An ES256 passkey is required');
    const key = await crypto.subtle.importKey('spki', created.response.getPublicKey(), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    return JSON.stringify({ request: r, challenge, credentialId: base64(created.rawId),
      publicKey: await crypto.subtle.exportKey('jwk', key),
      registration: { clientDataJSON: base64(created.response.clientDataJSON), attestationObject: base64(created.response.attestationObject) } });
  }
  // Step 2: proves possession of exactly the passkey from step 1. The server
  // verifies the proof; the key only becomes usable after VSP approval.
  async function confirmRegistrationPasskey(createdJson) {
    const c = JSON.parse(createdJson), r = c.request;
    let proof;
    try { proof = await assertion(r, c.challenge, [c.credentialId]); } catch (e) { throw Error(reason(e)); }
    return JSON.stringify({ ...r, challenge: c.challenge, passkey: { ...proof, publicKey: c.publicKey, registration: c.registration } });
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
  const api = { read, compact, discover, validate: async raw => { await validate(raw); return raw; }, sign, registerPasskey,
    createRegistrationPasskey, confirmRegistrationPasskey, deliver };
  globalThis.simopsSigning = api;
  if (typeof module !== 'undefined') module.exports = { ...api, canonical, hash };
})();
