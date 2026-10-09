import { definePlugin, defineRule } from "./plugin"
import type { RuleDocumentContext, RuleProgramContext, RuleProjectContext } from "./types"

describe("defineRule and definePlugin", () => {
	it("return what they are given", () => {
		const rule = defineRule({ meta: { scope: "document", defaultSeverity: "warn" }, create() {} })
		const plugin = definePlugin({ name: "demo", rules: { rule } })
		expect(plugin.rules.rule).toBe(rule)
		expect(plugin.name).toBe("demo")
	})

	it("type the context from meta.scope and the options from meta.options", () => {
		defineRule({
			meta: { scope: "document", defaultSeverity: "warn", options: { default: { max: 2 } } },
			create(ctx) {
				expectTypeOf(ctx).toEqualTypeOf<RuleDocumentContext<{ max: number }>>()
			},
		})
		defineRule({
			meta: { scope: "program", defaultSeverity: "error" },
			create(ctx) {
				expectTypeOf(ctx).toEqualTypeOf<RuleProgramContext<unknown>>()
			},
		})
		defineRule({
			meta: { scope: "project", defaultSeverity: "off" },
			create(ctx) {
				expectTypeOf(ctx).toEqualTypeOf<RuleProjectContext<unknown>>()
			},
		})
	})

	it("keep the rule names of a plugin", () => {
		const rule = defineRule({ meta: { scope: "document", defaultSeverity: "warn" }, create() {} })
		const plugin = definePlugin({ name: "demo", rules: { first: rule, second: rule } })
		expectTypeOf(plugin.rules).toHaveProperty("first")
		expectTypeOf(plugin.rules).toHaveProperty("second")
	})
})
