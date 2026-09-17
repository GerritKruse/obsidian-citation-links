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
 * comments, escaped text and YAML frontmatter. Anything else - including an
 * unparsed tree, which reports an empty or "Document" node name - is treated
 * as renderable, since the positive `hmd-internal-link` check used to require
 * a fully parsed tree and left links unrendered until something else forced
 * a reparse.
 */
const EXCLUDED_NODE_FRAGMENTS = ['code', 'math', 'comment', 'escape', 'frontmatter'];

/**
 * True when `name` (a Lezer syntax node type name) signals content that must
 * not be rendered as a citation, such as `inline-code` or `hmd-frontmatter`.
 * An empty name or `Document` - both signs the tree has not been parsed for
 * this position yet - is never excluded, so unparsed content still renders;
 * the `treeChanged` check in `update()` re-evaluates once parsing catches up
 * and corrects any code/math span that was optimistically rendered.
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
export function createCitationViewPlugin(context: CitationLinksContext) {
	return ViewPlugin.fromClass(
		class CitationViewPlugin {
			decorations: DecorationSet;
			private citedKeys: string[];
			private readonly unsubscribeBibliography: () => void;
			private destroyed = false;
			private reloadScheduled = false;

			constructor(view: EditorView) {
				this.citedKeys = collectCitedKeys(view.state.doc.toString());
				this.decorations = this.build(view);
				// Each editor rebuilds itself once the bibliography is (re)loaded,
				// instead of relying solely on `main.ts` reaching into the private
				// `editor.cm` handle of every open leaf. This covers editors that
				// were constructed while `context.bibliography.ready` was still
				// false (the bibliography loads asynchronously after the editor
				// extension is registered).
				this.unsubscribeBibliography = context.bibliography.onChanged(() => this.scheduleBibliographyReload(view));
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
				// After opening a note, the very first layout pass can land before
				// any of the other triggers fire. If citations are known to exist
				// but nothing was decorated yet, use that pass to render them.
				const firstLayoutPending =
					(update.geometryChanged || update.heightChanged) && this.decorations.size === 0 && this.citedKeys.length > 0;
				if (
					update.docChanged ||
					update.viewportChanged ||
					reloaded ||
					treeChanged ||
					livePreview !== wasLivePreview ||
					(livePreview && update.selectionSet && !dragging) ||
					firstLayoutPending
				) {
					this.decorations = this.build(update.view);
				}
			}

			destroy(): void {
				this.destroyed = true;
				this.unsubscribeBibliography();
			}

			/**
			 * Dispatching a new transaction synchronously from inside a
			 * bibliography-change callback can run while CodeMirror is still
			 * processing another update, which CodeMirror rejects. Deferring to
			 * the next macrotask sidesteps that reentrancy.
			 */
			private scheduleBibliographyReload(view: EditorView): void {
				if (this.reloadScheduled || this.destroyed) {
					return;
				}
				this.reloadScheduled = true;
				window.setTimeout(() => {
					this.reloadScheduled = false;
					if (this.destroyed) {
						return;
					}
					view.dispatch({ effects: bibliographyChanged.of(context.bibliography.version) });
				}, 0);
			}

			private build(view: EditorView): DecorationSet {
				try {
					return this.buildDecorations(view);
				} catch (error) {
					// A view plugin that throws from `update`/its decoration builder
					// is torn down by CodeMirror and never reinstated, which would
					// look exactly like the permanent blank state this fix targets.
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
								const from = line.from + group.from;
								const to = line.from + group.to;
								if (
									group.parts.some((part) =>
										isExcludedNodeName(nodeNameAt(tree, line.from + part.from + 2)),
									)
								) {
									continue;
								}
								if (overlapsSelection(state.selection, from, to)) {
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
