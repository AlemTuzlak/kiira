#!/usr/bin/env node
import { parseArgs } from "./args"
import { runCheck } from "./commands/check"
import { runInit } from "./commands/init"
import { HELP_TEXT, VERSION } from "./help"

async function main(argv: string[]): Promise<number> {
	let parsed: ReturnType<typeof parseArgs>
	try {
		parsed = parseArgs(argv)
	} catch (error) {
		console.error((error as Error).message)
		return 2
	}

	switch (parsed.command) {
		case "help":
			console.log(HELP_TEXT)
			return 0
		case "version":
			console.log(VERSION)
			return 0
		case "init":
			return runInit({ cwd: process.cwd(), log: (m) => console.log(m) })
		default:
			return runCheck({
				cwd: process.cwd(),
				files: parsed.files,
				entry: parsed.entry,
				ignore: parsed.ignore,
				config: parsed.config,
				reporter: parsed.reporter,
				fix: parsed.fix,
				verbose: parsed.verbose,
				raw: parsed.raw,
				static: parsed.static,
				log: (m) => console.log(m),
				error: (m) => console.error(m),
			})
	}
}

main(process.argv.slice(2))
	.then((code) => {
		process.exitCode = code
	})
	.catch((error) => {
		// Configuration or runtime failure.
		console.error(`typedown: ${(error as Error).message}`)
		process.exitCode = 2
	})
