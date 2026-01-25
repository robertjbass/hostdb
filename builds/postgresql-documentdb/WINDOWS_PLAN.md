# PostgreSQL-DocumentDB Windows Build Plan

This document outlines the strategy for supporting FerretDB on Windows, including the primary approach (native DocumentDB build) and fallback strategies.

## Current Status

| Component | Windows Support | Notes |
|-----------|----------------|-------|
| PostgreSQL 17 | ✅ Available | EDB provides official Windows binaries |
| pgvector | ✅ Built | MSVC build works (currently in release) |
| DocumentDB | ❌ Not built | Requires mongo-c-driver, extensive patches |
| pg_cron | ❌ Not built | Uses Unix signals, may need patches |
| PostGIS | ⚠️ Available | OSGeo4W provides Windows builds |
| rum | ❌ Not built | Needs investigation |

## Strategy Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Windows FerretDB Support                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PRIMARY: Native DocumentDB Build (MSYS2 MINGW64)               │
│  ├── Build mongo-c-driver for Windows                           │
│  ├── Build DocumentDB extension                                  │
│  └── Bundle with PostgreSQL EDB binaries                        │
│                                                                  │
│  FALLBACK 1: FerretDB v1 (SQLite backend)                       │
│  ├── No PostgreSQL/DocumentDB needed                            │
│  ├── Pure Go binary, cross-compiles easily                      │
│  └── Limited features but works natively                        │
│                                                                  │
│  FALLBACK 2: WSL2 Proxy                                         │
│  ├── Native Windows CLI wrapper                                  │
│  ├── Automatically provisions WSL2 + distro                     │
│  ├── Runs Linux binaries transparently                          │
│  └── Full feature parity with Linux                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Primary: Native DocumentDB Build

### Approach: MSYS2 MINGW64

Use MSYS2 with MinGW-w64 toolchain to build DocumentDB as a native Windows DLL.

**Why MINGW64 over Cygwin:**
- PostgreSQL Windows builds use MinGW-compatible ABI
- EDB binaries are built with MSVC but PostgreSQL extensions can use MinGW
- No runtime DLL dependencies (unlike Cygwin)
- Better compatibility with Windows PostgreSQL

### Build Steps

#### 1. Setup MSYS2 Environment

```yaml
- name: Setup MSYS2
  uses: msys2/setup-msys2@v2
  with:
    msystem: MINGW64
    update: true
    install: >-
      mingw-w64-x86_64-gcc
      mingw-w64-x86_64-cmake
      mingw-w64-x86_64-ninja
      mingw-w64-x86_64-openssl
      mingw-w64-x86_64-zlib
      mingw-w64-x86_64-icu
      git
      zip
```

#### 2. Build mongo-c-driver (libbson)

mongo-c-driver has CMake support and should build on Windows:

```bash
git clone --depth 1 --branch 1.29.0 https://github.com/mongodb/mongo-c-driver.git
cd mongo-c-driver

cmake -G Ninja -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/mingw64 \
  -DENABLE_AUTOMATIC_INIT_AND_CLEANUP=OFF \
  -DENABLE_MONGOC=OFF \
  -DENABLE_BSON=ON

ninja -C build
ninja -C build install
```

#### 3. Download PostgreSQL Windows SDK

EDB provides a Windows installer that includes development headers:

```powershell
# Download PostgreSQL 17 from EDB
$PG_URL = "https://sbp.enterprisedb.com/getfile.jsp?fileid=1259911"
Invoke-WebRequest -Uri $PG_URL -OutFile postgresql.zip
Expand-Archive postgresql.zip -DestinationPath C:\pg
$env:PGROOT = "C:\pg\pgsql"
```

#### 4. Build DocumentDB Extension

```bash
git clone --depth 1 --branch v0.107.0 https://github.com/FerretDB/documentdb.git
cd documentdb

# Set PostgreSQL paths
export PG_CONFIG="$PGROOT/bin/pg_config"
export USE_PGXS=1

# Build pg_documentdb_core
cd pg_documentdb_core
make
make install DESTDIR=$OUTPUT_DIR

# Build pg_documentdb
cd ../pg_documentdb
make
make install DESTDIR=$OUTPUT_DIR
```

### Known Challenges

1. **POSIX dependencies** - DocumentDB may use POSIX APIs that need Windows equivalents
2. **Shared memory** - PostgreSQL extensions on Windows have different shared memory handling
3. **Signal handling** - pg_cron uses Unix signals heavily
4. **Path separators** - Code may assume `/` instead of `\`

### Patches Likely Needed

Based on WINDOWS_BUILD.md patterns:

```c
// compat_windows.h for DocumentDB
#ifdef _WIN32
#include <windows.h>

