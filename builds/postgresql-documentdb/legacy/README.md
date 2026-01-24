# Legacy Homebrew-Based Build (Deprecated)

This directory contains the original macOS build script that used Homebrew's pre-built PostgreSQL binaries.

## Why This Was Replaced

The Homebrew-based approach created **non-relocatable binaries** because Homebrew uses a non-standard directory layout:

```text
Homebrew layout:
/opt/homebrew/opt/postgresql@17/bin/postgres    <- Binary location
/opt/homebrew/share/postgresql@17/extension/    <- Extension files (DIFFERENT prefix!)
/opt/homebrew/lib/postgresql@17/                <- Libraries (DIFFERENT prefix!)

Standard PostgreSQL layout:
$PREFIX/bin/postgres                            <- Binary location
$PREFIX/share/postgresql/extension/             <- Same prefix tree
$PREFIX/lib/postgresql/                         <- Same prefix tree
```

PostgreSQL is designed to be relocatable - it computes `sharedir` and `pkglibdir` relative to the binary location. But this only works when the directory structure follows the standard layout where `bin/`, `share/`, and `lib/` are under the same prefix.

With Homebrew's layout, PostgreSQL looked for extensions at the compiled-in paths (`/opt/homebrew/share/...`) instead of the bundled location (`~/.spindb/bin/...`).

## What The Old Script Did

1. Installed PostgreSQL via `brew install postgresql@17`
2. Copied Homebrew's PostgreSQL files to the bundle directory
3. Built extensions (DocumentDB, pg_cron, pgvector, rum) against this PostgreSQL
4. Fixed library paths with `install_name_tool`

## What The New Script Does

1. Downloads PostgreSQL source tarball
2. Builds from source with `--prefix=/usr/local/pgsql` (standard layout)
3. Installs to DESTDIR and moves to bundle directory
4. Builds extensions against the source-built PostgreSQL
5. Fixes library paths with `install_name_tool`

The key difference is that the source-built PostgreSQL has a standard layout, making it fully relocatable.

## How to Revert

If you need to restore the Homebrew-based build:

```bash
# Backup current script
mv build-macos.sh build-macos-source.sh

# Restore Homebrew-based script
cp legacy/build-macos-homebrew.sh build-macos.sh
```

## Alternative Workarounds (If Reverting)

If you revert to the Homebrew-based build, you'll need workarounds in SpinDB:

### Option 1: Symlink Workaround

Create symlinks from the compiled-in paths to the bundled paths:

```bash
# Requires sudo and creates system-wide symlinks
sudo mkdir -p /opt/homebrew/share
sudo ln -s ~/.spindb/bin/postgresql-documentdb-.../share/postgresql /opt/homebrew/share/postgresql@17
```

This is fragile and requires elevated permissions.

### Option 2: Environment Variables

Set `PGSHAREDIR` and `PKGLIBDIR` environment variables before starting PostgreSQL:

```bash
export PGSHAREDIR=~/.spindb/bin/.../share/postgresql
export PKGLIBDIR=~/.spindb/bin/.../lib/postgresql
```

This requires modifying every PostgreSQL invocation.

### Option 3: Build from Source (Recommended)

The new approach - build PostgreSQL from source with a standard layout. This is the cleanest solution and what the current build script implements.

## Files in This Directory

- `build-macos-homebrew.sh` - The original Homebrew-based build script (for reference)
- `README.md` - This documentation

## Related Documentation

- SpinDB: `plans/FERRETDB.md` - Extension Loading Fix section
- PostgreSQL: `doc/installation.sgml` - Relocation documentation
