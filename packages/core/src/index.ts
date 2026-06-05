// @typedown/core public API.

export const TYPEDOWN_CORE_VERSION = "0.1.0"

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
	type CheckMarkdownFilesInput,
	type CheckVirtualFilesInput,
	checkMarkdownFiles,
	checkVirtualFiles,
	resolveTsconfigPath,
} from "./check"
export {
	buildWorkspaceResolution,
	discoverWorkspacePackages,
	parsePnpmWorkspacePackages,
	type WorkspacePackage,
	type WorkspaceResolution,
} from "./workspace"
