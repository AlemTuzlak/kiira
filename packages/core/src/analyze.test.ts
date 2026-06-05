import { analyzeSnippet } from "./analyze"

describe("analyzeSnippet", () => {
	it("collects top-level declarations and free references", () => {
		const { declares, references } = analyzeSnippet(
			['import { x } from "m"', "const a = x + b", "function f(p) {", "  return p + c", "}"].join("\n"),
			"ts"
		)
		expect([...declares].sort()).toEqual(["a", "f", "x"])
		// `b` and `c` are free; `x`/`a` are declared, `p` is a bound parameter.
		expect(references.has("b")).toBe(true)
		expect(references.has("c")).toBe(true)
		expect(references.has("x")).toBe(false)
		expect(references.has("a")).toBe(false)
		expect(references.has("p")).toBe(false)
	})

	it("does not treat property names as references", () => {
		const { references } = analyzeSnippet("const r = obj.foo.bar", "ts")
		expect(references.has("obj")).toBe(true)
		expect(references.has("foo")).toBe(false)
		expect(references.has("bar")).toBe(false)
	})

	it("does not leak import-alias property names as references", () => {
		const { declares, references } = analyzeSnippet('import { foo as bar } from "m"', "ts")
		expect(declares.has("bar")).toBe(true)
		expect(references.has("foo")).toBe(false)
		expect(references.has("bar")).toBe(false)
	})

	it("does not leak renamed-destructure property names as references", () => {
		const { references } = analyzeSnippet("const { foo: bar } = src", "ts")
		expect(references.has("src")).toBe(true)
		expect(references.has("foo")).toBe(false)
		expect(references.has("bar")).toBe(false)
	})

	it("does not let an inner-scope binding shadow a genuine outer reference", () => {
		// `outer` is free at the top level; the inner function binds its own `outer`,
		// but that must not erase the top-level free reference.
		const { references } = analyzeSnippet(
			["const a = outer", "function f() {", "  const outer = 1", "  return outer", "}"].join("\n"),
			"ts"
		)
		expect(references.has("outer")).toBe(true)
	})
})
