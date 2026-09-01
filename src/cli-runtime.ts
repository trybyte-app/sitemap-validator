import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagnosticSeverity } from "./types.js";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function splitFlag(rawValue: string): { flag: string; inlineValue: string | undefined } {
  const equalsIndex = rawValue.indexOf("=");

  if (equalsIndex < 0) {
    return {
      flag: rawValue,
      inlineValue: undefined,
    };
  }

  return {
    flag: rawValue.slice(0, equalsIndex),
    inlineValue: rawValue.slice(equalsIndex + 1),
  };
}

export function rejectInlineValue(flag: string, inlineValue: string | undefined): void {
  if (inlineValue !== undefined) {
    throw new CliUsageError(`${flag} does not accept a value.`);
  }
}

export function requireValue(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): { value: string; index: number } {
  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) {
      throw new CliUsageError(`${flag} requires a value.`);
    }

    return {
      value: inlineValue,
      index,
    };
  }

  const next = argv[index + 1];

  if (!next || next.startsWith("--")) {
    throw new CliUsageError(`${flag} requires a value.`);
  }

  return {
    value: next,
    index: index + 1,
  };
}

export function requireNumber(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): { value: number; index: number } {
  const parsed = requireValue(argv, index, flag, inlineValue);
  const value = Number(parsed.value);

  if (!Number.isFinite(value) || value < 0) {
    throw new CliUsageError(`${flag} requires a non-negative number.`);
  }

  return {
    value: Math.floor(value),
    index: parsed.index,
  };
}

export function requireChoice<const T extends readonly string[]>(
  argv: readonly string[],
  index: number,
  flag: string,
  choices: T,
  inlineValue: string | undefined,
): { value: T[number]; index: number } {
  const parsed = requireValue(argv, index, flag, inlineValue);

  if (!isChoice(parsed.value, choices)) {
    throw new CliUsageError(`${flag} must be one of: ${choices.join(", ")}.`);
  }

  return {
    value: parsed.value,
    index: parsed.index,
  };
}

function isChoice<const T extends readonly string[]>(value: string, choices: T): value is T[number] {
  return choices.includes(value);
}

export function parseFailOn(value: string): readonly DiagnosticSeverity[] {
  const normalized = value.trim().toLowerCase();

  if (normalized === "none") {
    return [];
  }

  if (normalized === "errors") {
    return ["error"];
  }

  if (normalized === "warnings") {
    return ["error", "warning"];
  }

  const severities = normalized.split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const parsed: DiagnosticSeverity[] = [];

  for (const severity of severities) {
    if (severity !== "error" && severity !== "warning" && severity !== "info") {
      throw new CliUsageError("--fail-on must be none or a comma-separated list of: error, warning, info.");
    }

    if (!parsed.includes(severity)) {
      parsed.push(severity);
    }
  }

  if (parsed.length === 0) {
    throw new CliUsageError("--fail-on requires at least one severity or none.");
  }

  return parsed;
}

export function uniqueList<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveLocalPath(target: string): string {
  try {
    const url = new URL(target);

    if (url.protocol === "file:") {
      return fileURLToPath(url);
    }
  } catch {
    return resolve(target);
  }

  return resolve(target);
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isBrokenPipeError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { code?: unknown }).code === "EPIPE";
}

export function runCliMain(moduleUrl: string, run: () => Promise<number>): void {
  if (!isMainModule(moduleUrl)) {
    return;
  }

  let stdoutPipeClosed = false;
  process.stdout.on("error", (error) => {
    if (isBrokenPipeError(error)) {
      stdoutPipeClosed = true;
      process.exitCode = 0;
      return;
    }

    throw error;
  });

  void run().then((exitCode) => {
    process.exitCode = stdoutPipeClosed ? 0 : exitCode;
  }).catch((error: unknown) => {
    process.stderr.write(`${toErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

function isMainModule(moduleUrl: string, invokedPath = process.argv[1]): boolean {
  if (!invokedPath) {
    return false;
  }

  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
