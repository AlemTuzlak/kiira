// @typedown/core public API.

export const TYPEDOWN_CORE_VERSION = "0.1.0"

export * from "./types"
export {
	CONFIG_FILENAMES,
	DEFAULT_LANGUAGES,
	defineConfig,
	findConfigFile,
	loadConfig,
	resolveConfig,
} from "./config"
export { discoverMarkdownFiles, type DiscoverInput } from "./discover"
export { type FenceMetaIssue, parseFenceMeta, type ParsedFenceMeta } from "./meta"
export {
	type ExtractContentInput,
	type ExtractInput,
	extractMarkdownSnippets,
	extractSnippetsFromContent,
	type SnippetExtraction,
} from "./extract"
