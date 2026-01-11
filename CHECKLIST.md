# Adding a New Database Checklist

Complete checklist for adding a new database to hostdb.

## Prerequisites

Before starting, research and document:

- [ ] **Binary availability**: What platforms have official binaries?
- [ ] **Third-party sources**: Are there trusted third-party builds (like zonky.io for PostgreSQL)?
- [ ] **Source build requirements**: What build dependencies are needed?
- [ ] **License compatibility**: Is the license compatible with redistribution?
- [ ] **LTS versions**: Which versions are LTS and should be prioritized?

---

## Phase 1: Configuration

### 1.1 Update databases.json

- [ ] Add database entry with all required fields
- [ ] Set `status: "in-progress"`
- [ ] Define supported `versions` (set `true` for each)
- [ ] Define supported `platforms` (set `true` for each)
- [ ] Set `commercialUse` based on license
- [ ] Add `cliTools` (server, client, utilities, enhanced)
- [ ] Add `connection` details (port, scheme, defaults)

```json
{
  "mydatabase": {
    "displayName": "MyDatabase",
    "description": "...",
    "type": "Relational",
    "sourceRepo": "https://github.com/...",
    "license": "...",
    "commercialUse": true,
    "status": "in-progress",
    "latestLts": "1.0",
    "versions": { "1.0.0": true },
    "platforms": {
      "linux-x64": true,
      "linux-arm64": true,
      "darwin-x64": true,
      "darwin-arm64": true,
      "win32-x64": true
    },
    "cliTools": {
      "server": "mydb-server",
      "client": "mydb-cli",
      "utilities": [],
      "enhanced": []
    },
    "connection": {
      "runtime": "server",
      "defaultPort": 5000,
      "scheme": "mydb",
      "defaultDatabase": "default",
      "defaultUser": "root",
      "queryLanguage": "SQL"
    }
  }
}
```

### 1.2 Create builds directory

- [ ] Create `builds/<database>/` directory
- [ ] Verify directory name matches database key in databases.json

---

## Phase 2: Source URLs

### 2.1 Create sources.json

- [ ] Create `builds/<database>/sources.json`
- [ ] Add `$schema` reference
- [ ] Map all version/platform combinations

For each version:
- [ ] **linux-x64**: Add URL or mark `build-required`
- [ ] **linux-arm64**: Add URL or mark `build-required`
- [ ] **darwin-x64**: Add URL or mark `build-required`
- [ ] **darwin-arm64**: Add URL or mark `build-required`
- [ ] **win32-x64**: Add URL or mark `build-required`

```json
{
  "$schema": "../../schemas/sources.schema.json",
  "database": "mydatabase",
  "versions": {
    "1.0.0": {
      "linux-x64": {
        "url": "https://...",
        "format": "tar.gz",
        "sourceType": "official",
        "sha256": null
      },
      "linux-arm64": {
        "sourceType": "build-required"
      }
    }
  },
  "notes": {
    "official": "Description of official binary source",
    "build-required": "Reason builds are needed"
  }
}
```

### 2.2 Verify URLs

- [ ] Test each URL is accessible (curl -I)
- [ ] Verify archive format matches `format` field
- [ ] Note any authentication or rate limiting requirements

---

## Phase 3: Download Script

### 3.1 Create download.ts

- [ ] Create `builds/<database>/download.ts`
- [ ] Implement download logic for each source type
- [ ] Handle archive extraction appropriately
- [ ] Add `.hostdb-metadata.json` to repackaged archives
- [ ] Support CLI arguments: `--version`, `--platform`, `--all-platforms`, `--output`
- [ ] **Handle `--` delimiter**: Add `case '--': break` to ignore pnpm's delimiter
- [ ] **ESLint compliance**: Add `break` after `process.exit()` calls (even though unreachable)
- [ ] **Version encoding**: If vendor uses encoded versions in URLs, implement the formula

Reference implementations:
- `builds/mysql/download.ts` - Official binary downloads
- `builds/postgresql/download.ts` - Third-party (zonky.io) downloads
- `builds/mariadb/download.ts` - Mixed sources with build fallback
- `builds/sqlite/download.ts` - SHA3-256 checksums, version encoding

### 3.2 Update package.json

