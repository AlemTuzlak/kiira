# Earlier fence

```ts
export const transferTool = { name: 'transfer', amount: 1 }
export type Transfer = { amount: number }
```

```ts
import { transferTool, type Transfer } from './tools'

const amount: string = transferTool.amount
const transfer: Transfer = { amount: 1 }
```
