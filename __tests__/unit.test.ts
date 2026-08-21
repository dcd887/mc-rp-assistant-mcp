const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const mod = require("../dist/index");

describe("readPackMetaExport", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("reads valid pack.mcmeta correctly", () => {
    const packDir = path.join(tmpDir, "valid-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({
      format: 6,
      description: "A test pack",
    }));
    const result = mod.readPackMetaExport(packDir);
    assert.equal(result.format, 6);
    assert.equal(result.description, "A test pack");
    assert.ok(result.source.includes("valid-pack"));
  });

  it("returns error when pack.mcmeta is missing", () => {
    const packDir = path.join(tmpDir, "no-meta");
    fs.mkdirSync(packDir, { recursive: true });
    const result = mod.readPackMetaExport(packDir);
    assert.ok(result.error !== undefined);
    assert.equal(result.format, 0);
  });

  it("handles invalid JSON in pack.mcmeta", () => {
    const packDir = path.join(tmpDir, "bad-meta");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), "{invalid json");
    const result = mod.readPackMetaExport(packDir);
    assert.ok(result.error !== undefined);
  });
});

describe("validateRpStructure", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-val-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("validates a well-formed resource pack", () => {
    const packDir = path.join(tmpDir, "good-pack");
    // pack.mcmeta
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6, description: "Good pack" }));
    // assets/minecraft/textures/block/dirt.png (placeholder)
    const dirtDir = path.join(packDir, "assets", "minecraft", "textures", "block");
    fs.mkdirSync(dirtDir, { recursive: true });
    fs.writeFileSync(path.join(dirtDir, "dirt.png"), Buffer.alloc(100, 0));
    // pack.png icon
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(5000, 0));

    const result = mod.validateRpStructureExport(packDir, "1.20.1");
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.info.assetCounts);
  });

  it("flags missing pack.png", () => {
    const packDir = path.join(tmpDir, "no-icon-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));

    const result = mod.validateRpStructureExport(packDir);
    assert.ok(result.warnings.some((w) => w.includes("pack.png")));
  });

  it("flags format mismatch with MC version", () => {
    const packDir = path.join(tmpDir, "wrong-format-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 1 })); // format 1 is for MC 1.6
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(100, 0));

    const result = mod.validateRpStructureExport(packDir, "1.20.1");
    assert.ok(result.warnings.some((w) => w.includes("Expected format")));
  });

  it("flags empty minecraft namespace", () => {
    const packDir = path.join(tmpDir, "empty-ns-pack");
    fs.mkdirSync(path.join(packDir, "assets", "minecraft"), { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(100, 0));

    const result = mod.validateRpStructureExport(packDir);
    assert.ok(result.warnings.some((w) => w.includes("Empty 'minecraft' namespace")));
  });

  it("flags large pack.png", () => {
    const packDir = path.join(tmpDir, "big-icon-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    // 60KB icon
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(60 * 1024, 0));

    const result = mod.validateRpStructureExport(packDir);
    assert.ok(result.warnings.some((w) => w.includes("pack.png")));
  });
});

describe("listRpAssets", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-assets-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("lists asset files from a directory", () => {
    const packDir = path.join(tmpDir, "asset-pack");
    const assetsDir = path.join(packDir, "assets", "minecraft", "textures", "block");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(path.join(packDir, "assets", "minecraft", "models", "block"), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "dirt.png"), Buffer.alloc(10, 0));
    fs.writeFileSync(path.join(assetsDir, "stone.png"), Buffer.alloc(10, 0));
    fs.writeFileSync(path.join(packDir, "assets", "minecraft", "models", "block", "dirt.json"), "{}");

    const result = mod.listRpAssets(packDir);
    assert.ok(result.total >= 3);
    assert.ok(result.assets.length >= 3);
    assert.ok(result.counts["png"] >= 2);
    assert.ok(result.counts["json"] >= 1);
  });

  it("respects the limit parameter", () => {
    const packDir = path.join(tmpDir, "limit-pack");
    const assetsDir = path.join(packDir, "assets", "test");
    fs.mkdirSync(assetsDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(assetsDir, `file${i}.png`), Buffer.alloc(10, 0));
    }
    const result = mod.listRpAssets(packDir, 2);
    assert.equal(result.assets.length, 2);
    assert.equal(result.total, 5);
  });

  it("returns empty for pack without assets/", () => {
    const packDir = path.join(tmpDir, "no-assets-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), "{}");
    const result = mod.listRpAssets(packDir);
    assert.equal(result.total, 0);
    assert.equal(result.assets.length, 0);
  });
});

