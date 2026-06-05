import { detectLanguageTag } from "./detect"

describe("detectLanguageTag", () => {
	it("suggests tsx for a ts fence containing JSX", () => {
		const code = 'export const C = () => <div className="x">{1}</div>'
		expect(detectLanguageTag(code, "ts")).toEqual({ suggested: "tsx" })
	})

	it("does not flag a js fence (JS parses and type-checks JSX fine)", () => {
		const code = "export const C = () => <div>{1}</div>"
		expect(detectLanguageTag(code, "js")).toBeUndefined()
	})

	it("does not flag plain TypeScript", () => {
		expect(detectLanguageTag("const x: number = 1", "ts")).toBeUndefined()
	})

	it("does not flag TS angle-bracket generics/assertions (valid as ts, invalid as tsx)", () => {
		// A generic arrow function parses cleanly as .ts but would error as .tsx.
		// Because it parses fine as ts, it must never be flagged.
		const code = "const identity = <T>(value: T): T => value"
		expect(detectLanguageTag(code, "ts")).toBeUndefined()
	})

	it("does not flag fences already tagged tsx", () => {
		expect(detectLanguageTag("const C = () => <div />", "tsx")).toBeUndefined()
	})

	it("does not flag genuinely broken TS that also fails as tsx", () => {
		// A real syntax error (not JSX) fails under both script kinds, so it is
		// reported as a normal error, not a wrong-tag suggestion.
		expect(detectLanguageTag("const x = = 1", "ts")).toBeUndefined()
	})
})
