// This is your packages entry point, everything exported from here will be accessible to the end-user.
export const test = (): void => {
	// biome-ignore lint/suspicious/noConsole: test output by running this in one of the apps
	console.log("This is a test function from the open-source-stack package.")
}
