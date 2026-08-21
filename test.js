#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");

const tests = [
  { name: "unit", cmd: "node", args: ["--test", "--test-force-exit", path.join(__dirname, "__tests__/unit.test.ts")] },
];

(async () => {
  for (const t of tests) {
    console.log(`\n=== Running: ${t.name} ===`);
    const proc = spawn(t.cmd, t.args, { stdio: "inherit" });
    await new Promise((resolve) => proc.on("close", resolve));
    if (proc.exitCode !== 0) {
      console.error(`FAILED: ${t.name} (exit code ${proc.exitCode})`);
      process.exit(1);
    }
  }
  console.log("\nAll tests passed.");
})();