describe("compareRpacksExport", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-cmp-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("detects added and removed asset files", () => {
    const oldDir = path.join(tmpDir, "old");
    const newDir = path.join(tmpDir, "new");
    for (const d of [oldDir, newDir]) {
      fs.mkdirSync(path.join(d, "assets", "minecraft", "textures", "block"), { recursive: true });
    }
    fs.writeFileSync(path.join(oldDir, "assets", "minecraft", "textures", "block", "dirt.png"), Buffer.alloc(10, 0));
    fs.writeFileSync(path.join(newDir, "assets", "minecraft", "textures", "block", "dirt.png"), Buffer.alloc(10, 0));
    fs.writeFileSync(path.join(newDir, "assets", "minecraft", "textures", "block", "stone.png"), Buffer.alloc(10, 0));

    const result = mod.compareRpacksExport(oldDir, newDir);
    assert.ok(result.added.some((f) => f.includes("stone.png")));
    assert.equal(result.removed.length, 0);
    assert.equal(result.summary.addedCount, 1);
  });

  it("detects changed file content", () => {
    const oldDir = path.join(tmpDir, "old2");
    const newDir = path.join(tmpDir, "new2");
    for (const d of [oldDir, newDir]) {
      fs.mkdirSync(path.join(d, "assets", "test"), { recursive: true });
    }
    fs.writeFileSync(path.join(oldDir, "assets", "test", "file.png"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(newDir, "assets", "test", "file.png"), Buffer.from([4, 5, 6]));

    const result = mod.compareRpacksExport(oldDir, newDir);
    assert.ok(result.changed.some((f) => f.includes("file.png")));
    assert.equal(result.summary.changedCount, 1);
  });

  it("reports summary with format info", () => {
    const oldDir = path.join(tmpDir, "old3");
    const newDir = path.join(tmpDir, "new3");
    for (const d of [oldDir, newDir]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    }
    const result = mod.compareRpacksExport(oldDir, newDir);
    assert.equal(result.summary.oldFormat, 6);
    assert.equal(result.summary.newFormat, 6);
  });
});

describe("enrichWithVersionInfo (offline)", () => {
  it("handles nonexistent pack gracefully", async () => {
    const info = await mod.getRpInfo("nonexistent-rp-xyz-12345");
    assert.equal(info, null);
  });
});

describe("searchRpOnModrinth (offline)", () => {
  it("returns empty array when offline", async () => {
    const results = await mod.searchRpOnModrinth("nonexistent-query-xyz");
    assert.ok(Array.isArray(results));
    // Offline should return [] or throw gracefully
  });
});

describe("validateTexturesExport", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-tex-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("reports no issues for a clean pack", () => {
    const packDir = path.join(tmpDir, "clean-pack");
    const texDir = path.join(packDir, "assets", "minecraft", "textures", "block");
    fs.mkdirSync(texDir, { recursive: true });
    fs.writeFileSync(path.join(texDir, "dirt.png"), Buffer.alloc(100, 0));
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(5000, 0));

    const result = mod.validateTexturesExport(packDir);
    assert.equal(result.stats.totalTextures, 1);
    assert.equal(result.stats.largeTextures, 0);
    assert.equal(result.issues.length, 0);
    assert.ok(result.source.includes("clean-pack"));
  });

  it("flags oversized pack.png", () => {
    const packDir = path.join(tmpDir, "big-icon");
    fs.mkdirSync(path.join(packDir, "assets", "minecraft", "textures", "block"), { recursive: true });
    fs.writeFileSync(path.join(packDir, "assets", "minecraft", "textures", "block", "dirt.png"), Buffer.alloc(10, 0));
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    // 60KB icon
    fs.writeFileSync(path.join(packDir, "pack.png"), Buffer.alloc(60 * 1024, 0));

    const result = mod.validateTexturesExport(packDir);
    assert.ok(result.issues.some((i) => i.includes("pack.png")));
  });

  it("flags uppercase filename", () => {
    const packDir = path.join(tmpDir, "upper-case");
    const texDir = path.join(packDir, "assets", "minecraft", "textures", "block");
    fs.mkdirSync(texDir, { recursive: true });
    fs.writeFileSync(path.join(texDir, "Dirt.png"), Buffer.alloc(100, 0));
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), JSON.stringify({ format: 6 }));

    const result = mod.validateTexturesExport(packDir);
    assert.ok(result.issues.some((i) => i.includes("Dirt.png")));
  });
});

