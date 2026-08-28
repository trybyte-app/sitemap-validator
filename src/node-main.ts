import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl: string, invokedPath = process.argv[1]): boolean {
  if (!invokedPath) {
    return false;
  }

  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
