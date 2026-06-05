/// <reference types="vitest" />
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		testTimeout: 30000,
		// The extension entry imports the `vscode` module, which only exists in the
		// extension host; exclude it from unit tests (its logic is glue).
		exclude: ["**/node_modules/**", "**/extension.ts"],
	},
})
