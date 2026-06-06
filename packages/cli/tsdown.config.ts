import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts"],
	sourcemap: true,
	dts: true,
	minify: false,
	clean: true,
	format: ["esm"],
	outDir: "dist",
	// kiira is a runtime dependency, externalized automatically.
})
