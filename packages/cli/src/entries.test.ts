import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "vitest"
import { toIgnoreGlobs, toIncludeGlobs } from "./entries"

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kiira-entries-"))
	mkdirSync(join(dir, "docs", "api"), { recursive: true })
	writeFileSync(join(dir, "README.md"), "# readme")
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

describe("toIncludeGlobs", () => {
	it("expands a directory to a recursive markdown glob", () => {
		expect(toIncludeGlobs(dir, ["docs"])).toEqual(["docs/**/*.md"])
	})

	it("passes a glob through unchanged", () => {
		expect(toIncludeGlobs(dir, ["docs/**/*.mdx"])).toEqual(["docs/**/*.mdx"])
	})

	it("passes a file path through unchanged and normalizes separators", () => {
		expect(toIncludeGlobs(dir, ["README.md"])).toEqual(["README.md"])
		expect(toIncludeGlobs(dir, ["docs\\guide.md"])).toEqual(["docs/guide.md"])
	})
})

describe("toIgnoreGlobs", () => {
	it("expands a directory to a subtree glob", () => {
		expect(toIgnoreGlobs(dir, ["docs/api"])).toEqual(["docs/api/**"])
	})

	it("treats a non-existent dotless path as a directory subtree", () => {
		expect(toIgnoreGlobs(dir, ["generated"])).toEqual(["generated/**"])
	})

	it("keeps a file path and a glob as-is", () => {
		expect(toIgnoreGlobs(dir, ["CHANGELOG.md"])).toEqual(["CHANGELOG.md"])
		expect(toIgnoreGlobs(dir, ["**/*.generated.md"])).toEqual(["**/*.generated.md"])
	})
})
