# Grouping must not merge a redeclaring example that only shares a reference

```ts
class Widget {
	render() {}
}
const client = new Widget()
```

```ts
client.render()
```

A separate, independent example that also refers to `Widget` but starts its own
`client` — it must NOT be pulled into the group above (that would redeclare it):

```ts
const client = new Widget()
client.render()
```
