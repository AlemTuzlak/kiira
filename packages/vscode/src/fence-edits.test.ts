import { fenceLanguageTokenRange } from "./fence-edits"

describe("fenceLanguageTokenRange", () => {
	it("spans the language identifier of a backtick fence", () => {
		expect(fenceLanguageTokenRange("```typescript")).toEqual({ start: 3, end: 13 })
		expect(fenceLanguageTokenRange("```ts")).toEqual({ start: 3, end: 5 })
	})

	it("keeps the rest of the info string out of the token", () => {
		// Only the language token is replaced; `group=x` after it is untouched.
		expect(fenceLanguageTokenRange("```ts group=demo")).toEqual({ start: 3, end: 5 })
	})

	it("handles indented and tilde fences", () => {
		expect(fenceLanguageTokenRange("  ```tsx")).toEqual({ start: 5, end: 8 })
		expect(fenceLanguageTokenRange("~~~ts")).toEqual({ start: 3, end: 5 })
	})

	it("returns a zero-width position for a fence with no language", () => {
		expect(fenceLanguageTokenRange("```")).toEqual({ start: 3, end: 3 })
	})

	it("returns undefined for a non-fence line", () => {
		expect(fenceLanguageTokenRange("const x = 1")).toBeUndefined()
	})
})
