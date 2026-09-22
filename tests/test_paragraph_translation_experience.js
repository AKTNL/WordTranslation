const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

let selectionAnchorHelpers = {};
try {
  selectionAnchorHelpers = require('../extension/selection_anchor.js');
} catch (error) {
  // Individual tests below report the missing public API as assertion failures.
}

const { createRangeAnchor, isSelectionNavigationKey } = selectionAnchorHelpers;

test('exports the selection anchor helpers', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(globalThis.PaperDictSelectionAnchor, selectionAnchorHelpers);
});

test('rejects missing or unusable ranges', () => {
  assert.equal(createRangeAnchor(null), null);
  assert.equal(createRangeAnchor({}), null);
});

test('ignores keyboard events whose key is missing or not a string', () => {
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(isSelectionNavigationKey({}), false);
  assert.equal(isSelectionNavigationKey({ key: null }), false);
  assert.equal(isSelectionNavigationKey({ key: 42 }), false);
});

test('recognizes Shift and Arrow navigation keys', () => {
  assert.equal(typeof isSelectionNavigationKey, 'function');
  assert.equal(isSelectionNavigationKey({ key: 'Shift' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'ArrowLeft' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'ArrowDown' }), true);
  assert.equal(isSelectionNavigationKey({ key: 'Enter' }), false);
});

test('range anchors clone the range and read live rectangles', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let cloneCalls = 0;
  let rect = { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
  const clonedRange = {
    getBoundingClientRect() { return rect; }
  };
  const sourceRange = {
    cloneRange() {
      cloneCalls++;
      return clonedRange;
    },
    getBoundingClientRect() {
      throw new Error('the source range must not be read when cloning succeeds');
    }
  };

  const anchor = createRangeAnchor(sourceRange);
  assert.equal(cloneCalls, 1);
  assert.deepEqual(anchor.getRect(300, 200), rect);

  rect = { left: 25, top: 35, right: 125, bottom: 55, width: 100, height: 20 };
  assert.deepEqual(anchor.getRect(300, 200), rect);
});

test('range anchors reject invalid, empty, and fully offscreen rectangles', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const range = {
    cloneRange() { return this; },
    getBoundingClientRect() {
      if (rect instanceof Error) throw rect;
      return rect;
    }
  };
  const anchor = createRangeAnchor(range);

  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 310, top: 20, right: 410, bottom: 40, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: -110, top: 20, right: -10, bottom: 40, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 10, top: 210, right: 110, bottom: 230, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: 10, top: -30, right: 110, bottom: -10, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = { left: NaN, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
  assert.equal(anchor.getRect(300, 200), null);
  rect = new Error('detached range');
  assert.equal(anchor.getRect(300, 200), null);
});

test('range anchor disposal detaches the cloned range when supported', () => {
  assert.equal(typeof createRangeAnchor, 'function');
  let detachCalls = 0;
  const clonedRange = {
    detach() { detachCalls++; },
    getBoundingClientRect() {
      return { left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20 };
    }
  };
  const anchor = createRangeAnchor({ cloneRange() { return clonedRange; } });

  anchor.dispose();
  anchor.dispose();
  assert.equal(detachCalls, 1);
  assert.equal(anchor.getRect(300, 200), null);
});

const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8')
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
);

test('manifest loads selection_anchor.js immediately before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf('content.js');
  assert(contentIndex > 0);
  assert.equal(scripts[contentIndex - 1], 'selection_anchor.js');
});

test('content script owns and clears one active DOM selection anchor', () => {
  assert.match(contentJs, /let activeSelectionAnchor = null/);
  assert.match(contentJs, /function clearActiveSelectionAnchor\(\)/);
  assert.match(contentJs, /activeSelectionAnchor\.dispose\(\)/);
  assert.match(contentJs, /activeSelectionAnchor = createRangeAnchor\(range\)/);
  assert.match(contentJs, /isInputSelection[\s\S]*clearActiveSelectionAnchor\(\)/);
  assert.match(contentJs, /overrideText[\s\S]*clearActiveSelectionAnchor\(\)/);
});

test('content script positions from the live anchor before showing the card', () => {
  assert.match(contentJs, /function getSelectionCardRect\(fallbackRect(?:, expectedAnchor = null)?\)/);
  assert.match(contentJs, /if \(expectedAnchor !== activeSelectionAnchor\) return/);
  assert.match(contentJs, /activeSelectionAnchor\.getRect\(window\.innerWidth, window\.innerHeight\)/);
  assert.match(contentJs, /const cardRect = getSelectionCardRect\(rect, expectedAnchor\);[\s\S]*?positionCard\(cardRect\)/);
});

test('content script throttles visible card positioning on scroll and resize', () => {
  assert.match(contentJs, /function scheduleSelectionCardPosition\(\)/);
  assert.match(contentJs, /requestAnimationFrame/);
  assert.match(contentJs, /window\.addEventListener\('scroll', scheduleSelectionCardPosition, \{ capture: true, passive: true \}\)/);
  assert.match(contentJs, /window\.addEventListener\('resize', scheduleSelectionCardPosition, \{ passive: true \}\)/);
  assert.match(contentJs, /clearActiveSelectionAnchor\(\);[\s\S]{0,100}?hideCard\(true\)/);
});

test('content script delegates key filtering to the safe helper', () => {
  assert.match(contentJs, /isSelectionNavigationKey\(e\)/);
  assert.doesNotMatch(contentJs, /e\.key\.startsWith\('Arrow'\)/);
});

test('npm test runs the paragraph experience suite first', () => {
  assert.match(packageJson.scripts.test, /^node tests\/test_paragraph_translation_experience\.js && /);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
