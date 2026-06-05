# Check fixture

A snippet importing a member that does not exist:

```ts
import { definitelyNotExported } from "typescript"
const x = definitelyNotExported
```

A snippet that type-checks cleanly:

```ts
const greeting: string = "hello"
const length: number = greeting.length
```

A snippet with a plain type error:

```ts
const count: number = "not a number"
```