// POSIX compatibility
#define _SC_PAGESIZE 1
static inline long sysconf(int name) {
    if (name == _SC_PAGESIZE) return 4096;
    return -1;
}

// Signal stubs (if needed)
#ifndef SIGALRM
#define SIGALRM 14
#endif

#endif
```

### Success Criteria

- [ ] mongo-c-driver builds on MSYS2 MINGW64
- [ ] pg_documentdb_core.dll loads in PostgreSQL
- [ ] pg_documentdb.dll loads in PostgreSQL
- [ ] `CREATE EXTENSION documentdb CASCADE` succeeds
- [ ] Basic CRUD operations work via FerretDB

---

## Fallback 1: FerretDB v1 (SQLite Backend)

If native DocumentDB proves too difficult, support FerretDB v1 which uses SQLite instead of PostgreSQL.

### Overview

FerretDB v1.x supports multiple backends:
- **SQLite** - Embedded, no external dependencies
- **PostgreSQL** - Requires pg extension (what v2 uses)
- **Hana** - SAP HANA backend

The SQLite backend is pure Go and works natively on Windows without any C extensions.

### Implementation

#### 1. Add FerretDB v1 to hostdb

```json
// databases.json
{
  "ferretdb-v1": {
    "displayName": "FerretDB (Legacy)",
    "description": "MongoDB-compatible database with SQLite backend",
    "versions": {
      "1.24.0": true
    },
    "platforms": {
      "win32-x64": true,
      "linux-x64": true,
      "linux-arm64": true,
      "darwin-x64": true,
      "darwin-arm64": true
    }
  }
}
```

#### 2. Download Script

FerretDB v1 releases include Windows binaries:

```typescript
// builds/ferretdb-v1/download.ts
const FERRETDB_V1_RELEASES = {
  "1.24.0": {
    "win32-x64": {
      url: "https://github.com/FerretDB/FerretDB/releases/download/v1.24.0/ferretdb-windows-amd64.zip",
      format: "zip"
    }
  }
}
```

#### 3. SpinDB Integration

```typescript
// In SpinDB, detect Windows and use v1 for ferretdb
if (platform === 'win32' && engine === 'ferretdb') {
  // Check if user specifically requested v2
  if (version.startsWith('2.')) {
    console.warn(`
⚠️  FerretDB v2 requires DocumentDB which is not available on Windows.

Options:
  1. Use FerretDB v1 (SQLite backend): spindb create mydb --engine ferretdb --version 1.24
  2. Use WSL2: wsl spindb create mydb --engine ferretdb --version 2.7
    `);
    return;
  }
  // Default to v1 on Windows
  version = '1.24.0';
}
```

### Limitations of v1

| Feature | v1 (SQLite) | v2 (DocumentDB) |
|---------|-------------|-----------------|
| Basic CRUD | ✅ | ✅ |
| Aggregation pipeline | ⚠️ Limited | ✅ Full |
| Transactions | ❌ | ✅ |
| Change streams | ❌ | ✅ |
| Full-text search | ❌ | ✅ |
| Geospatial queries | ❌ | ✅ |

### When to Use

- Quick prototyping on Windows
- Simple applications that don't need advanced MongoDB features
- Users who can't or won't use WSL2

---

## Fallback 2: WSL2 Proxy

Provide a native Windows CLI that transparently manages WSL2 to run Linux binaries.

### Concept

```
┌──────────────────────────────────────────────────────────────┐
│                     Windows Host                              │
│                                                               │
│  ┌─────────────────┐         ┌─────────────────────────────┐ │
│  │  spindb.exe     │ ──────▶ │         WSL2                │ │
│  │  (Native CLI)   │         │  ┌───────────────────────┐  │ │
│  │                 │         │  │  spindb (Linux)       │  │ │
│  │  - Provisions   │◀─────── │  │  - FerretDB           │  │ │
│  │    WSL2 distro  │ stdout  │  │  - PostgreSQL         │  │ │
│  │  - Forwards     │ stderr  │  │  - DocumentDB         │  │ │
│  │    commands     │         │  │  - Full Linux binary  │  │ │
│  │  - Port proxy   │         │  └───────────────────────┘  │ │
│  └─────────────────┘         └─────────────────────────────┘ │
│         │                              │                      │
│         ▼                              ▼                      │
│    localhost:27017  ◀──────────  localhost:27017             │
│    (Windows apps)                (WSL2 internal)              │
└──────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. WSL2 Provisioning Module

