import { defineConfig } from "tsdown"

export default defineConfig({
	entry: { extension: "src/extension.ts" },
	sourcemap: true,
	dts: false,
	// Smaller download and faster load. The `.map` files above are only for local
	// debugging: `.vscodeignore` keeps them out of the `.vsix`. So keep function and
	// class names, or stack traces in user bug reports become unreadable.
	minify: {
		compress: { keepNames: { function: true, class: true } },
		mangle: { keepNames: true },
	},
	clean: true,
	format: ["cjs"],
	outDir: "out",
	deps: {
		// The VS Code host provides `vscode` at runtime. TypeScript is not bundled:
		// the extension loads the workspace's (or VS Code's own) TypeScript at
		// activation, see `src/typescript-host.ts`.
		neverBundle: ["vscode", "typescript"],
		// Everything else is bundled so the packaged `.vsix` is self-contained and can
		// be packaged with `--no-dependencies` (sidestepping the monorepo `workspace:*`
		// dependency that `vsce` can't resolve).
		alwaysBundle: ["kiira-core", "jiti", "mdast-util-from-markdown", "tinyglobby"],
	},
})
