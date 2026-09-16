import {
	EditorSuggest,
	type App,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
	type TFile,
} from 'obsidian';
import type { CitationLinksContext } from '../context';
import type { CslItem } from '../types';
import { suggestionLabel } from './label';

/** `@` followed by citekey characters at the end of the text before the cursor, optionally preceded by `[[`. */
const TRIGGER = /(\[\[)?@([\p{L}\p{N}_:.-]*)$/u;

/** Characters allowed directly before a bare `@` trigger (avoids e-mail addresses). */
const BEFORE_TRIGGER = /[\s(;,[]/;

/**
 * Autocompletion for citekeys, triggered by `@`. Suggestions come from the
 * bibliography, not from the vault, so works without a note are citable.
 * Selecting a suggestion always inserts a complete `[[@Citekey]]` link.
 */
export class CitekeySuggest extends EditorSuggest<CslItem> {
	constructor(
		app: App,
		private readonly deps: CitationLinksContext,
	) {
		super(app);
		this.limit = 20;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.deps.bibliography.ready) {
			return null;
		}
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const match = TRIGGER.exec(before);
		if (match === null) {
			return null;
		}
		const hasBrackets = match[1] !== undefined;
		const query = match[2] ?? '';
		const previous = before.charAt(match.index - 1);
		if (!hasBrackets && match.index > 0 && !BEFORE_TRIGGER.test(previous)) {
			return null;
		}
		return {
			start: { line: cursor.line, ch: match.index },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): CslItem[] {
		return this.deps.bibliography.search(context.query, this.limit);
	}

	renderSuggestion(item: CslItem, el: HTMLElement): void {
		el.addClass('citation-links-suggestion');
		el.createDiv({ cls: 'citation-links-suggestion-key', text: `@${item.id}` });
		el.createDiv({ cls: 'citation-links-suggestion-label', text: suggestionLabel(item) });
	}

	selectSuggestion(item: CslItem, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (context === null) {
			return;
		}
		const { editor, start } = context;
		let end = context.end;
		// Obsidian's bracket auto-pairing may already have inserted the closing "]]".
		const following = editor.getLine(end.line).slice(end.ch, end.ch + 2);
		if (following === ']]') {
			end = { line: end.line, ch: end.ch + 2 };
		}
		const replacement = `[[@${item.id}]]`;
		editor.replaceRange(replacement, start, end);
		editor.setCursor({ line: start.line, ch: start.ch + replacement.length });
		this.close();
	}
}
