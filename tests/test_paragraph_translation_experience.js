const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

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
const { CONTENT_SCRIPT_FILES } = require('../extension/popup/tab_bridge.js');
const readerHtml = fs.readFileSync(path.join(__dirname, '../extension/reader/reader.html'), 'utf8');

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      listeners.set(type, registered.filter((item) => item !== listener));
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function createClassList(element) {
  const values = new Set();
  const sync = () => { element._className = [...values].join(' '); };
  return {
    add(...names) { names.forEach((name) => values.add(name)); sync(); },
    remove(...names) { names.forEach((name) => values.delete(name)); sync(); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      sync();
      return enabled;
    },
    reset(className) {
      values.clear();
      String(className || '').split(/\s+/).filter(Boolean).forEach((name) => values.add(name));
      sync();
    }
  };
}

function createElement(tagName) {
  const element = Object.assign(createEventTarget(), {
    tagName: String(tagName).toUpperCase(),
    id: '',
    style: {},
    children: [],
    parentElement: null,
    innerHTML: '',
    textContent: '',
    title: '',
    offsetHeight: 180,
    offsetWidth: 320,
    onclick: null,
    appendChild(child) {
      child.parentElement = element;
      element.children.push(child);
      return child;
    },
    attachShadow() {
      const nodesById = new Map();
      const root = Object.assign(createEventTarget(), {
        children: [],
        appendChild(child) {
          child.parentElement = element;
          root.children.push(child);
          if (child.id) nodesById.set(child.id, child);
          return child;
        },
        querySelector(selector) {
          if (!selector.startsWith('#')) return null;
          const id = selector.slice(1);
          if (!nodesById.has(id)) {
            const node = createElement('button');
            node.id = id;
            nodesById.set(id, node);
          }
          return nodesById.get(id);
        }
      });
      element.shadowRoot = root;
      return root;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
    },
    closest() { return null; }
  });
  element.classList = createClassList(element);
  Object.defineProperty(element, 'className', {
    get() { return element._className || ''; },
    set(value) { element.classList.reset(value); }
  });
  return element;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createContentHarness() {
  const document = Object.assign(createEventTarget(), {
    body: createElement('body'),
    documentElement: createElement('html'),
    activeElement: null,
    createElement
  });
  document.activeElement = document.body;

  let selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
  let liveRect = null;
  let detachCalls = 0;
  let nextTimerId = 1;
  let timers = [];
  let animationFrames = [];
  const requests = [];
  const runtimeMessages = createEventTarget();

  const window = Object.assign(createEventTarget(), {
    innerWidth: 800,
    innerHeight: 600,
    location: { hostname: 'example.com' },
    getSelection: () => selection,
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    }
  });

  class DictServiceMock {
    cleanPaperText(text) { return String(text || '').trim(); }
    isLookupEligible(text) { return Boolean(text); }
    isSingleWord(text) { return !String(text).includes(' '); }
    lookup() { return { found: false }; }
    parseDefinitions() { return []; }
  }
  window.DictService = DictServiceMock;

  const chrome = {
    storage: {
      sync: { get(defaults, callback) { callback(defaults); } },
      local: {
        get(defaults, callback) { callback(defaults); },
        set() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      sendMessage(message) {
        const deferred = createDeferred();
        requests.push({ message, ...deferred });
        return deferred.promise;
      },
      onMessage: { addListener: runtimeMessages.addEventListener.bind(runtimeMessages, 'message') }
    }
  };

  const context = {
    window,
    document,
    chrome,
    DictService: DictServiceMock,
    PaperDictSelectionAnchor: selectionAnchorHelpers,
    ACADEMIC_DICT: null,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Audio: function Audio() {},
    console,
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.push({ id, callback });
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((timer) => timer.id !== id);
    }
  };
  vm.runInNewContext(contentJs, context, { filename: 'extension/content.js' });

  return {
    document,
    window,
    requests,
    setDomSelection(text, rect) {
      liveRect = rect;
      const clonedRange = {
        getBoundingClientRect: () => liveRect,
        detach() { detachCalls++; }
      };
      const range = {
        cloneRange: () => clonedRange,
        getBoundingClientRect: () => liveRect
      };
      selection = {
        rangeCount: 1,
        isCollapsed: false,
        toString: () => text,
        getRangeAt: () => range
      };
    },
    setCollapsedSelection() {
      selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
    },
    setRect(rect) { liveRect = rect; },
    flushTimers() {
      const pending = timers;
      timers = [];
      pending.forEach((timer) => timer.callback());
    },
    flushAnimationFrames() {
      const pending = animationFrames;
      animationFrames = [];
      pending.forEach((callback) => callback());
    },
    getAnimationFrameCount: () => animationFrames.length,
    getDetachCalls: () => detachCalls,
    getCard() {
      const host = document.body.children.find((node) => node.id === 'paper-dict-host-root');
      return host && host.shadowRoot.children.find((node) => node.classList.contains('paper-dict-card'));
    },
    getShadowRoot() {
      const host = document.body.children.find((node) => node.id === 'paper-dict-host-root');
      return host && host.shadowRoot;
    },
    dispatchRuntimeMessage(message) { runtimeMessages.dispatch('message', message); }
  };
}

