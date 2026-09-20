/**
 * PaperDict - Dictionary Service & Text Preprocessing
 * Supports local offline lookup, smart lemmatization, irregular inflection resolution,
 * and academic paper text cleaning (PDF hyphen removal, multi-space collapse).
 */

(function (global) {
  'use strict';

  // Irregular English words mapping for academic and common vocabulary
  const IRREGULAR_WORDS = {
    // Plural forms in science & academic papers
    hypotheses: 'hypothesis',
    analyses: 'analysis',
    theses: 'thesis',
    syntheses: 'synthesis',
    parentheses: 'parenthesis',
    emphases: 'emphasis',
    diagnoses: 'diagnosis',
    crises: 'crisis',
    bases: 'basis',
    criteria: 'criterion',
    phenomena: 'phenomenon',
    data: 'datum',
    matrices: 'matrix',
    indices: 'index',
    appendices: 'appendix',
    vertices: 'vertex',
    vortices: 'vortex',
    stimuli: 'stimulus',
    nuclei: 'nucleus',
    fungi: 'fungus',
    radii: 'radius',
    foci: 'focus',
    alumni: 'alumnus',
    spectra: 'spectrum',
    strata: 'stratum',
    curricula: 'curriculum',
    media: 'medium',
    bacterium: 'bacteria',
    bacteria: 'bacterium',

    // Common irregular verbs & nouns
    children: 'child',
    oxen: 'ox',
    feet: 'foot',
    teeth: 'tooth',
    mice: 'mouse',
    geese: 'goose',
    men: 'man',
    women: 'woman',
    people: 'person',

    // Irregular verbs
    went: 'go',
    gone: 'go',
    saw: 'see',
    seen: 'see',
    wrote: 'write',
    written: 'write',
    chose: 'choose',
    chosen: 'choose',
    drew: 'draw',
    drawn: 'draw',
    flew: 'fly',
    flown: 'fly',
    knew: 'know',
    known: 'know',
    lay: 'lie',
    lain: 'lie',
    laid: 'lay',
    led: 'lead',
    meant: 'mean',
    met: 'meet',
    rose: 'rise',
    risen: 'rise',
    ran: 'run',
    shook: 'shake',
    shaken: 'shake',
    spoke: 'speak',
    spoken: 'speak',
    stood: 'stand',
    took: 'take',
    taken: 'take',
    thought: 'think',
    understood: 'understand',
    wore: 'wear',
    worn: 'wear',
    won: 'win',
    bound: 'bind',
    built: 'build',
    bought: 'buy',
    caught: 'catch',
    dealt: 'deal',
    felt: 'feel',
    found: 'find',
    held: 'hold',
    kept: 'keep',
    left: 'leave',
    lost: 'lose',
    sought: 'seek',
    sent: 'send',
    spent: 'spend',
    taught: 'teach',
    told: 'tell'
  };

  class DictService {
    constructor(dictData = null) {
      this.dict = dictData || (typeof ACADEMIC_DICT !== 'undefined' ? ACADEMIC_DICT : {});
    }

    setDict(dictData) {
      this.dict = dictData;
    }

    /**
     * Clean text selected from academic papers / PDFs:
     * 1. Merges cross-line hyphenated words (e.g. "hypo-\n thesis" -> "hypothesis")
     * 2. Cleans newlines, tabs, and multiple spaces
     * 3. Trims leading and trailing quotes / brackets / punctuation
     */
    cleanPaperText(text, deHyphen = true) {
      if (!text || typeof text !== 'string') return '';
      let cleaned = text;

      // Normalize typographic quotes and dashes
      cleaned = cleaned
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-');

      if (deHyphen) {
        // Match word ending with hyphen, followed by optional whitespace/newlines, followed by word
        cleaned = cleaned.replace(/([a-zA-Z]+)-\s*[\r\n]+\s*([a-zA-Z]+)/g, '$1$2');
      }

      // Replace line breaks and tabs with single space
      cleaned = cleaned.replace(/[\r\n\t]+/g, ' ');
      // Collapse multiple spaces
      cleaned = cleaned.replace(/\s+/g, ' ').trim();

      // Trim leading punctuation
      cleaned = cleaned.replace(/^[\s"'(\[{<«».,;:!?\-—–]+/, '');

      // Trailing punctuation: if short phrase (<= 4 words), strip trailing periods/commas/punctuation
      // If long sentence (>= 5 words ending with period), preserve the period!
      const words = cleaned.split(/\s+/);
      if (words.length <= 4) {
        cleaned = cleaned.replace(/[\s"')}\]>«».,;:!?\-—–]+$/, '');
      } else {
        cleaned = cleaned.replace(/[\s"')}\]>«»;:!?\-—–]+$/, '');
        cleaned = cleaned.replace(/,+$/, '');
      }

      return cleaned;
    }

    /**
     * Check if text should trigger popup:
     * Filter out pure numbers, code braces, single symbols, or empty text
     */
    isLookupEligible(text) {
      if (!text) return false;
      const t = text.trim();
      // Filter out empty, single character (variables like x, y), or excessively long selections
      if (t.length <= 1 || t.length > 500) return false;

      // Pure numbers or version/citation like [1], 2024, 3.14
      if (/^(\d+|\[\d+\]|\d+\.\d+[%]?)$/.test(t)) return false;

      // Pure symbols / code tokens
      if (/^[{}()\[\]<>+=/\\*&^%$#@!~`|;:'",.?_-]+$/.test(t)) return false;

      // Filter out dominant Chinese text (e.g. user selected a Chinese sentence with 1-2 English acronyms)
      const zhMatches = t.match(/[\u4e00-\u9fa5]/g);
      if (zhMatches && zhMatches.length >= 2) return false;

      // Filter out programming statements and code structures
      if (/\b(for|while|if|else|return|function|const|let|var|class|import|from|def)\s*[\(\{]/.test(t)) return false;
      if (/(?:=>|===|!==|\+\+|--|;\s*$)/.test(t)) return false;

      // Has at least one letter
      return /[a-zA-Z]/.test(t);
    }

    /**
     * Check if text is a single English word (optionally with hyphen or apostrophe)
     */
    isSingleWord(text) {
      if (!text) return false;
      const trimmed = text.trim();
      return /^[a-zA-Z]+([-'’][a-zA-Z]+)*'?$/.test(trimmed);
    }

    /**
     * Look up word in local dictionary with smart lemmatization
     * Returns: { found: boolean, query: string, baseWord: string, phonetic: string, translation: string, isInflected: boolean }
     */
    lookupLocal(word) {
      if (!word || !this.dict) return null;
      const raw = word.trim();
      const lower = raw.toLowerCase();

      // 1. Exact match
      if (this.dict[lower]) {
        return {
          found: true,
          query: raw,
          baseWord: lower,
          phonetic: this.dict[lower][0] || '',
          translation: this.dict[lower][1] || '',
          isInflected: false
        };
      }

      // 2. Irregular plural / past tense lookup
      if (IRREGULAR_WORDS[lower] && this.dict[IRREGULAR_WORDS[lower]]) {
        const base = IRREGULAR_WORDS[lower];
        return {
          found: true,
          query: raw,
          baseWord: base,
          phonetic: this.dict[base][0] || '',
          translation: this.dict[base][1] || '',
          isInflected: true
        };
      }

      // 3. Rule-based inflection reduction
      const candidates = this.generateCandidates(lower);
      for (const cand of candidates) {
        if (this.dict[cand]) {
          return {
            found: true,
            query: raw,
            baseWord: cand,
            phonetic: this.dict[cand][0] || '',
            translation: this.dict[cand][1] || '',
            isInflected: true
          };
        }
      }

      return {
        found: false,
        query: raw
      };
    }

    generateCandidates(w) {
      const list = [];
      const len = w.length;

      // Possessive 's / ’s (e.g. model's -> model, authors' -> author)
      if ((w.endsWith("'s") || w.endsWith("’s")) && len > 3) {
        const base = w.slice(0, -2);
        list.push(base);
        // Also reduce base further if plural, e.g. models' -> model
        if (base.endsWith('s') && !base.endsWith('ss') && base.length > 2) {
          list.push(base.slice(0, -1));
        }
      }
      if ((w.endsWith("s'") || w.endsWith("s’")) && len > 3) {
        list.push(w.slice(0, -1));
        list.push(w.slice(0, -2));
      }

      // -ies -> -y (e.g. categories -> category, variables -> variable)
      if (w.endsWith('ies') && len > 4) {
        list.push(w.slice(0, -3) + 'y');
        list.push(w.slice(0, -3) + 'ie');
      }

      // -ied -> -y (e.g. applied -> apply)
      if (w.endsWith('ied') && len > 4) {
        list.push(w.slice(0, -3) + 'y');
      }

      // -ing -> -e or stem, handle double consonants (e.g. formulating -> formulate, fitting -> fit)
      if (w.endsWith('ing') && len > 4) {
        list.push(w.slice(0, -3));
        list.push(w.slice(0, -3) + 'e');
        // Double consonant: running -> run, stopping -> stop
        if (len > 5 && w[len - 4] === w[len - 5]) {
          list.push(w.slice(0, -4));
        }
      }

      // -ed -> -e or stem (e.g. formulated -> formulate, fitted -> fit)
      if (w.endsWith('ed') && len > 3) {
        list.push(w.slice(0, -2));
        list.push(w.slice(0, -1));
        // Double consonant: fitted -> fit
        if (len > 4 && w[len - 3] === w[len - 4]) {
          list.push(w.slice(0, -3));
        }
      }

      // -es -> stem or -e (e.g. boxes -> box, processes -> process)
      if (w.endsWith('es') && len > 3) {
        list.push(w.slice(0, -2));
        list.push(w.slice(0, -1));
      }

      // -s (e.g. models -> model, algorithms -> algorithm)
      if (w.endsWith('s') && !w.endsWith('ss') && len > 2) {
        list.push(w.slice(0, -1));
      }

      // -ly -> stem or -le (e.g. significantly -> significant, subtly -> subtle)
      if (w.endsWith('ly') && len > 4) {
        list.push(w.slice(0, -2));
        list.push(w.slice(0, -2) + 'le');
      }

      // -er / -est (e.g. faster -> fast, simplest -> simple)
      if (w.endsWith('er') && len > 3) {
        list.push(w.slice(0, -2));
        list.push(w.slice(0, -1));
      }
      if (w.endsWith('est') && len > 4) {
        list.push(w.slice(0, -3));
        list.push(w.slice(0, -2));
      }

      return list;
    }

    /**
     * Formats translation definitions into structured items
     * e.g. "n. 假说；假设；vt. 提出假说" => [{ pos: 'n.', text: '假说；假设' }, { pos: 'vt.', text: '提出假说' }]
     */
    parseDefinitions(transText) {
      if (!transText) return [];
      const posList = ['prep', 'conj', 'pron', 'abbr', 'adj', 'adv', 'num', 'art', 'int', 'pl', 'vt', 'vi', 'ad', 'n', 'v', 'a'];
      const posPattern = '(?:' + posList.join('|') + ')\\.';
      const re = new RegExp('(?:^|[;；\\s])(' + posPattern + ')', 'g');
      
      const indices = [];
      let m;
      while ((m = re.exec(transText)) !== null) {
        const pos = m[1];
        const posStart = transText.indexOf(pos, m.index);
        indices.push({ pos, posStart, len: pos.length, delimiterIndex: m.index });
      }

      if (indices.length === 0) {
        return transText.trim() ? [{ pos: '释义', text: transText.trim() }] : [];
      }

      const result = [];
      if (indices[0].delimiterIndex > 0) {
        const lead = transText.slice(0, indices[0].delimiterIndex).replace(/^[;；\s]+|[;；\s]+$/g, '');
        if (lead) result.push({ pos: '释义', text: lead });
      }

      for (let i = 0; i < indices.length; i++) {
        const cur = indices[i];
        const start = cur.posStart + cur.len;
        const end = (i + 1 < indices.length) ? indices[i + 1].delimiterIndex : transText.length;
        const text = transText.slice(start, end).replace(/^[;；:\s]+|[;；:\s]+$/g, '');
        if (text) {
          result.push({ pos: cur.pos, text });
        }
      }

      return result.length > 0 ? result : [{ pos: '释义', text: transText.trim() }];
    }
  }

  // Export for browser and Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DictService, IRREGULAR_WORDS };
  } else {
    global.DictService = DictService;
    global.paperDictService = new DictService();
  }
})(typeof window !== 'undefined' ? window : globalThis);