```typescript
// cli/wsl/provisioner.ts

import { execSync, spawn } from 'child_process';

export class WSL2Provisioner {
  private distroName = 'spindb-ubuntu';

  /**
   * Check if WSL2 is available and enabled
   */
  async checkWSL2Available(): Promise<boolean> {
    try {
      const result = execSync('wsl --status', { encoding: 'utf8' });
      return result.includes('Default Version: 2');
    } catch {
      return false;
    }
  }

  /**
   * Install WSL2 if not present (requires admin)
   */
  async installWSL2(): Promise<void> {
    console.log('Installing WSL2...');
    execSync('wsl --install --no-distribution', { stdio: 'inherit' });
    console.log('WSL2 installed. Please restart your computer.');
  }

  /**
   * Create dedicated SpinDB distro
   */
  async provisionDistro(): Promise<void> {
    // Check if distro exists
    const distros = execSync('wsl --list --quiet', { encoding: 'utf8' });
    if (distros.includes(this.distroName)) {
      return; // Already provisioned
    }

    console.log('Provisioning SpinDB WSL2 environment...');

    // Import minimal Ubuntu image
    // Could use: https://cloud-images.ubuntu.com/wsl/
    execSync(`wsl --import ${this.distroName} C:\\spindb\\wsl ubuntu-22.04.tar.gz`);

    // Install SpinDB inside WSL
    this.runInWSL('curl -fsSL https://get.spindb.dev | bash');
  }

  /**
   * Run command inside WSL distro
   */
  runInWSL(command: string): string {
    return execSync(`wsl -d ${this.distroName} -- ${command}`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
  }

  /**
   * Spawn interactive command in WSL
   */
  spawnInWSL(command: string, args: string[]): ChildProcess {
    return spawn('wsl', ['-d', this.distroName, '--', command, ...args], {
      stdio: 'inherit'
    });
  }
}
```

#### 2. Command Proxy

```typescript
// cli/wsl/proxy.ts

export class WSL2CommandProxy {
  private provisioner: WSL2Provisioner;

  constructor() {
    this.provisioner = new WSL2Provisioner();
  }

  /**
   * Proxy a spindb command to WSL2
   */
  async proxyCommand(args: string[]): Promise<number> {
    // Ensure WSL2 is ready
    if (!await this.provisioner.checkWSL2Available()) {
      console.log('WSL2 is required for this database on Windows.');
      console.log('Would you like to install it? (requires restart)');
      // ... prompt and install
    }

    await this.provisioner.provisionDistro();

    // Transform Windows paths to WSL paths
    const wslArgs = args.map(arg => this.transformPath(arg));

    // Run command in WSL
    const child = this.provisioner.spawnInWSL('spindb', wslArgs);

    return new Promise((resolve) => {
      child.on('exit', (code) => resolve(code ?? 1));
    });
  }

  /**
   * Transform Windows path to WSL path
   * C:\Users\Bob\data -> /mnt/c/Users/Bob/data
   */
  transformPath(path: string): string {
    if (/^[A-Z]:\\/.test(path)) {
      const drive = path[0].toLowerCase();
      return `/mnt/${drive}${path.slice(2).replace(/\\/g, '/')}`;
    }
    return path;
  }
}
```

#### 3. Port Forwarding

WSL2 ports are accessible from Windows by default via `localhost`, but we may need explicit forwarding for some scenarios:

```typescript
// cli/wsl/port-forward.ts

export class PortForwarder {
  /**
   * Ensure port is accessible from Windows host
   */
  async ensurePortForwarded(port: number): Promise<void> {
    // WSL2 usually handles this automatically
    // But we can add explicit forwarding if needed

    // Get WSL2 IP
    const wslIp = execSync('wsl hostname -I', { encoding: 'utf8' }).trim();

    // Add port proxy rule (requires admin on first run)
    execSync(`netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 connectport=${port} connectaddress=${wslIp}`);
  }
}
```

#### 4. Integration in SpinDB CLI

```typescript
// cli/commands/create.ts

import { WSL2CommandProxy } from '../wsl/proxy';

// In the create command handler
if (platform === 'win32' && engineRequiresWSL(engine)) {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  ${engine} uses WSL2 on Windows for full compatibility      │
│                                                              │
│  SpinDB will automatically:                                  │
│  • Install WSL2 if needed (one-time, requires restart)      │
│  • Create a lightweight Linux environment                    │
│  • Run the database transparently                            │
│                                                              │
│  Your data is stored at: C:\\Users\\You\\.spindb\\           │
│  Connect normally via: localhost:${port}                     │
└─────────────────────────────────────────────────────────────┘
`);

  const proxy = new WSL2CommandProxy();
  return proxy.proxyCommand(['create', name, '--engine', engine, ...]);
}
```

### User Experience

From the Windows user's perspective:

```powershell
# First run - provisions WSL2 automatically
PS> spindb create mydb --engine ferretdb

