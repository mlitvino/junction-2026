import "server-only";

import { existsSync, statSync } from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ResolveContext = { parentURL?: string; conditions?: string[] };
type NextResolve = (specifier: string, context: ResolveContext) => unknown;

// `registerHooks` exists at runtime (Node >= 22.15; we run 24) but @types/node 20 doesn't declare it.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): unknown;
  }): void;
};

function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target: string | null = null;
    if (specifier.startsWith("@/")) {
      target = path.join(process.cwd(), "src", specifier.slice(2));
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !context.parentURL.includes("/node_modules/")
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }

    if (target) {
      const candidates = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")];
      for (const cand of candidates) {
        if (isFile(cand)) {
          return nextResolve(pathToFileURL(cand).href, context);
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
