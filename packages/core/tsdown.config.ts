import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { defineConfig } from "tsdown"

const require = createRequire(import.meta.url)

// acorn ships separate ESM and CJS builds. The MDX parser imports the ESM one,
// but acorn-jsx (CJS) `require`s acorn as a fallback, which pulls the CJS build
// in too. Point every `acorn` import at the CJS build so it is bundled once.
// Not the ESM build: acorn-jsx still `require`s it, so it gets a lazy-init wrapper
// that makes `dist/plugin.cjs` load the shared runtime chunk.
const acornCjs = join(dirname(require.resolve("acorn")), "acorn.js")

export default defineConfig({
	entry: ["src/index.ts", "src/plugin.ts"],
	sourcemap: false,
	dts: true,
	minify: false,
	clean: true,
	alias: { acorn: acornCjs },
	format: ["esm", "cjs"],
	outDir: "dist",
	// The optional `peerDependencies` (typescript, jiti) are externalized automatically;
	// the ESM-only `devDependencies` (mdast-util-from-markdown, tinyglobby) are
	// bundled into the output so the CJS build works without `require(ESM)`.
})
