(function (global) {
  'use strict';

  const CONTENT_SCRIPT_FILES = [
    'dict/academic_dict.js',
    'dict_service.js',
    'glossary_service.js',
    'selection_anchor.js',
    'content.js',
    'bilingual.js'
  ];
  const recoveryByTab = new Map();

  class TabBridgeError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'TabBridgeError';
      this.code = code;
      this.cause = cause;
    }
  }

  function classifyTabUrl(url) {
    const value = String(url || '');
    let parsed;
    try {
      parsed = new URL(value);
    } catch (error) {
      return {
        injectable: false,
        code: 'RESTRICTED_PAGE',
        message: '当前页面不允许扩展运行，请切换到普通网页'
      };
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (parsed.protocol === 'chrome-extension:' && path.includes('/reader/reader.html')) {
      return {
        injectable: false,
        code: 'READER_PAGE',
        message: '请使用 PaperDict 阅读器顶部的“双语对照 / 纯中文”按钮'
      };
    }

    const isExtensionStore = host === 'chromewebstore.google.com'
      || (host === 'chrome.google.com' && path.startsWith('/webstore'))
      || (host === 'microsoftedge.microsoft.com' && path.startsWith('/addons'));
    if (isExtensionStore) {
      return {
        injectable: false,
        code: 'EXTENSION_STORE',
        message: '浏览器扩展商店禁止其他扩展运行，请切换到普通网页'
      };
    }

    const isPdfRoute = path.endsWith('.pdf')
      || path.includes('/pdf/')
      || path.startsWith('/pdf/')
      || parsed.searchParams.has('pdf')
      || (path.includes('pdf') && parsed.searchParams.has('id'));
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isPdfRoute) {
      return {
        injectable: false,
        code: 'PDF_PAGE',
        message: '浏览器内置 PDF 页面不支持直接切换，请用 PaperDict 阅读器打开'
      };
    }

    if (parsed.protocol === 'file:') return { injectable: true, isFile: true };
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return { injectable: true, isFile: false };
    return {
      injectable: false,
      code: 'RESTRICTED_PAGE',
      message: '当前页面不支持整页翻译，请切换到普通网页'
    };
  }

  function isInjectableUrl(url) {
    return classifyTabUrl(url).injectable;
  }

  function sendTabMessage(chromeApi, tabId, message) {
    return new Promise((resolve, reject) => {
      chromeApi.tabs.sendMessage(tabId, message, (response) => {
        const runtimeError = chromeApi.runtime && chromeApi.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || 'Content script unavailable'));
          return;
        }
        if (!response) {
          reject(new Error('Content script did not respond'));
          return;
        }
        resolve(response);
      });
    });
  }

  async function inspectContentState(chromeApi, tabId) {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      func: () => ({
        contentLoaded: Boolean(window.__paper_dict_injected__),
        managerLoaded: Boolean(window.paperBilingualManager)
      })
    });
    return results && results[0] && results[0].result
      ? results[0].result
      : { contentLoaded: false, managerLoaded: false };
  }

  async function injectContentScripts(chromeApi, tabId) {
    if (!chromeApi.scripting) throw new Error('Scripting API unavailable');
    const state = await inspectContentState(chromeApi, tabId);
    await chromeApi.scripting.insertCSS({
      target: { tabId },
      files: ['bilingual.css']
    });
    await chromeApi.scripting.executeScript({
      target: { tabId },
      files: (state.contentLoaded || state.managerLoaded) ? ['bilingual.js'] : CONTENT_SCRIPT_FILES
    });
  }

  function recoverContentScripts(chromeApi, tabId) {
    const key = String(tabId);
    if (recoveryByTab.has(key)) return recoveryByTab.get(key);
    const recovery = injectContentScripts(chromeApi, tabId)
      .finally(() => recoveryByTab.delete(key));
    recoveryByTab.set(key, recovery);
    return recovery;
  }

  async function sendMessageWithRecovery(chromeApi, tab, message) {
    if (!tab || !tab.id) {
      throw new TabBridgeError('NO_ACTIVE_TAB', '未找到可用的当前标签页');
    }

    try {
      return await sendTabMessage(chromeApi, tab.id, message);
    } catch (initialError) {
      const classification = classifyTabUrl(tab.url);
      if (!classification.injectable) {
        throw new TabBridgeError(
          classification.code,
          classification.message,
          initialError
        );
      }

      try {
        await recoverContentScripts(chromeApi, tab.id);
      } catch (recoveryError) {
        if (classification.isFile) {
          throw new TabBridgeError(
            'FILE_ACCESS_REQUIRED',
            '请在扩展详情页开启“允许访问文件网址”后重试',
            recoveryError
          );
        }
        throw new TabBridgeError(
          'CONTENT_SCRIPT_UNAVAILABLE',
          '当前页面拒绝扩展注入，请刷新普通网页后重试',
          recoveryError
        );
      }

      try {
        return await sendTabMessage(chromeApi, tab.id, message);
      } catch (retryError) {
        throw new TabBridgeError(
          'CONTENT_SCRIPT_UNAVAILABLE',
          '扩展已尝试重新连接，请刷新页面后重试',
          retryError
        );
      }
    }
  }

  const api = {
    CONTENT_SCRIPT_FILES,
    TabBridgeError,
    classifyTabUrl,
    isInjectableUrl,
    sendMessageWithRecovery
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.PaperDictTabBridge = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
