# Legacy: original 2021 CDT material

This directory preserves the original Certificate of Deposit Token (CDT) work
from July–August 2021 by Noah Jones, unmodified, for historical reference.

## Contents

- **`CDT01 Application/`**, **`CDT01 Application.md`**, **`CDT01 Application Resources/`** —
  the Plutus-era application build. The Haskell code is based on the Plutus
  Pioneer Program week-06 oracle; `cabal.project` pins the spring-2021 `plutus`
  commit `476409ea` (index-state 2021-04-13), and the code targets the GHC
  8.10.x series (originally built with GHC 8.10.4). It is no longer buildable
  against modern toolchains and is being superseded by the rebuilt `onchain/`
  and `offchain/` code elsewhere in this repository. It is kept here for
  provenance only.
- **`CDT02 Proposal/`**, **`CDT02 Proposal.md`**, **`CDT02 Proposal Resources/`** —
  the business proposal track: meeting notes with CampusUSA Credit Union,
  notes toward a Project Catalyst Fund6 submission (the official Fund6 Launch
  Guide PDF is among the reference material), the "Decentralized Partially
  Autonomous Organization" (DPaO) essay, and reference PDFs. Some
  subdirectories are Apple `.pages` document bundles (directories of binary
  parts), preserved as-is.
- **`CDT03 Application/`** — a pristine reference copy of the upstream Plutus
  Pioneer Program Week06 oracle module (`main.hs`).

## What was removed

During the 2026 repository cleanup the following were deleted rather than
moved here:

- `CDT01 Application/dist-newstyle/` — generated cabal build output and
  vendored dependency tarballs (`dist-newstyle/` is ignored repo-wide going
  forward)
- Editor backup files (`*~`) at the repository root and throughout these
  directories
- `CDT02 Proposal/test.js`, `test.md`, `test.py` — unrelated coding-challenge
  scratch files that had been committed alongside the proposal

Nothing else was modified; file names and contents are as they were in 2021.
