# Relative imports

A snippet importing from an imaginary sibling file (defined in an earlier snippet):

```ts
import { toolDefinitions } from "./tool-definitions"
const defs = toolDefinitions
```

A snippet importing a package that does not exist:

```ts
import { thing } from "totally-not-a-real-package-xyz"
const used = thing
```
