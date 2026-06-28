#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const thresholds = {
  lines: 80,
  branches: 75,
  functions: 85,
};

const tempDirectory = await mkdtemp(join(tmpdir(), "sitemap-validator-coverage-"));
const lcovPath = join(tempDirectory, "coverage.lcov");
let exitCode = 0;

try {
  const testFiles = (await readdir("test"))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => join("test", file));

  exitCode = await runCoverage(testFiles, lcovPath);

  if (exitCode === 0) {
    const lcov = await readFile(lcovPath, "utf8");
    const metrics = parseLcovTotals(lcov);
    const failures = Object.entries(thresholds)
      .filter(([metric, threshold]) => metrics[metric].percent < threshold);

    if (failures.length > 0) {
      console.error("Coverage gate failed:");

      for (const [metric, threshold] of failures) {
        console.error(`- ${metric}: ${formatPercent(metrics[metric].percent)} < ${threshold}%`);
      }

      exitCode = 1;
    } else {
      console.log(
        `Coverage gate passed: lines ${formatPercent(metrics.lines.percent)}, ` +
          `branches ${formatPercent(metrics.branches.percent)}, ` +
          `functions ${formatPercent(metrics.functions.percent)}.`,
      );
    }
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

function runCoverage(testFiles, destination) {
  const child = spawn(process.execPath, [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=dist/**/*.js",
    "--test-coverage-exclude=dist/cli.js",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${destination}`,
    ...testFiles,
  ], {
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        console.error(`Coverage run stopped by signal ${signal}.`);
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

function parseLcovTotals(lcov) {
  const totals = {
    lines: { covered: 0, total: 0, percent: 100 },
    branches: { covered: 0, total: 0, percent: 100 },
    functions: { covered: 0, total: 0, percent: 100 },
  };

  for (const line of lcov.split("\n")) {
    const [key, rawValue] = line.split(":", 2);
    const value = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(value)) {
      continue;
    }

    switch (key) {
      case "LF":
        totals.lines.total += value;
        break;
      case "LH":
        totals.lines.covered += value;
        break;
      case "BRF":
        totals.branches.total += value;
        break;
      case "BRH":
        totals.branches.covered += value;
        break;
      case "FNF":
        totals.functions.total += value;
        break;
      case "FNH":
        totals.functions.covered += value;
        break;
    }
  }

  for (const metric of Object.values(totals)) {
    metric.percent = metric.total === 0 ? 100 : (metric.covered / metric.total) * 100;
  }

  return totals;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}
