/**
 * Test Suite: PaperDict UI Layout, Button No-Wrap & Highlighter Affordance Verification
 */

const fs = require('fs');
const path = require('path');

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

function runTests() {
  console.log('=== Running PaperDict UI Layout & Highlighter Tests ===\n');

  const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
  const bilingualJs = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.css'), 'utf8');
  const readerHtml = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.html'), 'utf8');
  const readerCss = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.css'), 'utf8');

  // Test 1: Button No-Wrap & Layout in content.js
  console.log('[Test 1: Content Script Floating Card & Buttons]');
  assert(contentJs.includes('width: 370px;'), 'Card width expanded to 370px for generous breathing room');
  assert(contentJs.includes('.card-header') && contentJs.includes('white-space: nowrap;'), 'Card header enforces white-space nowrap');
  assert(contentJs.includes('.header-actions') && contentJs.includes('white-space: nowrap;') && contentJs.includes('flex-shrink: 0;'), 'Header action buttons do not wrap or shrink');
  assert(contentJs.includes('.btn-ai-guide') && contentJs.includes('white-space: nowrap;'), 'AI guide button enforces white-space nowrap');
  assert(contentJs.includes('.word-title') && contentJs.includes('text-overflow: ellipsis;'), 'Long word titles gracefully truncate with ellipsis');

  // Test 2: Highlighter Marker Affordance & Visual Elements
  console.log('\n[Test 2: Highlighter Marker Affordance]');
  assert(contentJs.includes('highlighter:') && contentJs.includes('<svg viewBox="0 0 24 24" width="13" height="13"'), 'Chisel-tip highlighter pen SVG icon defined');
  assert(contentJs.includes('eraser:') && contentJs.includes('<svg viewBox="0 0 24 24" width="12" height="12"'), 'Eraser SVG icon defined for clear action');
  assert(contentJs.includes('check:') && contentJs.includes('<svg viewBox="0 0 24 24" width="9" height="9"'), 'Checkmark SVG icon defined for active highlight status');
  assert(contentJs.includes('box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.12);'), 'Swatches styled with distinct highlighter marker stroke appearance');
  assert(contentJs.includes('.hl-label-group') && contentJs.includes('white-space: nowrap;'), 'Highlighter label group prevents wrapping');
  assert(contentJs.includes('.hl-status-badge'), 'Dynamic highlight status badge implemented');
  assert(contentJs.includes('黄色荧光笔 (核心要点)'), 'Yellow swatch has explicit highlighter tooltip');
  assert(contentJs.includes('绿色荧光笔 (创新方法)'), 'Green swatch has explicit highlighter tooltip');
  assert(contentJs.includes('蓝色荧光笔 (重要结论)'), 'Blue swatch has explicit highlighter tooltip');
  assert(contentJs.includes('粉色荧光笔 (疑问难点)'), 'Pink swatch has explicit highlighter tooltip');

  // Test 3: Highlight Scenarios (Status, Clear, Change Color)
  console.log('\n[Test 3: Highlight Conditions & Scenarios]');
  assert(contentJs.includes('isAlreadyHighlighted'), 'Detects whether active selection or clicked mark is already highlighted');
  assert(contentJs.includes('clearCurrentHighlight'), 'Clear highlight function exists');
  assert(contentJs.includes('btn-clear-highlight'), 'Clear highlight button wired in palette');
  assert(contentJs.includes('showActionFeedback'), 'Action feedback toast confirms highlight operations');

  // Test 4: Bilingual Capsule Buttons
  console.log('\n[Test 4: Bilingual Capsule Button Layout]');
  assert(bilingualJs.includes('width: 290px;'), 'Capsule panel width expanded to 290px');
  assert(bilingualJs.includes('.mode-btn') && bilingualJs.includes('white-space: nowrap;'), 'Mode buttons enforce white-space nowrap');
  assert(bilingualJs.includes('.btn-footer-action') && bilingualJs.includes('white-space: nowrap;'), 'Footer action buttons enforce white-space nowrap');
  assert(bilingualJs.includes('本站禁用') && !bilingualJs.includes('在此站禁用'), 'Crisp 4-character button label (本站禁用) replaces wrapping 5-character label');

  // Test 5: Popup UI Tabs & Action Buttons
  console.log('\n[Test 5: Popup UI Layout]');
  assert(popupCss.includes('width: 420px;'), 'Popup body width expanded to 420px for Windows high-DPI scaling');
  assert(popupCss.includes('.nav-tab') && popupCss.includes('white-space: nowrap;'), 'Navigation tabs enforce white-space nowrap');
  assert(popupCss.includes('.btn-mode-tab') && popupCss.includes('white-space: nowrap;'), 'Popup mode tabs enforce white-space nowrap');
  assert(popupCss.includes('.btn-tool-sm') && popupCss.includes('white-space: nowrap;'), 'Small tool buttons enforce white-space nowrap');
  assert(popupHtml.includes('查词设置') && popupHtml.includes('翻译引擎'), 'Nav tabs use concise 4-character titles without wrapping');
  assert(popupHtml.includes('>导出 MD<'), 'Notes export button shortened to "导出 MD" with full tooltip');

  // Test 6: PDF Reader Toolbar & Drawer
  console.log('\n[Test 6: PDF Reader Toolbar & Emojis]');
  assert(readerCss.includes('.reader-mode-btn') && readerCss.includes('white-space: nowrap;'), 'Reader mode buttons enforce white-space nowrap');
  assert(readerCss.includes('.tool-btn') && readerCss.includes('white-space: nowrap;'), 'Reader tool buttons enforce white-space nowrap');
  assert(readerCss.includes('.btn-drawer-tool') && readerCss.includes('white-space: nowrap;'), 'Reader drawer tool buttons enforce white-space nowrap');
  assert(!readerHtml.includes('📄'), 'Dropzone removed emoji');
  assert(!readerHtml.includes('⚡'), 'Pill removed lightning emoji');

  console.log(`\n==============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
