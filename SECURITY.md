# Security Policy

`cardanowall/poe-attest` is a GitHub Action that anchors file hashes, git
commits, or precomputed digests on Cardano as a Label 309 Proof of Existence. It
runs inside your CI with access to an API key and, optionally, a signing seed, so
we take reports seriously and ask that they be handled responsibly.

## Scope

This repository holds the **GitHub Action wrapper**: input parsing, the pinned
`cardanowall` CLI acquisition (archive + binary digest verification), secret
handling (masking, environment-only / stdin-only passing), the CLI spawn, and the
receipt / artifact / release-asset handling.

In scope for a report here:

- A flaw that leaks the `api-key` or `seed` — for example a secret written to a
  log, echoed to an output, passed on the command line, or persisted to disk with
  unsafe permissions.
- A supply-chain flaw in the CLI acquisition — a path where the downloaded
  archive or the extracted binary is executed without matching its committed
  SHA-256 pin, or where a non-default `cli-version` bypasses verification.
- A flaw that lets a workflow event or a shared runner inject a different
  gateway, key, or seed than the caller configured.

Out of scope here (report it in the relevant repository instead):

- A flaw or ambiguity in the **standard** itself — report it in the `label-309`
  standard repository.
- A bug in the verification or cryptographic logic — that lives in the
  `cardanowall` CLI / SDK (`label-309-cli` / `label-309-rs`).
- A flaw in the **gateway** server — report it in `label-309-gateway`.

## Core security goals

A report is **high priority** if it undermines any of these guarantees:

- **Secret hygiene.** The `api-key` and `seed` are masked, passed only through
  the environment (key) or stdin (seed), and never appear on argv, in logs, or in
  outputs.
- **Verified execution.** The action runs only a `cardanowall` binary whose
  archive and executable both match a committed SHA-256 pin, on every run —
  including tool-cache hits on long-lived self-hosted runners.
- **No secret reaches the gateway.** Hashing and signing happen locally in the
  CLI; only the resulting record and public data are published.

## Reporting a vulnerability

**Please report privately. Do not open a public issue for a security report.**

Preferred channel: GitHub's **private vulnerability reporting** for this
repository (the *Security* tab -> *Report a vulnerability*).

Alternative contact: `hello@cardanowall.com`.

Please include, as far as you can: a clear description of the issue and the
security property it breaks, a minimal reproduction (a workflow snippet or
steps), and the impact with any suggested remediation.

## What to expect

- We aim to acknowledge a report promptly and to keep you informed as we
  investigate.
- We practise **coordinated disclosure**: we will agree a disclosure timeline
  with you, fix the issue, and credit you unless you prefer otherwise.

Thank you for helping keep Label 309 trustworthy.
