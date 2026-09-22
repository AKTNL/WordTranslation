/**
 * PaperDict - Academic Paper-specific Glossary Extractor (Phase 3 P0)
 * Automatically scans scientific papers to identify author-defined acronyms,
 * abbreviations, and custom terms (e.g. "Low-Rank Adaptation (LoRA)", "DPO", "RoPE"),
 * capturing their exact definition and context sentence.
 */

(function () {
  'use strict';

  class GlossaryExtractor {
    constructor() {
      this.glossary = new Map(); // normalized term (uppercase) -> entry
    }

    /**
     * Clear current glossary
     */
    clear() {
      this.glossary.clear();
    }

    /**
     * Test if an acronym matches the initials of a candidate definition
     */
    static matchesAcronym(acronym, phrase) {
      if (!acronym || !phrase) return false;
      const cleanAcronym = acronym.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cleanAcronym.length < 2 || cleanAcronym.length > 12) return false;

      // Extract words from phrase
      const words = phrase.trim().split(/[\s\-]+/).filter(w => w.length > 0 && !/^(and|of|for|the|in|on|with|to|a|an|by)$/i.test(w));
      if (words.length === 0) return false;

      // Form acronym from word initials
      const initials = words.map(w => w[0]).join('').toUpperCase();
      if (initials.includes(cleanAcronym) || cleanAcronym.includes(initials)) {
        return true;
      }

      // Check if letters of acronym appear in order within the phrase
      let acrIdx = 0;
      const cleanPhrase = phrase.toUpperCase();
      for (let i = 0; i < cleanPhrase.length; i++) {
        if (cleanPhrase[i] === cleanAcronym[acrIdx]) {
          acrIdx++;
          if (acrIdx === cleanAcronym.length) return true;
        }
      }

      return false;
    }

    /**
     * Extract glossary terms from raw text content
     */
    extractFromText(text) {
      if (!text || typeof text !== 'string') return [];
      const results = [];
      const seen = new Set();

      // Split into sentences
      const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z])/);

      for (const rawSentence of sentences) {
        const sentence = rawSentence.replace(/\s+/g, ' ').trim();
        if (sentence.length < 15 || sentence.length > 400) continue;

        // Pattern 1: Full Name (ACRONYM)
        // e.g. "Low-Rank Adaptation (LoRA)", "Direct Preference Optimization (DPO)"
        const p1Regex = /([A-Z][A-Za-z0-9\s\-]{2,45})\s*\(([A-Z][A-Za-z0-9\-]{1,12})\)/g;
        let m;
        while ((m = p1Regex.exec(sentence)) !== null) {
          const phrase = m[1].trim();
          const acronym = m[2].trim();
          const normKey = acronym.toUpperCase();

          if (!seen.has(normKey) && GlossaryExtractor.matchesAcronym(acronym, phrase)) {
            seen.add(normKey);
            const entry = {
              term: acronym,
              definition: phrase,
              sentence: sentence,
              pattern: 'full_acronym'
            };
            this.glossary.set(normKey, entry);
            results.push(entry);
          }
        }

        // Pattern 2: ACRONYM (Full Name)
        // e.g. "ViT (Vision Transformer)"
        const p2Regex = /\b([A-Z][A-Za-z0-9\-]{1,12})\s*\(([A-Z][A-Za-z0-9\s\-]{2,45})\)/g;
        while ((m = p2Regex.exec(sentence)) !== null) {
          const acronym = m[1].trim();
          const phrase = m[2].trim();
          const normKey = acronym.toUpperCase();

          if (!seen.has(normKey) && GlossaryExtractor.matchesAcronym(acronym, phrase)) {
            seen.add(normKey);
            const entry = {
              term: acronym,
              definition: phrase,
              sentence: sentence,
              pattern: 'acronym_full'
            };
            this.glossary.set(normKey, entry);
            results.push(entry);
          }
        }

        // Pattern 3: Explicit Academic Definitions
        // e.g. "We define X as Y", "denote X as Y", "referred to as X"
        const p3Regex = /(?:we define|referred to as|stands for|short for|denoting)\s+([A-Za-z0-9\-_]{2,15})\s+(?:as|by)?\s*([^.,;\n]{6,60})/gi;
        while ((m = p3Regex.exec(sentence)) !== null) {
          const term = m[1].trim();
          const definition = m[2].trim();
          const normKey = term.toUpperCase();

          if (!seen.has(normKey) && term.length >= 2 && definition.length >= 5) {
            seen.add(normKey);
            const entry = {
              term: term,
              definition: definition,
              sentence: sentence,
              pattern: 'definition_clause'
            };
            this.glossary.set(normKey, entry);
            results.push(entry);
          }
        }
      }

      return results;
    }

    /**
     * Extract glossary from DOM tree
     */
    extractFromDOM(root = document.body) {
      if (!root) return [];
      const text = root.innerText || root.textContent || '';
      return this.extractFromText(text);
    }

    /**
     * Lookup a term in the extracted paper glossary
     */
    lookup(term) {
      if (!term) return null;
      const key = term.trim().toUpperCase();
      return this.glossary.get(key) || null;
    }

    /**
     * Get all terms as array
     */
    getAllTerms() {
      return Array.from(this.glossary.values());
    }
  }

  // Export to Global and CommonJS
  const exported = { GlossaryExtractor };

  if (typeof window !== 'undefined') {
    window.GlossaryExtractor = GlossaryExtractor;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.GlossaryExtractor = GlossaryExtractor;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
