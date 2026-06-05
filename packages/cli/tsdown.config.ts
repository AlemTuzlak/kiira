import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts"],
	sourcemap: true,
	dts: true,
	minify: false,
	clean: true,
	format: ["esm"],
	outDir: "dist",
	// @typedown/core is a runtime dependency, externalized automatically.
})
