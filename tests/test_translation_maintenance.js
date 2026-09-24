const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { DictService } = require('../extension/dict_service.js');
const {
  AcademicFilter,
  PaperBilingualManager,
  reattachExistingManager,
  getViewportSafePosition
} = require('../extension/bilingual.js');
const { GlossaryService } = require('../extension/glossary_service.js');

const dictData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../extension/dict/academic_dict.json'), 'utf8')
);

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

console.log('=== PaperDict Translation Maintenance Tests ===');

const service = new DictService(dictData);
const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const readerJs = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.js'), 'utf8');
const bilingualJs = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

test('rejects pure Chinese as an English source', () => {
  assert.equal(service.isEnglishSourceText('深度学习'), false);
  assert.equal(service.isLookupEligible('深度学习'), false);
});

test('rejects mixed Chinese and English selections', () => {
  assert.equal(service.isEnglishSourceText('CNN 模型'), false);
  assert.equal(service.isLookupEligible('A中'), false);
});

test('accepts normal English academic text', () => {
  assert.equal(service.isEnglishSourceText('retrieval augmented generation'), true);
  assert.equal(service.isLookupEligible('retrieval augmented generation'), true);
});

test('full-page filter rejects Chinese and mixed-language paragraphs', () => {
  global.document = { body: {}, documentElement: {} };
  const filter = new AcademicFilter();
  const makeElement = (text) => ({
    tagName: 'P',
    innerText: text,
    textContent: text,
    parentElement: null,
    offsetParent: {},
    offsetHeight: 20,
    offsetWidth: 200,
    id: '',
    className: ''
  });

  assert.equal(filter.isEligible(makeElement('这是一段包含 CNN 模型的中文内容，长度足够。')), false);
  assert.equal(filter.isEligible(makeElement('This paragraph evaluates a language model.')), true);
  delete global.document;
});

test('PDF reader uses the shared English-only predicate and reports engine errors', () => {
  assert.equal((readerJs.match(/dictService\.isEnglishSourceText\(cleaned\)/g) || []).length, 2);
  assert.match(readerJs, /res\?\.error \|\| '翻译失败，请稍后重试'/);
});

test('parses quoted CSV and JSON glossary files', () => {
  assert.deepEqual(
    GlossaryService.parseCsv('source,target\n"ablation study","消融实验"'),
    [{ source: 'ablation study', target: '消融实验' }]
  );
  assert.deepEqual(
    GlossaryService.parseJson('[{"source":"confidence interval","target":"置信区间"}]'),
    [{ source: 'confidence interval', target: '置信区间' }]
  );
});

test('prefers user terms and longest phrase matches', () => {
  const glossary = new GlossaryService([
    { source: 'language model', target: '语言模型', priority: 10 },
    { source: 'large language model', target: '大语言模型', priority: 10 },
    { source: 'language model', target: '用户指定译法', priority: 100 }
  ]);

  assert.equal(glossary.lookup('language model').target, '用户指定译法');
  const protectedResult = glossary.protect('A large language model evaluates another language model.');
  assert.equal(protectedResult.terms.length, 2);
  assert.equal(protectedResult.terms[0].source, 'large language model');
  assert.equal(
    glossary.restore(protectedResult.text, protectedResult.terms),
    'A 大语言模型 evaluates another 用户指定译法.'
  );
});

test('restores double-digit term tokens without corrupting their indexes', () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    source: `term ${index}`,
    target: `译法 ${String.fromCharCode(65 + index)}`
  }));
  const glossary = new GlossaryService(entries);
  const protectedResult = glossary.protect(entries.map((entry) => entry.source).join(', '));
  const restored = glossary.restore(protectedResult.text, protectedResult.terms);

  assert.equal(protectedResult.terms.length, 11);
  assert.equal(restored, entries.map((entry) => entry.target).join(', '));
});

test('merges imported terms and reports changes', () => {
  const result = GlossaryService.mergeEntries(
    [{ source: 'embedding', target: '嵌入' }],
    [
      { source: 'embedding', target: '嵌入表示' },
      { source: 'tokenization', target: '分词' },
      { source: '', target: '忽略' }
    ]
  );

  assert.deepEqual(result.stats, { added: 1, updated: 1, ignored: 1 });
  assert.equal(result.entries.find((entry) => entry.source === 'embedding').target, '嵌入表示');
});

