import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import AdmZip from "adm-zip";

/**
 * mc-rp-assistant-mcp — Resource Pack Analysis & Management MCP Server
 *
 * Tools:
 *   - read_packmeta: Read pack.mcmeta from a resource pack dir/zip
 *   - list_rpack_assets: List all asset entries (textures/models/sounds/lang) in a pack
 *   - validate_rp_structure: Validate a resource pack's structure and flag issues
 *   - compare_rpacks: Compare two resource packs and report differences
 *   - search_rp_on_modrinth: Search Modrinth for resource packs by name/tag
 *   - get_rp_info: Get detailed info about a Modrinth resource pack by slug/id
 */

// ── Lightweight .env loader (no external dependency) ───────────────────
function loadEnvFile(): void {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    try {
      for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch { /* ignore malformed .env */ }
  }
}
loadEnvFile();

// ── rp-config.json（可外部扩展的默认配置）─────────────────────────────
function loadRpConfig(): any {
  const builtin = {
    rpFormats: {
      "1.6": 1, "1.11": 2, "1.12": 3, "1.13": 4, "1.14": 5, "1.16": 6, "1.20.5+": 13,
    },
    maxSearchResults: 50,
    defaultSearchLimit: 10,
    packPngMaxSizeBytes: 51200,
  };
  try {
    const p = path.join(__dirname, "rp-config.json");
    if (!fs.existsSync(p)) return builtin;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...builtin, ...parsed };
  } catch {
    return builtin;
  }
}
const RP_CONFIG = loadRpConfig();

// 可配置项：环境变量 > .env 文件 > rp-config.json > 内置默认值
const envIconKb = parseInt(process.env.RP_ASSISTANT_PACK_ICON_MAX_KB || "", 10);
const CONFIG = {
  modrinthBase: process.env.RP_ASSISTANT_MODRINTH_API_BASE || "https://api.modrinth.com/v2",
  userAgent: process.env.RP_ASSISTANT_USER_AGENT || "mc-rp-assistant-mcp/1.0",
  textureMaxBytes: (parseFloat(process.env.RP_ASSISTANT_TEXTURE_MAX_MB || "2") || 2) * 1024 * 1024,
  packIconBytes: (envIconKb || Math.round((RP_CONFIG.packPngMaxSizeBytes || 51200) / 1024)) * 1024,
  defaultSearchLimit: parseInt(process.env.RP_ASSISTANT_DEFAULT_SEARCH_LIMIT || String(RP_CONFIG.defaultSearchLimit || 10), 10) || 10,
  maxSearchResults: parseInt(process.env.RP_ASSISTANT_MAX_SEARCH_RESULTS || String(RP_CONFIG.maxSearchResults || 50), 10) || 50,
};

// ── Modrinth API helpers ───────────────────────────────────────────────
async function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? require("node:https") : require("node:http");
    client.get(url, { headers: { "User-Agent": CONFIG.userAgent } }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

// ── pack.mcmeta parsing ────────────────────────────────────────────────
function readPackMeta(packDir: string): { format: number; description?: string; error?: string } {
  const metaPath = path.join(packDir, "pack.mcmeta");
  if (!fs.existsSync(metaPath)) {
    return { format: 0, error: "pack.mcmeta not found" };
  }
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const meta = JSON.parse(raw);
    return {
      format: typeof meta.format === "number" ? meta.format : 0,
      description: typeof meta.description === "string" ? meta.description : undefined,
    };
  } catch (e: any) {
    return { format: 0, error: `Invalid pack.mcmeta: ${e.message}` };
  }
}

// ── Pack version → required format number ──────────────────────────────
function packVersionToFormat(mcVersion: string): number {
  const m = mcVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return 6;
  const major = parseInt(m[1]);
  const minor = parseInt(m[2]);
  if (major > 1 || (major === 1 && minor >= 20)) return 13;
  if (major === 1 && minor >= 16) return 6;
  if (major === 1 && minor >= 14) return 5;
  if (major === 1 && minor >= 13) return 4;
  if (major === 1 && minor >= 12) return 3;
  if (major === 1 && minor >= 11) return 2;
  return 1;
}

