(function (global) {
  'use strict';

  function isSelectionNavigationKey(event) {
    if (!event || typeof event.key !== 'string') return false;
    return event.key === 'Shift' || event.key.startsWith('Arrow');
  }

  function createRangeAnchor(range) {
    if (!range) return null;

    let anchoredRange = range;
    let disposed = false;

    if (range && typeof range.cloneRange === 'function') {
      try {
        anchoredRange = range.cloneRange();
      } catch (error) {
        anchoredRange = range;
      }
    }

    if (!anchoredRange || typeof anchoredRange.getBoundingClientRect !== 'function') return null;

    function isConnected() {
      const nodes = [
        anchoredRange.commonAncestorContainer,
        anchoredRange.startContainer,
        anchoredRange.endContainer
      ];
      return nodes.every((node) => !node || typeof node.isConnected !== 'boolean' || node.isConnected);
    }

    function hasMatchingBoundaries(currentRange) {
      const boundaries = ['startContainer', 'startOffset', 'endContainer', 'endOffset'];
      if (boundaries.every((key) => key in anchoredRange && key in currentRange)) {
        return boundaries.every((key) => anchoredRange[key] === currentRange[key]);
      }
      return currentRange === anchoredRange;
    }

    return {
      matchesSelection(selection) {
        if (disposed || !anchoredRange || !isConnected()) return false;
        if (!selection || selection.isCollapsed || selection.rangeCount < 1) return false;
        if (typeof selection.getRangeAt !== 'function') return false;

        try {
          return hasMatchingBoundaries(selection.getRangeAt(0));
        } catch (error) {
          return false;
        }
      },

      getRect(viewportWidth, viewportHeight, options = {}) {
        if (disposed || !anchoredRange || typeof anchoredRange.getBoundingClientRect !== 'function') {
          return null;
        }
        if (!isConnected()) return null;

        try {
          const rect = anchoredRange.getBoundingClientRect();
          if (!rect) return null;
          const geometry = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
          if (!geometry.every(Number.isFinite)) return null;
          if (rect.width <= 0 || rect.height <= 0) return null;
          if (!options.allowOffscreen) {
            if (rect.right <= 0 || rect.bottom <= 0) return null;
            if (rect.left >= viewportWidth || rect.top >= viewportHeight) return null;
          }
          return rect;
        } catch (error) {
          return null;
        }
      },

      dispose() {
        if (disposed) return;
        disposed = true;
        if (anchoredRange && typeof anchoredRange.detach === 'function') {
          try {
            anchoredRange.detach();
          } catch (error) {
            // Some browser Range implementations expose a no-op or throwing detach().
          }
        }
        anchoredRange = null;
      }
    };
  }

  // Break a selection Range into one segment per text node it covers. A range
  // that crosses element or line boundaries cannot be wrapped by a single
  // surroundContents() call, so callers wrap each segment separately.
  function splitRangeIntoSegments(range) {
    if (!range || typeof range.cloneRange !== 'function') return [];
    const startContainer = range.startContainer;
    const doc = (startContainer && startContainer.ownerDocument) ||
      (range.commonAncestorContainer && range.commonAncestorContainer.ownerDocument) || null;
    if (!doc || typeof doc.createRange !== 'function' || typeof doc.createTreeWalker !== 'function') return [];

    let root = range.commonAncestorContainer;
    if (root && root.nodeType === 3) root = root.parentNode;
    if (!root) return [];

    let probe;
    try {
      probe = doc.createRange();
      probe.setStart(range.startContainer, range.startOffset);
      probe.setEnd(range.endContainer, range.endOffset);
    } catch (error) {
      return [];
    }

    const segments = [];
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue || '';
      if (value.length > 0) {
        let intersects = true;
        if (typeof probe.intersectsNode === 'function') {
          try {
            intersects = probe.intersectsNode(node);
          } catch (error) {
            intersects = true;
          }
        }
        if (intersects) {
          const start = node === probe.startContainer ? probe.startOffset : 0;
          const end = node === probe.endContainer ? probe.endOffset : value.length;
          if (end > start) segments.push({ node, start, end });
        }
      }
      node = walker.nextNode();
    }
    return segments;
  }

  function normalizeWhitespace(value) {
    return String(value == null ? '' : value).replace(/[\s ]+/g, ' ').trim();
  }

  // Mirror the typographic normalization applied by DictService.cleanPaperText
  // so a quote stored from one reader view (raw PDF text layer) still matches
  // the same passage in the other (de-hyphenated HTML paragraphs). Both sides
  // of a comparison must run through this same function.
  function normalizePaperMatch(value) {
    return String(value == null ? '' : value)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Produce a normalized copy of a text index using the same rules: typographic
  // characters are replaced 1:1 (the map is untouched), and hyphenated line
  // breaks drop the hyphen plus the whitespace that follows. Surviving entries
  // still point at the original text nodes, so segments sliced from the
  // normalized index can be wrapped directly.
  function normalizeTextIndex(index) {
    if (!index || typeof index.text !== 'string' || !Array.isArray(index.map)) return null;
    const text = index.text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-');
    const map = index.map;

    let normalizedText = '';
    const normalizedMap = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (
        ch === '-' && i > 0 && /[A-Za-z]/.test(text[i - 1]) &&
        text[i + 1] === ' ' && i + 2 < text.length && /[A-Za-z]/.test(text[i + 2])
      ) {
        continue; // drop the hyphen that ended a broken line
      }
      if (
        ch === ' ' && i > 1 && text[i - 1] === '-' &&
        /[A-Za-z]/.test(text[i - 2]) && i + 1 < text.length && /[A-Za-z]/.test(text[i + 1])
      ) {
        continue; // drop the space that followed the dropped hyphen
      }
      normalizedText += ch;
      normalizedMap.push(map[i]);
    }
    return { text: normalizedText, map: normalizedMap };
  }

  // `.pdf-html-trans` (reader reflowed-view translation blocks) and
  // `.pdf-page-bilingual` (reader page-side translation panels) are generated
  // duplicates of source text and must never be highlight targets.
  const SKIP_ANCESTOR_SELECTOR = 'paper-dict-host, mark.paperdict-highlight, .pd-bilingual-trans, .pd-bilingual-loading, .pdf-html-trans, .pdf-page-bilingual, script, style, noscript, textarea';

  // Build a whitespace-normalized view of a subtree's text plus a per-character
  // map back to (node, offset). Block boundaries contribute a single space so a
  // stored quote that spanned two elements still matches after a reload.
  function buildTextIndex(root, options = {}) {
    if (!root) return null;
    const doc = root.ownerDocument || (root.nodeType === 9 ? root : null);
    if (!doc || typeof doc.createTreeWalker !== 'function') return null;

    const extraSkipSelector = typeof options.skipSelector === 'string' ? options.skipSelector.trim() : '';
    const shouldSkip = (parent) => {
      if (!parent || typeof parent.closest !== 'function') return false;
      if (parent.closest(SKIP_ANCESTOR_SELECTOR)) return true;
      return Boolean(extraSkipSelector && parent.closest(extraSkipSelector));
    };

    const map = [];
    let text = '';
    let lastParent = null;
    let previousWasSpace = false;

    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent && !shouldSkip(parent)) {
        const value = node.nodeValue || '';
        if (value.length > 0) {
          if (lastParent && lastParent !== parent && text.length > 0 && text[text.length - 1] !== ' ') {
            text += ' ';
            map.push(null);
            previousWasSpace = true;
          }
          for (let i = 0; i < value.length; i++) {
            const ch = value[i];
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === ' ') {
              if (previousWasSpace) continue;
              text += ' ';
              previousWasSpace = true;
            } else {
              text += ch;
              previousWasSpace = false;
            }
            map.push({ node, index: i });
          }
          lastParent = parent;
        }
      }
      node = walker.nextNode();
    }
    return { text, map };
  }

  function sliceMapToSegments(map, from, to) {
    const segments = [];
    let current = null;
    for (let i = from; i < to && i < map.length; i++) {
      const entry = map[i];
      if (!entry) continue;
      if (current && current.node === entry.node && entry.index === current.end) {
        current.end = entry.index + 1;
      } else {
        if (current) segments.push(current);
        current = { node: entry.node, start: entry.index, end: entry.index + 1 };
      }
    }
    if (current) segments.push(current);
    return segments;
  }

  // Find one stored quote inside a pre-built text index, starting at fromIndex.
  // Returns { segments, start, end } or null. Reusing a single index for many
  // lookups keeps restoration cheap on very long documents.
  function findInTextIndex(index, needle, fromIndex = 0, options = {}) {
    if (!index || !index.text) return null;
    const cleanNeedle = normalizeWhitespace(needle);
    if (!cleanNeedle) return null;

    const caseInsensitive = options.caseInsensitive !== false;
    const haystack = caseInsensitive ? index.text.toLowerCase() : index.text;
    const target = caseInsensitive ? cleanNeedle.toLowerCase() : cleanNeedle;

    let at = haystack.indexOf(target, fromIndex);
    if (at !== -1) {
      return { segments: sliceMapToSegments(index.map, at, at + target.length), start: at, end: at + target.length };
    }

    if (cleanNeedle.length > 20) {
      const prefix = normalizeWhitespace(cleanNeedle.slice(0, 24));
      const prefixTarget = caseInsensitive ? prefix.toLowerCase() : prefix;
      at = haystack.indexOf(prefixTarget, fromIndex);
      if (at !== -1) {
        return { segments: sliceMapToSegments(index.map, at, at + prefixTarget.length), start: at, end: at + prefixTarget.length };
      }
    }
    return null;
  }

  // Locate a stored quote anywhere in a subtree, spanning sibling nodes when
  // needed. Returns per-node segments, or an empty array when not found.
  function locateTextSegments(root, needle, options = {}) {
    const index = buildTextIndex(root);
    const hit = findInTextIndex(index, needle, 0, options);
    return hit ? hit.segments : [];
  }

  const api = {
    createRangeAnchor,
    isSelectionNavigationKey,
    splitRangeIntoSegments,
    buildTextIndex,
    findInTextIndex,
    locateTextSegments,
    normalizeWhitespace,
    normalizePaperMatch,
    normalizeTextIndex
  };
  global.PaperDictSelectionAnchor = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
