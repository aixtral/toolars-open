import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when this module is the process entry point rather than an import.
 *
 * A raw `import.meta.url === pathToFileURL(process.argv[1]).href` comparison is
 * wrong for the way packaged CLIs are actually invoked. Node resolves symlinks
 * when loading the main module, so `import.meta.url` is the real path while
 * `process.argv[1]` is whatever the caller typed. `node_modules/.bin/*`, `npx`
 * and a global install are all symlinks on POSIX, so the guard evaluated to
 * false and the CLI exited with status 0 and no output — indistinguishable from
 * success for any wrapper or CI step, which is the worst failure shape.
 *
 * Both forms are compared: the literal path, which is what
 * `--preserve-symlinks-main` leaves in `import.meta.url`, and its realpath.
 */
export function isMainEntry(moduleUrl: string): boolean {
  const entryPath = process.argv[1];

  if (typeof entryPath !== "string" || entryPath.length === 0) {
    return false;
  }

  if (moduleUrl === pathToFileURL(entryPath).href) {
    return true;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    // An unresolvable path cannot be this module.
    return false;
  }
}
