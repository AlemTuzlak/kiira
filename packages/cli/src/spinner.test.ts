import { startSpinner } from "./spinner"

function mockStream(isTTY: boolean) {
	const writes: string[] = []
	return { isTTY, write: (chunk: string) => writes.push(chunk), writes }
}

describe("startSpinner", () => {
	it("is a no-op when disabled (--static)", () => {
		const stream = mockStream(true)
		startSpinner("Checking", { enabled: false, stream }).stop()
		expect(stream.writes).toEqual([])
	})

	it("is a no-op on a non-TTY stream (pipes / CI)", () => {
		const stream = mockStream(false)
		startSpinner("Checking", { enabled: true, stream }).stop()
		expect(stream.writes).toEqual([])
	})

	it("renders and clears the line when enabled on a TTY", () => {
		const stream = mockStream(true)
		const spinner = startSpinner("Checking", { enabled: true, stream })
		// An initial frame was rendered with the label.
		expect(stream.writes.some((w) => w.includes("Checking"))).toBe(true)
		spinner.stop()
		// The final write clears the line (CSI K) so no spinner residue remains.
		expect(stream.writes[stream.writes.length - 1]).toContain("[K")
	})
})
