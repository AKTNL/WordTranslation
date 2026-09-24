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

  // Explicit WAI-ARIA widgets, composites, and non-content landmarks are never paragraph sources.
  const EXCLUDED_ARIA_ROLES = new Set([
    'alertdialog', 'application', 'banner', 'button', 'checkbox', 'columnheader',
    'combobox', 'complementary', 'contentinfo', 'dialog', 'form', 'grid', 'gridcell',
    'link', 'listbox', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'meter', 'navigation', 'option', 'progressbar', 'radio',
    'radiogroup', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
    'separator', 'slider', 'spinbutton', 'switch', 'tab', 'tablist', 'textbox',
    'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
  ]);
  // Descendant links remain eligible here; isLinkDense distinguishes prose links from navigation.
  const EXCLUDED_DESCENDANT_ARIA_ROLES = new Set(
    Array.from(EXCLUDED_ARIA_ROLES).filter((role) => role !== 'link')
  );
  const CONTENT_CANDIDATE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, div';
  const DESCENDANT_SCAN_SELECTOR = [
    'a', '[role]', '[contenteditable]', 'button', 'input', 'textarea', 'select',
    'form', 'option', 'label', 'audio', 'video', 'iframe', 'svg', 'canvas',
    'pre', 'code', 'math', 'script', 'style', 'noscript',
    '.pd-bilingual-trans', '.pd-bilingual-loading', '.pd-bilingual-error',
    '.pd-bilingual-fail', '.pd-mode-toast',
    'paper-dict-host', 'paperdict-bilingual-capsule-host'
  ].join(', ');
  const DESCENDANT_BLOCKER_TAGS = new Set([
    'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'OPTION', 'LABEL',
    'AUDIO', 'VIDEO', 'IFRAME', 'SVG', 'CANVAS', 'PRE', 'CODE', 'MATH',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'PAPER-DICT-HOST',
    'PAPERDICT-BILINGUAL-CAPSULE-HOST'
  ]);

  function getAriaRoleTokens(el) {
    if (!el || typeof el.getAttribute !== 'function') return [];
    return String(el.getAttribute('role') || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function isLinkElement(el) {
    const tag = String(el && el.tagName || '').toUpperCase();
    return tag === 'A' || getAriaRoleTokens(el).includes('link');
  }

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
            rawText: node.textContent || ''
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
      let restored = this.escapeHtml(translatedText || '');
      if (!tokenMap || tokenMap.size === 0) return restored;

      // Resilient regex matching PDMATH_0, PDMATH 0, pdmath_0, PD MATH 0, PD-MATH-0, etc.
      const pattern = /PD\s*[-_]?\s*MATH\s*[_ \-:]*\s*(\d+)/gi;

      restored = restored.replace(pattern, (match, digits) => {
        const canonicalKey = `${this.tokenPrefix}${digits}`;
        const info = tokenMap.get(canonicalKey);
        if (!info) return match;

        if (info.type === 'dom' || info.type === 'latex_display' || info.type === 'latex_inline') {
          const formulaText = info.type === 'dom' ? info.rawText : info.text;
          return `<span class="pd-math-formula">${this.escapeHtml(formulaText || '')}</span>`;
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
        'FOOTER', 'ASIDE', 'FORM', 'OPTION', 'LABEL', 'AUDIO', 'VIDEO',
        'IFRAME', 'MATH', 'PAPER-DICT-HOST', 'PAPERDICT-BILINGUAL-CAPSULE-HOST'
      ]);

      this.refHeadingRegex = /^\s*(?:(?:\[\d+\]|[0-9]+|[IVXLCDM]+)[\.\s\-]*)?(?:references|bibliography|works\s+cited|literature\s+cited|citations)(?:\s*(?:and|&)\s*(?:notes|sources|citations|references|further\s+reading))?\s*[:\.]?\s*$/i;
      this.excludedClassIdRegex = /(reference|bibliography|biblio|ref-list|footnote|author-notes|header|navbar|sidebar|footer|menu|comment|pager|pagination|disclaimer|copyright|doi-box)/i;
      this.mathClassIdRegex = /(?:^|[\s_-])(?:formula|math|mathjax|katex|mjx-container)(?:$|[\s_-])/i;
      this.semanticDivHintRegex = /(?:^|[\s_-])(?:paragraph|para|prose|abstract|article[-_]?text|body[-_]?text)(?:$|[\s_-])/i;
      this.blockCandidateTags = new Set([
        'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI'
      ]);
    }

    isReferenceHeading(text) {
      return this.refHeadingRegex.test(String(text || '').trim());
    }

    hasExcludedRole(el, excludedRoles = EXCLUDED_ARIA_ROLES) {
      return getAriaRoleTokens(el).some((role) => excludedRoles.has(role));
    }

    isCssHidden(el) {
      if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false;
      try {
        const style = window.getComputedStyle(el);
        if (!style) return false;
        const display = String(style.display || '').toLowerCase();
        const visibility = String(style.visibility || '').toLowerCase();
        return display === 'none' || visibility === 'hidden' || visibility === 'collapse';
      } catch (error) {
        return false;
      }
    }

    getLinkStats(el) {
      if (!el || String(el.tagName || '').toUpperCase() !== 'DIV' || typeof el.querySelectorAll !== 'function') {
        return { count: 0, textLength: 0 };
      }
      const links = Array.from(new Set(
        Array.from(el.querySelectorAll('a, [role]')).filter(isLinkElement)
      ));
      return {
        count: links.length,
        textLength: links.reduce((total, link) => {
          return total + (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim().length;
        }, 0)
      };
    }

    isLinkDense(el, linkStats = null) {
      if (!el || String(el.tagName || '').toUpperCase() !== 'DIV') return false;
      const stats = linkStats || this.getLinkStats(el);
      if (stats.count === 0) return false;
      const textLength = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().length;
      if (textLength === 0) return false;
      const linkedRatio = Math.min(stats.textLength / textLength, 1);
      const nonLinkedLength = Math.max(textLength - stats.textLength, 0);

      if (stats.count === 1) return linkedRatio >= 0.8 && nonLinkedLength < 20;
      return linkedRatio >= 0.5 || (stats.count >= 4 && linkedRatio >= 0.35);
    }

    getClassName(el) {
      if (!el) return '';
      return typeof el.className === 'string'
        ? el.className
        : (el.getAttribute ? el.getAttribute('class') || '' : '');
    }

    isGeneratedNode(el) {
      return Boolean(el && el.classList && (
        el.classList.contains('pd-bilingual-trans') ||
        el.classList.contains('pd-bilingual-loading') ||
        el.classList.contains('pd-bilingual-error') ||
        el.classList.contains('pd-bilingual-fail') ||
        el.classList.contains('pd-mode-toast')
      ));
    }

    isSelfStructurallyExcluded(el) {
      if (!el || !el.tagName) return true;
      const tag = el.tagName.toUpperCase();
      if (this.excludedTags.has(tag) || this.isGeneratedNode(el) || this.hasExcludedRole(el)) return true;

      const id = el.id || '';
      const className = this.getClassName(el);
      if (
        this.excludedClassIdRegex.test(id) ||
        this.excludedClassIdRegex.test(className) ||
        this.mathClassIdRegex.test(id) ||
        this.mathClassIdRegex.test(className)
      ) {
        return true;
      }

      if (el.getAttribute) {
        const contentEditable = el.getAttribute('contenteditable');
        if (contentEditable !== null && String(contentEditable).toLowerCase() !== 'false') return true;
        if (String(el.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return true;
      }

      return el.hidden === true || Boolean(el.dataset && el.dataset.pdExclude === 'true');
    }

    /**
     * Checks whether an element is inside an excluded container or reference section.
     */
    isExcluded(el) {
      if (!el || !el.tagName) return true;
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        if (this.isSelfStructurallyExcluded(cur) || this.isCssHidden(cur)) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    hasSemanticDivHint(el) {
      if (!el || String(el.tagName || '').toUpperCase() !== 'DIV') return false;
      return getAriaRoleTokens(el).includes('paragraph') ||
        this.semanticDivHintRegex.test(`${el.id || ''} ${this.getClassName(el)}`);
    }

    isBlockingDescendantNode(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toUpperCase();
      if (DESCENDANT_BLOCKER_TAGS.has(tag) || this.isGeneratedNode(el)) return true;
      if (this.hasExcludedRole(el, EXCLUDED_DESCENDANT_ARIA_ROLES)) return true;
      if (!el.getAttribute) return false;
      const contentEditable = el.getAttribute('contenteditable');
      return contentEditable !== null && String(contentEditable).toLowerCase() !== 'false';
    }

    hasInteractiveDescendant(el) {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      return Array.from(el.querySelectorAll(DESCENDANT_SCAN_SELECTOR)).some((descendant) => {
        return this.isBlockingDescendantNode(descendant);
      });
    }

    hasNestedCandidateBlock(el) {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      const descendants = el.querySelectorAll(CONTENT_CANDIDATE_SELECTOR);
      for (const descendant of descendants) {
        if (this.isEligibleWithoutAggregate(descendant)) return true;
      }
      return false;
    }

    isSelfCandidateTag(el) {
      const tag = String(el && el.tagName || '').toUpperCase();
      if (this.blockCandidateTags.has(tag)) return true;
      if (tag !== 'DIV') return false;
      const text = (el.innerText || el.textContent || '').trim();
      return this.hasSemanticDivHint(el) || text.length >= 40;
    }

    isSemanticParagraphDiv(el) {
      if (!this.isSelfCandidateTag(el) || String(el.tagName || '').toUpperCase() !== 'DIV') return false;
      if (this.hasInteractiveDescendant(el) || this.hasNestedCandidateBlock(el)) return false;
      return true;
    }

    isCandidateTag(el) {
      const tag = String(el && el.tagName || '').toUpperCase();
      return this.blockCandidateTags.has(tag) || (tag === 'DIV' && this.isSemanticParagraphDiv(el));
    }

    isEligibleWithoutAggregate(el, options = {}) {
      if (!this.isSelfCandidateTag(el)) return false;
      const tag = el.tagName.toUpperCase();
      const isExcluded = options.isExcluded || ((candidate) => this.isExcluded(candidate));
      if (isExcluded(el)) return false;

      if (tag === 'DIV') {
        const isBlocked = options.isDivBlocked
          ? options.isDivBlocked(el)
          : this.hasInteractiveDescendant(el);
        if (isBlocked) return false;
        const linkStats = options.getLinkStats ? options.getLinkStats(el) : null;
        if (this.isLinkDense(el, linkStats)) return false;
      }

      const rawText = (el.innerText || el.textContent || '').trim();
      if (tag.startsWith('H')) {
        if (rawText.length < 2) return false;
        if (!options.allowReferenceHeading && this.isReferenceHeading(rawText)) return false;
      } else if (rawText.length < 15) {
        return false;
      }

      if (!isEnglishSourceText(rawText)) return false;
      if (typeof window !== 'undefined' && el.offsetParent === null && el.offsetHeight === 0 && el.offsetWidth === 0) {
        return false;
      }
      return true;
    }

    /**
     * Validates if a block element is eligible for translation
     */
    isEligible(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toUpperCase();
      if (tag === 'DIV' && this.hasNestedCandidateBlock(el)) return false;
      return this.isEligibleWithoutAggregate(el);
    }

    createScanContext(container, candidates) {
      const candidateSet = new Set(candidates);
      const blockedDivs = new WeakSet();
      const linkStats = new WeakMap();
      const selfExcluded = new WeakMap();
      const cssHidden = new WeakMap();
      const inheritedExcluded = new WeakMap();
      const helperSuppressed = new WeakMap();

      const isSelfExcluded = (el) => {
        if (!selfExcluded.has(el)) {
          selfExcluded.set(el, this.isSelfStructurallyExcluded(el));
        }
        return selfExcluded.get(el);
      };
      const isCssHidden = (el) => {
        if (!cssHidden.has(el)) cssHidden.set(el, this.isCssHidden(el));
        return cssHidden.get(el);
      };
      const isExcluded = (el) => {
        if (!el || !el.tagName) return true;
        if (inheritedExcluded.has(el)) return inheritedExcluded.get(el);

        const path = [];
        let cur = el;
        let excluded = false;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          if (inheritedExcluded.has(cur)) {
            excluded = inheritedExcluded.get(cur);
            break;
          }
          path.push(cur);
          if (isSelfExcluded(cur) || isCssHidden(cur)) {
            excluded = true;
            break;
          }
          cur = cur.parentElement;
        }
        for (const node of path) inheritedExcluded.set(node, excluded);
        return excluded;
      };
      const isHelperSuppressed = (el) => {
        if (!el || !el.tagName) return true;
        if (!helperSuppressed.has(el)) {
          const ariaHidden = el.getAttribute &&
            String(el.getAttribute('aria-hidden') || '').toLowerCase() === 'true';
          const suppressed = el.hidden === true || ariaHidden || isCssHidden(el) ||
            Boolean(el.parentElement && isExcluded(el.parentElement));
          helperSuppressed.set(el, suppressed);
        }
        return helperSuppressed.get(el);
      };

      const descendants = container.querySelectorAll(DESCENDANT_SCAN_SELECTOR);
      for (const descendant of descendants) {
        const blocksDiv = this.isBlockingDescendantNode(descendant);
        const isLink = isLinkElement(descendant);
        if ((!blocksDiv && !isLink) || isHelperSuppressed(descendant)) continue;

        const linkTextLength = isLink
          ? String(
            typeof descendant.innerText === 'string'
              ? descendant.innerText
              : descendant.textContent || ''
          ).replace(/\s+/g, ' ').trim().length
          : 0;
        let ancestor = descendant.parentElement;
        while (ancestor && ancestor !== container.parentElement) {
          if (candidateSet.has(ancestor) && String(ancestor.tagName || '').toUpperCase() === 'DIV') {
            if (blocksDiv) blockedDivs.add(ancestor);
            if (isLink) {
              const stats = linkStats.get(ancestor) || { count: 0, textLength: 0 };
              stats.count += 1;
              stats.textLength += linkTextLength;
              linkStats.set(ancestor, stats);
            }
          }
          if (ancestor === container) break;
          ancestor = ancestor.parentElement;
        }
      }

      return {
        candidateSet,
        isExcluded,
        isDivBlocked: (el) => blockedDivs.has(el),
        getLinkStats: (el) => linkStats.get(el) || { count: 0, textLength: 0 }
      };
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
      const candidates = Array.from(container.querySelectorAll(CONTENT_CANDIDATE_SELECTOR));
      const scan = this.createScanContext(container, candidates);

      const preliminary = [];
      let inReferenceSection = false;
      let refHeadingLevel = 2;

      for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim();
        const tag = el.tagName.toUpperCase();
        const isHeading = tag.startsWith('H') && tag.length === 2;
        const included = this.isEligibleWithoutAggregate(el, {
          allowReferenceHeading: true,
          isExcluded: scan.isExcluded,
          isDivBlocked: scan.isDivBlocked,
          getLinkStats: scan.getLinkStats
        });

        // Detect entry into References section
        if (included && isHeading && this.isReferenceHeading(text)) {
          inReferenceSection = true;
          refHeadingLevel = parseInt(tag.charAt(1), 10) || 2;
          continue;
        }

        if (inReferenceSection) {
          // If we reach another section heading at or above the reference level, reference section ended
          if (included && isHeading && !this.isReferenceHeading(text)) {
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

        if (included) preliminary.push(el);
      }

      const aggregateDivs = new WeakSet();
      for (const el of preliminary) {
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== container.parentElement) {
          if (
            scan.candidateSet.has(ancestor) &&
            String(ancestor.tagName || '').toUpperCase() === 'DIV'
          ) {
            aggregateDivs.add(ancestor);
          }
          if (ancestor === container) break;
          ancestor = ancestor.parentElement;
        }
      }

      return preliminary.filter((el) => !aggregateDivs.has(el));
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
            width: 290px;
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
            font-size: 12px;
            font-weight: 600;
            border: none;
            background: transparent;
            color: #64748b;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.18s ease;
            text-align: center;
            white-space: nowrap;
            flex-shrink: 0;
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
            padding: 8px 12px;
            background: #f8fafc;
            border-top: 1px solid #f1f5f9;
            font-size: 11px;
            color: #94a3b8;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .footer-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 5px;
            width: 100%;
          }
          .btn-footer-action {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            color: #475569;
            font-size: 11px;
            padding: 4px 6px;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
            flex: 1;
            text-align: center;
            flex-shrink: 0;
            outline: none;
          }
          .btn-footer-action:hover {
            background: #e2e8f0;
            color: #0f172a;
          }
          .footer-subrow {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            width: 100%;
            font-size: 10.5px;
            color: #94a3b8;
          }
          .shortcut-badge {
            background: #e2e8f0;
            color: #475569;
            padding: 1px 5px;
            border-radius: 3px;
            font-family: monospace;
            font-weight: 600;
            font-size: 10.5px;
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
              <button class="btn-footer-action" id="btn-capsule-notes" title="一键导出当前论文的全部批注笔记为 Markdown (.md)">导出笔记</button>
              <button class="btn-footer-action" id="btn-disable-site" title="在当前网站禁用插件">本站禁用</button>
              <button class="btn-footer-action" id="btn-hide-capsule" title="彻底隐藏右侧悬浮胶囊">隐藏胶囊</button>
            </div>
            <div class="footer-subrow">
              <span>快捷切换</span>
              <span class="shortcut-badge">Alt + B</span>
            </div>
          </div>
        </div>
      `;

      // Bind events
      const pill = this.shadow.getElementById('capsule-pill');
      const panel = this.shadow.getElementById('capsule-panel');
      const btnMin = this.shadow.getElementById('btn-minimize');
      const btnHide = this.shadow.getElementById('btn-hide-capsule');
      const btnDisableSite = this.shadow.getElementById('btn-disable-site');
      const btnNotes = this.shadow.getElementById('btn-capsule-notes');

      if (btnNotes) {
        btnNotes.addEventListener('click', async () => {
          const mgr = typeof AnnotationManager !== 'undefined' ? new AnnotationManager() : null;
          if (!mgr) return;
          const docKey = AnnotationManager.getDocKey(window.location.href, document.title);
          const notes = await mgr.getAnnotationsForDoc(docKey);

          let terms = [];
          const extractor = typeof GlossaryExtractor !== 'undefined' ? new GlossaryExtractor() : null;
          if (extractor && typeof document !== 'undefined' && document.body) {
            try {
              terms = extractor.extractFromDOM(document.body) || [];
            } catch (e) {}
          }

          if ((!notes || notes.length === 0) && (!terms || terms.length === 0)) {
            alert('当前页面暂无论文批注笔记或专有术语，划词高亮或写笔记后即可一键导出！');
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
        });
      }

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
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;
      let isDragging = false;

      const onMouseDown = (e) => {
        // Drag using pill
        const pill = this.shadow.getElementById('capsule-pill');
        if (!pill || !e.composedPath().includes(pill)) return;

        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.host.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        const onMouseMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
          const newLeft = Math.max(10, Math.min(window.innerWidth - 130, initialLeft + dx));
          const newTop = Math.max(10, Math.min(window.innerHeight - 60, initialTop + dy));
          this.host.style.left = `${newLeft}px`;
          this.host.style.top = `${newTop}px`;
          this.host.style.right = 'auto';
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
      this.registeredElements = new Set();
      this.trackedElements = new Set(); // all elements touched during the active page-mode session
      this.ownedTranslationNodes = new Set();
      this.elementStateMap = new WeakMap(); // el -> { state: 'idle'|'queued'|'translating'|'done'|'error', transEl, request fields }
      this.observer = null;
      this.observedElements = new WeakSet();
      this.mutationObserver = null;
      this.nextRequestId = 0;
      this.translationConfigGeneration = 0;
      this.inFlightTranslations = new Map();
      this.pageModeActive = false;
      this.viewGeneration = 0;
      this.activeRequestSlots = new Set();

      this.queue = [];
      this.activeRequests = 0;
      this.maxConcurrency = 2;
      this.activeRequestIds = new Set();
      this.reqCounter = 0;
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
          ? ['customEngine', 'customApiEndpoint', 'customModel', 'onlineFallback'].some((key) => changes[key])
          : area === 'local' && Boolean(changes.glossaryVersion || changes.customApiKey);
        if (area === 'sync' && changes.onlineFallback) {
          this.applyOnlineFallback(changes.onlineFallback.newValue !== false);
        }
        if (translationConfigChanged) this.invalidateTranslationConfig();

        if (area !== 'sync') return;
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

    invalidateTranslationConfig() {
      this.translationConfigGeneration++;
      this.cache.clear();
      this.inFlightTranslations.clear();
      this.queue = [];

      const elementsToReschedule = [];
      for (const el of this.trackedElements) {
        const info = this.elementStateMap.get(el);
        if (!info) continue;
        const wasTranslating = info.state === 'translating';
        const requestEntry = info.requestEntry;
        info.requestId = null;
        info.requestGeneration = null;
        info.requestViewGeneration = null;
        info.requestEntry = null;
        info.state = 'idle';
        if (requestEntry && !wasTranslating) this.releaseRequestEntry(null, requestEntry);
        this.removeTranslationNode(info);
        if (el.classList && typeof el.classList.remove === 'function') {
          el.classList.remove('pd-orig-hidden');
        }
        if (this.mode !== 'original' && this.isElementActive(el)) elementsToReschedule.push(el);
      }

      for (const el of elementsToReschedule) {
        this.registerElement(el, { knownEligible: true });
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
            if (this.observer && typeof this.observer.unobserve === 'function') {
              this.observer.unobserve(el);
            }
            this.observedElements.delete(el);
            if (!this.isElementActive(el)) continue;
            const state = this.elementStateMap.get(el);
            if (state && state.state === 'idle') {
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

    isElementInViewport(el) {
      if (!el || typeof el.getBoundingClientRect !== 'function' || typeof window === 'undefined') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return Boolean(rect) &&
        rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth;
    }

    isElementActive(el) {
      return Boolean(el) && el.isConnected !== false && this.registeredElements.has(el);
    }

    isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration) {
      return this.mode !== 'original' && this.isElementActive(el) &&
        this.elementStateMap.get(el) === info && info.requestId === requestId &&
        info.requestGeneration === requestGeneration &&
        info.requestViewGeneration === requestViewGeneration &&
        this.translationConfigGeneration === requestGeneration &&
        this.viewGeneration === requestViewGeneration;
    }

    acquireRequestSlot() {
      const slot = { viewGeneration: this.viewGeneration, released: false };
      this.activeRequestSlots.add(slot);
      this.activeRequests = this.activeRequestSlots.size;
      return slot;
    }

    releaseRequestSlot(slot) {
      if (!slot || slot.released) return false;
      slot.released = true;
      this.activeRequestSlots.delete(slot);
      this.activeRequests = this.activeRequestSlots.size;
      return true;
    }

    releaseAllRequestSlots() {
      for (const slot of [...this.activeRequestSlots]) this.releaseRequestSlot(slot);
    }

    getRequestEntryKey(generation, protectedText) {
      return JSON.stringify([generation, protectedText]);
    }

    cleanupRequestEntry(entry) {
      if (!entry || entry.leases !== 0) return;
      if (this.inFlightTranslations.get(entry.mapKey) === entry) {
        this.inFlightTranslations.delete(entry.mapKey);
      }
    }

    retainRequestEntry(info, entry) {
      if (!info || !entry) return false;
      if (info.requestEntry === entry) return true;
      if (info.requestEntry) this.releaseRequestEntry(info, info.requestEntry);
      info.requestEntry = entry;
      entry.leases++;
      if (
        entry.generation === this.translationConfigGeneration &&
        !this.inFlightTranslations.has(entry.mapKey)
      ) {
        this.inFlightTranslations.set(entry.mapKey, entry);
      }
      return true;
    }

    releaseRequestEntry(info, entry) {
      if (!entry) return;
      if (info && info.requestEntry === entry) info.requestEntry = null;
      entry.leases = Math.max(0, entry.leases - 1);
      this.cleanupRequestEntry(entry);
    }

    createRequestEntry(info, generation, protectedText) {
      const mapKey = this.getRequestEntryKey(generation, protectedText);
      let entry = this.inFlightTranslations.get(mapKey);
      if (!entry) {
        entry = {
          mapKey,
          generation,
          protectedText,
          leases: 0,
          settled: false,
          promise: null
        };
        const request = Promise.resolve(this.requestTranslation(protectedText));
        entry.promise = request.then(
          (response) => {
            entry.settled = true;
            this.cleanupRequestEntry(entry);
            return response;
          },
          (error) => {
            entry.settled = true;
            this.cleanupRequestEntry(entry);
            throw error;
          }
        );
        this.inFlightTranslations.set(mapKey, entry);
      }
      this.retainRequestEntry(info, entry);
      return entry;
    }

    adoptRequestEntry(info, entries) {
      if (!info || !entries) return;
      const entry = entries.find((candidate) => {
        return candidate && candidate.generation === this.translationConfigGeneration;
      });
      if (entry) this.retainRequestEntry(info, entry);
    }

    removeTranslationNode(info) {
      if (!info || !info.transEl) return;
      this.ownedTranslationNodes.delete(info.transEl);
      if (typeof info.transEl.remove === 'function') info.transEl.remove();
      info.transEl = null;
    }

    getElementSourceText(el) {
      return String(el && (el.innerText || el.textContent) || '').trim();
    }

    invalidateElementSource(el, info, sourceText) {
      if (!el || !info) return false;
      const requestEntry = info.requestEntry;
      const wasTranslating = info.state === 'translating';
      this.queue = this.queue.filter((queued) => queued !== el);
      info.requestId = null;
      info.requestGeneration = null;
      info.requestViewGeneration = null;
      info.requestEntry = null;
      info.sourceText = sourceText;
      info.state = 'idle';
      if (requestEntry && !wasTranslating) {
        this.releaseRequestEntry(null, requestEntry);
      } else if (
        requestEntry && !requestEntry.settled && requestEntry.leases <= 1 &&
        this.inFlightTranslations.get(requestEntry.mapKey) === requestEntry
      ) {
        this.inFlightTranslations.delete(requestEntry.mapKey);
      }
      this.removeTranslationNode(info);
      if (el.classList && typeof el.classList.remove === 'function') {
        el.classList.remove('pd-orig-hidden');
      }
      return true;
    }

    unregisterElement(el, options = {}) {
      if (!el) return false;
      const wasRegistered = this.registeredElements.delete(el);
      this.trackedElements.delete(el);
      this.observedElements.delete(el);
      if (this.observer && typeof this.observer.unobserve === 'function') {
        this.observer.unobserve(el);
      }
      this.queue = this.queue.filter((queued) => queued !== el);
      if (wasRegistered) this.elements = this.elements.filter((registered) => registered !== el);

      const info = this.elementStateMap.get(el);
      if (info) {
        const requestEntry = info.requestEntry;
        const wasTranslating = info.state === 'translating';
        info.requestId = null;
        info.requestGeneration = null;
        info.requestViewGeneration = null;
        info.requestEntry = null;
        info.state = 'idle';
        if (requestEntry && !wasTranslating) {
          this.releaseRequestEntry(null, requestEntry);
        } else if (
          requestEntry && !options.preserveRequestEntry &&
          requestEntry.leases <= 1 &&
          this.inFlightTranslations.get(requestEntry.mapKey) === requestEntry
        ) {
          this.inFlightTranslations.delete(requestEntry.mapKey);
        }
        this.removeTranslationNode(info);
        this.elementStateMap.delete(el);
      }
      if (el.classList && typeof el.classList.remove === 'function') {
        el.classList.remove('pd-orig-hidden');
      }
      return wasRegistered;
    }

    isWithinSubtree(el, root) {
      if (!el || !root) return false;
      if (el === root) return true;
      if (typeof root.contains === 'function') return root.contains(el);
      let current = el.parentElement;
      while (current) {
        if (current === root) return true;
        current = current.parentElement;
      }
      return false;
    }

    unregisterSubtree(root) {
      let changed = false;
      for (const el of [...this.elements]) {
        if (this.isWithinSubtree(el, root)) changed = this.unregisterElement(el) || changed;
      }
      return changed;
    }

    reconcileCandidateAncestors(el) {
      const requestEntries = [];
      let ancestor = el && el.parentElement;
      while (ancestor) {
        if (
          this.registeredElements.has(ancestor) &&
          String(ancestor.tagName || '').toUpperCase() === 'DIV'
        ) {
          const info = this.elementStateMap.get(ancestor);
          if (info && info.requestEntry) requestEntries.push(info.requestEntry);
          this.unregisterElement(ancestor, { preserveRequestEntry: true });
        }
        ancestor = ancestor.parentElement;
      }
      return requestEntries;
    }

    registerElement(el, options = {}) {
      if (
        !el || el.isConnected === false ||
        (!options.knownEligible && !this.filter.isEligible(el))
      ) {
        return false;
      }

      let info = this.elementStateMap.get(el);
      if (!info) {
        info = { state: 'idle', transEl: null, sourceText: this.getElementSourceText(el) };
        this.elementStateMap.set(el, info);
      } else if (options.contentChanged) {
        const sourceText = this.getElementSourceText(el);
        if (info.sourceText !== sourceText) {
          this.invalidateElementSource(el, info, sourceText);
        }
      }
      this.trackedElements.add(el);
      this.adoptRequestEntry(info, options.requestEntries);
      if (!this.registeredElements.has(el)) {
        this.registeredElements.add(el);
        this.elements.push(el);
      }
      if (info.state !== 'idle') return false;

      if (this.isElementInViewport(el) || !this.observer) {
        if (this.observer && typeof this.observer.unobserve === 'function') {
          this.observer.unobserve(el);
        }
        this.observedElements.delete(el);
        this.enqueueElement(el);
      } else if (!this.observedElements.has(el)) {
        this.observer.observe(el);
        this.observedElements.add(el);
      }
      return true;
    }

    registerElements(elements, options = {}) {
      for (const el of elements || []) this.registerElement(el, options);
    }

    registerMutationRoot(root, includeDescendants = false, options = {}) {
      if (!root || !root.tagName || root.isConnected === false || this.filter.isExcluded(root)) return false;
      let changed = false;
      const candidates = [];
      if (this.filter.isEligible(root)) candidates.push(root);
      else if (this.registeredElements.has(root)) changed = this.unregisterElement(root) || changed;
      if (includeDescendants) candidates.push(...this.filter.findContentElements(root));

      for (const candidate of new Set(candidates)) {
        if (!candidate || candidate.isConnected === false) continue;
        const requestEntries = this.reconcileCandidateAncestors(candidate);
        changed = this.registerElement(candidate, {
          knownEligible: true,
          requestEntries,
          contentChanged: options.contentChanged === true
        }) || changed;
      }
      return changed;
    }

    registerMutationAncestors(root, options = {}) {
      let changed = false;
      let current = root;
      while (current && current.tagName) {
        const isEligible = this.filter.isEligible(current);
        changed = this.registerMutationRoot(current, false, options) || changed;
        if (isEligible || this.registeredElements.has(current)) break;
        if (current === document.body || current === document.documentElement) break;
        current = current.parentElement || null;
      }
      return changed;
    }

    getMutationElement(node) {
      if (!node) return null;
      if (node.nodeType === 1 || node.tagName) return node;
      if (node.nodeType === 3) return node.parentElement || node.parentNode || null;
      return null;
    }

    setupMutationObserver() {
      if (this.mutationObserver || typeof MutationObserver === 'undefined') return;
      this.mutationObserver = new MutationObserver((records) => {
        if (this.mode === 'original') return;
        let changed = false;
        for (const record of records) {
          let refreshTarget = record.type === 'characterData';

          for (const node of record.removedNodes || []) {
            const removedElement = this.getMutationElement(node);
            if (removedElement && (node.nodeType === 1 || node.tagName)) {
              changed = this.unregisterSubtree(removedElement) || changed;
            }
            if (!removedElement || this.filter.isExcluded(removedElement)) continue;
            refreshTarget = true;
          }

          for (const node of record.addedNodes || []) {
            const addedElement = this.getMutationElement(node);
            if (!addedElement || this.filter.isExcluded(addedElement)) continue;
            changed = this.registerMutationRoot(
              addedElement,
              node.nodeType === 1 || Boolean(node.tagName),
              { contentChanged: true }
            ) || changed;
            refreshTarget = true;
          }

          if (record.type === 'characterData') {
            const hydratedElement = this.getMutationElement(record.target);
            changed = this.registerMutationAncestors(hydratedElement, { contentChanged: true }) || changed;
          } else if (refreshTarget) {
            changed = this.registerMutationAncestors(
              this.getMutationElement(record.target),
              { contentChanged: true }
            ) || changed;
          }
        }
        if (changed) {
          this.updateCapsuleStats();
        }
      });
    }

    observeContentChanges() {
      this.setupMutationObserver();
      if (!this.mutationObserver || typeof document === 'undefined') return;
      const target = document.body || document.documentElement;
      if (!target) return;
      this.mutationObserver.disconnect();
      this.mutationObserver.observe(target, {
        childList: true,
        characterData: true,
        subtree: true
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
      if (newMode === this.mode && newMode !== 'original' && this.pageModeActive) {
        if (typeof document !== 'undefined' && document.documentElement) {
          document.documentElement.dataset.paperdictMode = newMode;
        }
        if (this.capsule) this.capsule.setMode(newMode);
        this.applyDisplayModeToAll();
        this.updateCapsuleStats();
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
        original: '已还原英文原版排版',
        bilingual: '已开启学术双语对照阅读',
        chinese: '已开启纯中文极速阅读模式'
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
      if (!this.pageModeActive) {
        this.pageModeActive = true;
        this.viewGeneration++;
      }
      // Cleanly re-observe elements
      if (this.observer) {
        this.observer.disconnect();
      }
      this.observedElements = new WeakSet();
      this.elements = [];
      this.registeredElements.clear();

      const discovered = this.filter.findContentElements(document);
      this.registerElements(discovered, { knownEligible: true });
      this.observeContentChanges();

      this.updateCapsuleStats();
      this.applyDisplayModeToAll();
    }

    restoreOriginalView() {
      // 1. Disconnect observer to avoid background viewport tracking during original reading
      if (this.observer) {
        this.observer.disconnect();
      }
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }
      this.pageModeActive = false;
      this.viewGeneration++;
      this.releaseAllRequestSlots();
      this.observedElements = new WeakSet();

      // 2. Reset every tracked item before clearing the queue. A page rescan may
      // have removed an element from this.elements while it was still queued.
      const pendingElements = new Set([...this.queue, ...this.elements, ...this.trackedElements]);
      this.queue = [];
      this.cancelActiveRequests();
      for (const el of pendingElements) {
        const info = this.elementStateMap.get(el);
        if (!info) continue;
        const wasTranslating = info.state === 'translating';
        const requestEntry = info.requestEntry;
        info.requestId = null;
        info.requestGeneration = null;
        info.requestViewGeneration = null;
        info.requestEntry = null;
        info.state = 'idle';
        if (requestEntry && !wasTranslating) this.releaseRequestEntry(null, requestEntry);
        this.removeTranslationNode(info);
        if (el.classList && typeof el.classList.remove === 'function') {
          el.classList.remove('pd-orig-hidden');
        }
      }
      this.trackedElements.clear();

      for (const node of [...this.ownedTranslationNodes]) {
        if (node && typeof node.remove === 'function') node.remove();
      }
      this.ownedTranslationNodes.clear();

      // 3. Restore source visibility and refresh the capsule.
      this.applyDisplayModeToAll();
      this.updateCapsuleStats();
    }

    applyDisplayModeToAll() {
      for (const el of this.elements) {
        const info = this.elementStateMap.get(el);
        if (!info) continue;

        const hasTranslation = info.state === 'done' && info.transEl &&
          info.transEl.classList.contains('pd-bilingual-trans');
        if (el.classList) {
          if (this.mode === 'chinese' && hasTranslation) el.classList.add('pd-orig-hidden');
          else el.classList.remove('pd-orig-hidden');
        }
        if (info.transEl) {
          info.transEl.style.display = this.mode === 'original' ? 'none' : 'block';
          if (hasTranslation) this.syncSourceTypography(el, info.transEl);
        }
      }
    }

    enqueueElement(el) {
      if (this.mode === 'original' || !this.isElementActive(el)) return;
      const info = this.elementStateMap.get(el);
      if (!info) return;
      if (info.state !== 'idle') return;

      info.state = 'queued';
      this.elementStateMap.set(el, info);
      this.queue.push(el);

      // Render or restore the single generated node for this source paragraph.
      if (this.mode !== 'original') {
        this.renderLoadingPlaceholder(el, info);
      }

      this.processQueue();
    }

    renderLoadingPlaceholder(el, info) {
      let placeholder = info.transEl;
      if (!placeholder) {
        placeholder = document.createElement('div');
        this.ownedTranslationNodes.add(placeholder);
      }
      placeholder.className = 'pd-bilingual-loading';
      placeholder.innerHTML = `<span class="pd-loading-spinner"></span><span>正在就地速译...</span>`;
      placeholder.style.display = 'block';
      if (typeof placeholder.setAttribute === 'function') {
        placeholder.setAttribute('role', 'status');
        placeholder.setAttribute('aria-live', 'polite');
      }
      if (el.classList && typeof el.classList.remove === 'function') {
        el.classList.remove('pd-orig-hidden');
      }

      // Insert immediately following the original element
      if (!placeholder.parentNode) {
        if (el.nextSibling) {
          el.parentNode.insertBefore(placeholder, el.nextSibling);
        } else {
          el.parentNode.appendChild(placeholder);
        }
      }
      info.transEl = placeholder;
    }

    async processQueue() {
      if (this.mode === 'original') return;
      if (this.activeRequests >= this.maxConcurrency) return;
      let el = null;
      let info = null;
      while (this.queue.length > 0 && !el) {
        const candidate = this.queue.shift();
        const candidateInfo = this.elementStateMap.get(candidate);
        if (!this.isElementActive(candidate) || !candidateInfo || candidateInfo.state !== 'queued') continue;
        el = candidate;
        info = candidateInfo;
      }
      if (!el || !info) return;

      info.state = 'translating';
      const requestId = ++this.nextRequestId;
      const requestGeneration = this.translationConfigGeneration;
      const requestViewGeneration = this.viewGeneration;
      info.requestId = requestId;
      info.requestGeneration = requestGeneration;
      info.requestViewGeneration = requestViewGeneration;
      const requestSlot = this.acquireRequestSlot();

      try {
        await this.translateElement(el, info, requestId, requestGeneration, requestViewGeneration);
      } catch (err) {
        console.warn('Paragraph translation error:', err);
        if (this.isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration)) {
          info.state = 'error';
          this.renderTranslationError(el, info, err && err.message ? err.message : '网络超时');
        }
      } finally {
        this.releaseRequestSlot(requestSlot);
        this.updateCapsuleStats();
        // Continue queue processing
        this.processQueue();
      }
    }

    /**
     * Translates a single academic paragraph with formula protection & caching
     */
    async translateElement(el, info, requestId, requestGeneration, requestViewGeneration) {
      if (!this.isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration)) return;
      const rawText = (el.innerText || el.textContent || '').trim();
      if (!rawText) {
        info.state = 'done';
        if (info.transEl) info.transEl.remove();
        return;
      }

      // Check cache first
      if (this.cache.has(rawText)) {
        const cachedTrans = this.cache.get(rawText);
        if (!this.isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration)) return;
        info.state = 'done';
        this.renderTranslation(el, info, cachedTrans);
        return;
      }

      // Protect math formulas and structure
      const { protectedText, tokenMap } = this.formulaProtector.protect(el);

      if (!this.isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration)) return;
      const requestKey = this.getRequestEntryKey(requestGeneration, protectedText);
      let requestEntry = info.requestEntry;
      if (
        !requestEntry || requestEntry.mapKey !== requestKey ||
        requestEntry.generation !== requestGeneration
      ) {
        if (requestEntry) this.releaseRequestEntry(info, requestEntry);
        requestEntry = this.createRequestEntry(info, requestGeneration, protectedText);
      }
      let response;
      try {
        response = await requestEntry.promise;
      } finally {
        this.releaseRequestEntry(info, requestEntry);
      }

      if (!this.isRequestCurrent(el, info, requestId, requestGeneration, requestViewGeneration)) return;
      if (response && response.success && response.translation) {
        // Restore protected formulas
        const restoredHtml = this.formulaProtector.restore(response.translation, tokenMap);
        this.cache.set(rawText, restoredHtml);
        info.state = 'done';
        this.renderTranslation(el, info, restoredHtml);
      } else {
        info.state = 'error';
        this.renderTranslationError(el, info, response?.error || '网络超时');
      }
    }

    renderTranslationError(el, info, errorMessage) {
      if (!info.transEl) this.renderLoadingPlaceholder(el, info);
      info.transEl.className = 'pd-bilingual-error';
      info.transEl.style.display = 'block';
      if (typeof info.transEl.setAttribute === 'function') {
        info.transEl.setAttribute('role', 'alert');
        info.transEl.setAttribute('aria-live', 'assertive');
      }
      info.transEl.innerHTML = `
        <div class="pd-translation-error-message">翻译暂不可用: ${this.formulaProtector.escapeHtml(errorMessage)}</div>
        <button type="button" class="pd-translation-retry">重试</button>
      `;
      if (el.classList) el.classList.remove('pd-orig-hidden');

      const retryButton = info.transEl.querySelector('.pd-translation-retry');
      if (retryButton) {
        retryButton.onclick = (event) => {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          this.retryTranslation(el, info);
        };
      }
    }

    retryTranslation(el, info) {
      if (!info || info.state !== 'error') return;
      info.state = 'idle';
      this.enqueueElement(el);
    }

    cancelActiveRequests() {
      if (this.activeRequestIds && this.activeRequestIds.size > 0) {
        for (const reqId of this.activeRequestIds) {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATION', requestId: reqId }).catch(() => {});
          }
        }
        this.activeRequestIds.clear();
      }
    }
    requestTranslation(text) {
      const requestId = `bilingual_${Date.now()}_${++this.reqCounter}`;
      this.activeRequestIds.add(requestId);
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
            text,
            requestId
          }, (res) => {
            this.activeRequestIds.delete(requestId);
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: '无响应' });
            }
          });
        } else {
          this.activeRequestIds.delete(requestId);
          resolve({ success: false, error: '扩展运行环境不可用' });
        }
      });
    }

    syncSourceTypography(el, transEl) {
      if (
        !el || !transEl || !transEl.style ||
        typeof transEl.style.setProperty !== 'function' ||
        typeof window === 'undefined' || typeof window.getComputedStyle !== 'function'
      ) {
        return;
      }

      let sourceStyle;
      try {
        sourceStyle = window.getComputedStyle(el);
      } catch (error) {
        return;
      }
      if (!sourceStyle) return;

      const typographyProperties = [
        ['--pd-source-font-family', 'fontFamily'],
        ['--pd-source-font-size', 'fontSize'],
        ['--pd-source-font-weight', 'fontWeight'],
        ['--pd-source-line-height', 'lineHeight'],
        ['--pd-source-font-style', 'fontStyle'],
        ['--pd-source-text-align', 'textAlign']
      ];
      for (const [customProperty, styleProperty] of typographyProperties) {
        const value = String(sourceStyle[styleProperty] || '').trim();
        if (value) transEl.style.setProperty(customProperty, value);
      }
    }

    renderTranslation(el, info, transHtml) {
      if (!info.transEl || !info.transEl.parentNode) {
        const transNode = document.createElement('div');
        transNode.className = 'pd-bilingual-trans';
        this.ownedTranslationNodes.add(transNode);
        if (el.nextSibling) {
          el.parentNode.insertBefore(transNode, el.nextSibling);
        } else {
          el.parentNode.appendChild(transNode);
        }
        info.transEl = transNode;
      } else {
        info.transEl.className = 'pd-bilingual-trans';
      }

      if (typeof info.transEl.removeAttribute === 'function') {
        info.transEl.removeAttribute('role');
        info.transEl.removeAttribute('aria-live');
      }
      this.syncSourceTypography(el, info.transEl);
      info.transEl.innerHTML = `<div class="pd-translation-label">译文</div><div class="pd-translation-content">${transHtml}</div>`;

      if (this.mode === 'chinese') {
        if (el.classList) el.classList.add('pd-orig-hidden');
        info.transEl.style.display = 'block';
      } else if (this.mode === 'bilingual') {
        if (el.classList) el.classList.remove('pd-orig-hidden');
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
      reattachExistingManager,
      getAriaRoleTokens,
      isLinkElement
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
