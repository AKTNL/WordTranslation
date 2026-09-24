/**
 * PaperDict - Content Script
 * Injected into academic web pages and browser PDF views.
 * Renders an isolated Shadow DOM popup on text selection with:
 * - Choice of trigger modes: Lightweight floating icon (default), direct popup, or modifier key (Alt/Ctrl)
 * - Draggable card and Pin (钉住) support
 * - Add to vocabulary (生词本) and search history tracking
 * - Domain blacklist support
 * - Full Dark Mode support
 */

(function () {
  'use strict';

  // Avoid duplicate injection in same frame
  if (window.__paper_dict_injected__) return;
  window.__paper_dict_injected__ = true;

  const {
    createRangeAnchor,
    isSelectionNavigationKey
  } = globalThis.PaperDictSelectionAnchor;

  // Default configuration
  let settings = {
    enabled: true,
    triggerMode: 'direct', // 'direct' (default) | 'icon' | 'modifier'
    modifierKey: 'Alt',  // 'Alt' | 'Control' | 'Shift'
    deHyphen: true,
    autoAudio: false,
    onlineFallback: true,
    blacklist: []
  };

  const currentHost = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';

  function isBlacklisted() {
    if (!settings.blacklist || !Array.isArray(settings.blacklist)) return false;
    return settings.blacklist.some(domain => domain && (currentHost === domain || currentHost.endsWith('.' + domain)));
  }

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
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    star: `<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
    starFilled: `<svg viewBox="0 0 24 24"><path fill="#f59e0b" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
    pin: `<svg viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>`,
    highlighter: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4-10 10H8v-4L18 2z"/><path d="m14 6 4 4"/><path d="M4 20h16"/></svg>`,
    eraser: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
    note: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
  };

  // Shadow DOM Host & State
  let hostEl = null;
  let shadowRoot = null;
  let cardEl = null;
  let triggerIconEl = null;
  let currentAudio = null;
  let activeQuery = '';
  let activeTransText = '';
  let pendingSelectionData = null;
  let isPinned = false;
  let currentWordData = null;
  let activeSelectionAnchor = null;
  let selectionCardReady = false;
  let selectionPositionFrame = null;
  let lookupGeneration = 0;
  let isCardInteractionActive = false;
  let currentLookupSeq = 0;
  let activeOnlineRequestId = null;
  let lastActiveRange = null;
  let lastRawSelectedText = '';
  let lastSurroundingText = '';
  let currentActiveAnnotationId = null;
  let currentActiveMarkEl = null;
  const annotationManager = typeof AnnotationManager !== 'undefined' ? new AnnotationManager() : null;
  const glossaryExtractor = typeof GlossaryExtractor !== 'undefined' ? new GlossaryExtractor() : null;
  const citationParser = typeof CitationParser !== 'undefined' ? new CitationParser() : null;

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

      /* Floating Trigger Icon */
      .paper-dict-trigger-btn {
        position: fixed !important;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 13px;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35), 0 2px 4px rgba(0,0,0,0.1);
        cursor: pointer;
        z-index: 2147483647 !important;
        pointer-events: auto;
        opacity: 0;
        transform: scale(0.7);
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        border: 2px solid #ffffff;
        user-select: none;
      }
      .paper-dict-trigger-btn.visible {
        opacity: 1;
        transform: scale(1);
      }
      .paper-dict-trigger-btn:hover {
        transform: scale(1.12);
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
      }

      /* Floating Card */
      .paper-dict-card {
        position: fixed !important;
        width: 370px;
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
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
        padding: 9px 12px 8px;
        background: #f8fafc;
        border-bottom: 1px solid #f1f5f9;
        cursor: move; /* Draggable handle */
        user-select: none;
        gap: 8px;
        white-space: nowrap;
      }
      .card-title-group {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
      }
      .word-title {
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }
      .phonetic-tag {
        font-size: 12px;
        font-family: 'Lucida Sans Unicode', 'Arial Unicode MS', sans-serif;
        color: #64748b;
        background: #e2e8f0;
        padding: 1px 6px;
        border-radius: 4px;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 25px;
        height: 25px;
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
      .action-btn.active-pinned {
        color: #2563eb;
        background: #eff6ff;
      }
      .action-btn.active-starred {
        color: #f59e0b;
      }
      .btn-ai-guide {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 1px 8px;
        height: 22px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 11px;
        color: #2563eb;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        outline: none;
      }
      .btn-ai-guide:hover {
        background: #dbeafe;
        color: #1d4ed8;
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

      /* Highlight & Note Action Bar */
      .card-highlight-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 12px;
        background: #f8fafc;
        border-top: 1px solid #f1f5f9;
        white-space: nowrap;
        gap: 8px;
      }
      .hl-palette {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .hl-label-group {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        font-weight: 700;
        color: #475569;
        user-select: none;
        flex-shrink: 0;
      }
      .hl-label-group svg {
        color: #64748b;
        flex-shrink: 0;
      }
      .hl-status-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 4px;
        border-radius: 3px;
        background: #e2e8f0;
        color: #64748b;
        margin-left: 1px;
        flex-shrink: 0;
      }
      .hl-status-badge.active {
        background: #fef9c3;
        color: #854d0e;
        border: 1px solid #fef08a;
      }
      .hl-swatches {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .hl-color-btn {
        position: relative;
        width: 20px;
        height: 16px;
        border-radius: 4px;
        border: 1.5px solid transparent;
        cursor: pointer;
        outline: none;
        transition: all 0.15s ease;
        padding: 0;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.12);
      }
      .hl-color-btn:hover {
        transform: translateY(-1px);
        box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.18), 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .hl-color-btn.active {
        border-color: #0f172a !important;
        transform: scale(1.1);
        box-shadow: 0 0 0 2px #2563eb, inset 0 -3px 0 rgba(0, 0, 0, 0.18);
      }
      .hl-color-btn .hl-check-icon {
        display: none;
        width: 9px;
        height: 9px;
        stroke: currentColor;
      }
      .hl-color-btn.active .hl-check-icon {
        display: block;
      }
      .hl-yellow { background: #fef08a; border-color: #eab308; color: #713f12; }
      .hl-green  { background: #bbf7d0; border-color: #22c55e; color: #14532d; }
      .hl-blue   { background: #bfdbfe; border-color: #3b82f6; color: #1e3a8a; }
      .hl-pink   { background: #fbcfe8; border-color: #ec4899; color: #831843; }
      .hl-clear-btn {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        color: #64748b;
        font-size: 10.5px;
        padding: 2px 5px;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
        outline: none;
      }
      .hl-clear-btn svg {
        flex-shrink: 0;
      }
      .hl-clear-btn:hover {
        border-color: #ef4444;
        color: #ef4444;
        background: #fef2f2;
      }
      .hl-actions-right {
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .hl-tool-btn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        justify-content: center;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        color: #334155;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
        outline: none;
      }
      .hl-tool-btn svg {
        flex-shrink: 0;
      }
      .hl-tool-btn:hover {
        background: #eff6ff;
        color: #2563eb;
        border-color: #93c5fd;
      }
      .card-note-box {
        padding: 8px 14px 10px;
        background: #f8fafc;
        border-top: 1px dashed #e2e8f0;
      }
      .note-textarea {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        padding: 6px 8px;
        font-size: 12px;
        font-family: inherit;
        color: #1e293b;
        background: #ffffff;
        resize: vertical;
        box-sizing: border-box;
        outline: none;
      }
      .note-textarea:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37,99,235,0.15);
      }
      .note-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 6px;
      }
      .btn-save-note {
        padding: 3px 9px;
        font-size: 11px;
        font-weight: 600;
        color: #ffffff;
        background: #2563eb;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .btn-save-note:hover { background: #1d4ed8; }

      /* AI Context-aware Explanation Box */
      .card-context-box {
        padding: 10px 14px;
        background: #f0fdf4;
        border-top: 1px solid #bbf7d0;
        font-size: 12px;
        line-height: 1.55;
      }
      .context-box-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        font-weight: 700;
        color: #166534;
        font-size: 11.5px;
      }
      .context-source-badge {
        font-size: 10.5px;
        color: #15803d;
        background: #dcfce7;
        padding: 1px 6px;
        border-radius: 3px;
      }
      .context-content {
        color: #1e293b;
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* Dark Mode Adaptations */
      @media (prefers-color-scheme: dark) {
        .paper-dict-card {
          background: #0f172a;
          border-color: #334155;
          color: #f1f5f9;
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3);
        }
        .card-header {
          background: #1e293b;
          border-bottom-color: #334155;
        }
        .word-title { color: #f8fafc; }
        .phonetic-tag { background: #334155; color: #94a3b8; }
        .action-btn { color: #94a3b8; }
        .action-btn:hover { background: #334155; color: #f8fafc; }
        .action-btn.active-pinned { background: #1e3a8a; color: #60a5fa; }
        .btn-ai-guide {
          background: #1e3a8a;
          border-color: #2563eb;
          color: #93c5fd;
        }
        .btn-ai-guide:hover {
          background: #1d4ed8;
          color: #ffffff;
        }
        .card-highlight-bar {
          background: #1e293b;
          border-top-color: #334155;
        }
        .hl-label-group { color: #94a3b8; }
        .hl-label-group svg { color: #94a3b8; }
        .hl-status-badge {
          background: #334155;
          color: #94a3b8;
        }
        .hl-status-badge.active {
          background: #854d0e;
          color: #fef08a;
          border: 1px solid #eab308;
        }
        .hl-color-btn.active {
          border-color: #f8fafc !important;
          box-shadow: 0 0 0 2px #60a5fa, inset 0 -3px 0 rgba(0, 0, 0, 0.25);
        }
        .hl-clear-btn {
          background: #0f172a;
          border-color: #475569;
          color: #94a3b8;
        }
        .hl-clear-btn:hover {
          border-color: #f87171;
          color: #f87171;
          background: #450a0a;
        }
        .hl-tool-btn {
          background: #0f172a;
          border-color: #334155;
          color: #94a3b8;
        }
        .hl-tool-btn:hover {
          background: #1e3a8a;
          color: #93c5fd;
          border-color: #3b82f6;
        }
        .card-note-box {
          background: #1e293b;
          border-top-color: #334155;
        }
        .note-textarea {
          background: #0f172a;
          border-color: #475569;
          color: #f1f5f9;
        }
        .card-context-box {
          background: #064e3b;
          border-top-color: #047857;
        }
        .context-box-header { color: #6ee7b7; }
        .context-source-badge { background: #065f46; color: #a7f3d0; }
        .context-content { color: #ecfdf5; }
        .card-footer {
          background: #0f172a;
          border-top-color: #1e293b;
        }
        .def-text { color: #cbd5e1; }
        .sentence-trans { color: #f1f5f9; }
        .pos-tag {
          background: #1e3a8a;
          border-color: #2563eb;
          color: #93c5fd;
        }
        .card-body::-webkit-scrollbar-thumb { background: #475569; }
      }
    `;

    shadowRoot.appendChild(style);

    // Create trigger icon
    triggerIconEl = document.createElement('div');
    triggerIconEl.className = 'paper-dict-trigger-btn';
    triggerIconEl.id = 'paper-dict-trigger-btn';
    triggerIconEl.title = 'PaperDict 查词';
    triggerIconEl.innerHTML = '<span style="font-size:12px;font-weight:700;">译</span>';
    shadowRoot.appendChild(triggerIconEl);

    // Create card element
    cardEl = document.createElement('div');
    cardEl.className = 'paper-dict-card';
    shadowRoot.appendChild(cardEl);

    // Bind trigger icon 2D Drag & Click
    let isDraggingTrigger = false;
    let suppressTriggerClick = false;
    let triggerClickResetTimer = null;
    let triggerStartX = 0;
    let triggerStartY = 0;
    let triggerInitLeft = 0;
    let triggerInitTop = 0;

    triggerIconEl.addEventListener('mousedown', (e) => {
      isDraggingTrigger = false;
      suppressTriggerClick = false;
      if (triggerClickResetTimer !== null) {
        clearTimeout(triggerClickResetTimer);
        triggerClickResetTimer = null;
      }
      triggerStartX = e.clientX;
      triggerStartY = e.clientY;
      const rect = triggerIconEl.getBoundingClientRect();
      triggerInitLeft = rect.left;
      triggerInitTop = rect.top;

      const onMove = (moveEv) => {
        const dx = moveEv.clientX - triggerStartX;
        const dy = moveEv.clientY - triggerStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          isDraggingTrigger = true;
          suppressTriggerClick = true;
        }
        const newLeft = Math.max(10, Math.min(window.innerWidth - 36, triggerInitLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - 36, triggerInitTop + dy));
        triggerIconEl.style.left = `${newLeft}px`;
        triggerIconEl.style.top = `${newTop}px`;
      };

      const onUp = (upEv) => {
        if (isDraggingTrigger) {
          suppressTriggerClick = true;
          if (upEv && typeof upEv.preventDefault === 'function') upEv.preventDefault();
          triggerClickResetTimer = setTimeout(() => {
            suppressTriggerClick = false;
            triggerClickResetTimer = null;
          }, 400);
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    triggerIconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDraggingTrigger || suppressTriggerClick) {
        isDraggingTrigger = false;
        suppressTriggerClick = false;
        if (triggerClickResetTimer !== null) {
          clearTimeout(triggerClickResetTimer);
          triggerClickResetTimer = null;
        }
        return;
      }
      hideTriggerIcon();
      if (pendingSelectionData) {
        const selectionData = pendingSelectionData;
        pendingSelectionData = null;
        executeLookup(
          selectionData.text,
          selectionData.rect,
          selectionData.lookupToken
        );
      }
    });

    const target = document.body || document.documentElement;
    if (target) {
      target.appendChild(hostEl);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.body || document.documentElement).appendChild(hostEl);
      });
    }

    bindCardDrag();
  }

  // Draggable Card functionality (card-drag / isDraggingCard)
  function bindCardDrag() {
    let isDraggingCard = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onMouseDown = (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const header = path.find((node) => node && node.classList && node.classList.contains('card-header'));
      if (!header) return;
      if (e.target.closest && e.target.closest('.action-btn')) return;

      isDraggingCard = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = cardEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      const onMouseMove = (moveEv) => {
        if (!isDraggingCard) return;
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;
        const viewport = getViewportSize();
        const position = clampCardPosition(
          initialLeft + dx,
          initialTop + dy,
          viewport.width,
          viewport.height,
          getCardDimensions()
        );
        cardEl.style.left = `${Math.round(position.left)}px`;
        cardEl.style.top = `${Math.round(position.top)}px`;
      };

      const onMouseUp = () => {
        isDraggingCard = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    if (cardEl) cardEl.addEventListener('mousedown', onMouseDown);
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

  function showTriggerIcon(rect) {
    setupShadowDOM();
    if (!triggerIconEl) return;

    let left = rect.right + 6;
    let top = rect.top - 18;

    if (left + 32 > window.innerWidth - 10) {
      left = rect.left - 32;
    }
    if (top < 10) {
      top = rect.bottom + 6;
    }

    triggerIconEl.style.left = `${Math.round(left)}px`;
    triggerIconEl.style.top = `${Math.round(top)}px`;
    triggerIconEl.classList.add('visible');
  }

  function hideTriggerIcon() {
    if (triggerIconEl) {
      triggerIconEl.classList.remove('visible');
    }
  }

  function clearActiveSelectionAnchor() {
    if (activeSelectionAnchor) {
      activeSelectionAnchor.dispose();
      activeSelectionAnchor = null;
    }
  }

  function isNodeInsideSelectionCard(node) {
    if (!node || !cardEl) return false;
    if (node === cardEl || node === shadowRoot || node === hostEl) return true;
    if (typeof node.getRootNode === 'function' && node.getRootNode() === shadowRoot) return true;
    return typeof cardEl.contains === 'function' && cardEl.contains(node);
  }

  function areSelectionEndpointsInsideCard(selection) {
    if (!selection) return false;
    const endpoints = [selection.anchorNode, selection.focusNode].filter(Boolean);
    return endpoints.length > 0 && endpoints.every(isNodeInsideSelectionCard);
  }

  function isSelectionInsideCard(selection) {
    if (isCardInteractionActive) return true;
    if (areSelectionEndpointsInsideCard(selection)) return true;

    if (shadowRoot && typeof shadowRoot.getSelection === 'function') {
      try {
        const shadowSelection = shadowRoot.getSelection();
        if (shadowSelection && shadowSelection.rangeCount > 0
            && areSelectionEndpointsInsideCard(shadowSelection)) {
          return true;
        }
      } catch (error) {
        // Fall through to composed-range detection.
      }
    }

    if (selection && shadowRoot && typeof selection.getComposedRanges === 'function') {
      try {
        const ranges = selection.getComposedRanges({ shadowRoots: [shadowRoot] });
        if (ranges.some((range) => isNodeInsideSelectionCard(range.startContainer)
            && isNodeInsideSelectionCard(range.endContainer))) {
          return true;
        }
      } catch (error) {
        // Older browsers may expose getComposedRanges with a different signature.
      }
    }

    return false;
  }

  function validateActiveDocumentSelection() {
    if (!activeSelectionAnchor) return;
    const selection = window.getSelection();
    if (isSelectionInsideCard(selection)) return;
    if (!activeSelectionAnchor.matchesSelection(selection)) {
      hideTriggerIcon();
      hideCard(true);
    }
  }

  function setActiveSelectionAnchor(range) {
    clearActiveSelectionAnchor();
    activeSelectionAnchor = createRangeAnchor(range);
    return activeSelectionAnchor;
  }

  function hideCard(force = false) {
    if (isPinned && !force) return;
    lookupGeneration++;
    pendingSelectionData = null;
    selectionCardReady = false;
    clearActiveSelectionAnchor();
    currentActiveAnnotationId = null;
    currentActiveMarkEl = null;
    if (activeOnlineRequestId) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATION', requestId: activeOnlineRequestId }).catch(() => {});
      }
      activeOnlineRequestId = null;
    }
    if (cardEl) {
      cardEl.classList.remove('visible');
    }
  }

  function getSelectionCardRect(fallbackRect, expectedAnchor = null, options = {}) {
    if (expectedAnchor && expectedAnchor !== activeSelectionAnchor) return null;
    if (!activeSelectionAnchor) return expectedAnchor ? null : fallbackRect;

    const rect = activeSelectionAnchor.getRect(window.innerWidth, window.innerHeight, options);
    if (rect) return rect;

    clearActiveSelectionAnchor();
    hideTriggerIcon();
    hideCard(true);
    return null;
  }

  function isRectInViewport(rect) {
    return Boolean(rect && rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 &&
      rect.left < window.innerWidth && rect.top < window.innerHeight);
  }

  function getViewportSize() {
    const documentElement = typeof document !== 'undefined' && document.documentElement
      ? document.documentElement
      : null;
    return {
      width: Math.max(1, Number(window.innerWidth) || Number(documentElement && documentElement.clientWidth) || 1),
      height: Math.max(1, Number(window.innerHeight) || Number(documentElement && documentElement.clientHeight) || 1)
    };
  }

  function getCardDimensions() {
    if (!cardEl) return { width: 370, height: 180 };
    const rect = typeof cardEl.getBoundingClientRect === 'function'
      ? cardEl.getBoundingClientRect()
      : null;
    const offsetWidth = Number(cardEl.offsetWidth) || 0;
    const offsetHeight = Number(cardEl.offsetHeight) || 0;
    const rectWidth = Number(rect && rect.width) || 0;
    const rectHeight = Number(rect && rect.height) || 0;
    const width = offsetWidth || rectWidth || 370;
    const height = offsetHeight || rectHeight || 180;
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
      measured: offsetWidth > 0 && offsetHeight > 0 || rectWidth > 0 && rectHeight > 0
    };
  }

  function clampCardPosition(left, top, viewportWidth, viewportHeight, dimensions, padding = 10) {
    const maxLeft = Math.max(padding, viewportWidth - dimensions.width - padding);
    const maxTop = Math.max(padding, viewportHeight - dimensions.height - padding);
    return {
      left: Math.min(maxLeft, Math.max(padding, left)),
      top: Math.min(maxTop, Math.max(padding, top))
    };
  }

  function positionCard(rect, retryLayout = true) {
    if (!cardEl || !rect) return;

    const dimensions = getCardDimensions();
    const cardWidth = dimensions.width;
    const cardHeight = dimensions.height;
    const viewport = getViewportSize();
    const winWidth = viewport.width;
    const winHeight = viewport.height;

    let left = rect.left + (rect.width / 2) - (cardWidth / 2);
    let top = rect.bottom + 8;

    if (top + cardHeight > winHeight - 10) {
      if (rect.top - cardHeight - 8 > 10) {
        top = rect.top - cardHeight - 8;
      } else {
        top = winHeight - cardHeight - 10;
      }
    }

    const position = clampCardPosition(left, top, winWidth, winHeight, dimensions);

    cardEl.style.left = `${Math.round(position.left)}px`;
    cardEl.style.top = `${Math.round(position.top)}px`;

    if (retryLayout && !dimensions.measured && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        if (!cardEl || !cardEl.classList.contains('visible')) return;
        const liveRect = getSelectionCardRect(rect, activeSelectionAnchor, { allowOffscreen: true });
        if (liveRect) positionCard(liveRect, false);
      });
    }
  }

  function scheduleSelectionCardPosition() {
    if (selectionPositionFrame !== null) return;
    selectionPositionFrame = window.requestAnimationFrame(() => {
      selectionPositionFrame = null;
      if (!activeSelectionAnchor) return;

      const cardVisible = cardEl && cardEl.classList.contains('visible');
      const triggerVisible = triggerIconEl && triggerIconEl.classList.contains('visible');
      if (!cardVisible && !triggerVisible && !selectionCardReady && !pendingSelectionData) return;

      const rect = activeSelectionAnchor.getRect(window.innerWidth, window.innerHeight, { allowOffscreen: true });
      if (!rect) {
        pendingSelectionData = null;
        selectionCardReady = false;
        clearActiveSelectionAnchor();
        hideCard(true);
        hideTriggerIcon();
        return;
      }

      if (!isRectInViewport(rect)) {
        if (cardVisible) cardEl.classList.remove('visible');
        if (triggerVisible) hideTriggerIcon();
        return;
      }

      if (selectionCardReady) {
        positionCard(rect);
        cardEl.classList.add('visible');
      }
      if (pendingSelectionData) showTriggerIcon(rect);
    });
  }

  // Save word to Vocabulary Notebook in chrome.storage.local
  function toggleWordBook(data) {
    if (!data || !data.title) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    const wordItem = {
      word: data.baseWord || data.title,
      phonetic: data.phonetic || '',
      translation: activeTransText || data.translation || '',
      date: Date.now(),
      url: window.location.href
    };

    chrome.storage.local.get({ wordBook: [] }, (res) => {
      let book = res.wordBook || [];
      const idx = book.findIndex(item => item.word.toLowerCase() === wordItem.word.toLowerCase());
      const btnStar = shadowRoot ? shadowRoot.querySelector('#btn-star') : null;

      if (idx >= 0) {
        // Remove
        book.splice(idx, 1);
        if (btnStar) {
          btnStar.classList.remove('active-starred');
          btnStar.innerHTML = ICONS.star;
          btnStar.title = '收藏到生词本';
        }
      } else {
        // Add
        book.unshift(wordItem);
        if (book.length > 500) book.pop(); // Keep 500 latest words
        if (btnStar) {
          btnStar.classList.add('active-starred');
          btnStar.innerHTML = ICONS.starFilled;
          btnStar.title = '已收藏 (点击移除)';
        }
      }

      chrome.storage.local.set({ wordBook: book });
    });
  }

  // Record search history
  function recordHistory(query) {
    if (!query || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get({ searchHistory: [] }, (res) => {
      let history = res.searchHistory || [];
      history = history.filter(item => item.word.toLowerCase() !== query.toLowerCase());
      history.unshift({ word: query, date: Date.now() });
      if (history.length > 100) history.pop();
      chrome.storage.local.set({ searchHistory: history });
    });
  }

  // Render card content
  function renderCard(data, rect, expectedAnchor = null) {
    if (expectedAnchor !== activeSelectionAnchor) return;
    setupShadowDOM();
    hideTriggerIcon();

    currentWordData = data;
    activeQuery = data.title;
    activeTransText = data.rawTrans || '';

    let bodyHtml = '';

    if (data.customBodyHtml) {
      bodyHtml = data.customBodyHtml;
    } else if (data.isPaperGlossary) {
      bodyHtml = `
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
          <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:3px;">[论文专属定义]</div>
          <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:4px;">${escapeHtml(data.glossaryEntry?.definition || data.title)}</div>
          ${data.glossaryEntry?.sentence ? `
            <div style="font-size:11.5px;color:#78350f;background:rgba(255,255,255,0.7);padding:4px 6px;border-radius:4px;line-height:1.45;">
              <strong>出处例句:</strong> “${escapeHtml(data.glossaryEntry.sentence)}”
            </div>
          ` : ''}
        </div>
      `;
    } else if (data.loading) {
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
      ? `<span class="badge-source offline">● ${escapeHtml(data.sourceName || '离线学术词典')}</span>`
      : `<span class="badge-source online">● ${escapeHtml(data.sourceName || '在线翻译')}</span>`;

    // Detect highlight status for the current target/selection
    let isAlreadyHighlighted = Boolean(currentActiveMarkEl && currentActiveAnnotationId);
    let activeHighlightColor = isAlreadyHighlighted ? (currentActiveMarkEl.dataset.color || 'yellow') : null;

    if (!isAlreadyHighlighted && lastActiveRange) {
      try {
        const container = lastActiveRange.commonAncestorContainer;
        const mark = (container.nodeType === 1 ? container : container.parentElement)?.closest('.paperdict-highlight');
        if (mark && mark.dataset.annotationId) {
          isAlreadyHighlighted = true;
          currentActiveMarkEl = mark;
          currentActiveAnnotationId = mark.dataset.annotationId;
          activeHighlightColor = mark.dataset.color || 'yellow';
        }
      } catch (e) {}
    }

    const colorLabels = { yellow: '核心要点', green: '创新方法', blue: '重要结论', pink: '疑问难点' };
    const hlStatusHtml = isAlreadyHighlighted
      ? `<span class="hl-status-badge active" id="hl-status-badge" title="当前选区已高亮">已高亮</span>`
      : `<span class="hl-status-badge" id="hl-status-badge">未高亮</span>`;

    const checkIconSvg = `<svg class="hl-check-icon" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>`;

    cardEl.innerHTML = `
      <div class="card-header" title="拖拽可移动位置">
        <div class="card-title-group">
          <span class="word-title">${escapeHtml(data.title)}</span>
          ${phoneticHtml}
        </div>
        <div class="header-actions">
          ${speakerBtnHtml}
          <button class="action-btn btn-ai-guide" id="btn-ai-context" title="学术语境深度导读">
            导读
          </button>
          <button class="action-btn" id="btn-star" title="收藏到生词本">
            ${ICONS.star}
          </button>
          <button class="action-btn ${isPinned ? 'active-pinned' : ''}" id="btn-pin" title="${isPinned ? '已固定 (点击解开)' : '钉住卡片 (点击外部不关闭)'}">
            ${ICONS.pin}
          </button>
          <button class="action-btn" id="btn-copy" title="复制释义">
            ${ICONS.copy}
          </button>
          <button class="action-btn" id="btn-close" title="关闭卡片 (Esc)">
            ${ICONS.close}
          </button>
        </div>
      </div>
      <div class="card-body">
        ${bodyHtml}
      </div>
      <div class="card-context-box" id="card-context-box" style="display: none;">
        <div class="context-box-header">
          <span>学术语境导读</span>
          <span class="context-source-badge" id="context-source-badge">就绪</span>
        </div>
        <div class="context-content" id="context-content">
          <div class="loading-box"><div class="spinner"></div><span>正在结合论文与段落推演学术内涵...</span></div>
        </div>
      </div>
      <div class="card-highlight-bar">
        <div class="hl-palette">
          <div class="hl-label-group" title="论文划词高亮工具">
            ${ICONS.highlighter}
            <span class="hl-label">高亮</span>
            ${hlStatusHtml}
          </div>
          <div class="hl-swatches">
            <button class="hl-color-btn hl-yellow ${activeHighlightColor === 'yellow' ? 'active' : ''}" data-color="yellow" title="黄色荧光笔 (核心要点)">${checkIconSvg}</button>
            <button class="hl-color-btn hl-green ${activeHighlightColor === 'green' ? 'active' : ''}" data-color="green" title="绿色荧光笔 (创新方法)">${checkIconSvg}</button>
            <button class="hl-color-btn hl-blue ${activeHighlightColor === 'blue' ? 'active' : ''}" data-color="blue" title="蓝色荧光笔 (重要结论)">${checkIconSvg}</button>
            <button class="hl-color-btn hl-pink ${activeHighlightColor === 'pink' ? 'active' : ''}" data-color="pink" title="粉色荧光笔 (疑问难点)">${checkIconSvg}</button>
          </div>
          <button class="hl-clear-btn" id="btn-clear-highlight" title="清除当前高亮">
            ${ICONS.eraser}
            <span>清除</span>
          </button>
        </div>
        <div class="hl-actions-right">
          <button class="hl-tool-btn" id="btn-toggle-note" title="输入批注笔记">
            ${ICONS.note}
            <span>笔记</span>
          </button>
          <button class="hl-tool-btn" id="btn-card-export-md" title="导出 Markdown 笔记">
            <span>导出 MD</span>
          </button>
        </div>
      </div>
      <div class="card-note-box" id="card-note-box" style="display: none;">
        <textarea class="note-textarea" id="note-textarea" rows="2" placeholder="在此记录你的学术思考、疑问或批注..."></textarea>
        <div class="note-actions">
          <button class="btn-save-note" id="btn-save-note">保存批注</button>
        </div>
      </div>
      <div class="card-footer">
        ${sourceBadge}
        <span class="copy-hint" id="copy-hint">已复制</span>
      </div>
    `;

    // Check if word is already in wordBook to show filled star
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && data.title) {
      chrome.storage.local.get({ wordBook: [] }, (res) => {
        const book = res.wordBook || [];
        const isStarred = book.some(item => item.word.toLowerCase() === (data.baseWord || data.title).toLowerCase());
        const starBtn = shadowRoot.querySelector('#btn-star');
        if (starBtn && isStarred) {
          starBtn.classList.add('active-starred');
          starBtn.innerHTML = ICONS.starFilled;
          starBtn.title = '已收藏 (点击移除)';
        }
      });
    }

    // Event bindings
    const btnAiContext = shadowRoot.querySelector('#btn-ai-context');
    const contextBox = shadowRoot.querySelector('#card-context-box');
    const contextContent = shadowRoot.querySelector('#context-content');
    const contextBadge = shadowRoot.querySelector('#context-source-badge');

    if (btnAiContext && contextBox) {
      btnAiContext.onclick = async (e) => {
        e.stopPropagation();
        const isHidden = contextBox.style.display === 'none';
        contextBox.style.display = isHidden ? 'block' : 'none';
        if (!isHidden) return;

        contextContent.innerHTML = '<div class="loading-box"><div class="spinner"></div><span>正在结合论文与段落推演学术内涵...</span></div>';
        contextBadge.textContent = '解析中...';

        try {
          const res = await chrome.runtime.sendMessage({
            type: 'EXPLAIN_TERM_CONTEXT',
            term: data.baseWord || data.title,
            surroundingText: lastSurroundingText,
            paperTitle: document.title,
            requestId: `ctx_${Date.now()}`
          });

          if (res && res.success && res.explanation) {
            contextBadge.textContent = res.source || 'AI 语境';
            contextContent.innerHTML = escapeHtml(res.explanation).replace(/\n/g, '<br>');
          } else {
            contextBadge.textContent = '提示';
            contextContent.innerHTML = `<span style="color:#ef4444;">${escapeHtml(res?.error || '解析失败，建议在设置中配置大模型 API Key')}</span>`;
          }
        } catch (err) {
          contextBadge.textContent = '超时';
          contextContent.innerHTML = '<span style="color:#ef4444;">网络连接超时，请检查网络设置</span>';
        }
      };
    }

    const btnSpeaker = shadowRoot.querySelector('#btn-speaker');
    if (btnSpeaker) {
      btnSpeaker.onclick = (e) => {
        e.stopPropagation();
        playAudio(data.baseWord || data.title);
      };
    }

    const btnStar = shadowRoot.querySelector('#btn-star');
    if (btnStar) {
      btnStar.onclick = (e) => {
        e.stopPropagation();
        toggleWordBook(data);
      };
    }

    const btnPin = shadowRoot.querySelector('#btn-pin');
    if (btnPin) {
      btnPin.onclick = (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        btnPin.classList.toggle('active-pinned', isPinned);
        btnPin.title = isPinned ? '已固定 (点击解开)' : '固定卡片 (点击外部不关闭)';
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
        hideCard(true);
      };
    }

    function showActionFeedback(msg) {
      const hint = shadowRoot.querySelector('#copy-hint');
      if (hint) {
        hint.textContent = msg;
        hint.classList.add('show');
        setTimeout(() => {
          hint.classList.remove('show');
          hint.textContent = '已复制';
        }, 1800);
      }
    }

    // Highlight & Note button handlers
    const colorBtns = typeof shadowRoot.querySelectorAll === 'function'
      ? shadowRoot.querySelectorAll('.hl-color-btn')
      : [];
    colorBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const color = btn.dataset.color;
        const noteBox = shadowRoot.querySelector('#card-note-box');
        const noteInput = shadowRoot.querySelector('#note-textarea');
        const noteText = noteInput ? noteInput.value.trim() : '';
        const wasHighlighted = Boolean(currentActiveMarkEl && currentActiveAnnotationId);

        const annoId = highlightCurrentRange(color, noteText);
        if (annoId) {
          colorBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const badge = shadowRoot.querySelector('#hl-status-badge');
          if (badge) {
            badge.className = 'hl-status-badge active';
            badge.textContent = '已高亮';
          }
          const cName = colorLabels[color] || '要点';
          showActionFeedback(wasHighlighted ? `已切换为[${cName}]` : `已高亮[${cName}]`);
        }
      };
    });

    const btnToggleNote = shadowRoot.querySelector('#btn-toggle-note');
    const noteBox = shadowRoot.querySelector('#card-note-box');
    if (btnToggleNote && noteBox) {
      btnToggleNote.onclick = (e) => {
        e.stopPropagation();
        const isHidden = noteBox.style.display === 'none';
        noteBox.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          const textarea = noteBox.querySelector('#note-textarea');
          if (textarea) textarea.focus();
        }
      };
    }

    const btnSaveNote = shadowRoot.querySelector('#btn-save-note');
    if (btnSaveNote && noteBox) {
      btnSaveNote.onclick = (e) => {
        e.stopPropagation();
        const noteInput = shadowRoot.querySelector('#note-textarea');
        const noteText = noteInput ? noteInput.value.trim() : '';
        const activeColor = currentActiveMarkEl ? (currentActiveMarkEl.dataset.color || 'yellow') : 'yellow';
        const annoId = highlightCurrentRange(activeColor, noteText);
        if (annoId) {
          const badge = shadowRoot.querySelector('#hl-status-badge');
          if (badge) {
            badge.className = 'hl-status-badge active';
            badge.textContent = '已高亮';
          }
          colorBtns.forEach(b => {
            if (b.dataset.color === activeColor) b.classList.add('active');
          });
        }
        showActionFeedback('批注已保存');
        noteBox.style.display = 'none';
      };
    }

    const btnCardExport = shadowRoot.querySelector('#btn-card-export-md');
    if (btnCardExport && annotationManager) {
      btnCardExport.onclick = async (e) => {
        e.stopPropagation();
        const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
        const notes = await annotationManager.getAnnotationsForDoc(docKey);
        const terms = glossaryExtractor ? glossaryExtractor.getAllTerms() : [];

        if ((!notes || notes.length === 0) && (!terms || terms.length === 0)) {
          showActionFeedback('暂无笔记或术语');
          return;
        }

        const md = AnnotationManager.exportToMarkdown(notes, document.title || '论文阅读笔记', {
          url: window.location.href,
          glossary: terms
        });
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanTitle = (document.title || 'paper').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 30);
        a.download = `${cleanTitle}_reading_notes.md`;
        a.click();
        URL.revokeObjectURL(url);
        showActionFeedback('已导出论文笔记');
      };
    }

    const btnClearHl = shadowRoot.querySelector('#btn-clear-highlight');
    if (btnClearHl) {
      btnClearHl.onclick = (e) => {
        e.stopPropagation();
        const success = clearCurrentHighlight();
        if (success) {
          colorBtns.forEach(b => b.classList.remove('active'));
          const badge = shadowRoot.querySelector('#hl-status-badge');
          if (badge) {
            badge.className = 'hl-status-badge';
            badge.textContent = '未高亮';
          }
        }
      };
    }

    // Position and show
    const cardRect = getSelectionCardRect(rect, expectedAnchor, { allowOffscreen: true });
    if (!cardRect) {
      selectionCardReady = false;
      return;
    }
    selectionCardReady = true;
    if (isRectInViewport(cardRect)) {
      positionCard(cardRect);
      cardEl.classList.add('visible');
    } else {
      cardEl.classList.remove('visible');
      hideTriggerIcon();
    }

    // Auto audio if enabled
    if (settings.autoAudio && data.showSpeaker && !data.loading) {
      playAudio(data.baseWord || data.title);
    }
  }

  function clearCurrentHighlight() {
    let markToClear = currentActiveMarkEl;
    let annoIdToClear = currentActiveAnnotationId;

    if (!markToClear && lastActiveRange) {
      const container = lastActiveRange.commonAncestorContainer;
      markToClear = (container.nodeType === 1 ? container : container.parentElement)?.closest('.paperdict-highlight');
      if (markToClear) {
        annoIdToClear = markToClear.dataset.annotationId;
      }
    }

    if (!markToClear && typeof window !== 'undefined') {
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const c = sel.getRangeAt(0).commonAncestorContainer;
          markToClear = (c.nodeType === 1 ? c : c.parentElement)?.closest('.paperdict-highlight');
          if (markToClear) {
            annoIdToClear = markToClear.dataset.annotationId;
          }
        }
      } catch (e) {}
    }

    if (markToClear) {
      const parent = markToClear.parentNode;
      if (parent) {
        while (markToClear.firstChild) {
          parent.insertBefore(markToClear.firstChild, markToClear);
        }
        parent.removeChild(markToClear);
        parent.normalize();
      }

      if (annoIdToClear && annotationManager) {
        annotationManager.deleteAnnotation(annoIdToClear);
      }

      currentActiveMarkEl = null;
      currentActiveAnnotationId = null;
      lastActiveRange = null;
      showActionFeedback('已清除高亮');
      return true;
    }
    showActionFeedback('无高亮可清除');
    return false;
  }

  function highlightCurrentRange(colorKey, noteText = '') {
    const colors = (typeof window !== 'undefined' && window.HIGHLIGHT_COLORS) || {
      yellow: { bg: '#fef08a' },
      green:  { bg: '#bbf7d0' },
      blue:   { bg: '#bfdbfe' },
      pink:   { bg: '#fbcfe8' }
    };
    const colorBg = (colors[colorKey] && colors[colorKey].bg) || '#fef08a';

    // 1. If currently editing an existing mark, update in-place without re-wrapping!
    if (currentActiveMarkEl && currentActiveAnnotationId) {
      currentActiveMarkEl.dataset.color = colorKey;
      currentActiveMarkEl.style.backgroundColor = colorBg;

      if (annotationManager) {
        const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
        annotationManager.saveAnnotation({
          id: currentActiveAnnotationId,
          docKey,
          docTitle: document.title,
          url: window.location.href,
          text: currentActiveMarkEl.textContent,
          color: colorKey,
          note: noteText
        });
      }
      return currentActiveAnnotationId;
    }

    let targetRange = lastActiveRange;
    if (!targetRange || targetRange.collapsed) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        targetRange = sel.getRangeAt(0);
      }
    }
    if (!targetRange) return null;

    // 2. Check if range is already inside an existing highlight mark
    const container = targetRange.commonAncestorContainer;
    const existingMark = (container.nodeType === 1 ? container : container.parentElement)?.closest('.paperdict-highlight');
    if (existingMark && existingMark.dataset.annotationId) {
      currentActiveMarkEl = existingMark;
      currentActiveAnnotationId = existingMark.dataset.annotationId;
      existingMark.dataset.color = colorKey;
      existingMark.style.backgroundColor = colorBg;
      if (annotationManager) {
        const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
        annotationManager.saveAnnotation({
          id: currentActiveAnnotationId,
          docKey,
          docTitle: document.title,
          url: window.location.href,
          text: existingMark.textContent,
          color: colorKey,
          note: noteText
        });
      }
      return currentActiveAnnotationId;
    }

    // 3. Brand new highlight
    const annoId = `anno_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    currentActiveAnnotationId = annoId;

    try {
      const mark = document.createElement('mark');
      mark.className = 'paperdict-highlight';
      mark.dataset.annotationId = annoId;
      mark.dataset.color = colorKey;
      mark.style.backgroundColor = colorBg;
      mark.style.color = 'inherit';
      mark.style.borderRadius = '2px';
      mark.style.padding = '0 2px';
      mark.style.cursor = 'pointer';

      try {
        targetRange.surroundContents(mark);
      } catch (e) {
        try {
          const frag = targetRange.extractContents();
          mark.appendChild(frag);
          targetRange.insertNode(mark);
        } catch (err) {}
      }
      currentActiveMarkEl = mark;

      if (annotationManager) {
        const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
        annotationManager.saveAnnotation({
          id: annoId,
          docKey,
          docTitle: document.title,
          url: window.location.href,
          text: mark.textContent || lastRawSelectedText || '',
          color: colorKey,
          note: noteText
        });
      }
      return annoId;
    } catch (err) {
      console.warn('Highlight failed:', err);
      return null;
    }
  }

  // Restore saved highlights on the page
  async function restorePageHighlights() {
    if (!annotationManager) return;
    if (typeof window === 'undefined' || !document || !document.body) return;

    try {
      const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
      const annotations = await annotationManager.getAnnotationsForDoc(docKey);
      if (!annotations || annotations.length === 0) return;

      for (const anno of annotations) {
        if (!anno.text || anno.text.length < 2) continue;
        if (document.querySelector(`mark[data-annotation-id="${anno.id}"]`)) continue;
        highlightTextInDocument(anno);
      }
    } catch (e) {
      console.warn('PaperDict highlight restore warning:', e);
    }
  }

  function highlightTextInDocument(anno) {
    const textToFind = anno.text.trim();
    if (!textToFind || textToFind.length < 2) return;

    const colors = (typeof window !== 'undefined' && window.HIGHLIGHT_COLORS) || {
      yellow: { bg: '#fef08a' },
      green:  { bg: '#bbf7d0' },
      blue:   { bg: '#bfdbfe' },
      pink:   { bg: '#fbcfe8' }
    };
    const colorBg = (colors[anno.color] && colors[anno.color].bg) || '#fef08a';

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'mark' || tag === 'paper-dict-host') {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.nodeValue.includes(textToFind.slice(0, 20))) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let textNode = walker.nextNode();
    while (textNode) {
      const idx = textNode.nodeValue.indexOf(textToFind);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + textToFind.length);

        const mark = document.createElement('mark');
        mark.className = 'paperdict-highlight';
        mark.dataset.annotationId = anno.id;
        mark.dataset.color = anno.color;
        mark.style.backgroundColor = colorBg;
        mark.style.color = 'inherit';
        mark.style.borderRadius = '2px';
        mark.style.padding = '0 2px';
        mark.style.cursor = 'pointer';

        try {
          range.surroundContents(mark);
        } catch (e) {
          // Ignore range split errors
        }
        break;
      }
      textNode = walker.nextNode();
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

  function renderCitationCard(marker, refs, rect) {
    const itemsHtml = refs.map(ref => `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
        <div style="font-size:11px;font-weight:700;color:#2563eb;margin-bottom:3px;">
          [${escapeHtml(ref.index)}] ${ref.year ? `(${escapeHtml(ref.year)})` : ''}
        </div>
        <div style="font-size:12.5px;font-weight:600;color:#0f172a;line-height:1.45;margin-bottom:5px;">
          ${escapeHtml(ref.title)}
        </div>
        <div style="font-size:11px;color:#64748b;line-height:1.4;margin-bottom:6px;">
          ${escapeHtml(ref.raw.slice(0, 140))}${ref.raw.length > 140 ? '...' : ''}
        </div>
        <div style="display:flex;gap:8px;font-size:11px;">
          <a href="${ref.scholarUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:500;">Google 学术</a>
          ${ref.arxivUrl ? `<a href="${ref.arxivUrl}" target="_blank" rel="noopener noreferrer" style="color:#dc2626;text-decoration:none;font-weight:500;">arXiv</a>` : ''}
          ${ref.doiUrl ? `<a href="${ref.doiUrl}" target="_blank" rel="noopener noreferrer" style="color:#059669;text-decoration:none;font-weight:500;">DOI</a>` : ''}
        </div>
      </div>
    `).join('');

    renderCard({
      title: `引用文献 ${escapeHtml(marker)}`,
      phonetic: `共匹配到 ${refs.length} 条参考书目`,
      translation: '',
      definitions: [],
      rawTrans: refs.map(r => `[${r.index}] ${r.raw}`).join('\n\n'),
      isSentence: false,
      customBodyHtml: itemsHtml,
      showSpeaker: false,
      source: 'offline',
      sourceName: '文献引用索引',
      loading: false
    }, rect);
  }

  // Perform actual lookup and render
  async function executeLookup(cleaned, rect, lookupToken) {
    if (lookupToken !== lookupGeneration) return;
    recordHistory(cleaned);

    const thisLookupSeq = ++currentLookupSeq;

    // Cancel previous in-flight online request if still running
    if (activeOnlineRequestId) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATION', requestId: activeOnlineRequestId }).catch(() => {});
      }
      activeOnlineRequestId = null;
    }

    // Check Paper-specific Glossary first (highest priority)
    const glossaryMatch = typeof dictService.lookupPaperGlossary === 'function'
      ? dictService.lookupPaperGlossary(cleaned)
      : null;
    if (glossaryMatch) {
      renderCard({
        title: cleaned,
        baseWord: glossaryMatch.term,
        phonetic: '论文专属术语',
        definitions: [],
        rawTrans: glossaryMatch.definition,
        isInflected: false,
        isPaperGlossary: true,
        glossaryEntry: glossaryMatch,
        showSpeaker: false,
        source: 'offline',
        sourceName: '论文专属术语',
        isSentence: false,
        loading: false
      }, rect);
      return;
    }

    const isSingleWord = dictService.isSingleWord(cleaned);
    const expectedAnchor = activeSelectionAnchor;
    const renderLookupCard = (data) => {
      if (lookupToken !== lookupGeneration) return;
      renderCard(data, rect, expectedAnchor);
    };

    try {
      const glossaryResult = await chrome.runtime.sendMessage({
        type: 'LOOKUP_GLOSSARY',
        text: cleaned
      });
      if (lookupToken !== lookupGeneration) return;
      if (glossaryResult && glossaryResult.success && glossaryResult.found) {
        renderLookupCard({
          title: cleaned,
          phonetic: '',
          definitions: isSingleWord ? [{ pos: '术语', text: glossaryResult.translation }] : [],
          translation: glossaryResult.translation,
          rawTrans: glossaryResult.translation,
          showSpeaker: isSingleWord,
          source: 'offline',
          sourceName: glossaryResult.source || '离线术语库',
          isSentence: !isSingleWord,
          loading: false
        });
        return;
      }
    } catch (error) {
      if (lookupToken !== lookupGeneration) return;
      // The built-in dictionary remains available if the background worker is restarting.
    }

    if (isSingleWord) {
      const localResult = dictService.lookupLocal(cleaned);

      if (localResult && localResult.found) {
        const definitions = dictService.parseDefinitions(localResult.translation);
        renderLookupCard({
          title: cleaned,
          baseWord: localResult.baseWord,
          phonetic: localResult.phonetic,
          definitions,
          rawTrans: localResult.translation,
          isInflected: localResult.isInflected,
          isPaperGlossary: Boolean(localResult.isPaperGlossary),
          glossaryEntry: localResult.glossaryEntry || null,
          showSpeaker: !localResult.isPaperGlossary,
          source: 'offline',
          sourceName: localResult.isPaperGlossary ? '论文专属术语' : '离线学术词典',
          isSentence: false,
          loading: false
        });
        return;
      }
    }

    // Fallback to online translation if enabled
    if (settings.onlineFallback) {
      if (lookupToken !== lookupGeneration) return;
      renderLookupCard({
        title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
        phonetic: '',
        definitions: [],
        rawTrans: '',
        showSpeaker: isSingleWord,
        source: 'online',
        sourceName: '在线翻译',
        isSentence: !isSingleWord,
        loading: true
      });

      const reqKey = 'content_' + Date.now() + '_' + thisLookupSeq;
      activeOnlineRequestId = reqKey;

      try {
        if (lookupToken !== lookupGeneration) return;
        const response = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_ONLINE',
          text: cleaned,
          requestId: reqKey
        });
        if (lookupToken !== lookupGeneration) return;

        // If another selection occurred while in flight, discard stale response
        if (thisLookupSeq !== currentLookupSeq) {
          return;
        }
        activeOnlineRequestId = null;

        if (response && response.aborted) {
          return; // Request was aborted cleanly
        }

        if (response && response.success) {
          renderLookupCard({
            title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
            phonetic: '',
            translation: response.translation,
            rawTrans: response.translation,
            showSpeaker: isSingleWord,
            source: 'online',
            sourceName: response.source || '在线翻译',
            isSentence: true,
            loading: false
          });
        } else {
          renderLookupCard({
            title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
            translation: response?.error || '未查到对应释义',
            rawTrans: response?.error || '',
            showSpeaker: false,
            source: 'online',
            sourceName: '查询失败',
            isSentence: true,
            loading: false
          });
        }
      } catch (err) {
        if (lookupToken !== lookupGeneration) return;
        activeOnlineRequestId = null;
        renderLookupCard({
          title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
          translation: '网络连接超时，请检查网络设置',
          rawTrans: '网络连接超时',
          showSpeaker: false,
          source: 'online',
          sourceName: '查询失败',
          isSentence: true,
          loading: false
        });
      }
    } else {
      renderLookupCard({
        title: cleaned.length > 32 ? cleaned.slice(0, 32) + '...' : cleaned,
        translation: '本地词典与术语库未收录；整句翻译需要在线引擎',
        rawTrans: '',
        showSpeaker: false,
        source: 'offline',
        sourceName: '仅离线查询',
        isSentence: true,
        loading: false
      });
    }
  }

  // Handle selection search
  function processSelection(selection, overrideText = null, eventTrigger = null) {
    const lookupToken = ++lookupGeneration;
    pendingSelectionData = null;

    if ((!settings.enabled || isBlacklisted()) && !overrideText) {
      clearActiveSelectionAnchor();
      return;
    }

    currentActiveAnnotationId = null;
    currentActiveMarkEl = null;

    let text = overrideText;
    let rect = null;
    if (overrideText) {
      clearActiveSelectionAnchor();
    }

    if (overrideText) {
      lastRawSelectedText = overrideText;
    }

    if (!text) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          clearActiveSelectionAnchor();
          text = activeEl.value.substring(start, end);
          rect = activeEl.getBoundingClientRect();
          lastRawSelectedText = text;
        }
      }

      if (!text && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        text = selection.toString();
        try {
          const range = selection.getRangeAt(0);
          const anchor = setActiveSelectionAnchor(range);
          rect = anchor ? anchor.getRect(window.innerWidth, window.innerHeight) : null;
          if (!rect) {
            clearActiveSelectionAnchor();
            hideTriggerIcon();
            hideCard(true);
            return;
          }
          lastActiveRange = range.cloneRange();
          lastRawSelectedText = text;

          // Capture context paragraph for optional academic explanation.
          const container = range.commonAncestorContainer;
          const parent = container.nodeType === (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3)
            ? container.parentElement
            : container;
          const parentBlock = parent && parent.closest
            ? (parent.closest('p, div, li, td, section, article') || parent)
            : parent;
          lastSurroundingText = parentBlock ? (parentBlock.innerText || parentBlock.textContent || '') : '';
        } catch (e) {
          clearActiveSelectionAnchor();
        }
      }
    }

    if (!text) {
      clearActiveSelectionAnchor();
      hideTriggerIcon();
      hideCard();
      return;
    }

    // Intercept citation markers [12], [1-3]
    const isCitation = typeof CitationParser !== 'undefined' && CitationParser.isCitationMarker(text);
    if (isCitation && citationParser) {
      const refs = citationParser.lookup(text);
      if (refs && refs.length > 0) {
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
        renderCitationCard(text, refs, rect);
        return;
      }
    }

    const cleaned = dictService.cleanPaperText(text, settings.deHyphen);

    if (!dictService.isLookupEligible(cleaned)) {
      clearActiveSelectionAnchor();
      hideTriggerIcon();
      hideCard();
      return;
    }

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

    // Direct override (e.g. from context menu)
    if (overrideText) {
      executeLookup(cleaned, rect, lookupToken);
      return;
    }

    // Check Trigger Mode
    const mode = settings.triggerMode || 'direct';

    if (mode === 'modifier') {
      const requiredKey = settings.modifierKey || 'Alt';
      const isModifierPressed = eventTrigger && (
        (requiredKey === 'Alt' && eventTrigger.altKey) ||
        (requiredKey === 'Control' && (eventTrigger.ctrlKey || eventTrigger.metaKey)) ||
        (requiredKey === 'Shift' && eventTrigger.shiftKey)
      );

      if (!isModifierPressed) {
        clearActiveSelectionAnchor();
        hideTriggerIcon();
        hideCard();
        return;
      }
      executeLookup(cleaned, rect, lookupToken);
      return;
    }

    if (mode === 'direct') {
      executeLookup(cleaned, rect, lookupToken);
      return;
    }

    // Mode === 'icon' (Default: Unobtrusive lightweight trigger icon)
    pendingSelectionData = { text: cleaned, rect, lookupToken };
    showTriggerIcon(rect);
  }

  // Debounced check
  let checkTimer = null;
  function triggerSelectionCheck(e) {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const selection = window.getSelection();
      const activeEl = document.activeElement;
      const isInputSelection = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.selectionEnd > activeEl.selectionStart;

      if ((!selection || selection.isCollapsed) && !isInputSelection) {
        hideTriggerIcon();
        hideCard(true);
        return;
      }
      processSelection(selection, null, e);
    }, 80);
  }

  // Single Mouse Up Listener (No duplicate listener)
  function onMouseUp(e) {
    if (e.target && e.target.closest && e.target.closest('.paperdict-highlight')) {
      return;
    }
    if (e.composedPath && e.composedPath().some(el => el === cardEl || el === hostEl || el === triggerIconEl)) {
      setTimeout(() => {
        isCardInteractionActive = false;
      }, 0);
      return;
    }
    isCardInteractionActive = false;
    triggerSelectionCheck(e);
  }

  document.addEventListener('mouseup', onMouseUp, false);

  // Key up for keyboard selections (Shift + Arrows)
  document.addEventListener('keyup', (e) => {
    if (isSelectionNavigationKey(e)) {
      triggerSelectionCheck(e);
    }
  }, false);

  document.addEventListener('selectionchange', () => {
    validateActiveDocumentSelection();
  }, false);

  window.addEventListener('scroll', scheduleSelectionCardPosition, { capture: true, passive: true });
  window.addEventListener('resize', scheduleSelectionCardPosition, { passive: true });

  // Click outside to dismiss
  document.addEventListener('mousedown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.paperdict-highlight')) {
      return;
    }
    if (e.composedPath && e.composedPath().some(el => el === cardEl || el === hostEl || el === triggerIconEl)) {
      isCardInteractionActive = true;
      return;
    }
    isCardInteractionActive = false;
    hideTriggerIcon();
    if (!isPinned && cardEl && cardEl.classList.contains('visible')) {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hideCard();
      }
    }
  }, false);

  // ESC key to dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideTriggerIcon();
      hideCard(true); // force close even if pinned
    }
  }, false);

  // Context menu trigger from background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TRIGGER_TRANSLATE_FROM_MENU' && msg.text) {
        processSelection(null, msg.text);
      }
    });
  }

  // Click on existing highlight to show note bubble
  document.addEventListener('click', async (e) => {
    const mark = e.target.closest && e.target.closest('.paperdict-highlight');
    if (mark && mark.dataset.annotationId && annotationManager) {
      e.stopPropagation();
      e.preventDefault();
      if (checkTimer) clearTimeout(checkTimer);

      const annoId = mark.dataset.annotationId;
      currentActiveAnnotationId = annoId;
      currentActiveMarkEl = mark;

      const all = await annotationManager.loadAll();
      const anno = all.find(a => a.id === annoId);
      if (anno) {
        const rect = mark.getBoundingClientRect();
        const colorLabels = { yellow: '核心要点', green: '创新方法', blue: '重要结论', pink: '疑问难点' };
        renderCard({
          title: `论文批注 [${colorLabels[anno.color] || '要点'}]`,
          phonetic: '',
          translation: anno.note ? `[批注笔记]:\n${anno.note}` : '（暂无文字笔记，可在下方直接输入并保存）',
          rawTrans: anno.note || '',
          showSpeaker: false,
          source: 'offline',
          sourceName: '论文批注',
          isSentence: true,
          loading: false
        }, rect);

        setTimeout(() => {
          if (shadowRoot) {
            const noteInput = shadowRoot.querySelector('#note-textarea');
            const noteBox = shadowRoot.querySelector('#card-note-box');
            if (noteInput && anno.note) {
              noteInput.value = anno.note;
              if (noteBox) noteBox.style.display = 'block';
            }
          }
        }, 50);
      }
    }
  }, false);

  function extractAndRegisterGlossary() {
    if (!glossaryExtractor || !dictService) return;
    if (typeof document === 'undefined' || !document.body) return;
    try {
      const terms = glossaryExtractor.extractFromDOM(document.body);
      if (terms && terms.length > 0) {
        dictService.setPaperGlossary(glossaryExtractor);
      }
    } catch (e) {
      console.warn('PaperDict glossary extraction warning:', e);
    }
  }

  function extractAndRegisterCitations() {
    if (!citationParser) return;
    if (typeof document === 'undefined' || !document.body) return;
    try {
      citationParser.extractFromDOM(document.body);
    } catch (e) {
      console.warn('PaperDict citation extraction warning:', e);
    }
  }

  function initializePageAddons() {
    restorePageHighlights();
    extractAndRegisterGlossary();
    extractAndRegisterCitations();
  }

  // Restore highlights & extract paper glossary when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePageAddons);
  } else {
    setTimeout(initializePageAddons, 300);
  }
})();
