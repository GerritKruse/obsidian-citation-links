# Handoff notes – branch `claude/vigilant-goodall-mkkpwv`

> **Temporary file. Delete it, together with the link to it at the top of `AGENTS.md`, when this branch is merged into `main`.** See §6 for how the merge guard works and what it does not catch.

These notes are for the next agent working on this branch. They record what the plugin is, what this branch changed and why, what was verified (and how), what is pending with the owner, and what is still open. Read them before touching the bibliography, settings or Zotero code.

Status on 2026-10-12: feature complete, 184 unit tests green, `npm run build` and `npm run lint` clean. **Not yet tested in a running Obsidian** – the owner (Gerrit Kruse) is testing it by hand (checklist in §4). Plugin version is still 1.0.2; nothing has been released from this branch.

## 0. Working with the owner

- He writes German; answer in German. He asked explicitly for short, concrete answers ("als hätte ich ADHD … viel zu viel Text"): a few bullet points, no long write-ups.
- Organisation rules: always the en dash "–", never the em dash, in chat and in files; no typical AI phrasing; scientific rigour first.
- Pending with him: (1) He was asked which Better BibTeX version he runs and has not answered; his BBT, Zotero and Obsidian versions are unknown, and §3 is based on BBT 9.0.71 (Zotero 8+). (2) It was suggested he run "Tag duplicate citation keys" in Zotero and try the `custom.uri` postscript (§3); results unknown. (3) His manual test of this branch (§4).
- His local `CLAUDE.md` is git-ignored and does not point to this file. If local agents should see these notes, he has to add a line such as `@HANDOFF.md` to it himself.

## 1. The plugin in brief

Citation Links (`manifest.json` id `citation-links`, desktop-only, `minAppVersion` 1.13.0) renders wikilinks such as `[[@Key]]`, `[[@Key|n p. 5]]` as APA 7 in-text citations in Live Preview and Reading mode, keeps them real vault links (literature note `@<citekey>.md`), shows a "References" sidebar view with a "Zotero" button per entry, and offers citekey autocompletion. The bibliography comes from Better BibTeX (BBT) "Better CSL JSON" auto-export files in one folder; Zotero does not need to run for rendering. README.md is the user documentation and is kept accurate – update it with every behaviour change.

Module map (`src/`):

| Module | Role |
| --- | --- |
| `main.ts` | Lifecycle only: settings load/save, wiring, commands, `applyFolder`, `applyLibraries`, `rememberNewLibraries`, `refreshViews` |
| `settings.ts` | Settings interface and the declarative settings tab (Obsidian 1.13 `getSettingDefinitions`) |
| `bibliography/libraries.ts` | **New.** Pure library-priority logic: merge, parse, reorder, labels |
| `bibliography/loader.ts` | Reads the folder's `.json` files in priority order into one `Map<citekey, CslItem>` plus `sources` and `libraries` |
| `bibliography/index.ts` | `Bibliography` class: in-memory index, load tokens, retries for half-written files, change listeners; 500 ms debounce on watcher events |
| `bibliography/watcher.ts` | `fs.watch` wrapper for the folder (restarts after errors) |
| `zotero/select.ts` | Resolves `zotero://select/...` links through BBT's local JSON-RPC; link cache |
| `zotero/http.ts`, `platform/*` | Node HTTP/fs/os/path facades |
| `view/referenceList.ts` | "References" view with Zotero and note buttons |
| `notes.ts` | Opens or creates the literature note `@<citekey>.md` |
| `context.ts`, `types.ts`, `assets.ts` | Shared context object, CSL types, bundled APA style and locale |
| `parser/`, `render/`, `editor/`, `reading/`, `suggest/` | Wikilink parsing, citeproc-js formatting, Live Preview view plugin, Reading-mode post-processor, autocompletion |
| `debug.ts` | "Copy debug report" command (now also lists the libraries) |

Working rules:

