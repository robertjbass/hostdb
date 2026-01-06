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

Reference implementations:
- `builds/mysql/download.ts` - Official binary downloads
- `builds/postgresql/download.ts` - Third-party (zonky.io) downloads
- `builds/mariadb/download.ts` - Mixed sources with build fallback

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

Reference: `builds/mariadb/Dockerfile`

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

Reference: `.github/workflows/release-mariadb.yml`

### 5.2 Configure build matrix

For each platform, ensure correct runner and build type:

| Platform | Runner | Build Type |
|----------|--------|------------|
| linux-x64 | ubuntu-latest | docker or download |
| linux-arm64 | ubuntu-latest | docker |
| darwin-x64 | macos-13 | native |
| darwin-arm64 | macos-14 | native |
| win32-x64 | ubuntu-latest | download |

### 5.3 Add version dropdown

- [ ] Add all supported versions to workflow options list
- [ ] Order versions newest first

```yaml
inputs:
  version:
    description: 'Database version'
    required: true
    default: '1.0.0'
    type: choice
    options:
      - '1.0.0'
```

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

### 8.1 Update status

- [ ] Set `status: "completed"` in databases.json (after first successful release)

### 8.2 Verify releases.json

- [ ] Confirm all versions appear in releases.json
- [ ] Confirm all platforms have URLs
- [ ] Test download URL works

### 8.3 Documentation updates

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

### Common Issues

| Issue | Solution |
|-------|----------|
| Download URL 403/404 | Check if URL requires authentication or has rate limits |
| Docker build fails | Check build dependencies are installed |
| macOS build fails | Verify Homebrew dependencies in workflow |
| Checksum mismatch | Re-download and verify source |
| releases.json not updated | Check update-manifest job permissions |

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
```
