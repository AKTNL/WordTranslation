/**
 * Test Suite: PaperDict Academic Citation & Reference Parser (Phase 4 P1)
 */

const { CitationParser } = require('../extension/citation_parser.js');

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

console.log('=== Running Academic Citation Parser Tests ===\n');

// Test 1: Citation Marker Detection
console.log('[Test 1: isCitationMarker]');
assert(CitationParser.isCitationMarker('[1]'), '[1] is recognized as citation');
assert(CitationParser.isCitationMarker('[12]'), '[12] is recognized as citation');
assert(CitationParser.isCitationMarker('[1, 2]'), '[1, 2] is recognized as citation');
assert(CitationParser.isCitationMarker('[3-5]'), '[3-5] is recognized as range citation');
assert(CitationParser.isCitationMarker('[12, 14, 18]'), '[12, 14, 18] is recognized as multi-citation');
assert(!CitationParser.isCitationMarker('hypothesis'), 'Normal word is not citation');
assert(!CitationParser.isCitationMarker('[abc]'), 'Letters inside brackets are not numeric citation');
assert(!CitationParser.isCitationMarker('2024'), 'Plain numbers are not citation');

// Test 2: Number range parsing
console.log('\n[Test 2: parseCitationNumbers]');
const nums1 = CitationParser.parseCitationNumbers('[12]');
assert(nums1.length === 1 && nums1[0] === '12', 'Single number parsed');

const nums2 = CitationParser.parseCitationNumbers('[1, 2, 5]');
assert(nums2.length === 3 && nums2[1] === '2', 'Comma list parsed');

const nums3 = CitationParser.parseCitationNumbers('[3-6]');
assert(nums3.length === 4 && nums3[0] === '3' && nums3[3] === '6', 'Hyphenated range expanded');

// Test 3: Reference Extraction from Paper Text
console.log('\n[Test 3: Extract References from Paper]');
const samplePaperText = `
6. Conclusion
We presented a novel neural framework.

REFERENCES
[1] A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, L. Kaiser, and I. Polosukhin, "Attention is all you need," Advances in Neural Information Processing Systems, 2017. arXiv:1706.03762.
[2] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, "BERT: Pre-training of deep bidirectional transformers for language understanding," NAACL, 2019. 10.18653/v1/N19-1423.
[3] T. Brown et al., "Language models are few-shot learners," NeurIPS, 2020.
`;

const parser = new CitationParser();
const refs = parser.extractFromText(samplePaperText);

assert(refs.length === 3, `Extracted 3 references from text (found: ${refs.length})`);

const ref1 = parser.lookup('[1]');
assert(ref1.length === 1, 'Lookup [1] returns entry');
assert(ref1[0].title === 'Attention is all you need', 'Ref 1 title accurately extracted');
assert(ref1[0].year === '2017', 'Ref 1 year accurately extracted');
assert(ref1[0].arxiv === '1706.03762', 'Ref 1 arXiv ID extracted');
assert(ref1[0].scholarUrl.includes('scholar.google.com'), 'Ref 1 Google Scholar link generated');

const refMulti = parser.lookup('[1, 2]');
assert(refMulti.length === 2, 'Multi-citation lookup returns 2 entries');
assert(refMulti[1].title.includes('BERT'), 'Ref 2 title extracted');
assert(refMulti[1].doi === '10.18653/v1/N19-1423', 'Ref 2 DOI extracted');

console.log(`\n==============================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
