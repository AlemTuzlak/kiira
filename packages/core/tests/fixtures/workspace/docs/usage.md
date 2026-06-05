# Usage

A snippet importing a workspace package by name (resolves to its source):

```ts
import { greet } from "@demo/lib"

const result = greet("world")
const text: string = result.text
```

A snippet importing a member that does not exist:

```ts
import { doesNotExist } from "@demo/lib"

doesNotExist()
```
