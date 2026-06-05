import {
	type TypedownConfig,
	type TypedownDiagnostic,
	type VirtualFile,
	checkVirtualFiles,
	createVirtualFiles,
	extractSnippetsFromContent,
	resolveConfig,
} from "@typedown/core"

export interface CheckDocumentInput {
	/** Workspace root used for config, tsconfig, and module resolution. */
	cwd: string
	/** Document path relative to `cwd` (posix), used in diagnostics and naming. */
	markdownFile: string
	/** The (possibly unsaved) document text. */
	text: string
	config: Partial<TypedownConfig>
	markdownUri?: string
}

export interface CheckDocumentResult {
	diagnostics: TypedownDiagnostic[]
	virtualFiles: VirtualFile[]
}

/**
 * Check a single in-memory Markdown document. Unlike `checkMarkdownFiles`, this
 * reads from the provided text rather than disk, so it reflects unsaved edits.
 */
export async function checkDocument(input: CheckDocumentInput): Promise<CheckDocumentResult> {
	const resolved = resolveConfig(input.config)
	const extraction = extractSnippetsFromContent({
		markdownFile: input.markdownFile,
		content: input.text,
		config: resolved,
		markdownUri: input.markdownUri,
	})

	const { virtualFiles, diagnostics: fixtureDiagnostics } = await createVirtualFiles({
		cwd: input.cwd,
		snippets: extraction.snippets,
		config: input.config,
	})

	const tsDiagnostics = await checkVirtualFiles({
		cwd: input.cwd,
		virtualFiles,
		config: input.config,
	})

	return {
		diagnostics: [...extraction.diagnostics, ...fixtureDiagnostics, ...tsDiagnostics],
		virtualFiles,
	}
}
