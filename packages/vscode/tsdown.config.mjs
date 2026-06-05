import { defineConfig } from "tsdown"

export default defineConfig({
	entry: { extension: "src/extension.ts" },
	sourcemap: true,
	dts: false,
	minify: false,
	clean: true,
	format: ["cjs"],
	outDir: "out",
	deps: {
		// The VS Code host provides `vscode` at runtime.
		neverBundle: ["vscode"],
		// Everything else is bundled so the packaged extension is self-contained.
		alwaysBundle: [/^@typedown\//, "typescript", "jiti", "mdast-util-from-markdown", "tinyglobby"],
	},
})
