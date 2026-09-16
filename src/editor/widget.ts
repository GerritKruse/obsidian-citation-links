import { WidgetType } from '@codemirror/view';
import { Keymap, setTooltip } from 'obsidian';
import { HOVER_SOURCE_ID, UNKNOWN_TOOLTIP, type CitationLinksContext } from '../context';
import type { CitationLink, RenderedGroup } from '../types';

/**
 * Replaces one citation group (`[[@A]]; [[@B]]`) in Live Preview with its
 * formatted text. Every part stays individually clickable and hoverable.
 */
export class CitationWidget extends WidgetType {
	private readonly signature: string;

	constructor(
		private readonly rendered: RenderedGroup,
		private readonly links: CitationLink[],
		private readonly sourcePath: string,
		private readonly context: CitationLinksContext,
	) {
		super();
		this.signature = JSON.stringify([
			rendered.prefix,
			rendered.suffix,
			rendered.parts.map((part) => [part.text, part.unknown]),
			links.map((link) => link.linkpath),
			sourcePath,
		]);
	}

	eq(other: CitationWidget): boolean {
		return other.signature === this.signature;
	}

	toDOM(): HTMLElement {
		const root = createSpan({ cls: 'citation-links-cite' });
		root.appendText(this.rendered.prefix);
		this.rendered.parts.forEach((part, index) => {
			if (index > 0) {
				root.appendText(this.rendered.separator);
			}
			const link = this.links[index];
			const el = root.createSpan({
				cls: 'citation-links-part cm-hmd-internal-link cm-underline',
				text: part.text,
			});
			if (link !== undefined) {
				el.setAttribute('data-href', link.linkpath);
			}
			if (part.unknown) {
				el.addClass('citation-links-unknown');
				setTooltip(el, UNKNOWN_TOOLTIP);
			}
			el.addEventListener('click', (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (link === undefined) {
					return;
				}
				void this.context.openNote(part.citekey, link.linkpath, this.sourcePath, Keymap.isModEvent(evt));
			});
			el.addEventListener('mouseover', (evt) => {
				if (link === undefined || part.unknown) {
					return;
				}
				this.context.app.workspace.trigger('hover-link', {
					event: evt,
					source: HOVER_SOURCE_ID,
					hoverParent: root,
					targetEl: el,
					linktext: link.linkpath,
					sourcePath: this.sourcePath,
				});
			});
		});
		root.appendText(this.rendered.suffix);
		return root;
	}

	/**
	 * CodeMirror must not treat clicks inside the widget as cursor placement,
	 * otherwise the widget would be replaced by raw text before the click
	 * completes. Our own DOM listeners still fire.
	 */
	ignoreEvent(): boolean {
		return true;
	}
}
