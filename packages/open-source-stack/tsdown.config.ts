import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts"],
	sourcemap: true,
	dts: true,
	minify: false,
	clean: false,
	format: ["esm", "cjs"],
	outDir: "dist",
})
