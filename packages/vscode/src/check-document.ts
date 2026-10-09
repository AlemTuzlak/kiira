import { type KiiraConfig, type KiiraDiagnostic, type VirtualFile, checkMarkdownText } from "kiira-core"

export interface CheckDocumentInput {
	/** Workspace root used for config, tsconfig, and module resolution. */
	cwd: string
	/** Document path relative to `cwd` (posix), used in diagnostics and naming. */
	markdownFile: string
	/** The (possibly unsaved) document text. */
	text: string
	config: Partial<KiiraConfig>
	markdownUri?: string
}

export interface CheckDocumentResult {
	diagnostics: KiiraDiagnostic[]
	virtualFiles: VirtualFile[]
	/** The text the check read, keyed by cwd-relative posix path. A quick fix applies only while a file still has this text. */
	sources: Record<string, string>
}

/**
 * Check a single in-memory Markdown document. Unlike `checkMarkdownFiles`, this
 * reads from the provided text rather than disk, so it reflects unsaved edits.
 * The result includes the same rule diagnostics (and their fixes) the CLI produces.
 */
export async function checkDocument(input: CheckDocumentInput): Promise<CheckDocumentResult> {
	const { diagnostics, virtualFiles, sources } = await checkMarkdownText(input)
	return { diagnostics, virtualFiles, sources }
}
