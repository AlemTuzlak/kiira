import { parseArgs } from "./args"

describe("parseArgs", () => {
	it("defaults to the check command with the pretty reporter", () => {
		const parsed = parseArgs([])
		expect(parsed.command).toBe("check")
		expect(parsed.reporter).toBe("pretty")
		expect(parsed.files).toEqual([])
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
