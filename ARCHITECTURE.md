# Architecture

Visual representation of how hostdb works.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              hostdb Repository                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │ databases.json  │     │ sources.json    │     │ releases.json   │       │
│  │                 │     │ (per database)  │     │                 │       │
│  │ Source of truth │     │ URL mappings    │     │ Queryable       │       │
│  │ for versions &  │────▶│ for binaries    │     │ manifest of     │       │
│  │ platforms       │     │                 │     │ GitHub Releases │       │
│  └─────────────────┘     └────────┬────────┘     └────────▲────────┘       │
│                                   │                       │                 │
│                                   ▼                       │                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        GitHub Actions Workflow                        │  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ linux-x64   │  │ linux-arm64 │  │ darwin-x64  │  │darwin-arm64 │  │  │
│  │  │             │  │             │  │             │  │             │  │  │
│  │  │ Download or │  │ Docker      │  │ Native on   │  │ Native on   │  │  │
│  │  │ Docker      │  │ (QEMU)      │  │ macos-13    │  │ macos-14    │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │  │
│  │         │                │                │                │         │  │
│  │         └────────────────┴────────────────┴────────────────┘         │  │
│  │                                   │                                   │  │
│  │                                   ▼                                   │  │
│  │                         ┌─────────────────┐                          │  │
│  │                         │ win32-x64       │                          │  │
│  │                         │ Download        │                          │  │
│  │                         └────────┬────────┘                          │  │
│  │                                  │                                    │  │
│  └──────────────────────────────────┼────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                           │
│                          │  GitHub Release     │                           │
│                          │                     │                           │
│                          │  mysql-8.4.3        │                           │
│                          │  ├── linux-x64.tar  │                           │
│                          │  ├── linux-arm64.tar│                           │
│                          │  ├── darwin-x64.tar │                           │
│                          │  ├── darwin-arm64.tar                           │
│                          │  └── win32-x64.zip  │                           │
│                          └──────────┬──────────┘                           │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                           │
│                          │  update-releases.ts │────▶ releases.json        │
│                          └─────────────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                                     │
                                     │ Query releases.json
                                     ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                                 SpinDB                                       │
│                                                                             │
│  1. Fetch releases.json                                                     │
│  2. Find matching version/platform                                          │
│  3. Download binary from GitHub Release                                     │
│  4. Extract and run database                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Binary Sourcing Priority

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Binary Sourcing Decision Tree                        │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │ Need binary for      │
                    │ database X, version Y│
                    │ platform Z           │
                    └──────────┬───────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │ Official binary available?     │
              │ (vendor CDN)                   │
              └───────────────┬────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
         ┌────────┐                      ┌────────┐
         │  YES   │                      │   NO   │
         └───┬────┘                      └───┬────┘
             │                               │
             ▼                               ▼
    ┌─────────────────┐        ┌────────────────────────────┐
    │ Download and    │        │ Third-party source?        │
    │ repackage       │        │ (zonky.io, MariaDB4j, etc) │
    │                 │        └─────────────┬──────────────┘
    │ Priority: 1     │                      │
    └─────────────────┘        ┌─────────────┴─────────────┐
                               │                           │
                               ▼                           ▼
                          ┌────────┐                  ┌────────┐
                          │  YES   │                  │   NO   │
                          └───┬────┘                  └───┬────┘
                              │                           │
                              ▼                           ▼
                     ┌─────────────────┐        ┌─────────────────┐
                     │ Download and    │        │ Build from      │
                     │ repackage       │        │ source          │
                     │                 │        │                 │
                     │ Priority: 2     │        │ Priority: 3     │
                     └─────────────────┘        └────────┬────────┘
                                                         │
                                    ┌────────────────────┴────────────────────┐
                                    │                                         │
                                    ▼                                         ▼
                           ┌────────────────┐                        ┌────────────────┐
                           │ Linux platform │                        │ macOS platform │
                           └───────┬────────┘                        └───────┬────────┘
                                   │                                         │
                                   ▼                                         ▼
                           ┌────────────────┐                        ┌────────────────┐
                           │ Docker build   │                        │ Native build   │
                           │ (QEMU for ARM) │                        │ on GH runner   │
                           └────────────────┘                        └────────────────┘
```

## Configuration File Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Configuration File Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘


databases.json                    builds/mysql/sources.json
┌───────────────────────┐         ┌───────────────────────────────┐
│ {                     │         │ {                             │
│   "mysql": {          │         │   "database": "mysql",        │
│     "status":         │────────▶│   "versions": {               │
│       "in-progress",  │ defines │     "8.4.7": {                │
│     "versions": {     │ what to │       "linux-x64": {          │
│       "8.4.7": true,  │ build   │         "url": "https://...", │
│       "8.0.40": true  │         │         "sourceType":         │
│     },                │         │           "official"          │
│     "platforms": {    │         │       },                      │
│       "linux-x64":    │         │       "linux-arm64": {        │
│         true,         │         │         "sourceType":         │
│       ...             │         │           "build-required"    │
│     }                 │         │       }                       │
│   }                   │         │     }                         │
│ }                     │         │   }                           │
└───────────────────────┘         │ }                             │
                                  └───────────────┬───────────────┘
                                                  │
                                                  │ used by
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │ .github/workflows/            │
                                  │   release-mysql.yml           │
                                  │                               │
                                  │ - Matrix builds all platforms │
                                  │ - Downloads or builds         │
                                  │ - Creates GitHub Release      │
                                  │ - Runs update-releases.ts     │
                                  └───────────────┬───────────────┘
                                                  │
                                                  │ updates
                                                  ▼
                                  ┌───────────────────────────────┐
                                  │ releases.json                 │
                                  │                               │
                                  │ {                             │
                                  │   "databases": {              │
                                  │     "mysql": {                │
                                  │       "8.4.7": {              │
                                  │         "releaseTag":         │
                                  │           "mysql-8.4.7",      │
                                  │         "platforms": {        │
                                  │           "linux-x64": {      │
                                  │             "url": "..."      │
                                  │           }                   │
                                  │         }                     │
                                  │       }                       │
                                  │     }                         │
                                  │   }                           │
                                  │ }                             │
                                  └───────────────────────────────┘
```

