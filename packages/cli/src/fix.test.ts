import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiiraDiagnostic } from "kiira-core"
import { afterEach, beforeEach, vi } from "vitest"
import { applyConfigOverrides, applyFixes } from "./fix"

// Lets a test act between the temp file write and the rename in the atomic writer.
const hooks = vi.hoisted(() => ({ beforeChmod: undefined as (() => void) | undefined }))
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>()
	return {
		...actual,
		chmod: (...args: Parameters<typeof actual.chmod>) => {
			hooks.beforeChmod?.()
			return actual.chmod(...args)
		},
	}
})

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kiira-fix-"))
})

afterEach(() => {
	hooks.beforeChmod = undefined
	rmSync(dir, { recursive: true, force: true })
})

const at = (line: number, character: number) => ({ line, character })

function diag(line: number, file = "doc.md"): KiiraDiagnostic {
	return {
		severity: "warning",
		code: "language-tag",
		source: "kiira",
		message: "wrong tag",
		markdownFile: file,
		markdownRange: { start: at(line, 0), end: at(line, 0) },
		fix: { kind: "fence-language", line, language: "tsx" },
	}
}

function editDiag(
	edits: Array<{ file?: string; from: [number, number]; to: [number, number]; newText: string }>,
	code = "docs/rule"
): KiiraDiagnostic {
	return {
		severity: "warning",
		code,
		source: "kiira",
		message: "edit",
		markdownFile: "doc.md",
		markdownRange: { start: at(0, 0), end: at(0, 0) },
		fix: {
			kind: "edits",
			edits: edits.map((e) => ({
				file: e.file ?? "doc.md",
				range: { start: at(...e.from), end: at(...e.to) },
				newText: e.newText,
			})),
		},
	}
}

/** Write `files` into the temp dir and return them as the sources a check would have read. */
function seed(files: Record<string, string>): Record<string, string> {
	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(dir, name), text)
	}
	return { ...files }
}

const read = (name: string) => readFileSync(join(dir, name), "utf8")

