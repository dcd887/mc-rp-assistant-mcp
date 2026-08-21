# mc-rp-assistant-mcp

MCP server for Minecraft resource pack analysis, validation, and management. Reads pack.mcmeta, validates structure, lists assets, compares packs, and queries Modrinth.

## Tools

| Tool | Description |
|------|-------------|
| `read_packmeta` | Read pack.mcmeta from a resource pack directory or .zip file |
| `validate_rp_structure` | Validate a resource pack's structure and flag issues (missing files, format mismatches, large icons, etc.) |
| `list_rp_assets` | List all asset paths (textures/models/sounds/lang) in a pack. Supports both directories and .zip files |
| `compare_rpacks` | Compare two resource packs and report added, removed, and changed asset files |
| `search_rp_on_modrinth` | Search Modrinth for resource packs by name or tag. Returns up to `limit` results |
| `get_rp_info` | Get detailed info about a Modrinth resource pack by its slug or project ID |
| `validate_textures` | Validate textures for size limits (>2MB), naming conventions (lowercase, no spaces), and pack icon size |
| `analyze_lang_files` | Analyze language files (.lang) and detect missing translations across languages |
| `compare_rpacks_diff` | Compare two resource packs with detailed per-file info including file sizes for added/removed/changed assets |

## Exported Functions

- `readPackMetaExport(packPath)` — Read pack.mcmeta
- `validateRpStructureExport(packPath, mcVersion?)` — Validate pack structure
- `listRpAssetsExport(packPath, limit?)` — List asset files
- `compareRpacksExport(oldPackPath, newPackPath)` — Compare two packs
- `searchRpOnModrinthExport(query, limit?)` — Search Modrinth
- `getRpInfoExport(slugOrId)` — Get pack info from Modrinth
- `validateTexturesExport(packPath)` — Validate textures
- `analyzeLangFilesExport(packPath)` — Analyze language files
- `compareRpacksDiffExport(oldPackPath, newPackPath)` — Detailed pack comparison

## Usage

```json
{
  "mcpServers": {
    "mc-rp-assistant-mcp": {
      "command": "node",
      "args": ["<path/to/mc-rp-assistant-mcp>/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run build   # Compile TypeScript
npm run test:unit  # Run unit tests
npm test        # Run all tests
```

## Testing

```bash
npm run build
npm test
```

All unit tests are offline except `searchRpOnModrinth` and `getRpInfo` which gracefully return empty results when no network is available.

## Platform Compatibility

| Tool | Windows | macOS | Linux |
|------|---------|-------|-------|
| `read_packmeta` | ✅ | ✅ | ✅ |
| `validate_rp_structure` | ✅ | ✅ | ✅ |
| `list_rp_assets` | ✅ | ✅ | ✅ |
| `compare_rpacks` | ✅ | ✅ | ✅ |
| `search_rp_on_modrinth` | ✅ | ✅ | ✅ |
| `get_rp_info` | ✅ | ✅ | ✅ |
| `validate_textures` | ✅ | ✅ | ✅ |
| `analyze_lang_files` | ✅ | ✅ | ✅ |
| `compare_rpacks_diff` | ✅ | ✅ | ✅ |

All tools use cross-platform Node.js `fs` and `path` APIs. `.zip` support requires `adm-zip`. Network-dependent tools (`search_rp_on_modrinth`, `get_rp_info`) work on all platforms when online; they return empty results gracefully when offline.

## Requirements

- Node.js 18+
- `@modelcontextprotocol/sdk`, `zod`, `adm-zip`

## License

MIT
