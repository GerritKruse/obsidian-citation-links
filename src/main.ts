import type { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, type PaneType } from 'obsidian';
import { DEFAULT_LANG, LOCALES, STYLE_XML } from './assets';
import { Bibliography } from './bibliography';
import { HOVER_SOURCE_ID, type CitationLinksContext } from './context';
import { buildDebugReport } from './debug';
import { bibliographyChanged, bibliographyVersionField } from './editor/state';
import { createCitationViewPlugin } from './editor/viewPlugin';
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

		this.registerEditorExtension([bibliographyVersionField, createCitationViewPlugin(this.context)]);
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
		this.settings = { ...DEFAULT_SETTINGS, ...(isRecord(stored) ? stored : {}) };
		if (typeof this.settings.folder !== 'string') {
			this.settings.folder = '';
		}
		if (typeof this.settings.autocomplete !== 'boolean') {
			this.settings.autocomplete = DEFAULT_SETTINGS.autocomplete;
		}
		if (typeof this.settings.referenceListShown !== 'boolean') {
			this.settings.referenceListShown = DEFAULT_SETTINGS.referenceListShown;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Load the bibliography once the workspace exists and open the reference list on the first run. */
	private async start(): Promise<void> {
		await this.applyFolder();
		if (!this.settings.referenceListShown) {
			this.settings.referenceListShown = true;
			await this.saveSettings();
			await this.activateReferenceList();
		}
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
		const report = buildDebugReport(this.app, this.bibliography, resolveFolder(this.settings.folder), this.manifest.version);
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
