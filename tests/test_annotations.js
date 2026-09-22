/**
 * Test Suite: PaperDict Annotation & Highlight Manager (Phase 2 P0)
 */

const { AnnotationManager, HIGHLIGHT_COLORS } = require('../extension/annotation_manager.js');

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

async function runTests() {
  console.log('=== Running Annotation & Highlight Tests ===\n');

  // Test 1: DocKey Normalization
  console.log('[Test 1: DocKey Normalization]');
  assert(
    AnnotationManager.getDocKey('https://arxiv.org/abs/2303.08774') === 'arxiv:2303.08774',
    'arXiv abstract URL canonicalized to arXiv ID'
  );
  assert(
    AnnotationManager.getDocKey('https://arxiv.org/pdf/2303.08774v2.pdf') === 'arxiv:2303.08774v2',
    'arXiv PDF URL canonicalized to arXiv ID'
  );
  assert(
    AnnotationManager.getDocKey('file:///home/user/papers/transformer.pdf') === 'pdf:transformer.pdf',
    'Local PDF path canonicalized to PDF filename'
  );
  assert(
    AnnotationManager.getDocKey('https://www.nature.com/articles/s41586-024') === 'www.nature.com/articles/s41586-024',
    'Web article URL canonicalized'
  );

  // Test 2: Color Definitions
  console.log('\n[Test 2: Highlight Color Definitions]');
  assert(HIGHLIGHT_COLORS.yellow && HIGHLIGHT_COLORS.yellow.bg, 'Yellow color defined');
  assert(HIGHLIGHT_COLORS.green && HIGHLIGHT_COLORS.green.bg, 'Green color defined');
  assert(HIGHLIGHT_COLORS.blue && HIGHLIGHT_COLORS.blue.bg, 'Blue color defined');
  assert(HIGHLIGHT_COLORS.pink && HIGHLIGHT_COLORS.pink.bg, 'Pink color defined');

  // Test 3: Annotation CRUD Operations
  console.log('\n[Test 3: Annotation CRUD Operations]');
  const mgr = new AnnotationManager();

  const anno1 = await mgr.saveAnnotation({
    docKey: 'arxiv:1706.03762',
    docTitle: 'Attention Is All You Need',
    text: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks',
    color: 'yellow',
    note: '经典 Transformer 开篇论述'
  });

  assert(anno1 && anno1.id, 'Annotation created with ID');
  assert(anno1.color === 'yellow', 'Highlight color preserved');
  assert(anno1.note === '经典 Transformer 开篇论述', 'Note text preserved');

  const anno2 = await mgr.saveAnnotation({
    docKey: 'arxiv:1706.03762',
    docTitle: 'Attention Is All You Need',
    text: 'Multi-Head Attention allows the model to jointly attend to information from different representation subspaces',
    color: 'green',
    note: 'MHA 核心创新机制'
  });

  const docAnnos = await mgr.getAnnotationsForDoc('arxiv:1706.03762');
  assert(docAnnos.length === 2, 'Retrieved 2 annotations for target paper');

  const grouped = await mgr.getAllGroupedByDoc();
  assert(grouped.length === 1 && grouped[0].items.length === 2, 'Grouped by doc correctly');

  // Test 4: Delete Annotation
  console.log('\n[Test 4: Delete Annotation]');
  await mgr.deleteAnnotation(anno1.id);
  const remaining = await mgr.getAnnotationsForDoc('arxiv:1706.03762');
  assert(remaining.length === 1 && remaining[0].id === anno2.id, 'Annotation successfully deleted');

  // Test 5: Markdown Export
  console.log('\n[Test 5: Markdown & JSON Export]');
  const md = AnnotationManager.exportToMarkdown([anno2], 'Attention Is All You Need', {
    url: 'https://arxiv.org/abs/1706.03762',
    glossary: [{ term: 'MHA', definition: 'Multi-Head Attention', sentence: 'Multi-Head Attention allows the model...' }]
  });
  assert(md.includes('# 学术论文阅读笔记: Attention Is All You Need'), 'Markdown title formatted');
  assert(md.includes('[创新方法]'), 'Color tag formatted in Markdown');
  assert(md.includes('MHA 核心创新机制'), 'Note comment included in Markdown');
  assert(md.includes('Multi-Head Attention'), 'Original quote block included');
  assert(md.includes('url: "https://arxiv.org/abs/1706.03762"'), 'YAML frontmatter includes paper URL');
  assert(md.includes('## 本篇论文专有术语与缩写表 (Paper Glossary)'), 'Glossary section included');
  assert(md.includes('| **MHA** | Multi-Head Attention |'), 'Glossary table row formatted');

  const json = AnnotationManager.exportToJson([anno2]);
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed) && parsed[0].id === anno2.id, 'JSON exported and parsed correctly');

  // Test 6: Multi-Document Digest Export
  console.log('\n[Test 6: Multi-Document Digest Export]');
  const multiMd = AnnotationManager.exportToMarkdown([
    { docKey: 'doc1', docTitle: 'Paper Alpha', text: 'Alpha quote', color: 'yellow' },
    { docKey: 'doc2', docTitle: 'Paper Beta', text: 'Beta quote', color: 'green' }
  ], '学术文献阅读与批注集锦');
  assert(multiMd.includes('## 1. Paper Alpha'), 'Doc 1 grouped under numbered heading');
  assert(multiMd.includes('## 2. Paper Beta'), 'Doc 2 grouped under separate numbered heading');
  assert(multiMd.includes('Alpha quote') && multiMd.includes('Beta quote'), 'All quotes preserved in digest');

  // Test 7: WordBook Markdown Export
  console.log('\n[Test 7: WordBook Markdown Export]');
  const wbMd = AnnotationManager.exportWordBookToMarkdown([
    { word: 'hypothesis', phonetic: 'haɪˈpɒθəsɪs', translation: 'n. 假说，假设' },
    { word: 'formulate', phonetic: 'ˈfɔːmjuleɪt', translation: 'vt. 构想，制定' }
  ]);
  assert(wbMd.includes('# PaperDict 学术生词本 (共 2 词)'), 'Wordbook title formatted');
  assert(wbMd.includes('| 1 | **hypothesis** | /haɪˈpɒθəsɪs/ | n. 假说，假设 |'), 'Wordbook table row formatted');

  console.log(`\n==============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