function formatToPackVersion(format: number): string {
  const map: Record<number, string> = {};
  for (const [ver, fmt] of Object.entries(RP_CONFIG.rpFormats ?? {})) {
    map[fmt as number] = ver;
  }
  return map[format] ?? `format-${format}`;
}

// ── Asset scanning ─────────────────────────────────────────────────────
function scanAssetsDir(assetsDir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!fs.existsSync(assetsDir)) return counts;
  function walk(dir: string, relPrefix: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).replace(".", "");
        if (!counts[ext]) counts[ext] = 0;
        counts[ext]++;
      }
    }
  }
  walk(assetsDir, "");
  return counts;
}

function countAssetPaths(assetsDir: string): { textures: number; models: number; sounds: number; lang: number; other: number; total: number } {
  const extCounts = scanAssetsDir(assetsDir);
  let textures = 0, models = 0, sounds = 0, lang = 0, other = 0;
  for (const [ext, n] of Object.entries(extCounts)) {
    switch (ext) {
      case "png": case "webp": case "gif": case "jpeg": case "jpg": case "svg":
        textures += n; break;
      case "json": models += n; break;
      case "ogg": case "wav": case "mp3": case "flac": sounds += n; break;
      case "lang": lang += n; break;
      default: other += n;
    }
  }
  const total = textures + models + sounds + lang + other;
  return { textures, models, sounds, lang, other, total };
}

// ── pack.zip handling ──────────────────────────────────────────────────
function readPackMetaFromZip(zipPath: string): { format: number; description?: string; error?: string } {
  try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry("pack.mcmeta");
    if (!entry) return { format: 0, error: "pack.mcmeta not found in zip" };
    const raw = zip.readAsText(entry);
    const meta = JSON.parse(raw);
    return {
      format: typeof meta.format === "number" ? meta.format : 0,
      description: typeof meta.description === "string" ? meta.description : undefined,
    };
  } catch (e: any) {
    return { format: 0, error: e.message };
  }
}

function scanAssetsFromZip(zipPath: string): { textures: number; models: number; sounds: number; lang: number; other: number; total: number; entries: string[] } {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const assetEntries = entries.filter((e) => e.entryName.startsWith("assets/") && !e.isDirectory);
  const extCounts: Record<string, number> = {};
  for (const e of assetEntries) {
    const ext = path.extname(e.entryName).replace(".", "");
    if (!extCounts[ext]) extCounts[ext] = 0;
    extCounts[ext]++;
  }
  let textures = 0, models = 0, sounds = 0, lang = 0, other = 0;
  for (const [ext, n] of Object.entries(extCounts)) {
    switch (ext) {
      case "png": case "webp": case "gif": case "jpeg": case "jpg": case "svg":
        textures += n; break;
      case "json": models += n; break;
      case "ogg": case "wav": case "mp3": case "flac": sounds += n; break;
      case "lang": lang += n; break;
      default: other += n;
    }
  }
  const total = assetEntries.length;
  return { textures, models, sounds, lang, other, total, entries: assetEntries.map((e) => e.entryName) };
}

