type Op = { type: " " | "-" | "+"; line: string }

const CONTEXT = 3

/** Shortest edit script between two line lists (Myers), after trimming the shared head and tail. */
function diffLines(a: string[], b: string[]): Op[] {
	let head = 0
	while (head < a.length && head < b.length && a[head] === b[head]) {
		head += 1
	}
	let tail = 0
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
		tail += 1
	}
	const x0 = a.slice(head, a.length - tail)
	const y0 = b.slice(head, b.length - tail)

	const n = x0.length
	const m = y0.length
	const offset = n + m + 1
	const v = new Int32Array(2 * offset + 1)
	const trace: Int32Array[] = []
	search: for (let d = 0; d <= n + m; d += 1) {
		trace.push(v.slice())
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
			let y = x - k
			while (x < n && y < m && x0[x] === y0[y]) {
				x += 1
				y += 1
			}
			v[offset + k] = x
			if (x >= n && y >= m) {
				break search
			}
		}
	}

	const middle: Op[] = []
	let x = n
	let y = m
	for (let d = trace.length - 1; d >= 0; d -= 1) {
		const before = trace[d]
		const k = x - y
		const prevK = k === -d || (k !== d && before[offset + k - 1] < before[offset + k + 1]) ? k + 1 : k - 1
		const prevX = before[offset + prevK]
		const prevY = prevX - prevK
		while (x > prevX && y > prevY) {
			middle.push({ type: " ", line: x0[x - 1] })
			x -= 1
			y -= 1
		}
		if (d > 0) {
			if (x === prevX) {
				middle.push({ type: "+", line: y0[y - 1] })
				y -= 1
			} else {
				middle.push({ type: "-", line: x0[x - 1] })
				x -= 1
			}
		}
	}
	middle.reverse()

	return [
		...a.slice(0, head).map((line): Op => ({ type: " ", line })),
		...middle,
		...a.slice(a.length - tail).map((line): Op => ({ type: " ", line })),
	]
}

// Lines keep their terminator, so a line that gains or loses its final newline counts as changed.
const splitLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

function formatLine(op: Op): string {
	const text = op.line.endsWith("\n") ? op.line.slice(0, -1) : `${op.line}\n\\ No newline at end of file`
	return `${op.type}${text}\n`
}

// An empty range is written as the line before it.
const range = (start: number, count: number): string => `${count === 0 ? start - 1 : start},${count}`

/** A unified diff (`--- a/` / `+++ b/` headers, 3 lines of context) between two texts, or "" when they are equal. */
export function unifiedDiff(file: string, before: string, after: string): string {
	if (before === after) {
		return ""
	}
	const ops = diffLines(splitLines(before), splitLines(after))

	const regions: Array<[start: number, end: number]> = []
	ops.forEach((op, index) => {
		if (op.type === " ") {
			return
		}
		const start = Math.max(0, index - CONTEXT)
		const end = Math.min(ops.length, index + CONTEXT + 1)
		const last = regions[regions.length - 1]
		if (last && start <= last[1]) {
			last[1] = end
		} else {
			regions.push([start, end])
		}
	})

	let out = `--- a/${file}\n+++ b/${file}\n`
	for (const [start, end] of regions) {
		const hunk = ops.slice(start, end)
		const consumed = ops.slice(0, start)
		const oldCount = hunk.filter((op) => op.type !== "+").length
		const newCount = hunk.filter((op) => op.type !== "-").length
		const oldStart = consumed.filter((op) => op.type !== "+").length + 1
		const newStart = consumed.filter((op) => op.type !== "-").length + 1
		out += `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n${hunk.map(formatLine).join("")}`
	}
	return out
}
