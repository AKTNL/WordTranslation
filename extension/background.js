/**
 * PaperDict - Background Service Worker (Manifest V3)
 * Handles online translation fallback, custom LLM/DeepL engines,
 * persistent cache with chrome.storage.local, context menu actions, and reader navigation.
 */

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
  customApiKey: '',
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
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
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
      if (isPdfUrl(tab.url)) continue;
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

// Fallback tab update listener for PDF detection
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
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

/**
 * Multi-engine online translation with user custom API support, caching and failover
 */
async function handleOnlineTranslation(text, requestId = null) {
  if (!text || !text.trim()) {
    return { success: false, error: '输入文本为空' };
  }

  const query = normalizeQuery(text);

  // 1. Check persistent cache
  const cached = await getCachedTranslation(query);
  if (cached) {
    return {
      success: true,
      translation: cached,
      source: 'PaperDict 本地缓存',
      query
    };
  }

  // Setup abort controller for this specific request
  const requestController = new AbortController();
  if (requestId) {
    activeRequests.set(requestId, requestController);
  }

  try {
    // 2. Concurrency De-duplication: Reuse pending promise for same query
    if (pendingInFlight.has(query)) {
      const existingPromise = pendingInFlight.get(query);
      const abortPromise = new Promise((_, reject) => {
        requestController.signal.addEventListener('abort', () => {
          const err = new Error('请求已取消');
          err.name = 'AbortError';
          err.aborted = true;
          reject(err);
        }, { once: true });
      });

      return await Promise.race([existingPromise, abortPromise]);
    }

    // 3. Initiate actual translation pipeline
    const pipelinePromise = executeTranslationPipeline(query, requestController.signal);
    pendingInFlight.set(query, pipelinePromise);

    const result = await pipelinePromise;
    return result;
  } finally {
    pendingInFlight.delete(query);
    if (requestId) {
      activeRequests.delete(requestId);
    }
  }
}

async function executeTranslationPipeline(query, signal) {
  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  // 1. Check if user configured custom API (OpenAI / DeepL)
  const userSettings = await new Promise((resolve) => {
    chrome.storage.sync.get(['customEngine', 'customApiKey', 'customApiEndpoint', 'customModel'], (items) => {
      resolve(items || {});
    });
  });

  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  if (userSettings.customEngine === 'openai' && userSettings.customApiKey) {
    try {
      const customRes = await tryOpenAITranslate(
        query,
        userSettings.customApiKey,
        userSettings.customApiEndpoint,
        userSettings.customModel,
        signal
      );
      if (customRes) {
        await setCachedTranslation(query, customRes.translation);
        return customRes;
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw err;
      console.warn('Custom OpenAI translation failed, falling back to public engine:', err);
    }
  } else if (userSettings.customEngine === 'deepl' && userSettings.customApiKey) {
    try {
      const deeplRes = await tryDeepLTranslate(query, userSettings.customApiKey, userSettings.customApiEndpoint, signal);
      if (deeplRes) {
        await setCachedTranslation(query, deeplRes.translation);
        return deeplRes;
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw err;
      console.warn('Custom DeepL translation failed, falling back to public engine:', err);
    }
  }

  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  // 2. Fallback to free public engines
  const hasFormulaToken = query.includes('PDMATH_');
  const isLongParagraph = query.length > 200 || hasFormulaToken;

  if (isLongParagraph) {
    const gtxResult = await tryGoogleTranslate(query, signal);
    if (gtxResult) {
      await setCachedTranslation(query, gtxResult.translation);
      return gtxResult;
    }
  }

  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  // Try Engine 1: MyMemory Translation API
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=en|zh-CN`;
    const timeoutWrap = createCombinedSignal(signal, 6000);

    const res = await fetch(url, { signal: timeoutWrap.signal });
    timeoutWrap.cleanup();

    if (res.ok) {
      const data = await res.json();
      if (data && data.responseData && data.responseData.translatedText) {
        const result = data.responseData.translatedText;
        if (result && !result.startsWith('MYMEMORY WARNING')) {
          await setCachedTranslation(query, result);
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
    if (e.name === 'AbortError' || signal?.aborted) throw e;
    console.warn('MyMemory engine failed, trying fallback:', e);
  }

  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  // Try Engine 2: Google Translate GTX endpoint
  if (!isLongParagraph) {
    const gtxResult = await tryGoogleTranslate(query, signal);
    if (gtxResult) {
      await setCachedTranslation(query, gtxResult.translation);
      return gtxResult;
    }
  }

  if (signal && signal.aborted) {
    const err = new Error('请求已取消');
    err.name = 'AbortError';
    err.aborted = true;
    throw err;
  }

  // Try Engine 3: Lingva public instance fallback
  try {
    const lUrl = `https://lingva.ml/api/v1/en/zh/${encodeURIComponent(query)}`;
    const timeoutWrap = createCombinedSignal(signal, 6000);

    const res = await fetch(lUrl, { signal: timeoutWrap.signal });
    timeoutWrap.cleanup();

    if (res.ok) {
      const data = await res.json();
      if (data && data.translation) {
        await setCachedTranslation(query, data.translation);
        return {
          success: true,
          translation: data.translation,
          source: '在线翻译',
          query
        };
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || signal?.aborted) throw e;
    console.warn('Lingva engine failed:', e);
  }

  return {
    success: false,
    error: '网络暂不可用或无法连接翻译引擎，请稍后重试',
    query
  };
}

async function tryGoogleTranslate(query, signal) {
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(query)}`;
    const timeoutWrap = createCombinedSignal(signal, 6000);

    const res = await fetch(gUrl, { signal: timeoutWrap.signal });
    timeoutWrap.cleanup();

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
    if (e.name === 'AbortError' || signal?.aborted) throw e;
    console.warn('Google Translate engine failed:', e);
  }
  return null;
}

// Custom OpenAI-compatible Translation (DeepSeek, Kimi, GLM, OpenAI, etc.)
async function tryOpenAITranslate(query, apiKey, customEndpoint, customModel, signal) {
  const endpoint = customEndpoint || 'https://api.openai.com/v1/chat/completions';
  const model = customModel || 'gpt-4o-mini';
  const timeoutWrap = createCombinedSignal(signal, 10000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal: timeoutWrap.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert academic translator. Translate the following English scientific text into fluent, professional Simplified Chinese. Preserve any PDMATH_ tokens exactly without alteration. Output ONLY the translated text without commentary.'
          },
          { role: 'user', content: query }
        ],
        temperature: 0.2
      })
    });
    timeoutWrap.cleanup();

    if (res.ok) {
      const data = await res.json();
      const translated = data?.choices?.[0]?.message?.content?.trim();
      if (translated) {
        return {
          success: true,
          translation: translated,
          source: `AI 模型 (${model})`,
          query
        };
      }
    }
  } catch (err) {
    timeoutWrap.cleanup();
    throw err;
  }
  return null;
}

// Custom DeepL Translation
async function tryDeepLTranslate(query, apiKey, customEndpoint, signal) {
  const isFree = apiKey.endsWith(':fx');
  const defaultEndpoint = isFree ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
  const endpoint = customEndpoint || defaultEndpoint;
  const timeoutWrap = createCombinedSignal(signal, 8000);

  const body = new URLSearchParams({
    auth_key: apiKey,
    text: query,
    target_lang: 'ZH'
  });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: timeoutWrap.signal,
      body: body.toString()
    });
    timeoutWrap.cleanup();

  } catch (err) {
    timeoutWrap.cleanup();
    throw err;
  }
  return null;
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
    memoryCache
  };
}