// ── Validation ─────────────────────────────────────────────────────────
function validateRpStructure(packDir: string, mcVersion?: string): { valid: boolean; errors: string[]; warnings: string[]; info: Record<string, any> } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: Record<string, any> = {};

  // pack.mcmeta
  const meta = readPackMeta(packDir);
  info.meta = meta;
  if (meta.error) {
    errors.push(meta.error);
  } else {
    info.metaFormat = meta.format;
    info.metaDescription = meta.description;
    if (mcVersion) {
      const expectedFormat = packVersionToFormat(mcVersion);
      if (meta.format !== expectedFormat) {
        warnings.push(`Expected format ${expectedFormat} for MC ${mcVersion}, got ${meta.format}`);
      }
      info.expectedFormat = expectedFormat;
    }
  }

  // assets folder
  const assetsDir = path.join(packDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const assetInfo = countAssetPaths(assetsDir);
    info.assetCounts = assetInfo;
    info.assetTotals = assetInfo.total;

    // Check for empty namespaces
    const namespaces = fs.readdirSync(assetsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    info.namespaces = namespaces;

    for (const ns of namespaces) {
      const nsDir = path.join(assetsDir, ns);
      if (ns === "minecraft") {
        // Override pack — check if it has any actual overrides
        const files = [];
        function collectFiles(dir: string, prefix: string) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) collectFiles(full, rel);
            else if (entry.isFile() && rel.endsWith(".json")) files.push(rel);
          }
        }
        collectFiles(nsDir, ns);
        if (files.length === 0) {
          warnings.push(`Empty 'minecraft' namespace in assets — no overrides detected`);
        }
      }
    }
  } else {
    warnings.push("No assets/ directory found");
  }

  // pack.png
  const packPng = path.join(packDir, "pack.png");
  if (fs.existsSync(packPng)) {
    const stat = fs.statSync(packPng);
    info.packPngSize = stat.size;
    if (stat.size > CONFIG.packIconBytes) {
      warnings.push(`pack.png is ${Math.round(stat.size / 1024)}KB — consider compressing (recommended < ${Math.round(CONFIG.packIconBytes / 1024)}KB)`);
    }
  } else {
    warnings.push("No pack.png found (icon will not display in pack selection)");
  }

  // resources folder (old-style 1.6 and earlier)
  const resourcesDir = path.join(packDir, "resources");
  if (fs.existsSync(resourcesDir)) {
    warnings.push("Found 'resources/' folder — this is the old pre-1.6 layout; consider renaming to 'assets/'");
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings, info };
}

// ── Compare two resource packs ─────────────────────────────────────────
function compareRpacks(oldPackDir: string, newPackDir: string): { added: string[]; removed: string[]; changed: string[]; summary: Record<string, any> } {
  const oldAssets = path.join(oldPackDir, "assets");
  const newAssets = path.join(newPackDir, "assets");

  function getAllFiles(dir: string): Set<string> {
    const files = new Set<string>();
    if (!fs.existsSync(dir)) return files;
    function walk(d: string, prefix: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else files.add(rel);
      }
    }
    walk(dir, "");
    return files;
  }

  const oldFiles = getAllFiles(oldAssets);
  const newFiles = getAllFiles(newAssets);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const f of newFiles) {
    if (!oldFiles.has(f)) added.push(f);
  }
  for (const f of oldFiles) {
    if (!newFiles.has(f)) removed.push(f);
    else {
      // Check if content differs
      const oldPath = path.join(oldAssets, f);
      const newPath = path.join(newAssets, f);
      try {
        const oldContent = fs.readFileSync(oldPath);
        const newContent = fs.readFileSync(newPath);
        if (!oldContent.equals(newContent)) changed.push(f);
      } catch { /* binary comparison may fail for some files */ }
    }
  }

  const oldMeta = readPackMeta(oldPackDir);
  const newMeta = readPackMeta(newPackDir);

  return {
    added,
    removed,
    changed,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      totalNewFiles: newFiles.size,
      totalOldFiles: oldFiles.size,
      oldFormat: oldMeta.format,
      newFormat: newMeta.format,
      oldDescription: oldMeta.description,
      newDescription: newMeta.description,
    },
  };
}

