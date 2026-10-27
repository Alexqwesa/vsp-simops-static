# SIMOPS static viewer and signing

This repository contains the deployed Flutter application. It can display SIMOPS,
keep local history, create local drafts (negative IDs), and show the bundled matrix.
Signing uses Flutter controls and your browser's passkey support. Existing
`external-signing.html` links redirect to the Flutter app, preserving the invitation.

## Keep your SIMOPS

Use **Export SIMOPS JSON** on the signing screen, or **Local history → Export JSON**.
Save the downloaded `simops.json` somewhere you back up. Browser local storage is
only a convenience: clearing site data, private browsing, storage eviction, another
browser, or another hostname can make that history unavailable. It is not cloud backup.

Only the invited person's signing slot is included in the signing copy. Other
signers' personal details and evidence are excluded. After confirmation, your own
response evidence is included in your local/exported copy as **pending verification**.
The private SIMOPS server must verify it before recording an approval. A JSON copy
is a saved review record, not proof of the server's current status or independent
cryptographic verification. Export after signing to include the response.

Cloudflare is an optional, temporary encrypted relay. It is not a permanent SIMOPS
archive. Successful server acknowledgement clears the invitation/response from the
active mailbox; expired mailboxes are removed by scheduled cleanup. See
[relay deployment and retention](CLOUDFLARE.md). An expired invitation does not stop
you reopening a previously exported SIMOPS JSON for viewing.

## Open your JSON later on localhost

Install [Python 3](https://www.python.org/downloads/) and optionally
[Git](https://git-scm.com/downloads). Obtain this repository's **gh-pages** branch
(or download a ZIP of a `build-*` tag and extract it):

```sh
git clone --branch gh-pages https://github.com/Alexqwesa/vsp-simops-static.git
cd vsp-simops-static
python -m http.server 8080 --bind 127.0.0.1
```

On Windows, `py -m http.server 8080 --bind 127.0.0.1` also works. Open
[the local viewer](http://localhost:8080/), choose **Local history**, and click
**Import SIMOPS JSON**. Select your saved JSON. Keep the terminal running while
viewing; Ctrl+C stops it. Do not open `index.html` via `file://`.

The build uses relative paths and bundles its rendering engine and matrix assets.
It can run from another folder/repository without the intranet server or relay.
Missing matrix assets produce a warning; keep the assets folder when copying it.
Viewing is possible on localhost, but passkeys issued for `alexqwesa.github.io`
cannot sign on localhost or another hostname. Use the original signing site for
those invitations. Local storage is separate for each origin.

## Host a copy in your own repository

Copy the published files (including hidden `.nojekyll`, `assets`, and `canvaskit`)
into your repository's Pages branch. Configure **Settings → Pages → Deploy from a
branch**, select that branch and `/ (root)`. See [GitHub's Pages instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
Open the resulting URL and import your JSON locally. You do **not** need to commit
personal SIMOPS JSON, invitation links, or signing responses to the repository.

To build from application source, keep `my_helpers` next to the source checkout,
matching the Flutter path dependency. In `vsp_dsno_flutter` run:

```sh
flutter pub get
flutter build web --release --target lib/main_static_site.dart --dart-define=BUILD_NUMBER=1
python tool/prepare_static_site.py --build-number 1
```

Publish the contents of `build/web`. The preparation step installs this README,
relay instructions and a portable bootstrap without changing the intranet shell.
For signing on a new hostname, configure the private server's signing-page URL
and enroll new passkeys for that hostname; copying the viewer does not migrate keys.

## Deployment versions

The source workflow publishes each deployment to this repository's `gh-pages`
branch and creates an annotated **`build-<UTC YYYYMMDDHHMMSS>`** tag on that
deployment commit, for example `build-20261027143005`. The same number is passed to Flutter as
`BUILD_NUMBER`; `build-info.json` records the number, tag and source commit.
Deployments are serialized; re-running a workflow gets a new timestamp. Tags identify deployed
artifacts in this static repository, not commits in the private source repository.

To view a saved build separately:

```sh
git fetch --tags
git worktree add ../simops-old build-20261027143005
cd ../simops-old
python -m http.server 8081 --bind 127.0.0.1
```

Replace the example tag with one that exists. Open `http://localhost:8081/` and
import your JSON again; browser history is separate for a different port.
