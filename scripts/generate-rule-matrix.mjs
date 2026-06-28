#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { listRuleDefinitions } from "../dist/index.js";

const out = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "docs/rule-matrix.md";

if (!out) {
  throw new Error("--out requires a file path.");
}

const rules = listRuleDefinitions().sort((left, right) => left.code.localeCompare(right.code));
const lines = [
  "# Rule Matrix",
  "",
  "Generated from `RULE_DEFINITIONS`. Run `npm run docs:rules` after changing rule codes, severities, sources, or spec links.",
  "",
  `Total rules: ${rules.length}`,
  "",
  "| Code | Severity | Source | Spec |",
  "| --- | --- | --- | --- |",
  ...rules.map((rule) => [
    `\`${rule.code}\``,
    rule.defaultSeverity,
    rule.source,
    rule.spec ? `[source](${rule.spec})` : "",
  ].join(" | ")).map((row) => `| ${row} |`),
  "",
];

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${lines.join("\n")}\n`);
console.log(`Wrote ${out} with ${rules.length} rules.`);
