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

  const api = { createRangeAnchor, isSelectionNavigationKey };
  global.PaperDictSelectionAnchor = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