async function resolveRequest(harness, index, response) {
  harness.requests[index].resolve(response);
  await Promise.resolve();
  await Promise.resolve();
}

async function showSelectionCard(harness, rect, text = 'alpha') {
  const requestIndex = harness.requests.length;
  harness.setDomSelection(text, rect);
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.requests.length, requestIndex + 1);
  await resolveRequest(harness, requestIndex, {
    success: true,
    found: true,
    translation: 'translated',
    source: 'test glossary'
  });
  return harness.getCard();
}

test('every content loader places selection_anchor.js immediately before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const contentIndex = scripts.indexOf('content.js');
  assert(contentIndex > 0);
  assert.equal(scripts[contentIndex - 1], 'selection_anchor.js');

  const recoveryContentIndex = CONTENT_SCRIPT_FILES.indexOf('content.js');
  assert(recoveryContentIndex > 0);
  assert.equal(CONTENT_SCRIPT_FILES[recoveryContentIndex - 1], 'selection_anchor.js');

  const readerScripts = [...readerHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  const readerContentIndex = readerScripts.indexOf('../content.js');
  assert(readerContentIndex > 0);
  assert.equal(readerScripts[readerContentIndex - 1], '../selection_anchor.js');
});

test('content listeners safely ignore a keyup event without key', () => {
  const harness = createContentHarness();
  assert.doesNotThrow(() => harness.document.dispatch('keyup', {}));
});

test('content card uses delayed live geometry and follows throttled scroll and resize', async () => {
  const harness = createContentHarness();
  harness.setDomSelection('alpha', {
    left: 40, top: 100, right: 140, bottom: 120, width: 100, height: 20
  });
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.getCard(), undefined);

  harness.setRect({ left: 250, top: 200, right: 350, bottom: 220, width: 100, height: 20 });
  await resolveRequest(harness, 0, {
    success: true,
    found: true,
    translation: 'translated',
    source: 'test glossary'
  });
  const card = harness.getCard();
  assert(card.classList.contains('visible'));
  assert.equal(card.style.top, '228px');

  harness.setRect({ left: 300, top: 240, right: 400, bottom: 260, width: 100, height: 20 });
  harness.window.dispatch('scroll');
  harness.window.dispatch('scroll');
  assert.equal(harness.getAnimationFrameCount(), 1);
  harness.flushAnimationFrames();
  assert.equal(card.style.top, '268px');

  harness.setRect({ left: 350, top: 280, right: 450, bottom: 300, width: 100, height: 20 });
  harness.window.dispatch('resize');
  harness.flushAnimationFrames();
  assert.equal(card.style.top, '308px');

  harness.getShadowRoot().querySelector('#btn-pin').onclick({ stopPropagation() {} });
  harness.setRect({ left: 350, top: -40, right: 450, bottom: -20, width: 100, height: 20 });
  harness.window.dispatch('scroll');
  harness.flushAnimationFrames();
  assert.equal(card.classList.contains('visible'), false);
  assert.equal(harness.getDetachCalls(), 1);
});

test('input and context-menu lookups dispose an existing DOM range anchor', async () => {
  const harness = createContentHarness();
  await showSelectionCard(harness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });

  const input = createElement('input');
  input.value = 'input';
  input.selectionStart = 0;
  input.selectionEnd = 5;
  input.getBoundingClientRect = () => ({
    left: 100, top: 140, right: 200, bottom: 160, width: 100, height: 20
  });
  harness.document.activeElement = input;
  harness.document.dispatch('mouseup', { composedPath: () => [] });
  harness.flushTimers();
  assert.equal(harness.getDetachCalls(), 1);

  harness.document.activeElement = harness.document.body;
  await showSelectionCard(harness, {
    left: 100, top: 180, right: 200, bottom: 200, width: 100, height: 20
  }, 'beta');
  harness.dispatchRuntimeMessage({ type: 'TRIGGER_TRANSLATE_FROM_MENU', text: 'context' });
  assert.equal(harness.getDetachCalls(), 2);
});

test('close and outside dismiss dispose the live range anchor', async () => {
  const closeHarness = createContentHarness();
  const closeCard = await showSelectionCard(closeHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  closeHarness.getShadowRoot().querySelector('#btn-close').onclick({ stopPropagation() {} });
  assert.equal(closeCard.classList.contains('visible'), false);
  assert.equal(closeHarness.getDetachCalls(), 1);

  const dismissHarness = createContentHarness();
  const dismissCard = await showSelectionCard(dismissHarness, {
    left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20
  });
  dismissHarness.setCollapsedSelection();
  dismissHarness.document.dispatch('mousedown', { composedPath: () => [] });
  assert.equal(dismissCard.classList.contains('visible'), false);
  assert.equal(dismissHarness.getDetachCalls(), 1);
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

async function run() {
  console.log('=== PaperDict Paragraph Translation Experience Tests ===');
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`  PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL ${name}`);
      console.error(`       ${error.stack || error.message}`);
    }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
