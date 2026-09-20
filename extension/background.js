/**
 * PaperDict - Background Service Worker (Manifest V3)
 * Handles online translation fallback, context menu actions, PDF interception, and reader navigation.
 */

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  deHyphen: true,
  autoAudio: false,
  onlineFallback: true,
  autoInterceptPdf: true
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

  // Auto-inject content script into already open normal tabs
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      if (isPdfUrl(tab.url)) continue; // Native PDF cannot receive content script
      chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ['bilingual.css']
      }).catch(() => {});
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['dict/academic_dict.js', 'dict_service.js', 'content.js', 'bilingual.js']
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Auto injection note:', err);
  }
});

// Auto-intercept online PDF navigations to PaperDict Reader
if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return; // Top frame only
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

    // Check if the tab is Chrome's native PDF viewer or an internal page
    const isNativePdf = isPdfUrl(tab.url) || tab.url.startsWith('file://') || tab.url.startsWith('chrome-extension://');

    if (isNativePdf) {
      // In native PDF viewer, content script card is hidden behind <embed>
      // Pop up a dedicated translation mini-window
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

// Message listener for online translation and background actions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_ONLINE') {
    handleOnlineTranslation(request.text)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message || '翻译失败' }));
    return true; // Keep channel open for async response
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

// In-memory cache for paragraph and sentence translations
const translationMemoryCache = new Map();

/**
 * Multi-engine online translation with automatic failover and caching
 */
async function handleOnlineTranslation(text) {
  if (!text || !text.trim()) {
    return { success: false, error: '输入文本为空' };
  }

  const query = text.trim();

  // Check cache first
  if (translationMemoryCache.has(query)) {
    return {
      success: true,
      translation: translationMemoryCache.get(query),
      source: 'PaperDict 本地缓存',
      query
    };
  }

  // If text contains formula tokens or is a long paragraph, prioritize Google Translate GTX
  const hasFormulaToken = query.includes('PDMATH_');
  const isLongParagraph = query.length > 200 || hasFormulaToken;

  if (isLongParagraph) {
    // Try Google Translate GTX first
    const gtxResult = await tryGoogleTranslate(query);
    if (gtxResult) {
      translationMemoryCache.set(query, gtxResult.translation);
      return gtxResult;
    }
  }

  // Try Engine 1: MyMemory Translation API (Fast, reliable, works without VPN)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=en|zh-CN`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.responseData && data.responseData.translatedText) {
        const result = data.responseData.translatedText;
        if (result && !result.startsWith('MYMEMORY WARNING')) {
          translationMemoryCache.set(query, result);
          return {
            success: true,
            translation: result,
            source: 'MyMemory 在线翻译',
            query
          };
        }
      }
    }
  } catch (e) {
    console.warn('MyMemory engine failed, trying fallback:', e);
  }

  // Try Engine 2: Google Translate GTX endpoint (Free web API)
  if (!isLongParagraph) {
    const gtxResult = await tryGoogleTranslate(query);
    if (gtxResult) {
      translationMemoryCache.set(query, gtxResult.translation);
      return gtxResult;
    }
  }

  // Try Engine 3: Lingva public instance fallback
  try {
    const lUrl = `https://lingva.ml/api/v1/en/zh/${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(lUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.translation) {
        translationMemoryCache.set(query, data.translation);
        return {
          success: true,
          translation: data.translation,
          source: '在线翻译',
          query
        };
      }
    }
  } catch (e) {
    console.warn('Lingva engine failed:', e);
  }

  return {
    success: false,
    error: '网络暂不可用或无法连接翻译引擎，请稍后重试',
    query
  };
}

async function tryGoogleTranslate(query) {
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(gUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const trans = data[0].map((item) => item[0]).join('');
        if (trans) {
          return {
            success: true,
            translation: trans,
            source: 'Google 在线翻译',
            query
          };
        }
      }
    }
  } catch (e) {
    console.warn('Google Translate engine failed:', e);
  }
  return null;
}
