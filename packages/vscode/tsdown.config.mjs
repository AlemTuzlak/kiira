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
		// Everything (incl. `typescript`) is bundled so the packaged `.vsix` is fully
		// self-contained and can be packaged with `--no-dependencies` (sidestepping the
		// monorepo `workspace:*` dependency that `vsce` can't resolve). Bundling
		// TypeScript breaks its default-lib resolution, so the build also copies its
		// `lib.*.d.ts` into `out/lib` and the extension points TypeScript there via
		// `setTypescriptLibDir` on activation.
		alwaysBundle: ["kiira-core", "typescript", "jiti", "mdast-util-from-markdown", "tinyglobby"],
	},
})
