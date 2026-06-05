# Mixed doc: a continuation plus an independent redeclaring example

```ts
const base: number = 1
```

A continuation that needs `base`:

```ts
const derived: number = base + 1
```

An independent example that also declares `base` — grouping all of these would
redeclare it:

```ts
const base: number = 99
const doubled: number = base * 2
```
