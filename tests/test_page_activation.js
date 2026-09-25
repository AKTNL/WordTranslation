/**
 * PaperDict - Phase 3 Default-Off & Per-Page On-Demand Activation Tests
 * Tests default-inactive state, Alt+P shortcuts, popup master switch, badge updates, and tab isolation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((l) => l !== listener));
    },
    dispatch(type, event = {}) {
      const list = listeners.get(type) || [];
      for (const listener of list) listener(event);
    },
    listeners
  };
}

function runTests() {
  console.log('=== Running PaperDict Phase 3 Page Activation Tests ===\n');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const backgroundJs = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
  const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
  const bilingualJs = fs.readFileSync(path.join(__dirname, '../extension/bilingual.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.html'), 'utf8');
  const popupCss = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.css'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../extension/popup/popup.js'), 'utf8');

  // Test 1: Manifest Commands & Keyboard Shortcuts
  console.log('[Test 1: Manifest Commands & Keyboard Shortcuts]');
  assert(manifest.commands, 'manifest.json defines commands');
  assert(manifest.commands['toggle-page-translation'], 'manifest.json registers toggle-page-translation command');
  assert.equal(
    manifest.commands['toggle-page-translation'].suggested_key.default,
    'Alt+P',
    'toggle-page-translation default shortcut is Alt+P'
  );
  assert(manifest.commands['toggle-bilingual-mode'], 'manifest.json registers toggle-bilingual-mode command');
  console.log('  ✓ PASS: manifest.json defines Alt+P and Alt+B commands');

  // Test 2: Background Badge State and Action Title
  console.log('\n[Test 2: Background Badge State & Commands]');
  const backgroundModule = require('../extension/background.js');
  assert(typeof backgroundModule.updateTabBadge === 'function', 'background.js exports updateTabBadge');

  let setBadgeTextArg = null;
  let setBadgeColorArg = null;
  let setTitleArg = null;

  global.chrome = {
    action: {
      setBadgeText(arg) { setBadgeTextArg = arg; },
      setBadgeBackgroundColor(arg) { setBadgeColorArg = arg; },
      setTitle(arg) { setTitleArg = arg; }
    }
  };

  // Badge for inactive tab
  backgroundModule.updateTabBadge(101, false, false);
  assert.equal(setBadgeTextArg.text, 'OFF', 'Inactive tab displays OFF badge');
  assert.equal(setBadgeTextArg.tabId, 101);
  assert.equal(setBadgeColorArg.color, '#64748b', 'Inactive tab displays gray color');
  assert(setTitleArg.text.includes('未开启'), 'Inactive tab title indicates not active');

  // Badge for active tab
  backgroundModule.updateTabBadge(102, true, false);
  assert.equal(setBadgeTextArg.text, 'ON', 'Active tab displays ON badge');
  assert.equal(setBadgeTextArg.tabId, 102);
  assert.equal(setBadgeColorArg.color, '#10b981', 'Active tab displays emerald green color');
  assert(setTitleArg.text.includes('已开启'), 'Active tab title indicates active');

  // Badge for PDF reader tab
  backgroundModule.updateTabBadge(103, false, true);
  assert.equal(setBadgeTextArg.text, 'ON', 'Reader tab always displays ON badge');
  assert.equal(setBadgeColorArg.color, '#10b981');

  assert(backgroundJs.includes('toggle-page-translation'), 'background.js listens for toggle-page-translation');
  assert(backgroundJs.includes('PAGE_ACTIVE_CHANGED'), 'background.js listens for PAGE_ACTIVE_CHANGED');
  console.log('  ✓ PASS: background badge displays OFF (#64748b) by default and ON (#10b981) when active');

  // Test 3: Content Script Default-Off Behavior
  console.log('\n[Test 3: Content Script Default-Off & Isolation]');

  function runContentScriptInContext(location) {
    const docTarget = createEventTarget();
    const winTarget = createEventTarget();
    const sentMessages = [];

    const mockDoc = Object.assign(docTarget, {
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
      activeElement: null,
      getElementById: () => null,
      createElement: () => ({ classList: { add() {}, remove() {} }, style: {} })
    });

    const mockWin = Object.assign(winTarget, {
      location,
      innerWidth: 1024,
      innerHeight: 768,
      getSelection: () => ({ isCollapsed: false, toString: () => 'hypothesis', rangeCount: 1 }),
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      DictService: function DictService() {
        return {
          cleanPaperText: (t) => t,
          isLookupEligible: () => true,
          isSingleWord: () => true,
          lookupLocal: () => ({ found: true, word: 'hypothesis' }),
          parseDefinitions: () => []
        };
      },
      PaperDictSelectionAnchor: {
        createRangeAnchor: () => null,
        isSelectionNavigationKey: () => false
      }
    });

    const mockChrome = {
      storage: {
        sync: {
          get(defaults, cb) { cb(defaults); }
        },
        onChanged: { addListener() {} }
      },
      runtime: {
        sendMessage(msg, cb) {
          sentMessages.push(msg);
          if (cb) cb();
        },
        onMessage: {
          addListener(cb) {
            mockWin.__runtimeListener = cb;
          }
        }
      }
    };

    const ctx = {
      window: mockWin,
      document: mockDoc,
      chrome: mockChrome,
      globalThis: mockWin,
      console,
      setTimeout,
      clearTimeout
    };

    vm.runInNewContext(contentJs, ctx);

    return {
      window: mockWin,
      document: mockDoc,
      sentMessages,
      dispatchMessage: (msg, sendResponse) => {
        if (mockWin.__runtimeListener) {
          return mockWin.__runtimeListener(msg, {}, sendResponse || (() => {}));
        }
      }
    };
  }

  // 3a: Academic Web Page (e.g. arXiv) must default to inactive
  const webHarness = runContentScriptInContext({
    href: 'https://arxiv.org/abs/2103.00020',
    pathname: '/abs/2103.00020',
    hostname: 'arxiv.org'
  });

  assert.equal(webHarness.window.__paperDictPageActive, false, 'Standard web page defaults to pageActive = false');
  assert.equal(webHarness.window.__paperDictIsPageActive(), false, 'isPageActive() returns false by default');

  // 3b: Reader Page must default to active
  const readerHarness = runContentScriptInContext({
    href: 'chrome-extension://testid/reader/reader.html?file=test.pdf',
    pathname: '/reader/reader.html',
    hostname: 'testid'
  });
  assert.equal(readerHarness.window.__paperDictPageActive, true, 'Reader page defaults to pageActive = true');
  assert.equal(readerHarness.window.__paperDictIsPageActive(), true, 'isPageActive() returns true for reader page');

  console.log('  ✓ PASS: standard web pages default to inactive, while reader page defaults to active');

  // Test 4: On-Demand Activation and Safe Deactivation
  console.log('\n[Test 4: On-Demand Activation & Safe Deactivation]');

  // Query page status via runtime message
  let statusResponse = null;
  webHarness.dispatchMessage({ type: 'GET_PAGE_STATUS' }, (res) => { statusResponse = res; });
  assert(statusResponse, 'GET_PAGE_STATUS responds');
  assert.equal(statusResponse.active, false, 'Status reports active = false');

  // Activate via SET_PAGE_ACTIVE
  let activateResponse = null;
  webHarness.dispatchMessage({ type: 'SET_PAGE_ACTIVE', active: true }, (res) => { activateResponse = res; });
  assert(activateResponse && activateResponse.active === true, 'SET_PAGE_ACTIVE enables page');
  assert.equal(webHarness.window.__paperDictIsPageActive(), true, 'Page is now active');

  // Verify badge update was sent to background
  const activatedBadgeMsg = webHarness.sentMessages[webHarness.sentMessages.length - 1];
  assert.equal(activatedBadgeMsg.type, 'PAGE_ACTIVE_CHANGED');
  assert.equal(activatedBadgeMsg.active, true, 'PAGE_ACTIVE_CHANGED notifies active = true');

  // Toggle inactive via TOGGLE_PAGE_ACTIVE
  let toggleResponse = null;
  webHarness.dispatchMessage({ type: 'TOGGLE_PAGE_ACTIVE' }, (res) => { toggleResponse = res; });
  assert(toggleResponse && toggleResponse.active === false, 'TOGGLE_PAGE_ACTIVE disables page');
  assert.equal(webHarness.window.__paperDictIsPageActive(), false, 'Page is now inactive');

  console.log('  ✓ PASS: GET_PAGE_STATUS, SET_PAGE_ACTIVE, and TOGGLE_PAGE_ACTIVE control page state cleanly');

  // Test 5: Bilingual Manager Coordination with Page Active State
  console.log('\n[Test 5: Bilingual Manager Coordination]');
  const { PaperBilingualManager } = require('../extension/bilingual.js');

  const manager = new PaperBilingualManager();
  // By default in Node with no window, isPageActive() returns true for test backward compatibility
  assert.equal(manager.isPageActive(), true, 'Default isPageActive fallback is safe');

  // Mock inactive window environment
  global.window = {
    __paperDictIsPageActive: () => false,
    location: { href: 'https://arxiv.org/abs/2103.00020', pathname: '/abs/2103.00020' }
  };
  const webManager = new PaperBilingualManager();
  assert.equal(webManager.isPageActive(), false, 'Manager respects window.__paperDictIsPageActive() === false');

  let capsuleDestroyed = false;
  webManager.capsule = {
    destroy() { capsuleDestroyed = true; }
  };
  webManager.applyCapsuleEnabled(true);
  assert.equal(capsuleDestroyed, true, 'Capsule is destroyed when page is inactive');
  assert.equal(webManager.capsule, null);

  // When onPageDeactivated() is called from chinese mode
  webManager.mode = 'chinese';
  let viewRestored = false;
  let modeDuringRestore = null;
  webManager.restoreOriginalView = () => {
    viewRestored = true;
    modeDuringRestore = webManager.mode;
  };
  webManager.onPageDeactivated();
  assert.equal(viewRestored, true, 'onPageDeactivated restores original view');
  assert.equal(modeDuringRestore, 'original', 'mode is already reset to original when restore runs');
  assert.equal(webManager.mode, 'original', 'onPageDeactivated resets mode to original');

  // Test Alt+B toggleMode debounce
  const initialMode = webManager.mode; // 'original'
  webManager.onlineFallback = true;
  webManager.toggleMode(); // toggles original -> bilingual
  assert.equal(webManager.mode, 'bilingual', 'First toggle switches to bilingual');
  webManager.toggleMode(); // immediate second toggle should be debounced
  assert.equal(webManager.mode, 'bilingual', 'Immediate second toggleMode is debounced within 250ms');

  delete global.window;
  console.log('  ✓ PASS: Bilingual manager synchronizes lifecycle with page active status and debounces Alt+B');

  // Test 6: Popup Master Switch UI & Tab Bridge
  console.log('\n[Test 6: Popup UI Master Switch & Accessibility]');
  assert(popupHtml.includes('id="toggle-page-active"'), 'popup.html contains #toggle-page-active checkbox');
  assert(popupHtml.includes('id="page-active-card"'), 'popup.html contains #page-active-card container');
  assert(popupHtml.includes('id="page-active-dot"'), 'popup.html contains #page-active-dot indicator');
  assert(popupHtml.includes('id="page-active-desc"'), 'popup.html contains #page-active-desc status text');
  assert(popupHtml.includes('当前页面划词与翻译'), 'popup.html has clear master switch title');
  assert(popupHtml.includes('Alt+P'), 'popup.html shows Alt+P shortcut badge');

  assert(popupCss.includes('.page-active-section'), 'popup.css defines .page-active-section');
  assert(popupCss.includes('.page-active-card.active'), 'popup.css styles active card with green theme');
  assert(popupCss.includes('.page-active-dot.active'), 'popup.css styles active dot indicator');

  assert(popupJs.includes('togglePageActive'), 'popup.js handles togglePageActive element');
  assert(popupJs.includes('GET_PAGE_STATUS'), 'popup.js queries GET_PAGE_STATUS on startup');
  assert(popupJs.includes('SET_PAGE_ACTIVE'), 'popup.js sends SET_PAGE_ACTIVE on toggle switch');
  console.log('  ✓ PASS: Popup master switch UI is properly wired and styled');

  // Test 7: Selection Event Gating & Debounce
  console.log('\n[Test 7: Selection Gating & Shortcut Debounce]');
  const isolatedTab1 = runContentScriptInContext({
    href: 'https://nature.com/articles/s41586-021-03819-2',
    pathname: '/articles/s41586-021-03819-2',
    hostname: 'nature.com'
  });
  const isolatedTab2 = runContentScriptInContext({
    href: 'https://ieee.org/document/12345',
    pathname: '/document/12345',
    hostname: 'ieee.org'
  });

  assert.equal(isolatedTab1.window.__paperDictIsPageActive(), false);
  assert.equal(isolatedTab2.window.__paperDictIsPageActive(), false);

  // Activate Tab 1
  isolatedTab1.window.__paperDictSetPageActive(true);
  assert.equal(isolatedTab1.window.__paperDictIsPageActive(), true, 'Tab 1 activated');
  assert.equal(isolatedTab2.window.__paperDictIsPageActive(), false, 'Tab 2 remains untouched (isolated)');

  // Test shortcut Alt+P keydown on Tab 2
  isolatedTab2.document.dispatch('keydown', {
    altKey: true,
    key: 'p',
    preventDefault() {}
  });
  assert.equal(isolatedTab2.window.__paperDictIsPageActive(), true, 'Alt+P toggled Tab 2 to active');

  // Immediate second Alt+P within debounce threshold should be ignored
  isolatedTab2.document.dispatch('keydown', {
    altKey: true,
    key: 'p',
    preventDefault() {}
  });
  assert.equal(isolatedTab2.window.__paperDictIsPageActive(), true, 'Rapid duplicate Alt+P ignored by debounce');

  console.log('  ✓ PASS: Per-tab isolation verified and rapid duplicate Alt+P keydowns are debounced');

  // Test 8: Tab Bridge Classification for Restricted and Special Pages
  console.log('\n[Test 8: Tab Bridge Restricted Page Handling]');
  const tabBridge = require('../extension/popup/tab_bridge.js');
  const chromePage = tabBridge.classifyTabUrl('chrome://extensions');
  assert.equal(chromePage.injectable, false, 'chrome:// URL is not injectable');
  assert.equal(chromePage.code, 'RESTRICTED_PAGE', 'chrome:// classified as RESTRICTED_PAGE');

  const edgePage = tabBridge.classifyTabUrl('edge://settings');
  assert.equal(edgePage.injectable, false, 'edge:// URL is not injectable');

  const readerUrl = tabBridge.classifyTabUrl('chrome-extension://testid/reader/reader.html');
  assert.equal(readerUrl.code, 'READER_PAGE', 'reader URL classified as READER_PAGE');

  const pdfUrl = tabBridge.classifyTabUrl('https://arxiv.org/pdf/2103.00020.pdf');
  assert.equal(pdfUrl.code, 'PDF_PAGE', 'Direct PDF URL classified as PDF_PAGE');

  const webUrl = tabBridge.classifyTabUrl('https://arxiv.org/abs/2103.00020');
  assert.equal(webUrl.injectable, true, 'Standard https URL is injectable');
  console.log('  ✓ PASS: Tab Bridge properly identifies and isolates restricted/special pages');

  console.log('\n==============================');
  console.log('All Phase 3 Page Activation tests passed successfully!');
}

runTests();
