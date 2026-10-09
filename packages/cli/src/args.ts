import type { RuleSeverity } from "kiira-core"

export type ReporterName = "pretty" | "json" | "github"

type Command = "check" | "init" | "help" | "version"

interface ParsedArgs {
	command: Command
	files: string[]
	config?: string
	reporter: ReporterName
	fix: boolean
	verbose: boolean
	raw: boolean
	/** `--entry` values: directories/files/globs to check (repeatable). */
	entry: string[]
	/** `--ignore` values: directories/files/globs to exclude (repeatable). */
	ignore: string[]
	/** `--static`: disable the loading spinner. */
	static: boolean
	/** `--rule <id>=<level>` values (repeatable); a repeated id keeps its last level. */
	rules: Record<string, RuleSeverity>
}

const REPORTERS: ReporterName[] = ["pretty", "json", "github"]
const COMMANDS = new Set(["check", "init"])

const RULE_LEVELS: RuleSeverity[] = ["off", "warn", "error"]

/** Parse one `--rule` value (`<id>=<off|warn|error>`). Unknown ids are rejected later, by the config. */
function parseRule(value: string): [id: string, level: RuleSeverity] {
	const eq = value.indexOf("=")
	const id = value.slice(0, eq)
	const level = value.slice(eq + 1)
	if (eq <= 0 || !(RULE_LEVELS as string[]).includes(level)) {
		throw new Error(`Invalid --rule "${value}". Expected <id>=<${RULE_LEVELS.join("|")}>.`)
	}
	return [id, level as RuleSeverity]
}

function isReporter(value: string): value is ReporterName {
	return (REPORTERS as string[]).includes(value)
}

/** Parse `process.argv.slice(2)` into a structured command invocation. */
export function parseArgs(argv: string[]): ParsedArgs {
	let command: Command | undefined
	let config: string | undefined
	let reporter: ReporterName = "pretty"
	let fix = false
	let verbose = false
	let raw = false
	let staticOutput = false
	const files: string[] = []
	const entry: string[] = []
	const ignore: string[] = []
	const rules: Record<string, RuleSeverity> = {}

	const base = (): Omit<ParsedArgs, "command"> => ({
		files,
		config,
		reporter,
		fix,
		verbose,
		raw,
		entry,
		ignore,
		static: staticOutput,
		rules,
	})

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] ?? ""

		if (arg === "--help" || arg === "-h") {
			return { command: "help", ...base() }
		}
		if (arg === "--version" || arg === "-v") {
			return { command: "version", ...base() }
		}

		if (arg === "--entry" || arg.startsWith("--entry=")) {
			const value = arg.includes("=") ? arg.slice("--entry=".length) : (argv[++i] ?? "")
			if (value) {
				entry.push(value)
			}
			continue
		}
		if (arg === "--ignore" || arg.startsWith("--ignore=")) {
			const value = arg.includes("=") ? arg.slice("--ignore=".length) : (argv[++i] ?? "")
			if (value) {
				ignore.push(value)
			}
			continue
		}

		if (arg === "--rule" || arg.startsWith("--rule=")) {
			const [id, level] = parseRule(arg.includes("=") ? arg.slice("--rule=".length) : (argv[++i] ?? ""))
			rules[id] = level
			continue
		}

		if (arg === "--fix") {
			fix = true
			continue
		}
		if (arg === "--verbose") {
			verbose = true
			continue
		}
		if (arg === "--raw") {
			raw = true
			continue
		}
		if (arg === "--static") {
			staticOutput = true
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

	return { command: command ?? "check", ...base() }
}
