import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorSelection } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { editorInfoField, editorLivePreviewField, livePreviewState } from 'obsidian';
import type { CitationLinksContext } from '../context';
import { collectCitedKeys, groupLine } from '../parser';
import { bibliographyChanged } from './state';
import { CitationWidget } from './widget';

/**
 * Node-name fragments (case-insensitive substring match) that mark content
 * the citation renderer must leave alone: fenced/inline code, math, HTML
 * comments, escaped text and YAML frontmatter. Anything else, including an
 * unparsed tree (empty or "Document" node name), is treated as renderable;
 * the `treeChanged` trigger re-evaluates once parsing catches up.
 */
const EXCLUDED_NODE_FRAGMENTS = ['code', 'math', 'comment', 'escape', 'frontmatter'];

/**
 * Delays for the safety-net rebuilds after the bibliography became available.
 * They only fire while a note with citations still shows no decorations.
 */
const RETRY_DELAYS_MS = [300, 1000, 3000];

/** Read-only counters exposed for the "Copy debug report" command. */
export interface CitationViewPluginDiagnostics {
	builds: number;
	retries: number;
	lastTrigger: string;
	lastReady: boolean;
	lastLivePreview: boolean;
	lastVisibleRanges: string;
	lastGroups: number;
	lastExcluded: number;
	lastSelected: number;
	lastDecorations: number;
	lastError: string | null;
	citedKeys: number;
}

export interface CitationViewPluginValue {
	decorations: DecorationSet;
	readonly diagnostics: CitationViewPluginDiagnostics;
}

/**
 * True when `name` (a Lezer syntax node type name) signals content that must
 * not be rendered as a citation, such as `inline-code` or `hmd-frontmatter`.
 */