test('selection lookup checks the glossary before online translation', () => {
  assert.match(contentJs, /LOOKUP_GLOSSARY/);
  assert.match(contentJs, /本地词典与术语库未收录/);
  assert.match(
    contentJs,
    /badge-source offline[^`]*\$\{escapeHtml\(data\.sourceName \|\| '离线学术词典'\)\}/
  );
});

test('full-page manager exposes and applies the online translation setting', () => {
  const manager = new PaperBilingualManager();
  manager.applyOnlineFallback(false);
  assert.equal(manager.onlineFallback, false);
  manager.applyOnlineFallback(true);
  assert.equal(manager.onlineFallback, true);
});

test('full-page manager clears its local cache when engine or glossary settings change', () => {
  let storageListener = null;
  global.chrome = {
    storage: {
      onChanged: {
        addListener(listener) { storageListener = listener; }
      }
    }
  };

  const manager = new PaperBilingualManager();
  manager.cache.set('same paragraph', 'old translation');
  manager.setupStorageListener();
  storageListener({ customEngine: { newValue: 'openai' } }, 'sync');
  assert.equal(manager.cache.size, 0);

  manager.cache.set('same paragraph', 'old translation');
  storageListener({ glossaryVersion: { newValue: 2 } }, 'local');
  assert.equal(manager.cache.size, 0);
  delete global.chrome;
});

test('capsule setting destroys and recreates the live capsule', () => {
  const manager = new PaperBilingualManager();
  let removed = false;
  manager.capsule = {
    destroy() { removed = true; }
  };
  manager.applyCapsuleEnabled(false);
  assert.equal(removed, true);
  assert.equal(manager.capsule, null);

  manager.initCapsule = function initCapsuleForTest() {
    this.capsule = { host: {} };
  };
  manager.applyCapsuleEnabled(true);
  assert.notEqual(manager.capsule, null);
});

test('expanded capsule stays inside the viewport at the right edge', () => {
  const position = getViewportSafePosition(
    { left: 1160, top: 420, width: 290, height: 300 },
    1280,
    800,
    8
  );
  assert.equal(position.left, 982);
  assert.equal(position.top, 420);
  assert.ok(position.left + 290 <= 1280 - 8);
  assert.ok(position.top + 300 <= 800 - 8);
});

test('expanded capsule stays positioned and remains draggable from its header', () => {
  assert.match(bilingualJs, /requestAnimationFrame\(\(\) => this\.keepPanelInViewport\(panel(?:, false)?\)\)/);
  assert.match(bilingualJs, /panel-header/);
  assert.match(bilingualJs, /this\.suppressPillClick/);
  assert.match(bilingualJs, /capsule-pill.*panel-header/s);
  assert.match(bilingualJs, /this\.host\.getBoundingClientRect\(\)/);
  assert.match(bilingualJs, /panelAnchorLeft/);
  assert.match(bilingualJs, /panelAnchorTop/);
});

test('popup exposes real API testing and glossary management controls', () => {
  assert.match(popupHtml, /id="btn-test-api"/);
  assert.match(popupHtml, /id="input-glossary-file"/);
  assert.match(popupHtml, /id="glossary-pack-list"/);
  assert.match(popupHtml, /id="user-glossary-list"/);
  assert.match(popupJs, /TEST_TRANSLATION_ENGINE/);
  assert.match(popupJs, /GlossaryService\.parse/);
});

test('popup recovers a missing content script and surfaces page connection errors', () => {
  assert.match(popupHtml, /src="tab_bridge\.js"/);
  assert.match(popupJs, /PaperDictTabBridge\.sendMessageWithRecovery/);
  assert.match(popupJs, /setBilingualStatus\(error\.message/);
});

test('content-script recovery is idempotent and uses the complete dependency list', () => {
  assert.match(bilingualJs, /reattachExistingManager\(global\.paperBilingualManager\)/);
  assert.doesNotMatch(backgroundJs, /chrome\.scripting\.executeScript/);
});

test('bilingual runtime listener can be safely reattached', () => {
  const listeners = new Set();
  global.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        hasListener(listener) { return listeners.has(listener); }
      }
    }
  };
  const manager = new PaperBilingualManager();
  manager.setupRuntimeListener();
  manager.setupRuntimeListener();
  assert.equal(listeners.size, 1);

  listeners.clear();
  manager.setupRuntimeListener();
  assert.equal(listeners.size, 1);
  delete global.chrome;
});

test('upgrades a legacy bilingual manager that lacks the new listener method', () => {
  const listeners = new Set();
  global.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        hasListener(listener) { return listeners.has(listener); }
      }
    }
  };
  const legacyManager = {
    mode: 'original',
    elements: [],
    setMode(mode) { this.mode = mode; },
    toggleMode() { this.mode = 'bilingual'; },
    getTranslatedCount() { return 0; }
  };

  assert.equal(reattachExistingManager(legacyManager), true);
  assert.equal(listeners.size, 1);
  let response;
  Array.from(listeners)[0]({ type: 'GET_BILINGUAL_MODE' }, {}, (value) => { response = value; });
  assert.deepEqual(response, { mode: 'original', total: 0, translated: 0 });
  delete global.chrome;
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
