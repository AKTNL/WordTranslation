# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PaperDict (package name `paper-dict`) is a Manifest V3 browser extension for Chrome/Edge/Brave that provides in-situ word lookup and bilingual translation while reading English academic papers, on web pages and in a bundled PDF reader. The UI and all comments are in Chinese.

## Commands

```bash
npm test                    # full offline suite: 12 test files, run sequentially via `&&`
node tests/test_extension.js            # run one suite directly
node tests/test_ui_layout.js            # (any tests/test_*.js works this way)
npm run test:diagnostics    # tests/test_full_diagnostics.js — end-to-end experience checks
npm run test:online         # tests/test_translation.js — hits real translation APIs, needs network
```

There is **no build step, bundler, or linter**. The `extension/` directory is loaded directly by the browser ("Load unpacked"). To verify changes manually, open `test-paper.html` in a browser with the extension loaded, or reload it from `chrome://extensions/`.

Release: push a `v*` tag. `.github/workflows/release.yml` runs `npm test`, zips `extension/`, and publishes a GitHub release. Keep `package.json` `version` and `extension/manifest.json` `version` in sync.

## Testing model

Tests are plain Node scripts with no framework. Two patterns coexist:

- **Behavioral tests** load a module with `require()` (modules export a UMD-style dual binding) and assert on functions directly.
- **Sandbox tests** (`test_page_activation.js`, `test_paragraph_translation_experience.js`, `test_ui_layout.js`) read the source with `fs.readFileSync` and run it inside a `vm` sandbox with a hand-built fake `chrome` API and DOM stubs. Many of these assert that **source strings and CSS literals are present** (e.g. `contentJs.includes('width: 370px;')`). Renaming a class, changing a pixel value, or reformatting template literals can fail these tests even when behavior is unchanged. When editing UI code in `content.js`, `bilingual.js`, `popup.css`, or `reader.css`, expect to update the corresponding string assertions.

## Architecture

### Multi-context module pattern

Every core module (`dict_service.js`, `translation_service.js`, `glossary_service.js`, `selection_anchor.js`, `background.js`, `bilingual.js`) is wrapped in an IIFE that must run in **three** contexts:

- **Content script** — attaches to `globalThis` (e.g. `globalThis.PaperDictSelectionAnchor`).
- **Service worker** — loaded via `importScripts(...)` at the top of `background.js`.
- **Node** — sets `module.exports` for tests, sometimes via a `require()` fallback guarded by `typeof require === 'function'`.

When adding a module or a public function, wire up all three. Content-script load order in `manifest.json` is significant: dictionary → services → `content.js` → `bilingual.js`.

### Layer responsibilities

- `manifest.json` — MV3 config, permissions, content-script injection order, and the `Alt+P` (toggle page translation) / `Alt+B` (toggle bilingual mode) commands.
- `background.js` (service worker) — online translation dispatch (MyMemory/Google fallback plus DeepL and OpenAI-compatible engines), the `chrome.storage.local` cache, context menus, per-tab badge state, PDF interception, and reader navigation. Cross-origin fetches live here; content scripts message it.
- `content.js` — selection listening, text preprocessing, offline dictionary lookup, and the Shadow DOM explanation card (draggable, pinnable, dark mode, vocabulary list, history).
- `bilingual.js` — in-situ bilingual / Chinese-only page translation with viewport-lazy loading, formula protection, and the control capsule. Paragraph eligibility is driven by the large `EXCLUDED_ARIA_ROLES` / `DESCENDANT_*` exclusion sets at the top of the file; figures, tables, and captions are filtered out deliberately.
- `dict_service.js` — text cleaning (PDF de-hyphenation, whitespace), lemmatization, and irregular-form resolution (`IRREGULAR_WORDS`).
- `translation_service.js` — engine adapters with **strict routing**: a user-selected custom engine is used exclusively and never silently falls back to a public engine. Returns structured `{ success, code, error, engine }` failures.
- `popup/` — settings UI, engine configuration, and `tab_bridge.js`, which re-injects content scripts into already-open tabs when enabling on demand.
- `reader/` — PDF.js-based reader with viewport virtualization, two-column paragraph extraction, de-hyphenation, and its own bilingual controls.
- `glossary_service.js` / `glossary_extractor.js` — user glossary merge/lookup plus translation-token protection, and automatic detection of author-defined acronyms (e.g. `Low-Rank Adaptation (LoRA)`).
- `annotation_manager.js` / `citation_parser.js` / `selection_anchor.js` — highlights with notes and Markdown export, in-text citation parsing and References indexing, and stable selection range anchoring.
- `dict/academic_dict.json` + `dict/academic_dict.js` — the ~15,600-entry offline dictionary, duplicated as JSON (source) and JS (content-script global). Keep both in sync.
- `glossaries/*.json` — bundled terminology packs (general academic, computer-AI, biomedical, materials, economics).

### Per-page activation (v2.4)

The extension is **off by default** on normal pages: no selection listening, no card, no capsule, gray `OFF` badge. The bundled `reader/reader.html` is exempt and starts on with a green `ON` badge. `Alt+P` toggles the current page. Activation state is held in **per-tab memory**, never persisted globally, so tabs never affect each other. Disabling a page must fully restore the original DOM (hide card, drop selection anchors, destroy the capsule, call `restoreOriginalView()`).

## Trellis workflow

This repo is managed by Trellis. `AGENTS.md` describes it; the working knowledge is under `.trellis/`:

- `.trellis/workflow.md` — phases and task lifecycle.
- `.trellis/spec/<package>/<layer>/` — coding guidelines to read before writing code in that layer (entry points are `index.md`).
- `.trellis/tasks/{MM-DD-name}/` — per-task PRD, context JSONL, and metadata.
- `.trellis/workspace/` — session journals.

Prefer the Trellis commands/skills over manual steps when available.
