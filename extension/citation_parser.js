/**
 * PaperDict - Academic Citation & Reference Parser (Phase 4 P1)
 * Detects in-text citations like [1], [12, 13], [3-5],
 * indexes the paper's References / Bibliography section,
 * and extracts paper title, authors, year, and Google Scholar / arXiv links.
 */

(function () {
  'use strict';

  class CitationParser {
    constructor() {
      this.referencesMap = new Map(); // "1" -> ReferenceEntry
    }

    clear() {
      this.referencesMap.clear();
    }

    /**
     * Check if a string is a bracketed citation marker like "[1]", "[12]", "[3, 4]", "[5-7]"
     */
    static isCitationMarker(str) {
      if (!str || typeof str !== 'string') return false;
      const clean = str.trim();
      return /^\[\s*\d+(?:\s*[,-–]\s*\d+)*\s*\]$/.test(clean);
    }

    /**
     * Parse individual numbers from citation marker like "[12, 13]" -> ["12", "13"], "[3-5]" -> ["3", "4", "5"]
     */
    static parseCitationNumbers(str) {
      if (!str) return [];
      const clean = str.trim().replace(/^\[|\]$/g, '').trim();
      const parts = clean.split(/[,;]/);
      const numbers = [];

      for (const part of parts) {
        const p = part.trim();
        const rangeMatch = p.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (start <= end && end - start <= 20) {
            for (let i = start; i <= end; i++) {
              numbers.push(String(i));
            }
          }
        } else if (/^\d+$/.test(p)) {
          numbers.push(p);
        }
      }
      return numbers;
    }

    /**
     * Parse a single bibliography string into structured metadata
     */
    static parseReferenceEntry(index, rawText) {
      const clean = rawText.replace(/\s+/g, ' ').trim();

      // Extract year (4 digits, typically between 1950 and 2030)
      const yearMatch = clean.match(/\b(19\d{2}|20[0-2]\d)\b/);
      const year = yearMatch ? yearMatch[1] : '';

      // Extract arXiv ID if present
      const arxivMatch = clean.match(/arxiv(?::|\.org\/abs\/)?\s*([0-9]+\.[0-9]+(?:v[0-9]+)?)/i);
      const arxiv = arxivMatch ? arxivMatch[1] : '';

      // Extract DOI if present
      const doiMatch = clean.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
      const doi = doiMatch ? doiMatch[1] : '';

      // Attempt title extraction:
      // Pattern A: Quoted title "Attention is all you need" or “...”
      let title = '';
      const quoteMatch = clean.match(/["“]([^"”]{8,150})["”]/);
      if (quoteMatch) {
        title = quoteMatch[1].replace(/[.,;]+$/, '').trim();
      } else {
        // Pattern B: Sentence between authors and journal (e.g. Authors. Title. Journal...)
        const segments = clean.split(/(?<=[.?!])\s+/);
        if (segments.length >= 2) {
          // Second segment is often title in IEEE/ACM
          title = segments[1].replace(/[.,;]+$/, '').trim();
        }
        if (!title || title.length < 5) {
          title = clean.slice(0, 100) + '...';
        }
      }

      // Generate Google Scholar Search URL
      const searchQuery = title || clean.slice(0, 80);
      const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(searchQuery)}`;
      const arxivUrl = arxiv ? `https://arxiv.org/abs/${arxiv}` : '';
      const doiUrl = doi ? `https://doi.org/${doi}` : '';

      return {
        index,
        raw: clean,
        title,
        year,
        arxiv,
        doi,
        scholarUrl,
        arxivUrl,
        doiUrl
      };
    }

    /**
     * Extract references list from paper text
     */
    extractFromText(text) {
      if (!text || typeof text !== 'string') return [];
      const results = [];

      // Locate References section heading
      const refHeadingRegex = /(?:^|\n)\s*(?:[0-9IVX]+\.?\s*)?(?:REFERENCES|Bibliography|Literature Cited)\b[^\n]*/i;
      const headingMatch = text.match(refHeadingRegex);

      let refContent = text;
      if (headingMatch && headingMatch.index !== undefined) {
        refContent = text.slice(headingMatch.index + headingMatch[0].length);
      }

      // Regex matching numbered references like "[1] Author...", "[12] ..."
      const entryRegex = /(?:^|\n)\s*\[(\d+)\]\s*([\s\S]+?)(?=(?:\n\s*\[\d+\])|\n\n\n|$)/g;
      let m;

      while ((m = entryRegex.exec(refContent)) !== null) {
        const idx = m[1].trim();
        const raw = m[2].trim();
        if (raw.length >= 10) {
          const entry = CitationParser.parseReferenceEntry(idx, raw);
          this.referencesMap.set(idx, entry);
          results.push(entry);
        }
      }

      return results;
    }

    /**
     * Extract references from DOM
     */
    extractFromDOM(root = document.body) {
      if (!root) return [];

      // 1. Check for arXiv HTML bibliography or common classes
      const bibItems = root.querySelectorAll('.ltx_bibitem, .bibliography li, [class*="reference-item"]');
      if (bibItems && bibItems.length > 0) {
        const results = [];
        bibItems.forEach((el, i) => {
          const tag = el.querySelector('.ltx_tag_bibitem, .label') || el;
          const numMatch = (tag.textContent || '').match(/\[?(\d+)\]?/);
          const idx = numMatch ? numMatch[1] : String(i + 1);
          const text = el.textContent || '';
          const entry = CitationParser.parseReferenceEntry(idx, text);
          this.referencesMap.set(idx, entry);
          results.push(entry);
        });
        if (results.length > 0) return results;
      }

      // 2. Fallback to full text scanning
      const fullText = root.innerText || root.textContent || '';
      return this.extractFromText(fullText);
    }

    /**
     * Lookup reference metadata by index or marker
     */
    lookup(citationKey) {
      if (!citationKey) return [];
      const numbers = CitationParser.parseCitationNumbers(citationKey);
      const found = [];

      for (const num of numbers) {
        if (this.referencesMap.has(num)) {
          found.push(this.referencesMap.get(num));
        }
      }

      return found;
    }

    getAllReferences() {
      return Array.from(this.referencesMap.values());
    }
  }

  // Export to Global and CommonJS
  const exported = { CitationParser };

  if (typeof window !== 'undefined') {
    window.CitationParser = CitationParser;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CitationParser = CitationParser;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
