# Grouped walkthrough

Set up a value:

```ts group=demo
const greeting: string = "hello"
```

Then use it in a later fence — only resolvable because they share a group:

```ts group=demo
const louder: string = greeting.toUpperCase()
```

An ungrouped fence cannot see the earlier variable:

```ts
const orphan = greeting.length
```