// ── Texture Validation ────────────────────────────────────────────────
function validateTextures(packDir: string): { issues: string[]; stats: Record<string, any> } {
  const issues: string[] = [];
  const stats: Record<string, any> = { totalTextures: 0, largeTextures: 0, namingIssues: 0, totalSizeBytes: 0 };
  const MAX_TEXTURE_BYTES = CONFIG.textureMaxBytes; // 单张纹理大小上限，默认 2MB
  const MAX_PACK_ICON_BYTES = CONFIG.packIconBytes; // 包图标大小上限，默认 50KB

  function walkTextures(dir: string, prefix: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walkTextures(full, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".png", ".webp", ".gif", ".jpeg", ".jpg"].includes(ext)) {
          stats.totalTextures++;
          try {
            const stat = fs.statSync(full);
            stats.totalSizeBytes += stat.size;
            if (stat.size > MAX_TEXTURE_BYTES) {
              stats.largeTextures++;
              issues.push(`${rel}: ${Math.round(stat.size / 1024)}KB — exceeds 2MB limit, will cause performance issues`);
            }
          } catch { /* ignore */ }
        }
        // Check naming: lowercase, no spaces, no special chars except - _ .
        if (ext === ".png" || ext === ".json") {
          if (entry.name !== entry.name.toLowerCase()) {
            stats.namingIssues++;
            issues.push(`${rel}: filename has uppercase characters — Minecraft is case-sensitive on Linux`);
          }
          if (/\s/.test(entry.name)) {
            stats.namingIssues++;
            issues.push(`${rel}: filename contains spaces — use hyphens instead`);
          }
          if (!/^[a-z0-9/_\-\.]+$/.test(entry.name.replace(/^\//, ""))) {
            // Only flag if truly problematic
          }
        }
      }
    }
  }

  const texturesDir = path.join(packDir, "assets");
  walkTextures(texturesDir, "assets");

  // Check pack.png separately
  const packPng = path.join(packDir, "pack.png");
  if (fs.existsSync(packPng)) {
    try {
      const stat = fs.statSync(packPng);
      if (stat.size > MAX_PACK_ICON_BYTES) {
        issues.push(`pack.png: ${Math.round(stat.size / 1024)}KB — recommend compressing below 50KB`);
      }
    } catch { /* ignore */ }
  }

  return { issues, stats };
}

// ── Language File Analysis ────────────────────────────────────────────
function analyzeLangFiles(packDir: string): { languages: Record<string, number>; missingKeys: Array<{ key: string; missingIn: string[] }>; totalKeys: number; issues: string[] } {
  const langDir = path.join(packDir, "assets", "minecraft", "lang");
  const languages: Record<string, number> = {};
  const allKeysByLang: Record<string, Set<string>> = {};
  const issues: string[] = [];

  if (!fs.existsSync(langDir)) {
    issues.push("No lang/ directory found in assets/minecraft/");
    return { languages: {}, missingKeys: [], totalKeys: 0, issues };
  }

  const langFiles = fs.readdirSync(langDir).filter((f) => f.endsWith(".lang"));
  if (langFiles.length === 0) {
    issues.push("No .lang files found in assets/minecraft/lang/");
    return { languages, missingKeys: [], totalKeys: 0, issues };
  }

  for (const file of langFiles) {
    const langName = file.replace(".lang", "");
    const content = fs.readFileSync(path.join(langDir, file), "utf8");
    const keys = new Set<string>();
    let lineCount = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      lineCount++;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        keys.add(key);
      }
    }
    languages[langName] = keys.size;
    allKeysByLang[langName] = keys;
  }

  // Find keys missing from any language
  const allLangNames = Object.keys(languages);
  if (allLangNames.length > 1) {
    const baseLang = allLangNames[0];
    const baseKeys = allKeysByLang[baseLang];
    const missingKeys: Array<{ key: string; missingIn: string[] }> = [];
    for (const key of baseKeys) {
      const missingIn = allLangNames.filter((l) => l !== baseLang && !allKeysByLang[l].has(key));
      if (missingIn.length > 0) {
        missingKeys.push({ key, missingIn });
      }
    }
    // Also check for keys unique to other languages
    for (let i = 1; i < allLangNames.length; i++) {
      const lang = allLangNames[i];
      for (const key of allKeysByLang[lang]) {
        if (!allKeysByLang[baseLang].has(key)) {
          missingKeys.push({ key: `[${lang}] ${key}`, missingIn: [baseLang] });
        }
      }
    }
    return { languages, missingKeys, totalKeys: baseKeys.size, issues };
  }

  return { languages, missingKeys: [], totalKeys: Object.values(languages)[0] || 0, issues };
}

