import { Prec } from '@codemirror/state';
import type { EditorView, ViewPlugin } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, type PaneType } from 'obsidian';
import { DEFAULT_LANG, LOCALES, STYLE_XML } from './assets';
import { Bibliography } from './bibliography';
import { HOVER_SOURCE_ID, type CitationLinksContext } from './context';
import { buildDebugReport } from './debug';
import { bibliographyChanged, bibliographyVersionField } from './editor/state';
import { createCitationViewPlugin, type CitationViewPluginValue } from './editor/viewPlugin';
import { openOrCreateLiteratureNote } from './notes';
import { createPostProcessor } from './reading/postProcessor';
import { Formatter } from './render/formatter';
import { CitationLinksSettingTab, DEFAULT_SETTINGS, resolveFolder, type CitationLinksSettings } from './settings';
import { CitekeySuggest } from './suggest/citekeySuggest';
import { REFERENCE_VIEW_TYPE, ReferenceListView } from './view/referenceList';

export default class CitationLinksPlugin extends Plugin {
	settings!: CitationLinksSettings;
	formatter!: Formatter;
	bibliography!: Bibliography;
	context!: CitationLinksContext;
	private viewPlugin!: ViewPlugin<CitationViewPluginValue>;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.formatter = new Formatter({ styleXml: STYLE_XML, locales: LOCALES, lang: DEFAULT_LANG });
		this.bibliography = new Bibliography();
		this.register(() => this.bibliography.dispose());

		this.context = {
			app: this.app,
			formatter: this.formatter,
			bibliography: this.bibliography,
			openNote: (citekey: string, linkpath: string, sourcePath: string, paneType: PaneType | boolean) =>
				openOrCreateLiteratureNote(this.app, citekey, linkpath, sourcePath, paneType),
			isAutocompleteEnabled: () => this.settings.autocomplete,
		};

		this.bibliography.onChanged((bibliography) => {
			this.formatter.setItems(bibliography.all());
			this.refreshViews();
		});

		// Load the bibliography before any editor or reading view is rendered. Embedded Live Preview
		// blocks (callouts, tables) are rendered once by Obsidian and not repainted on a later
		// bibliography reload, so citations inside them would otherwise stay raw after start-up.
		await this.applyFolder();

		this.viewPlugin = createCitationViewPlugin(this.context);
		// Highest precedence so the citation replace decoration is ordered before Obsidian's own
		// formatting-hiding replace decorations that start at the same "[[" position; otherwise
		// CodeMirror's tile renderer draws Obsidian's empty widget over the whole citation range.
		this.registerEditorExtension([bibliographyVersionField, Prec.highest(this.viewPlugin)]);
		this.registerMarkdownPostProcessor(createPostProcessor(this.context));
		this.registerView(REFERENCE_VIEW_TYPE, (leaf) => new ReferenceListView(leaf, this.context));
		this.registerEditorSuggest(new CitekeySuggest(this.app, this.context));
		this.registerHoverLinkSource(HOVER_SOURCE_ID, { display: 'Citation Links', defaultMod: true });

		this.addRibbonIcon('quote', 'Show reference list', () => {
			void this.activateReferenceList();
		});

		this.addCommand({
			id: 'reload-bibliography',
			name: 'Reload bibliography',
			callback: () => {
				void this.reloadBibliography();
			},
		});
		this.addCommand({
			id: 'show-reference-list',
			name: 'Show reference list',
			callback: () => {
				void this.activateReferenceList();
			},
		});
		this.addCommand({
			id: 'copy-debug-report',
			name: 'Copy debug report',
			callback: () => {
				void this.copyDebugReport();
			},
		});

		this.addSettingTab(new CitationLinksSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.start();
		});
	}

	async loadSettings(): Promise<void> {
		const stored: unknown = await this.loadData();
		const record = isRecord(stored) ? stored : {};
		this.settings = {
			folder: typeof record.folder === 'string' ? record.folder : DEFAULT_SETTINGS.folder,
			autocomplete: typeof record.autocomplete === 'boolean' ? record.autocomplete : DEFAULT_SETTINGS.autocomplete,
			showReferenceList:
				typeof record.showReferenceList === 'boolean' ? record.showReferenceList : DEFAULT_SETTINGS.showReferenceList,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Once the workspace exists, make sure the reference list is present if wanted. */
	private async start(): Promise<void> {
		if (!this.settings.showReferenceList) {
			return;
		}
		await this.ensureReferenceList();
		// Sidebar tabs restored as deferred views can appear slightly after layout-ready; run once more.
		const timer = window.setTimeout(() => {
			void this.ensureReferenceList();
		}, 2000);
		this.register(() => window.clearTimeout(timer));
	}

	/** (Re)load the bibliography from the configured folder and start watching it. */
	async applyFolder(): Promise<void> {
		await this.bibliography.setFolder(resolveFolder(this.settings.folder));
	}

	async reloadBibliography(): Promise<void> {
		if (resolveFolder(this.settings.folder) === '') {
			new Notice('Citation Links: no CSL JSON folder configured');
			return;
		}
		const summary = await this.bibliography.reload();
		if (summary === null) {
			new Notice('Citation Links: bibliography could not be loaded, see the developer console');
			return;
		}
		new Notice(`Citation Links: ${summary.items} items from ${summary.files} file(s)`);
	}

	async copyDebugReport(): Promise<void> {
		const report = buildDebugReport(
			this.app,
			this.bibliography,
			resolveFolder(this.settings.folder),
			this.manifest.version,
			this.viewPlugin,
		);
		try {
			await navigator.clipboard.writeText(report);
		} catch (error) {
			console.warn('[citation-links] Could not copy the debug report', error);
		}
		new Notice(report, 15000);
	}

	/** Repaint every open editor, reading view and reference list after a bibliography reload. */
	refreshViews(): void {
		const version = this.bibliography.version;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}
			// `editor.cm` is not part of the public API but is the established way to reach the CodeMirror view.
			const cm = (view.editor as unknown as { cm?: EditorView }).cm;
			cm?.dispatch({ effects: bibliographyChanged.of(version) });
			if (view.getMode() === 'preview') {
				view.previewMode.rerender(true);
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(REFERENCE_VIEW_TYPE)) {
			if (leaf.view instanceof ReferenceListView) {
				leaf.view.scheduleRefresh();
			}
		}
	}

	/** Open the reference list in the right sidebar without stealing focus; keeps exactly one instance. */
	private async ensureReferenceList(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(REFERENCE_VIEW_TYPE);
		for (const duplicate of leaves.slice(1)) {
			duplicate.detach();
		}
		if (leaves.length > 0) {
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf === null) {
			return;
		}
		await leaf.setViewState({ type: REFERENCE_VIEW_TYPE, active: false });
	}

	/** Open (if needed) and reveal the reference list. */
	async activateReferenceList(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(REFERENCE_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false);
		if (leaf === null || leaf === undefined) {
			return;
		}
		if (existing === undefined) {
			await leaf.setViewState({ type: REFERENCE_VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Close every reference list leaf (user-initiated through the setting). */
	closeReferenceList(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(REFERENCE_VIEW_TYPE)) {
			leaf.detach();
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
