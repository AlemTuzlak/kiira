import type { TypedownDiagnostic } from "@alemtuzlak/typedown"
import { diagnosticCodeLabel, selectDiagnostics } from "./diagnostics"

function diag(overrides: Partial<TypedownDiagnostic> = {}): TypedownDiagnostic {
	return {
		severity: "error",
		source: "typescript",
		message: "boom",
		markdownFile: "a.md",
		markdownRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
		...overrides,
	}
}

describe("selectDiagnostics", () => {
	it("hides generated diagnostics by default", () => {
		const diagnostics = [diag(), diag({ generated: true })]
		expect(selectDiagnostics(diagnostics, { showGenerated: false })).toHaveLength(1)
	})

	it("keeps generated diagnostics when enabled", () => {
		const diagnostics = [diag(), diag({ generated: true })]
		expect(selectDiagnostics(diagnostics, { showGenerated: true })).toHaveLength(2)
	})
})

describe("diagnosticCodeLabel", () => {
	it("prefixes numeric TS codes", () => {
		expect(diagnosticCodeLabel(2305)).toBe("TS2305")
	})

	it("passes string codes through and handles undefined", () => {
		expect(diagnosticCodeLabel("custom")).toBe("custom")
		expect(diagnosticCodeLabel(undefined)).toBeUndefined()
	})
})