// ── Compare two resource packs (with per-file diff detail) ────────────
function compareRpacksDetailed(oldPackDir: string, newPackDir: string): { added: Array<{ path: string; size: number }>; removed: Array<{ path: string; size: number }>; changed: Array<{ path: string; oldSize: number; newSize: number }>; summary: Record<string, any> } {
  const oldAssets = path.join(oldPackDir, "assets");
  const newAssets = path.join(newPackDir, "assets");

  function getAllFilesWithSize(dir: string): Map<string, number> {
    const files = new Map<string, number>();
    if (!fs.existsSync(dir)) return files;
    function walk(d: string, prefix: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else {
          try { files.set(rel, fs.statSync(full).size); } catch { files.set(rel, 0); }
        }
      }
    }
    walk(dir, "");
    return files;
  }

  const oldFiles = getAllFilesWithSize(oldAssets);
  const newFiles = getAllFilesWithSize(newAssets);

  const added: Array<{ path: string; size: number }> = [];
  const removed: Array<{ path: string; size: number }> = [];
  const changed: Array<{ path: string; oldSize: number; newSize: number }> = [];

  for (const [f, size] of newFiles) {
    if (!oldFiles.has(f)) added.push({ path: f, size });
  }
  for (const [f, oldSize] of oldFiles) {
    if (!newFiles.has(f)) removed.push({ path: f, size: oldSize });
    else {
      try {
        const oldPath = path.join(oldAssets, f);
        const newPath = path.join(newAssets, f);
        const oldContent = fs.readFileSync(oldPath);
        const newContent = fs.readFileSync(newPath);
        if (!oldContent.equals(newContent)) {
          changed.push({ path: f, oldSize, newSize: newFiles.get(f)! });
        }
      } catch { /* binary comparison may fail */ }
    }
  }

  const oldMeta = readPackMeta(oldPackDir);
  const newMeta = readPackMeta(newPackDir);

  return {
    added,
    removed,
    changed,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      totalAddedBytes: added.reduce((s, f) => s + f.size, 0),
      totalRemovedBytes: removed.reduce((s, f) => s + f.size, 0),
      totalNewFiles: newFiles.size,
      totalOldFiles: oldFiles.size,
      oldFormat: oldMeta.format,
      newFormat: newMeta.format,
      oldDescription: oldMeta.description,
      newDescription: newMeta.description,
    },
  };
}

// ── Exported public API ────────────────────────────────────────────────

/**
 * Read pack.mcmeta from a resource pack directory or zip file.
 */
export function readPackMetaExport(packPath: string): { format: number; description?: string; error?: string; source: string } {
  const resolved = path.resolve(packPath);
  if (resolved.toLowerCase().endsWith(".zip")) {
    const meta = readPackMetaFromZip(resolved);
    return { ...meta, source: `zip:${path.basename(resolved)}` };
  }
  const meta = readPackMeta(resolved);
  return { ...meta, source: `dir:${path.basename(resolved)}` };
}

/**
 * Validate a resource pack's structure against best practices.
 */
export function validateRpStructureExport(packPath: string, mcVersion?: string): { valid: boolean; errors: string[]; warnings: string[]; info: Record<string, any>; source: string } {
  const resolved = path.resolve(packPath);
  const result = validateRpStructure(resolved, mcVersion);
  return { ...result, source: path.basename(resolved) } as any;
}

/**
 * List all asset paths in a resource pack (from directory or zip).
 */
