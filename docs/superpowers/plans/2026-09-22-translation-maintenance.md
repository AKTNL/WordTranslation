# PaperDict Translation Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make English-to-Chinese selection and page translation reliable, terminology-aware, and honest about offline versus online capability.

**Architecture:** Add testable glossary and translation-engine services, then integrate them with the existing content, bilingual, background, reader, and popup scripts. Store user terminology and API secrets locally, scope caches by engine/glossary configuration, and make page state react to storage changes.

**Tech Stack:** Manifest V3, vanilla JavaScript, Chrome extension APIs, Node.js assertion tests, JSON glossary assets.

---

### Task 1: English-Only Eligibility

**Files:**
- Modify: `extension/dict_service.js`
- Modify: `extension/bilingual.js`
- Test: `tests/test_translation_maintenance.js`

- [ ] **Step 1: Write the failing eligibility tests**

```js
assert.equal(service.isEnglishSourceText('深度学习'), false);
assert.equal(service.isEnglishSourceText('CNN 模型'), false);
assert.equal(service.isEnglishSourceText('retrieval augmented generation'), true);
assert.equal(service.isLookupEligible('A中'), false);
```

- [ ] **Step 2: Run the focused test and confirm the mixed-language assertion fails**

Run: `node tests/test_translation_maintenance.js`

Expected: `A中` is incorrectly eligible before implementation.

- [ ] **Step 3: Implement one shared English-source predicate**

```js
isEnglishSourceText(text) {
  const value = String(text || '').trim();
  if (/\p{Script=Han}/u.test(value)) return false;
  return /[a-zA-Z].*[a-zA-Z]/.test(value);
}
```

Call this predicate from `isLookupEligible` and `AcademicFilter.isEligible`.

- [ ] **Step 4: Run the focused and core tests**

Run: `node tests/test_translation_maintenance.js && npm test`

Expected: all eligibility and existing tests pass.

### Task 2: Glossary Service And Starter Packs

**Files:**
- Create: `extension/glossary_service.js`
- Create: `extension/glossaries/general-academic.json`
- Create: `extension/glossaries/computer-ai.json`
- Create: `extension/glossaries/materials-engineering.json`
- Create: `extension/glossaries/biomedical.json`
- Create: `extension/glossaries/economics-social-science.json`
- Modify: `extension/manifest.json`
- Test: `tests/test_translation_maintenance.js`

- [ ] **Step 1: Write failing glossary parsing and matching tests**

```js
const glossary = new GlossaryService([
  { source: 'language model', target: '语言模型' },
  { source: 'large language model', target: '大语言模型' }
]);
const protectedResult = glossary.protect('A large language model is evaluated.');
assert.equal(protectedResult.text.includes('PDTERM_0'), true);
assert.equal(glossary.restore(protectedResult.text, protectedResult.terms).includes('大语言模型'), true);
assert.deepEqual(GlossaryService.parseCsv('source,target\n"ablation study","消融实验"'), [
  { source: 'ablation study', target: '消融实验' }
]);
```

- [ ] **Step 2: Run the test and confirm the service is missing**

Run: `node tests/test_translation_maintenance.js`

Expected: module-not-found failure for `glossary_service.js`.

- [ ] **Step 3: Implement normalization, CSV/JSON parsing, merge, exact lookup, protect, and restore**

```js
class GlossaryService {
  constructor(entries = []) { this.setEntries(entries); }
  setEntries(entries) { this.entries = normalizeAndSort(entries); }
  lookup(text) { return this.bySource.get(normalizeSource(text)) || null; }
  protect(text) { return protectLongestTerms(text, this.entries); }
  restore(text, terms) { return restoreTermTokens(text, terms); }
  static parseCsv(text) { return parseCsvRecords(text); }
  static parseJson(text) { return validateEntries(JSON.parse(text)); }
}
```

- [ ] **Step 4: Add versioned starter-pack assets**

Each file uses:

```json
{
  "id": "general-academic",
  "name": "通用学术与统计",
  "version": 1,
  "terms": [{ "source": "confidence interval", "target": "置信区间" }]
}
```

- [ ] **Step 5: Run focused tests**

Run: `node tests/test_translation_maintenance.js`

Expected: CSV/JSON, priority, longest-match, token restoration, and built-in-pack tests pass.

### Task 3: Real Translation Engine Adapters

**Files:**
- Create: `extension/translation_service.js`
- Modify: `extension/background.js`
- Test: `tests/test_translation_engines.js`

- [ ] **Step 1: Write failing adapter tests with injected fetch**

```js
const service = new TranslationService({ fetchImpl: fakeFetch });
const result = await service.translate('Academic text', {
  engine: 'openai', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'secret', model: 'model-a'
});
assert.equal(result.engine, 'openai');
assert.equal(fakeFetch.calls.length, 1);
```

Also assert DeepL authorization, 401/429 mapping, timeout, invalid response, and no public-engine fallback.

- [ ] **Step 2: Run the tests and confirm the adapter is missing**

Run: `node tests/test_translation_engines.js`

Expected: module-not-found failure for `translation_service.js`.

- [ ] **Step 3: Implement strict adapters and stable errors**

```js
async translate(text, config) {
  if (config.engine === 'openai') return this.translateOpenAI(text, config);
  if (config.engine === 'deepl') return this.translateDeepL(text, config);
  return this.translatePublic(text, config);
}
```

