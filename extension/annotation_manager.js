/**
 * PaperDict - Annotation & Highlight Manager (Phase 2 P0)
 * Manages in-situ text highlighting, notes/annotations, persistence in chrome.storage.local,
 * fuzzy DOM re-anchoring, and Markdown / JSON export for Obsidian, Notion, etc.
 */

(function () {
  'use strict';

  // `bg` is a translucent fill so the highlighted text and any PDF glyphs behind
  // it stay readable; `solid` is the opaque swatch used by the card palette.
  const HIGHLIGHT_COLORS = {
    yellow: { key: 'yellow', bg: 'rgba(254, 240, 138, 0.45)', solid: '#fef08a', border: '#facc15', label: '核心要点' },
    green:  { key: 'green',  bg: 'rgba(187, 247, 208, 0.45)', solid: '#bbf7d0', border: '#4ade80', label: '创新方法' },
    blue:   { key: 'blue',   bg: 'rgba(191, 219, 254, 0.45)', solid: '#bfdbfe', border: '#60a5fa', label: '重要结论' },
    pink:   { key: 'pink',   bg: 'rgba(251, 207, 232, 0.45)', solid: '#fbcfe8', border: '#f472b6', label: '疑问难点' }
  };

  const STORAGE_KEY = 'paperdict_annotations';

  const COLOR_TAGS = {
    yellow: '核心要点',
    green: '创新方法',
    blue: '重要结论',
    pink: '疑问难点'
  };

  function isoDate(ts, fallback) {
    if (!ts) return fallback;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
  }

  function escapeFrontmatter(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escapeMdText(value) {
    return String(value == null ? '' : value).replace(/([\\`*_[\]<>])/g, '\\$1');
  }

  function collapseLines(value) {
    return String(value == null ? '' : value).replace(/\s*\n+\s*/g, ' ').trim();
  }

  function escapeTableCell(value) {
    return collapseLines(value).replace(/\|/g, '\\|');
  }

  function renderAnnotationItem(item, idx) {
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const tag = COLOR_TAGS[item.color] || '要点';
    const date = isoDate(item.createdAt, fallbackDate);
    let out = `### ${idx + 1}. [${tag}] (${date})\n`;
    out += `> ${escapeMdText(collapseLines(item.text))}\n\n`;
    if (item.note) out += `**思考批注:**\n${collapseLines(item.note)}\n\n`;
    if (item.pdfAnchor && item.pdfAnchor.pageNumber) {
      out += `*论文位置: 第 ${item.pdfAnchor.pageNumber} 页*\n\n`;
    }
    out += `---\n\n`;
    return out;
  }

  function renderGlossarySection(glossary) {
    if (!Array.isArray(glossary) || glossary.length === 0) return '';
    let out = `## 本篇论文专有术语与缩写表 (Paper Glossary)\n\n`;
    out += `| 缩写 / 术语 | 英文全称 / 论文定义 | 出处例句 |\n| :--- | :--- | :--- |\n`;
    for (const g of glossary) {
      out += `| **${escapeTableCell(g.term || '')}** | ${escapeTableCell(g.definition || '')} | ${escapeTableCell(g.sentence || '')} |\n`;
    }
    return out + `\n---\n\n`;
  }

  function renderVocabularySection(vocabulary) {
    if (!Array.isArray(vocabulary) || vocabulary.length === 0) return '';
    let out = `## 重点查词与生词记录 (Vocabulary)\n\n`;
    out += `| 单词 | 音标 | 释义 |\n| :--- | :--- | :--- |\n`;
    for (const v of vocabulary) {
      const ph = v.phonetic ? `/${escapeTableCell(v.phonetic)}/` : '-';
      out += `| **${escapeTableCell(v.word || '')}** | ${ph} | ${escapeTableCell(v.translation || '')} |\n`;
    }
    return out + `\n---\n\n`;
  }

  class AnnotationManager {
    constructor() {
      this.memoryStore = new Map(); // id -> annotation
      this.isLoaded = false;
    }

    /**
     * Compute a canonical document key from URL or title
     */
    static getDocKey(url = '', title = '') {
      const cleanUrl = String(url || '').trim();
      const cleanTitle = String(title || '').trim();

      // Reader pages are extension URLs shared by every PDF; identity must come
      // from the ?file= target (or the document title), never the extension URL.
      if (cleanUrl.startsWith('chrome-extension://') || /\/reader\/reader\.html(?:[?#]|$)/i.test(cleanUrl)) {
        let fileUrl = '';
        try {
          fileUrl = new URL(cleanUrl).searchParams.get('file') || '';
        } catch (e) {
          fileUrl = '';
        }
        if (fileUrl) return AnnotationManager.getDocKey(fileUrl, '');
        const strippedTitle = cleanTitle.replace(/\s*-\s*PaperDict\s*阅读器\s*$/i, '').trim();
        if (/\.pdf$/i.test(strippedTitle)) return `pdf:${strippedTitle}`;
        return `reader:${strippedTitle || 'untitled'}`;
      }

      // No URL at all: fall back to a PDF filename when the title looks like one.
      if (!cleanUrl) {
        if (/\.pdf$/i.test(cleanTitle)) return `pdf:${cleanTitle}`;
        return cleanTitle || 'unknown_doc';
      }

      // Check arXiv
      const arxivMatch = cleanUrl.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]+\.[0-9]+(?:v[0-9]+)?)/i);
      if (arxivMatch) {
        return `arxiv:${arxivMatch[1]}`;
      }

      // Check local or web PDF
      if (/\.pdf(?:$|[?#])/i.test(cleanUrl)) {
        try {
          const u = new URL(cleanUrl);
          const fname = u.pathname.split('/').pop();
          return `pdf:${fname || 'paper.pdf'}`;
        } catch (e) {
          const fname = cleanUrl.split('/').pop().split('?')[0];
          return `pdf:${fname || 'paper.pdf'}`;
        }
      }

      // Check normal web URL: canonical origin + pathname. When the pathname is
      // only an index page, the query string carries the document identity.
      try {
        const u = new URL(cleanUrl);
        const base = `${u.hostname}${u.pathname}`;
        const isIndexPath = /^\/(?:index\.(?:html?|php|aspx?))?$/i.test(u.pathname);
        if (isIndexPath && u.search.length > 1) {
          return `${base}${u.search}`;
        }
        return base;
      } catch (e) {
        return cleanUrl.replace(/https?:\/\//i, '').split('#')[0].split('?')[0] || cleanTitle || 'unknown_doc';
      }
    }

    /**
     * Load all annotations from chrome.storage.local into memory
     */
    async loadAll() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(STORAGE_KEY, (res) => {
            const list = res[STORAGE_KEY] || [];
            this.memoryStore.clear();
            for (const item of list) {
              if (item && item.id) {
                this.memoryStore.set(item.id, item);
              }
            }
            this.isLoaded = true;
            resolve(Array.from(this.memoryStore.values()));
          });
        });
      } else {
        this.isLoaded = true;
        return Array.from(this.memoryStore.values());
      }
    }

    /**
     * Sync memoryStore to chrome.storage.local
     */
    async persist() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const list = Array.from(this.memoryStore.values());
        return new Promise((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY]: list }, () => resolve(true));
        });
      }
      return true;
    }

    /**
     * Create or update an annotation
     */
    async saveAnnotation(data) {
      if (!this.isLoaded) await this.loadAll();

      const id = data.id || `anno_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const existing = this.memoryStore.get(id) || {};

      const annotation = {
        id,
        docKey: data.docKey || AnnotationManager.getDocKey(data.url, data.docTitle),
        docTitle: data.docTitle || document?.title || '未命名学术文献',
        url: data.url || (typeof window !== 'undefined' ? window.location?.href : ''),
        type: data.type || (data.note ? 'note' : 'highlight'),
        color: HIGHLIGHT_COLORS[data.color] ? data.color : 'yellow',
        text: (data.text || '').trim(),
        note: (data.note || '').trim(),
        createdAt: existing.createdAt || now,
        updatedAt: now,
        anchor: data.anchor || null,
        segments: Array.isArray(data.segments) ? data.segments : (existing.segments || null),
        pdfAnchor: data.pdfAnchor || null
      };

      this.memoryStore.set(id, annotation);
      await this.persist();
      return annotation;
    }

    /**
     * Delete an annotation by ID
     */
    async deleteAnnotation(id) {
      if (!this.isLoaded) await this.loadAll();
      const deleted = this.memoryStore.delete(id);
      if (deleted) {
        await this.persist();
      }
      return deleted;
    }

    /**
     * Get annotations for a specific document
     */
    async getAnnotationsForDoc(docKey) {
      if (!this.isLoaded) await this.loadAll();
      const results = [];
      for (const item of this.memoryStore.values()) {
        if (item.docKey === docKey) {
          results.push(item);
        }
      }
      return results.sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Get all annotations grouped by document
     */
    async getAllGroupedByDoc() {
      if (!this.isLoaded) await this.loadAll();
      const groupMap = new Map(); // docKey -> { docKey, docTitle, items: [] }

      for (const item of this.memoryStore.values()) {
        if (!groupMap.has(item.docKey)) {
          groupMap.set(item.docKey, {
            docKey: item.docKey,
            docTitle: item.docTitle || item.docKey,
            items: []
          });
        }
        groupMap.get(item.docKey).items.push(item);
      }

      for (const grp of groupMap.values()) {
        grp.items.sort((a, b) => a.createdAt - b.createdAt);
      }
      return Array.from(groupMap.values());
    }

    /**
     * Export annotations to Markdown (compatible with Obsidian / Notion / Logseq).
     * One unified schema for every entry point: identical frontmatter keys, item
     * format, escaping and ISO dates. Single-paper notes and multi-paper digests
     * differ only in the document heading level.
     */
    static exportToMarkdown(annotations = [], docTitle = 'Paper Reading Notes', options = {}) {
      const list = Array.isArray(annotations) ? annotations.slice() : [];
      const glossary = Array.isArray(options.glossary) ? options.glossary : [];
      const vocabulary = Array.isArray(options.vocabulary) ? options.vocabulary : [];

      if (list.length === 0 && glossary.length === 0 && vocabulary.length === 0) {
        return `# ${docTitle}\n\n*暂无批注与高亮记录*\n`;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 8);

      // Group by document. A single document collapses to one section.
      const groups = new Map();
      for (const item of list) {
        const key = item.docKey || item.docTitle || 'other';
        if (!groups.has(key)) {
          groups.set(key, { title: item.docTitle || '未命名文献', url: item.url || '', items: [] });
        }
        groups.get(key).items.push(item);
      }
      const sortedGroups = Array.from(groups.values()).sort(
        (a, b) => ((a.items[0] && a.items[0].createdAt) || 0) - ((b.items[0] && b.items[0].createdAt) || 0)
      );

      const isMultiDoc = options.isMultiDoc === true || sortedGroups.length > 1;
      const title = docTitle || 'Paper Reading Notes';
      const singleUrl = options.url || (sortedGroups[0] && sortedGroups[0].url) || '';

      // Shared YAML frontmatter for both shapes.
      let md = `---\n`;
      md += `title: "${escapeFrontmatter(title)}"\n`;
      if (!isMultiDoc && singleUrl) md += `url: "${escapeFrontmatter(singleUrl)}"\n`;
      md += `export_tool: PaperDict\n`;
      md += `date: ${dateStr}\n`;
      md += `total_papers: ${isMultiDoc ? sortedGroups.length : 1}\n`;
      md += `total_annotations: ${list.length}\n`;
      md += `tags:\n  - paper-reading\n  - academic\n  - paperdict\n`;
      md += `---\n\n`;

      if (isMultiDoc) {
        md += `# 学术文献阅读与批注集锦\n\n`;
        md += `*导出工具: PaperDict 论文阅读助手 | 导出时间: ${dateStr} ${timeStr} | 共汇总 ${sortedGroups.length} 篇文献，${list.length} 条批注*\n\n`;
        md += `---\n\n`;

        let docIndex = 1;
        for (const grp of sortedGroups) {
          md += `## ${docIndex++}. ${escapeMdText(grp.title)}\n\n`;
          if (grp.url) md += `- **文献链接**: [${escapeMdText(grp.url)}](${grp.url})\n`;
          md += `- **批注数量**: ${grp.items.length} 条\n\n`;
          grp.items.forEach((item, idx) => {
            md += renderAnnotationItem(item, idx);
          });
        }
      } else {
        md += `# 学术论文阅读笔记: ${escapeMdText(title)}\n\n`;
        if (singleUrl) md += `- **文献链接**: [${escapeMdText(singleUrl)}](${singleUrl})\n`;
        md += `*导出工具: PaperDict 论文阅读助手 | 导出时间: ${dateStr} ${timeStr}*\n\n`;
        md += `---\n\n`;

        const items = sortedGroups[0] ? sortedGroups[0].items : [];
        if (items.length > 0) {
          md += `## 批注与高亮精选 (${items.length} 条)\n\n`;
          items.forEach((item, idx) => {
            md += renderAnnotationItem(item, idx);
          });
        }
      }

      md += renderGlossarySection(glossary);
      md += renderVocabularySection(vocabulary);
      return md;
    }

    /**
     * Export vocabulary notebook to Markdown Table (compatible with Obsidian / Notion)
     */
    static exportWordBookToMarkdown(wordBook = []) {
      if (!wordBook || wordBook.length === 0) {
        return `# PaperDict 学术生词本\n\n*暂无生词记录*\n`;
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      let md = `---\n`;
      md += `title: PaperDict 学术生词本\n`;
      md += `date: ${dateStr}\n`;
      md += `total_words: ${wordBook.length}\n`;
      md += `tags:\n  - vocabulary\n  - academic-english\n  - paperdict\n`;
      md += `---\n\n`;

      md += `# PaperDict 学术生词本 (共 ${wordBook.length} 词)\n\n`;
      md += `| 序号 | 单词 | 音标 | 词性与中文释义 | 收藏时间 |\n`;
      md += `| :---: | :--- | :--- | :--- | :--- |\n`;
      wordBook.forEach((item, idx) => {
        const w = item.word || '';
        const ph = item.phonetic ? `/${item.phonetic}/` : '-';
        const trans = (item.translation || '').replace(/\n+/g, '；').replace(/\|/g, '\\|');
        const date = isoDate(item.date || item.createdAt, dateStr);
        md += `| ${idx + 1} | **${w}** | ${ph} | ${trans} | ${date} |\n`;
      });
      return md;
    }

    /**
     * Export annotations to JSON string
     */
    static exportToJson(annotations = []) {
      return JSON.stringify(annotations, null, 2);
    }
  }

  // Export to Global and CommonJS
  const exported = {
    AnnotationManager,
    HIGHLIGHT_COLORS,
    STORAGE_KEY
  };

  if (typeof window !== 'undefined') {
    window.AnnotationManager = AnnotationManager;
    window.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.AnnotationManager = AnnotationManager;
    globalThis.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})();
