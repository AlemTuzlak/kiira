export type ReporterName = "pretty" | "json" | "github"

type Command = "check" | "init" | "help" | "version"

interface ParsedArgs {
	command: Command
	files: string[]
	config?: string
	reporter: ReporterName
	fix: boolean
}

const REPORTERS: ReporterName[] = ["pretty", "json", "github"]
const COMMANDS = new Set(["check", "init"])

function isReporter(value: string): value is ReporterName {
	return (REPORTERS as string[]).includes(value)
}

/** Parse `process.argv.slice(2)` into a structured command invocation. */
export function parseArgs(argv: string[]): ParsedArgs {
	let command: Command | undefined
	let config: string | undefined
	let reporter: ReporterName = "pretty"
	let fix = false
	const files: string[] = []

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] ?? ""

		if (arg === "--help" || arg === "-h") {
			return { command: "help", files, reporter, fix }
		}
		if (arg === "--version" || arg === "-v") {
			return { command: "version", files, reporter, fix }
		}

		if (arg === "--fix") {
			fix = true
			continue
		}
		if (arg === "--config" || arg.startsWith("--config=")) {
			config = arg.includes("=") ? arg.slice("--config=".length) : argv[++i]
			continue
		}
		if (arg === "--reporter" || arg.startsWith("--reporter=")) {
			const value = arg.includes("=") ? arg.slice("--reporter=".length) : (argv[++i] ?? "")
			if (!isReporter(value)) {
				throw new Error(`Unknown reporter "${value}". Expected one of: ${REPORTERS.join(", ")}.`)
			}
			reporter = value
			continue
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option "${arg}".`)
		}

		// First non-flag token may be a command; subsequent ones are files.
		if (command === undefined && COMMANDS.has(arg)) {
			command = arg as Command
		} else {
			files.push(arg)
		}
	}

	return { command: command ?? "check", files, config, reporter, fix }
}
