# Paragraph Translation Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the selection card anchored while scrolling and make bilingual/full-Chinese page modes translate visible academic paragraphs immediately with clear paragraph boundaries.

**Architecture:** Add one small, testable selection-anchor helper used by `content.js`, then extend the existing `AcademicFilter` and `PaperBilingualManager` instead of creating a second page-translation pipeline. Page translation will eagerly enqueue visible paragraphs, lazily observe later paragraphs, watch dynamically inserted content, and render one stateful translation block per source paragraph.

**Tech Stack:** Manifest V3, vanilla JavaScript, DOM Range/IntersectionObserver/MutationObserver APIs, CSS, Node.js `assert` tests.

---

### Task 1: Safe Keyboard Events And Live Selection Anchors

**Files:**
- Create: `extension/selection_anchor.js`
- Modify: `extension/manifest.json:36-43`
- Modify: `extension/content.js:67-77,505-539,891-1012`
- Create: `tests/test_paragraph_translation_experience.js`
- Modify: `package.json:6-10`

- [x] **Step 1: Write the failing helper tests**

Create the test harness and initial assertions:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createRangeAnchor,
  isSelectionNavigationKey
} = require('../extension/selection_anchor.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
  }
}

console.log('=== PaperDict Paragraph Translation Experience Tests ===');

test('ignores synthetic keyup events without key', () => {
  assert.equal(isSelectionNavigationKey({}), false);
  assert.equal(isSelectionNavigationKey({ key: 'Shift' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'ArrowDown' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'Enter' }), false);
});

test('reads a fresh range rectangle and closes when it leaves the viewport', () => {
  let rect = { left: 40, right: 140, top: 100, bottom: 120, width: 100, height: 20 };
  let detached = false;
  const range = {
    cloneRange() { return this; },
    getBoundingClientRect() { return rect; },
    detach() { detached = true; }
  };
  const anchor = createRangeAnchor(range);

  assert.equal(anchor.getRect(800, 600).top, 100);
  rect = { left: 40, right: 140, top: 20, bottom: 40, width: 100, height: 20 };
  assert.equal(anchor.getRect(800, 600).top, 20);
  rect = { left: 40, right: 140, top: -40, bottom: -20, width: 100, height: 20 };
  assert.equal(anchor.getRect(800, 600), null);
  anchor.dispose();
  assert.equal(detached, true);
});

