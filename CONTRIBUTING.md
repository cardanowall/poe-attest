# Contributing to cardanowall/poe-attest

Thank you for your interest in improving the **Label 309 PoE Attest** GitHub
Action — a thin, supply-chain-pinned wrapper that anchors file hashes, git
commits, or precomputed digests on Cardano as a **Proof of Existence (PoE)**
through the `cardanowall` CLI.

All hashing, canonical-CBOR encoding, verification, and chain logic live in the
`cardanowall` CLI / SDK. This repository owns only the Action surface: input
parsing, CLI acquisition + digest verification, the spawn, and the receipt /
artifact / release handling.

All contributions are made under the terms in [Licensing](#licensing) and the
[Developer Certificate of Origin](#developer-certificate-of-origin-dco).

---

## What belongs in this repository

The GitHub Action wrapper: `action.yml`, the TypeScript in `src/`, the committed
bundle in `dist/`, the maintainer scripts, and the tests.

What does **not** belong here:

- **Verification or cryptographic logic**, the wire-format types, sealed-PoE, or
  Merkle code — those live in the `cardanowall` CLI (`label-309-cli`) and the Rust
  SDK (`label-309-rs`). The action shells out to the CLI; it re-implements none of
  it.
- **Changes to the wire format, grammar, schemas, registries, or the conformance
  vectors** belong in the `label-309` standard repository.

If you are unsure, open an issue here and ask.

---

## Building and testing

A recent Node.js (**24+**) is all you need.

```sh
npm ci
npm run typecheck
npm test
npm run build       # regenerate the committed dist/ bundle
npm run check:dist  # assert dist/ is in sync with src/
```

CI runs `typecheck`, `test`, and `check:dist`. A pull request must pass all three.

### The committed bundle

The Actions runner loads `dist/index.js` directly from the tagged repository
tree, so the bundle is **committed**, not built on the runner. Any change under
`src/` must be followed by `npm run build` and a commit of the updated `dist/`.
`check:dist` enforces this by rebuilding into a temp directory and byte-comparing;
a source change without a rebuilt `dist/` fails CI.

---

## Pull request checklist

- [ ] The change is in the right repository (this Action vs. the CLI vs. the
      standard).
- [ ] `npm run typecheck`, `npm test`, and `npm run check:dist` all pass.
- [ ] If you changed `src/`, you ran `npm run build` and committed `dist/`.
- [ ] Secrets (`api-key`, `seed`) are never placed on argv, logged, or written to
      an output — follow the existing environment / stdin passing.
- [ ] Every commit is signed off (see DCO below).

---

## Style and house rules

- Keep the action **gateway-agnostic**: the gateway base URL and API key are
  inputs; do not wire behaviour around any particular hosted service.
- Never place a secret on the command line. argv leaks into process listings and
  logs; pass the API key through the environment and the seed through stdin.
- Cite only stable, public references in comments — RFCs, CIPs at a permanent
  address, NIST/FIPS publications, and the like.

---

## Developer Certificate of Origin (DCO)

This project uses the **Developer Certificate of Origin**. There is **no CLA**.

The DCO is a lightweight attestation that you have the right to submit your
contribution under the project's license. You make it by adding a
`Signed-off-by` line to every commit:

```
Signed-off-by: Your Name <your.email@example.com>
```

Add it automatically with `git commit -s`. The name and email must be real and
match the commit author. By signing off, you certify the statements in the
Developer Certificate of Origin, version 1.1:

> **Developer Certificate of Origin, Version 1.1**
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the
> right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my
> knowledge, is covered under an appropriate open source license and I have the
> right under that license to submit that work with modifications, whether
> created in whole or in part by me, under the same open source license (unless
> I am permitted to submit under a different license), as indicated in the file;
> or
>
> (c) The contribution was provided directly to me by some other person who
> certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public
> and that a record of the contribution (including all personal information I
> submit with it, including my sign-off) is maintained indefinitely and may be
> redistributed consistent with this project or the open source license(s)
> involved.

---

## Licensing

By contributing, you agree that your contributions are licensed under the
project's **Apache License 2.0** (see [`LICENSE`](LICENSE)).

## Code of Conduct

All participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
Please read it before contributing.

## Security

Do not report security-impacting issues through public issues or pull requests.
Follow the private process in our [Security Policy](SECURITY.md).
