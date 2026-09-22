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

    return {
      getRect(viewportWidth, viewportHeight) {
        if (disposed || !anchoredRange || typeof anchoredRange.getBoundingClientRect !== 'function') {
          return null;
        }

        try {
          const rect = anchoredRange.getBoundingClientRect();
          if (!rect) return null;
          const geometry = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
          if (!geometry.every(Number.isFinite)) return null;
          if (rect.width <= 0 || rect.height <= 0) return null;
          if (rect.right <= 0 || rect.bottom <= 0) return null;
          if (rect.left >= viewportWidth || rect.top >= viewportHeight) return null;
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