All adapters use a shared timeout wrapper and return `{ success, translation, source, engine }` or `{ success: false, code, error, engine }`.

- [ ] **Step 4: Add background messages for translation and connection testing**

```js
if (request.type === 'TEST_TRANSLATION_ENGINE') {
  testTranslationEngine(request.config).then(sendResponse);
  return true;
}
```

Migrate `customApiKey` from sync storage to local storage and remove silent fallback branches.

- [ ] **Step 5: Run adapter and core tests**

Run: `node tests/test_translation_engines.js && npm test`

Expected: all tests pass without real network credentials.

### Task 4: Glossary-Aware Translation And Cache Isolation

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/content.js`
- Modify: `extension/bilingual.js`
- Modify: `extension/reader/reader.js`
- Modify: `extension/manifest.json`
- Test: `tests/test_translation_maintenance.js`

- [ ] **Step 1: Write failing integration-unit tests**

```js
assert.equal(buildCacheKey('text', { engine: 'openai', model: 'a', glossaryVersion: 1 })
  === buildCacheKey('text', { engine: 'openai', model: 'b', glossaryVersion: 1 }), false);
assert.equal(shouldRequestOnline({ onlineFallback: false }), false);
```

- [ ] **Step 2: Confirm tests fail before integration**

Run: `node tests/test_translation_maintenance.js`

Expected: cache and online-policy helpers are missing.

- [ ] **Step 3: Integrate glossary priority and online policy**

Content lookup order becomes user glossary, enabled packs, dictionary, then online engine. Bilingual and reader translation protect terms before requests and restore them after successful responses.

- [ ] **Step 4: Scope persisted cache keys**

```js
const cacheKey = JSON.stringify([
  config.engine, config.endpoint || '', config.model || '', config.glossaryVersion || 0, query
]);
```

- [ ] **Step 5: Verify focused and complete tests**

Run: `node tests/test_translation_maintenance.js && npm test && npm run test:diagnostics`

Expected: all tests pass.

### Task 5: Live Capsule Setting

**Files:**
- Modify: `extension/bilingual.js`
- Test: `tests/test_translation_maintenance.js`

- [ ] **Step 1: Write a failing manager lifecycle test**

```js
manager.applyCapsuleEnabled(false);
assert.equal(manager.capsule, null);
manager.applyCapsuleEnabled(true);
assert.notEqual(manager.capsule, null);
```

- [ ] **Step 2: Run and confirm the method is missing**

Run: `node tests/test_translation_maintenance.js`

Expected: `applyCapsuleEnabled` is not defined.

- [ ] **Step 3: Implement destroy/recreate lifecycle and storage listener**

```js
applyCapsuleEnabled(enabled) {
  if (!enabled) {
    if (this.capsule?.host) this.capsule.host.remove();
    this.capsule = null;
    return;
  }
  if (!this.isBlacklisted) this.initCapsule();
}
```

- [ ] **Step 4: Run lifecycle and core tests**

Run: `node tests/test_translation_maintenance.js && npm test`

Expected: immediate off/on lifecycle tests pass.

### Task 6: Popup API And Glossary Management

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.css`
- Modify: `extension/popup/popup.js`
- Test: `tests/test_translation_maintenance.js`

- [ ] **Step 1: Add failing static contract tests**

```js
assert.match(popupHtml, /btn-test-api/);
assert.match(popupHtml, /input-glossary-file/);
assert.match(popupJs, /TEST_TRANSLATION_ENGINE/);
assert.match(popupJs, /GlossaryService\.parse/);
```

- [ ] **Step 2: Run and confirm controls are absent**

Run: `node tests/test_translation_maintenance.js`

Expected: missing API test and glossary controls.

- [ ] **Step 3: Implement validated API save/test controls**

The test button sends only the current form configuration. Save writes secrets to local storage only after validation and reports the real response status.

- [ ] **Step 4: Implement glossary pack and user-entry controls**

Use native file input, search field, compact editable rows, pack checkboxes, and import/export actions. Mutations write `userGlossary`, `enabledGlossaryPacks`, and an incremented `glossaryVersion` to local storage.

- [ ] **Step 5: Run focused tests and syntax validation**

Run: `node tests/test_translation_maintenance.js && node --check extension/popup/popup.js`

Expected: UI contracts and syntax pass.

### Task 7: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.trellis/tasks/09-22-translation-maintenance/task.json`

- [ ] **Step 1: Document offline boundaries, terminology, and API testing**

Explain that offline capability covers word/term lookup, while full-page translation requires a selected online engine.

- [ ] **Step 2: Add maintenance tests to the default test script**

```json
"test": "node tests/test_extension.js && node tests/test_translation_maintenance.js && node tests/test_translation_engines.js"
```

- [ ] **Step 3: Run fresh complete verification**

Run: `npm test && npm run test:diagnostics && node tests/test_ux_edge_cases.js && git diff --check`

Expected: zero test failures, zero syntax failures, and no whitespace errors.

- [ ] **Step 4: Inspect the branch diff and commit implementation**

Run: `git diff --stat main...HEAD` and `git status --short`

Expected: only task-scoped code, tests, glossary assets, and documentation are changed. Do not create a pull request until the user explicitly approves the reviewed implementation.

