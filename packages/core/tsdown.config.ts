import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts"],
	sourcemap: true,
	dts: true,
	minify: false,
	clean: true,
	format: ["esm", "cjs"],
	outDir: "dist",
	// Runtime `dependencies` (typescript, jiti) are externalized automatically;
	// the ESM-only `devDependencies` (mdast-util-from-markdown, tinyglobby) are
	// bundled into the output so the CJS build works without `require(ESM)`.
})