describe("applyFixes", () => {
	it("rewrites the language identifier on the opening fence line", async () => {
		const md = ["# Doc", "", "```ts", "export const C = () => <div />", "```", ""].join("\n")
		const sources = seed({ "doc.md": md })

		const summary = await applyFixes(dir, [diag(2)], sources)

		expect(summary).toMatchObject({ filesChanged: 1, editsApplied: 1, fenceEditsApplied: 1, refusals: [] })
		expect(read("doc.md").split("\n")[2]).toBe("```tsx")
	})

	it("rewrites a `typescript` tag and preserves trailing fence metadata", async () => {
		const md = ["```typescript fixture=react", "export const C = () => <div />", "```"].join("\n")
		const sources = seed({ "doc.md": md })

		await applyFixes(dir, [diag(0)], sources)

		expect(read("doc.md").split("\n")[0]).toBe("```tsx fixture=react")
	})

	it("appends a fence-meta token (group=) to the info string", async () => {
		const sources = seed({ "doc.md": ["```ts", "const a = 1", "```"].join("\n") })

		const summary = await applyFixes(
			dir,
			[
				{
					severity: "warning",
					code: "group",
					source: "kiira",
					message: "group it",
					markdownFile: "doc.md",
					markdownRange: { start: at(0, 0), end: at(0, 0) },
					fix: { kind: "fence-meta", line: 0, append: "group=auth" },
				},
			],
			sources
		)

		expect(summary).toMatchObject({ filesChanged: 1, editsApplied: 1, fenceEditsApplied: 1 })
		expect(read("doc.md").split("\n")[0]).toBe("```ts group=auth")
	})

	it("applies a language fix and a group fix on the same fence line", async () => {
		const sources = seed({ "doc.md": "```ts  \nconst a = <b />\n```\n" })
		const meta: KiiraDiagnostic = { ...diag(0), fix: { kind: "fence-meta", line: 0, append: "group=g" } }

		await applyFixes(dir, [diag(0), meta], sources)

		expect(read("doc.md")).toBe("```tsx group=g\nconst a = <b />\n```\n")
	})

	it("reports nothing changed when there are no fixes", async () => {
		const sources = seed({ "doc.md": "```ts\nconst a = 1\n```" })
		const summary = await applyFixes(
			dir,
			[
				{
					severity: "error",
					source: "typescript",
					message: "boom",
					markdownFile: "doc.md",
					markdownRange: { start: at(1, 0), end: at(1, 1) },
				},
			],
			sources
		)
		expect(summary).toMatchObject({ filesChanged: 0, editsApplied: 0, refusals: [] })
	})

	it("applies edits across files, writes atomically, and keeps the file mode", async () => {
		const sources = seed({ "doc.md": "one\ntwo\n", "other.txt": "abc" })
		chmodSync(join(dir, "doc.md"), 0o640)

		const summary = await applyFixes(
			dir,
			[
				editDiag([
					{ from: [1, 0], to: [1, 3], newText: "TWO" },
					{ file: "other.txt", from: [0, 1], to: [0, 2], newText: "-" },
				]),
			],
			sources
		)

		expect(summary).toMatchObject({ filesChanged: 2, editsApplied: 2, fenceEditsApplied: 0 })
		expect(read("doc.md")).toBe("one\nTWO\n")
		expect(read("other.txt")).toBe("a-c")
		// Windows only has a read-only bit, so there is no 0o640 to keep.
		if (process.platform !== "win32") {
			expect(statSync(join(dir, "doc.md")).mode & 0o777).toBe(0o640)
		}
		// No temp file is left behind.
		expect(readdirSync(dir).sort()).toEqual(["doc.md", "other.txt"])
	})

	it("drops a whole multi-file fix when one of its files changed, and still applies other fixes", async () => {
		const sources = seed({ "doc.md": "one\n", "other.md": "two\n" })
		writeFileSync(join(dir, "doc.md"), "one, edited\n")

		const summary = await applyFixes(
			dir,
			[
				editDiag(
					[
						{ from: [0, 0], to: [0, 3], newText: "1" },
						{ file: "other.md", from: [0, 0], to: [0, 3], newText: "2" },
					],
					"docs/a"
				),
				editDiag([{ file: "other.md", from: [0, 3], to: [0, 3], newText: "!" }], "docs/b"),
			],
			sources
		)

		expect(summary.refusals).toEqual([
			{ file: "doc.md", reason: "the file changed since the check read it" },
			{ file: "other.md", reason: "the fix from docs/a at doc.md:1:1 also edits doc.md, which was skipped" },
		])
		expect(summary).toMatchObject({ filesChanged: 1, editsApplied: 1 })
		expect(read("doc.md")).toBe("one, edited\n")
		expect(read("other.md")).toBe("two!\n")
	})

	it("matches an edit's file to the sources however the path is written", async () => {
		const sources = seed({ "notes.txt": "abc" })

		const summary = await applyFixes(
			dir,
			[editDiag([{ file: "./notes.txt", from: [0, 0], to: [0, 1], newText: "X" }])],
			sources
		)

		expect(summary.refusals).toEqual([])
		expect(read("notes.txt")).toBe("Xbc")
	})

	it.skipIf(process.getuid?.() === 0)("refuses a read-only file", async () => {
		const sources = seed({ "doc.md": "abc" })
		chmodSync(join(dir, "doc.md"), 0o444)

		const summary = await applyFixes(dir, [editDiag([{ from: [0, 0], to: [0, 1], newText: "X" }])], sources)

		expect(summary.refusals).toEqual([{ file: "doc.md", reason: "the file is not writable" }])
		expect(read("doc.md")).toBe("abc")
	})

	it("refuses a file that is not valid UTF-8", async () => {
		const bytes = Buffer.from([0x61, 0xff, 0x62])
		writeFileSync(join(dir, "doc.md"), bytes)

		const summary = await applyFixes(dir, [editDiag([{ from: [0, 0], to: [0, 1], newText: "X" }])], {
			"doc.md": bytes.toString("utf8"),
		})

		expect(summary.refusals).toEqual([{ file: "doc.md", reason: "the file is not valid UTF-8" }])
		expect(readFileSync(join(dir, "doc.md"))).toEqual(bytes)
	})

	it("does not overwrite a save made after the plan, just before the rename", async () => {
		const sources = seed({ "doc.md": "abc" })
		hooks.beforeChmod = () => writeFileSync(join(dir, "doc.md"), "saved in an editor")

		const summary = await applyFixes(dir, [editDiag([{ from: [0, 0], to: [0, 1], newText: "X" }])], sources)

		expect(summary.refusals).toEqual([
			{ file: "doc.md", reason: "could not write the file: the file changed since the check read it" },
		])
		expect(read("doc.md")).toBe("saved in an editor")
		expect(readdirSync(dir)).toEqual(["doc.md"])
	})

	it("refuses a file the check did not read", async () => {
		seed({ "doc.md": "one\n", "secret.md": "x\n" })

		const summary = await applyFixes(dir, [editDiag([{ file: "secret.md", from: [0, 0], to: [0, 1], newText: "y" }])], {
			"doc.md": "one\n",
		})

		expect(summary.refusals).toEqual([{ file: "secret.md", reason: "the check did not read this file" }])
		expect(read("secret.md")).toBe("x\n")
	})

	describe("unsafe paths", () => {
		it.each([
			["../outside.txt", "../outside.txt", "the path is outside the project"],
			["sub/../../outside.txt", "../outside.txt", "the path is outside the project"],
			[".git/config", ".git/config", "the path is inside .git or node_modules"],
			["node_modules/x.txt", "node_modules/x.txt", "the path is inside .git or node_modules"],
			["packages/node_modules/x.txt", "packages/node_modules/x.txt", "the path is inside .git or node_modules"],
		])("refuses %s", async (file, normalized, reason) => {
			const summary = await applyFixes(dir, [editDiag([{ file, from: [0, 0], to: [0, 1], newText: "y" }])], {
				[normalized]: "x",
			})
			expect(summary.refusals).toEqual([{ file: normalized, reason }])
			expect(summary.filesChanged).toBe(0)
		})

		it("refuses an absolute path, even one inside the project", async () => {
			seed({ "doc.md": "x" })
			const file = join(dir, "doc.md")
			const summary = await applyFixes(dir, [editDiag([{ file, from: [0, 0], to: [0, 1], newText: "y" }])], {
				[file]: "x",
			})
			expect(summary.refusals).toEqual([{ file, reason: "the path must be relative to the project" }])
			expect(read("doc.md")).toBe("x")
		})

		it("refuses a symlink that points outside the project", async () => {
			const outside = mkdtempSync(join(tmpdir(), "kiira-outside-"))
			try {
				writeFileSync(join(outside, "target.md"), "secret")
				mkdirSync(join(outside, "dir"))
				writeFileSync(join(outside, "dir", "inner.md"), "secret")
				symlinkSync(join(outside, "target.md"), join(dir, "link.md"))
				symlinkSync(join(outside, "dir"), join(dir, "linkdir"))

				for (const file of ["link.md", "linkdir/inner.md"]) {
					const summary = await applyFixes(dir, [editDiag([{ file, from: [0, 0], to: [0, 1], newText: "y" }])], {
						[file]: "secret",
					})
					expect(summary.refusals).toEqual([{ file, reason: "the path resolves outside the project (symlink)" }])
				}
				expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("secret")
				expect(readFileSync(join(outside, "dir", "inner.md"), "utf8")).toBe("secret")
			} finally {
				rmSync(outside, { recursive: true, force: true })
			}
		})

		it("refuses a symlink into .git", async () => {
			mkdirSync(join(dir, ".git"))
			writeFileSync(join(dir, ".git", "config"), "x")
			symlinkSync(join(dir, ".git", "config"), join(dir, "cfg"))
			const summary = await applyFixes(dir, [editDiag([{ file: "cfg", from: [0, 0], to: [0, 1], newText: "y" }])], {
				cfg: "x",
			})
			expect(summary.refusals).toEqual([
				{ file: "cfg", reason: "the path resolves into .git or node_modules (symlink)" },
			])
			expect(read(".git/config")).toBe("x")
		})

		it("writes through a symlink that stays inside the project, keeping the link", async () => {
			seed({ "real.md": "abc" })
			symlinkSync(join(dir, "real.md"), join(dir, "link.md"))
			const summary = await applyFixes(dir, [editDiag([{ file: "link.md", from: [0, 0], to: [0, 1], newText: "X" }])], {
				"link.md": "abc",
			})
			expect(summary.refusals).toEqual([])
			expect(read("real.md")).toBe("Xbc")
			expect(lstatSync(join(dir, "link.md")).isSymbolicLink()).toBe(true)
		})
	})

	it("keeps CRLF line endings, including in multi-line replacement text", async () => {
		const sources = seed({ "doc.md": "# T\r\n\r\n```ts\r\nconst a = 1\r\n```\r\n" })

		await applyFixes(
			dir,
			[editDiag([{ from: [3, 6], to: [3, 7], newText: "b = 2\nconst c = 3\r\nconst d = 4" }])],
			sources
		)

		expect(read("doc.md")).toBe("# T\r\n\r\n```ts\r\nconst b = 2\r\nconst c = 3\r\nconst d = 4 = 1\r\n```\r\n")
	})

	it("counts a CRLF line's characters without its carriage return", async () => {
		const sources = seed({ "doc.md": "ab\r\ncd\r\n" })
		// The end of line 0 is character 2, before the \r.
		await applyFixes(dir, [editDiag([{ from: [0, 2], to: [0, 2], newText: "!" }])], sources)
		expect(read("doc.md")).toBe("ab!\r\ncd\r\n")

		const rejected = await applyFixes(dir, [editDiag([{ from: [0, 4], to: [0, 4], newText: "?" }])], {
			"doc.md": "ab!\r\ncd\r\n",
		})
		expect(rejected.refusals[0].reason).toContain("outside the file")
	})

	it("refuses every edit in a file whose edits overlap, naming the fixes, and their edits elsewhere", async () => {
		const sources = seed({ "doc.md": "abcdef\n", "other.md": "xyz\n" })

		const summary = await applyFixes(
			dir,
			[
				editDiag([{ from: [0, 0], to: [0, 4], newText: "1" }], "docs/a"),
				editDiag(
					[
						{ from: [0, 3], to: [0, 5], newText: "2" },
						{ file: "other.md", from: [0, 0], to: [0, 1], newText: "X" },
					],
					"docs/b"
				),
			],
			sources
		)

		expect(summary.refusals).toEqual([
			{ file: "doc.md", reason: "overlapping edits from docs/a at doc.md:1:1 and docs/b at doc.md:1:1; none applied" },
			{ file: "other.md", reason: "the fix from docs/b at doc.md:1:1 also edits doc.md, which was skipped" },
		])
		expect(read("doc.md")).toBe("abcdef\n")
		expect(read("other.md")).toBe("xyz\n")
	})

	it("treats an insert inside a replaced range as an overlap, and touching edits as fine", async () => {
		const sources = seed({ "doc.md": "abcdef\n" })
		const inside = await applyFixes(
			dir,
			[editDiag([{ from: [0, 1], to: [0, 4], newText: "-" }]), editDiag([{ from: [0, 2], to: [0, 2], newText: "+" }])],
			sources
		)
		expect(inside.refusals).toHaveLength(1)

		await applyFixes(
			dir,
			[editDiag([{ from: [0, 1], to: [0, 3], newText: "-" }]), editDiag([{ from: [0, 3], to: [0, 5], newText: "+" }])],
			sources
		)
		expect(read("doc.md")).toBe("a-+f\n")
	})

	it("de-duplicates identical edits and keeps same-point inserts in report order", async () => {
		const sources = seed({ "doc.md": "abc\n" })

		const summary = await applyFixes(
			dir,
			[
				editDiag([{ from: [0, 1], to: [0, 2], newText: "B" }]),
				editDiag([{ from: [0, 1], to: [0, 2], newText: "B" }]),
				editDiag([{ from: [0, 3], to: [0, 3], newText: "1" }]),
				editDiag([{ from: [0, 3], to: [0, 3], newText: "2" }]),
			],
			sources
		)

		expect(summary).toMatchObject({ refusals: [], editsApplied: 3 })
		expect(read("doc.md")).toBe("aBc12\n")
	})

	it("changes nothing in a dry run", async () => {
		const sources = seed({ "doc.md": "abc\n" })

		const summary = await applyFixes(dir, [editDiag([{ from: [0, 0], to: [0, 1], newText: "X" }])], sources, {
			dryRun: true,
		})

		expect(summary.changes).toEqual([{ file: "doc.md", before: "abc\n", after: "Xbc\n" }])
		expect(read("doc.md")).toBe("abc\n")
	})
})

