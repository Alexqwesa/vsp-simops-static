# Deploy the optional Cloudflare signing relay

The private SIMOPS server **signs** every invitation with its own key and sends it to
a Worker as plain JSON. Cloudflare is trusted with the content of these short-lived
documents (see "SIMOPS document security" in
[relay-arch.md](../cloudflare/signing-relay/relay-arch.md)); what protects authenticity is
the VSP signature, which the static site verifies with a public key shipped in its own
files. The signing link's fragment carries only the mailbox id and an access token: whoever
has the link can open that one SIMOPS, so treat invitation links as private. The Worker
stores the signed invitation, a token hash, expiry and status. Only the intranet server
validates and records approvals. The Worker cannot approve a SIMOPS by setting a status,
and it cannot forge or change an invitation or a receipt: it has no signing key.

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
SIMOPS_ENVIRONMENT=prod
SIMOPS_DOCUMENT_SIGNING_KID=prod-2026-1
SIMOPS_DOCUMENT_SIGNING_KEY=PRIVATE_KEY_FROM_THE_GENERATOR_SEE_BELOW
SIMOPS_EXTERNAL_SIGNING_PAGE=https://alexqwesa.github.io/vsp-simops-static/external-signing.html
SIMOPS_APP_RETURN_ORIGINS=https://softapp.vietsov.com.vn:1810,https://simops.vietsov.com.vn
```

Generate `SIMOPS_RELAY_ENCRYPTION_KEY` independently, with at least 32 random
characters (prefer 32 random bytes encoded as hex). Never send it to Cloudflare.
It derives the mailbox ids and link tokens, so that the same request always gets the same
ones; it is no longer an encryption key for documents. Back up both secrets in your
server secret store.

### The VSP document signing key

The server refuses to issue an invitation without it (it never issues unsigned ones).
Create the pair once per environment:

```sh
cd vsp_dsno_server
dart run lib/tools/gen_document_signing_key.dart prod-2026-1 prod     # kid, environment (prod or dev)
```

* The three `SIMOPS_*` lines it prints go into the server's secret environment. The private
  key never leaves the server and is never committed or sent to Cloudflare.
  `SIMOPS_ENVIRONMENT` is `prod` or `dev`; it is signed into every invitation and receipt.
* The `{ kid, environment, alg, jwk }` entry it prints goes into
  `vsp_dsno_flutter/web/vsp-trusted-keys.js` and is deployed with the static site. A production
  site lists only `prod` keys, a development site `dev` keys. The site never loads keys from the
  relay.
* **Rotation:** generate a new key with a new `kid`, add it to `vsp-trusted-keys.js`, deploy the
  site, then switch the server to the new key. Keep the old entry until every invitation signed
  with it has expired (21 days at most), then remove it. A lost or leaked private key: remove its
  entry from the site and deploy at once; invitations signed with it stop being accepted.
* The key also signs **receipts** (what became of a signature). A worker can prove a signature
  from the receipt alone, without the relay.

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
mailbox and inbox lifetimes at **21 days**, and deletes expired rows hourly. Actual server
requests are shorter (five minutes for self-service, seven days for external requests).
The document copy is removed:

* when the signature is verified (the signer's own mailbox only: other signers' invitations
  of the same SIMOPS stay independent),
* when VSP revokes the invitation (the server tells the relay at once),
* at expiry, in every state, within 21 days at most.

What stays after a signature is verified, a revocation or a rejection is only the **status
metadata** for about a year: the mailbox id, the status, the signing time, the hash of the
link token and the receipt the SIMOPS server signed. The status endpoint never returns the
deleted document. If an acknowledgement fails, expiry cleanup is the fallback. A rejected
response keeps its invitation readable until expiry.

D1 also has provider-managed [Time Travel backups](https://developers.cloudflare.com/d1/reference/time-travel/).
Deleting active rows is **not** a promise of immediate physical removal from all
provider backups; backup retention follows the Cloudflare plan. Never use the relay
as a permanent document store. Users should export SIMOPS JSON and back it up;
browser local history can be cleared or evicted.

Rotating the server-only encryption secret changes derived mailbox IDs and tokens. Existing
relay links will no longer be retrieved by the server; finish outstanding requests
first or issue new invitations afterwards. Links issued before documents became plain
signed JSON still carry an AES key; they keep working until they expire (the server
derives that key from the same secret to open their responses), so keep the secret until then. Offline response imports still use the
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
email carries (the review copy of the SIMOPS with only that signer's slot). Whoever
administers the Cloudflare account can read invitations that wait there; that is the accepted
trade-off for short-lived operational documents. A copy someone altered is still refused: the
static site verifies the VSP signature. If this is not acceptable, do not enable the inbox: the
server then simply does not need the `assignments` calls.

Access model: an emailed link opens that one SIMOPS (the link's token is the credential); the
inbox and the list of the signer's passkeys need a WebAuthn proof from any active passkey of that
signer; signing needs a registered passkey and the server's final check; a signature receipt can
be checked without a passkey. Knowing one link never reveals another signer's SIMOPS.

Setting up (or starting over): there is **no data migration**. A relay that never existed needs
only `schema.sql`. A relay created by an earlier version is reset first (everything in it is
short-lived and comes back by itself):

```sh
npx wrangler d1 execute simops-signing-relay --remote --file schema-reset.sql   # only to start over
npx wrangler d1 execute simops-signing-relay --remote --file schema.sql
npx wrangler deploy
```

Then restart the SIMOPS server so it syncs the passkeys.

Upgrading a relay that already works, to let the Windows and mobile apps sign external workers in
(login mailboxes need one new column; nothing is lost). Run it before deploying the new Worker:

```sh
npx wrangler d1 execute simops-signing-relay --remote --file schema-add-claim-hash.sql
npx wrangler deploy
```

Invitations issued before the upgrade are not in anybody's inbox; their emailed links
still work. Passkeys must be discoverable to be found without a username. New passkeys are
created that way; an old passkey that the browser cannot offer must be registered again.

## One relay for prod and dev (flavors)

Several SIMOPS servers can share one Worker. The Worker takes each server's
**flavor**, `prod` or `dev`, from the API key it calls with, and keeps passkeys,
inbox entries and invitation mailboxes per flavor: a server never sees, replaces or
deletes another flavor's rows. A passkey sync replaces only its own list, and a
signer ID that exists in both databases gets only its own server's inbox entries.

**Registrations are the exception: they are shared.** Every server imports every
registration once, so one request can register a person on both (a test
registration may therefore show up in prod too). Only the `REGISTRATION_OWNER`
flavor (`prod` in `wrangler.jsonc`) removes a registration from Cloudflare after
importing it; any other server (dev) only marks it as seen and is not offered it
again. Until prod uses the relay, registrations stay until they expire after 14
days (at most 500 waiting, 30 000 bytes each), then the hourly cleanup removes them.
To fetch new ones immediately instead of waiting for the next poll, press **Sync
registrations from Cloudflare** on the external signers screen.

| Worker secret | Server `.env` | Flavor |
|---|---|---|
| `RELAY_API_KEY` | prod server: `SIMOPS_RELAY_API_KEY` = this value | `prod` |
| `RELAY_API_KEY_DEV` | dev server: `SIMOPS_RELAY_API_KEY` = this value | `dev` |

Use two different random secrets. The server code is the same for both; only the key
differs. Leave `RELAY_API_KEY_DEV` unset if you run a single server.

The static site is `prod` by default. Opened with **`?flavor=dev`**, for example
`https://alexqwesa.github.io/vsp-simops-static/?flavor=dev#register`, a page works
with the dev server: it shows a red **DEV** badge in the top bar, tries no prod
server directly (dev has none reachable from the internet, so it uses the relay
only), and the copy/share/email registration links keep `?flavor=dev`. Without it,
a page first tries the prod servers directly, then the relay. Set the build default
with `--dart-define=SIMOPS_RELAY_FLAVOR=dev|prod` (the deploy workflow reads the
repository variable `SIMOPS_RELAY_FLAVOR`, default `prod`). The browser console
shows the flavor at startup: `SIMOPS build … (staticSite, relay flavor dev)`.
Local browser history and the user list are shared by both flavors.

Moving a relay created before flavors: the old tables have no flavor column, so
recreate them. Only registrations still waiting for import are lost; servers
re-sync passkeys at startup and re-send new invitations.

```sh
npx wrangler d1 execute simops-signing-relay --remote --file schema-reset.sql
npx wrangler d1 execute simops-signing-relay --remote --file schema.sql
npx wrangler secret put RELAY_API_KEY_DEV
npx wrangler deploy
```

Then set the dev server's `SIMOPS_RELAY_API_KEY` to the `RELAY_API_KEY_DEV` value and
restart it. `RELAY_API_KEY` is not needed until prod uses the relay: without it the
prod flavor is simply off. Then create it with a new random value (not the dev one)
and put it in the prod server's `SIMOPS_RELAY_API_KEY`.

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