process.on('exit', () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
```

- [x] **Step 2: Run the new test and verify RED**

Run: `node tests/test_paragraph_translation_experience.js`

Expected: FAIL because `extension/selection_anchor.js` does not exist.

- [x] **Step 3: Implement the pure selection-anchor helper**

Create a browser/CommonJS module with these complete behaviors:

```js
(function initSelectionAnchor(global) {
  'use strict';

  function isSelectionNavigationKey(event) {
    const key = event && event.key;
    return typeof key === 'string' && (key === 'Shift' || key.startsWith('Arrow'));
  }

  function createRangeAnchor(range) {
    if (!range || typeof range.getBoundingClientRect !== 'function') return null;
    const stableRange = typeof range.cloneRange === 'function' ? range.cloneRange() : range;

    return {
      getRect(viewportWidth, viewportHeight) {
        try {
          const rect = stableRange.getBoundingClientRect();
          if (!rect || (rect.width === 0 && rect.height === 0)) return null;
          if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth) {
            return null;
          }
          return rect;
        } catch (error) {
          return null;
        }
      },
      dispose() {
        if (typeof stableRange.detach === 'function') stableRange.detach();
      }
    };
  }

  const api = { createRangeAnchor, isSelectionNavigationKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PaperDictSelectionAnchor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Load `selection_anchor.js` immediately before `content.js` in `manifest.json`, and prepend `node tests/test_paragraph_translation_experience.js` to the default `npm test` script.

- [x] **Step 4: Run the helper tests and verify GREEN**

Run: `node tests/test_paragraph_translation_experience.js`

Expected: 2 passed, 0 failed.

- [x] **Step 5: Integrate the live anchor into `content.js`**

Read the helper once and add explicit anchor lifecycle state:

```js
const selectionAnchorUtils = window.PaperDictSelectionAnchor || globalThis.PaperDictSelectionAnchor;
let activeSelectionAnchor = null;
let selectionPositionFrame = null;

function clearSelectionAnchor() {
  if (activeSelectionAnchor) activeSelectionAnchor.dispose();
  activeSelectionAnchor = null;
}

function scheduleSelectionCardPosition() {
  if (selectionPositionFrame !== null) return;
  selectionPositionFrame = window.requestAnimationFrame(() => {
    selectionPositionFrame = null;
    if (!activeSelectionAnchor || !cardEl || !cardEl.classList.contains('visible')) return;
    const rect = activeSelectionAnchor.getRect(window.innerWidth, window.innerHeight);
    if (!rect) {
      clearSelectionAnchor();
      hideCard(true);
      return;
    }
    positionCard(rect);
  });
}
```

When reading a DOM selection, dispose the previous anchor, clone the current `Range`, and obtain the initial rectangle from that anchor. Context-menu and input selections clear the range anchor because they do not expose a stable DOM `Range`. Before every `renderCard` position call, prefer the current anchor rectangle over the original snapshot so delayed online responses cannot jump back to the stale position.

Register repositioning for nested scrolling and viewport resizing:

```js
window.addEventListener('scroll', scheduleSelectionCardPosition, { capture: true, passive: true });
window.addEventListener('resize', scheduleSelectionCardPosition, { passive: true });

document.addEventListener('keyup', (event) => {
  if (selectionAnchorUtils.isSelectionNavigationKey(event)) triggerSelectionCheck(event);
}, false);
```

Closing the card, rejecting an ineligible selection, clearing the selection, or detecting an offscreen/invalid range must call `clearSelectionAnchor()`.

- [x] **Step 6: Add a source contract test for the integration and verify it passes**

Append:

```js
test('content script uses guarded key handling and live scroll positioning', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
  assert.match(source, /selectionAnchorUtils\.isSelectionNavigationKey\(event\)/);
  assert.match(source, /addEventListener\('scroll', scheduleSelectionCardPosition/);
  assert.match(source, /activeSelectionAnchor\.getRect\(window\.innerWidth, window\.innerHeight\)/);
  assert.doesNotMatch(source, /e\.key\.startsWith\('Arrow'\)/);
});
```

Run: `node tests/test_paragraph_translation_experience.js && node --check extension/content.js`

Expected: all new tests pass and syntax is valid.

- [x] **Step 7: Commit the selection fix**

```bash
git add extension/selection_anchor.js extension/manifest.json extension/content.js tests/test_paragraph_translation_experience.js package.json
git commit -m "fix: anchor selection card during scrolling"
```

### Task 2: Paragraph Candidate Discovery

**Files:**
- Modify: `extension/bilingual.js:192-351`
- Modify: `tests/test_paragraph_translation_experience.js`

- [x] **Step 1: Write failing semantic-DIV and exclusion tests**

Append helpers and assertions:

```js
const { AcademicFilter } = require('../extension/bilingual.js');

function makeClassList(values = []) {
  const set = new Set(values);
  return { contains: (value) => set.has(value) };
}

function makeElement(tagName, text, options = {}) {
  return {
    tagName,
    innerText: text,
    textContent: text,
    id: options.id || '',
    className: options.className || '',
    classList: makeClassList(options.classes),
    dataset: options.dataset || {},
    parentElement: options.parentElement || null,
    offsetParent: {},
    offsetHeight: 40,
    offsetWidth: 400,
    getAttribute(name) { return name === 'role' ? options.role || null : null; },
    querySelector() { return options.hasBlockChild ? {} : null; }
  };
}

test('accepts leaf semantic paragraph divs and rejects container divs', () => {
  global.document = { body: {}, documentElement: {} };
  const filter = new AcademicFilter();
  const paragraph = makeElement('DIV', 'This semantic paragraph explains the experimental results in detail.', {
    role: 'paragraph'
  });
  const container = makeElement('DIV', 'This container repeats all of its child paragraph text.', {
    className: 'article-content',
    hasBlockChild: true
  });
  assert.equal(filter.isEligible(paragraph), true);
  assert.equal(filter.isEligible(container), false);
  delete global.document;
});

test('rejects navigation, interactive, code, formula, and generated translation content', () => {
  global.document = { body: {}, documentElement: {} };
  const filter = new AcademicFilter();
  const nav = makeElement('DIV', 'This navigation label is deliberately long enough to look like body text.', {
    parentElement: makeElement('NAV', '')
  });
  const generated = makeElement('DIV', 'This generated translation must never be translated again.', {
    classes: ['pd-bilingual-trans']
  });
  assert.equal(filter.isEligible(nav), false);
  assert.equal(filter.isEligible(generated), false);
  assert.equal(filter.isEligible(makeElement('CODE', 'const academicModel = true;')), false);
  assert.equal(filter.isEligible(makeElement('MATH', 'x = y + z')), false);
  delete global.document;
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node tests/test_paragraph_translation_experience.js`

Expected: FAIL because `AcademicFilter.isEligible()` rejects all `DIV` elements.

- [x] **Step 3: Implement bounded semantic-DIV discovery**

In `AcademicFilter`, add `FORM`, `OPTION`, `LABEL`, `AUDIO`, `VIDEO`, `IFRAME`, and `MATH` to excluded tags. Add these methods:

```js
isSemanticParagraphDiv(el) {
  if (!el || String(el.tagName).toUpperCase() !== 'DIV') return false;
  const role = el.getAttribute ? el.getAttribute('role') : null;
  const marker = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
  const hasSemanticHint = role === 'paragraph' || /(paragraph|para|prose|abstract|article-text|body-text)/i.test(marker);
  const hasNestedBlock = typeof el.querySelector === 'function' && Boolean(
    el.querySelector('p, h1, h2, h3, h4, h5, h6, blockquote, li, div[role="paragraph"]')
  );
  const hasInteractiveChild = typeof el.querySelector === 'function' && Boolean(
    el.querySelector('button, input, textarea, select, form')
  );
  if (hasNestedBlock || hasInteractiveChild) return false;
  const text = (el.innerText || el.textContent || '').trim();
  return hasSemanticHint || text.length >= 40;
}

isCandidateTag(el) {
  const tag = String(el && el.tagName || '').toUpperCase();
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'].includes(tag)) return true;
  return tag === 'DIV' && this.isSemanticParagraphDiv(el);
}
```

Use `isCandidateTag()` in `isEligible()`, require at least 40 characters for an unhinted `DIV`, and change the discovery selector to:

```js
const candidates = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, div');
```

The existing reference-section walk and `isEnglishSourceText()` check remain authoritative.

- [x] **Step 4: Run focused and regression tests**

Run: `node tests/test_paragraph_translation_experience.js && node tests/test_translation_maintenance.js && node tests/test_extension.js`

Expected: semantic paragraph tests and all existing filter/formula tests pass.

- [x] **Step 5: Commit paragraph discovery**

```bash
git add extension/bilingual.js tests/test_paragraph_translation_experience.js
git commit -m "fix: discover semantic academic paragraphs"
```

### Task 3: Immediate, Lazy, And Dynamic Translation Scheduling

**Files:**
- Modify: `extension/bilingual.js:793-814,982-1002,1061-1150`
- Modify: `tests/test_paragraph_translation_experience.js`

- [x] **Step 1: Write failing viewport scheduling tests**

Append:

```js
const { PaperBilingualManager } = require('../extension/bilingual.js');

function makeVisibleElement(top = 20, bottom = 80) {
  return {
    tagName: 'P',
    innerText: 'This academic paragraph is long enough to enter the translation queue.',
    textContent: 'This academic paragraph is long enough to enter the translation queue.',
    id: '',
    className: '',
    classList: makeClassList(),
    dataset: {},
    parentElement: null,
    offsetParent: {},
    offsetHeight: bottom - top,
    offsetWidth: 200,
    getBoundingClientRect() { return { top, bottom, left: 10, right: 210, width: 200, height: bottom - top }; }
  };
}

test('activation immediately queues visible elements and observes later elements', () => {
  global.window = { innerWidth: 800, innerHeight: 600 };
  global.document = { documentElement: { dataset: {} }, body: {} };
  const visible = makeVisibleElement(20, 80);
  const later = makeVisibleElement(900, 960);
  const observed = [];
  const queued = [];
  const manager = new PaperBilingualManager();
  manager.mode = 'bilingual';
  manager.filter.findContentElements = () => [visible, later];
  manager.observer = { disconnect() {}, observe(el) { observed.push(el); } };
  manager.enqueueElement = (el) => queued.push(el);
  manager.applyDisplayModeToAll = () => {};
  manager.updateCapsuleStats = () => {};
  manager.observeContentChanges = () => {};

  manager.activateBilingualView();

  assert.deepEqual(queued, [visible]);
  assert.deepEqual(observed, [later]);
  delete global.window;
  delete global.document;
});

test('registering the same dynamic paragraph twice only queues it once', () => {
  global.window = { innerWidth: 800, innerHeight: 600 };
  global.document = { body: {}, documentElement: {} };
  const paragraph = makeVisibleElement();
  const manager = new PaperBilingualManager();
  manager.mode = 'bilingual';
  manager.observer = { observe() {} };
  manager.processQueue = () => {};
  manager.renderLoadingPlaceholder = () => {};

  manager.registerElement(paragraph);
  manager.registerElement(paragraph);

  assert.equal(manager.elements.length, 1);
  assert.equal(manager.queue.length, 1);
  delete global.window;
  delete global.document;
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node tests/test_paragraph_translation_experience.js`

Expected: FAIL because activation does not eagerly enqueue visible content and `registerElement()` is missing.

- [x] **Step 3: Implement explicit element registration and viewport checks**

Add `mutationObserver` to the constructor and these methods:

```js
isElementInViewport(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function' || typeof window === 'undefined') return false;
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

registerElement(el) {
  if (!el || !this.filter.isEligible(el)) return false;
  let info = this.elementStateMap.get(el);
  if (!info) {
    info = { state: 'idle', transEl: null };
    this.elementStateMap.set(el, info);
    this.elements.push(el);
  }
  if (info.state !== 'idle') return false;
  if (this.isElementInViewport(el) || !this.observer) this.enqueueElement(el);
  else this.observer.observe(el);
  return true;
}
```

`activateBilingualView()` must clear the current `elements` array, pass every newly discovered element through `registerElement()`, immediately enqueue visible elements, observe offscreen elements, then begin content mutation observation. `registerElement()` adds an element to `elements` only when it is not already present, so activation and mutation callbacks cannot create duplicates. Do not call `processQueue()` as a substitute for enqueueing because an empty queue has no work.

- [x] **Step 4: Add dynamic content observation**

Create one observer whose callback ignores PaperDict-generated nodes and registers both an eligible added node and eligible descendants:

```js
setupMutationObserver() {
  if (this.mutationObserver || typeof MutationObserver === 'undefined') return;
  this.mutationObserver = new MutationObserver((records) => {
    if (this.mode === 'original') return;
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (!node || node.nodeType !== 1 || this.filter.isExcluded(node)) continue;
        this.registerElement(node);
        for (const el of this.filter.findContentElements(node)) this.registerElement(el);
      }
    }
    this.applyDisplayModeToAll();
    this.updateCapsuleStats();
  });
}

observeContentChanges() {
  this.setupMutationObserver();
  if (!this.mutationObserver || typeof document === 'undefined') return;
  this.mutationObserver.disconnect();
  this.mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
}
```

`restoreOriginalView()` must disconnect both observers and clear the pending queue. `activateBilingualView()` must reconnect both every time a page mode is entered.

- [x] **Step 5: Add a MutationObserver lifecycle test**

Append a test using an injected fake observer:

```js
test('original mode disconnects dynamic content observation', () => {
  let disconnected = 0;
  const manager = new PaperBilingualManager();
  manager.elements = [];
  manager.observer = { disconnect() { disconnected++; } };
  manager.mutationObserver = { disconnect() { disconnected++; } };
  manager.applyDisplayModeToAll = () => {};
  manager.updateCapsuleStats = () => {};

  manager.restoreOriginalView();

  assert.equal(disconnected, 2);
  assert.equal(manager.queue.length, 0);
});
```

- [x] **Step 6: Run focused and full tests**

Run: `node tests/test_paragraph_translation_experience.js && npm test`

Expected: visible, offscreen, deduplication, mutation cleanup, and all existing tests pass.

- [x] **Step 7: Commit scheduling behavior**

```bash
git add extension/bilingual.js tests/test_paragraph_translation_experience.js
git commit -m "fix: start paragraph translation immediately"
```

### Task 4: Paired Translation Blocks And Failure-Safe Chinese Mode

**Files:**
- Modify: `extension/bilingual.js:1083-1134,1136-1299`
- Modify: `extension/bilingual.css:6-129`
- Modify: `tests/test_paragraph_translation_experience.js`

- [x] **Step 1: Write failing translation-state and visual contract tests**

Append:

```js
function mutableClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(value) { set.add(value); },
    remove(value) { set.delete(value); },
    contains(value) { return set.has(value); }
  };
}

test('Chinese mode hides only successfully translated source paragraphs', () => {
  const doneEl = { classList: mutableClassList() };
  const failedEl = { classList: mutableClassList() };
  const manager = new PaperBilingualManager();
  manager.mode = 'chinese';
  manager.elements = [doneEl, failedEl];
  manager.elementStateMap.set(doneEl, {
    state: 'done',
    transEl: { style: {}, classList: mutableClassList(['pd-bilingual-trans']) }
  });
  manager.elementStateMap.set(failedEl, {
    state: 'error',
    transEl: { style: {}, classList: mutableClassList(['pd-bilingual-error']) }
  });

  manager.applyDisplayModeToAll();

  assert.equal(doneEl.classList.contains('pd-orig-hidden'), true);
  assert.equal(failedEl.classList.contains('pd-orig-hidden'), false);
});

test('translation blocks expose the selected label and left-rule styling', () => {
  const css = fs.readFileSync(path.join(__dirname, '../extension/bilingual.css'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');
  assert.match(css, /\.pd-translation-label/);
  assert.match(css, /border-left:\s*3px solid #1c7c54/);
  assert.match(source, /pd-translation-label[^>]*>译文</);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node tests/test_paragraph_translation_experience.js`

Expected: FAIL because Chinese mode hides pending/failed originals and translation blocks have no label.

- [x] **Step 3: Make paragraph states explicit and retryable**

Use `idle | queued | translating | done | error`. On failure, set `state = 'error'`, keep the original visible, and render a `.pd-bilingual-error` block with the existing error message and retry button. Retry performs:

```js
info.state = 'idle';
this.enqueueElement(el);
```

Make `renderLoadingPlaceholder()` reuse an existing error node by restoring class name, spinner markup, and display, rather than leaving the old error UI in place.

Update Chinese-mode display logic to hide the source only when all of these are true:

```js
const hasTranslation = info.state === 'done' &&
  info.transEl &&
  info.transEl.classList.contains('pd-bilingual-trans');

if (this.mode === 'chinese' && hasTranslation) {
  el.classList.add('pd-orig-hidden');
  info.transEl.style.display = 'block';
} else {
  el.classList.remove('pd-orig-hidden');
  if (info.transEl) info.transEl.style.display = this.mode === 'original' ? 'none' : 'block';
}
```

- [x] **Step 4: Render the approved paragraph-pair layout**

Wrap successful content without changing formula HTML:

```js
info.transEl.className = 'pd-bilingual-trans';
info.transEl.innerHTML = `
  <div class="pd-translation-label">译文</div>
  <div class="pd-translation-content">${transHtml}</div>
`;
```

Replace the filled blue card treatment with the approved restrained divider:

```css
.pd-bilingual-trans {
  display: block !important;
  margin: 6px 0 18px !important;
  padding: 4px 0 4px 12px !important;
  background: transparent !important;
  border-left: 3px solid #1c7c54 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: inherit !important;
  letter-spacing: 0 !important;
}

.pd-translation-label {
  margin-bottom: 4px !important;
  color: #1c7c54 !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: 11px !important;
  font-weight: 700 !important;
}
```

Keep the same left boundary in full-Chinese mode while inheriting the host page's heading and paragraph typography.

- [x] **Step 5: Make original-mode restoration remove generated DOM**

In `restoreOriginalView()`, remove every `transEl`, clear `pd-orig-hidden`, reset each element to `idle`, clear its `requestId`, and set `transEl = null`. Assign a monotonically increasing `requestId` when `processQueue()` begins a translation. `translateElement()` may mutate DOM or state only while `info.requestId` still equals that request; a stale successful response may populate the text cache but must not reinsert generated DOM. This prevents a request started in a previous mode session from overwriting a newer retry or the restored original page.

Add this regression test:

```js
test('restoring original mode removes generated nodes and hidden source state', () => {
  let removed = false;
  const el = { classList: mutableClassList(['pd-orig-hidden']) };
  const manager = new PaperBilingualManager();
  manager.elements = [el];
  manager.elementStateMap.set(el, {
    state: 'done',
    requestId: 7,
    transEl: { remove() { removed = true; }, classList: mutableClassList(['pd-bilingual-trans']) }
  });
  manager.applyDisplayModeToAll = PaperBilingualManager.prototype.applyDisplayModeToAll;
  manager.updateCapsuleStats = () => {};

  manager.restoreOriginalView();

  const info = manager.elementStateMap.get(el);
  assert.equal(removed, true);
  assert.equal(info.state, 'idle');
  assert.equal(info.requestId, null);
  assert.equal(info.transEl, null);
  assert.equal(el.classList.contains('pd-orig-hidden'), false);
});
```

- [x] **Step 6: Run focused and full tests**

Run: `node tests/test_paragraph_translation_experience.js && npm test && npm run test:diagnostics`

Expected: all tests and diagnostics pass with zero failures.

- [x] **Step 7: Commit the paragraph presentation**

```bash
git add extension/bilingual.js extension/bilingual.css tests/test_paragraph_translation_experience.js
git commit -m "feat: render paired paragraph translations"
```

### Task 5: Browser Verification And Review Handoff

**Files:**
- Modify only if verification finds a regression: task-scoped files from Tasks 1-4

- [x] **Step 1: Run syntax and whitespace checks**

Run:

```powershell
node --check extension/selection_anchor.js
node --check extension/content.js
node --check extension/bilingual.js
git diff --check
```

Expected: all commands exit 0 with no output from `git diff --check`.

- [x] **Step 2: Run the complete offline verification suite**

Run:

```powershell
npm test
npm run test:diagnostics
node tests/test_ux_edge_cases.js
```

Expected: every assertion passes and diagnostics reports zero critical defects.

- [x] **Step 3: Reload the unpacked extension in Edge**

Open `edge://extensions`, enable Developer mode, click Reload for PaperDict, and refresh the test article tab. Confirm only the single PaperDict extension directory `extension/` is loaded.

Verified in a fresh isolated Edge profile by launching Edge with only `extension/` enabled and confirming both the PaperDict service worker and content scripts loaded. This avoids modifying the user's normal Edge profile.

- [x] **Step 4: Verify the selection card on a real article**

Select an English sentence, wait for the card, then scroll within both the page and a nested scroll container. Confirm the card tracks the selection, resizes/repositions with the viewport, and closes once the selection is fully outside the viewport. Dispatch `document.dispatchEvent(new Event('keyup'))` in DevTools and confirm no console error occurs.

- [x] **Step 5: Verify bilingual and full-Chinese paragraph modes**

On a long English article containing headings, paragraphs, lists, a code block, and later-loaded content:

- Bilingual mode translates visible paragraphs immediately and shows `译文` with a green left rule.
- Scrolling causes later paragraphs to translate without duplicating blocks.
- Full-Chinese mode hides English only after each matching Chinese translation succeeds.
- Code, formulas, navigation, buttons, and failed English paragraphs remain intact.
- Switching to original mode removes generated translation blocks and restores every English paragraph.

- [x] **Step 6: Inspect final branch state without creating a PR**

Run:

```powershell
git status --short
git log --oneline -8
git diff main...HEAD --stat
```

Expected: only task-scoped source, tests, specifications, plans, and existing Trellis bookkeeping are present. Do not push or create a pull request; hand the branch to the user for review first.
