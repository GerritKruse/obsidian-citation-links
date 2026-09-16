import { StateEffect, StateField } from '@codemirror/state';

/**
 * Dispatched to every open editor when the bibliography has been reloaded.
 * The citation view plugin rebuilds its decorations when it sees the effect.
 */
export const bibliographyChanged = StateEffect.define<number>();

/** Current bibliography version as seen by an editor state. */
export const bibliographyVersionField = StateField.define<number>({
	create: () => 0,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(bibliographyChanged)) {
				value = effect.value;
			}
		}
		return value;
	},
});
