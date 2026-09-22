/**
 * PaperDict - Background Service Worker (Manifest V3)
 * Handles online translation fallback, custom LLM/DeepL engines,
 * persistent cache with chrome.storage.local, context menu actions, and reader navigation.
 */

importScripts('translation_service.js', 'glossary_service.js');

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

// Initialize settings and context menu on install
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

// Auto-intercept online PDF navigations to PaperDict Reader if user explicitly opted in
if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
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

// Fallback tab update listener for PDF detection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

// Context menu click handler
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

async function getCachedTranslation(query) {
  if (memoryCache.has(query)) {
    return memoryCache.get(query);
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get('translationCache');
      const diskCache = res.translationCache || {};
      if (diskCache[query]) {
        memoryCache.set(query, diskCache[query]);
        return diskCache[query];
      }
    } catch (e) {}
  }
  return null;
}

async function setCachedTranslation(query, translation) {
  memoryCache.set(query, translation);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const res = await chrome.storage.local.get('translationCache');
      const diskCache = res.translationCache || {};
      diskCache[query] = translation;
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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_ONLINE') {
    handleOnlineTranslation(request.text)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message || '翻译失败' }));
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

  if (request.type === 'OPEN_READER') {
    const url = request.fileUrl
      ? chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(request.fileUrl)}`)
      : chrome.runtime.getURL('reader/reader.html');
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'CHECK_IS_PDF') {
    sendResponse({ isPdf: isPdfUrl(request.url) });
    return true;
  }
});

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

async function handleOnlineTranslation(text) {
  if (!text || !text.trim()) {
    return { success: false, code: 'INVALID_CONFIG', error: '输入文本为空' };
  }

  const query = text.trim();
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
  const result = await translationService.translate(protectedTerms.text, config);
  if (!result.success) return Object.assign({}, result, { query });

  const finalResult = Object.assign({}, result, {
    translation: glossary.service.restore(result.translation, protectedTerms.terms),
    query
  });
  await setCachedTranslation(cacheKey, finalResult);
  return finalResult;
}
