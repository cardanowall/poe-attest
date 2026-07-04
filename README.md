# Label 309 PoE Attest

Anchor your build outputs, source commits, or precomputed digests on the Cardano
blockchain as a [Label 309](https://github.com/cardanowall/label-309) Proof of
Existence, directly from a GitHub workflow.

The action hashes what you give it, publishes the digest on-chain under metadata
label 309 through a gateway, and returns a transaction reference plus a signed
receipt. Anyone can later prove "this artifact existed on or before block time T"
from the transaction alone, using a public explorer and the open-source verifier.
No issuer identity, no vendor server, and no trust in this action are required at
verification time.

Think of it as blockchain-anchored build provenance alongside
[Sigstore](https://www.sigstore.dev/) / cosign: where cosign proves _who_ signed
an artifact against a transparency log, Label 309 proves _that_ an artifact
existed at a point in time against an independent public ledger. The proof
outlives the pipeline, the registry, and the vendor.

All hashing, canonical-CBOR encoding, and chain logic live in the audited
`cardanowall` CLI; this action is a thin, supply-chain-pinned wrapper that
resolves, verifies, and runs it.

## Quick start

```yaml
name: anchor
on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  attest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: cardanowall/poe-attest@v1
        with:
          gateway-url: https://cardanowall.com/api/v1
          api-key: ${{ secrets.CARDANOWALL_API_KEY }}
          paths: |
            dist/**/*.tar.gz
            dist/**/*.whl
```

The step prints a summary card with the transaction, a verify link, and the
price, and exposes outputs (`tx`, `record-id`, `verify-url`, ...) for later
steps.

> **The gateway is yours to choose.** `https://cardanowall.com/api/v1` in these
> examples is just one hosted gateway. The action is gateway-agnostic by
> construction: any [Label 309](https://github.com/cardanowall/label-309)
> gateway takes the same two values (`gateway-url` + `api-key`), including your
> own deployment of the open-source
> [label-309-gateway](https://github.com/cardanowall/label-309-gateway) — see
> [Self-hosted gateway](#self-hosted-gateway). Nothing in the proof ties you to
> any provider: verification needs only the public chain.

## Modes

Set **exactly one** of `paths`, `commits`, or `leaves`; the mode is inferred from
which you set.

| Mode       | Input     | What each leaf is                                                 |
| ---------- | --------- | ----------------------------------------------------------------- |
| files      | `paths`   | SHA-256 of each matched file's bytes                              |
| git        | `commits` | SHA-256 of each raw commit object in a rev-list range             |
| pre-hashed | `leaves`  | a 64-hex digest you computed elsewhere (e.g. an OCI image digest) |

One leaf publishes a single-item record; multiple leaves publish a Merkle record
whose root is anchored on-chain (with the leaf list optionally uploaded so every
item gets an inclusion certificate).

## Inputs

| Input                      | Default                   | Description                                                                                                                                               |
| -------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway-url`              | (required)                | Data-plane base URL of ANY Label 309 gateway, hosted or self-hosted, including the version segment (`https://cardanowall.com/api/v1` is just an example). |
| `api-key`                  | (required)                | Gateway API key (a prepaid, publish-only billing credential). Store as an encrypted secret.                                                               |
| `paths`                    |                           | Files to anchor, one path or glob per line.                                                                                                               |
| `commits`                  |                           | A git rev-list range (e.g. `v1.0..v1.1`, `HEAD`). Needs `fetch-depth: 0`.                                                                                 |
| `leaves`                   |                           | Precomputed 64-hex digests, one per line.                                                                                                                 |
| `publish`                  | `full-tree`               | Merkle publish mode: `full-tree` (upload the leaf list, bind its `ar://` URI) or `root` (root + count only).                                              |
| `anchor-manifest`          | `false`                   | Append SHA-256(manifest) as a final leaf (paths mode).                                                                                                    |
| `manifest-out`             | `poe-manifest.json`       | Where the deterministic manifest is written (paths mode).                                                                                                 |
| `seed`                     |                           | Optional identity seed (64-hex or `L309-SEED-1...`) for a record signature. See Security.                                                                 |
| `wait`                     | `confirmed`               | Lifecycle state to wait for: `confirmed` or `submitted`.                                                                                                  |
| `timeout`                  | `600`                     | Wait deadline in seconds. On expiry the step is pending, not failed (see below).                                                                          |
| `fail-on-timeout`          | `false`                   | Fail the step (instead of warning) when the wait times out.                                                                                               |
| `max-usd`                  |                           | Refuse to publish if the quote exceeds this USD amount (e.g. `1.50`).                                                                                     |
| `supersedes`               |                           | 64-hex tx hash of an earlier record this one replaces.                                                                                                    |
| `idempotency-key`          | `auto`                    | `auto` relies on the gateway's byte-identical dedup; any other value is sent verbatim.                                                                    |
| `certificates`             | `false`                   | Write one inclusion certificate per leaf (Merkle records). Requires `wait: confirmed`.                                                                    |
| `network`                  | `mainnet`                 | `mainnet` or `preprod`. Must agree with `gateway-url`.                                                                                                    |
| `receipt-out`              | `poe-receipt.json`        | Where the JSON receipt is written.                                                                                                                        |
| `upload-artifact`          | `auto`                    | Upload receipt/manifest/certificates as an artifact: `auto` (true on github.com), `true`, `false`.                                                        |
| `artifact-name`            | `poe-attest`              | Name of the uploaded artifact.                                                                                                                            |
| `attach-to-release`        | `false`                   | Attach the receipt/manifest/certificates to a release. Requires `contents: write`.                                                                        |
| `release-tag`              |                           | Explicit release tag; defaults to the release event, then a pushed tag.                                                                                   |
| `overwrite-release-assets` | `true`                    | Replace a same-named release asset instead of failing it.                                                                                                 |
| `github-token`             | `${{ github.token }}`     | Token for release attachment (`contents: write`).                                                                                                         |
| `verify-base`              | `https://cardanowall.com` | Base URL for the `verify-url` output.                                                                                                                     |
| `working-directory`        | `.`                       | Directory the CLI runs in; globs and git resolve against it.                                                                                              |
| `cli-version`              | (pinned)                  | Override the pinned CLI release. See Pinning the CLI.                                                                                                     |
| `cli-sha256`               |                           | SHA-256 pin for an overridden `cli-version`. See Pinning the CLI.                                                                                         |
| `cli-path`                 |                           | Use a preinstalled binary (self-hosted / air-gapped).                                                                                                     |

## Outputs

| Output             | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `tx`               | Cardano transaction hash of the anchor.                               |
| `root`             | Merkle root (Merkle records only).                                    |
| `leaf-count`       | Number of leaves in the Merkle record.                                |
| `ar-uri`           | `ar://` URI of the uploaded leaf list (full-tree Merkle records).     |
| `record-id`        | Gateway PoE id for the record.                                        |
| `status`           | Lifecycle status at exit (e.g. `confirmed`, `confirming`).            |
| `price-usd`        | Quoted price in USD (empty on a replayed run).                        |
| `balance-usd`      | Account balance in USD after this publish.                            |
| `replayed`         | `true` when the gateway deduplicated a byte-identical prior publish.  |
| `signer`           | ed25519 public key (hex) that signed the record, or empty.            |
| `verify-url`       | Label 309 verifier deep link for the transaction.                     |
| `explorer-url`     | Cardanoscan link for the transaction.                                 |
| `receipt-path`     | Absolute path to the JSON receipt.                                    |
| `manifest-path`    | Absolute path to the manifest (paths mode).                           |
| `certificates-dir` | Absolute path to the inclusion-certificates directory (when written). |
| `wait-target`      | The lifecycle target that was waited for.                             |
| `wait-reached`     | `true` when the wait target was reached before the timeout.           |
| `timed-out`        | `true` when the wait timed out (the publish continues server-side).   |

## Recipes

### Anchor release assets on publish

```yaml
on:
  release:
    types: [published]

permissions:
  contents: write # only needed for attach-to-release

jobs:
  attest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: cardanowall/poe-attest@v1
        with:
          gateway-url: https://cardanowall.com/api/v1
          api-key: ${{ secrets.CARDANOWALL_API_KEY }}
          paths: |
            dist/**/*.tar.gz
          certificates: true
          attach-to-release: true
```

Each artifact gets an inclusion certificate, and the receipt, manifest, and
certificates are attached to the release next to the binaries.

### Anchor commit history on push to main

```yaml
on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  attest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # commits mode needs full history
      - uses: cardanowall/poe-attest@v1
        with:
          gateway-url: https://cardanowall.com/api/v1
          api-key: ${{ secrets.CARDANOWALL_API_KEY }}
          commits: ${{ github.event.before }}..${{ github.sha }}
```

### Anchor a precomputed digest (e.g. an OCI image)

```yaml
- id: build
  run: echo "digest=$(skopeo inspect ... | jq -r .Digest | cut -d: -f2)" >> "$GITHUB_OUTPUT"
- uses: cardanowall/poe-attest@v1
  with:
    gateway-url: https://cardanowall.com/api/v1
    api-key: ${{ secrets.CARDANOWALL_API_KEY }}
    leaves: ${{ steps.build.outputs.digest }}
```

### Signed stream with a dedicated CI identity

```yaml
- uses: cardanowall/poe-attest@v1
  with:
    gateway-url: https://cardanowall.com/api/v1
    api-key: ${{ secrets.CARDANOWALL_API_KEY }}
    seed: ${{ secrets.CARDANOWALL_CI_SEED }}
    paths: dist/**/*.tar.gz
```

Signing adds a record-level signature and makes the record discoverable by
signer public key. Use a dedicated, environment-protected CI identity, never a
personal one. Signing is always optional; verifiers never require it.

### Self-hosted gateway

Point `gateway-url` at your own [gateway](https://github.com/cardanowall/label-309-gateway)
deployment. Set `network` to match it. Everything else is identical.

```yaml
- uses: cardanowall/poe-attest@v1
  with:
    gateway-url: https://gateway.internal.example.com/api/v1
    api-key: ${{ secrets.GATEWAY_API_KEY }}
    network: preprod
    paths: dist/**/*.tar.gz
```

## Pending and timeouts

By default the action waits up to `timeout` seconds for the transaction to
confirm. If the wait expires, the publish is **not** lost: it continues on the
gateway. The action writes every output and the receipt, sets `timed-out: true`,
and by default **succeeds** with a warning so a slow chain never fails your
build. Re-check later with the `record-id`. Set `fail-on-timeout: true` to make a
timeout fail the step instead.

## Pinning the CLI

The action embeds a pinned `cardanowall` CLI release and verifies both the
downloaded archive and the extracted binary against committed SHA-256 digests
before every run, including tool-cache hits on long-lived self-hosted runners.

- **Default:** nothing to do. The pinned version is fully digest-verified, and a
  cross-run tool-cache hit is re-verified against the embedded binary digest.
- **`cli-version`:** use a different release. A non-default version is verified
  against its release `SHA256SUMS` and re-downloaded on every run rather than
  trusted from a cross-run cache (its manifest pins archives, not the extracted
  binary, so there is no independent binary digest to re-verify a cache hit
  against). Add `cli-sha256` to also pin the archive digest yourself.
- **`cli-sha256`:** a single archive digest for the current platform, or one
  `<target>=<sha256>` per line for multi-platform pinning. If you supply a
  per-target map, it must include the current runner's target or the run fails.
- **`cli-path`:** use a preinstalled binary (self-hosted / air-gapped); a
  relative path resolves against the workspace (`GITHUB_WORKSPACE`). No download
  happens; pass `cli-sha256` to verify the binary digest.

Supported runners: Linux x64/arm64 (static musl, any distro), macOS x64/arm64,
Windows x64.

## Security

- **Never run this action with real secrets on an unguarded
  `pull_request_target` trigger.** That trigger exposes secrets to code from
  forked pull requests. Anchor from `push`, `release`, or `workflow_dispatch`
  events you control.
- **Least privilege.** The default job needs only `permissions: contents: read`.
  Add `contents: write` only when using `attach-to-release`.
- **The `api-key` is a prepaid, publish-only billing credential.** It cannot read
  your account, move funds, or sign as you. Store it as an encrypted secret;
  it is masked in logs and passed to the CLI via the environment only, never on
  the command line. Rotate or revoke it at any time.
- **The gateway must be reached over https.** The API key is sent to
  `gateway-url`, so plain `http://` is rejected except for loopback hosts
  (`localhost`, `127.0.0.0/8`, `[::1]`) used by local dev gateways.
- **Only regular files are published.** The receipt, manifest, and inclusion
  certificates are uploaded as an artifact or release asset only when they are
  real files; a symlink planted in the workspace is never followed, so it cannot
  exfiltrate an arbitrary file. The certificates directory is recreated empty
  before each run so no stale entry is attached.
- **Seed hygiene.** A `seed` is an identity signing key. Use a dedicated,
  disposable CI identity stored in an environment-protected secret, never a
  personal seed. It is masked and passed to the CLI via stdin only.
- **No secret ever reaches the gateway.** Hashing and signing happen locally in
  the CLI; only the resulting record and public data are published.
- The action strips every inherited `CARDANOWALL_*` environment variable before
  spawning the CLI, so a shared runner cannot inject a different gateway, key, or
  seed behind your back.

## GitHub Enterprise Server and self-hosted runners

- On GHES, `upload-artifact: auto` skips the artifact upload (the artifact
  backend is not always available). Set `upload-artifact: true` to force it.
- Behind a proxy, the standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`
  environment variables are honored for the CLI download.
- For air-gapped runners, preinstall the binary and pass `cli-path`.

## How it works

1. Resolve the runner platform to a CLI target and download + verify the pinned
   release (archive digest, then binary digest), caching it in the tool cache.
2. Spawn `cardanowall attest` with the API key in the environment, the base URL
   on argv, and the optional seed on stdin.
3. Parse the machine-readable JSON outcome, set outputs, write the step summary,
   and optionally upload an artifact and attach release assets.

The transaction and receipt are all a verifier needs. To verify independently:

```bash
cardanowall verify <tx> --file <artifact>   # from crates.io: cardanowall-cli
```

## License

Apache-2.0. See [`licenses.txt`](dist/licenses.txt) in the bundle for bundled
third-party notices.
