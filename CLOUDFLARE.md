# Deploy the optional Cloudflare signing relay

The private SIMOPS server encrypts each invitation with AES-256-GCM before sending
it to a Worker. The signing link's fragment carries the mailbox capability and
decryption key. The Worker stores ciphertext, a token hash, expiry and status;
it does not receive the encryption key or plaintext SIMOPS. Treat invitation links
as private. Only the intranet server validates and records approvals. The Worker
cannot approve a SIMOPS by setting a status.

External approvals are polled about once a minute and pass the existing assignment,
document hash/version, passkey, expiry, revocation and replay checks. External first
enrollment still requires a coordinator's identity confirmation. Self-service
requests remain session-bound and are completed by the waiting SIMOPS client.
The **Offline secure sign (JSON)** option bypasses Cloudflare; normal popup return
and response-file import remain available.

## Deploy yourself

Prerequisites: a Cloudflare account and a supported Node.js version. Follow the
[Wrangler installation guide](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
and [D1 getting started guide](https://developers.cloudflare.com/d1/get-started/).
From the application source checkout:

```sh
cd cloudflare/signing-relay
npm install
npm test
npx wrangler login
npx wrangler d1 create simops-signing-relay
```

Put the returned database ID in `wrangler.jsonc` under `d1_databases[0].database_id`.
Keep the binding `DB`. Set `vars.ALLOWED_ORIGINS` to comma-separated exact browser
origins, including the signing site and any intranet web app polling the relay:

```text
https://alexqwesa.github.io,https://softapp.vietsov.com.vn:1810,https://simops.vietsov.com.vn
```

No trailing slashes or paths. CORS is browser access control; mailbox tokens and
the admin secret remain required. Do not use `*`.

```sh
npx wrangler d1 execute simops-signing-relay --remote --file=schema.sql
npx wrangler secret put RELAY_API_KEY
npx wrangler deploy
```

For the secret prompt, use a password-manager-generated random secret of at least
32 characters (prefer 32 random bytes encoded as hex). Keep the same value for the
private server. Never put it in Git, Flutter build defines, browser settings, or a
public README. See [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
The deploy command prints your `https://...workers.dev` URL.

## Configure the intranet server

Add these entries to its existing `.env`, then restart the server:

```dotenv
SIMOPS_RELAY_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
SIMOPS_RELAY_API_KEY=YOUR_SAME_RANDOM_SECRET
SIMOPS_RELAY_ENCRYPTION_KEY=ANOTHER_RANDOM_SECRET_KEPT_ONLY_ON_THE_PRIVATE_SERVER
SIMOPS_EXTERNAL_SIGNING_PAGE=https://alexqwesa.github.io/vsp-simops-static/external-signing.html
SIMOPS_APP_RETURN_ORIGINS=https://softapp.vietsov.com.vn:1810,https://simops.vietsov.com.vn
```

Generate `SIMOPS_RELAY_ENCRYPTION_KEY` independently, with at least 32 random
characters (prefer 32 random bytes encoded as hex). Never send it to Cloudflare.
It derives the per-request encryption keys and capabilities. The API secret alone
cannot decrypt stored invitations. Back up both secrets in your server secret store.

Use the Worker origin only for `SIMOPS_RELAY_URL`. The server needs outbound HTTPS
to Cloudflare; no public inbound access to the intranet server is required. Existing
database migrations, SMTP, employee authentication and signing permissions still
apply. Keep the signing hostname unchanged to retain existing passkeys.
With `SIMOPS_RELAY_URL` absent, existing full offline invitation links are used.
With a configured relay outage, choose the explicit offline option; the app reports
a short error without exposing the full invitation URL.

Deploy the Flutter site from the source workflow as described in
the static viewer README (published alongside these instructions). The workflow needs the existing
`SIMOPS_STATIC_DEPLOY_TOKEN` with permission to read the helper repository and push
commits/tags to `Alexqwesa/vsp-simops-static`. Enable Pages from `gh-pages` root in
that target repository. This setup does not deploy your Worker automatically.

## Storage and expiry

Cloudflare is not an archive. The Worker rejects expired access immediately, caps
mailbox lifetimes at eight days, and deletes expired rows hourly. Actual server
requests may be shorter (five minutes for self-service, seven days for external
requests). After successful server acknowledgement it clears invitation and
response ciphertext, retaining status metadata until expiry. If acknowledgement
fails, expiry cleanup is the fallback. Rejected responses remain until expiry.

D1 also has provider-managed [Time Travel backups](https://developers.cloudflare.com/d1/reference/time-travel/).
Deleting active rows is **not** a promise of immediate physical removal from all
provider backups; backup retention follows the Cloudflare plan. Never use the relay
as a permanent document store. Users should export SIMOPS JSON and back it up;
browser local history can be cleared or evicted.

Rotating the server-only encryption secret changes derived mailbox IDs, tokens and keys. Existing
relay links will no longer be retrieved by the server; finish outstanding requests
first or issue new invitations afterwards. Offline response imports still use the
server's signing request records and validation rules.

## Registration mailbox

External workers who cannot reach the VSP servers leave their registration here.
`POST /v1/registrations` is public (origin-checked, at most 500 pending, 30 000 bytes
each, must contain a passkey). It stores personal data (name, company, email) in D1
until the SIMOPS server imports it (`GET /v1/registrations`, then
`DELETE /v1/registrations/<id>`, admin key) or 14 days pass. After updating the Worker run
`npx wrangler d1 execute simops-signing-relay --remote --file schema.sql` once to create the
`registration` table. The static site uses `https://simops-signing-relay.alexqwesa.workers.dev` by default; set the
GitHub repository variable `SIMOPS_RELAY_URL` only to point the build at another Worker.

## Signer inbox

A signer opens **Open → Get my SIMOPS to sign** on the static site and confirms with
any of their passkeys. The relay answers with the invitations assigned to that signer,
so no emailed link is needed.

* The SIMOPS server copies every active passkey (credential ID, public key, signer ID,
  RP ID) to the relay. A signer can have several passkeys; the inbox belongs to the
  signer, not to a key. The list is sent when it changes and at least every 6 hours;
  a revoked passkey disappears with the next sync.
* When the server issues an invitation through the relay it also places it in the
  signer's inbox (`PUT /v1/assignments/<mailbox>`). The emailed link keeps working.
* The browser asks the relay for a one-time challenge (valid 2 minutes, spent by the
  first attempt) and signs it with a username-less (`allowCredentials: []`) WebAuthn
  assertion. The relay verifies the whole assertion: challenge, origin (must be in
  `ALLOWED_ORIGINS` and equal to the credential's RP ID host), RP ID hash, user presence
  and user verification, the ES256 signature, and a signature counter that never goes
  back. The browser never sends or stores the public key; the private key stays in the
  authenticator.
* Only invitations assigned to the verified signer are returned. A finished or rejected
  invitation leaves the inbox; expired entries and challenges are removed by the cron.

**What Cloudflare can read.** An inbox entry holds the same invitation link that the
email carries, and that link contains the key that decrypts the invitation (the review
copy of the SIMOPS with only that signer's slot). Whoever administers the Cloudflare
account can therefore read invitations that wait in an inbox. If that is not acceptable,
do not enable the inbox: the server then simply does not need the `assignments` calls.

Upgrade steps: apply the schema again (it only adds tables), deploy the Worker, then
restart the SIMOPS server so it syncs the passkeys.

```sh
npx wrangler d1 execute simops-signing-relay --remote --file schema.sql
npx wrangler deploy
```

Invitations issued before the upgrade are not in anybody's inbox; their emailed links
still work. Passkeys must be discoverable to be found without a username. New passkeys are
created that way; an old passkey that the browser cannot offer must be registered again.

## Verify your deployment

1. Issue an external approval invitation. Confirm its URL contains `#relay=` and
   the page shows Flutter controls and the full SIMOPS, with only the invited slot.
2. Confirm with a passkey. Wait for the private server to record the approval;
   "response sent" alone is not confirmation. Export SIMOPS JSON for your own copy.
3. For first enrollment, use **Fetch relay response** in the signing actions and
   explicitly verify identity. Enrollment alone must not approve the document.
4. Test **Offline secure sign (JSON)**, including importing the response on the
   intranet client. No Worker is required for that option.
5. Export JSON, open the static build on localhost, and import it from Local history.
   Viewing must still work without the relay or intranet server.
6. Check D1 after a verified import: invitation is `null`, response is SQL `NULL`.
   Check that the scheduled trigger removes expired rows. Do not log full links,
   credentials, ciphertext bodies or secrets while troubleshooting.

Local regression checks use `npm test` (Node 22.13+ for its built-in SQLite adapter)
and the repository's Dart/Flutter signing tests. Real passkey confirmation and live
Cloudflare deployment must also be checked in the intended browsers/devices.
