/**
 * PaperDict - Content Script
 * Injected into academic web pages and browser PDF views.
 * Renders an isolated Shadow DOM popup on text selection.
 */

(function () {
  'use strict';

  // Avoid duplicate injection in same frame
  if (window.__paper_dict_injected__) return;
  window.__paper_dict_injected__ = true;

  // Default configuration
  let settings = {
    enabled: true,
    deHyphen: true,
    autoAudio: false,
    onlineFallback: true
  };

  // Load settings from storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings, (items) => {
      settings = Object.assign(settings, items);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const [key, val] of Object.entries(changes)) {
          settings[key] = val.newValue;
        }
      }
    });
  }

  // Initialize DictService
  const dictService = new (window.DictService || globalThis.DictService)(
    typeof ACADEMIC_DICT !== 'undefined' ? ACADEMIC_DICT : null
  );

  // SVG Icons
  const ICONS = {
    speaker: `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
  };

  // Shadow DOM Host
  let hostEl = null;
  let shadowRoot = null;
  let cardEl = null;
  let currentAudio = null;
  let activeQuery = '';
  let activeTransText = '';

  // Create isolated Shadow DOM
  function setupShadowDOM() {
    if (hostEl) {
      if (!hostEl.parentElement) {
        (document.body || document.documentElement).appendChild(hostEl);
      }
      return;
    }

    hostEl = document.createElement('paper-dict-host');
    hostEl.id = 'paper-dict-host-root';
    hostEl.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; border: none; margin: 0; padding: 0;';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    // Inject CSS directly into Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1e293b;
        box-sizing: border-box;
      }
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      .paper-dict-card {
        position: fixed !important;
        width: 320px;
        max-width: calc(100vw - 20px);
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.18), 0 4px 12px -2px rgba(15, 23, 42, 0.08);
        border: 1px solid #e2e8f0;
        overflow: hidden;
        z-index: 2147483647 !important;
        opacity: 0;
        transform: translateY(4px) scale(0.98);
        transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
        user-select: text;
        text-align: left;
      }
      .paper-dict-card.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px 8px;
        background: #f8fafc;
        border-bottom: 1px solid #f1f5f9;
      }
      .card-title-group {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
        max-width: 210px;
      }
      .word-title {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
        word-break: break-word;
      }
      .phonetic-tag {
        font-size: 12px;
        font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
        color: #64748b;
        background: #e2e8f0;
        padding: 1px 6px;
        border-radius: 4px;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        color: #64748b;
        transition: all 0.15s ease;
        outline: none;
      }
      .action-btn:hover {
        background: #e2e8f0;
        color: #1e293b;
      }
      .action-btn svg {
        width: 15px;
        height: 15px;
        fill: currentColor;
      }
      .action-btn.playing {
        color: #2563eb;
        animation: pulse 0.8s infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }
      .card-body {
        padding: 12px 14px;
        max-height: 260px;
        overflow-y: auto;
      }
      .card-body::-webkit-scrollbar { width: 5px; }
      .card-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      .def-list { display: flex; flex-direction: column; gap: 8px; }
      .def-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 13px;
        line-height: 1.55;
      }
      .pos-tag {
        font-size: 11px;
        font-weight: 700;
        color: #2563eb;
        background: #eff6ff;
        border: 1px solid #dbeafe;
        padding: 1px 5px;
        border-radius: 4px;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .def-text { color: #334155; word-break: break-word; }
      .sentence-trans {
        font-size: 13.5px;
        line-height: 1.6;
        color: #1e293b;
        word-break: break-word;
      }
      .inflection-hint {
        font-size: 11px;
        color: #64748b;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .inflection-hint span { font-weight: 600; color: #2563eb; }
      .loading-box {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 0;
        color: #64748b;
        font-size: 13px;
      }
      .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #e2e8f0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 14px 8px;
        background: #ffffff;
        border-top: 1px solid #f8fafc;
        font-size: 11px;
        color: #94a3b8;
      }
      .badge-source {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 500;
      }
      .badge-source.offline { color: #059669; }
      .badge-source.online { color: #2563eb; }
      .copy-hint {
        color: #10b981;
        font-weight: 600;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .copy-hint.show { opacity: 1; }
    `;

    shadowRoot.appendChild(style);

    cardEl = document.createElement('div');
    cardEl.className = 'paper-dict-card';
    shadowRoot.appendChild(cardEl);

    const target = document.body || document.documentElement;
    if (target) {
      target.appendChild(hostEl);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.body || document.documentElement).appendChild(hostEl);
      });
    }
  }

  // Play pronunciation
  function playAudio(word) {
    if (!word) return;
    const speakerBtn = shadowRoot ? shadowRoot.querySelector('#btn-speaker') : null;
    if (speakerBtn) speakerBtn.classList.add('playing');

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    const audio = new Audio(youdaoUrl);
    currentAudio = audio;

    const cleanup = () => {
      if (speakerBtn) speakerBtn.classList.remove('playing');
    };

    audio.onended = cleanup;
    audio.onerror = () => {
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'en-US';
        utter.onend = cleanup;
        utter.onerror = cleanup;
        window.speechSynthesis.speak(utter);
      } else {
        cleanup();
      }
    };

    audio.play().catch(() => {
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'en-US';
        utter.onend = cleanup;
        utter.onerror = cleanup;
        window.speechSynthesis.speak(utter);
      } else {
        cleanup();
      }
    });
  }

  // Hide popup card
  function hideCard() {
    if (cardEl) {
      cardEl.classList.remove('visible');
    }
  }

  // Smart positioning calculation near selected text (Viewport relative)
  function positionCard(rect) {
    if (!cardEl) return;

    const cardWidth = 320;
    const cardHeight = cardEl.offsetHeight || 180;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    // Center horizontally aligned with selection
    let left = rect.left + (rect.width / 2) - (cardWidth / 2);
    let top = rect.bottom + 8;

    // Vertical boundary check: if overflow bottom, place above
    if (top + cardHeight > winHeight - 10) {
      if (rect.top - cardHeight - 8 > 10) {
        top = rect.top - cardHeight - 8;
      } else {
        top = Math.max(10, winHeight - cardHeight - 10);
      }
    }

    // Horizontal boundary clamp
    if (left < 10) left = 10;
    if (left + cardWidth > winWidth - 10) {
      left = Math.max(10, winWidth - cardWidth - 10);
    }
    if (top < 10) top = 10;

    cardEl.style.left = `${Math.round(left)}px`;
    cardEl.style.top = `${Math.round(top)}px`;
  }

  // Render card content
  function renderCard(data, rect) {
    setupShadowDOM();

    activeQuery = data.title;
    activeTransText = data.rawTrans || '';

    let bodyHtml = '';

    if (data.loading) {
      bodyHtml = `
        <div class="loading-box">
          <div class="spinner"></div>
          <span>正在翻译中...</span>
        </div>
      `;
    } else if (data.isSentence) {
      bodyHtml = `
        <div class="sentence-trans">${escapeHtml(data.translation)}</div>
      `;
    } else if (data.definitions && data.definitions.length > 0) {
      let inflectionHtml = '';
      if (data.isInflected && data.baseWord) {
        inflectionHtml = `
          <div class="inflection-hint">
            原形: <span>${escapeHtml(data.baseWord)}</span>
          </div>
        `;
      }

      const defItems = data.definitions.map(d => `
        <div class="def-item">
          <span class="pos-tag">${escapeHtml(d.pos)}</span>
          <span class="def-text">${escapeHtml(d.text)}</span>
        </div>
      `).join('');

      bodyHtml = `
        ${inflectionHtml}
        <div class="def-list">${defItems}</div>
      `;
    } else {
      bodyHtml = `
        <div class="sentence-trans">${escapeHtml(data.translation || '未找到该词释义')}</div>
      `;
    }

    const phoneticHtml = data.phonetic ? `<span class="phonetic-tag">/${escapeHtml(data.phonetic)}/</span>` : '';
    const speakerBtnHtml = data.showSpeaker ? `
      <button class="action-btn" id="btn-speaker" title="朗读发音">
        ${ICONS.speaker}
      </button>
    ` : '';

    const sourceBadge = data.source === 'offline' 
      ? `<span class="badge-source offline">● 离线学术词典</span>`
      : `<span class="badge-source online">● ${escapeHtml(data.sourceName || '在线翻译')}</span>`;

    cardEl.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <span class="word-title">${escapeHtml(data.title)}</span>
          ${phoneticHtml}
        </div>
        <div class="header-actions">
          ${speakerBtnHtml}
          <button class="action-btn" id="btn-copy" title="复制释义">
            ${ICONS.copy}
          </button>
          <button class="action-btn" id="btn-close" title="关闭 (Esc)">
            ${ICONS.close}
          </button>
        </div>
      </div>
      <div class="card-body">
        ${bodyHtml}
      </div>
      <div class="card-footer">
        ${sourceBadge}
        <span class="copy-hint" id="copy-hint">已复制 √</span>
      </div>
    `;

    // Bind event listeners inside shadow DOM
    const btnSpeaker = shadowRoot.querySelector('#btn-speaker');
    if (btnSpeaker) {
      btnSpeaker.onclick = (e) => {
        e.stopPropagation();
        playAudio(data.baseWord || data.title);
      };
    }

    const btnCopy = shadowRoot.querySelector('#btn-copy');
    if (btnCopy) {
      btnCopy.onclick = (e) => {
        e.stopPropagation();
        const copyText = `${data.title}\n${activeTransText}`;
        navigator.clipboard.writeText(copyText).then(() => {
          const hint = shadowRoot.querySelector('#copy-hint');
          if (hint) {
            hint.classList.add('show');
            setTimeout(() => hint.classList.remove('show'), 1500);
          }
        });
      };
    }

    const btnClose = shadowRoot.querySelector('#btn-close');
    if (btnClose) {
      btnClose.onclick = (e) => {
        e.stopPropagation();
        hideCard();
      };
    }

    // Position and show
    positionCard(rect);
    cardEl.classList.add('visible');

    // Auto audio if enabled
    if (settings.autoAudio && data.showSpeaker && !data.loading) {
      playAudio(data.baseWord || data.title);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Handle selection search
  async function processSelection(selection, overrideText = null) {
    if (!settings.enabled && !overrideText) return;

    let text = overrideText;
    let rect = null;

    if (!text) {
      // Check input / textarea active element first
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          text = activeEl.value.substring(start, end);
          rect = activeEl.getBoundingClientRect();
        }
      }

      // Check window selection
      if (!text && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        text = selection.toString();
        try {
          const range = selection.getRangeAt(0);
          rect = range.getBoundingClientRect();
        } catch (e) {}
      }
    }

    if (!text) {
      hideCard();
      return;
    }

    // Clean paper text (PDF hyphen removal, multi-whitespace collapse)
    const cleaned = dictService.cleanPaperText(text, settings.deHyphen);

    if (!dictService.isLookupEligible(cleaned)) {
      hideCard();
      return;
    }

    // Fallback rect if needed
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      rect = {
        left: window.innerWidth / 2 - 100,
        top: window.innerHeight / 3,
        right: window.innerWidth / 2 + 100,
        bottom: window.innerHeight / 3 + 20,
        width: 200,
        height: 20
      };
    }

    const isSingleWord = dictService.isSingleWord(cleaned);

    if (isSingleWord) {
      const localResult = dictService.lookupLocal(cleaned);

      if (localResult && localResult.found) {
        const definitions = dictService.parseDefinitions(localResult.translation);
        renderCard({
          title: cleaned,
          baseWord: localResult.baseWord,
          phonetic: localResult.phonetic,
          definitions,
          rawTrans: localResult.translation,
          isInflected: localResult.isInflected,
          showSpeaker: true,
          source: 'offline',
          sourceName: '离线学术词典',
          isSentence: false,
          loading: false
        }, rect);
        return;
      }
    }

    // Fallback to online translation if enabled
    if (settings.onlineFallback) {
      renderCard({
        title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
        phonetic: '',
        definitions: [],
        rawTrans: '',
        showSpeaker: isSingleWord,
        source: 'online',
        sourceName: '在线翻译',
        isSentence: !isSingleWord,
        loading: true
      }, rect);

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_ONLINE',
          text: cleaned
        });

        if (response && response.success) {
          renderCard({
            title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
            phonetic: '',
            translation: response.translation,
            rawTrans: response.translation,
            showSpeaker: isSingleWord,
            source: 'online',
            sourceName: response.source || '在线翻译',
            isSentence: true,
            loading: false
          }, rect);
        } else {
          renderCard({
            title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
            translation: response?.error || '未查到对应释义',
            rawTrans: response?.error || '',
            showSpeaker: false,
            source: 'online',
            sourceName: '查询失败',
            isSentence: true,
            loading: false
          }, rect);
        }
      } catch (err) {
        renderCard({
          title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
          translation: '网络连接超时，请检查网络设置',
          rawTrans: '网络连接超时',
          showSpeaker: false,
          source: 'online',
          sourceName: '查询失败',
          isSentence: true,
          loading: false
        }, rect);
      }
    }
  }

  // Debounced check
  let checkTimer = null;
  function triggerSelectionCheck() {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const selection = window.getSelection();
      const activeEl = document.activeElement;
      const isInputSelection = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.selectionEnd > activeEl.selectionStart;

      if ((!selection || selection.isCollapsed) && !isInputSelection) {
        hideCard();
        return;
      }
      processSelection(selection);
    }, 25);
  }

  // Mouse up (Capture & Bubble)
  function onMouseUp(e) {
    if (e.composedPath && e.composedPath().some(el => el === cardEl || el === hostEl)) {
      return;
    }
    triggerSelectionCheck();
  }

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mouseup', onMouseUp, false);

  // Key up for keyboard selections (Shift + Arrows)
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      triggerSelectionCheck();
    }
  }, true);

  // Click outside to dismiss
  document.addEventListener('mousedown', (e) => {
    if (e.composedPath && e.composedPath().some(el => el === cardEl || el === hostEl)) {
      return;
    }
    if (cardEl && cardEl.classList.contains('visible')) {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hideCard();
      }
    }
  }, true);

  // ESC key to dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideCard();
    }
  }, true);

  // Context menu trigger from background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TRIGGER_TRANSLATE_FROM_MENU' && msg.text) {
        processSelection(null, msg.text);
      }
    });
  }
})();
