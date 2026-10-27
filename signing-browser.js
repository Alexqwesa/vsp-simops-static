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
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
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
  function deliver(requestJson, responseJson) {
    const r = JSON.parse(requestJson), response = JSON.parse(responseJson);
    if (response.requestId !== r.requestId) throw Error('Response belongs to another request');
    if (r.returnOrigin && window.opener && new URL(r.returnOrigin).origin === r.returnOrigin) {
      window.opener.postMessage(JSON.stringify({ type: 'simops-passkey-response', response }), r.returnOrigin);
      return true;
    }
    return false;
  }
  const api = { read, compact, validate: async raw => { await validate(raw); return raw; }, sign, deliver };
  globalThis.simopsSigning = api;
  if (typeof module !== 'undefined') module.exports = { ...api, canonical, hash };
})();
