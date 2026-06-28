#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const cache = process.env.SITEMAP_VALIDATOR_NPM_CACHE ?? join(tmpdir(), "sitemap-validator-npm-cache");
await mkdir(cache, { recursive: true });

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(command, ["pack", "--dry-run", "--cache", cache], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_cache: cache,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
