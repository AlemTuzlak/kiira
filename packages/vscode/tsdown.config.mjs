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
		// `vscode` is provided by the host. `typescript` must stay external (a real
		// on-disk module): it locates its bundled `lib.*.d.ts` via the path of its own
		// executing file, so inlining it into the bundle breaks default-lib resolution
		// and every global (`JSON`, `Date`, DOM types, …) is reported as undefined.
		neverBundle: ["vscode", "typescript"],
		// Everything else is bundled so the packaged extension is self-contained.
		alwaysBundle: [/^@typedown\//, "jiti", "mdast-util-from-markdown", "tinyglobby"],
	},
})