describe("applyConfigOverrides", () => {
	function overrideDiag(): KiiraDiagnostic {
		return {
			severity: "warning",
			code: "jsx-framework",
			source: "kiira",
			message: "solid",
			markdownFile: "docs/ai-solid.md",
			markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
			fix: { kind: "config-override", include: "**/*solid*", compilerOptions: { jsxImportSource: "solid-js" } },
		}
	}

	it("merges an override into a JSON config", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(configPath, JSON.stringify({ include: ["docs/**/*.md"] }, null, 2))

		const result = await applyConfigOverrides(configPath, [overrideDiag()])

		expect(result.applied).toEqual([{ include: ["**/*solid*"], jsxImportSource: "solid-js" }])
		const written = JSON.parse(readFileSync(configPath, "utf8"))
		expect(written.overrides).toEqual([{ include: ["**/*solid*"], jsxImportSource: "solid-js" }])
	})

	it("reports the override without writing it in a dry run", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(configPath, JSON.stringify({ include: ["docs/**/*.md"] }))

		const result = await applyConfigOverrides(configPath, [overrideDiag()], { dryRun: true })

		expect(result.applied).toHaveLength(1)
		expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ include: ["docs/**/*.md"] })
	})

	it("is idempotent — does not duplicate an existing override", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(
			configPath,
			JSON.stringify({
				include: ["docs/**/*.md"],
				overrides: [{ include: ["**/*solid*"], jsxImportSource: "solid-js" }],
			})
		)
		const result = await applyConfigOverrides(configPath, [overrideDiag()])
		expect(result.applied).toEqual([])
	})

	it("returns fixes as manual when the config is not JSON", async () => {
		const result = await applyConfigOverrides(join(dir, "kiira.config.ts"), [overrideDiag()])
		expect(result.applied).toEqual([])
		expect(result.manual).toHaveLength(1)
	})

	it("throws rather than clobbering a non-array overrides field", async () => {
		const configPath = join(dir, "kiira.config.json")
		writeFileSync(configPath, JSON.stringify({ include: ["docs/**/*.md"], overrides: {} }))
		await expect(applyConfigOverrides(configPath, [overrideDiag()])).rejects.toThrow(/overrides.*array/i)
	})
})
