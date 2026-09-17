import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { MarkdownView, editorLivePreviewField, type App } from 'obsidian';
import type { Bibliography } from './bibliography';
import { groupDocumentRange } from './parser';

/**
 * Plain-text diagnostics for bug reports: bibliography state plus, for the
 * active note, what the editor and the parser see. Read-only.
 */
export function buildDebugReport(app: App, bibliography: Bibliography, folder: string, pluginVersion: string): string {
	const lines: string[] = [];
	lines.push(`Citation Links ${pluginVersion}`);
	lines.push(`folder: ${folder || '(not set)'}`);
	lines.push(`bibliography: ready=${String(bibliography.ready)} items=${bibliography.size} version=${bibliography.version}`);

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (view === null) {
		lines.push('active markdown view: none');
		return lines.join('\n');
	}
	lines.push(`file: ${view.file?.path ?? '(none)'} mode=${view.getMode()}`);

	const text = view.editor.getValue();
	const lineCount = text.split('\n').length;
	const groups = groupDocumentRange(text, 0, lineCount - 1);
	lines.push(`citation groups in note: ${groups.length}`);

	// `editor.cm` is not part of the public API; report whether it is there.
	const cm = (view.editor as unknown as { cm?: EditorView }).cm;
	lines.push(`editor.cm: ${cm === undefined ? 'missing' : 'present'}`);
	if (cm === undefined) {
		return lines.join('\n');
	}
	lines.push(`live preview field: ${String(cm.state.field(editorLivePreviewField, false))}`);
	lines.push(`visible ranges: ${cm.visibleRanges.map((range) => `${range.from}-${range.to}`).join(', ') || '(none)'}`);
	const first = groups[0];
	if (first !== undefined) {
		const line = cm.state.doc.line(first.line + 1);
		const pos = line.from + first.group.from + 2;
		const node = syntaxTree(cm.state).resolveInner(pos, 1);
		lines.push(`first link token: "${node.type.name}" at ${pos}`);
	}
	lines.push(`rendered citations in editor DOM: ${cm.contentDOM.querySelectorAll('.citation-links-cite').length}`);
	return lines.join('\n');
}
