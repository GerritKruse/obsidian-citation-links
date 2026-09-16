import { ItemView, Keymap, MarkdownView, Notice, requestUrl, setIcon, TFile, debounce, type WorkspaceLeaf } from 'obsidian';
import type { CitationLinksContext } from '../context';
import { collectCitedKeys } from '../parser';
import { openExternal, resolveZoteroSelectUrl } from '../zotero/select';

export const REFERENCE_VIEW_TYPE = 'citation-links-references';

/**
 * Right sidebar view listing the works cited in the active note as an APA
 * reference list, each with a Zotero button and an open/create note button.
 */
export class ReferenceListView extends ItemView {
	private currentFile: TFile | null = null;

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
		const citedKeys = collectCitedKeys(text);
		const entries = this.context.formatter.bibliography(citedKeys);
		if (entries.length === 0) {
			contentEl.createDiv({ cls: 'pane-empty', text: 'No citations in the current note.' });
			return;
		}
		const list = contentEl.createDiv({ cls: 'citation-links-entries' });
		for (const entry of entries) {
			this.renderEntry(list, entry.citekey, entry.html, file.path);
		}
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

	private renderEntry(container: HTMLElement, citekey: string, html: string, sourcePath: string): void {
		const entry = container.createDiv({ cls: 'citation-links-entry' });
		const body = entry.createDiv({ cls: 'citation-links-entry-text' });
		appendHtml(body, html);

		const actions = entry.createDiv({ cls: 'citation-links-entry-actions' });
		const zotero = actions.createEl('button', { cls: 'citation-links-entry-button', text: 'Zotero' });
		setIcon(zotero.createSpan({ cls: 'citation-links-entry-icon' }), 'external-link');
		zotero.addEventListener('click', () => {
			void this.openInZotero(citekey);
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
	}

	private async openInZotero(citekey: string): Promise<void> {
		const item = this.context.bibliography.get(citekey);
		const link = await resolveZoteroSelectUrl(citekey, item, { request: requestUrl });
		if (!link.exact) {
			new Notice('Zotero is not running; the link can only resolve items in "My Library"');
		}
		openExternal(link.url);
	}
}

/** Append citeproc's HTML (`<div class="csl-entry">` with `<i>` tags) without innerHTML. */
function appendHtml(target: HTMLElement, html: string): void {
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	target.append(...Array.from(parsed.body.childNodes));
}