export function isExcludedNodeName(name: string): boolean {
	if (name === '' || name === 'Document') {
		return false;
	}
	const lower = name.toLowerCase();
	return EXCLUDED_NODE_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Live Preview rendering of citation links. Decorations are rebuilt for the
 * visible ranges only; the formatter caches every rendered citation.
 */
export function createCitationViewPlugin(context: CitationLinksContext): ViewPlugin<CitationViewPluginValue> {
	return ViewPlugin.fromClass(
		class CitationViewPlugin implements CitationViewPluginValue {
			decorations: DecorationSet;
			readonly diagnostics: CitationViewPluginDiagnostics = {
				builds: 0,
				retries: 0,
				lastTrigger: 'constructor',
				lastReady: false,
				lastLivePreview: false,
				lastVisibleRanges: '',
				lastGroups: 0,
				lastExcluded: 0,
				lastSelected: 0,
				lastDecorations: 0,
				lastError: null,
				citedKeys: 0,
			};

			private citedKeys: string[];
			private readonly unsubscribeBibliography: () => void;
			private destroyed = false;
			private reloadScheduled = false;
			private retryTimers: number[] = [];

			constructor(private readonly view: EditorView) {
				this.citedKeys = collectCitedKeys(view.state.doc.toString());
				this.decorations = this.build(view, 'constructor');
				// Each editor rebuilds itself once the bibliography is (re)loaded
				// instead of relying on main.ts reaching the editor through the
				// private `editor.cm` handle. Editors that were constructed while the
				// bibliography was still loading are covered this way.
				this.unsubscribeBibliography = context.bibliography.onChanged(() => this.scheduleBibliographyReload());
				if (context.bibliography.ready) {
					this.armRetries();
				}
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) {
					this.citedKeys = collectCitedKeys(update.state.doc.toString());
				}
				const livePreview = isLivePreview(update.view);
				const wasLivePreview = update.startState.field(editorLivePreviewField, false) ?? false;
				const dragging = update.view.plugin(livePreviewState)?.mousedown ?? false;
				const reloaded = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(bibliographyChanged)));
				const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
				// After opening a note the first layout pass can land before any other
				// trigger fires; use it when citations exist but nothing is decorated yet.
				const firstLayoutPending =
					(update.geometryChanged || update.heightChanged) && this.decorations.size === 0 && this.citedKeys.length > 0;

				const trigger = update.docChanged
					? 'docChanged'
					: update.viewportChanged
						? 'viewportChanged'
						: reloaded
							? 'bibliographyChanged'
							: treeChanged
								? 'treeChanged'
								: livePreview !== wasLivePreview
									? 'modeChanged'
									: livePreview && update.selectionSet && !dragging
										? 'selectionSet'
										: firstLayoutPending
											? 'firstLayout'
											: null;
				if (trigger !== null) {
					this.decorations = this.build(update.view, trigger);
					if (reloaded) {
						this.armRetries();
					}
				}
			}

			destroy(): void {
				this.destroyed = true;
				this.unsubscribeBibliography();
				this.clearRetries();
			}

			/**
			 * Dispatching synchronously from inside a bibliography-change callback
			 * could run while CodeMirror is still processing another update, which
			 * it rejects. Deferring to the next macrotask sidesteps that reentrancy.
			 */
			private scheduleBibliographyReload(): void {
				if (this.reloadScheduled || this.destroyed) {
					return;
				}
				this.reloadScheduled = true;
				window.setTimeout(() => {
					this.reloadScheduled = false;
					if (!this.destroyed) {
						this.view.dispatch({ effects: bibliographyChanged.of(context.bibliography.version) });
					}
				}, 0);
			}

			/**
			 * Safety net for the first render after start-up: if the note contains
			 * citations but nothing is decorated, request another build a few times.
			 */
			private armRetries(): void {
				this.clearRetries();
				for (const delay of RETRY_DELAYS_MS) {
					this.retryTimers.push(
						window.setTimeout(() => {
							if (this.destroyed || this.decorations.size > 0 || this.citedKeys.length === 0) {
								return;
							}
							if (!context.bibliography.ready || !isLivePreview(this.view)) {
								return;
							}
							this.diagnostics.retries += 1;
							this.view.dispatch({ effects: bibliographyChanged.of(context.bibliography.version) });
						}, delay),
					);
				}
			}

			private clearRetries(): void {
				for (const timer of this.retryTimers) {
					window.clearTimeout(timer);
				}
				this.retryTimers = [];
			}

			private build(view: EditorView, trigger: string): DecorationSet {
				const { diagnostics } = this;
				diagnostics.builds += 1;
				diagnostics.lastTrigger = trigger;
				diagnostics.lastReady = context.bibliography.ready;
				diagnostics.lastLivePreview = isLivePreview(view);
				diagnostics.lastVisibleRanges = view.visibleRanges.map((range) => `${range.from}-${range.to}`).join(', ');
				diagnostics.lastGroups = 0;
				diagnostics.lastExcluded = 0;
				diagnostics.lastSelected = 0;
				diagnostics.lastError = null;
				diagnostics.citedKeys = this.citedKeys.length;
				try {
					const decorations = this.buildDecorations(view);
					diagnostics.lastDecorations = decorations.size;
					return decorations;
				} catch (error) {
					// A view plugin that throws is torn down by CodeMirror for good,
					// which would look exactly like a permanently blank editor.
					diagnostics.lastError = error instanceof Error ? error.message : String(error);
					diagnostics.lastDecorations = 0;
					console.error('[citation-links] Failed to build citation decorations', error);
					return Decoration.none;
				}
			}

			private buildDecorations(view: EditorView): DecorationSet {
				const { state } = view;
				if (!isLivePreview(view) || !context.bibliography.ready) {
					return Decoration.none;
				}
				const { formatter } = context;
				formatter.prepare(this.citedKeys);
				const sourcePath = state.field(editorInfoField, false)?.file?.path ?? '';
				const tree = syntaxTree(state);
				const builder = new RangeSetBuilder<Decoration>();
				let processedTo = -1;
				for (const range of view.visibleRanges) {
					let pos = Math.max(range.from, processedTo + 1);
					while (pos <= range.to) {
						const line = state.doc.lineAt(pos);
						if (line.from > processedTo) {
							for (const group of groupLine(line.text)) {
								this.diagnostics.lastGroups += 1;
								const from = line.from + group.from;
								const to = line.from + group.to;
								if (group.parts.some((part) => isExcludedNodeName(nodeNameAt(tree, line.from + part.from + 2)))) {
									this.diagnostics.lastExcluded += 1;
									continue;
								}
								if (overlapsSelection(state.selection, from, to)) {
									this.diagnostics.lastSelected += 1;
									continue;
								}
								const rendered = formatter.citeGroup(
									group.parts.map((part) => ({ citekey: part.citekey, modifier: part.modifier })),
								);
								builder.add(
									from,
									to,
									Decoration.replace({ widget: new CitationWidget(rendered, group.parts, sourcePath, context) }),
								);
							}
							processedTo = line.to;
						}
						if (line.to >= range.to) {
							break;
						}
						pos = line.to + 1;
					}
				}
				return builder.finish();
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

function isLivePreview(view: EditorView): boolean {
	return view.state.field(editorLivePreviewField, false) ?? false;
}

/** The syntax node type name covering `pos`, or `''` when the tree has no node there. */
function nodeNameAt(tree: Tree, pos: number): string {
	return tree.resolveInner(pos, 1).type.name;
}

function overlapsSelection(selection: EditorSelection, from: number, to: number): boolean {
	return selection.ranges.some((range) => range.from <= to && range.to >= from);
}
