// Obsidian code uses window.setTimeout for popout-window compatibility; the
// node test environment has no window, so alias it to the global object.
if (typeof globalThis.window === 'undefined') {
	(globalThis as { window?: unknown }).window = globalThis;
}
