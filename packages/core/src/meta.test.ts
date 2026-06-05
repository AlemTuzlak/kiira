import { parseFenceMeta } from "./meta"

describe("parseFenceMeta", () => {
	it("returns an empty meta for an empty info string", () => {
		const result = parseFenceMeta("")
		expect(result.meta).toEqual({})
		expect(result.issues).toEqual([])
		expect(result.unknown).toEqual({})
	})

	it("returns an empty meta for null/undefined", () => {
		expect(parseFenceMeta(null).meta).toEqual({})
		expect(parseFenceMeta(undefined).meta).toEqual({})
	})

	it("treats a bare word as a boolean flag", () => {
		const result = parseFenceMeta("ignore")
		expect(result.meta.ignore).toBe(true)
	})

	it("parses key=value pairs", () => {
		const result = parseFenceMeta("fixture=react validate=type name=basic-chat")
		expect(result.meta).toEqual({
			fixture: "react",
			validate: "type",
			name: "basic-chat",
		})
		expect(result.issues).toEqual([])
	})

	it("parses package=workspace and package=packed", () => {
		expect(parseFenceMeta("package=workspace").meta.package).toBe("workspace")
		expect(parseFenceMeta("package=packed").meta.package).toBe("packed")
	})

	it("reports an issue for an invalid validate value and leaves it unset", () => {
		const result = parseFenceMeta("validate=sometimes")
		expect(result.meta.validate).toBeUndefined()
		expect(result.issues).toHaveLength(1)
		expect(result.issues[0]?.message).toContain("validate")
	})

	it("reports an issue for an invalid package value and leaves it unset", () => {
		const result = parseFenceMeta("package=nope")
		expect(result.meta.package).toBeUndefined()
		expect(result.issues).toHaveLength(1)
		expect(result.issues[0]?.message).toContain("package")
	})

	it("preserves unknown metadata without failing", () => {
		const result = parseFenceMeta("twoslash highlight=3")
		expect(result.unknown).toEqual({ twoslash: true, highlight: "3" })
		expect(result.issues).toEqual([])
		expect(result.meta).toEqual({})
	})

	it("supports quoted values containing spaces", () => {
		const result = parseFenceMeta('name="basic chat example"')
		expect(result.meta.name).toBe("basic chat example")
	})

	it("parses group=<id>", () => {
		expect(parseFenceMeta("group=auth").meta.group).toBe("auth")
	})

	it("combines flags and pairs in one info string", () => {
		const result = parseFenceMeta("ignore fixture=node validate=none")
		expect(result.meta).toEqual({ ignore: true, fixture: "node", validate: "none" })
	})
})
