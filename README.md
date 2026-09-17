# Citation Links

Citation Links renders Obsidian wikilinks to Better BibTeX citekeys as formatted APA 7 in-text citations, in both Live Preview and Reading mode, while keeping them real vault links: clicking a citation still opens its literature note, and graph view and backlinks still work.

Before:

```
[[@GartenbergEtAl2026]] found that [[@MiricEtAl2023|n]] had already suggested as much.
```

After (as rendered in the note):

> (Gartenberg et al., 2026) found that Miric et al. (2023) had already suggested as much.

Citation Links is desktop-only and reads its bibliography from CSL JSON files that Zotero and Better BibTeX write to a folder on disk – Zotero does not need to be running for citations to render.

## Installation

### Requirements

- Obsidian 1.13.0 or later, desktop only (the plugin is not available on mobile).
- Zotero with the Better BibTeX add-on, to export the bibliography and (optionally) to resolve the "Zotero" button.

### 1. Install the plugin

Citation Links is not yet in Obsidian's community plugin directory. Install it one of two ways:

- **From a GitHub release**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/GerritKruse/obsidian-citation-links/releases) into a new folder `<vault>/.obsidian/plugins/citation-links/`, then enable "Citation Links" under Settings → Community plugins.
- **With [BRAT](https://github.com/TfTHacker/obsidian42-brat)**: add the repository `https://github.com/GerritKruse/obsidian-citation-links` as a beta plugin.

### 2. Auto-export your bibliography from Zotero

In Zotero, right-click a library and choose "Export Library…", then:

1. Set the format to "Better CSL JSON".
2. Check "Keep updated".
3. Save the export into a folder, for example `~/Zotero/csl-json/`.

Repeat this for every library you cite from – your personal library and each group library – saving all of them into that same folder. Better BibTeX rewrites each file whenever the corresponding library changes, so the exports stay current without any manual step.

If you export more than one library, open Zotero Settings → Better BibTeX → Citation Keys and set the key uniqueness to "across all libraries", so the same citekey is never reused between them.

### 3. Point the plugin at the folder

In Obsidian, open Settings → Citation Links and set "CSL JSON folder" to the path of that folder (`~` is expanded to your home directory). Every `.json` file in the folder is merged into one in-memory bibliography, the folder is watched for changes, and the "Reload bibliography" command forces an immediate reload – its notice reports how many items were loaded from how many files, which is a good first check if something looks off.

### Other settings

- **Citekey autocompletion** – on by default; see [Autocomplete](#autocomplete).
- **Reference list** – on by default; keeps the "References" view open in the right sidebar. Turning it off closes the view again; see [Reference list](#reference-list).

## Citation syntax

A wikilink is a citation when the last `/`-separated segment of its target starts with `@`; everything after the `@` is the Better BibTeX citekey. A folder path before it and a trailing `.md` are both fine and are not part of the citekey.

### Recognised

| Wikilink | Recognised as |
| --- | --- |
| `[[@GartenbergEtAl2026]]` | citation, citekey `GartenbergEtAl2026` |
| `[[20 - Literature/@GartenbergEtAl2026]]` | citation; the folder path is ignored |
| `[[20 - Literature/@GartenbergEtAl2026.md\|p. 796]]` | citation with a locator modifier; folder path and `.md` are both fine |

### Not recognised (rendered as ordinary links, or left alone)

| Wikilink | Why |
| --- | --- |
| `[[Notizen zu @Kram]]` | `@` is not at the start of the last segment |
| `[[AI Text Detection]]` | no `@` in the target at all |
| `[[@GartenbergEtAl2026#Konzepte]]`, `[[@Key^block]]` | anchored to a heading (`#`) or a block (`^`) – these point inside a note, not at the note itself |
| `![[@GartenbergEtAl2026]]` | embeds are never treated as citations |
| `[[@GartenbergEtAl2026\|siehe dort]]` | the alias does not match the modifier grammar below, so it renders as an ordinary link with the text "siehe dort" |
| a link inside inline code or a fenced code block | code is never scanned |
| a link inside a frontmatter property | frontmatter is never scanned |
| `@GartenbergEtAl2026` (no brackets) | plain text, not a link at all |

### Modifiers

The modifier is the text after `|`. It sets the citation's form and, optionally, a locator.

| After `\|` | Renders as |
| --- | --- |
| *(none)* | (Gartenberg et al., 2026) |
| `n` | Gartenberg et al. (2026) |
| `y` | (2026) |
| `p. 797` | (Gartenberg et al., 2026, p. 797) |
| `pp. 797-799` | (Gartenberg et al., 2026, pp. 797–799) |
| `S. 12` | (Gartenberg et al., 2026, p. 12) |
| `ch. 3` | (Gartenberg et al., 2026, Chapter 3) |
| `sec. 2.1` | (Gartenberg et al., 2026, Section 2.1) |
| `n p. 797` | Gartenberg et al. (2026, p. 797) |
| `y p. 5` | (2026, p. 5) |

A hyphenated page range (`pp. 797-799`) is rendered with an en dash, as APA style requires. `S.` is accepted as a German synonym for `p.`.

The full grammar is `[n|y] [p.|pp.|S.|ch.|sec. <text>]`: the form and the locator are separated by whitespace, and the locator's label and its text are separated by whitespace in turn – `p.797`, with no space, is not a modifier and falls through to an ordinary alias. An empty alias (`[[@Key|]]`) is equivalent to no alias at all. Citation Links always supplies the parentheses itself – never type `(` and `)` around a citation link.

### Grouping

Citation links separated by exactly `; ` on a single line are combined into one parenthetical citation, in the order they were written:

```
[[@MiricEtAl2023]]; [[@GartenbergEtAl2026]]
```

renders as (Miric et al., 2023; Gartenberg et al., 2026), with each part still individually clickable. A narrative-form citation (`n`) is never grouped – it always stands on its own and breaks a chain of otherwise-adjacent citations. A plain space instead of `; `, a semicolon with no following space, or any other text between two links keeps them in separate groups; grouping never reaches across lines.

### Unknown citekeys

A citekey that is not in the loaded bibliography renders as `(@TippFehler2026)` in red with a dotted underline, with the tooltip "Not in bibliography".

### Style

The citation style is fixed to APA 7th edition with the English (US) locale. Disambiguating year suffixes (2026a, 2026b, …) are computed per note, not vault-wide.

## Working with citations

- Clicking a citation opens its literature note, `@<citekey>.md`.
- If that note does not exist yet, Citation Links creates an empty one in the vault root and opens it.
- Hovering a citation shows Obsidian's normal page preview, exactly as for any other link.
- Citations are ordinary links underneath: graph view and backlinks are unaffected.
- In Live Preview, placing the cursor inside a citation reveals its raw wikilink text; the formatted citation returns once the cursor moves away.
- Reading mode renders citations identically to Live Preview.

## Reference list

The "References" view in the right sidebar lists every work cited in the active note as an alphabetical APA 7 reference list, and updates as you switch notes or edit citations. Each entry has two buttons:

- **Zotero** – opens the exact item in Zotero, in whichever library it lives in (your personal library or a group library). This needs Zotero running with the Better BibTeX add-on; if it is not reachable, the button shows a notice instead of a link. If the citekey is not known to any Zotero library, the button is disabled, with a tooltip saying so.
- **Open note** / **Create note** – opens the literature note, creating it first if it does not exist yet.

Open the view with the quote icon in the left ribbon, the "Show reference list" command, or the "Reference list" setting, which keeps it open across restarts (default on).

## Autocomplete

Typing `@` – optionally right after `[[` – suggests citekeys from the bibliography: citekey-prefix matches first, then substring matches against citekey, author, and title. Selecting a suggestion (or pressing Enter) inserts a complete `[[@Citekey]]` link.

Because `[[` also triggers Obsidian's own file suggester, that one may appear first; if so, keep typing or dismiss it and the citekey suggestions take over. The suggestions can be switched off with the "Citekey autocompletion" toggle in the plugin settings.

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

## How it works and privacy

Citation Links parses CSL JSON files from the folder you configure and formats them with citeproc-js and a bundled APA 7 CSL style, entirely in memory – nothing is written back to that folder, and the parsed bibliography is never persisted anywhere else. Because that folder is typically outside your vault, Citation Links reads files outside the vault; this is required for it to work and is disclosed here per Obsidian's developer policy.

The only network access the plugin makes is to `http://127.0.0.1:23119/better-bibtex/json-rpc`, Better BibTeX's local JSON-RPC endpoint, and only for the "Zotero" buttons of the reference list: it calls `user.groups` and `item.export` to resolve the exact `zotero://select/...` link of each listed item (personal and group libraries alike), with a 5-second timeout. The requests are sent with Node's HTTP client because Zotero's local server ignores browser-style requests that carry an `Origin` header. If Zotero is not running, the button shows a notice instead of guessing a link. This request never leaves your machine, and the plugin sends no telemetry.

## Limitations

- In Live Preview, Obsidian renders tables and callouts as separate widgets, so citations inside a table cell or a callout show the raw link there instead of the formatted citation (Reading mode renders them correctly).
- Citations are not rendered inside frontmatter properties.
- No Pandoc `[@key]` syntax – only wikilinks.
- No export of citations or bibliographies.
- APA 7th edition only, English (US) locale only.

## Troubleshooting

Run the "Copy debug report" command to copy a short plain-text report (bibliography state, active note, editor state) to the clipboard; it also shows as a notice. It has no default hotkey, so assign one yourself, or enable the "Command palette" core plugin to run it by name.

If the bibliography itself looks wrong, use the "Reload bibliography" command and check its notice: it reports how many items were loaded from how many files, which usually shows right away whether the configured folder or the Zotero exports are the problem.

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