## GitHub Actions Workflow Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Release Workflow (release-mysql.yml)                      │
└─────────────────────────────────────────────────────────────────────────────┘

workflow_dispatch (manual trigger)
        │
        │ inputs: version, platforms
        │
        ▼
┌───────────────────┐
│ prepare job       │
│                   │
│ Build matrix from │
│ selected platform │
└─────────┬─────────┘
          │
          │ matrix output
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ build job (runs in parallel for each platform)                               │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ linux-x64    │  │ linux-arm64  │  │ darwin-x64   │  │ darwin-arm64 │   │
│  │              │  │              │  │              │  │              │   │
│  │ ubuntu-latest│  │ ubuntu-latest│  │ macos-13     │  │ macos-14     │   │
│  │ docker/dload │  │ docker+QEMU  │  │ native build │  │ native build │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                 │           │
│         └─────────────────┴─────────────────┴─────────────────┘           │
│                                     │                                      │
│                                     ▼                                      │
│                            upload artifacts                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │ needs: build
          ▼
┌───────────────────┐
│ release job       │
│                   │
│ Download artifacts│
│ Create GH Release │
│ Upload all assets │
└─────────┬─────────┘
          │
          │ needs: release
          ▼
┌───────────────────┐
│ update-manifest   │
│                   │
│ Run update-       │
│ releases.ts       │
│ Commit changes    │
└───────────────────┘
```

## Platform Build Methods

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Platform Build Methods                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┬────────────────┬────────────────┬─────────────────────────┐
│ Platform        │ Runner         │ Build Method   │ Notes                   │
├─────────────────┼────────────────┼────────────────┼─────────────────────────┤
│                 │                │                │                         │
│ linux-x64       │ ubuntu-latest  │ Download or    │ Most databases have     │
│                 │                │ Docker         │ official Linux x64      │
│                 │                │                │                         │
├─────────────────┼────────────────┼────────────────┼─────────────────────────┤
│                 │                │                │                         │
│ linux-arm64     │ ubuntu-latest  │ Docker + QEMU  │ Few official binaries   │
│                 │                │                │ Slow (~45-90 min)       │
│                 │                │                │                         │
├─────────────────┼────────────────┼────────────────┼─────────────────────────┤
│                 │                │                │                         │
│ darwin-x64      │ macos-13       │ Native build   │ Real Intel Mac          │
│                 │                │                │ (~30-60 min)            │
│                 │                │                │                         │
├─────────────────┼────────────────┼────────────────┼─────────────────────────┤
│                 │                │                │                         │
│ darwin-arm64    │ macos-14       │ Native build   │ Real Apple Silicon      │
│                 │                │                │ (~30-60 min)            │
│                 │                │                │                         │
├─────────────────┼────────────────┼────────────────┼─────────────────────────┤
│                 │                │                │                         │
│ win32-x64       │ ubuntu-latest  │ Download       │ Most databases have     │
│                 │                │                │ official Windows x64    │
│                 │                │                │                         │
└─────────────────┴────────────────┴────────────────┴─────────────────────────┘

Why Docker can't build macOS binaries:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Docker containers share the host's kernel. Since macOS has a different    │
│  kernel than Linux, Docker (on any host) can only produce Linux binaries.  │
│                                                                             │
│  Solution: GitHub Actions provides real Mac hardware as runners:           │
│  - macos-13: Intel (x86_64) hardware                                       │
│  - macos-14: Apple Silicon (arm64) hardware                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow for SpinDB

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SpinDB Binary Download Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

User: spindb start mysql@8.4.7
              │
              ▼
┌─────────────────────────────────┐
│ 1. Fetch releases.json         │
│                                 │
│ GET https://raw.github...      │
│   /hostdb/main/releases.json   │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 2. Parse and find binary       │
│                                 │
│ releases.databases.mysql       │
│   ["8.4.7"]                    │
│   .platforms[currentPlatform]  │
│   .url                         │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 3. Download binary             │
│                                 │
│ GET https://github.com/        │
│   robertjbass/hostdb/          │
│   releases/download/           │
│   mysql-8.4.7/                 │
│   mysql-8.4.7-darwin-arm64.tar │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 4. Verify checksum             │
│                                 │
│ sha256(downloaded) ===         │
│   releases...sha256            │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 5. Extract and cache           │
│                                 │
│ ~/.spindb/databases/           │
│   mysql/8.4.7/                 │
│     bin/mysqld                 │
│     bin/mysql                  │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 6. Start database              │
│                                 │
│ ~/.spindb/databases/           │
│   mysql/8.4.7/bin/mysqld       │
│   --datadir=...                │
└─────────────────────────────────┘
```
