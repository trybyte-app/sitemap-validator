import type { DiagnosticSeverity } from "./types.js";
export declare class CliUsageError extends Error {
    constructor(message: string);
}
export declare function splitFlag(rawValue: string): {
    flag: string;
    inlineValue: string | undefined;
};
export declare function rejectInlineValue(flag: string, inlineValue: string | undefined): void;
export declare function requireValue(argv: readonly string[], index: number, flag: string, inlineValue: string | undefined): {
    value: string;
    index: number;
};
export declare function requireNumber(argv: readonly string[], index: number, flag: string, inlineValue: string | undefined): {
    value: number;
    index: number;
};
export declare function requireChoice<const T extends readonly string[]>(argv: readonly string[], index: number, flag: string, choices: T, inlineValue: string | undefined): {
    value: T[number];
    index: number;
};
export declare function parseFailOn(value: string): readonly DiagnosticSeverity[];
export declare function uniqueList<T>(values: readonly T[]): T[];
export declare function isHttpUrl(value: string): boolean;
export declare function resolveLocalPath(target: string): string;
export declare function toErrorMessage(error: unknown): string;
export declare function isBrokenPipeError(error: unknown): boolean;
export declare function runCliMain(moduleUrl: string, run: () => Promise<number>): void;
