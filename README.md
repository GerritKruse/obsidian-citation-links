# Citation Links

Citation Links renders Obsidian wikilinks to Better BibTeX citekeys as formatted APA 7 in-text citations, in Live Preview and in Reading mode, while keeping them real vault links: clicking a citation still opens its literature note, and graph view and backlinks still work.

Before:

```
[[@GartenbergEtAl2026]] found that [[@MiricEtAl2023|n]] had already suggested as much.
```

After (as rendered in the note):

> (Gartenberg et al., 2026) found that Miric et al. (2023) had already suggested as much.

Citation Links is desktop-only and reads its bibliography from CSL JSON files that Zotero and Better BibTeX write to a folder on disk – Zotero does not need to be running for citations to render.

## Requirements

- Obsidian 1.13.0 or later, desktop only (the plugin is not available on mobile)
- Zotero with the Better BibTeX add-on, to export the bibliography and (optionally) to resolve the "Zotero" button

## Setup

### 1. Auto-export the bibliography from Zotero

In Zotero, right-click a library or collection and choose "Export Library…" (or "Export Collection…"), then:

1. Set the format to "Better CSL JSON".
2. Check "Keep updated".
3. Save the export into a folder, for example `~/Zotero/csl-json`.

Repeat this for every library you cite from, including group libraries – Better BibTeX rewrites the file whenever the library changes, so the export stays current without any manual step. If you export more than one library, set Better BibTeX's citation-key uniqueness (Better BibTeX settings → Citation Keys) to "across all libraries" so the same key is never reused between them.

### 2. Point the plugin at the folder

In Obsidian, open Settings → Citation Links and set "CSL JSON folder" to the absolute path of that folder (`~` is expanded to your home directory). Every `.json` file in the folder is merged into one in-memory bibliography; the folder is watched, and changes are picked up automatically after a short debounce. If the same citekey appears in more than one file, Citation Links shows a one-time notice and keeps the entry from whichever file sorts last alphabetically.

Use the "Reload bibliography" command to force an immediate reload, for example right after changing the setting.

If citations do not render as expected, run the "Copy debug report" command: it copies a short plain-text report (bibliography state, active note, editor state) to the clipboard and shows it as a notice.

### 3. Optional: enable the Zotero button offline and for group libraries

The reference list's "Zotero" button normally needs Zotero running with Better BibTeX to resolve the exact item. To make it work offline, and for items in group libraries, add this postscript in Zotero under Settings → Better BibTeX → Export → Postscript:

```js
if (Translator.BetterCSL) { reference.custom = { uri: item.uri }; }
```

This embeds the item's URI directly in the CSL JSON export, so the button no longer needs a live connection to Zotero.

## Syntax

The locale is fixed to English (US) and the style to APA 7th edition. A citation is any wikilink whose target's last path segment starts with `@`:

| Source | Rendered |
| --- | --- |
| `[[@GartenbergEtAl2026]]` | (Gartenberg et al., 2026) |
| `[[@GartenbergEtAl2026\|n]]` | Gartenberg et al. (2026) |
| `[[@GartenbergEtAl2026\|y]]` | (2026) |
| `[[@GartenbergEtAl2026\|p. 797]]` | (Gartenberg et al., 2026, p. 797) |
| `[[@GartenbergEtAl2026\|pp. 797-799]]` | (Gartenberg et al., 2026, pp. 797–799) |
| `[[@GartenbergEtAl2026\|n p. 797]]` | Gartenberg et al. (2026, p. 797) |
| `[[@GartenbergEtAl2026\|ch. 3]]` | (Gartenberg et al., 2026, Chapter 3) |
| `[[@GartenbergEtAl2026\|sec. 2.1]]` | (Gartenberg et al., 2026, Section 2.1) |
| `[[@GartenbergEtAl2026\|S. 12]]` | (Gartenberg et al., 2026, p. 12) |
| `[[@GartenbergEtAl2026\|siehe dort]]` | a normal link with the text "siehe dort" |
| `[[20 - Literature/@GartenbergEtAl2026.md\|p. 796]]` | folder paths and a trailing `.md` are both fine |
| `[[@GartenbergEtAl2026#Konzepte]]` | an ordinary link (links with a `#` or `^` anchor are never citations) |

A page range (`pp. 797-799`) is rendered with an en dash, as APA requires. `S.` is accepted as a German synonym for `p.`. An alias that does not match the modifier grammar (`siehe dort` above) is left alone and the link renders as Obsidian normally renders it.

The full modifier grammar is `[form] [locator]`, where `form` is `n` (narrative) or `y` (year only), and `locator` is one of `p.`, `pp.`, `S.`, `ch.`, `sec.` followed by free text. Citation Links always supplies the parentheses itself – do not type `(` and `)` around a citation link.

## Grouping

Citation links separated by exactly `; ` on a single line are combined into one parenthetical citation, in the order they were written, with each part still individually clickable:

```
[[@MiricEtAl2023]]; [[@GartenbergEtAl2026]]
```

