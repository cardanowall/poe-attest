# Changelog

All notable changes to the Label 309 PoE Attest action are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/). Consume
the action by major tag — `uses: cardanowall/poe-attest@v1` — to track the newest
compatible release.

## [1.1.0] - 2026-07-28

### Changed

- Pin the default `cardanowall` CLI to 0.12.0, with refreshed per-target archive
  and binary SHA-256 digests. The action's inputs, outputs, and default
  behaviour are unchanged; the pinned CLI gains streaming passphrase sealing and
  opening, which matters only to a workflow that seals large payloads with
  `cli-version` left at the default.

## [1.0.1] - 2026-07-06

### Changed

- Pin the default `cardanowall` CLI to 0.11.0, with refreshed per-target archive
  SHA-256 digests. The action's default behaviour is unchanged; the new CLI's
  capabilities (co-hashes across the publishing commands, passphrase seal/open,
  local and out-of-band verification) are available to advanced workflows via
  the `cli-version` input.

## [1.0.0] - 2026-07-04

### Added

- Initial public release of the **Label 309 PoE Attest** GitHub Action. Anchor
  file hashes (`paths`), git commit provenance (`commits`), or precomputed
  digests (`leaves`) on Cardano as a Label 309 Proof of Existence, directly from
  a workflow. One leaf publishes a single-item record; multiple leaves publish an
  RFC 9162 Merkle record (`full-tree` uploads the leaf list, `root` keeps it
  private).
- Supply-chain-pinned CLI acquisition: the embedded `cardanowall` CLI release is
  verified against committed SHA-256 digests for both the downloaded archive and
  the extracted binary, on every run — including tool-cache hits on long-lived
  self-hosted runners. `cli-version` / `cli-sha256` / `cli-path` override the
  default for pinned, self-hosted, or air-gapped runners.
- Secret hygiene: the `api-key` is masked and passed only through the
  environment; an optional signing `seed` is masked and passed only through
  stdin; inherited `CARDANOWALL_*` environment variables are stripped before the
  CLI spawns.
- Lifecycle waiting (`wait`, `timeout`, `fail-on-timeout`), a price ceiling
  (`max-usd`), byte-identical publish dedup, optional per-leaf inclusion
  certificates, a versioned JSON receipt, a step-summary card, and optional
  workflow-artifact upload and release-asset attachment.
