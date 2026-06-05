import { defineConfig } from "tsdown"

export default defineConfig({
	entry: { extension: "src/extension.ts" },
	sourcemap: true,
	dts: false,
	minify: false,
	clean: true,
	format: ["cjs"],
	outDir: "out",
	// The VS Code host provides the `vscode` module at runtime; everything
	// else (including @typedown/core) is bundled so the extension is portable.
	external: ["vscode"],
	noExternal: [/^@typedown\//, "typescript", "jiti", "mdast-util-from-markdown", "tinyglobby"],
})
