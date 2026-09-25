/**
 * PaperDict - Background Service Worker (Manifest V3)
 * Handles online translation fallback, custom LLM/DeepL engines,
 * persistent cache with chrome.storage.local, context menu actions, and reader navigation.
 */

if (typeof importScripts === 'function') {
  importScripts('translation_service.js', 'glossary_service.js');
} else if (typeof module !== 'undefined' && module.exports) {
  const translationModule = require('./translation_service.js');
  const glossaryModule = require('./glossary_service.js');
  globalThis.TranslationService = translationModule.TranslationService;
  globalThis.paperDictBuildCacheKey = translationModule.buildCacheKey;
  globalThis.paperDictShouldRequestOnline = translationModule.shouldRequestOnline;
  globalThis.GlossaryService = glossaryModule.GlossaryService;
}

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  triggerMode: 'direct', // 'direct' (default) | 'icon' | 'modifier'
  modifierKey: 'Alt',
  deHyphen: true,
  autoAudio: false,
  onlineFallback: true,
  autoInterceptPdf: false, // Default false: no aggressive PDF hijacking!
  bilingualDefault: false,
  capsuleEnabled: true,
  blacklist: [],
  customEngine: 'default', // 'default' | 'deepl' | 'openai'
  customApiEndpoint: '',
  customModel: ''
};

// URL patterns that indicate a PDF document
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

function isReaderUrl(url) {
  if (!url) return false;
  return url.includes('reader/reader.html');
}

function updateTabBadge(tabId, active, isReader = false) {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  const isOnlineReader = isReader;
  const text = isOnlineReader ? 'ON' : (active ? 'ON' : 'OFF');
  const color = (isOnlineReader || active) ? '#10b981' : '#64748b';
  const title = (isOnlineReader || active)
    ? 'PaperDict: 当前页面已开启划词与翻译 (快捷键 Alt+P)'
    : 'PaperDict: 当前页面未开启划词与翻译 (点击或按 Alt+P 开启)';

  try {
    if (tabId) {
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color, tabId });
      if (chrome.action.setTitle) {
        chrome.action.setTitle({ text: title, tabId });
      }
    } else {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color });
      if (chrome.action.setTitle) {
        chrome.action.setTitle({ text: title });
      }
    }
  } catch (e) {}
}

// Set default badge for newly opened tabs or initial load
if (typeof chrome !== 'undefined' && chrome.action) {
  updateTabBadge(null, false, false);
}

// Initialize settings and context menu on install
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    chrome.storage.sync.set(Object.assign({}, DEFAULT_SETTINGS, items));
  });

  chrome.storage.sync.get(['customApiKey'], (legacy) => {
    if (!legacy.customApiKey) return;
    chrome.storage.local.set({ customApiKey: legacy.customApiKey }, () => {
      chrome.storage.sync.remove('customApiKey');
    });
  });

  // Re-create context menus safely
  chrome.contextMenus.removeAll(() => {
    // 1. Text selection translate
    chrome.contextMenus.create({
      id: 'paperdict-selection-translate',
      title: 'PaperDict 划词翻译',
      contexts: ['selection']
    });

    // 2. Open page or link in PaperDict Reader
    chrome.contextMenus.create({
      id: 'paperdict-open-in-reader',
      title: '用 PaperDict 阅读器打开此论文 (开启划词即弹)',
      contexts: ['page', 'link']
    });

    // 3. Toggle In-situ Full Paper Bilingual Reader
    chrome.contextMenus.create({
      id: 'paperdict-toggle-bilingual',
      title: 'PaperDict: 切换论文双语对照 / 纯中文速读 (Alt+B)',
      contexts: ['page']
    });
  });

});
}
// Auto-intercept online PDF navigations to PaperDict Reader if user explicitly opted in
if (typeof chrome !== 'undefined' && chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const url = details.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    if (isPdfUrl(url)) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        if (items.autoInterceptPdf) {
          const readerUrl = chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(url)}`);
          chrome.tabs.update(details.tabId, { url: readerUrl });
        }
      });
    }
  });
}

// Fallback tab update listener for PDF detection and per-page badge state
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const currentUrl = (tab && tab.url) || changeInfo.url;
    if (changeInfo.status === 'loading' || changeInfo.url) {
      const isReader = isReaderUrl(currentUrl);
      updateTabBadge(tabId, false, isReader);
    }

    const url = changeInfo.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    if (isPdfUrl(url) && !url.includes('reader/reader.html')) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        if (items.autoInterceptPdf) {
          const readerUrl = chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(url)}`);
          chrome.tabs.update(tabId, { url: readerUrl });
        }
      });
    }
  });
}

