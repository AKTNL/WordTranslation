/**
 * Test Suite: Highlight segments, translucent marks, refresh restore,
 * PDF -> HTML view mode and the unified Markdown export schema.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const selectionAnchor = require('../extension/selection_anchor.js');
const { AnnotationManager, HIGHLIGHT_COLORS } = require('../extension/annotation_manager.js');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ FAIL: ${name} -> ${err.message}`);
  }
}

const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const readerJs = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.js'), 'utf8');
const readerHtml = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.html'), 'utf8');
const readerCss = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.css'), 'utf8');
const bilingualJs = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');
const selectionAnchorJs = fs.readFileSync(path.join(__dirname, '../extension/selection_anchor.js'), 'utf8');
const readerModule = require('../extension/reader/reader.js');

console.log('=== Running PaperDict Highlight, HTML View & Export Tests ===\n');

console.log('[Group 1: Whitespace normalization helper]');
it('collapses whitespace runs and trims', () => {
  assert.equal(selectionAnchor.normalizeWhitespace('  a\n\n b\tc  '), 'a b c');
});
it('handles null and undefined safely', () => {
  assert.equal(selectionAnchor.normalizeWhitespace(null), '');
  assert.equal(selectionAnchor.normalizeWhitespace(undefined), '');
});
it('exports the new anchor helpers', () => {
  assert.equal(typeof selectionAnchor.splitRangeIntoSegments, 'function');
  assert.equal(typeof selectionAnchor.locateTextSegments, 'function');
  assert.equal(typeof selectionAnchor.normalizeWhitespace, 'function');
  assert.equal(typeof selectionAnchor.normalizePaperMatch, 'function');
  assert.equal(typeof selectionAnchor.normalizeTextIndex, 'function');
});

console.log('\n[Group 2: Translucent highlight styling]');
it('content.js injects a dedicated highlight stylesheet', () => {
  assert.match(contentJs, /HIGHLIGHT_STYLE_ID = 'paperdict-highlight-styles'/);
  assert.match(contentJs, /function ensureHighlightStyles\(\)/);
});
it('all four highlight fills are translucent', () => {
  const fills = [
    'rgba(254, 240, 138, 0.45)',
    'rgba(187, 247, 208, 0.45)',
    'rgba(191, 219, 254, 0.45)',
    'rgba(251, 207, 232, 0.45)'
  ];
  for (const fill of fills) {
    assert.ok(contentJs.includes(fill), `missing translucent fill ${fill}`);
  }
});
it('annotation color definitions expose translucent bg and a solid swatch', () => {
  for (const key of ['yellow', 'green', 'blue', 'pink']) {
    assert.match(HIGHLIGHT_COLORS[key].bg, /^rgba\(/, `${key} bg must be translucent`);
    assert.match(HIGHLIGHT_COLORS[key].solid, /^#[0-9a-f]{6}$/i, `${key} solid swatch missing`);
  }
});
it('marks clone their decoration across line breaks', () => {
  assert.match(contentJs, /box-decoration-break: clone/);
});
it('highlight creation no longer writes an opaque inline background', () => {
  assert.doesNotMatch(contentJs, /mark\.style\.backgroundColor = colorBg/);
});

console.log('\n[Group 3: Cross-line highlight segments]');
it('ranges are split into per-text-node segments before wrapping', () => {
  assert.match(contentJs, /splitRangeIntoSegments\(targetRange\)/);
  assert.match(contentJs, /function wrapSegment\(segment, annotationId, colorKey\)/);
});
it('each segment is wrapped and its text stored', () => {
  assert.match(contentJs, /segmentTexts\.push\(text\)/);
  assert.match(contentJs, /segments: segmentTexts/);
});
it('aborts without storing when nothing could be wrapped', () => {
  assert.match(contentJs, /if \(createdMarks\.length === 0\) return null;/);
});
it('clearing removes every segment mark of the annotation', () => {
  assert.match(contentJs, /function queryAnnotationMarks\(annotationId, root = null\)/);
  assert.match(contentJs, /for \(const mark of marksToClear\) unwrapMark\(mark\)/);
});

console.log('\n[Group 4: Refresh restore wiring]');
it('restores cross-node annotations via a shared, view-scoped text index', () => {
  assert.match(contentJs, /function restoreAnnotation\(anno, restoreCtx\)/);
  assert.match(contentJs, /findInTextIndex\(index, text, cursor\)/);
  assert.match(contentJs, /function resolveHighlightContext\(\)/);
  assert.match(contentJs, /buildTextIndex\(highlightCtx\.root, \{ skipSelector: highlightCtx\.skipSelector \}\)/);
  assert.match(contentJs, /queryAnnotationMarks\(anno\.id, restoreCtx\.root\)/);
});
it('re-runs restore on DOM mutation, debounced', () => {
  assert.match(contentJs, /new MutationObserver/);
  assert.match(contentJs, /function setupHighlightRestoreObserver\(\)/);
  assert.match(contentJs, /function scheduleRestore\(delay = 400\)/);
});
it('exposes a restore hook for other modules', () => {
  assert.match(contentJs, /window\.__paperDictRestoreHighlights =/);
  assert.match(bilingualJs, /window\.__paperDictRestoreHighlights\(300\)/);
});
it('re-applies highlights when a page is re-activated', () => {
  assert.match(contentJs, /scheduleRestore\(200\);[\s\S]{0,120}选词即可查词/);
});
it('restores only while the page is active', () => {
  assert.match(contentJs, /async function restorePageHighlights\(\) \{[\s\S]{0,220}?if \(!pageActive\) return;/);
});
it('prefers a reader-supplied document identity', () => {
  assert.match(contentJs, /function resolveDocKey\(\)/);
  assert.match(contentJs, /window\.__paperDictDocKey/);
  assert.match(readerJs, /function setReaderDocIdentity\(name, url\)/);
});

console.log('\n[Group 5: PDF -> HTML view mode]');
it('reader exposes a reflowed HTML document builder', () => {
  assert.match(readerJs, /async function buildHtmlDocument\(\)/);
  assert.match(readerJs, /p\.className = 'pdf-html-para'/);
  assert.match(readerJs, /clusterPdfTextIntoParagraphs\(textContent\)/);
});
it('reader toggles between page and HTML views', () => {
  assert.match(readerJs, /function setViewMode\(mode\)/);
  assert.match(readerJs, /btnViewHtml\.addEventListener\('click'/);
});
it('toolbar and styles for the view switch exist', () => {
  assert.ok(readerHtml.includes('id="view-mode-controls"'));
  assert.ok(readerHtml.includes('id="btn-view-html"'));
  assert.ok(readerHtml.includes('id="btn-view-page"'));
  assert.match(readerCss, /\.pdf-html-view \{/);
  assert.match(readerCss, /\.pdf-html-para \{/);
});

console.log('\n[Group 5b: View-scoped restore and cross-view matching]');
it('scopes restore to the active view context', () => {
  assert.match(contentJs, /function resolveHighlightContext\(\)/);
  assert.match(contentJs, /window\.__paperDictHighlightContext/);
  assert.match(readerJs, /window\.__paperDictHighlightContext = resolveHighlightRootContext/);
  assert.match(readerJs, /skipSelector: '\.pdf-html-view'/);
});
it('falls back across reader views with normalized quotes', () => {
  assert.match(contentJs, /normalizePaperMatch\(storedSegments\.join\(' '\)\)/);
  assert.match(contentJs, /restoreCtx\.normalizedIndex = normalizeTextIndex\(index\)/);
});
it('normalizes typographic characters and hyphenated line breaks', () => {
  assert.equal(selectionAnchor.normalizePaperMatch('“Trans-\nformer” – a model'), '"Transformer" - a model');
  assert.equal(selectionAnchor.normalizePaperMatch('transla-\ntion of words'), 'translation of words');
  assert.equal(selectionAnchor.normalizePaperMatch(null), '');
  assert.equal(selectionAnchor.normalizePaperMatch('state-of-the-art'), 'state-of-the-art');
});
it('normalizes a text index while keeping node mappings', () => {
  const fakeMap = 'ab- cd'.split('').map((ch, i) => ({ node: 'n1', index: i }));
  const normalized = selectionAnchor.normalizeTextIndex({ text: 'ab- cd', map: fakeMap });
  assert.equal(normalized.text, 'abcd');
  assert.equal(normalized.map.length, normalized.text.length);
  assert.equal(normalized.map[0].index, 0);
  assert.equal(normalized.map[2].index, 4, 'character after the join keeps its original offset');
  assert.equal(selectionAnchor.normalizeTextIndex(null), null);
});

console.log('\n[Group 5c: Reader notes interop and live refresh]');
it('re-reads storage before listing notes and exporting', () => {
  assert.match(readerJs, /async function updateReaderNotes\(\) \{[\s\S]{0,400}?await annotationManager\.loadAll\(\)/);
  assert.match(readerJs, /await annotationManager\.loadAll\(\);\r?\n\s+const docKey = getReaderDocKey\(\)/);
});
it('content.js broadcasts annotation changes for in-page listeners', () => {
  assert.match(contentJs, /function notifyAnnotationsChanged\(\)/);
  assert.match(contentJs, /paperdict:annotations-changed/);
  assert.match(readerJs, /window\.addEventListener\('paperdict:annotations-changed'/);
});
it('page mode re-restores highlights once pages re-render', () => {
  assert.match(readerJs, /Promise\.all\(pending\)\.then\(\(\) => \{[\s\S]{0,160}?__paperDictRestoreHighlights\(80\)/);
});
it('glossary terms are broadcast from the reader to content lookups', () => {
  assert.match(readerJs, /function broadcastPaperGlossary\(\)/);
  assert.match(readerJs, /paperdict:glossary-updated/);
  assert.match(contentJs, /paperdict:glossary-updated/);
});

console.log('\n[Group 5d: HTML view feature parity]');
it('notes and glossary buttons stay available in HTML mode', () => {
  assert.ok(readerHtml.includes('id="zoom-buttons"'));
  assert.match(readerJs, /if \(zoomButtons\) zoomButtons\.style\.display = nextMode === 'page' \? 'inline-flex' : 'none';/);
});
it('HTML paragraphs get lazy bilingual blocks reusing the reader pipeline', () => {
  assert.match(readerJs, /async function translateHtmlParagraph\(p, info\)/);
  assert.match(readerJs, /div\.className = 'pdf-html-trans'/);
  assert.match(readerJs, /reader_html_p\$\{info\.pageNumber/);
  assert.match(readerJs, /function setupHtmlBilingualObserver\(\)/);
  assert.match(readerJs, /function applyHtmlBilingualMode\(\)/);
  assert.equal(typeof readerModule.translateHtmlParagraph, 'function');
  assert.equal(readerModule.htmlParaItems instanceof Map, true);
  assert.match(readerCss, /\.pdf-html-trans \{/);
  assert.match(readerCss, /\.pdf-html-para\.pdf-html-orig-hidden \{/);
});
it('page navigation follows the reflowed view', () => {
  assert.match(readerJs, /function setupHtmlPageObserver\(\)/);
  assert.match(readerJs, /\.pdf-html-page\[data-page-number="\$\{p\}"\]/);
});
it('translation blocks are skipped by highlight matching', () => {
  assert.match(selectionAnchorJs, /\.pdf-html-trans/);
  assert.match(selectionAnchorJs, /\.pdf-page-bilingual/);
});

console.log('\n[Group 6: Unified Markdown export]');
it('single and multi exports share frontmatter keys', () => {
  const single = AnnotationManager.exportToMarkdown(
    [{ docKey: 'd1', docTitle: 'Paper One', text: 'quote one', color: 'yellow', createdAt: Date.UTC(2024, 0, 2) }],
    'Paper One',
    { url: 'https://example.com/paper-one' }
  );
  const multi = AnnotationManager.exportToMarkdown(
    [
      { docKey: 'd1', docTitle: 'Paper Alpha', text: 'Alpha quote', color: 'yellow' },
      { docKey: 'd2', docTitle: 'Paper Beta', text: 'Beta quote', color: 'blue' }
    ],
    'Digest',
    { isMultiDoc: true }
  );
  for (const out of [single, multi]) {
    assert.ok(out.includes('export_tool: PaperDict'), 'export_tool key missing');
    assert.ok(out.includes('total_papers:'), 'total_papers key missing');
    assert.ok(out.includes('total_annotations:'), 'total_annotations key missing');
    assert.ok(out.includes('  - paperdict'), 'shared tag list missing');
  }
});
it('single export keeps its heading, url and ISO dates', () => {
  const single = AnnotationManager.exportToMarkdown(
    [{ docKey: 'd1', docTitle: 'Paper One', text: 'quote one', color: 'yellow', createdAt: Date.UTC(2024, 0, 2) }],
    'Paper One',
    { url: 'https://example.com/paper-one' }
  );
  assert.ok(single.includes('# 学术论文阅读笔记: Paper One'));
  assert.ok(single.includes('url: "https://example.com/paper-one"'));
  assert.ok(single.includes('(2024-01-02)'), 'item date should be ISO');
  assert.doesNotMatch(single, /\((?:1|2)\d\/\d{1,2}\/\d{4}\)/, 'no locale date in items');
});
it('multi export groups documents and omits the single url key', () => {
  const multi = AnnotationManager.exportToMarkdown(
    [
      { docKey: 'd1', docTitle: 'Paper Alpha', text: 'Alpha quote', color: 'yellow' },
      { docKey: 'd2', docTitle: 'Paper Beta', text: 'Beta quote', color: 'blue' }
    ],
    'Digest',
    { isMultiDoc: true }
  );
  assert.ok(multi.includes('## 1. Paper Alpha'));
  assert.ok(multi.includes('## 2. Paper Beta'));
  assert.ok(multi.includes('Alpha quote') && multi.includes('Beta quote'));
  assert.doesNotMatch(multi, /^url:/m);
});
it('table cells escape pipes', () => {
  const out = AnnotationManager.exportToMarkdown([], 'P', {
    glossary: [{ term: 'A|B', definition: 'x|y', sentence: 's|t' }]
  });
  assert.ok(out.includes('\\|'), 'pipes should be escaped in glossary tables');
});

async function runAsync() {
  console.log('\n[Group 7: Document identity and segment persistence]');
  try {
    assert.equal(
      AnnotationManager.getDocKey('chrome-extension://abc/reader/reader.html?file=https%3A%2F%2Farxiv.org%2Fpdf%2F2303.08774.pdf'),
      'arxiv:2303.08774',
      'reader ?file= arXiv PDF keys off the arXiv id'
    );
    passed++; console.log('  ✓ PASS: reader ?file= resolves to the underlying paper key');
  } catch (err) { failed++; console.error(`  ✗ FAIL: reader ?file= resolves to the underlying paper key -> ${err.message}`); }

  try {
    assert.equal(
      AnnotationManager.getDocKey('chrome-extension://abc/reader/reader.html?file=https://www.nature.com/articles/x.pdf'),
      'pdf:x.pdf',
      'reader ?file= web PDF keys off the file name'
    );
    passed++; console.log('  ✓ PASS: reader ?file= web PDF keys off the file name');
  } catch (err) { failed++; console.error(`  ✗ FAIL: reader ?file= web PDF keys off the file name -> ${err.message}`); }

  try {
    assert.equal(
      AnnotationManager.getDocKey('chrome-extension://abc/reader/reader.html', 'transformer.pdf - PaperDict 阅读器'),
      'pdf:transformer.pdf',
      'reader without ?file= falls back to the PDF file name'
    );
    passed++; console.log('  ✓ PASS: reader without ?file= falls back to the PDF file name');
  } catch (err) { failed++; console.error(`  ✗ FAIL: reader without ?file= falls back to the PDF file name -> ${err.message}`); }

  try {
    assert.equal(AnnotationManager.getDocKey('', 'attention.pdf'), 'pdf:attention.pdf', 'empty url + pdf title');
    passed++; console.log('  ✓ PASS: empty url plus PDF title keys off the file name');
  } catch (err) { failed++; console.error(`  ✗ FAIL: empty url plus PDF title keys off the file name -> ${err.message}`); }

  try {
    assert.equal(
      AnnotationManager.getDocKey('chrome-extension://abc/reader/reader.html?file=https://www.nature.com/articles/y.pdf'),
      AnnotationManager.getDocKey('chrome-extension://other/reader/reader.html?file=https://www.nature.com/articles/y.pdf'),
      'the same PDF keys identically regardless of extension id'
    );
    passed++; console.log('  ✓ PASS: same PDF keys identically across extension ids');
  } catch (err) { failed++; console.error(`  ✗ FAIL: same PDF keys identically across extension ids -> ${err.message}`); }

  try {
    const mgr = new AnnotationManager();
    const saved = await mgr.saveAnnotation({ docKey: 'k', docTitle: 'Test Doc', text: 'a b', segments: ['a', 'b'], color: 'green' });
    assert.deepEqual(saved.segments, ['a', 'b'], 'segments persisted on create');
    const updated = await mgr.saveAnnotation({ id: saved.id, docKey: 'k', docTitle: 'Test Doc', text: 'a b', color: 'blue' });
    assert.deepEqual(updated.segments, ['a', 'b'], 'segments preserved when omitted on update');
    const fetched = await mgr.getAnnotationsForDoc('k');
    assert.deepEqual(fetched[0].segments, ['a', 'b'], 'segments round-trip through storage');
    passed++; console.log('  ✓ PASS: highlight segments persist and survive updates');
  } catch (err) { failed++; console.error(`  ✗ FAIL: highlight segments persist and survive updates -> ${err.message}`); }

  // Group 8: Reflowed-view paragraph translation (shared pipeline)
  try {
    const sent = [];
    global.chrome = {
      runtime: {
        sendMessage: async (message) => {
          sent.push(message);
          return { success: true, translation: `译: ${message.text}` };
        }
      }
    };
    const transEl = { innerHTML: '', querySelector: () => null, style: {} };
    const pStub = { classList: { add() {}, remove() {} }, parentNode: null };
    const info = { orig: 'A reflowed paragraph.', status: 'idle', transEl, pageNumber: 2, index: 1 };
    await readerModule.translateHtmlParagraph(pStub, info);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'TRANSLATE_ONLINE');
    assert.match(sent[0].requestId, /^reader_html_p2_1_\d+$/);
    assert.equal(info.status, 'done');
    assert.equal(info.trans, '译: A reflowed paragraph.');
    assert.equal(transEl.innerHTML, '译: A reflowed paragraph.');
    passed++; console.log('  ✓ PASS: reflowed HTML paragraphs translate through the shared pipeline');
  } catch (err) {
    failed++; console.error(`  ✗ FAIL: reflowed HTML paragraph translation -> ${err.message}`);
  } finally {
    delete global.chrome;
  }

  console.log('\n==============================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAsync().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
