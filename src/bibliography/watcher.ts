import { fs, type FileWatcher } from '../platform/node';

/** Delays, in order, before each attempt to re-create a failed watcher. */
const RESTART_DELAYS_MS = [5000, 30000];

export interface FolderWatcher {
	/** Stops watching and cancels any pending restart. No callback fires after this. */
	dispose(): void;
}

/**
 * Watches a folder of CSL-JSON bibliography exports for changes.
 *
 * Better BibTeX rewrites its export file(s) in place on every library
 * change - typically a truncate-and-rewrite, sometimes as several quick
 * successive writes for one logical change. `onChange` therefore fires more
 * often, and earlier, than a bibliography reload should actually happen:
 * callers must debounce the events and be prepared to retry a read/parse
 * that raced an in-progress rewrite, rather than treating one failed parse
 * as final.
 *
 * If the underlying watch errors out (e.g. the folder was removed), the
 * watcher is closed, `onError` is called, and this module tries to
 * re-create the watch after 5 s and, if that also fails, after 30 s. After
 * that it gives up; the caller is expected to re-create the watcher itself
 * on the next manual reload.
 */
export function watchFolder(
	dir: string,
	onChange: (fileName: string | null) => void,
	onError: (error: unknown) => void,
): FolderWatcher {
	let disposed = false;
	let watcher: FileWatcher | null = null;
	let restartTimer: number | null = null;
	let restartAttempt = 0;

	function create(): FileWatcher | null {
		try {
			const created = fs.watch(dir, { persistent: false }, (_eventType, fileName) => {
				if (disposed) return;
				onChange(fileName ?? null);
			});
			created.on('error', (error) => {
				created.close();
				if (watcher === created) watcher = null;
				if (disposed) return;
				onError(error);
				scheduleRestart();
			});
			return created;
		} catch (error) {
			if (!disposed) onError(error);
			return null;
		}
	}

	function scheduleRestart(): void {
		if (disposed || restartAttempt >= RESTART_DELAYS_MS.length) return;
		const delay = RESTART_DELAYS_MS[restartAttempt];
		restartAttempt++;
		restartTimer = window.setTimeout(() => {
			restartTimer = null;
			if (disposed) return;
			watcher = create();
		}, delay);
	}

	watcher = create();

	return {
		dispose(): void {
			disposed = true;
			if (restartTimer !== null) {
				window.clearTimeout(restartTimer);
				restartTimer = null;
			}
			watcher?.close();
			watcher = null;
		},
	};
}
