// kiira-core public API.

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
	loadMdxSupport,
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
	check,
	type CheckInput,
	type CheckMarkdownFilesInput,
	type CheckMarkdownTextInput,
	type CheckMarkdownTextResult,
	type CheckVirtualFilesInput,
	checkMarkdownFiles,
	checkMarkdownText,
	checkVirtualFiles,
	type CollectSuggestionsInput,
	collectSuggestions,
	optionsForFile,
	resolveTsconfigPath,
	resetClassicEngineCache,
	setTypescriptLibDir,
	setTypescriptModule,
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
	resetWorkspaceCache,
	type WorkspacePackage,
	type WorkspaceResolution,
} from "./workspace"
export {
	collectExternalPackages,
	detectPackageManager,
	type EnsureExternalOptions,
	ensureExternalPackages,
	EXTERNAL_CACHE_DIRNAME,
	externalCacheDir,
	type ExternalResolution,
	externalResolution,
	type InstallRunner,
	type PackageManager,
} from "./external"