- Node **≥ 22.12** (vitest 5); `AGENTS.md` still says 18+, which is outdated. Use `npm ci`. Plain `npm install` in a fresh container rewrites `package-lock.json` (drops `libc` fields) – do not commit that (`git checkout -- package-lock.json`).
- `npm test` (vitest), `npm run lint` (eslint with `eslint-plugin-obsidianmd`, incl. sentence case for UI strings), `npm run build` (tsc + esbuild). Run all three before every push; CI (`lint.yml`) runs them on Node 22 and 24.
- Keep Node imports in `src/platform/`. ESLint only rejects `node:`-prefixed imports elsewhere; a bare `'fs'` import would slip through, so this is partly convention.
- Tests alias `obsidian` to an empty mock (`test/mocks/obsidian.ts`). Modules that import Obsidian at runtime need `vi.mock('obsidian', …)` in the test (see `src/bibliography/index.test.ts`). `settings.ts`, `main.ts` and `view/referenceList.ts` have no unit tests; only the manual test covers them.
- `CLAUDE.md` is git-ignored on purpose (the owner's local notes). Never commit one: checkout and pull would silently overwrite his local file, and switching back to a branch without it would delete it. Put shared agent notes in `AGENTS.md` or a file linked from it.
- Release, as done for 1.0.2: `npm version <x.y.z> --no-git-tag-version` bumps `package.json` and `package-lock.json` and runs `version-bump.mjs` (`manifest.json`, `versions.json`); check the lockfile diff (see above). Then commit "Release X.Y.Z" with a short body and create the annotated tag `git tag -a X.Y.Z -m "Citation Links X.Y.Z"` (no `v`). Pushing the tag makes `release.yml` build a **draft** release, which has to be published by hand. `minAppVersion` stays 1.13.0.

## 2. What this branch did

The owner asked whether the libraries can be ordered in the settings, so that a citekey that exists in more than one library resolves by that order. Duplicate citekeys across Zotero libraries do occur and cannot be prevented (see §3). The agreed design: **every CSL JSON file in the folder is one library**; no Zotero connection is needed to list or order them.

Behaviour (commits `cb671d3` feature, `83f6c10` review fixes, `1604518` these notes):

- Settings show a "Library priority" explanation row and a `type: 'list'` section "Libraries": one row per `.json` file present in the folder (name without `.json`, rank, item count), a toggle per row, reorder via `onReorder`.
- When a citekey occurs in several enabled files, the **topmost enabled file wins** – for rendering, reference list and autocompletion. Within one file, the later item still wins (unchanged).
- Disabled files are **not read at all** (`loadFolder` skips them).
- Files new to the folder are appended **at the bottom, enabled**, so a new export never takes over existing citations.
- **Migration:** with no stored list, new files are ordered in *reverse plain sort*. That reproduces the old rule "the file read last in plain `Array.prototype.sort()` order wins", so upgrading changes no citation. The user then reorders once. Plain sort means UTF-16 code units, so uppercase comes before lowercase.
- Stored entries for files that disappeared are kept (hidden in the UI) so a returning file gets its old place; reordering leaves them in their slots (`reorderPresent`). Entries are matched by **file name only**, not by folder (see §5).
- Settings persist as `settings.libraries: { file, enabled }[]` in `data.json`, highest priority first, parsed defensively in `main.ts` `loadSettings` via `parseLibraryPreferences`. `rememberNewLibraries` (bibliography `onChanged`) appends newly found files to the stored list so their place stays fixed.
- The settings rows are built from the stored order (`librariesForEditing`), with item counts from the last load, and `update()` is called right after each change. Keep that `update()` in `reorderLibraries`: keyboard reordering (Alt+↑/↓) calls `onReorder` without moving the DOM row.
- The loader records `sources: Map<citekey, file>`; `Bibliography.sourceOf(citekey)` exposes it.
- **Zotero button** (`pickLibraryHit` in `zotero/select.ts`): JSON-RPC still queries all Zotero libraries in parallel, but now collects *all* hits. With several hits it (1) keeps those that are the same work as the rendered CSL item (normalised DOI, else normalised title), then (2) prefers the Zotero library whose name matches the source file name (case, spaces and punctuation ignored), else (3) takes the first in `user.groups` order (personal library first).
- Link cache: a `Map` keyed by citekey that also stores the source label of the resolution; a lookup with a different label misses and resolves anew. So a changed winning file re-resolves, and a BBT auto-export no longer forces a fresh lookup. The cache is never cleared at runtime (see §5).
- `Bibliography` load concurrency: every `setFolder`/`reload` gets a token; a superseded load cannot apply, and its caller receives the newest load's result (`startLoad`), so "Reload bibliography" no longer shows a false failure. A cancelled parse retry settles its caller instead of leaving the promise pending.
- The folder text field commits on every keystroke that passes validation (§3). The folder is now applied after an 800 ms pause (`applyFolderSoon`). That makes it unlikely that intermediate folders get loaded and remembered as libraries, but it does not rule it out (§5).
- Duplicate notice: "N duplicate citekey(s): … Across libraries, the topmost one in the settings wins." It shows at start-up and whenever the duplicate set changes.
- README: new "Libraries" section; "Keep keys unique → across all libraries" advice restored with accurate wording; Zotero button behaviour described honestly.

Tests added: `src/bibliography/libraries.test.ts`, `src/bibliography/index.test.ts` (superseded reloads, cancelled retry, real failure), priority cases in `loader.test.ts` (fixture `test/fixtures/loader/priority/`), `pickLibraryHit` and cache-per-source cases in `zotero/select.test.ts`. The two superseded-reload tests were confirmed to fail against the code before `83f6c10`.

## 3. Verified background facts

"Verified" means read in source code; nothing was run against a live Zotero, and Obsidian only through its source. The sources are not kept in the repository:

- BBT at commit `abb7507` (version 9.0.71, requires Zotero 8+): `git clone https://github.com/retorquere/zotero-better-bibtex` and check out `abb7507`.
- Zotero `main` from `github.com/zotero/zotero`.
- Obsidian 1.13.4 and 1.14.4 `app.js`: download the `.asar` from the `obsidianmd/obsidian-releases` GitHub releases and unpack it.
- `node_modules/obsidian/obsidian.d.ts` 1.13.1.

Better BibTeX / Zotero:

- JSON-RPC endpoint `http://127.0.0.1:23119/better-bibtex/json-rpc`, only while Zotero runs. Zotero's server rejects browser-like requests (an `Origin` header or a `User-Agent` starting with `Mozilla/`) unless they carry `Zotero-Allowed-Request` or `X-Zotero-Connector-API-Version`. The plugin uses Node HTTP, which sends neither. Why Obsidian's `requestUrl` failed was never pinned down, and whether it would work with `Zotero-Allowed-Request` is untested. The comment in `src/zotero/http.ts` names only the `Origin` header.
- `user.groups` returns `[{ id, name, collections }]` (`collections` is null unless requested) from `Zotero.Libraries.getAll()`. `id` is the **local** libraryID, not the groupID. The personal library comes first (localised name, e.g. "Meine Bibliothek"), then groups **and RSS feeds** mixed, in alphabetical order. There is no type field.
- `item.export(citekeys, translator, libraryID)` looks in one library. Error `-32602` carries "not found: <key>" and/or "duplicates found: <key>" (key twice in that library; both lines can appear at once), and is also used for argument-validation errors. An unknown library gives `-32603` ("could not find library"). Key matching is effectively case-sensitive. The exported item is the serialised Zotero item (`title`, `DOI`, `uri`, `select`, `citationKey`, …).
- No RPC lists the auto-exports, so BBT cannot be asked which CSL JSON file belongs to which Zotero library. A default Better CSL JSON export carries no library id; `custom.uri` only appears via a postscript or the pandoc filter.
- Key uniqueness: the setting "Keep keys unique" (`keyScope`, default **within each library**, option *across all libraries*) only applies when BBT generates a key on the local machine, checked against the local database. Keys synced from group members, typed by hand, imported, or present before the setting changed are never checked. In read-only groups, native keys set by others win and BBT only keeps local shadow keys. Since BBT 9.0.21, copying an item to another library clears its key and regenerates it; with `keyScope=global` the copy gets e.g. `Smith2020a` (same work, two keys). Conclusion: **duplicates across libraries cannot be fully prevented.**
- "Tag duplicate citation keys" (tag `#duplicate-citation-key`, runs on demand) checks only one library from its context menu under the default `keyScope=library`. It is in the Tools menu and checks all libraries only with `keyScope=global`. Under the defaults, BBT therefore has no tool for cross-library duplicates.
- Code reading suggests BBT's "ignore case" option has no effect (`content/string-compare.ts`); citekeys that differ only in case are distinct keys for BBT and for this plugin.
- Untested idea: the BBT postscript `if (Translator.BetterCSL) { csl.custom = Object.assign({}, csl.custom, { uri: zotero.uri }) }` would put each item's Zotero URI (with groupID) into the export. `select.ts` already turns `custom.uri` into an exact link.

Obsidian 1.13 declarative settings (runtime behaviour read in `app.js`, identical in 1.14.4):

- `type: 'list'` is allowed at top level, not inside a `group`. On mouse or touch drag, Obsidian moves the DOM row itself and then calls `onReorder(oldIndex, newIndex)` with DOM indices. Alt+↑/↓ on a focused row also calls `onReorder` but does not move the DOM.
- `SettingTab.update()` re-runs `getSettingDefinitions()` and caches the result; a re-opened tab renders that cache. If the tab is the active one, it also reconciles the DOM in place by key: rows with a control by `ctrl:<key>`, other rows by `name:<name>`, lists by `list:<heading>`. Renaming the explanation row or the "Libraries" heading therefore makes Obsidian rebuild them instead of reconciling them.
- A row whose control holds focus is skipped entirely, name and description included. Typing stays safe. Side effect: after clicking a library toggle, that row's own description ("off, not loaded", "loading…") probably stays stale until focus leaves the row and another `update()` runs. This is inferred from the code, not observed.
- A `text` control runs `validate` on every keystroke and calls `setControlValue` when validation passes. For the folder field, that means every existing directory, e.g. `~`. An empty value is never stored. `getSettingDefinitions()` must not do file or network access (docs).

Fundamental limit: literature notes are named `@<citekey>.md`, so within the vault a citekey can mean only one work. If two **different** works share a key, a priority only picks which one; the other cannot be cited under that key. The clean fix is a new key in Zotero, in a library the user controls.

## 4. Manual test checklist (owner, real Obsidian)

1. Build on this branch, copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/citation-links/`, reload.
2. Before reordering anything: every citation resolves exactly as it did on 1.0.2.
3. Settings → Citation Links → "Libraries": one row per `.json` file, initially in reverse alphabetical (plain sort) order, with item counts.
4. Drag a library with a duplicated citekey to the top (also try Alt+↑/↓): the citation and reference list switch to its entry without a restart; the rank labels update.
5. Toggle a library off and on: its items disappear from and return to citations and autocompletion. The toggled row's own description may lag (§3) – cosmetic.
6. Restart Obsidian: order and toggles are kept (`libraries` in `data.json`).
7. Add a new `.json` to the folder: it appears at the bottom, enabled.
8. Type a new folder path: no stutter, no focus loss, no junk libraries afterwards (a long pause on an intermediate folder can still add some, §5).
9. "Reload bibliography" reports items and files, with no false "could not be loaded" notice.
10. Zotero button for a key that exists in two Zotero libraries opens the copy matching the rendered entry or the file name.
11. "Copy debug report" lists the libraries.

## 5. Open items and ideas (not done)

- **Within-library duplicates:** `trySelectUrlForLibrary` treats every JSON-RPC error as not-found, including BBT's "duplicates found". The button then falls through to another library or says "not found". Give it its own status and message.
- **Zotero button tie-break depends on names:** among copies of the same work, it follows the user's order only when the file name matches the Zotero library name. The fallback is `user.groups` order, personal library first. So the gap is a group export whose file name does not match the group's Zotero name while an earlier library (often the personal one) holds the same work: that earlier copy opens. A `custom.uri` postscript would make links exact.
- **Link cache is never cleared at runtime** (`clearZoteroLinkCache` is only called by tests). If the winning item changes within the same file, or an item is moved or deleted in Zotero, the old link is served until the plugin reloads. This was already the case before this branch.
- `isSameWork` ignores DOIs that Zotero keeps in `extra` and titles stored as `caseName`/`nameOfAct`/`subject`; it then falls back to all hits.
- **Stored entries are matched by file name only and never pruned.** After a folder change, a file in the new folder with the same name as one in the old folder (e.g. "My Library.json") takes over the old entry's rank and its on/off state. If that entry was off, the new file is silently not read. A pause of 800 ms or more on an existing intermediate folder while typing stores that folder's files too. Idea: store the folder with the list, or reset the list when the folder changes.
- Toggled row description may stay stale (§3); a fix would have to avoid relying on that row's description.
- Duplicate reporting: the notice shows at most five keys, names no files, and does not tell benign duplicates (same work in two libraries) from real conflicts (two works, one key). Discussed idea: classify by DOI, else title + year + first author, list everything in a command or modal and in the debug report, and notify only for conflicts.
- Discussed, not built:
  - a per-key pin in the literature note's frontmatter (e.g. a Zotero URI) for real conflicts in read-only groups;
  - a library list fetched from `user.groups` – rejected: it needs Zotero running, has only local IDs, includes feeds, and without `custom.uri` it cannot steer rendering;
  - a library-qualified citekey syntax – rejected: Pandoc and Word do not know it.
- Item counts count raw entries, including a citekey repeated within one file.
- Every uncached lookup sends one `item.export` per Zotero library, feeds included.

## 6. Merging this branch

- Delete `HANDOFF.md` and the link at the top of `AGENTS.md` before or as part of the merge.
- `.github/workflows/branch-notes.yml` ("Branch notes removed") fails a GitHub pull request into `main` while `HANDOFF.md` exists or `AGENTS.md` mentions it. It does **not** run for a local merge or a direct push to `main`, and it blocks nothing unless it is made a required status check. The owner has so far committed straight to `main` without pull requests, so do not rely on it: delete the file and the link by hand.
- Ask the owner whether to keep `branch-notes.yml` on `main` as a permanent guard for future branch notes, or delete it with the notes.
- Bump the version and release as described in §1 if the owner wants a release.