export function listRpAssets(packPath: string, limit?: number): { assets: string[]; counts: Record<string, number>; total: number; source: string } {
  const resolved = path.resolve(packPath);
  let entries: string[];
  let counts: Record<string, number> = {};
  if (resolved.toLowerCase().endsWith(".zip")) {
    const zipInfo = scanAssetsFromZip(resolved);
    entries = zipInfo.entries;
    counts = {};
    for (const e of entries) {
      const ext = path.extname(e).replace(".", "");
      if (!counts[ext]) counts[ext] = 0;
      counts[ext]++;
    }
  } else {
    const assetsDir = path.join(resolved, "assets");
    if (!fs.existsSync(assetsDir)) return { assets: [], counts: {}, total: 0, source: path.basename(resolved) };
    entries = [];
    function walk(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else entries.push(rel);
      }
    }
    walk(assetsDir, "assets");
    counts = scanAssetsDir(assetsDir);
  }
  const limited = limit ? entries.slice(0, limit) : entries;
  return { assets: limited, counts, total: entries.length, source: path.basename(resolved) };
}

/**
 * Compare two resource packs and return the diff.
 */
export function compareRpacksExport(oldPackPath: string, newPackPath: string): { added: string[]; removed: string[]; changed: string[]; summary: Record<string, any>; oldSource: string; newSource: string } {
  const oldResolved = path.resolve(oldPackPath);
  const newResolved = path.resolve(newPackPath);
  const result = compareRpacks(oldResolved, newResolved);
  return { ...result, oldSource: path.basename(oldResolved), newSource: path.basename(newResolved) } as any;
}

/**
 * Validate textures in a resource pack for size limits and naming conventions.
 */
export function validateTexturesExport(packPath: string): { issues: string[]; stats: Record<string, any>; source: string } {
  const resolved = path.resolve(packPath);
  const result = validateTextures(resolved);
  return { ...result, source: path.basename(resolved) };
}

/**
 * Analyze language files in a resource pack and detect missing translations.
 */
export function analyzeLangFilesExport(packPath: string): { languages: Record<string, number>; missingKeys: Array<{ key: string; missingIn: string[] }>; totalKeys: number; issues: string[]; source: string } {
  const resolved = path.resolve(packPath);
  const result = analyzeLangFiles(resolved);
  return { ...result, source: path.basename(resolved) };
}

/**
 * Compare two resource packs with detailed per-file diff info including file sizes.
 */
export function compareRpacksDiffExport(oldPackPath: string, newPackPath: string): { added: Array<{ path: string; size: number }>; removed: Array<{ path: string; size: number }>; changed: Array<{ path: string; oldSize: number; newSize: number }>; summary: Record<string, any>; oldSource: string; newSource: string } {
  const oldResolved = path.resolve(oldPackPath);
  const newResolved = path.resolve(newPackPath);
  const result = compareRpacksDetailed(oldResolved, newResolved);
  return { ...result, oldSource: path.basename(oldResolved), newSource: path.basename(newResolved) } as any;
}

/**
 * Search Modrinth for resource packs.
 */
export async function searchRpOnModrinth(query: string, limit: number = CONFIG.defaultSearchLimit): Promise<any[]> {
  try {
    const capped = Math.max(1, Math.min(limit, CONFIG.maxSearchResults));
    const data = await fetchJSON(`${CONFIG.modrinthBase}/search?query=${encodeURIComponent(query)}&type=resourcepack&limit=${capped}`);
    return (data.hits || []).map((h: any) => ({
      id: h.id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      downloads: h.downloads,
      authors: h.authors?.map((a: any) => a.name) || [],
      tags: h.tags || [],
      url: `https://modrinth.com/resource-pack/${h.slug}`,
    }));
  } catch {
    return [];
  }
}

/**
 * Get detailed info about a specific Modrinth resource pack.
 */
export async function getRpInfo(slugOrId: string): Promise<any | null> {
  try {
    const data = await fetchJSON(`${CONFIG.modrinthBase}/project/${slugOrId}`);
    return {
      id: data.id,
      slug: data.slug,
      title: data.title,
      description: data.description,
      downloads: data.downloads,
      version: data.versions?.[0] || null,
      team: data.team || null,
      categories: data.categories || [],
      tags: data.tags || [],
      url: `https://modrinth.com/resource-pack/${data.slug}`,
      license: data.license?.id || null,
      published: data.published,
      updated: data.updated,
    };
  } catch {
    return null;
  }
}

