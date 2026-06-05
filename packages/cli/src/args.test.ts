import { parseArgs } from "./args"

describe("parseArgs", () => {
	it("defaults to the check command with the pretty reporter and no fix", () => {
		const parsed = parseArgs([])
		expect(parsed.command).toBe("check")
		expect(parsed.reporter).toBe("pretty")
		expect(parsed.files).toEqual([])
		expect(parsed.fix).toBe(false)
	})

	it("parses the --fix flag", () => {
		expect(parseArgs(["check", "--fix"]).fix).toBe(true)
		expect(parseArgs(["--fix"]).fix).toBe(true)
	})

	it("parses the --verbose, --raw, and --static flags", () => {
		expect(parseArgs(["check", "--verbose"]).verbose).toBe(true)
		expect(parseArgs(["check", "--raw"]).raw).toBe(true)
		expect(parseArgs(["check", "--static"]).static).toBe(true)
		expect(parseArgs([]).raw).toBe(false)
		expect(parseArgs([]).static).toBe(false)
	})

	it("collects repeatable --entry and --ignore values", () => {
		const parsed = parseArgs(["check", "--entry", "docs", "--entry=README.md", "--ignore", "docs/api"])
		expect(parsed.entry).toEqual(["docs", "README.md"])
		expect(parsed.ignore).toEqual(["docs/api"])
	})

	it("parses an explicit command and positional file args", () => {
		const parsed = parseArgs(["check", "docs/a.md", "README.md"])
		expect(parsed.command).toBe("check")
		expect(parsed.files).toEqual(["docs/a.md", "README.md"])
	})

	it("treats leading files (no command) as a check with files", () => {
		const parsed = parseArgs(["docs/a.md"])
		expect(parsed.command).toBe("check")
		expect(parsed.files).toEqual(["docs/a.md"])
	})

	it("parses --config and --reporter with space or equals", () => {
		expect(parseArgs(["check", "--config", "typedown.config.ts"]).config).toBe("typedown.config.ts")
		expect(parseArgs(["check", "--config=custom.json"]).config).toBe("custom.json")
		expect(parseArgs(["check", "--reporter", "json"]).reporter).toBe("json")
		expect(parseArgs(["check", "--reporter=github"]).reporter).toBe("github")
	})

	it("recognizes help and version flags", () => {
		expect(parseArgs(["--help"]).command).toBe("help")
		expect(parseArgs(["-h"]).command).toBe("help")
		expect(parseArgs(["--version"]).command).toBe("version")
		expect(parseArgs(["-v"]).command).toBe("version")
	})

	it("parses the init command", () => {
		expect(parseArgs(["init"]).command).toBe("init")
	})

	it("throws on an unknown reporter", () => {
		expect(() => parseArgs(["check", "--reporter", "nope"])).toThrow(/reporter/i)
	})
})