describe("analyzeLangFilesExport", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-lang-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("detects missing translations across languages", () => {
    const packDir = path.join(tmpDir, "i18n-pack");
    const langDir = path.join(packDir, "assets", "minecraft", "lang");
    fs.mkdirSync(langDir, { recursive: true });
    fs.writeFileSync(path.join(langDir, "en_us.lang"), "block.dirt=Dirt\nblock.stone=Stone\nitem.apple=Apple");
    fs.writeFileSync(path.join(langDir, "zh_cn.lang"), "block.dirt=泥土\nblock.stone=石头"); // missing item.apple

    const result = mod.analyzeLangFilesExport(packDir);
    assert.equal(result.languages["en_us"], 3);
    assert.equal(result.languages["zh_cn"], 2);
    assert.ok(result.missingKeys.length > 0);
    assert.ok(result.missingKeys.some((k) => k.key === "item.apple"));
  });

  it("handles pack without lang directory", () => {
    const packDir = path.join(tmpDir, "no-lang-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.mcmeta"), "{}");

    const result = mod.analyzeLangFilesExport(packDir);
    assert.equal(result.totalKeys, 0);
    assert.ok(result.issues.some((i) => i.includes("lang")));
  });
});

describe("compareRpacksDiffExport", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rp-diff-"));
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("includes file sizes in diff results", () => {
    const oldDir = path.join(tmpDir, "old-diff");
    const newDir = path.join(tmpDir, "new-diff");
    for (const d of [oldDir, newDir]) {
      fs.mkdirSync(path.join(d, "assets", "minecraft", "textures", "block"), { recursive: true });
      fs.writeFileSync(path.join(d, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    }
    fs.writeFileSync(path.join(oldDir, "assets", "minecraft", "textures", "block", "dirt.png"), Buffer.alloc(100, 0));
    fs.writeFileSync(path.join(newDir, "assets", "minecraft", "textures", "block", "dirt.png"), Buffer.alloc(200, 0));
    fs.writeFileSync(path.join(newDir, "assets", "minecraft", "textures", "block", "stone.png"), Buffer.alloc(150, 0));

    const result = mod.compareRpacksDiffExport(oldDir, newDir);
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].size, 150);
    assert.equal(result.changed.length, 1);
    assert.equal(result.changed[0].oldSize, 100);
    assert.equal(result.changed[0].newSize, 200);
    assert.ok(result.summary.totalAddedBytes > 0);
    assert.ok(result.summary.totalRemovedBytes === 0);
  });

  it("reports removed files with sizes", () => {
    const oldDir = path.join(tmpDir, "old-rm");
    const newDir = path.join(tmpDir, "new-rm");
    for (const d of [oldDir, newDir]) {
      fs.mkdirSync(path.join(d, "assets", "test"), { recursive: true });
      fs.writeFileSync(path.join(d, "pack.mcmeta"), JSON.stringify({ format: 6 }));
    }
    fs.writeFileSync(path.join(oldDir, "assets", "test", "old_file.png"), Buffer.alloc(80, 0));

    const result = mod.compareRpacksDiffExport(oldDir, newDir);
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].size, 80);
    assert.ok(result.oldSource.includes("old-rm"));
    assert.ok(result.newSource.includes("new-rm"));
  });
});
