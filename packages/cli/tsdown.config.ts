import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts", "src/plugin.ts"],
	sourcemap: false,
	dts: true,
	minify: false,
	clean: true,
	format: ["esm"],
	outDir: "dist",
	// kiira is a runtime dependency, externalized automatically.
})
