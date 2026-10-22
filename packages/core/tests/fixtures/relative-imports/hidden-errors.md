# Hidden errors

```ts
import { tools } from './tools'

type Options<T> = { tools?: T; count: number } & (T extends readonly unknown[] ? {} : never)

function run<const T extends readonly unknown[] | undefined = undefined>(options: Options<T>) {
  return options
}

run({ tools })
```

```ts
import type { Config } from './config'
import Client from './client'

const config: Config = { anything: true }
new Client(config).go()
```
