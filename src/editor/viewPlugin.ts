import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorSelection } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { editorInfoField, editorLivePreviewField, livePreviewState } from 'obsidian';
import type { CitationLinksContext } from '../context';
import { collectCitedKeys, groupLine } from '../parser';
import { bibliographyChanged } from './state';
import { CitationWidget } from './widget';

/** Token name fragment Obsidian's Markdown mode assigns to wikilink content. */
const LINK_TOKEN = 'hmd-internal-link';

/**
 * Live Preview rendering of citation links. Decorations are rebuilt for the
 * visible ranges only; the formatter caches every rendered citation.
 */
export function createCitationViewPlugin(context: CitationLinksContext) {
	return ViewPlugin.fromClass(
		class CitationViewPlugin {
			decorations: DecorationSet;
			private citedKeys: string[];

			constructor(view: EditorView) {
				this.citedKeys = collectCitedKeys(view.state.doc.toString());
				this.decorations = this.build(view);
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
				if (
					update.docChanged ||
					update.viewportChanged ||
					reloaded ||
					treeChanged ||
					livePreview !== wasLivePreview ||
					(livePreview && update.selectionSet && !dragging)
				) {
					this.decorations = this.build(update.view);
				}
			}

			private build(view: EditorView): DecorationSet {
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
								if (!group.parts.every((part) => isLinkToken(tree, line.from + part.from + 2))) {
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

/** True when the syntax tree marks `pos` as wikilink content (excludes code, math and escaped text). */
function isLinkToken(tree: Tree, pos: number): boolean {
	const node = tree.resolveInner(pos, 1);
	return node.type.name.includes(LINK_TOKEN);
}

function overlapsSelection(selection: EditorSelection, from: number, to: number): boolean {
	return selection.ranges.some((range) => range.from <= to && range.to >= from);
}