// Global Keyboard Shortcut Commands Listener (Alt+P, Alt+B)
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;

      if (command === 'toggle-page-translation') {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PAGE_ACTIVE' }).catch(() => {});
      } else if (command === 'toggle-bilingual-mode') {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_BILINGUAL_MODE' }).catch(() => {});
      }
    } catch (e) {}
  });
}

// Context menu click handler
if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // 1. Open link/page in Reader
  if (info.menuItemId === 'paperdict-open-in-reader') {
    const targetUrl = info.linkUrl || info.pageUrl || (tab && tab.url);
    if (targetUrl) {
      const readerUrl = chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(targetUrl)}`);
      chrome.tabs.create({ url: readerUrl });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html') });
    }
    return;
  }

  // 2. Toggle Bilingual / Full Chinese
  if (info.menuItemId === 'paperdict-toggle-bilingual') {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_BILINGUAL_MODE' }).catch(() => {});
    }
    return;
  }

  // 3. Selection translate
  if (info.menuItemId === 'paperdict-selection-translate' && info.selectionText) {
    const rawText = info.selectionText.trim();
    if (!tab || !tab.id) return;

    const isNativePdf = isPdfUrl(tab.url) || tab.url.startsWith('file://') || tab.url.startsWith('chrome-extension://');

    if (isNativePdf) {
      openTranslationMiniWindow(rawText);
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_TRANSLATE_FROM_MENU',
        text: rawText
      });
    } catch (err) {
      openTranslationMiniWindow(rawText);
    }
  }
  });
}

function openTranslationMiniWindow(text) {
  const encoded = encodeURIComponent(text);
  const url = chrome.runtime.getURL(`popup/popup.html?q=${encoded}`);
  chrome.windows.create({
    url,
    type: 'popup',
    width: 440,
    height: 520,
    focused: true
  });
}

// Persistent translation cache backed by chrome.storage.local for Manifest V3 lifecycle
const memoryCache = new Map();

// Active in-flight requests for cancellation: requestId -> AbortController
const activeRequests = new Map();

// Pending in-flight query promises for de-duplication: query -> Promise
const pendingInFlight = new Map();

function normalizeQuery(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

function createCombinedSignal(parentSignal, timeoutMs = 7000) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    try {
      timeoutController.abort(new Error('请求超时'));
    } catch (e) {}
  }, timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      try {
        timeoutController.abort(parentSignal.reason || new Error('请求已取消'));
      } catch (e) {}
    } else {
      parentSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        try {
          timeoutController.abort(parentSignal.reason || new Error('请求已取消'));
        } catch (e) {}
      }, { once: true });
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => clearTimeout(timer)
  };
}

async function getCachedTranslation(query) {
  const norm = normalizeQuery(query);
  if (memoryCache.has(norm)) {
    return memoryCache.get(norm);
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get('translationCache');
      const diskCache = res.translationCache || {};
      if (diskCache[norm]) {
        memoryCache.set(norm, diskCache[norm]);
        return diskCache[norm];
      }
    } catch (e) {}
  }
  return null;
}

async function setCachedTranslation(query, translation) {
  const norm = normalizeQuery(query);
  memoryCache.set(norm, translation);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get('translationCache');
      const diskCache = res.translationCache || {};
      diskCache[norm] = translation;
      const keys = Object.keys(diskCache);
      if (keys.length > 800) {
        // Clean oldest entries
        for (let i = 0; i < 100; i++) {
          delete diskCache[keys[i]];
        }
      }
      await chrome.storage.local.set({ translationCache: diskCache });
    } catch (e) {}
  }
}

// Message listener for online translation and background actions
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_ONLINE') {
    const requestId = request.requestId || null;
    handleOnlineTranslation(request.text, requestId)
      .then((res) => sendResponse(res))
      .catch((err) => {
        const isAbort = err.name === 'AbortError' || err.aborted || (requestId && !activeRequests.has(requestId));
        sendResponse({
          success: false,
          error: isAbort ? '请求已取消' : (err.message || '翻译失败'),
          aborted: Boolean(isAbort)
        });
      });
    return true; // Keep channel open for async response
  }

  if (request.type === 'TEST_TRANSLATION_ENGINE') {
    testTranslationEngine(request.config || {})
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, code: 'NETWORK_ERROR', error: err.message || '连接测试失败' }));
    return true;
  }

  if (request.type === 'LOOKUP_GLOSSARY') {
    lookupGlossary(request.text)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message || '术语查询失败' }));
    return true;
  }

  if (request.type === 'CANCEL_TRANSLATION') {
    const { requestId } = request;
    if (requestId && activeRequests.has(requestId)) {
      const ctrl = activeRequests.get(requestId);
      try {
        ctrl.abort();
      } catch (e) {}
      activeRequests.delete(requestId);
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'CANCEL_ALL_TRANSLATIONS') {
    const { prefix } = request;
    for (const [rId, ctrl] of activeRequests.entries()) {
      if (!prefix || rId.startsWith(prefix)) {
        try {
          ctrl.abort();
        } catch (e) {}
        activeRequests.delete(rId);
      }
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'OPEN_READER') {
    const url = request.fileUrl
      ? chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(request.fileUrl)}`)
      : chrome.runtime.getURL('reader/reader.html');
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'EXPLAIN_TERM_CONTEXT') {
    const { term, surroundingText, paperTitle, requestId } = request;
    handleContextExplanation(term, surroundingText, paperTitle, requestId)
      .then((res) => sendResponse(res))
      .catch((err) => {
        const isAbort = err.name === 'AbortError' || err.aborted;
        sendResponse({
          success: false,
          error: isAbort ? '请求已取消' : (err.message || '语境解析失败'),
          aborted: Boolean(isAbort)
        });
      });
    return true;
  }

  if (request.type === 'PAGE_ACTIVE_CHANGED') {
    const tabId = (sender && sender.tab && sender.tab.id) || request.tabId;
    const active = Boolean(request.active);
    const isReader = Boolean(request.isReader);
    if (tabId) {
      updateTabBadge(tabId, active, isReader);
    }
    sendResponse({ success: true, active });
    return true;
  }

  if (request.type === 'CHECK_IS_PDF') {
    sendResponse({ isPdf: isPdfUrl(request.url) });
    return true;
  }
  });
}

