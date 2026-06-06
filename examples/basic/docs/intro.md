# Basic example

Kiira type-checks the snippets below against TypeScript and the `node` types.

A snippet using Node's promises API (top-level `await` works because every
snippet is treated as a module):

```ts
import { readFile } from "node:fs/promises"

const contents = await readFile("package.json", "utf8")
const parsed: unknown = JSON.parse(contents)

if (typeof parsed === "object" && parsed !== null) {
  console.log(Object.keys(parsed))
}
```

A small type-level example:

```ts
type Awaitable<T> = T | Promise<T>

async function run<T>(value: Awaitable<T>): Promise<T> {
  return await value
}

const answer = await run(42)
console.log(answer.toFixed(0))
```

Conceptual pseudo-code is skipped with `ignore`:

```ts ignore
agent.doSomethingThatDoesNotExistYet()
```
