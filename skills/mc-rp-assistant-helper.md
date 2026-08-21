# mc-rp-assistant-mcp Skill

## Overview

The mc-rp-assistant-mcp provides tools for analyzing, validating, and comparing Minecraft resource packs. It scans local resource pack directories or .zip files to check structure, read metadata, list assets, and compare versions. It can also search Modrinth for resource packs when online.

## When to Use This MCP

- When the user asks to check or validate a resource pack's structure
- When the user wants to see what assets a resource pack contains
- When the user needs to compare two resource pack versions
- When the user wants to read pack.mcmeta from a resource pack
- When the user wants to search for resource packs on Modrinth
- When the user wants details about a specific Modrinth resource pack

## Available Tools

### read_packmeta
Reads `pack.mcmeta` from a resource pack directory or .zip file. Returns format version, description, and source path.

**Parameters:**
- `packPath` (string): Path to the resource pack directory or .zip

**Returns:** `{ format, description, error?, source }`

### validate_rp_structure
Validates a resource pack's directory structure against best practices. Checks for:
- Missing or invalid `pack.mcmeta`
- Format version compatibility with target MC version
- Missing `pack.png` icon
- Large `pack.png` (>50KB)
- Empty `minecraft` namespace in `assets/`
- Legacy `resources/` folder (pre-1.6)

**Parameters:**
- `packPath` (string): Path to the resource pack directory
- `mcVersion` (string, optional): Minecraft version to validate format against

**Returns:** `{ valid, errors[], warnings[], info }`

### list_rp_assets
Lists all asset paths in a resource pack. Supports both directories and .zip files.

**Parameters:**
- `packPath` (string): Path to the resource pack directory or .zip
- `limit` (number, optional): Max number of paths to return

**Returns:** `{ assets[], counts{ext: n}, total, source }`

### compare_rpacks
Compares two resource packs and reports which asset files were added, removed, or changed.

**Parameters:**
- `oldPackPath` (string): Path to the old resource pack
- `newPackPath` (string): Path to the new resource pack

**Returns:** `{ added[], removed[], changed[], summary{addedCount, removedCount, changedCount, ...}, oldSource, newSource }`

### compare_rpacks_diff
Compare two resource packs with detailed per-file information including file sizes for added/removed/changed assets. More detailed than `compare_rpacks`.

**Parameters:**
- `oldPackPath` (string): Path to the old resource pack directory
- `newPackPath` (string): Path to the new resource pack directory

**Returns:** `{ added[{path, size}], removed[{path, size}], changed[{path, oldSize, newSize}], summary{totalAddedBytes, totalRemovedBytes, ...}, oldSource, newSource }`

### validate_textures
Validates all textures in a resource pack for size limits (>2MB flagged), naming conventions (uppercase flagged, spaces flagged), and pack.png icon size.

**Parameters:**
- `packPath` (string): Path to the resource pack directory

**Returns:** `{ issues[], stats{totalTextures, largeTextures, namingIssues, totalSizeBytes}, source }`

### analyze_lang_files
Analyzes `.lang` files in `assets/minecraft/lang/` and detects missing translations across different languages. Returns per-language key counts and keys missing from each language.

**Parameters:**
- `packPath` (string): Path to the resource pack directory

**Returns:** `{ languages{lang: keyCount}, missingKeys[{key, missingIn[]}], totalKeys, issues[], source }`

### search_rp_on_modrinth
Searches Modrinth for resource packs. Returns up to `limit` results with title, description, downloads, authors, and URL.

**Parameters:**
- `query` (string): Search query (e.g. "shaders", "pixel art")
- `limit` (number, optional): Max results (default: 10, max: 50)

**Returns:** Array of `{ id, slug, title, description, downloads, authors, tags, url }`

### get_rp_info
Gets detailed information about a specific Modrinth resource pack.

**Parameters:**
- `slugOrId` (string): Resource pack slug or project ID

**Returns:** `{ id, slug, title, description, downloads, version, categories, tags, url, license, published, updated }` or `null` if not found

## Integration

Add to Trae MCP config (`~/.trae-cn/mcp_config.json`):

```json
{
  "mcpServers": {
    "mc-rp-assistant-mcp": {
      "command": "node",
      "args": ["c:/Users/kjds/Desktop/mc-rp-assistant-mcp/dist/index.js"]
    }
  }
}
```

## Notes

- All paths are resolved as absolute paths before processing
- `.zip` resource packs are supported via `adm-zip` (no extraction to disk)
- Modrinth API calls have graceful offline fallback (returns empty array or null)
- Pack format version mapping follows official Minecraft documentation
