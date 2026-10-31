'use strict';
// The public keys this site trusts to say "this came from the VSP SIMOPS server".
//
// The SIMOPS server signs every invitation it issues and every signature receipt with its private
// key; signing-browser.js verifies them against THIS list before it shows an invitation as official or
// lets anyone sign it. The list is part of the deployed site's own files. It must never be loaded from
// the Cloudflare relay or from anywhere else: whoever can change this list can forge documents.
//
// To add a key (first deployment, or a rotation):
//   cd vsp_dsno_server
//   dart run lib/tools/gen_document_signing_key.dart prod-2026-1 prod
// Put the private lines into the server's environment (secret) and the printed entry below.
// A site trusts only the environments it lists: a production site lists only `prod` keys.
// To retire a key, keep it here until every invitation signed with it has expired (21 days at most),
// then delete the entry.
globalThis.simopsTrustedKeys = Object.freeze([
  // { kid: 'prod-2026-1', environment: 'prod', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: '...', y: '...' } },
  {
  "kid": "prod-2026-1",
  "environment": "prod",
  "alg": "ES256",
  "jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "vg6Nlb9qVJwWylPE3gFeMKuxIKxZ69o5NAQGVtDdX2Q",
    "y": "LZy0Ymh5IB60BUkrXAdriuWeLQM83KOMDJQTS0n7494"
    }
  }
]);
