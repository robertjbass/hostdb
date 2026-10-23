# DocumentDB 1.0 native bundle

Native Linux x64 and ARM64 artifacts are published in [DocumentDB 1.0.0](https://github.com/robertjbass/hostdb/releases/tag/documentdb-1.0.0). The exact archive bytes passed [native qualification](https://github.com/robertjbass/hostdb/actions/runs/39735879439).

Tracker: https://github.com/Layerbase-LLC/layerbase-cloud/issues/3359

This engine packages the official DocumentDB MongoDB wire gateway, PostgreSQL
17.11, and DocumentDB extensions from GA tag `v1.0-0`, pinned to source commit
`b0cb0dae85e8746f4e0b79c847894179b2f80d64`. It is separate from
`postgresql-documentdb`, the existing FerretDB backend.

Build on native Linux x64 or ARM64:

```sh
./builds/documentdb/build-local.sh --version 1.0.0 --platform linux-x64 --output ./dist
```

Docker is a build dependency only. The output must run without Docker or a
system-installed PostgreSQL. The Ubuntu 22.04 builder enforces HostDB's glibc
2.35 floor. Defaults limit the builder to two CPUs and 3 GiB of RAM; adjust
`BUILD_JOBS` and `BUILD_MEMORY` only after checking shared-machine resources.

The archive contains `documentdb/bin/documentdb_gateway`, PostgreSQL client and
server tools, extension SQL/control files, shared libraries, upstream notices,
and `.hostdb-metadata.json`. Runtime qualification must move the bundle to a new
path before testing initialization, authentication, persistence, and restores.

The upstream gateway requires local passwordless PostgreSQL peer authentication.
SpinDB must isolate the backend behind an owner-only Unix socket and authenticate
MongoDB clients separately. Preserve upstream's getParameter rejection stub;
never turn an unsupported command into a fabricated success.

Publication requires approval and native checks on every advertised platform.
The release workflow publishes only a new tag, refuses replacement,
and prepares the registry snapshot for review through dev.

## macOS ARM64 release candidate

The macOS 14+ ARM64 bundle passed [native qualification](https://github.com/robertjbass/hostdb/actions/runs/39892712617) and [compiled SpinDB CLI lifecycle qualification](https://github.com/robertjbass/spindb/actions/runs/39893571815), including branch/reset, backup/restore, rename and exact-pin refusal. Build on Apple Silicon with:

```sh
pnpm download:documentdb -- --version 1.0.0 --platform darwin-arm64 --output ./dist
```

`--all-platforms` retains the Linux Docker build matrix; run Mac separately on Apple Silicon. Homebrew and Rust are build dependencies only. The tested archive is 46,067,988 bytes with SHA-256 `ffd3b2d2ade4c15143f56b2aba36d7bd7acfd599f5557f21965b9a8d3a4a11a8`. Publish these retained bytes after approval, add their checksum to the existing release metadata, and regenerate `releases.json` from that release before publishing HostDB 0.46.1. Do not rebuild or replace the existing Linux archives. The catalog changes on this branch are held until that publication gate passes.

Intel Mac is deferred. Native Windows compilation is blocked by Unix-only gateway imports; see [the Windows probe](https://github.com/robertjbass/hostdb/pull/258). Neither platform is advertised.