- [ ] Add download script: `"download:<database>": "tsx builds/<database>/download.ts"`

### 3.3 Test locally

- [ ] Test download for current platform: `pnpm download:<database>`
- [ ] Test specific version: `pnpm download:<database> -- --version X.Y.Z`
- [ ] Verify extracted binary works: `./dist/<database>/bin/<server> --version`

---

## Phase 4: Source Build (if needed)

Skip if all platforms have official binaries.

### 4.1 Create Dockerfile

- [ ] Create `builds/<database>/Dockerfile`
- [ ] Use multi-stage build (builder → packager → export)
- [ ] Install build dependencies
- [ ] Download source from official location
- [ ] Configure with appropriate flags
- [ ] Build and install
- [ ] Add `.hostdb-metadata.json`
- [ ] Verify key binaries exist
- [ ] **ARG/ENV for runtime**: If CMD uses VERSION, add `ENV VERSION=${VERSION}` after `ARG VERSION`
- [ ] **Version encoding**: If needed, compute in RUN step and save to file (ARGs can't do math)

```dockerfile
# Example: Persist ARG to runtime for CMD
ARG VERSION
ENV VERSION=${VERSION}

# Example: Version encoding (SQLite-style)
RUN VERSION_NUM=$(echo "${VERSION}" | awk -F. '{printf "%d%02d%02d00", $1, $2, $3}') && \
    echo "VERSION_NUM=${VERSION_NUM}" > /tmp/version_env
```

Reference: `builds/mariadb/Dockerfile`, `builds/sqlite/Dockerfile`

### 4.2 Create build-local.sh

- [ ] Create `builds/<database>/build-local.sh`
- [ ] Add shebang and strict mode (`set -euo pipefail`)
- [ ] Support arguments: `--version`, `--platform`, `--output`, `--no-cache`
- [ ] Map platform to Docker platform
- [ ] Run `docker buildx build`
- [ ] Create tarball from output
- [ ] Generate checksum

Reference: `builds/mariadb/build-local.sh`

### 4.3 Test local build

- [ ] Test build: `./builds/<database>/build-local.sh --version X.Y.Z`
- [ ] Verify tarball created in `./dist/`
- [ ] Verify binaries work when extracted

---

## Phase 5: GitHub Actions Workflow

### 5.1 Create workflow file

- [ ] Create `.github/workflows/release-<database>.yml`
- [ ] Add `workflow_dispatch` trigger with version/platforms inputs
- [ ] Add concurrency group to prevent conflicts
- [ ] Create `prepare` job for matrix setup
- [ ] Create `build` job with matrix strategy
- [ ] Create `release` job for GitHub Release
- [ ] Create `update-manifest` job to update releases.json
- [ ] **Release condition**: Use `success || skipped` for ALL build jobs to prevent partial releases:
  ```yaml
  release:
    needs: [build-download, build-source]
    if: always() && (needs.build-download.result == 'success' || needs.build-download.result == 'skipped') && (needs.build-source.result == 'success' || needs.build-source.result == 'skipped')
  ```

Reference: `.github/workflows/release-mariadb.yml`, `.github/workflows/release-sqlite.yml`

### 5.2 Configure build matrix

For each platform, ensure correct runner and build type:

| Platform | Runner | Build Type |
|----------|--------|------------|
| linux-x64 | ubuntu-latest | docker or download |
| linux-arm64 | ubuntu-latest | docker |
| darwin-x64 | macos-13 | native |
| darwin-arm64 | macos-14 | native |
| win32-x64 | ubuntu-latest | download |

### 5.3 Version input

The workflow uses a **dropdown** for version selection, synced from `databases.json`:

```yaml
inputs:
  version:
    description: 'Database version'
    required: true
    type: choice
    options:
      - 1.0.0
      - 0.9.0
    default: 1.0.0
```

After adding new versions to databases.json, run `pnpm sync:versions` to update workflow dropdowns.

The validate job still checks the selected version against `databases.json` and `sources.json` before proceeding.

---

## Phase 6: Documentation

### 6.1 Create README.md

- [ ] Create `builds/<database>/README.md`
- [ ] Document platform coverage
- [ ] Document binary sources
- [ ] Document usage examples
- [ ] Document build times
- [ ] Document any limitations or known issues

Reference: `builds/mariadb/README.md`

---

## Phase 7: Testing

### 7.1 Local testing

- [ ] Download works for all platforms with binaries
- [ ] Build works for platforms requiring source build
- [ ] Extracted binaries execute correctly

### 7.2 GitHub Actions testing

- [ ] Push changes to branch
- [ ] Run workflow manually for single platform first
- [ ] Verify artifact is created correctly
- [ ] Run workflow for all platforms
- [ ] Verify GitHub Release is created
- [ ] Verify releases.json is updated

---

## Phase 8: Finalization

### 8.1 Version bump and changelog

- [ ] Bump **minor version** in `package.json` (e.g., 0.8.0 → 0.9.0)
- [ ] Add changelog entry in `CHANGELOG.md`:
  ```markdown
  ## [0.9.0] - YYYY-MM-DD

  ### Added

  - **DatabaseName support** with full 5-platform coverage
    - Version X.Y.Z (latest stable)
    - Official binaries from vendor for platforms A, B, C
    - Source build for platform D (no official binary available)
    - Includes tool1, tool2, tool3
    - License type
  ```

### 8.2 Update status

- [ ] Set `status: "completed"` in databases.json (after first successful release)

### 8.3 Verify releases.json

- [ ] Confirm all versions appear in releases.json
- [ ] Confirm all platforms have URLs
- [ ] Test download URL works

### 8.4 Documentation updates

- [ ] Update root README.md status table if needed
- [ ] Verify ARCHITECTURE.md is still accurate

---

## Quick Reference

### File Checklist

```
builds/<database>/
├── download.ts          # Required
├── sources.json         # Required
├── Dockerfile           # If source builds needed
├── build-local.sh       # If source builds needed
└── README.md            # Required

.github/workflows/
└── release-<database>.yml  # Required

databases.json           # Update required
package.json             # Add download script
```

### Adding a New Version (Existing Database)

For existing databases, adding a new version is a **3-step process**:

1. `databases.json` - Add version with `true`:
   ```json
   "versions": { "9.0.0": true, "8.4.7": true, ... }
   ```

2. `builds/<database>/sources.json` - Add URLs for all platforms

3. Run `pnpm sync:versions` to update workflow dropdown options

The sync script automatically updates the version dropdown in the workflow file.

### Common Issues

| Issue | Solution |
|-------|----------|
| Download URL 403/404 | Check if URL requires authentication or has rate limits |
| Docker build fails | Check build dependencies are installed |
| macOS build fails | Verify Homebrew dependencies in workflow |
| Checksum mismatch | Re-download and verify source |
| releases.json not updated | Check update-manifest job permissions |
| "Version not enabled" error | Add version to databases.json with `true` |
| "Version not in sources.json" | Add version URLs to builds/<db>/sources.json |
| PostgreSQL EDB file ID unknown | Run `pnpm edb:fileids -- --update` to fetch latest IDs |
| `Unknown option: --` error | Add `case '--': break` to download.ts argument parser |
| Docker CMD can't access VERSION | Add `ENV VERSION=${VERSION}` after `ARG VERSION` |
| ESLint no-fallthrough error | Add `break` after `process.exit()` with comment |
| Partial release (missing platforms) | Use `success \|\| skipped` condition for ALL build jobs |
| Version encoding wrong in URLs | Check vendor docs for URL format (e.g., SQLite: 3.51.2 → 3510200) |
| Non-SHA256 checksums flagged | Add database to SKIP_DATABASES in populate-checksums.ts |

### Testing Commands

```bash
# List databases
pnpm dbs

# Download for current platform
pnpm download:<database>

# Download specific version
pnpm download:<database> -- --version X.Y.Z

# Download all platforms
pnpm download:<database> -- --all-platforms

# Local Docker build
./builds/<database>/build-local.sh --version X.Y.Z --platform linux-x64

# Verify binary
./dist/<database>/bin/<server> --version

# Sync workflow dropdowns (after adding versions)
pnpm sync:versions

# Check if sync needed (for CI)
pnpm sync:versions --check

# Scaffold new database
pnpm add:engine <database-key>

# PostgreSQL: Fetch EDB Windows file IDs
pnpm edb:fileids                  # Show available file IDs
pnpm edb:fileids -- --update      # Update sources.json
```
