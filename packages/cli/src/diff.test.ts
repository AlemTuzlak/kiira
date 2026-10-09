import { unifiedDiff } from "./diff"

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`)

describe("unifiedDiff", () => {
	it("is empty when nothing changed", () => {
		expect(unifiedDiff("a.md", "x\n", "x\n")).toBe("")
	})

	it("prints one hunk with three lines of context", () => {
		const before = `${lines(10).join("\n")}\n`
		const after = before.replace("line 5\n", "five\n")
		expect(unifiedDiff("docs/a.md", before, after)).toBe(
			[
				"--- a/docs/a.md",
				"+++ b/docs/a.md",
				"@@ -2,7 +2,7 @@",
				" line 2",
				" line 3",
				" line 4",
				"-line 5",
				"+five",
				" line 6",
				" line 7",
				" line 8",
				"",
			].join("\n")
		)
	})

	it("splits distant changes into separate hunks and merges near ones", () => {
		const before = `${lines(20).join("\n")}\n`
		const apart = before.replace("line 2\n", "two\n").replace("line 19\n", "nineteen\n")
		const hunks = unifiedDiff("a.md", before, apart)
			.split("\n")
			.filter((l) => l.startsWith("@@"))
		expect(hunks).toEqual(["@@ -1,5 +1,5 @@", "@@ -16,5 +16,5 @@"])

		const near = before.replace("line 2\n", "two\n").replace("line 8\n", "eight\n")
		const merged = unifiedDiff("a.md", before, near)
			.split("\n")
			.filter((l) => l.startsWith("@@"))
		expect(merged).toEqual(["@@ -1,11 +1,11 @@"])
	})

	it("writes an insertion at the top and a deletion with an empty side", () => {
		expect(unifiedDiff("a.md", "b\n", "a\nb\n")).toBe(
			["--- a/a.md", "+++ b/a.md", "@@ -1,1 +1,2 @@", "+a", " b", ""].join("\n")
		)
		expect(unifiedDiff("a.md", "a\n", "")).toBe(["--- a/a.md", "+++ b/a.md", "@@ -1,1 +0,0 @@", "-a", ""].join("\n"))
		expect(unifiedDiff("a.md", "", "a\n")).toBe(["--- a/a.md", "+++ b/a.md", "@@ -0,0 +1,1 @@", "+a", ""].join("\n"))
	})

	it("marks a missing final newline", () => {
		expect(unifiedDiff("a.md", "a\nb", "a\nB")).toBe(
			[
				"--- a/a.md",
				"+++ b/a.md",
				"@@ -1,2 +1,2 @@",
				" a",
				"-b",
				"\\ No newline at end of file",
				"+B",
				"\\ No newline at end of file",
				"",
			].join("\n")
		)
	})
})
