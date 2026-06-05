# @example/beta usage

```ts
import { setTimeout as delay } from "node:timers/promises"

export async function poll(times: number): Promise<number> {
  let count = 0
  for (let i = 0; i < times; i++) {
    await delay(10)
    count += 1
  }
  return count
}

console.log(await poll(3))
```