renders as (Miric et al., 2023; Gartenberg et al., 2026). A narrative-form citation (`|n`) is never grouped – it always stands on its own, and it breaks a chain of otherwise-adjacent citations.

## Unknown citekeys

A citekey that is not in the loaded bibliography renders as `(@Citekey)` with a red dotted underline and the tooltip "Not in bibliography".

## Literature notes

A citation link stays a normal Obsidian link to a note named `@<Citekey>.md`. Clicking a citation whose note does not exist yet creates an empty note with that name in the vault root and opens it, so you can start taking notes on the source immediately.

## Reference list

The "References" view in the right sidebar is opened automatically while the "Reference list" setting is on (default); turning it off closes the view. The quote icon in the left ribbon and the "Show reference list" command open it on demand. It lists every work cited in the active note as an APA 7 bibliography, sorted alphabetically, and updates as you switch notes or edit citations. Each entry has a "Zotero" button and an "Open note" (or "Create note") button; there are no PDF links and no copy button. The Zotero button selects the exact item in whichever library it lives in (personal or group); it is disabled, with a tooltip, when the citekey is not known to Zotero, and it tells you when Zotero is not running.

## Autocomplete

Typing `@` – optionally right after `[[` – suggests citekeys from the bibliography, matching by citekey prefix first and then by citekey, author, or title substring. Selecting a suggestion inserts a complete `[[@Citekey]]` link. If Obsidian's own file suggester pops up instead of the citekey list, type `@` without brackets. The suggestions can be switched off with the "Citekey autocompletion" toggle in the plugin settings.

## How it works and privacy

Citation Links parses CSL JSON files from the folder you configure and formats them with citeproc-js and a bundled APA 7 CSL style, entirely in memory – nothing is written back to that folder, and the parsed bibliography is never persisted anywhere else. The only network access the plugin makes is to `http://127.0.0.1:23119/better-bibtex/json-rpc`, Better BibTeX's local JSON-RPC endpoint, and only for the "Zotero" buttons of the reference list: it calls `user.groups` and `item.export` to resolve the exact `zotero://select/...` link of each listed item (personal and group libraries alike), with a 5-second timeout. The requests are sent with Node's HTTP client because Zotero's local server ignores browser-style requests that carry an `Origin` header. If Zotero is not running, the button shows a notice instead of guessing a link. This request never leaves your machine, and the plugin sends no telemetry.

Because the configured CSL JSON folder is typically outside your vault, Citation Links reads files outside the vault – this is required for it to work and is disclosed here per Obsidian's developer policy.

## Appearance

Citations intentionally do not look like ordinary wikilinks: no link colour and no underline, so the eye reads them as citations rather than as an invitation to click – even though the link is still there underneath and still works exactly as before. On hover, a part gains a subtle dotted underline so it stays discoverable as a link.

The look is controlled by CSS custom properties, set on `body` in `styles.css`:

```css
body {
	--citation-links-color: var(--text-normal);
	--citation-links-font-family: inherit;
	--citation-links-font-size: inherit;
	--citation-links-font-variant: normal;
	--citation-links-hover-decoration: underline dotted;
}
```

To restyle citations without touching the plugin, add a CSS snippet (Settings → Appearance → CSS snippets → open snippets folder, then enable it) that overrides one or more of these variables. A few ready-to-paste options:

Muted, slightly dimmer than the surrounding text:

```css
body {
	--citation-links-color: var(--text-muted);
}
```

Small caps, to set citations apart typographically:

```css
body {
	--citation-links-font-variant: small-caps;
}
```

Monospace, for a reference-like look:

```css
body {
	--citation-links-font-family: var(--font-monospace);
	--citation-links-font-size: 0.9em;
}
```

The dotted underline on hover can be switched off entirely with:

```css
body {
	--citation-links-hover-decoration: none;
}
```

## Limitations

- In Live Preview, Obsidian renders tables as a separate widget, so citations inside table cells show the raw link there (Reading mode renders them correctly).
- Citations are not rendered inside frontmatter properties.
- No Pandoc `[@key]` syntax – only wikilinks.
- No export of citations or bibliographies.
- APA 7th edition only, en-US locale only.
- Disambiguation (2026a, 2026b, …) is computed per note, not vault-wide.

## Development

```
npm install
npm run dev     # esbuild in watch mode
npm test        # vitest
npm run lint    # eslint
npm run build   # type-check and production build
```

To try the plugin in a vault, symlink this repository into `<vault>/.obsidian/plugins/citation-links/`. Combined with the community plugin [hot-reload](https://github.com/pjeby/hot-reload), Obsidian picks up a rebuilt `main.js` automatically.

To cut a release, bump `version` in `manifest.json` and `versions.json` and push a git tag equal to the version (no `v` prefix). The release workflow builds the plugin and attaches `main.js`, `manifest.json`, and `styles.css` to a draft GitHub release.

## License

Citation Links is released under the MIT license, see [LICENSE](LICENSE). It bundles citeproc-js and CSL style/locale files under their own licenses – see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
