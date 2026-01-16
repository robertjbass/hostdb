# MongoDB

MongoDB releases for hostdb bundle three official components into a single, complete package:

| Component | Description | Binaries |
|-----------|-------------|----------|
| **MongoDB Server** | Core database server | `mongod`, `mongos` |
| **MongoDB Shell** | Interactive JavaScript interface | `mongosh` |
| **Database Tools** | Backup and data utilities | `mongodump`, `mongorestore`, `mongoexport`, `mongoimport`, `mongostat`, `mongotop`, `bsondump`, `mongofiles` |

## Why Bundle?

Since MongoDB 4.4, the shell and database tools are distributed separately from the server. This creates friction for users who expect a complete MongoDB installation.

hostdb follows the **complete, embeddable binary** philosophy: every release should be self-contained and ready to use without additional downloads. When you download a MongoDB release from hostdb, you get everything needed to run a database, connect to it, and manage backups.

## Versions

| Version | Type | EOL | Notes |
|---------|------|-----|-------|
| 8.2.3 | Rapid Release | March 2026 | Latest features, shorter support |
| 8.0.17 | LTS | Oct 2029 | **Recommended** - 5-year support |
| 7.0.28 | LTS | Aug 2027 | Previous LTS |

## Component Versions

The server version determines the release version (e.g., `mongodb-8.0.17`). The bundled shell and tools use their latest compatible versions:

- **mongosh**: Supports MongoDB Server 4.2 and later (older servers require the legacy `mongo` shell)
- **Database Tools**: Version 100.x is compatible with MongoDB Server 4.2 and later

Current bundled versions are specified in `sources.json` under the `components` section.

## Platforms

| Platform | Server | Shell | Tools |
|----------|--------|-------|-------|
| linux-x64 | ✓ | ✓ | ✓ |
| linux-arm64 | ✓ | ✓ | ✓ |
| darwin-x64 | ✓ | ✓ | ✓ |
| darwin-arm64 | ✓ | ✓ | ✓ |
| win32-x64 | ✓ | ✓ | ✓ |

## Usage

```bash
# Download and bundle for current platform
pnpm download:mongodb -- --version 8.0.17

# Download for all platforms
pnpm download:mongodb -- --version 8.0.17 --all-platforms

# Specific platform
pnpm download:mongodb -- --version 8.0.17 --platform linux-arm64
```

## Output Structure

```
mongodb/
├── bin/
│   ├── mongod          # Server
│   ├── mongos          # Sharding router
│   ├── mongosh         # Shell (bundled)
│   ├── mongodump       # Backup tool (bundled)
│   ├── mongorestore    # Restore tool (bundled)
│   ├── mongoexport     # Export tool (bundled)
│   ├── mongoimport     # Import tool (bundled)
│   ├── mongostat       # Stats tool (bundled)
│   ├── mongotop        # Top tool (bundled)
│   ├── bsondump        # BSON tool (bundled)
│   └── mongofiles      # GridFS tool (bundled)
├── lib/
├── LICENSE-*
└── .hostdb-metadata.json
```

## License

MongoDB is licensed under **SSPL-1.0** (Server Side Public License).

- ✓ Internal use and development
- ✓ Commercial use within your organization
- ✓ Redistribution of binaries
- ⚠️ Offering MongoDB as a hosted service to third parties requires releasing your service's source code (or obtaining a commercial license)

## Sources

- Server: [fastdl.mongodb.org](https://fastdl.mongodb.org/)
- Shell: [downloads.mongodb.com/compass](https://downloads.mongodb.com/compass/)
- Database Tools: [fastdl.mongodb.org/tools/db](https://fastdl.mongodb.org/tools/db/)

## Notes

- Linux binaries target Ubuntu 22.04 (glibc 2.35+)
- macOS binaries work on recent macOS versions
- Windows binaries are standard x64 releases
