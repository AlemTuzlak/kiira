// @alemtuzlak/kiira-core public API.

export const KIIRA_CORE_VERSION = "0.1.0"

export * from "./types"
export {
	CONFIG_FILENAMES,
	DEFAULT_LANGUAGES,
	defineConfig,
	findConfigFile,
	loadConfig,
	loadConfigFile,
	resolveConfig,
} from "./config"
export { detectLanguageTag, type LanguageTagSuggestion } from "./detect"
export { discoverMarkdownFiles, type DiscoverInput } from "./discover"
export { type FenceMetaIssue, parseFenceMeta, type ParsedFenceMeta } from "./meta"
export {
	type ExtractContentInput,
	type ExtractInput,
	extractMarkdownSnippets,
	extractSnippetsFromContent,
	type SnippetExtraction,
} from "./extract"
export {
	type BuildVirtualInput,
	type BuiltVirtualFile,
	buildGroupedVirtualFile,
	buildVirtualFile,
	type CreateVirtualFilesInput,
	type CreateVirtualFilesResult,
	createVirtualFiles,
	dedent,
	effectiveValidate,
	isCheckable,
	mapVirtualLine,
	virtualFileName,
} from "./virtual"
export {
	buildBaseOptions,
	type CheckMarkdownFilesInput,
	type CheckVirtualFilesInput,
	checkMarkdownFiles,
	checkVirtualFiles,
	type CollectSuggestionsInput,
	collectSuggestions,
	optionsForFile,
	resolveTsconfigPath,
	setTypescriptLibDir,
} from "./check"
export {
	type CodeFixAction,
	type CodeFixEdit,
	getCodeFixes,
	type GetCodeFixesInput,
} from "./codefix"
export {
	buildWorkspaceResolution,
	discoverWorkspacePackages,
	parsePnpmWorkspacePackages,
	type WorkspacePackage,
	type WorkspaceResolution,
} from "./workspace"
