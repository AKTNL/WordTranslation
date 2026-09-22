/**
 * PaperDict - Academic In-situ Bilingual & Full Chinese Reader Engine
 * Provides viewport-lazy-loaded in-situ translation, formula protection,
 * smart reference filtering, and collapsible control capsule.
 */

(function (global) {
  'use strict';

  const isEnglishSourceText = typeof global.paperDictIsEnglishSourceText === 'function'
    ? global.paperDictIsEnglishSourceText
    : (typeof require === 'function'
      ? require('./dict_service.js').isEnglishSourceText
      : () => false);

  /**
   * 1. Formula & Structure Protection (FormulaProtector)
   * Prevents translation engines from garbling math formulas, LaTeX tokens, and MathML.
   */
  class FormulaProtector {
    constructor() {
      this.tokenPrefix = 'PDMATH_';
    }

    /**
     * Extracts and replaces formulas with safe tokens.
     * Works with both DOM Element and raw strings.
     * @param {HTMLElement|string} input
     * @returns {{ protectedText: string, tokenMap: Map<string, object>, htmlElement?: HTMLElement }}
     */
    protect(input) {
      const tokenMap = new Map();
      let tokenIndex = 0;

      // Handle DOM Element
      if (typeof HTMLElement !== 'undefined' && input instanceof HTMLElement) {
        const clone = input.cloneNode(true);

        // A. Identify Math DOM elements (MathML, KaTeX, MathJax)
        const mathNodes = clone.querySelectorAll('math, .katex, .MathJax, mjx-container, [data-mathml]');
        mathNodes.forEach((node) => {
          const token = `${this.tokenPrefix}${tokenIndex++}`;
          tokenMap.set(token, {
            type: 'dom',
            html: node.outerHTML,
            rawText: node.textContent
          });
          const placeholder = document.createTextNode(` ${token} `);
          node.parentNode.replaceChild(placeholder, node);
        });

        let text = clone.innerText || clone.textContent || '';
        const res = this.protectRawText(text, tokenMap, tokenIndex);
        return {
          protectedText: res.text,
          tokenMap,
          htmlElement: clone
        };
      }

      // Handle raw string
      const text = String(input || '');
      const res = this.protectRawText(text, tokenMap, tokenIndex);
      return {
        protectedText: res.text,
        tokenMap
      };
    }

    /**
     * Checks if text inside $...$ is likely a valid LaTeX formula rather than currency or regular text.
     */
    isLikelyLatexFormula(content) {
      const s = String(content || '').trim();
      if (!s) return false;

      // Pure numbers or currency expressions (e.g. "10", "9.99", "$1,000", "1.5 million")
      if (/^\$?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:k|m|b|million|billion|trillion|USD|EUR|GBP|dollars?))?$/i.test(s)) {
        return false;
      }
      if (/^\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:-|–|—|to)\s*\$?\d+(?:,\d{3})*(?:\.\d+)?$/i.test(s)) {
        return false;
      }

      // Strong LaTeX markers
      const hasLatexCommand = /\\(?:[a-zA-Z]+|[,\.;!%])/.test(s);
      const hasMathSymbols = /[=+\-*/<>^_~∈∉⊂⊆∪∩∑∏∫√∂∇≤≥≠≈≡±×÷∀∃]/.test(s);
      const isSingleMathVar = /^[a-zA-Z]$/.test(s);
      const hasSubSuper = /[a-zA-Z0-9][\^_][a-zA-Z0-9{]/.test(s);
      const hasMathPunct = /^[a-zA-Z0-9,\s\(\)\[\]]+$/.test(s) && (s.includes('(') || s.includes('[') || /^[a-zA-Z]\s*,\s*[a-zA-Z]/.test(s));

      if (hasLatexCommand || hasMathSymbols || isSingleMathVar || hasSubSuper || hasMathPunct) {
        return true;
      }

      // If it contains multiple common English words without LaTeX syntax, reject as formula
      const words = s.split(/\s+/);
      if (words.length >= 2 && !hasLatexCommand && !hasMathSymbols) {
        return false;
      }

      return true;
    }

    /**
     * Protects LaTeX math notation in raw text
     */
    protectRawText(text, tokenMap, startIndex = 0) {
      let index = startIndex;

      // 1. LaTeX Display Math: $$...$$ and \[...\]
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
        const token = `${this.tokenPrefix}${index++}`;
        tokenMap.set(token, { type: 'latex_display', text: match });
        return ` ${token} `;
      });

      text = text.replace(/\\\[([\s\S]+?)\\\]/g, (match) => {
        const token = `${this.tokenPrefix}${index++}`;
        tokenMap.set(token, { type: 'latex_display', text: match });
        return ` ${token} `;
      });

      // 2. LaTeX Inline Math: \(...\)
      text = text.replace(/\\\(([\s\S]+?)\\\)/g, (match) => {
        const token = `${this.tokenPrefix}${index++}`;
        tokenMap.set(token, { type: 'latex_inline', text: match });
        return ` ${token} `;
      });

      // 3. LaTeX Inline Math: $...$ (respect standard LaTeX delimiters and filter out non-math currency text)
      text = text.replace(/(?<![\w\\])\$(?!\s)([^\$\n\r]+?)(?<![\s\\])\$(?![0-9\w])/g, (match, formula) => {
        if (!this.isLikelyLatexFormula(formula)) {
          return match;
        }
        const token = `${this.tokenPrefix}${index++}`;
        tokenMap.set(token, { type: 'latex_inline', text: match });
        return ` ${token} `;
      });

      return { text, tokenMap, nextIndex: index };
    }

    /**
     * Restores protected formula placeholders in translated text.
     * @param {string} translatedText
     * @param {Map<string, object>} tokenMap
     * @returns {string} Restored HTML or text
     */
    restore(translatedText, tokenMap) {
      if (!translatedText || !tokenMap || tokenMap.size === 0) {
        return translatedText || '';
      }

      let restored = translatedText;

      // Resilient regex matching PDMATH_0, PDMATH 0, pdmath_0, PD MATH 0, PD-MATH-0, etc.
      const pattern = /PD\s*[-_]?\s*MATH\s*[_ \-:]*\s*(\d+)/gi;

      restored = restored.replace(pattern, (match, digits) => {
        const canonicalKey = `${this.tokenPrefix}${digits}`;
        const info = tokenMap.get(canonicalKey);
        if (!info) return match;

        if (info.type === 'dom') {
          return `<span class="pd-math-formula">${info.html}</span>`;
        }
        if (info.type === 'latex_display' || info.type === 'latex_inline') {
          return `<span class="pd-math-formula">${this.escapeHtml(info.text)}</span>`;
        }
        return match;
      });

      return restored;
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  /**
   * 2. Smart Academic Filter (AcademicFilter)
   * Discovers main article paragraphs while strictly filtering out references,
   * code blocks, metadata, navigation, and paper UI elements.
   */
  class AcademicFilter {
    constructor() {
      this.excludedTags = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT',
        'BUTTON', 'SVG', 'CANVAS', 'PRE', 'CODE', 'NAV', 'HEADER',
        'FOOTER', 'ASIDE', 'PAPER-DICT-HOST', 'PAPERDICT-BILINGUAL-CAPSULE-HOST'
      ]);

      this.refHeadingRegex = /^\s*(?:(?:\[\d+\]|[0-9]+|[IVXLCDM]+)[\.\s\-]*)?(?:references|bibliography|works\s+cited|literature\s+cited|citations)(?:\s*(?:and|&)\s*(?:notes|sources|citations|references|further\s+reading))?\s*[:\.]?\s*$/i;
      this.excludedClassIdRegex = /(reference|bibliography|biblio|ref-list|footnote|author-notes|header|navbar|sidebar|footer|menu|comment|pager|pagination|disclaimer|copyright|doi-box)/i;
    }

    isReferenceHeading(text) {
      return this.refHeadingRegex.test(String(text || '').trim());
    }

    /**
     * Checks whether an element is inside an excluded container or reference section.
     */
    isExcluded(el) {
      if (!el || !el.tagName) return true;

      // Tag name check
      if (this.excludedTags.has(el.tagName.toUpperCase())) return true;

      // PaperDict UI element check
      if (el.classList && (
        el.classList.contains('pd-bilingual-trans') ||
        el.classList.contains('pd-bilingual-loading') ||
        el.classList.contains('pd-mode-toast')
      )) {
        return true;
      }

      // Check element and its ancestors
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        const tag = cur.tagName ? cur.tagName.toUpperCase() : '';
        if (this.excludedTags.has(tag)) return true;

        const id = cur.id || '';
        const className = typeof cur.className === 'string'
          ? cur.className
          : (cur.getAttribute ? cur.getAttribute('class') || '' : '');

        if (this.excludedClassIdRegex.test(id) || this.excludedClassIdRegex.test(className)) {
          return true;
        }

        // Check if marked as reference container
        if (cur.dataset && cur.dataset.pdExclude === 'true') {
          return true;
        }

        cur = cur.parentElement;
      }

      return false;
    }

    /**
     * Validates if a block element is eligible for translation
     */
    isEligible(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toUpperCase();

      // Check allowed block tags
      const isAllowedTag = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'].includes(tag);
      if (!isAllowedTag) return false;

      if (this.isExcluded(el)) return false;

      const rawText = (el.innerText || el.textContent || '').trim();

      // Headings must have >= 2 chars, paragraphs must have >= 15 chars
      if (tag.startsWith('H')) {
        if (rawText.length < 2) return false;
        // Don't translate the references heading itself
        if (this.isReferenceHeading(rawText)) return false;
      } else {
        if (rawText.length < 15) return false;
      }

      if (!isEnglishSourceText(rawText)) return false;

      // Ensure element is visible
      if (typeof window !== 'undefined' && el.offsetParent === null && el.offsetHeight === 0 && el.offsetWidth === 0) {
        return false;
      }

      return true;
    }

    /**
     * Finds the primary article container
     */
    findArticleContainer(root = document) {
      const selectors = [
        'article',
        'main',
        '.paper',
        '.article',
        '.c-article-body',
        '.journal-article',
        '#content',
        '#main-content',
        '.content'
      ];
      for (const sel of selectors) {
        const container = root.querySelector(sel);
        if (container) return container;
      }
      return root.body || root;
    }

    /**
     * Collects all eligible text elements in document reading order
     */
    findContentElements(root = document) {
      const container = this.findArticleContainer(root);
      const candidates = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li');

      const eligible = [];
      let inReferenceSection = false;
      let refHeadingLevel = 2;

      for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim();
        const tag = el.tagName.toUpperCase();
        const isHeading = tag.startsWith('H') && tag.length === 2;

        // Detect entry into References section
        if (isHeading && this.isReferenceHeading(text)) {
          inReferenceSection = true;
          refHeadingLevel = parseInt(tag.charAt(1), 10) || 2;
          continue;
        }

        if (inReferenceSection) {
          // If we reach another section heading at or above the reference level, reference section ended
          if (isHeading && !this.isReferenceHeading(text)) {
            const level = parseInt(tag.charAt(1), 10) || 2;
            if (level <= refHeadingLevel || level <= 2) {
              inReferenceSection = false;
            } else {
              continue;
            }
          } else {
            continue; // Skip all items inside references
          }
        }

        if (this.isEligible(el)) {
          eligible.push(el);
        }
      }

      return eligible;
    }
  }

  /**
   * 3. Floating Control Capsule UI (CapsuleUI)
   * Collapsible, vertically draggable widget docked at page right edge.
   */
  class CapsuleUI {
    constructor(options = {}) {
      if (typeof options === 'function') {
        this.onModeChange = options;
        this.onHideCapsule = null;
        this.onDisableSite = null;
      } else {
        this.onModeChange = options.onModeChange;
        this.onHideCapsule = options.onHideCapsule;
        this.onDisableSite = options.onDisableSite;
      }
      this.currentMode = 'original';
      this.isExpanded = false;
      this.host = null;
      this.shadow = null;
      this.stats = { total: 0, translated: 0 };
    }

    hideCapsule() {
      if (this.onHideCapsule) this.onHideCapsule();
      if (this.host) this.host.remove();
    }

    disableCapsule() {
      this.hideCapsule();
    }

    destroy() {
      if (this.host) this.host.remove();
      this.host = null;
      this.shadow = null;
      this.isExpanded = false;
    }

    init() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('paperdict-bilingual-capsule-host')) return;

      this.host = document.createElement('paperdict-bilingual-capsule-host');
      this.host.id = 'paperdict-bilingual-capsule-host';
      this.host.style.cssText = 'position: fixed; right: 18px; top: 52%; transform: translateY(-50%); z-index: 2147483646; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.render();
      (document.body || document.documentElement).appendChild(this.host);
      this.bindDrag();
    }

    render() {
      const modeLabelMap = {
        original: '原版',
        bilingual: '双语',
        chinese: '纯中'
      };

      this.shadow.innerHTML = `
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          :host { all: initial; }

          /* Collapsed Floating Capsule Pill */
          .capsule-pill {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px 8px 10px;
            background: #ffffff;
            color: #1e293b;
            border: 1px solid #e2e8f0;
            border-radius: 30px;
            box-shadow: 0 4px 16px -2px rgba(15, 23, 42, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.08);
            cursor: pointer;
            user-select: none;
            transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .capsule-pill:hover {
            transform: scale(1.04);
            box-shadow: 0 6px 20px -2px rgba(37, 99, 235, 0.2), 0 2px 8px -1px rgba(15, 23, 42, 0.1);
            border-color: #93c5fd;
          }
          .pill-logo {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
          }
          .pill-text {
            font-size: 13px;
            font-weight: 600;
            color: #334155;
            letter-spacing: 0.3px;
          }
          .pill-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 10px;
            background: #f1f5f9;
            color: #64748b;
            transition: all 0.2s ease;
          }
          .pill-badge.active-bi { background: #dbeafe; color: #1d4ed8; }
          .pill-badge.active-zh { background: #dcfce7; color: #15803d; }

          /* Expanded Main Panel */
          .capsule-panel {
            display: none;
            width: 270px;
            background: #ffffff;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.18), 0 4px 12px -2px rgba(15, 23, 42, 0.08);
            overflow: hidden;
            animation: panelFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .capsule-panel.visible { display: block; }
          .capsule-pill.hidden { display: none; }

          .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px 8px;
            background: #f8fafc;
            border-bottom: 1px solid #f1f5f9;
          }
          .panel-title-group {
            display: flex;
            align-items: center;
            gap: 7px;
          }
          .panel-title {
            font-size: 13.5px;
            font-weight: 700;
            color: #0f172a;
          }
          .btn-minimize {
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            padding: 4px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .btn-minimize:hover { background: #e2e8f0; color: #475569; }

          /* Mode Switcher Buttons */
          .mode-buttons {
            display: flex;
            background: #f1f5f9;
            padding: 3px;
            border-radius: 8px;
            margin: 12px 14px 10px;
            gap: 3px;
          }
          .mode-btn {
            flex: 1;
            padding: 7px 4px;
            font-size: 12.5px;
            font-weight: 600;
            border: none;
            background: transparent;
            color: #64748b;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.18s ease;
            text-align: center;
          }
          .mode-btn:hover { color: #1e293b; }
          .mode-btn.active {
            background: #ffffff;
            color: #2563eb;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
          }

          /* Progress / Stats */
          .panel-stats {
            padding: 0 14px 10px;
            font-size: 12px;
            color: #64748b;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .progress-track {
            margin: 0 14px 10px;
            height: 4px;
            background: #f1f5f9;
            border-radius: 2px;
            overflow: hidden;
          }
          .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #3b82f6, #2563eb);
            width: 0%;
            transition: width 0.3s ease;
          }

          /* Footer / Shortcut Info */
          .panel-footer {
            padding: 8px 14px;
            background: #f8fafc;
            border-top: 1px solid #f1f5f9;
            font-size: 11.5px;
            color: #94a3b8;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .footer-actions {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .btn-footer-action {
            background: transparent;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            color: #64748b;
            font-size: 11px;
            padding: 2px 6px;
            cursor: pointer;
            transition: all 0.15s ease;
          }
          .btn-footer-action:hover {
            background: #e2e8f0;
            color: #0f172a;
          }
          .shortcut-badge {
            background: #e2e8f0;
            color: #475569;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            font-weight: 600;
          }

          @keyframes panelFadeIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        </style>

        <!-- Collapsed Floating Pill -->
        <div class="capsule-pill" id="capsule-pill" title="点击展开论文速读面板 (快捷键 Alt+B)">
          <div class="pill-logo">P</div>
          <span class="pill-text">论文速读</span>
          <span class="pill-badge" id="pill-badge">${modeLabelMap[this.currentMode]}</span>
        </div>

        <!-- Expanded Main Panel -->
        <div class="capsule-panel" id="capsule-panel">
          <div class="panel-header">
            <div class="panel-title-group">
              <div class="pill-logo">P</div>
              <span class="panel-title">PaperDict 论文速读</span>
            </div>
            <button class="btn-minimize" id="btn-minimize" title="收起">✕</button>
          </div>

          <div class="mode-buttons">
            <button class="mode-btn ${this.currentMode === 'bilingual' ? 'active' : ''}" data-mode="bilingual">
              双语对照
            </button>
            <button class="mode-btn ${this.currentMode === 'chinese' ? 'active' : ''}" data-mode="chinese">
              纯享中文
            </button>
            <button class="mode-btn ${this.currentMode === 'original' ? 'active' : ''}" data-mode="original">
              还原英文
            </button>
          </div>

          <div class="progress-track">
            <div class="progress-bar" id="progress-bar"></div>
          </div>

          <div class="panel-stats">
            <span id="stats-status">视口随滚随翻</span>
            <span id="stats-count">0 / 0 段</span>
          </div>

          <div class="panel-footer">
            <div class="footer-actions">
              <button class="btn-footer-action" id="btn-hide-capsule" title="彻底隐藏右侧悬浮胶囊">隐藏胶囊</button>
              <button class="btn-footer-action" id="btn-disable-site" title="在当前网站禁用插件">在此站禁用</button>
            </div>
            <span class="shortcut-badge">Alt + B</span>
          </div>
        </div>
      `;

      // Bind events
      const pill = this.shadow.getElementById('capsule-pill');
      const panel = this.shadow.getElementById('capsule-panel');
      const btnMin = this.shadow.getElementById('btn-minimize');
      const btnHide = this.shadow.getElementById('btn-hide-capsule');
      const btnDisableSite = this.shadow.getElementById('btn-disable-site');

      pill.addEventListener('click', () => {
        this.isExpanded = true;
        pill.classList.add('hidden');
        panel.classList.add('visible');
      });

      btnMin.addEventListener('click', () => {
        this.isExpanded = false;
        panel.classList.remove('visible');
        pill.classList.remove('hidden');
      });

      if (btnHide) {
        btnHide.addEventListener('click', () => {
          if (this.onHideCapsule) this.onHideCapsule();
          if (this.host) this.host.remove();
        });
      }

      if (btnDisableSite) {
        btnDisableSite.addEventListener('click', () => {
          if (this.onDisableSite) this.onDisableSite();
          if (this.host) this.host.remove();
        });
      }

      const modeBtns = this.shadow.querySelectorAll('.mode-btn');
      modeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const m = btn.dataset.mode;
          if (this.onModeChange) this.onModeChange(m);
        });
      });
    }

    setMode(mode) {
      this.currentMode = mode;
      if (!this.shadow) return;

      const badge = this.shadow.getElementById('pill-badge');
      if (badge) {
        badge.className = 'pill-badge';
        if (mode === 'bilingual') {
          badge.classList.add('active-bi');
          badge.textContent = '双语';
        } else if (mode === 'chinese') {
          badge.classList.add('active-zh');
          badge.textContent = '纯中';
        } else {
          badge.textContent = '原版';
        }
      }

      const modeBtns = this.shadow.querySelectorAll('.mode-btn');
      modeBtns.forEach((btn) => {
        if (btn.dataset.mode === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    updateStats(translated, total) {
      this.stats.translated = translated;
      this.stats.total = total;
      if (!this.shadow) return;

      const countEl = this.shadow.getElementById('stats-count');
      const barEl = this.shadow.getElementById('progress-bar');
      const statusEl = this.shadow.getElementById('stats-status');

      if (countEl) countEl.textContent = `${translated} / ${total} 段`;
      if (barEl) {
        const pct = total > 0 ? Math.round((translated / total) * 100) : 0;
        barEl.style.width = `${pct}%`;
      }
      if (statusEl) {
        if (translated === total && total > 0) {
          statusEl.textContent = '全文就绪';
        } else if (this.currentMode !== 'original') {
          statusEl.textContent = '视口流式加载中';
        } else {
          statusEl.textContent = '就绪';
        }
      }
    }

    bindDrag() {
      if (!this.host) return;
      let startY = 0;
      let initialTop = 0;
      let isDragging = false;

      const onMouseDown = (e) => {
        // Drag using pill
        const pill = this.shadow.getElementById('capsule-pill');
        if (!pill || !e.composedPath().includes(pill)) return;

        isDragging = false;
        startY = e.clientY;
        const rect = this.host.getBoundingClientRect();
        initialTop = rect.top;

        const onMouseMove = (moveEvent) => {
          const dy = moveEvent.clientY - startY;
          if (Math.abs(dy) > 3) isDragging = true;
          const newTop = Math.max(20, Math.min(window.innerHeight - 80, initialTop + dy));
          this.host.style.top = `${newTop}px`;
          this.host.style.transform = 'none';
        };

        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };

      this.shadow.addEventListener('mousedown', onMouseDown);
    }
  }

  /**
   * 4. Bilingual Core & Viewport Lazy Manager (PaperBilingualManager)
   */
  class PaperBilingualManager {
    constructor() {
      this.mode = 'original'; // 'original' | 'bilingual' | 'chinese'
      this.filter = new AcademicFilter();
      this.formulaProtector = new FormulaProtector();
      this.capsule = null;

      this.cache = new Map(); // text -> translatedText
      this.elements = []; // all eligible content elements
      this.elementStateMap = new WeakMap(); // el -> { state: 'idle'|'queued'|'translating'|'done', transEl, rawText, tokenMap }
      this.observer = null;

      this.queue = [];
      this.activeRequests = 0;
      this.maxConcurrency = 2;
      this.toastTimer = null;
      this.onlineFallback = true;
      this.isBlacklisted = false;
      this.capsuleEnabled = true;
      this.runtimeMessageListener = null;
      this.runtimeListenerAttached = false;
    }

    init() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      // Setup Storage Sync & Initialize Capsule
      this.loadSettings();
      this.setupStorageListener();

      // Initialize Viewport IntersectionObserver
      this.setupObserver();

      // Setup Keyboard Shortcut Alt+B
      this.setupShortcut();

      this.setupRuntimeListener();
    }

    setupRuntimeListener() {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
      const onMessage = chrome.runtime.onMessage;
      if (!this.runtimeMessageListener) {
        this.runtimeMessageListener = (msg, sender, sendResponse) => {
          if (msg.type === 'SET_BILINGUAL_MODE') {
            this.setMode(msg.mode);
            sendResponse({ success: true, mode: this.mode });
            return true;
          }
          if (msg.type === 'GET_BILINGUAL_MODE') {
            sendResponse({
              mode: this.mode,
              total: this.elements.length,
              translated: this.getTranslatedCount()
            });
            return true;
          }
          if (msg.type === 'TOGGLE_BILINGUAL_MODE') {
            this.toggleMode();
            sendResponse({ success: true, mode: this.mode });
            return true;
          }
        };
      }

      if (typeof onMessage.hasListener === 'function') {
        if (onMessage.hasListener(this.runtimeMessageListener)) return;
      } else if (this.runtimeListenerAttached) {
        return;
      }
      onMessage.addListener(this.runtimeMessageListener);
      this.runtimeListenerAttached = true;
    }

    initCapsule() {
      if (this.capsule) return;
      this.capsule = new CapsuleUI({
        onModeChange: (newMode) => this.setMode(newMode),
        onHideCapsule: () => {
          this.applyCapsuleEnabled(false);
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ capsuleEnabled: false });
          }
          this.showToast('已隐藏悬浮胶囊，按 Alt+B 仍可随时切换速读');
        },
        onDisableSite: () => {
          const host = window.location.hostname;
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get({ blacklist: [] }, (res) => {
              const list = res.blacklist || [];
              if (!list.includes(host)) list.push(host);
              chrome.storage.sync.set({ blacklist: list });
            });
          }
          this.restoreOriginalView();
          this.showToast(`已在当前网站 (${host}) 禁用 PaperDict`);
        }
      });
      this.capsule.init();
    }

    loadSettings() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({
          bilingualMode: 'original',
          bilingualDefault: false,
          capsuleEnabled: true,
          onlineFallback: true,
          blacklist: []
        }, (items) => {
          if (items) {
            this.applyOnlineFallback(items.onlineFallback !== false);
            const currentHost = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
            if (items.blacklist && Array.isArray(items.blacklist) && items.blacklist.some(d => currentHost === d || currentHost.endsWith('.' + d))) {
              this.isBlacklisted = true;
              this.applyCapsuleEnabled(items.capsuleEnabled !== false);
              return;
            }

            this.applyCapsuleEnabled(items.capsuleEnabled !== false);

            if (items.bilingualDefault && items.bilingualMode === 'original') {
              this.setMode('bilingual');
            } else if (items.bilingualMode && items.bilingualMode !== 'original') {
              this.setMode(items.bilingualMode);
            }
          }
        });
      } else {
        this.initCapsule();
      }
    }

    setupStorageListener() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        const translationConfigChanged = area === 'sync'
          ? ['customEngine', 'customApiEndpoint', 'customModel'].some((key) => changes[key])
          : area === 'local' && Boolean(changes.glossaryVersion || changes.customApiKey);
        if (translationConfigChanged) this.cache.clear();

        if (area !== 'sync') return;
        if (changes.onlineFallback) {
          this.applyOnlineFallback(changes.onlineFallback.newValue !== false);
        }
        if (changes.capsuleEnabled) {
          this.applyCapsuleEnabled(changes.capsuleEnabled.newValue !== false);
        }
        if (changes.blacklist) {
          const currentHost = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
          const list = Array.isArray(changes.blacklist.newValue) ? changes.blacklist.newValue : [];
          this.isBlacklisted = list.some((domain) => currentHost === domain || currentHost.endsWith('.' + domain));
          this.applyCapsuleEnabled(this.capsuleEnabled);
        }
      });
    }

    applyOnlineFallback(enabled) {
      this.onlineFallback = enabled !== false;
      if (!this.onlineFallback && this.mode !== 'original') {
        this.mode = 'original';
        this.restoreOriginalView();
      }
    }

    applyCapsuleEnabled(enabled) {
      this.capsuleEnabled = enabled !== false;
      if (!this.capsuleEnabled || this.isBlacklisted) {
        const capsule = this.capsule;
        this.capsule = null;
        if (capsule) {
          if (typeof capsule.destroy === 'function') capsule.destroy();
          else if (capsule.host) capsule.host.remove();
        }
        return;
      }
      this.initCapsule();
    }

    setupShortcut() {
      window.addEventListener('keydown', (e) => {
        // Alt + B (Option + B on Mac)
        if (e.altKey && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
          e.preventDefault();
          this.toggleMode();
        }
      }, true);
    }

    setupObserver() {
      if (typeof IntersectionObserver === 'undefined') return;

      this.observer = new IntersectionObserver((entries) => {
        if (this.mode === 'original') return;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target;
            const state = this.elementStateMap.get(el);
            if (!state || state.state === 'idle') {
              this.enqueueElement(el);
            }
          }
        }
      }, {
        root: null,
        rootMargin: '300px 0px 300px 0px',
        threshold: 0.01
      });
    }

    /**
     * Toggles modes cyclically: original -> bilingual -> chinese -> original
     */
    toggleMode() {
      const modeCycle = {
        original: 'bilingual',
        bilingual: 'chinese',
        chinese: 'original'
      };
      const nextMode = modeCycle[this.mode] || 'bilingual';
      this.setMode(nextMode);
    }

    /**
     * Switches viewing mode and updates DOM styling
     */
    setMode(newMode) {
      if (!['original', 'bilingual', 'chinese'].includes(newMode)) return;
      if (newMode !== 'original' && !this.onlineFallback) {
        this.showToast('整页翻译需要在线引擎，请先在设置中开启在线翻译');
        return;
      }
      this.mode = newMode;

      // Update HTML dataset for global CSS rules
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.paperdictMode = newMode;
      }

      // Update Capsule UI
      if (this.capsule) {
        this.capsule.setMode(newMode);
      }

      // Save preference
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ bilingualMode: newMode });
      }

      // Show toast
      const toastTexts = {
        original: '↩️ 已还原英文原版排版',
        bilingual: '📖 已开启学术双语对照阅读',
        chinese: '⚡ 已开启纯中文极速阅读模式'
      };
      this.showToast(toastTexts[newMode]);

      if (newMode === 'original') {
        this.restoreOriginalView();
      } else {
        this.activateBilingualView();
      }
    }

    /**
     * Discovers academic content elements and hooks observer
     */
    activateBilingualView() {
      this.elements = this.filter.findContentElements(document);

      // Cleanly re-observe elements
      if (this.observer) {
        this.observer.disconnect();
      }

      for (const el of this.elements) {
        if (!this.elementStateMap.has(el)) {
          this.elementStateMap.set(el, { state: 'idle', transEl: null });
        }
        if (this.observer) {
          this.observer.observe(el);
        }
      }

      this.updateCapsuleStats();
      this.applyDisplayModeToAll();
      this.processQueue();
    }

    restoreOriginalView() {
      // 1. Disconnect observer to avoid background viewport tracking during original reading
      if (this.observer) {
        this.observer.disconnect();
      }

      // 2. Clear translation queue
      this.queue = [];

      // 3. Reset uncompleted queued items to idle and clean temporary loading shimmer
      for (const el of this.elements) {
        const info = this.elementStateMap.get(el);
        if (info && info.state === 'queued') {
          info.state = 'idle';
          if (info.transEl && info.transEl.classList.contains('pd-bilingual-loading')) {
            info.transEl.remove();
            info.transEl = null;
          }
        }
      }

      // 4. Hide all translation elements
      this.applyDisplayModeToAll();
      this.updateCapsuleStats();
    }

    applyDisplayModeToAll() {
      for (const el of this.elements) {
        const info = this.elementStateMap.get(el);
        if (!info) continue;

        if (this.mode === 'chinese') {
          if (el.classList) el.classList.add('pd-orig-hidden');
          if (info.transEl) {
            info.transEl.style.display = 'block';
            info.transEl.classList.add('full-chinese');
          }
        } else if (this.mode === 'bilingual') {
          if (el.classList) el.classList.remove('pd-orig-hidden');
          if (info.transEl) {
            info.transEl.style.display = 'block';
            info.transEl.classList.remove('full-chinese');
          }
        } else {
          // Original mode
          if (el.classList) el.classList.remove('pd-orig-hidden');
          if (info.transEl) {
            info.transEl.style.display = 'none';
          }
        }
      }
    }

    enqueueElement(el) {
      const info = this.elementStateMap.get(el) || { state: 'idle' };
      if (info.state !== 'idle') return;

      info.state = 'queued';
      this.elementStateMap.set(el, info);
      this.queue.push(el);

      // Render shimmer loading placeholder if in bilingual or chinese mode
      if (this.mode !== 'original' && !info.transEl) {
        this.renderLoadingPlaceholder(el, info);
      }

      this.processQueue();
    }

    renderLoadingPlaceholder(el, info) {
      const placeholder = document.createElement('div');
      placeholder.className = 'pd-bilingual-loading';
      placeholder.innerHTML = `<span class="pd-loading-spinner"></span><span>正在就地速译...</span>`;

      // Insert immediately following the original element
      if (el.nextSibling) {
        el.parentNode.insertBefore(placeholder, el.nextSibling);
      } else {
        el.parentNode.appendChild(placeholder);
      }
      info.transEl = placeholder;
    }

    async processQueue() {
      if (this.mode === 'original') return;
      if (this.activeRequests >= this.maxConcurrency) return;
      if (this.queue.length === 0) return;

      const el = this.queue.shift();
      const info = this.elementStateMap.get(el);
      if (!info) return;

      info.state = 'translating';
      this.activeRequests++;

      try {
        await this.translateElement(el, info);
      } catch (err) {
        console.warn('Paragraph translation error:', err);
      } finally {
        this.activeRequests--;
        this.updateCapsuleStats();
        // Continue queue processing
        this.processQueue();
      }
    }

    /**
     * Translates a single academic paragraph with formula protection & caching
     */
    async translateElement(el, info) {
      const rawText = (el.innerText || el.textContent || '').trim();
      if (!rawText) {
        info.state = 'done';
        if (info.transEl) info.transEl.remove();
        return;
      }

      // Check cache first
      if (this.cache.has(rawText)) {
        const cachedTrans = this.cache.get(rawText);
        this.renderTranslation(el, info, cachedTrans);
        info.state = 'done';
        return;
      }

      // Protect math formulas and structure
      const { protectedText, tokenMap } = this.formulaProtector.protect(el);

      // Perform online translation via background Service Worker
      const response = await this.requestTranslation(protectedText);

      if (response && response.success && response.translation) {
        // Restore protected formulas
        const restoredHtml = this.formulaProtector.restore(response.translation, tokenMap);
        this.cache.set(rawText, restoredHtml);
        this.renderTranslation(el, info, restoredHtml);
        info.state = 'done';
      } else {
        // Translation failed
        if (info.transEl) {
          const errMsg = response?.error || '网络超时';
          info.transEl.innerHTML = `
            <div class="pd-bilingual-fail" style="display:flex;align-items:center;gap:8px;">
              <span style="color:#ef4444;font-size:12px;">(翻译暂不可用: ${this.formulaProtector.escapeHtml(errMsg)})</span>
              <button class="btn-retry-trans" style="padding:1px 6px;font-size:11px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;color:#2563eb;cursor:pointer;">🔄 重试</button>
            </div>
          `;
          const btnRetry = info.transEl.querySelector('.btn-retry-trans');
          if (btnRetry) {
            btnRetry.onclick = (e) => {
              e.stopPropagation();
              info.state = 'idle';
              this.enqueueElement(el);
            };
          }
        }
        info.state = 'idle'; // allow retry later
      }
    }

    requestTranslation(text) {
      return new Promise((resolve) => {
        if (!this.onlineFallback) {
          resolve({
            success: false,
            code: 'ONLINE_DISABLED',
            error: '整页翻译需要在线引擎，请先在设置中开启在线翻译'
          });
          return;
        }
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'TRANSLATE_ONLINE',
            text
          }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: '无响应' });
            }
          });
        } else {
          resolve({ success: false, error: '扩展运行环境不可用' });
        }
      });
    }

    renderTranslation(el, info, transHtml) {
      if (!info.transEl || !info.transEl.parentNode) {
        const transNode = document.createElement('div');
        transNode.className = 'pd-bilingual-trans';
        if (el.nextSibling) {
          el.parentNode.insertBefore(transNode, el.nextSibling);
        } else {
          el.parentNode.appendChild(transNode);
        }
        info.transEl = transNode;
      } else {
        info.transEl.className = 'pd-bilingual-trans';
      }

      info.transEl.innerHTML = transHtml;

      if (this.mode === 'chinese') {
        if (el.classList) el.classList.add('pd-orig-hidden');
        info.transEl.classList.add('full-chinese');
        info.transEl.style.display = 'block';
      } else if (this.mode === 'bilingual') {
        if (el.classList) el.classList.remove('pd-orig-hidden');
        info.transEl.classList.remove('full-chinese');
        info.transEl.style.display = 'block';
      } else {
        if (el.classList) el.classList.remove('pd-orig-hidden');
        info.transEl.style.display = 'none';
      }
    }

    getTranslatedCount() {
      let count = 0;
      for (const el of this.elements) {
        const info = this.elementStateMap.get(el);
        if (info && info.state === 'done') count++;
      }
      return count;
    }

    updateCapsuleStats() {
      if (!this.capsule) return;
      const count = this.getTranslatedCount();
      this.capsule.updateStats(count, this.elements.length);
    }

    showToast(message) {
      if (typeof document === 'undefined') return;
      let toast = document.getElementById('paperdict-mode-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'paperdict-mode-toast';
        toast.className = 'pd-mode-toast';
        (document.body || document.documentElement).appendChild(toast);
      }

      toast.textContent = message;
      toast.classList.add('visible');

      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.classList.remove('visible');
      }, 2200);
    }
  }

  function reattachExistingManager(manager) {
    if (!manager) return false;
    PaperBilingualManager.prototype.setupRuntimeListener.call(manager);
    return true;
  }

  // Export for browser and Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FormulaProtector,
      AcademicFilter,
      PaperBilingualManager,
      reattachExistingManager
    };
  } else {
    global.PaperBilingualManager = PaperBilingualManager;
    global.FormulaProtector = FormulaProtector;
    global.AcademicFilter = AcademicFilter;

    // Auto-instantiate when running in browser web page
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.CustomEvent === 'function') {
      // 1. Top frame only: ensure window.self === window.top to prevent duplicate injection inside iframes
      if (!(window.self === window.top)) {
        return;
      }

      // 2. Do not auto-instantiate the floating capsule manager inside the dedicated PDF reader page
      const isReaderPage = window.location && (
        window.location.pathname.includes('/reader/reader.html') ||
        window.location.href.includes('reader/reader.html')
      );
      if (isReaderPage) {
        return;
      }

      if (global.paperBilingualManager) {
        reattachExistingManager(global.paperBilingualManager);
        return;
      }

      const manager = new PaperBilingualManager();
      global.paperBilingualManager = manager;

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => manager.init());
      } else {
        manager.init();
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