/**
 * Semantic Reader-inspired context-aware term explanation
 */
async function handleContextExplanation(term, surroundingText, paperTitle, requestId = null) {
  if (!term || !term.trim()) {
    return { success: false, error: '术语为空' };
  }

  const cleanTerm = term.trim();
  const cacheKey = `ctx_${normalizeQuery(cleanTerm)}_${normalizeQuery(paperTitle || '').slice(0, 40)}`;

  // 1. Check persistent cache
  const cached = await getCachedTranslation(cacheKey);
  if (cached) {
    return {
      success: true,
      explanation: cached,
      source: '本地语境缓存',
      term: cleanTerm
    };
  }

  // Abort controller
  const requestController = new AbortController();
  if (requestId) {
    activeRequests.set(requestId, requestController);
  }

  try {
    const userSettings = await new Promise((resolve) => {
      chrome.storage.sync.get(['customEngine', 'customApiKey', 'customApiEndpoint', 'customModel'], (items) => {
        resolve(items || {});
      });
    });

    const contextSnippet = surroundingText ? surroundingText.slice(0, 400) : '';
    const titleSnippet = paperTitle ? paperTitle.slice(0, 150) : '';

    if (userSettings.customEngine === 'openai' && userSettings.customApiKey) {
      const endpoint = userSettings.customApiEndpoint || 'https://api.openai.com/v1/chat/completions';
      const model = userSettings.customModel || 'gpt-4o-mini';
      const timeoutWrap = createCombinedSignal(requestController.signal, 12000);

      const prompt = `你是一位严谨的学术科研助手（类似于 Semantic Reader）。请针对以下论文语境，简明解析科学术语 "${cleanTerm}" 的具体学术含义。
论文题目: ${titleSnippet || '科学文献'}
上下文段落: "...${contextSnippet}..."

请输出 2 点简明要点（中文，总字数 120 字以内）：
1. [学科概念]: 在该研究领域的严谨学术定义。
2. [本文语境]: 在本文该段落/模型中的具体作用或直观理解。`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userSettings.customApiKey}`
        },
        signal: timeoutWrap.signal,
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'You are an academic researcher. Explain terms in context in Simplified Chinese under 120 words.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3
        })
      });
      timeoutWrap.cleanup();

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (content) {
          await setCachedTranslation(cacheKey, content);
          return {
            success: true,
            explanation: content,
            source: `AI 语境解读 (${model})`,
            term: cleanTerm
          };
        }
      }
    }

    // Fallback: Translate the contextual query through available pipeline
    const query = contextSnippet
      ? `"${cleanTerm}" 在学术语境中的含义: ${contextSnippet}`
      : `学术术语 "${cleanTerm}" 的专业定义与内涵`;

    const transRes = await executeTranslationPipeline(query, requestController.signal);
    if (transRes && transRes.success) {
      const formatted = `[语境翻译]:\n${transRes.translation}`;
      await setCachedTranslation(cacheKey, formatted);
      return {
        success: true,
        explanation: formatted,
        source: '在线学术语境解析',
        term: cleanTerm
      };
    }

    return {
      success: false,
      error: '暂无法生成语境解析，建议在扩展弹窗中配置大模型 API Key 获得最佳体验'
    };
  } finally {
    if (requestId) {
      activeRequests.delete(requestId);
    }
  }
}

const translationService = new TranslationService();
const GLOSSARY_PACK_FILES = {
  'general-academic': 'glossaries/general-academic.json',
  'computer-ai': 'glossaries/computer-ai.json',
  'materials-engineering': 'glossaries/materials-engineering.json',
  biomedical: 'glossaries/biomedical.json',
  'economics-social-science': 'glossaries/economics-social-science.json'
};
let glossaryContextCache = null;

function storageGet(area, keys) {
  return new Promise((resolve) => area.get(keys, (items) => resolve(items || {})));
}

async function getTranslationConfig() {
  const [syncSettings, localSettings] = await Promise.all([
    storageGet(chrome.storage.sync, ['onlineFallback', 'customEngine', 'customApiEndpoint', 'customModel', 'customApiKey']),
    storageGet(chrome.storage.local, ['customApiKey', 'glossaryVersion'])
  ]);

  let apiKey = localSettings.customApiKey || syncSettings.customApiKey || '';
  if (!localSettings.customApiKey && syncSettings.customApiKey) {
    await chrome.storage.local.set({ customApiKey: syncSettings.customApiKey });
    await chrome.storage.sync.remove('customApiKey');
  }
  return {
    onlineFallback: syncSettings.onlineFallback !== false,
    engine: syncSettings.customEngine || 'default',
    endpoint: syncSettings.customApiEndpoint || '',
    model: syncSettings.customModel || '',
    apiKey,
    glossaryVersion: Number(localSettings.glossaryVersion) || 0
  };
}
async function loadGlossaryContext() {
  const localSettings = await storageGet(chrome.storage.local, [
    'userGlossary',
    'enabledGlossaryPacks',
    'glossaryVersion'
  ]);
  const enabledPacks = Array.isArray(localSettings.enabledGlossaryPacks)
    ? localSettings.enabledGlossaryPacks
    : ['general-academic'];
  const version = Number(localSettings.glossaryVersion) || 0;
  const cacheKey = JSON.stringify([version, enabledPacks]);
  if (glossaryContextCache && glossaryContextCache.key === cacheKey) return glossaryContextCache;

  const entries = [];
  for (const packId of enabledPacks) {
    const file = GLOSSARY_PACK_FILES[packId];
    if (!file) continue;
    try {
      const response = await fetch(chrome.runtime.getURL(file));
      if (!response.ok) continue;
      const pack = await response.json();
      const priority = packId === 'general-academic' ? 10 : 20;
      for (const term of pack.terms || []) {
        entries.push(Object.assign({}, term, { priority, sourceType: packId }));
      }
    } catch (error) {
      console.warn(`Unable to load glossary pack ${packId}:`, error);
    }
  }

  for (const term of Array.isArray(localSettings.userGlossary) ? localSettings.userGlossary : []) {
    entries.push(Object.assign({}, term, { priority: 100, sourceType: 'user' }));
  }

  glossaryContextCache = {
    key: cacheKey,
    version,
    service: new GlossaryService(entries)
  };
  return glossaryContextCache;
}

async function lookupGlossary(text) {
  const context = await loadGlossaryContext();
  const entry = context.service.lookup(text);
  if (!entry) return { success: true, found: false };
  return {
    success: true,
    found: true,
    query: String(text || '').trim(),
    translation: entry.target,
    sourceType: entry.sourceType,
    source: entry.sourceType === 'user' ? '用户术语库' : '内置学术术语包'
  };
}

async function testTranslationEngine(config) {
  return translationService.translate('This is an academic translation connection test.', {
    engine: config.engine || 'default',
    endpoint: config.endpoint || '',
    model: config.model || '',
    apiKey: config.apiKey || ''
  });
}

async function handleOnlineTranslation(text, requestId = null) {
  if (!text || !text.trim()) {
    return { success: false, code: 'INVALID_CONFIG', error: '输入文本为空' };
  }

  const query = text.trim();
  const requestController = new AbortController();
  if (requestId) activeRequests.set(requestId, requestController);
  try {
  const config = await getTranslationConfig();
  if (!paperDictShouldRequestOnline(config)) {
    return {
      success: false,
      code: 'ONLINE_DISABLED',
      error: '整句和整页翻译需要在线引擎，请在设置中开启在线翻译',
      engine: config.engine
    };
  }

  const glossary = await loadGlossaryContext();
  config.glossaryVersion = glossary.version;
  const cacheKey = paperDictBuildCacheKey(query, config);

  const cached = await getCachedTranslation(cacheKey);
  if (cached) {
    return {
      success: true,
      translation: cached.translation,
      source: `${cached.source || '在线翻译'}（缓存）`,
      engine: cached.engine || config.engine,
      query,
      cached: true
    };
  }

  const protectedTerms = glossary.service.protect(query);
  if (requestController.signal.aborted) {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    error.aborted = true;
    throw error;
  }
  const result = await translationService.translate(protectedTerms.text, config);
  if (!result.success) return Object.assign({}, result, { query });

  const finalResult = Object.assign({}, result, {
    translation: glossary.service.restore(result.translation, protectedTerms.terms),
    query
  });
  await setCachedTranslation(cacheKey, finalResult);
  return finalResult;
  } finally {
    if (requestId) activeRequests.delete(requestId);
  }
}

async function executeTranslationPipeline(query, signal) {
  if (signal && signal.aborted) {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    error.aborted = true;
    throw error;
  }
  return handleOnlineTranslation(query);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isPdfUrl,
    normalizeQuery,
    createCombinedSignal,
    getCachedTranslation,
    setCachedTranslation,
    handleOnlineTranslation,
    handleContextExplanation,
    activeRequests,
    pendingInFlight,
    memoryCache,
    updateTabBadge,
    isReaderUrl
  };
}

