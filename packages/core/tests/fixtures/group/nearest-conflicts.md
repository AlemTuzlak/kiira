# When the nearest declarer conflicts, an earlier valid provider is used

```ts
class Item {
	use() {}
}
```

An independent example that redeclares both `Item` and `shared` — the
continuation below must NOT link here (that would redeclare `shared`):

```ts
class Item {
	use() {}
}
const shared = 1
```

```ts
const shared = 1
const picked = new Item()
picked.use()
```
