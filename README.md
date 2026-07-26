# web-bootloader

A cryptographically verified web page loader. It fetches a JSON config from a URL, downloads the page, verifies one or more post-quantum (ML-DSA-65) signatures over both the URL and the content, and renders it — or shows a full-screen error if verification fails.

## How it works

1. Fetches `VITE_CONFIG_URL` → JSON `{ "url": "...", "contentSize": 37729, "urlSignatures": ["...", "..."], "contentSignatures": ["...", "..."] }` (`contentSize` is optional and only drives the progress indicator)
2. Verifies every ML-DSA-65 `urlSignatures[i]` against the UTF-8 bytes of `url` (count must match configured keys)
3. Fetches the page from `url`
4. Verifies every ML-DSA-65 `contentSignatures[i]` against the raw HTML bytes
5. On success: renders the page via `document.write`
6. On failure: shows a localized error screen (ru / en / fa / zh)

## Hosting the boot page

The bootloader (`dist/index.html`) must be hosted at a URL that **guarantees immutability** — once published, the content at that URL must never change. If the bootloader file changes, users could be served a tampered version.

Suitable options:

- **IPFS** — content-addressed by default; use any public gateway or your own node
- **AWS S3** with [versioning enabled](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) — use a versioned object URL (`?versionId=...`)
- **Google Cloud Storage** with [object versioning](https://cloud.google.com/storage/docs/object-versioning) — use a generation-number URL (`#<generation>`)

The JSON config file (pointed to by `VITE_CONFIG_URL`) may be hosted on any mutable URL — it is signed, so tampering is detected.

## Configuration

Copy `.env` values and override in `.env.local` (never committed):

| Variable | Description |
|---|---|
| `VITE_CONFIG_URL` | URL of the JSON config file |
| `VITE_PUBLIC_KEYS` | ML-DSA-65 public keys, base64-encoded, separated by `\|` — at least one **required** |

The number of keys must match the number of entries in both `urlSignatures` and `contentSignatures` in the config JSON.

## Key generation

Run once per signer. Creates `.keys/<name>.key` (private) and `.keys/<name>.pub` (public). The `.keys/` directory is gitignored.

```bash
npm run keygen -- alice
npm run keygen -- bob
```

Keep `.key` files safe — if lost, a new key pair must be generated and the bootloader rebuilt.

Add public keys to `.env.local`, separated by `|`:

```ini
VITE_PUBLIC_KEYS=<contents of .keys/alice.pub>|<contents of .keys/bob.pub>
```

## Signing a release

After publishing the page to its immutable URL, fetch and sign it to produce `config.json` for `VITE_CONFIG_URL`.

```bash
# Uses all *.key files from .keys/ automatically
npm run sign -- --url https://your-immutable-url/page.html

# Or specify keys explicitly
npm run sign -- --url https://your-immutable-url/page.html --keys .keys/alice.key,.keys/bob.key

# Sign bytes that were already fetched and checked, and refuse to sign anything else
npm run sign -- --url https://your-immutable-url/page.html --file page.html --sha256 <hash-from-the-build>
```

This fetches the live page, signs both the URL and the content, and writes `config.json` (gitignored) — publish it to `VITE_CONFIG_URL`.

`--sha256` compares the page against the hash printed by the build before anything is signed, so a
release can never be signed under the wrong URL or after the hosted object changed. `--file` signs a
local copy instead of re-downloading, which lets the caller validate the bytes first — for example by
checking build provenance — and then sign exactly those bytes.

The order of keys must match the order of public keys in `VITE_PUBLIC_KEYS`.

### Signers who hold their own key

When the private keys live with different people, nobody has to hand a key over. Each signer signs
the same URL separately and sends back their `config.json`; the release manager then merges the
signature arrays into one file:

```json
{
  "url": "…same url everyone signed…",
  "contentSize": 37729,
  "urlSignatures": ["<alice>", "<bob>"],
  "contentSignatures": ["<alice>", "<bob>"]
}
```

**Both arrays must list signatures in the same order as the keys in `VITE_PUBLIC_KEYS`** — the
bootloader checks `signatures[i]` against `keys[i]`, so a swapped pair fails verification even though
every individual signature is valid. It fails closed: the page refuses to load rather than loading
unverified content, so a merge mistake costs a retry, not a compromise.

Every signer must sign the exact same URL string, character for character, and `contentSize` must
match the page they signed.

### Signing without a local Node.js

A signer only needs Docker. The image carries the dependencies but not `scripts/`, so mount those
from the checkout, and mount an **empty** directory as the working directory — mounting the
repository itself would expose an existing `.keys/` to the container.

```bash
git clone https://github.com/grodno-grab/web-bootloader.git
cd web-bootloader && docker build -t web-bootloader .
REPO=$(pwd)

mkdir -p ~/signing && cd ~/signing

# Generate a key pair once. The public half is printed — publish it somewhere verifiable.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$REPO/scripts:/app/scripts:ro" -v "$(pwd):/work" -w /work \
  web-bootloader node /app/scripts/keygen.mjs alice

# Sign a release; config.json lands in the working directory
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$REPO/scripts:/app/scripts:ro" -v "$(pwd):/work" -w /work \
  web-bootloader node /app/scripts/sign.mjs --url https://your-immutable-url/page.html
```

## Cryptography

Algorithm: **ML-DSA-65** (CRYSTALS-Dilithium level 3, NIST FIPS 204).
Library: [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) — pure JS, no WASM, audited by Cure53.

What is signed:
- `urlSignatures`: UTF-8 bytes of the page URL string
- `contentSignatures`: raw bytes of the HTML page content

## Build

### Docker (recommended)

The canonical build uses Docker to guarantee a reproducible environment. The image pins Node.js to an exact version; `npm ci --ignore-scripts` installs all packages exactly as pinned in `package-lock.json`.

```bash
# Build the image once (no secrets inside)
docker build -t bootloader-builder .

# Build the bootloader — .env.local is mounted at runtime, never baked into an image layer
docker run --rm \
  -v "$(pwd)/.env.local:/app/.env.local:ro" \
  -v "$(pwd)/dist:/app/dist" \
  bootloader-builder
# output: dist/index.html (~37 KB)
```

### Local (development only)

```bash
npm ci
npm run build        # reads .env + .env.local
```

## CI / GitHub Actions

The repository includes `.github/workflows/build.yml`. On every push to `master` it:

1. Builds the Docker image from the pinned `Dockerfile`
2. Creates `.env.local` from repository variables
3. Runs the Docker build
4. Prints the SHA-256 hash of the output to the job log
5. Creates a [SLSA build provenance attestation](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds) for `dist/index.html`
6. Uploads `dist/index.html` as a downloadable artifact
7. Deploys to Google Cloud Storage and posts the versioned URL to the job summary

**Setting up variables** (`Settings → Secrets and variables → Actions → Variables`):

| Name | Kind | Description |
|---|---|---|
| `VITE_CONFIG_URL` | Variable | URL of the JSON config file |
| `VITE_PUBLIC_KEYS` | Variable | Public keys separated by `\|`, same as in `.env.local` |
| `GCS_BUCKET` | Variable | Google Cloud Storage bucket name |
| `GCS_OBJECT` | Variable | Object path within the bucket |
| `GCS_CREDENTIALS` | Secret | JSON service-account key with write access |

`VITE_*` variables are stored as **Variables** (not Secrets) because they end up embedded in the public build output anyway. No signing key is stored in this repository's CI — its workflow only builds and deploys, and `npm run sign` is run by hand. A project that automates signing in its own workflow keeps the key in that project's secrets, and should pass `--file`/`--sha256` so the key is only ever used on bytes that were checked first.

All three `GCS_*` settings must be configured; if any is missing the deploy step fails the workflow.

## Verification

Any two builds from the same source, env variables, and Node.js version produce byte-identical output. Use SHA-256 to confirm this across local, CI, and hosted copies.

```bash
# 1. Build locally with Docker and capture hash
docker build -t bootloader-builder .
docker run --rm \
  -v "$(pwd)/.env.local:/app/.env.local:ro" \
  -v "$(pwd)/dist:/app/dist" \
  bootloader-builder
sha256sum dist/index.html

# 2. Download the CI artifact (GitHub Actions → your run → Artifacts → index.html)
# GitHub serves artifacts as ZIP — unzip first
unzip -o ~/Downloads/index.html.zip -d ~/Downloads/
sha256sum ~/Downloads/index.html

# 3. Hash the hosted page
curl -fsSL https://YOUR_HOSTED_URL | sha256sum
```

All three hashes must match. Any discrepancy means either the source code, env variables, Node.js version, or the hosted file differs from what was built.

### Verifying a hosted boot page without the project's `.env.local`

Anyone can check that a published boot page was built from this repository, without access to any
private file. `.env` here holds placeholders, so pass the real values as environment variables — both
are public and readable in the hosted page itself: the config URL and the `|`-separated public keys.

```bash
docker build -q -t bootloader-builder .
docker run --rm \
  -e VITE_CONFIG_URL="https://your-config-url/config.json" \
  -e VITE_PUBLIC_KEYS="<key1>|<key2>" \
  -v "$(pwd)/dist:/app/dist" bootloader-builder
diff <(curl -fsSL "https://your-hosted-boot-page") dist/index.html && echo identical
```

Environment variables take precedence over `.env`, so this rebuilds exactly what CI produced. The
same check should be repeated after every change to the signer set, since adding or removing a key
changes the built page.

## Development

```bash
npm start    # Vite dev server at http://localhost:5173
```

In dev mode the app will try to fetch from the configured `VITE_CONFIG_URL`. Set it to a working value in `.env.local` for a functional dev experience.

## Output size

| Component | Size |
|---|---|
| Preact | ~4 KB |
| @noble/post-quantum (ml-dsa65 only) | ~22 KB |
| App + i18n | ~3 KB |
| **Total (minified, inlined)** | **~37 KB** (~17 KB gzipped) |
