# hostdb

Pre-built database binaries for multiple platforms, distributed via GitHub Releases.

**Primary consumer:** [spindb](https://github.com/robertjbass/spindb) - a CLI tool for spinning up local database instances

**Inspiration:**
- [embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries) - PostgreSQL binaries built from source for multiple platforms (strong influence on build approach)
- [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) - Embedded MariaDB for Java (partial influence on packaging patterns)

## Supported Platforms

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## How It Works

1. **Build scripts** download official binaries from vendor CDNs
2. **GitHub Actions** repackage and upload to GitHub Releases
3. **releases.json** provides a queryable manifest of all available binaries
4. **SpinDB** (or any consumer) fetches releases.json and downloads binaries

### Future CLI (Phase 4)
```bash
# Planned - not yet implemented
pnpx hostdb list
pnpx hostdb download mysql@8.4.3
```


## Project Structure

```
hostdb/
├── databases.json          # Source of truth for all databases
├── downloads.json          # CLI tools, prerequisites, fallback downloads
├── releases.json           # Manifest of all GitHub Releases (queryable)
├── schemas/
│   ├── databases.schema.json
│   ├── downloads.schema.json
│   ├── sources.schema.json
│   └── releases.schema.json
├── scripts/
│   ├── list-databases.ts   # Database listing utility (pnpm dbs)
│   └── update-releases.ts  # Updates releases.json after GH Release
├── builds/                 # Download/build configurations
│   └── mysql/
│       ├── download.ts     # Downloads official binaries
│       ├── sources.json    # Version → URL mappings
│       ├── Dockerfile      # Fallback: build from source
│       ├── build-local.sh  # Fallback: local Docker build
│       └── README.md
├── cli/                    # TUI tool for downloading (Phase 4 - not yet created)
└── .github/workflows/
    ├── release-mysql.yml   # Creates GitHub Releases for MySQL
    └── version-check.yml   # PR version check (for future CLI package)
```

## Package Configuration

The root `package.json` has `"private": true` because:
- The root package is not published to npm (it's just build tooling)
- Only the future `cli/` package will be published as `@hostdb/cli` or `hostdb`
- This prevents accidental `npm publish` from the root

## Configuration Files

All configuration files have JSON schemas for validation and IDE autocomplete. **If you modify the structure of these files (add/remove/rename keys), you must also update the corresponding schema file.**

| Config File | Schema File | Description |
|-------------|-------------|-------------|
| `databases.json` | `schemas/databases.schema.json` | Database metadata, versions, platforms |
| `downloads.json` | `schemas/downloads.schema.json` | Unified download/install registry |
| `builds/*/sources.json` | `schemas/sources.schema.json` | Official binary download URLs per version/platform |
| `releases.json` | `schemas/releases.schema.json` | Manifest of all GitHub Releases (queryable by SpinDB) |

### databases.json

Central configuration for all supported databases. Each database entry includes:

```json
{
  "displayName": "PostgreSQL",
  "description": "Advanced open-source relational database...",
  "type": "Relational",
  "sourceRepo": "https://github.com/postgres/postgres",
  "license": "PostgreSQL",
  "status": "in-progress",
  "commercialUse": true,
  "protocol": null,
  "note": "",
  "latestLts": "18",
  "versions": { "18.1": true, "17.7": true },
  "platforms": { "linux-x64": true, "darwin-arm64": true, ... },
  "cliTools": {
    "server": "postgres",
    "client": "psql",
    "utilities": ["pg_dump", "pg_restore", "pg_basebackup"],
    "enhanced": ["pgcli", "usql"]
  },
  "connection": {
    "runtime": "server",
    "defaultPort": 5432,
    "scheme": "postgresql",
    "defaultDatabase": "postgres",
    "defaultUser": "postgres",
    "queryLanguage": "SQL"
  }
}
```

**Connection fields:**
- `runtime`: "server" (runs as process) or "embedded" (file-based like SQLite, DuckDB)
- `defaultPort`: TCP port (null for embedded databases)
- `scheme`: URI scheme for connection strings (postgresql, mysql, redis, mongodb, sqlite, http, fdb, etc.)
- `defaultDatabase`: Default database name ("postgres", "0" for Redis, null for embedded)
- `defaultUser`: Default superuser ("postgres", "root", null for no-auth)
- `queryLanguage`: SQL, AQL, MQL, Redis, HTTP, InfluxQL, PromQL, or API (native bindings)

### downloads.json

Unified registry for all downloadable items: databases, CLI tools, and prerequisites. Supports recursive dependencies (e.g., CouchDB requires Erlang).

**Item types:**
- `database` - Database binaries with package manager, direct download, and Docker options
- `cli-tool` - CLI tools with category (server, client, utility, enhanced) and bundledWith reference
- `prerequisite` - Build/runtime dependencies (Erlang, JRE, Python, Rust, Go, Node.js, build-essential)

**Database example:**
```json
{
  "name": "PostgreSQL",
  "description": "Advanced open-source relational database",
  "type": "database",
  "packages": {
    "brew": { "package": "postgresql@17" },
    "apt": { "package": "postgresql", "repo": "https://apt.postgresql.org/pub/repos/apt" }
  },
  "binaries": {
    "linux-x64": { "url": "https://...", "format": "tar.gz" },
    "darwin-arm64": { "url": "https://...", "format": "zip" }
  },
  "docker": { "image": "postgres", "tag": "17.2" },
  "requires": []
}
```

**CLI tool example:**
```json
{
  "name": "pgcli",
  "description": "PostgreSQL CLI with auto-completion and syntax highlighting",
  "type": "cli-tool",
  "binary": "pgcli",
  "category": "enhanced",
  "bundledWith": null,
  "packages": { "brew": { "package": "pgcli" }, "pip": { "package": "pgcli" } },
  "requires": ["python"]
}
```

**Prerequisite example:**
```json
{
  "name": "Erlang/OTP",
  "description": "Programming language for concurrent, fault-tolerant systems",
  "type": "prerequisite",
  "packages": { "brew": { "package": "erlang" }, "apt": { "package": "erlang" } },
  "binaries": { "linux-x64": { "url": "https://...", "format": "tar.gz" } },
  "requires": []
}
```

**CLI tool categories:**
- `server` - Database server binaries (postgres, mysqld, redis-server)
- `client` - Official CLI clients (psql, mysql, redis-cli)
- `utility` - Backup/restore/admin tools (pg_dump, mysqldump)
- `enhanced` - Third-party enhanced CLIs (pgcli, mycli, litecli, iredis, usql)

**Package managers supported:**
- macOS/Linux: brew, apt, yum, dnf, pacman, apk
- Windows: choco, winget, scoop
- Cross-platform: pip, pipx, npm, cargo, go

**Binary formats:** `tar.gz`, `tar.xz`, `zip`, `binary`, `deb`, `rpm`, `pkg`, `msi`, `dmg`

## Listing Databases

```bash
# Show in-progress databases (default)
pnpm dbs

# Show all databases
pnpm dbs --all

# Show only pending databases
pnpm dbs --pending

# Show only unsupported databases
pnpm dbs --unsupported

# Show CLI tools summary
pnpm dbs --tools

# Help
pnpm dbs --help
```

**Status values:**
- `in-progress` - Actively being built (shown by default)
- `pending` - Planned, not yet started
- `unsupported` - Not planned for support

## GitHub Constraints (Public Repo)

This project uses GitHub Actions to build databases from source and hosts binaries on GitHub Releases.

### Limits

| Resource | Limit |
|----------|-------|
| Actions minutes | Unlimited (public repo) |
| Job timeout | 6 hours per job |
| Release file size | 2 GB per file |
| Total release storage | No limit |
| Release bandwidth | No limit |

### Build Considerations

- **Build times**: Compiling databases from source takes 1-4+ hours per build
- **ARM64 Linux**: No native GitHub runners; requires QEMU emulation (slow) or self-hosted runners
- **macOS/Windows**: Free runners available for public repos
- **Parallelization**: Builds can run in parallel across matrix jobs

## Build Strategy

### Why Control Our Own Binaries?

SpinDB currently relies on external binary sources:
- **PostgreSQL**: [embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries) (Zonky.io)
- **MySQL/MariaDB/Redis/etc**: System package managers (brew, apt, choco)

If these upstream sources disappear or stop working, SpinDB breaks. hostdb ensures we control the binaries.

### Download First, Build as Fallback

**Primary approach:** Download official binaries from vendor CDNs, repackage with metadata, and host on GitHub Releases. This is fast (seconds, not hours).

**Fallback:** Build from source using Docker when:
- No official binary exists for a platform/version
- Vendor stops distributing a version we need
- We need custom patches or configuration

### Build Order

1. **MySQL** (first) - No existing binary source like Zonky.io; SpinDB uses package managers
2. **MariaDB** - Similar situation to MySQL
3. **Redis** - Windows relies on unmaintained tporadowski/redis fork
4. **PostgreSQL** - Already covered by Zonky.io, but want our own for redundancy
5. **SQLite** - Lower priority, usually available via system

### Development Workflow

```bash
# Local: download official binary, repackage, save to ./dist
pnpm download:mysql -- --version 8.4.3

# Download for all platforms
pnpm download:mysql -- --version 8.4.3 --all-platforms

# Fallback: build from source via Docker (if no official binary)
./builds/mysql/build-local.sh --platform linux-x64 --version 8.4.3
```

### GitHub Actions Workflow

Releases are triggered manually via `workflow_dispatch`:

1. Go to Actions → "Release MySQL" → Run workflow
2. Enter version (e.g., `8.4.3`) and platforms (`all` or comma-separated)
3. Workflow downloads binaries for all platforms
4. Creates GitHub Release with artifacts
5. Updates `releases.json` manifest

## Querying Available Binaries

SpinDB (or any consumer) can query available binaries via `releases.json`:

```bash
# Raw URL for releases.json
https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json
```

**releases.json structure:**

```json
{
  "repository": "robertjbass/hostdb",
  "lastUpdated": "2024-01-15T10:30:00Z",
  "databases": {
    "mysql": {
      "8.4.3": {
        "version": "8.4.3",
        "releaseTag": "mysql-8.4.3",
        "platforms": {
          "darwin-arm64": {
            "url": "https://github.com/robertjbass/hostdb/releases/download/mysql-8.4.3/mysql-8.4.3-darwin-arm64.tar.gz",
            "sha256": "abc123...",
            "size": 165000000
          }
        }
      }
    }
  }
}
```

**Download URL pattern:**
```
https://github.com/robertjbass/hostdb/releases/download/{tag}/{filename}
```

### Future Considerations

- **Raspberry Pi 5**: May integrate a local ARM64 device as a self-hosted runner for native `linux-arm64` builds (avoids slow QEMU emulation). Not guaranteed, under consideration.

