// Copy TypeScript's standard `lib.*.d.ts` typings next to the bundled extension.
//
// The extension bundles `typescript`, which breaks its built-in default-lib
// resolution (it locates the lib files relative to its own executing file, which
// after bundling is the extension bundle, not the typescript package). We ship the
// lib files into `out/lib` and the extension points TypeScript at them via
// `setTypescriptLibDir` so globals like `JSON`, `Date`, and DOM types resolve.
import { cpSync, mkdirSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const libDir = dirname(require.resolve("typescript"))
const outDir = join(import.meta.dirname, "..", "out", "lib")

mkdirSync(outDir, { recursive: true })
let copied = 0
for (const file of readdirSync(libDir)) {
	if (/^lib\..*\.d\.ts$/.test(file)) {
		cpSync(join(libDir, file), join(outDir, file))
		copied += 1
	}
}
console.info(`copy-ts-lib: copied ${copied} lib.*.d.ts files to out/lib`)
