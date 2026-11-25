import { defineConfig } from "./index"
import { definePlugin, defineRule } from "./plugin"

describe("kiira public entries", () => {
	it("re-exports defineConfig without running the CLI", () => {
		const config = { include: ["docs/**/*.md"] }
		expect(defineConfig(config)).toBe(config)
		expect(process.exitCode).toBeUndefined()
	})

	it("re-exports the plugin helpers from kiira/plugin", () => {
		const plugin = { name: "team" }
		expect(definePlugin(plugin)).toBe(plugin)
		expect(typeof defineRule).toBe("function")
	})
})