┌─────────────────────────────────────────────────────────────┐
│  FerretDB uses WSL2 on Windows for full compatibility       │
└─────────────────────────────────────────────────────────────┘

Provisioning SpinDB WSL2 environment... done
Creating container "mydb"... done
Starting FerretDB... done

  MongoDB-compatible connection string:
  mongodb://localhost:27017/mydb

# Subsequent runs - instant
PS> spindb start mydb
Starting mydb... done

# Connect from Windows apps normally
PS> mongosh mongodb://localhost:27017/mydb
```

### Engines Requiring WSL2 Proxy

| Engine | Reason | Fallback Available |
|--------|--------|-------------------|
| ferretdb (v2) | DocumentDB extension | Yes - v1 with SQLite |
| clickhouse | Complex Linux-only deps | Partial - experimental native |

### Advantages

1. **Full feature parity** - Users get exact same experience as Linux/macOS
2. **Transparent** - No manual WSL setup required
3. **Native ports** - Connect from Windows apps normally
4. **Shared filesystem** - Data stored in Windows-accessible location
5. **One-time setup** - WSL2 provisioned automatically on first use

### Disadvantages

1. **Requires Windows 10/11** - WSL2 not available on older Windows
2. **First-run delay** - WSL2 installation and distro setup takes time
3. **Restart required** - First WSL2 install needs system restart
4. **Disk space** - WSL2 distro takes ~1-2GB
5. **Memory overhead** - WSL2 VM uses additional RAM

---

## Implementation Priority

### Phase 1: Fallback 1 (FerretDB v1) - Quick win, no build complexity

- [ ] **hostdb:** Add `ferretdb-v1` to `databases.json`
- [ ] **hostdb:** Create `builds/ferretdb-v1/` with download script
- [ ] **hostdb:** Add FerretDB v1.24.0 to `sources.json` (all platforms)
- [ ] **hostdb:** Create GitHub Actions workflow `release-ferretdb-v1.yml`
- [ ] **spindb:** Add `ferretdb-v1` engine type
- [ ] **spindb:** Auto-select v1 on Windows when user requests ferretdb
- [ ] **spindb:** Show warning about v1 limitations vs v2
- [ ] **spindb:** Skip FerretDB v2 tests on Windows CI

### Phase 2: Fallback 2 (WSL2 Proxy) - Medium effort, full compatibility

- [ ] **spindb:** Create `cli/wsl/provisioner.ts` - WSL2 detection and setup
- [ ] **spindb:** Create `cli/wsl/distro-manager.ts` - Manage spindb-ubuntu distro
- [ ] **spindb:** Create `cli/wsl/command-proxy.ts` - Forward commands to WSL
- [ ] **spindb:** Create `cli/wsl/path-transformer.ts` - Windows ↔ WSL paths
- [ ] **spindb:** Create `cli/wsl/port-forwarder.ts` - Ensure port accessibility
- [ ] **spindb:** Add `--use-wsl` flag to force WSL2 mode
- [ ] **spindb:** Add `--no-wsl` flag to prevent WSL2 (error if unsupported)
- [ ] **spindb:** Auto-detect when WSL2 is needed and prompt user
- [ ] **spindb:** Handle WSL2 first-time setup (requires restart)
- [ ] **spindb:** Test with ferretdb v2 on Windows via WSL2
- [ ] **spindb:** Test with clickhouse on Windows via WSL2
- [ ] **docs:** Document WSL2 proxy feature for Windows users

### Phase 3: Primary (Native DocumentDB) - High effort, best UX

- [ ] **hostdb:** Test mongo-c-driver build on MSYS2 MINGW64
- [ ] **hostdb:** Document any patches needed for mongo-c-driver
- [ ] **hostdb:** Test pg_documentdb_core build against Windows PostgreSQL
- [ ] **hostdb:** Test pg_documentdb build
- [ ] **hostdb:** Create `builds/postgresql-documentdb/build-windows.sh`
- [ ] **hostdb:** Create `builds/postgresql-documentdb/build-windows.ps1` (launcher)
- [ ] **hostdb:** Add Windows build job to `release-postgresql-documentdb.yml`
- [ ] **hostdb:** Test full FerretDB v2 workflow on Windows
- [ ] **spindb:** Remove WSL2 fallback for ferretdb when native works

---

## References

- [WINDOWS_BUILD.md](../../WINDOWS_BUILD.md) - General Windows build strategies
- [WSL2 Documentation](https://docs.microsoft.com/en-us/windows/wsl/)
- [FerretDB v1 Releases](https://github.com/FerretDB/FerretDB/releases)
- [mongo-c-driver Windows](http://mongoc.org/libmongoc/current/installing.html#windows)
