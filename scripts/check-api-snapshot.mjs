#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

const args = parseArgs(process.argv.slice(2));
const entry = args.entry ?? "dist/index.d.ts";
const snapshotPath = args.snapshot ?? "docs/api-snapshot.md";
const update = Boolean(args.update);

const entryPath = resolve(entry);
const snapshotFilePath = resolve(snapshotPath);
const modules = await collectDeclarationGraph(entryPath);
const snapshot = await renderSnapshot(modules, entryPath);

if (update) {
  await mkdir(dirname(snapshotFilePath), { recursive: true });
  await writeFile(snapshotFilePath, snapshot);
  console.log(`Wrote ${toPosix(relative(process.cwd(), snapshotFilePath))} from ${modules.length} declaration files.`);
} else {
  const expected = await readFileIfExists(snapshotFilePath);

  if (expected === null) {
    console.error(`Missing API snapshot: ${toPosix(relative(process.cwd(), snapshotFilePath))}`);
    console.error("Run `npm run api:snapshot` after reviewing the current public declarations.");
    process.exitCode = 1;
  } else if (expected !== snapshot) {
    const diff = findFirstDifference(expected, snapshot);
    console.error("Public API snapshot is out of date.");
    console.error(`First difference at line ${diff.line}:`);
    console.error(`snapshot: ${diff.expected}`);
    console.error(`current:  ${diff.actual}`);
    console.error("Run `npm run api:snapshot` only after confirming the API change is intentional.");
    process.exitCode = 1;
  } else {
    console.log(`Public API snapshot is current (${modules.length} declaration files).`);
  }
}

async function collectDeclarationGraph(entryFilePath) {
  if (!existsSync(entryFilePath)) {
    throw new Error(`Declaration entry does not exist: ${toPosix(relative(process.cwd(), entryFilePath))}`);
  }

  const seen = new Set();
  const pending = [entryFilePath];

  while (pending.length > 0) {
    const filePath = pending.pop();

    if (!filePath || seen.has(filePath)) {
      continue;
    }

    seen.add(filePath);
    const source = await readFile(filePath, "utf8");
    const nextPaths = declarationReferences(source, filePath);

    for (const nextPath of nextPaths) {
      if (!seen.has(nextPath)) {
        pending.push(nextPath);
      }
    }
  }

  return [...seen].sort((left, right) => {
    if (left === entryFilePath) {
      return -1;
    }

    if (right === entryFilePath) {
      return 1;
    }

    return toPosix(relative(process.cwd(), left)).localeCompare(toPosix(relative(process.cwd(), right)));
  });
}

function declarationReferences(source, fromFilePath) {
  const refs = new Set();
  const patterns = [
    /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];

      if (!specifier) {
        continue;
      }

      const resolved = resolveDeclarationSpecifier(fromFilePath, specifier);

      if (resolved) {
        refs.add(resolved);
      }
    }
  }

  return [...refs].sort();
}

function resolveDeclarationSpecifier(fromFilePath, specifier) {
  const extension = extname(specifier);
  const declarationSpecifier = extension === ".js" || extension === ".mjs" || extension === ".cjs"
    ? specifier.slice(0, -extension.length) + ".d.ts"
    : specifier.endsWith(".d.ts")
      ? specifier
      : `${specifier}.d.ts`;
  const resolved = resolve(dirname(fromFilePath), declarationSpecifier);

  if (!existsSync(resolved)) {
    throw new Error(`Declaration reference not found: ${specifier} from ${toPosix(relative(process.cwd(), fromFilePath))}`);
  }

  return resolved;
}

async function renderSnapshot(modulePaths, entryFilePath) {
  const moduleList = modulePaths.map((filePath) => `- \`${toPosix(relative(process.cwd(), filePath))}\``);
  const lines = [
    "# Public API Snapshot",
    "",
    "Generated from `dist/index.d.ts` and the declaration files it references.",
    "Run `npm run api:snapshot` after intentional public API changes.",
    "Run `npm run api:check` in CI before release.",
    "",
    `Entry: \`${toPosix(relative(process.cwd(), entryFilePath))}\``,
    "",
    "## Declaration Files",
    "",
    ...moduleList,
    "",
  ];

  for (const filePath of modulePaths) {
    const relativePath = toPosix(relative(process.cwd(), filePath));
    const source = normalizeDeclaration(await readFile(filePath, "utf8"));
    lines.push(`## \`${relativePath}\``, "", "```ts", source, "```", "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeDeclaration(source) {
  return source.replace(/\r\n?/g, "\n").trimEnd();
}

async function readFileIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function findFirstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        line: index + 1,
        expected: expectedLines[index] ?? "<missing>",
        actual: actualLines[index] ?? "<missing>",
      };
    }
  }

  return {
    line: 1,
    expected: "<no difference>",
    actual: "<no difference>",
  };
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const name = toCamel(value.slice(2));
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[name] = true;
    } else {
      parsed[name] = next;
      index += 1;
    }
  }

  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function toPosix(path) {
  return path.split(sep).join("/");
}
