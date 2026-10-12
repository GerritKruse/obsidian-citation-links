# Handoff notes – branch `claude/vigilant-goodall-mkkpwv`

> **Temporary file. Delete it, together with the link to it at the top of `AGENTS.md`, when this branch is merged into `main`.** The CI job "Branch notes removed" (`.github/workflows/branch-notes.yml`) fails on every pull request into `main` while either is still there.

These notes are for the next agent working on this branch. They record what the plugin is, what this branch changed and why, what was verified (and how), and what is still open. Read them before touching the bibliography, settings or Zotero code.

Status on 2026-10-12: feature complete, 184 unit tests green, `npm run build` and `npm run lint` clean. **Not yet tested in a running Obsidian** – the repository owner is testing it by hand (checklist below). Plugin version is still 1.0.2; nothing has been released from this branch.

## 1. The plugin in brief

Citation Links (`manifest.json` id `citation-links`, desktop-only, `minAppVersion` 1.13.0) renders wikilinks such as `[[@Key]]`, `[[@Key|n p. 5]]` as APA 7 in-text citations in Live Preview and Reading mode, keeps them real vault links (literature note `@<citekey>.md`), shows a "References" sidebar view with a "Zotero" button per entry, and offers citekey autocompletion. The bibliography comes from Better BibTeX (BBT) "Better CSL JSON" auto-export files in one folder; Zotero does not need to run for rendering. README.md is the user documentation and is kept accurate – update it with every behaviour change.

Module map (`src/`):

| Module | Role |
| --- | --- |
| `main.ts` | Lifecycle only: settings load/save, wiring, commands, `applyFolder`, `applyLibraries`, `rememberNewLibraries`, `refreshViews` |
| `settings.ts` | Settings interface and the declarative settings tab (Obsidian 1.13 `getSettingDefinitions`) |
| `bibliography/libraries.ts` | **New.** Pure library-priority logic: merge, parse, reorder, labels |
| `bibliography/loader.ts` | Reads the folder's `.json` files in priority order into one `Map<citekey, CslItem>` plus `sources` and `libraries` |
| `bibliography/index.ts` | `Bibliography` class: in-memory index, folder watcher, retries for half-written files, change listeners |
| `zotero/select.ts` | Resolves `zotero://select/...` links through BBT's local JSON-RPC; link cache |
| `zotero/http.ts`, `platform/*` | Node HTTP/fs facades (Node imports are only allowed in `src/platform/`, enforced by ESLint) |
| `view/referenceList.ts` | "References" view with Zotero and note buttons |
| `parser/`, `render/`, `editor/`, `reading/`, `suggest/` | Wikilink parsing, citeproc-js formatting, Live Preview view plugin, Reading-mode post-processor, autocompletion |
| `debug.ts` | "Copy debug report" command (now also lists the libraries) |

Working rules that bit or matter here:

