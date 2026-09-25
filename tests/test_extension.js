/**
 * PaperDict - Extension Integrity and Functional Tests
 */

const fs = require('fs');
const path = require('path');
const { DictService, IRREGULAR_WORDS } = require('../extension/dict_service.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('=== Running PaperDict Test Suite ===\n');

// 1. Check manifest.json
console.log('[Test 1: Manifest V3 Schema & Assets]');
const manifestPath = path.join(__dirname, '../extension/manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.manifest_version === 3, 'manifest_version is 3');
assert(manifest.name && manifest.version, 'manifest has name and version');
assert(fs.existsSync(path.join(__dirname, '../extension', manifest.background.service_worker)), 'background service worker file exists');

for (const iconKey of Object.keys(manifest.icons)) {
  const iconPath = path.join(__dirname, '../extension', manifest.icons[iconKey]);
  assert(fs.existsSync(iconPath), `Icon exists: ${manifest.icons[iconKey]}`);
}

for (const cs of manifest.content_scripts) {
  for (const jsFile of cs.js) {
    const jsPath = path.join(__dirname, '../extension', jsFile);
    assert(fs.existsSync(jsPath), `Content script file exists: ${jsFile}`);
  }
}

// 2. Check Dictionary Data
console.log('\n[Test 2: Dictionary Integrity]');
const dictJsonPath = path.join(__dirname, '../extension/dict/academic_dict.json');
assert(fs.existsSync(dictJsonPath), 'academic_dict.json exists');
const dictData = JSON.parse(fs.readFileSync(dictJsonPath, 'utf8'));
const wordCount = Object.keys(dictData).length;
assert(wordCount >= 15000, `Dictionary contains ${wordCount} words (>= 15,000)`);

const glossaryPackIds = [
  'general-academic',
  'computer-ai',
  'materials-engineering',
  'biomedical',
  'economics-social-science'
];
for (const packId of glossaryPackIds) {
  const packPath = path.join(__dirname, `../extension/glossaries/${packId}.json`);
  assert(fs.existsSync(packPath), `Glossary pack exists: ${packId}`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  assert(pack.id === packId, `Glossary pack id matches filename: ${packId}`);
  assert(Array.isArray(pack.terms) && pack.terms.length >= 15, `Glossary pack has starter terms: ${packId}`);
  const normalizedSources = pack.terms.map((entry) => String(entry.source || '').trim().toLowerCase());
  assert(normalizedSources.every(Boolean), `Glossary pack sources are non-empty: ${packId}`);
  assert(new Set(normalizedSources).size === normalizedSources.length, `Glossary pack has no duplicate sources: ${packId}`);
  assert(pack.terms.every((entry) => String(entry.target || '').trim()), `Glossary pack targets are non-empty: ${packId}`);
}

// 3. Test DictService Preprocessing & Lookups
console.log('\n[Test 3: DictService Functionality]');
const service = new DictService(dictData);

// Test cleanPaperText with PDF linebreaks
const rawPdfText1 = 'This is a hypo-\n  thesis that we formulated.';
const cleaned1 = service.cleanPaperText(rawPdfText1, true);
assert(cleaned1 === 'This is a hypothesis that we formulated.', 'PDF cross-line hyphen correctly merged');

const rawPdfText2 = 'experi-\r\n  mental results';
const cleaned2 = service.cleanPaperText(rawPdfText2, true);
assert(cleaned2 === 'experimental results', 'CRLF hyphen correctly merged');

// Test isLookupEligible
assert(!service.isLookupEligible('[1]'), 'Citation [1] is not eligible');
assert(!service.isLookupEligible('2024'), 'Number 2024 is not eligible');
assert(!service.isLookupEligible('   '), 'Empty space is not eligible');
assert(!service.isLookupEligible('{};'), 'Code punctuation is not eligible');
assert(service.isLookupEligible('hypothesis'), 'Normal word is eligible');
assert(service.isLookupEligible('deep learning'), 'Phrase is eligible');

// Test lookupLocal exact
const resExact = service.lookupLocal('hypothesis');
assert(resExact && resExact.found && resExact.baseWord === 'hypothesis', 'Exact word lookup works for hypothesis');
assert(resExact.phonetic.length > 0, 'Phonetic symbol is present for hypothesis');
assert(resExact.translation.length > 0, 'Translation is present for hypothesis');

// Test lookupLocal inflected (plural)
const resPlural = service.lookupLocal('hypotheses');
assert(resPlural && resPlural.found && resPlural.baseWord === 'hypothesis', 'Plural hypotheses maps to hypothesis');

// Test lookupLocal inflected (past tense)
const resPast = service.lookupLocal('formulated');
assert(resPast && resPast.found && resPast.baseWord === 'formulate', 'formulated maps to formulate');

// Test lookupLocal inflected (academic terms)
const resAlgorithms = service.lookupLocal('algorithms');
assert(resAlgorithms && resAlgorithms.found && resAlgorithms.baseWord === 'algorithm', 'algorithms maps to algorithm');

// Test parseDefinitions
const defs = service.parseDefinitions('n. 假说，假设；vt. 提出假说');
assert(defs.length === 2, 'Parsed 2 part-of-speech definitions');
assert(defs[0].pos === 'n.' && defs[0].text.includes('假说'), 'n. definition parsed correctly');
assert(defs[1].pos === 'vt.' && defs[1].text.includes('提出假说'), 'vt. definition parsed correctly');

// 4. Test PDF URL Detection
console.log('\n[Test 4: PDF URL Detection]');
function isPdfUrl(url) {
  if (!url) return false;
  if (url.includes('reader/reader.html')) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith('.pdf')) return true;
    if (path.includes('/pdf/') || path.startsWith('/pdf/')) return true;
    if (u.searchParams.has('pdf') || (path.includes('pdf') && u.searchParams.has('id'))) return true;
  } catch (e) {
    if (/\.pdf($|[?#])/i.test(url)) return true;
  }
  return false;
}

assert(isPdfUrl('https://arxiv.org/pdf/1706.03762.pdf'), 'arXiv PDF with .pdf recognized');
assert(isPdfUrl('https://arxiv.org/pdf/1706.03762'), 'arXiv PDF without .pdf recognized');
assert(isPdfUrl('file:///C:/Users/name/paper.pdf'), 'Local file PDF recognized');
assert(isPdfUrl('https://openreview.net/pdf?id=B1lTeu8ye'), 'OpenReview PDF recognized');
assert(!isPdfUrl('https://arxiv.org/abs/1706.03762'), 'Abstract page is not recognized as PDF');
assert(!isPdfUrl('chrome-extension://abc/reader/reader.html?file=xyz'), 'Reader URL is not intercepted');

// 5. Test Phase 2 FormulaProtector & AcademicFilter
console.log('\n[Test 5: FormulaProtector & AcademicFilter (Phase 2)]');
const { FormulaProtector, AcademicFilter, PaperBilingualManager } = require('../extension/bilingual.js');

assert(typeof FormulaProtector === 'function', 'FormulaProtector is exported');
assert(typeof AcademicFilter === 'function', 'AcademicFilter is exported');
assert(typeof PaperBilingualManager === 'function', 'PaperBilingualManager is exported');

if (typeof FormulaProtector === 'function') {
  const fp = new FormulaProtector();

  // Test LaTeX protection
  const rawLatex = 'Let $E = mc^2$ and $$\\mathcal{L} = \\sum_{i=1}^n x_i$$ be the main loss.';
  const pLatex = fp.protect(rawLatex);
  assert(pLatex.tokenMap.size === 2, `FormulaProtector tokenized 2 formulas (found: ${pLatex.tokenMap.size})`);
  assert(!pLatex.protectedText.includes('mc^2'), 'Formula content replaced by token');
  
  // Test restoration
  const simulatedTranslated = pLatex.protectedText.replace('be the main loss', '作为主要损失函数');
  const restored = fp.restore(simulatedTranslated, pLatex.tokenMap);
  assert(restored.includes('$E = mc^2$'), 'Inline formula accurately restored');
  assert(restored.includes('$$\\mathcal{L} = \\sum_{i=1}^n x_i$$'), 'Display formula accurately restored');

  // Test Edge Case: Currency vs Math Formulas
  const currencySentence = 'We spent $10 on dataset A and $20 on dataset B.';
  const pCurrency = fp.protect(currencySentence);
  assert(pCurrency.tokenMap.size === 0, 'Standalone currency amounts are not treated as formulas');

  const mixedSentence = 'Total cost was $5,000 for training, where each epoch optimizes $\\mathcal{L}_{total}$.';
  const pMixed = fp.protect(mixedSentence);
  assert(pMixed.tokenMap.size === 1, 'Mixed sentence correctly tokenizes only the formula');
  assert(pMixed.protectedText.includes('$5,000'), 'Currency amount $5,000 is preserved in text');

  const rangeSentence = 'Values in range $0 \\le x \\le 1$ are normalized.';
  const pRange = fp.protect(rangeSentence);
  assert(pRange.tokenMap.size === 1, 'Formula starting with digit $0 \\le x \\le 1$ is recognized as formula');

  // Test Resilient Restoration from Translation Engine variations
  const mapWithTokens = new Map([
    ['PDMATH_0', { type: 'latex_inline', text: '$x$' }],
    ['PDMATH_1', { type: 'latex_inline', text: '$y$' }]
  ]);
  const engineVariation = '结果为 PD MATH 0 与 pdmath-1';
  const restoredVariation = fp.restore(engineVariation, mapWithTokens);
  assert(restoredVariation.includes('$x$') && restoredVariation.includes('$y$'), 'Resiliently restores varied tokens (PD MATH 0, pdmath-1)');
}

if (typeof AcademicFilter === 'function') {
  const filter = new AcademicFilter();
  
  // Test reference heading recognition
  assert(filter.isReferenceHeading('References'), 'References heading matched');
  assert(filter.isReferenceHeading('REFERENCES'), 'Uppercase REFERENCES heading matched');
  assert(filter.isReferenceHeading('5. Bibliography and Citations'), 'Bibliography heading matched');
  assert(filter.isReferenceHeading('VI. References'), 'Roman numeral VI. References matched');
  assert(filter.isReferenceHeading('[5] References'), 'Bracketed [5] References matched');
  assert(filter.isReferenceHeading('References and Notes'), 'References and Notes matched');
  assert(filter.isReferenceHeading('Literature Cited'), 'Literature Cited matched');
  
  // Test non-reference headings
  assert(!filter.isReferenceHeading('2. Method and Theoretical Formulation'), 'Method heading not matched as reference');
  assert(!filter.isReferenceHeading('References in Neural Networks: A Survey'), 'Paper title with References not matched');
  assert(!filter.isReferenceHeading('References to Prior Work'), 'References to Prior Work heading not matched');

  // Test table & figure tag and role exclusions
  const tableFigureTags = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'FIGURE', 'FIGCAPTION'];
  for (const tag of tableFigureTags) {
    assert(filter.excludedTags.has(tag), `Tag ${tag} should be in excludedTags`);
    assert(filter.isSelfStructurallyExcluded({ tagName: tag }), `Element <${tag}> structurally excluded`);
  }

  // Test ARIA roles
  const tableFigureRoles = ['figure', 'table', 'caption'];
  for (const role of tableFigureRoles) {
    assert(filter.isSelfStructurallyExcluded({ tagName: 'DIV', getAttribute: (k) => k === 'role' ? role : null }), `Role ${role} structurally excluded`);
  }

  // Test figure/table container class/id regex (should not match comfortable, portable, etc.)
  assert(filter.figureTableClassIdRegex.test('table-wrapper'), 'Matches table-wrapper');
  assert(filter.figureTableClassIdRegex.test('figure-container'), 'Matches figure-container');
  assert(filter.figureTableClassIdRegex.test('chart_box'), 'Matches chart_box');
  assert(filter.figureTableClassIdRegex.test('my-diagram'), 'Matches my-diagram');
  assert(filter.figureTableClassIdRegex.test('plot1'), 'Matches plot1');
  assert(!filter.figureTableClassIdRegex.test('comfortable'), 'Does not match comfortable');
  assert(!filter.figureTableClassIdRegex.test('portable-device'), 'Does not match portable-device');
  assert(!filter.figureTableClassIdRegex.test('configuration'), 'Does not match configuration');

  // Test figure/table captions
  assert(filter.isFigureOrTableCaption('Figure 1: Overall architecture of the model.'), 'Matches Figure 1:');
  assert(filter.isFigureOrTableCaption('Fig. 2. Convergence curve over 100 epochs.'), 'Matches Fig. 2.');
  assert(filter.isFigureOrTableCaption('Table 3. Quantitative results on ImageNet.'), 'Matches Table 3.');
  assert(filter.isFigureOrTableCaption('Tab. 4: Ablation study of loss functions.'), 'Matches Tab. 4:');
  assert(filter.isFigureOrTableCaption('Figure S1: Supplementary visual examples.'), 'Matches Figure S1:');
  assert(filter.isFigureOrTableCaption('Table A1: Hyperparameter configurations.'), 'Matches Table A1:');
  assert(filter.isFigureOrTableCaption('Figure 1 (a) Architecture pipeline.'), 'Caption with parenthesis delimiter matched');
  assert(filter.isFigureOrTableCaption('Figure 2 - Training loss and validation perplexity across training epochs.'), 'Caption with dash delimiter matched');
  assert(!filter.isFigureOrTableCaption('We summarize the results in the following section.'), 'Does not match ordinary prose');
  assert(!filter.isFigureOrTableCaption('Figure out the underlying cause before optimizing.'), 'Does not match "Figure out"');
  assert(!filter.isFigureOrTableCaption('Figure 1 shows that our method outperforms previous approaches by a large margin across all standard benchmarks.'), 'Prose starting with Figure 1 shows is not caption');
  assert(!filter.isFigureOrTableCaption('Fig. 1 illustrates the training pipeline of our proposed architecture.'), 'Prose starting with Fig. 1 illustrates is not caption');
  assert(!filter.isFigureOrTableCaption('Table 1 compares our method against several strong baselines on ImageNet.'), 'Prose starting with Table 1 compares is not caption');
  assert(!filter.isFigureOrTableCaption('Table ID is a unique integer identifier in the database schema.'), 'Prose starting with Table ID is not caption');

  // Test tabular data
  const pipeTable = `| Model | Accuracy | F1 Score |\n| ResNet | 76.5% | 0.74 |\n| Ours | 82.1% | 0.81 |`;
  assert(filter.isTabularData(pipeTable), 'Detects markdown pipe table');

  const tsvTable = `Method\tParams\tFPS\nBaseline\t25M\t60\nProposed\t18M\t95`;
  assert(filter.isTabularData(tsvTable), 'Detects TSV table');

  const numericDenseText = `12.5% 88.4 92.1 0.45 ± 0.02 99.1% N/A`;
  assert(filter.isTabularData(numericDenseText), 'Detects numeric dense token data');

  const normalProse = `In this paper, we propose a novel deep learning framework for zero-shot text translation. Our experiments show significant improvements over previous approaches.`;
  assert(!filter.isTabularData(normalProse), 'Prose is not tabular data');
}

// Test Reader.js PDF table and figure filtering
const readerModule = require('../extension/reader/reader.js');
if (readerModule) {
  assert(readerModule.isFigureOrTableCaption('Figure 1: Model architecture overview.'), 'Reader detects Figure caption');
  assert(readerModule.isFigureOrTableCaption('Table 2: Comparison with state-of-the-art methods.'), 'Reader detects Table caption');
  assert(!readerModule.isFigureOrTableCaption('The main results are demonstrated in subsequent sections.'), 'Reader does not detect regular text as caption');
  assert(!readerModule.isFigureOrTableCaption('Figure 1 shows that our model achieves higher accuracy across datasets.'), 'Reader does not detect Figure 1 shows as caption');
  assert(!readerModule.isFigureOrTableCaption('Table 2 summarizes the quantitative evaluation results on the test set.'), 'Reader does not detect Table 2 summarizes as caption');

  const mockTableItems = [
    { str: '| Baseline | 75.2 | 0.68 |', transform: [1, 0, 0, 1, 50, 700] },
    { str: '| Proposed | 81.4 | 0.79 |', transform: [1, 0, 0, 1, 50, 680] }
  ];
  const tableParas = readerModule.clusterItemsToParagraphs(mockTableItems);
  assert(tableParas.length === 0, 'Reader clusters out pipe table from translation paragraphs');

  const mockCaptionItems = [
    { str: 'Figure 1: Network architecture pipeline diagram.', transform: [1, 0, 0, 1, 50, 700] }
  ];
  const captionParas = readerModule.clusterItemsToParagraphs(mockCaptionItems);
  assert(captionParas.length === 0, 'Reader clusters out Figure caption from translation paragraphs');

  const mockProseItems = [
    { str: 'This paper presents an extensive empirical evaluation of deep representations across', transform: [1, 0, 0, 1, 50, 700] },
    { str: 'multiple vision benchmarks and confirms that scaling parameters enhances representation.', transform: [1, 0, 0, 1, 50, 685] }
  ];
  const proseParas = readerModule.clusterItemsToParagraphs(mockProseItems);
  assert(proseParas.length === 1, 'Reader retains valid prose paragraph');
}

// 6. Test Lifecycle & Cleanup in PaperBilingualManager
console.log('\n[Test 6: PaperBilingualManager Lifecycle & Observer Cleanup]');
if (typeof PaperBilingualManager === 'function') {
  const manager = new PaperBilingualManager();
  
  let disconnected = false;
  manager.observer = {
    disconnect: () => { disconnected = true; },
    observe: () => {}
  };

  // Simulate queued elements
  const mockEl = { id: 'mock-p' };
  manager.elements = [mockEl];
  manager.elementStateMap.set(mockEl, {
    state: 'queued',
    transEl: {
      classList: { contains: (cls) => cls === 'pd-bilingual-loading' },
      remove: () => {}
    }
  });
  manager.queue = [mockEl];

  // Call restoreOriginalView
  manager.restoreOriginalView();

  assert(disconnected, 'IntersectionObserver disconnected on restore');
  assert(manager.queue.length === 0, 'Queue cleared on restore');
  assert(manager.elementStateMap.get(mockEl).state === 'idle', 'Unfinished queued element reset to idle');
}

// 7. Test Code Syntax / Integrity of all JS files
console.log('\n[Test 7: JS Files Syntax Validation]');
const jsFiles = [
  'extension/background.js',
  'extension/bilingual.js',
  'extension/content.js',
  'extension/dict_service.js',
  'extension/glossary_service.js',
  'extension/translation_service.js',
  'extension/popup/popup.js',
  'extension/reader/reader.js'
];

for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  try {
    new Function(code);
    assert(true, `Syntax valid: ${f}`);
  } catch (err) {
    assert(false, `Syntax error in ${f}: ${err.message}`);
  }
}

console.log(`\n==============================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed successfully!');
}