// ── MCP Server Setup ───────────────────────────────────────────────────
function main() {
  const server = new McpServer({
    name: "mc-rp-assistant-mcp",
    version: "1.0.0",
  });

  // Tool: read_packmeta
  server.tool(
    "read_packmeta",
    "Read pack.mcmeta metadata from a resource pack directory or zip file.",
    {
      packPath: z.string().describe("Path to the resource pack directory or .zip file"),
    },
    async ({ packPath }) => {
      const result = readPackMetaExport(packPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: validate_rp_structure
  server.tool(
    "validate_rp_structure",
    "Validate a resource pack's structure and flag issues (missing files, format mismatches, large icons, etc.).",
    {
      packPath: z.string().describe("Path to the resource pack directory"),
      mcVersion: z.string().optional().describe("Minecraft version to validate against (e.g. '1.20.1')"),
    },
    async ({ packPath, mcVersion }) => {
      const result = validateRpStructureExport(packPath, mcVersion);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: list_rp_assets
  server.tool(
    "list_rp_assets",
    "List all asset paths (textures, models, sounds, lang) in a resource pack. Supports both directories and .zip files.",
    {
      packPath: z.string().describe("Path to the resource pack directory or .zip"),
      limit: z.number().optional().describe("Max number of asset paths to return (default: all)"),
    },
    async ({ packPath, limit }) => {
      const result = listRpAssets(packPath, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: compare_rpacks
  server.tool(
    "compare_rpacks",
    "Compare two resource packs and report added, removed, and changed asset files.",
    {
      oldPackPath: z.string().describe("Path to the old resource pack directory or .zip"),
      newPackPath: z.string().describe("Path to the new resource pack directory or .zip"),
    },
    async ({ oldPackPath, newPackPath }) => {
      const result = compareRpacksExport(oldPackPath, newPackPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: search_rp_on_modrinth
  server.tool(
    "search_rp_on_modrinth",
    "Search Modrinth for resource packs by name or tag. Returns up to `limit` results.",
    {
      query: z.string().describe("Search query (e.g. 'shaders', 'pixel art', 'vanilla+')"),
      limit: z.number().optional().describe("Max results (default: 10, max: 50)"),
    },
    async ({ query, limit }) => {
      const results = await searchRpOnModrinth(query, limit || CONFIG.defaultSearchLimit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // Tool: get_rp_info
  server.tool(
    "get_rp_info",
    "Get detailed info about a Modrinth resource pack by its slug or project ID.",
    {
      slugOrId: z.string().describe("Resource pack slug or project ID on Modrinth"),
    },
    async ({ slugOrId }) => {
      const info = await getRpInfo(slugOrId);
      if (info === null) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Resource pack not found or API error" }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );

  // Tool: validate_textures
  server.tool(
    "validate_textures",
    "Validate textures in a resource pack for size limits (>2MB), naming conventions (lowercase, no spaces), and pack icon size.",
    {
      packPath: z.string().describe("Path to the resource pack directory"),
    },
    async ({ packPath }) => {
      const result = validateTexturesExport(packPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: analyze_lang_files
  server.tool(
    "analyze_lang_files",
    "Analyze language files (.lang) in a resource pack and detect missing translations across languages.",
    {
      packPath: z.string().describe("Path to the resource pack directory"),
    },
    async ({ packPath }) => {
      const result = analyzeLangFilesExport(packPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: compare_rpacks_diff
  server.tool(
    "compare_rpacks_diff",
    "Compare two resource packs with detailed per-file information including file sizes for added/removed/changed assets.",
    {
      oldPackPath: z.string().describe("Path to the old resource pack directory"),
      newPackPath: z.string().describe("Path to the new resource pack directory"),
    },
    async ({ oldPackPath, newPackPath }) => {
      const result = compareRpacksDiffExport(oldPackPath, newPackPath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  const transport = new StdioServerTransport();
  server.connect(transport);
}

main();
