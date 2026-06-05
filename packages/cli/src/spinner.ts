const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// ESC built at runtime to keep the source free of raw control characters.
const ESC = String.fromCharCode(27)
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const CLEAR_LINE = `\r${ESC}[K`

interface Spinner {
	stop(): void
}

interface SpinnerStream {
	isTTY?: boolean
	write(chunk: string): unknown
}

interface SpinnerOptions {
	enabled: boolean
	/** Defaults to process.stderr, so the spinner never pollutes stdout (reports/JSON). */
	stream?: SpinnerStream
}

/**
 * Start a braille spinner on stderr while async work runs. A no-op when disabled
 * (`--static`) or when the stream is not a TTY (pipes, CI) so output stays clean.
 */
export function startSpinner(text: string, options: SpinnerOptions): Spinner {
	const stream = options.stream ?? process.stderr
	if (!options.enabled || !stream.isTTY) {
		return { stop() {} }
	}

	let frame = 0
	const render = (): void => {
		stream.write(`\r${FRAMES[frame]} ${text}`)
	}
	stream.write(HIDE_CURSOR)
	render()
	const timer = setInterval(() => {
		frame = (frame + 1) % FRAMES.length
		render()
	}, 80)

	return {
		stop() {
			clearInterval(timer)
			stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`)
		},
	}
}
