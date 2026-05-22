# builds/common

Shared build scripts used by all engine release workflows, plus general reference material for macOS native builds.

## Shared scripts

### `validate-binaries.sh <database> <release-assets-dir>`

Every release workflow validates that archives contain all required binaries before creating the GitHub Release. This prevents shipping incomplete releases (e.g., PostgreSQL 17.7.0 once shipped without `psql`, `pg_dump`, and other client tools, breaking SpinDB's backup/restore).

The script:

1. Extracts the version from archive filenames (e.g., `mysql-9.6.0-darwin-arm64.tar.gz` → `9.6.0`).
2. Checks for version-level `cliTools` overrides in `databases.json`, then falls back to engine-level `cliTools`.
3. Collects all non-null binary names (skips `enhanced` tools).
4. For each `.tar.gz` / `.zip` in the release-assets directory, extracts and searches for each required binary.
5. Fails the build with clear errors if any binary is missing.

**Dependency-aware:** Some databases depend on others for client tools. For example, QuestDB lists `psql` as its client but depends on PostgreSQL — `psql` comes from the PostgreSQL install, not the QuestDB tarball. The script reads `dependencies` from `databases.json` (top-level and per-version) and skips binaries provided by dependency databases.

**Name-variant handling:** The script handles naming differences between `cli_tools` and actual binaries:
- Windows extensions: `.exe`, `.cmd`, `.bat`
- Hyphen-to-underscore: `typedb-console` → `typedb_console`, `typedb_console_bin`
- Searches recursively through the entire extracted archive (handles `bin/`, root, and custom paths like TypeDB's `server/` and `console/`).

**Used by:** all 21 release workflows. Add a "Validate required binaries" step in each workflow's `release` job, after artifact preparation and before "Create Release":

```yaml
- name: Validate required binaries
  run: |
    chmod +x builds/common/validate-binaries.sh
    ./builds/common/validate-binaries.sh <database-id> ./release-assets
```

### `fix-macos-dylibs.sh <package-root>`

macOS source builds that link against Homebrew (OpenSSL, pcre2, etc.) produce binaries with absolute paths like `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib`. These break on any Mac without those exact Homebrew packages installed.

The script makes packages relocatable by:

1. Bundling Homebrew dylibs into the package's `lib/` directory.
2. Rewriting all absolute paths to `@loader_path` relative references.
3. Re-signing modified binaries (macOS requires this after `install_name_tool` changes).
4. Verifying no Homebrew paths remain (fails the build if any found).

**When to use:** Add to any release workflow's macOS build step if the database links against Homebrew libraries at build time. Insert between metadata creation and tarball creation:

```bash
chmod +x "$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh"
"$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh" "$GITHUB_WORKSPACE/install/<database>"
```

**Currently used by:** MariaDB, Redis, Valkey, CouchDB. PostgreSQL-DocumentDB has its own inline implementation (see `builds/postgresql-documentdb/build-macos.sh`).

### `check-macos-dylibs.sh [<path>]`

Diagnostic — scans packages for non-relocatable Homebrew paths without modifying anything. Runs locally via `pnpm check:dylibs [-- <path>]`. The `audit-dylibs` workflow (`workflow_dispatch`) audits published releases on R2.

---

## macOS native build reference

Native macOS builds (darwin-x64, darwin-arm64) require careful SDK configuration and dylib path rewriting. This section is the general reference; per-engine specifics live in each engine's build script.

### SDK conflict: Xcode vs Command Line Tools

**The problem.** CMake can find libraries from Command Line Tools (`/Library/Developer/CommandLineTools/SDKs/`) while using Xcode's SDK for compilation. This causes C++ header search-path errors like:

```
error: <cstddef> tried including <stddef.h> but didn't find libc++'s <stddef.h> header.
```

**The fix.** Force all tools to use a single SDK by:

1. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (not Command Line Tools).
2. Export `SDKROOT`, `CC`, `CXX`, `CFLAGS`, `CXXFLAGS`, `LDFLAGS` with `--sysroot`.
3. Use `CMAKE_FIND_ROOT_PATH` to restrict library search to Xcode SDK + Homebrew only.
4. Run cmake via `xcrun` to inherit the correct environment.

See `release-mariadb.yml` for a working example of this configuration.

### Why build from source instead of Homebrew?

Homebrew binaries have **hardcoded absolute paths** (e.g., `/opt/homebrew/lib/libssl.3.dylib`). For relocatable binaries that work on any machine:

1. Build the database from source with relative paths.
2. Build any extensions (PostGIS, DocumentDB) from source against that build.
3. Bundle all Homebrew dependencies and rewrite their paths.

### macOS dylib path prefixes

| Prefix | Meaning | When to use |
|---|---|---|
| `@rpath` | Search paths defined in the binary's LC_RPATH | Libraries that could be in multiple locations |
| `@loader_path` | Directory containing the loading binary | Bundled libraries next to executables |
| `@executable_path` | Directory containing the main executable | App bundles |

**`fix-macos-dylibs.sh` uses `@loader_path`** because hostdb tarballs ship the binary and its dylibs side-by-side in `bin/` and `lib/`.

### Workflow for making binaries relocatable

1. **Copy dependencies recursively** — use `otool -L` to find dependencies; copy non-system libs into the bundle.
2. **Handle `@rpath` references** — resolve by searching Homebrew locations (`/opt/homebrew/lib`, `/usr/local/lib`).
3. **Rewrite paths with `install_name_tool`:**

   ```bash
   # Change library's own ID
   install_name_tool -id "@loader_path/libfoo.dylib" libfoo.dylib

   # Change a reference to another library
   install_name_tool -change "/opt/homebrew/lib/libbar.dylib" "@loader_path/libbar.dylib" libfoo.dylib

   # Add rpath
   install_name_tool -add_rpath "@loader_path" binary

   # Remove Homebrew rpaths
   install_name_tool -delete_rpath "/opt/homebrew/lib" binary
   ```

4. **Re-sign after modification** — macOS requires code signing after any binary modification:

   ```bash
   codesign -s - --force --preserve-metadata=entitlements,requirements,flags,runtime binary
   ```

### Recursive dependency bundling

Libraries have transitive dependencies. A recursive routine is needed:

```bash
copy_lib_recursive() {
  local lib_path="$1"
  # Skip system libraries (/usr/lib/*, /System/*)
  # Skip already-processed libraries (track in a file)
  # Copy to bundle if from Homebrew
  # Recursively process dependencies from otool -L
  # Handle @rpath references by searching known locations
  # Handle @loader_path references relative to library directory
}
```

**Don't miss extension dylibs.** If an engine has a `lib/postgresql/` (or similar) subdirectory of extension dylibs, scan it too — extension dylibs can reference Homebrew libraries that aren't dependencies of anything in `bin/`. The bundler must follow them or `dlopen` fails at runtime. See `builds/postgresql-documentdb/build-macos.sh` step 10 for the reference implementation.

---

## Linux ARM64 builds (QEMU)

ARM64 Linux builds use QEMU emulation on x64 runners:

- Build times: 45–90+ minutes (vs 3–5 minutes for native).
- Builds can appear "frozen" during long compilation steps — that's normal.
- Use `docker buildx` with `--platform linux/arm64`.

---

## Workflow concurrency

Release workflows use concurrency groups to prevent conflicts:

```yaml
concurrency:
  group: release-<engine>
  cancel-in-progress: false
```

Only one build runs at a time per engine — subsequent triggers are queued, not cancelled.
