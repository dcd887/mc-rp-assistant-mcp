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

## MCP Client Configuration

Add to your MCP client config (e.g., Trae `settings.json` or MCP CLI config):

```json
{
  "mcpServers": {
    "mc-rp-assistant": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"]
    }
  }
}
```

> **Path note:** `${workspaceFolder}` resolves to the project root in Trae/VS Code. If using another editor, replace with the absolute path, e.g. `["C:/Users/xxx/Desktop/mc-rp-assistant-mcp/dist/index.js"]`.

## Configuration

本工具零配置即可用（内置默认值，任何环境开箱即用）。以下项目可通过环境变量或项目根目录 `.env` 文件覆盖（复制 `.env.example` 为 `.env`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RP_ASSISTANT_MODRINTH_API_BASE` | `https://api.modrinth.com/v2` | Modrinth API 根地址，支持自建网关/代理 |
| `RP_ASSISTANT_USER_AGENT` | `mc-rp-assistant-mcp/1.0` | 请求 User-Agent（Modrinth 要求标明来源） |
| `RP_ASSISTANT_TEXTURE_MAX_MB` | `2` | 单张纹理大小上限（MB），超过则标记为大纹理 |
| `RP_ASSISTANT_PACK_ICON_MAX_KB` | `50` | 资源包图标 `pack.png` 大小上限（KB） |
| `RP_ASSISTANT_DEFAULT_SEARCH_LIMIT` | `10` | Modrinth 资源包搜索默认返回条数 |
| `RP_ASSISTANT_MAX_SEARCH_RESULTS` | `50` | Modrinth 搜索返回条数硬上限 |

优先级：环境变量 > `.env` 文件 > `rp-config.json` > 内置默认值。改动后重启 MCP server 生效。

**扩展默认配置**：编辑 `src/rp-config.json`（构建后为 `dist/rp-config.json`）可调整搜索上限、`pack.png` 大小阈值与 MC 版本 → `pack_format` 映射，无需改代码。

## Requirements

- Node.js 18+
- `@modelcontextprotocol/sdk`, `zod`, `adm-zip`
- `adm-zip` is required for `.zip` / `.mcpkg` resource pack support — included as a dependency

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
