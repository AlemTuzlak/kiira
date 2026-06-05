import type { TypedownDiagnostic } from "@alemtuzlak/typedown"

/**
 * Filter the diagnostics that should be shown for a document. Generated
 * (fixture) diagnostics are hidden unless explicitly enabled.
 */
export function selectDiagnostics(
	diagnostics: TypedownDiagnostic[],
	options: { showGenerated: boolean }
): TypedownDiagnostic[] {
	if (options.showGenerated) {
		return diagnostics
	}
	return diagnostics.filter((d) => !d.generated)
}

/** Render a diagnostic code as a display string (e.g. `TS2305`). */
export function diagnosticCodeLabel(code: TypedownDiagnostic["code"]): string | undefined {
	if (typeof code === "number") {
		return `TS${code}`
	}
	return code ?? undefined
}
