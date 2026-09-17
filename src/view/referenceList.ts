import { ItemView, Keymap, MarkdownView, Notice, setIcon, setTooltip, TFile, debounce, type WorkspaceLeaf } from 'obsidian';
import type { CitationLinksContext } from '../context';
import { collectCitedKeys } from '../parser';
import { nodeHttpRequest } from '../zotero/http';
import { openExternal, prefetchZoteroLinks, resolveZoteroSelectUrl, type ZoteroLink, type ZoteroLinkDeps } from '../zotero/select';

export const REFERENCE_VIEW_TYPE = 'citation-links-references';

/** Zotero's local server drops requests with an Origin header, so plain Node HTTP is used instead of requestUrl. */
const ZOTERO_DEPS: ZoteroLinkDeps = { request: nodeHttpRequest };

/**
 * Right sidebar view listing the works cited in the active note as an APA
 * reference list, each with a Zotero button and an open/create note button.
 */
export class ReferenceListView extends ItemView {
	private currentFile: TFile | null = null;
	/** Incremented per render so late Zotero lookups do not touch a newer list. */
	private renderGeneration = 0;

	readonly scheduleRefresh = debounce(
		() => {
			void this.refresh();
		},
		250,
		true,
	);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly context: CitationLinksContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return REFERENCE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'References';
	}

	getIcon(): string {
		return 'quote';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('citation-links-view');
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRefresh()));
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file === this.currentFile) {
					this.scheduleRefresh();
				}
			}),
		);
		this.scheduleRefresh();
		return Promise.resolve();
	}

	async refresh(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = activeView?.file ?? this.currentFile;
		this.currentFile = file;
		const generation = ++this.renderGeneration;
		const { contentEl } = this;
		contentEl.empty();
		this.renderHeader(contentEl);

		if (!this.context.bibliography.ready) {
			contentEl.createDiv({ cls: 'pane-empty', text: 'No bibliography loaded. Set the CSL JSON folder in the plugin settings.' });
			return;
		}
		if (file === null) {
			contentEl.createDiv({ cls: 'pane-empty', text: 'Open a note to see its references.' });
			return;
		}
		const text = await this.app.vault.cachedRead(file);
		if (generation !== this.renderGeneration) {
			return;
		}
		const citedKeys = collectCitedKeys(text);
		const entries = this.context.formatter.bibliography(citedKeys);
		if (entries.length === 0) {
			contentEl.createDiv({ cls: 'pane-empty', text: 'No citations in the current note.' });
			return;
		}
		const list = contentEl.createDiv({ cls: 'citation-links-entries' });
		const zoteroButtons = new Map<string, HTMLButtonElement>();
		for (const entry of entries) {
			zoteroButtons.set(entry.citekey, this.renderEntry(list, entry.citekey, entry.html, file.path));
		}
		void this.prefetchZoteroLinks(zoteroButtons, generation);
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'citation-links-view-header' });
		header.createSpan({ cls: 'citation-links-view-title', text: 'References' });
		const reload = header.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': 'Reload bibliography' } });
		setIcon(reload, 'refresh-cw');
		reload.addEventListener('click', () => {
			void this.context.bibliography.reload().then(() => this.scheduleRefresh());
		});
	}

	/** Renders one entry and returns its Zotero button so its state can be updated later. */
	private renderEntry(container: HTMLElement, citekey: string, html: string, sourcePath: string): HTMLButtonElement {
		const entry = container.createDiv({ cls: 'citation-links-entry' });
		const body = entry.createDiv({ cls: 'citation-links-entry-text' });
		appendHtml(body, html);

		const actions = entry.createDiv({ cls: 'citation-links-entry-actions' });
		const zotero = actions.createEl('button', { cls: 'citation-links-entry-button', text: 'Zotero' });
		setIcon(zotero.createSpan({ cls: 'citation-links-entry-icon' }), 'external-link');
		setTooltip(zotero, 'Open in Zotero');
		zotero.addEventListener('click', () => {
			void this.openInZotero(citekey, zotero);
		});

		const linkpath = `@${citekey}`;
		const exists = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) !== null;
		const note = actions.createEl('button', {
			cls: 'citation-links-entry-button',
			text: exists ? 'Open note' : 'Create note',
		});
		setIcon(note.createSpan({ cls: 'citation-links-entry-icon' }), exists ? 'file-text' : 'file-plus');
		note.addEventListener('click', (evt) => {
			void this.context.openNote(citekey, linkpath, sourcePath, Keymap.isModEvent(evt)).then(() => this.scheduleRefresh());
		});
		return zotero;
	}

	/** Resolve all Zotero links in the background so buttons reflect availability before the first click. */
	private async prefetchZoteroLinks(buttons: Map<string, HTMLButtonElement>, generation: number): Promise<void> {
		const links = await prefetchZoteroLinks(
			Array.from(buttons.keys()),
			(citekey) => this.context.bibliography.get(citekey),
			ZOTERO_DEPS,
		);
		if (generation !== this.renderGeneration) {
			return;
		}
		for (const [citekey, button] of buttons) {
			const link = links.get(citekey);
			if (link !== undefined) {
				applyZoteroState(button, link);
			}
		}
	}

	private async openInZotero(citekey: string, button: HTMLButtonElement): Promise<void> {
		const item = this.context.bibliography.get(citekey);
		const link = await resolveZoteroSelectUrl(citekey, item, ZOTERO_DEPS);
		applyZoteroState(button, link);
		switch (link.status) {
			case 'exact':
				if (link.url !== null) {
					openExternal(link.url);
				}
				return;
			case 'not-found':
				new Notice(`Citation Links: "${citekey}" was not found in any Zotero library`);
				return;
			case 'unreachable':
				new Notice('Citation Links: Zotero with Better BibTeX is not running. Start Zotero and try again.');
				return;
		}
	}
}

function applyZoteroState(button: HTMLButtonElement, link: ZoteroLink): void {
	switch (link.status) {
		case 'exact':
			button.disabled = false;
			setTooltip(button, link.library !== undefined ? `Open in Zotero (${link.library})` : 'Open in Zotero');
			return;
		case 'not-found':
			button.disabled = true;
			setTooltip(button, 'Not found in any Zotero library');
			return;
		case 'unreachable':
			button.disabled = false;
			setTooltip(button, 'Zotero is not running');
			return;
	}
}

/** Append citeproc's HTML (`<div class="csl-entry">` with `<i>` tags) without innerHTML. */
function appendHtml(target: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	target.append(...Array.from(parsed.body.childNodes));
}
