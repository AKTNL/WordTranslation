/**
 * PaperDict glossary parsing, merging, lookup, and translation-token protection.
 */
(function (global) {
  'use strict';

  function normalizeSource(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeEntry(entry, defaultPriority = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const source = normalizeSource(entry.source);
    const target = String(entry.target || '').trim();
    if (!source || !target) return null;
    return {
      source,
      target,
      priority: Number.isFinite(entry.priority) ? entry.priority : defaultPriority,
      sourceType: entry.sourceType || 'user'
    };
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const input = String(text || '').replace(/^\uFEFF/, '');

    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (quoted) {
        if (char === '"' && input[index + 1] === '"') {
          field += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error('CSV 引号未闭合');
    if (field || row.length) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows;
  }

  function toPublicEntry(entry) {
    return { source: entry.source, target: entry.target };
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  class GlossaryService {
    constructor(entries = []) {
      this.setEntries(entries);
    }

    setEntries(entries) {
      const bySource = new Map();
      for (const rawEntry of Array.isArray(entries) ? entries : []) {
        const entry = normalizeEntry(rawEntry);
        if (!entry) continue;
        const previous = bySource.get(entry.source);
        if (!previous || entry.priority >= previous.priority) bySource.set(entry.source, entry);
      }
      this.entries = Array.from(bySource.values()).sort((a, b) =>
        b.source.length - a.source.length || b.priority - a.priority || a.source.localeCompare(b.source)
      );
      this.bySource = new Map(this.entries.map((entry) => [entry.source, entry]));
      this.matcher = this.entries.length
        ? new RegExp(`(^|[^A-Za-z0-9])(${this.entries.map((entry) => escapeRegExp(entry.source)).join('|')})(?=$|[^A-Za-z0-9])`, 'gi')
        : null;
    }

    lookup(text) {
      return this.bySource.get(normalizeSource(text)) || null;
    }

    protect(text) {
      const terms = [];
      if (!this.matcher || !text) return { text: String(text || ''), terms };
      this.matcher.lastIndex = 0;
      const protectedText = String(text).replace(this.matcher, (match, prefix, matchedTerm) => {
        const entry = this.lookup(matchedTerm);
        if (!entry) return match;
        const index = terms.length;
        terms.push({ source: entry.source, target: entry.target, token: `PDTERM_${index}` });
        return `${prefix}PDTERM_${index}`;
      });
      return { text: protectedText, terms };
    }

    restore(text, terms) {
      let restored = String(text || '');
      for (let index = 0; index < (terms || []).length; index++) {
        const entry = terms[index];
        const tokenPattern = new RegExp(`PD\\s*TERM\\s*[-_ ]?\\s*${index}(?!\\d)`, 'gi');
        restored = restored.replace(tokenPattern, () => entry.target);
      }
      return restored;
    }

    static parseCsv(text) {
      const rows = parseCsvRows(text);
      const entries = [];
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (!row.some((field) => String(field).trim())) continue;
        if (index === 0 && normalizeSource(row[0]) === 'source' && normalizeSource(row[1]) === 'target') continue;
        if (row.length < 2) throw new Error(`CSV 第 ${index + 1} 行缺少 target 列`);
        const entry = normalizeEntry({ source: row[0], target: row[1] });
        if (!entry) throw new Error(`CSV 第 ${index + 1} 行包含空术语或空译文`);
        entries.push(toPublicEntry(entry));
      }
      return entries;
    }

    static parseJson(text) {
      let data;
      try {
        data = JSON.parse(String(text || ''));
      } catch (error) {
        throw new Error(`JSON 格式错误: ${error.message}`);
      }
      if (!Array.isArray(data)) throw new Error('JSON 顶层必须是术语数组');
      return data.map((rawEntry, index) => {
        const entry = normalizeEntry(rawEntry);
        if (!entry) throw new Error(`JSON 第 ${index + 1} 条包含空术语或空译文`);
        return toPublicEntry(entry);
      });
    }

    static mergeEntries(existingEntries, incomingEntries) {
      const merged = new Map();
      for (const rawEntry of Array.isArray(existingEntries) ? existingEntries : []) {
        const entry = normalizeEntry(rawEntry);
        if (entry) merged.set(entry.source, toPublicEntry(entry));
      }

      const stats = { added: 0, updated: 0, ignored: 0 };
      for (const rawEntry of Array.isArray(incomingEntries) ? incomingEntries : []) {
        const entry = normalizeEntry(rawEntry);
        if (!entry) {
          stats.ignored++;
          continue;
        }
        const previous = merged.get(entry.source);
        if (!previous) {
          stats.added++;
        } else if (previous.target !== entry.target) {
          stats.updated++;
        } else {
          stats.ignored++;
          continue;
        }
        merged.set(entry.source, toPublicEntry(entry));
      }

      return {
        entries: Array.from(merged.values()).sort((a, b) => a.source.localeCompare(b.source)),
        stats
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GlossaryService, normalizeSource };
  } else {
    global.GlossaryService = GlossaryService;
  }
})(typeof window !== 'undefined' ? window : globalThis);
