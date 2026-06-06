import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const CONFIG_TEMPLATE = `import { defineConfig } from "@alemtuzlak/kiira-core"

export default defineConfig({
\tinclude: ["docs/**/*.md", "README.md"],
\ttsconfig: "tsconfig.docs.json",
\tdefaultValidate: "type",
\tlanguages: ["ts", "tsx", "js", "jsx"],
\tfixtures: {
\t\tnode: { type: "prepend", content: "export {}" },
\t\treact: { type: "prepend", content: 'import * as React from "react"' },
\t},
})
`

const TSCONFIG_TEMPLATE = `${JSON.stringify(
	{
		extends: "./tsconfig.json",
		compilerOptions: {
			target: "ES2022",
			module: "ESNext",
			moduleResolution: "Bundler",
			jsx: "react-jsx",
			strict: true,
			noEmit: true,
			allowJs: true,
			checkJs: true,
			skipLibCheck: true,
			types: ["node"],
		},
	},
	null,
	2
)}\n`

interface RunInitOptions {
	cwd: string
	log: (message: string) => void
}

async function writeIfMissing(path: string, content: string, name: string, log: (m: string) => void): Promise<void> {
	if (existsSync(path)) {
		log(`• ${name} already exists, skipping.`)
		return
	}
	await writeFile(path, content, "utf8")
	log(`✓ Created ${name}.`)
}

/** Scaffold a Kiira config and a docs tsconfig. Existing files are left untouched. */
export async function runInit(options: RunInitOptions): Promise<number> {
	await writeIfMissing(join(options.cwd, "kiira.config.ts"), CONFIG_TEMPLATE, "kiira.config.ts", options.log)
	await writeIfMissing(join(options.cwd, "tsconfig.docs.json"), TSCONFIG_TEMPLATE, "tsconfig.docs.json", options.log)
	options.log("\nDone. Run `kiira check` to validate your Markdown.")
	return 0
}
