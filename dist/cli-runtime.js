import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export class CliUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "CliUsageError";
    }
}
export function splitFlag(rawValue) {
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
export function rejectInlineValue(flag, inlineValue) {
    if (inlineValue !== undefined) {
        throw new CliUsageError(`${flag} does not accept a value.`);
    }
}
export function requireValue(argv, index, flag, inlineValue) {
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
export function requireNumber(argv, index, flag, inlineValue) {
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
export function requireChoice(argv, index, flag, choices, inlineValue) {
    const parsed = requireValue(argv, index, flag, inlineValue);
    if (!isChoice(parsed.value, choices)) {
        throw new CliUsageError(`${flag} must be one of: ${choices.join(", ")}.`);
    }
    return {
        value: parsed.value,
        index: parsed.index,
    };
}
function isChoice(value, choices) {
    return choices.includes(value);
}
export function parseFailOn(value) {
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
    const parsed = [];
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
export function uniqueList(values) {
    return [...new Set(values)];
}
export function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
export function resolveLocalPath(target) {
    try {
        const url = new URL(target);
        if (url.protocol === "file:") {
            return fileURLToPath(url);
        }
    }
    catch {
        return resolve(target);
    }
    return resolve(target);
}
export function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function isBrokenPipeError(error) {
    return error instanceof Error
        && "code" in error
        && error.code === "EPIPE";
}
export function runCliMain(moduleUrl, run) {
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
    }).catch((error) => {
        process.stderr.write(`${toErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}
function isMainModule(moduleUrl, invokedPath = process.argv[1]) {
    if (!invokedPath) {
        return false;
    }
    try {
        return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
    }
    catch {
        return false;
    }
}
