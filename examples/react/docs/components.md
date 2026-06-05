# React example

The default fixture (`react`) imports `React` for every snippet, so JSX just works.

```tsx
import { useState } from "react"

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>
}
```

Typing component props:

```tsx
interface GreetingProps {
  name: string
  excited?: boolean
}

export function Greeting({ name, excited = false }: GreetingProps) {
  return <p>Hello, {name}{excited ? "!" : "."}</p>
}
```

A bare piece of JSX, wrapped into a component by the `react-component` fixture:

```tsx fixture=react-component
<div className="card">
  <h1>Wrapped automatically</h1>
</div>
```