- `npm test` (vitest), `npm run lint` (eslint with `eslint-plugin-obsidianmd`, incl. sentence-case for UI strings), `npm run build` (tsc + esbuild). Run all three before every push; CI (`lint.yml`) runs them on Node 22 and 24.
- Tests alias `obsidian` to an empty mock (`test/mocks/obsidian.ts`). Modules that import Obsidian at runtime need `vi.mock('obsidian', …)` in the test (see `src/bibliography/index.test.ts`).
- `npm install` in a fresh container rewrites `package-lock.json` (drops `libc` fields). Do not commit that; `git checkout -- package-lock.json`.
- `CLAUDE.md` is git-ignored on purpose (the owner's local notes). Never commit one – it would block checkout on the owner's machine. Put shared agent notes in `AGENTS.md` or a linked file.
- Release: bump `manifest.json` and `versions.json`, push a tag equal to the version (no `v`); `release.yml` builds a draft release.

## 2. What this branch did

The owner asked: can the libraries be ordered in the settings, so that a citekey that exists in more than one library resolves by that order? Duplicate citekeys across Zotero libraries do occur and cannot be prevented (see §3). The agreed design: **every CSL JSON file in the folder is one library**; no Zotero connection is needed to list or order them.

Behaviour (commits `cb671d3` feature, `83f6c10` review fixes):

- Settings show a "Library priority" explanation row and a `type: 'list'` section "Libraries": one row per `.json` file present in the folder (name without `.json`, rank, item count), a toggle per row, drag-to-reorder via `onReorder`.
- When a citekey occurs in several enabled files, the **topmost enabled file wins** – for rendering, reference list and autocompletion. Within one file, the later item still wins (unchanged).
- Disabled files are **not read at all** (`loadFolder` skips them).
- Files new to the folder are appended **at the bottom, enabled**, so a new export never takes over existing citations.
- **Migration:** with no stored list, new files are ordered in *reverse plain sort*. That reproduces the old rule "the file read last in plain `Array.prototype.sort()` order wins", so upgrading changes no citation. The user then reorders once. (Plain sort = UTF-16 code units: uppercase before lowercase.)
- Stored entries for files that disappeared are kept (hidden in the UI) so a returning file gets its old place; dragging leaves them in their slots (`reorderPresent`).
- Settings persist as `settings.libraries: { file, enabled }[]`, highest priority first, parsed defensively in `main.ts` `loadSettings` via `parseLibraryPreferences`. `rememberNewLibraries` (bibliography `onChanged`) appends newly found files to the stored list so their place stays fixed.
- The loader records `sources: Map<citekey, file>`; `Bibliography.sourceOf(citekey)` exposes it.
- **Zotero button** (`pickLibraryHit` in `zotero/select.ts`): JSON-RPC still queries all Zotero libraries in parallel, but now collects *all* hits. With several hits it (1) keeps those that are the same work as the rendered CSL item (normalised DOI, else normalised title), then (2) prefers the Zotero library whose name matches the source file name (case, spaces, punctuation ignored), else (3) Zotero's own order. The link cache is keyed by citekey **and** source label, so a changed winner resolves anew and BBT auto-exports do not force fresh lookups.
- `Bibliography` load concurrency: every `setFolder`/`reload` gets a token; a superseded load cannot apply, and its caller receives the newest load's result (`startLoad`), so "Reload bibliography" no longer shows a false failure. A cancelled parse retry settles its caller instead of leaving the promise pending.
- The folder text field commits on every keystroke (verified in Obsidian's app.js, see §4); the folder is now applied after an 800 ms pause (`applyFolderSoon`) so intermediate folders are neither loaded nor remembered as libraries.
- Duplicate notice: "N duplicate citekey(s): … Across libraries, the topmost one in the settings wins." It shows at start-up and whenever the duplicate set changes.
- README: new "Libraries" section; "Keep keys unique → across all libraries" advice restored with accurate wording; Zotero button behaviour described honestly.

Tests added: `src/bibliography/libraries.test.ts`, `src/bibliography/index.test.ts` (superseded reloads, cancelled retry, real failure), priority cases in `loader.test.ts` (fixture `test/fixtures/loader/priority/`), `pickLibraryHit` and cache-per-source cases in `zotero/select.test.ts`. The two superseded-reload tests were confirmed to fail against the code before `83f6c10`.

## 3. Verified background facts

Sources: BBT source at commit `abb7507` (BBT 9.0.71, requires Zotero 8+), Zotero `main`, Obsidian 1.13.4 and 1.14.4 `app.js` (unpacked by reviewers), `node_modules/obsidian/obsidian.d.ts` 1.13.1. "Verified" means read in source; nothing here was run against a live Zotero.

Better BibTeX / Zotero:

- JSON-RPC endpoint `http://127.0.0.1:23119/better-bibtex/json-rpc`, only while Zotero runs. Zotero's local server ignores requests with an `Origin` header, hence Node HTTP instead of `requestUrl`.
- `user.groups` returns `[{ id, name }]` from `Zotero.Libraries.getAll()`: `id` is the **local** libraryID (not the groupID), personal library first (localised name, e.g. "Meine Bibliothek"), then alphabetical. No type field; RSS feeds are probably included.
- `item.export(citekeys, translator, libraryID)` looks in one library. JSON-RPC error `-32602` means "not found: <key>" **or** "duplicates found: <key>" (key twice in that library). Matching is effectively case-sensitive. The BBT JSON export item is the serialised Zotero item (`title`, `DOI`, `uri`, `select`, `citationKey`, …).
- There is no RPC to list auto-exports, so a CSL JSON file cannot be mapped to a Zotero library by asking BBT. A default Better CSL JSON export carries no library id (`custom.uri` only appears via a postscript or the pandoc filter).
- Key uniqueness: setting "Keep keys unique" (`keyScope`, default **within each library**, option *across all libraries*) applies only when BBT generates a key on the local machine, against the local database. Keys synced from group members, typed by hand, imported, or present before the setting changed are never checked. In read-only groups, native keys set by others win and BBT only keeps local shadow keys. Since BBT 9.0.21, copying an item to another library clears its key and regenerates it (with `keyScope=global` the copy gets e.g. `Smith2020a`: same work, two keys). Conclusion: **duplicates across libraries cannot be fully prevented.** BBT's only tool is "Tag duplicate citation keys" (tag `#duplicate-citation-key`, on demand).
- Code reading suggests BBT's "ignore case" option has no effect (`content/string-compare.ts`); citekeys differing only in case are distinct keys for BBT and for this plugin.
- Untested idea: a BBT postscript `if (Translator.BetterCSL) { csl.custom = Object.assign({}, csl.custom, { uri: zotero.uri }) }` would put each item's Zotero URI (with groupID) into the export; `select.ts` already turns `custom.uri` into an exact link.

Obsidian 1.13 declarative settings (runtime behaviour read in `app.js`):

- `type: 'list'` is allowed at top level (not inside a `group`). On drag, Obsidian moves the DOM row itself and then calls `onReorder(oldIndex, newIndex)` with DOM indices.
- `SettingTab.update()` re-runs `getSettingDefinitions()` and reconciles the open tab in place by key (`ctrl:<key>`); it skips the row whose control has focus, so calling it while the user types or toggles is safe. The cached definitions are what a re-opened tab renders, so call `update()` after every change to what the rows show.
- A `text` control commits (validate → `setControlValue`) on every keystroke. `getSettingDefinitions()` must not do file or network access (docs).

Fundamental limit: literature notes are named `@<citekey>.md`, so within the vault a citekey can mean only one work. If two **different** works share a key, a priority only picks which one; the other cannot be cited under that key. The clean fix is a new key in Zotero (in a library the user controls).

## 4. Manual test checklist (owner, real Obsidian)

1. Build on this branch, copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/citation-links/`, reload.
2. Settings → Citation Links → "Libraries": one row per `.json` file, initially in reverse alphabetical (plain sort) order, with item counts.
3. Drag a library with a duplicated citekey to the top: the citation and reference list switch to its entry without a restart; the rank labels update.
4. Toggle a library off: its items disappear from citations and autocompletion; on again: they return ("loading…" briefly).
5. Add a new `.json` to the folder: it appears at the bottom, enabled.
6. Type a new folder path: no stutter, no focus loss, and no junk libraries from intermediate folders afterwards.
7. Zotero button for a key that exists in two Zotero libraries: opens the copy matching the rendered entry / the file name.
8. "Copy debug report" lists the libraries.

## 5. Open items and ideas (not done)

- **Within-library duplicates:** `trySelectUrlForLibrary` treats every JSON-RPC error as not-found, including BBT's "duplicates found". The button then falls through to another library or says "not found". Give it its own status and message.
- **Zotero button tie-break depends on names:** among copies of the same work it follows the user's order only when the CSL JSON file name matches the Zotero library name. The personal library's name is localised ("My Library" vs "Meine Bibliothek"), so a file named differently loses the tie-break; `user.groups` index 0 is always the personal library and could be used. A `custom.uri` postscript would make links exact.
- `isSameWork` ignores DOIs that Zotero keeps in `extra` and titles stored as `caseName`/`nameOfAct`/`subject`; it then falls back to all hits.
- Duplicate reporting: the notice shows at most five keys, names no files and does not separate benign duplicates (same work in two libraries) from real conflicts (two works, one key). Discussed idea: classify by DOI, else title + year + first author, list everything in a command/modal and the debug report, and notify only for conflicts.
- Discussed, not built: a per-key pin in the literature note's frontmatter (e.g. a Zotero URI) for real conflicts in read-only groups; a library list fetched from `user.groups` (rejected: needs Zotero running, local IDs, feeds, and without `custom.uri` it cannot steer rendering); a library-qualified citekey syntax (rejected: Pandoc/Word do not know it).
- Stored entries for vanished files are never pruned (harmless; changing the folder leaves the old folder's entries behind).
- Item counts count raw entries, including a citekey repeated within one file.
- Every uncached lookup sends one `item.export` per Zotero library, feeds included.
- Before releasing: bump the version (`manifest.json`, `versions.json`, `minAppVersion` stays 1.13.0), and **delete this file and its link in `AGENTS.md`**.
