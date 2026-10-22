# DocumentDB 1.0 native bundle

Native x64 and ARM64 artifacts are published in [DocumentDB 1.0.0](https://github.com/robertjbass/hostdb/releases/tag/documentdb-1.0.0). The exact archive bytes passed [native qualification](https://github.com/robertjbass/hostdb/actions/runs/39735879439).

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
and prepares the registry snapshot for review through dev. macOS and Windows are not advertised by this recipe.
