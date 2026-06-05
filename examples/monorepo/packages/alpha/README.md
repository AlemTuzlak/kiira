# @example/alpha

```ts
export interface Logger {
  log(message: string): void
}

export function createLogger(prefix: string): Logger {
  return {
    log(message) {
      console.log(`[${prefix}] ${message}`)
    },
  }
}

createLogger("alpha").log("ready")
```
