/**
 * PaperDict - Annotation & Highlight Manager (Phase 2 P0)
 * Manages in-situ text highlighting, notes/annotations, persistence in chrome.storage.local,
 * fuzzy DOM re-anchoring, and Markdown / JSON export for Obsidian, Notion, etc.
 */

(function () {
  'use strict';

  const HIGHLIGHT_COLORS = {
    yellow: { key: 'yellow', bg: '#fef08a', border: '#facc15', label: '核心要点' },
    green:  { key: 'green',  bg: '#bbf7d0', border: '#4ade80', label: '创新方法' },
    blue:   { key: 'blue',   bg: '#bfdbfe', border: '#60a5fa', label: '重要结论' },
    pink:   { key: 'pink',   bg: '#fbcfe8', border: '#f472b6', label: '疑问难点' }
  };

  const STORAGE_KEY = 'paperdict_annotations';

  class AnnotationManager {
    constructor() {
      this.memoryStore = new Map(); // id -> annotation
      this.isLoaded = false;
    }

    /**
     * Compute a canonical document key from URL or title
     */
    static getDocKey(url = '', title = '') {
      if (!url && !title) return 'unknown_doc';
      const cleanUrl = String(url || '').trim();

      // Check arXiv
      const arxivMatch = cleanUrl.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]+\.[0-9]+(?:v[0-9]+)?)/i);
      if (arxivMatch) {
        return `arxiv:${arxivMatch[1]}`;
      }

      // Check local or web PDF
      if (cleanUrl.toLowerCase().endsWith('.pdf') || cleanUrl.includes('.pdf?')) {
        try {
          const u = new URL(cleanUrl);
          const fname = u.pathname.split('/').pop();
          return `pdf:${fname || 'paper.pdf'}`;
        } catch (e) {
          const fname = cleanUrl.split('/').pop().split('?')[0];
          return `pdf:${fname || 'paper.pdf'}`;
        }
      }

      // Check normal web URL: canonical origin + pathname
      try {
        const u = new URL(cleanUrl);
        return `${u.hostname}${u.pathname}`;
      } catch (e) {
        return cleanUrl.replace(/https?:\/\//i, '').split('#')[0].split('?')[0] || title || 'unknown_doc';
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
     * Export annotations to Markdown (compatible with Obsidian / Notion / Logseq)
     * Supports single-paper structured notes and multi-paper knowledge-base digests
     */
    static exportToMarkdown(annotations = [], docTitle = 'Paper Reading Notes', options = {}) {
      if ((!annotations || annotations.length === 0) && (!options.glossary || options.glossary.length === 0)) {
        return `# ${docTitle}\n\n*暂无批注与高亮记录*\n`;
      }

      const colorLabels = {
        yellow: '核心要点',
        green:  '创新方法',
        blue:   '重要结论',
        pink:   '疑问难点'
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toLocaleTimeString();

      // Check if annotations span multiple different documents
      const uniqueDocs = new Set((annotations || []).map(a => a.docKey || a.docTitle).filter(Boolean));
      const isMultiDoc = options.isMultiDoc || uniqueDocs.size > 1;

      if (isMultiDoc) {
        // Multi-Document Digest Export: group by document so papers are never jumbled!
        const groupMap = new Map();
        for (const item of (annotations || [])) {
          const key = item.docKey || item.docTitle || 'other';
          if (!groupMap.has(key)) {
            groupMap.set(key, {
              title: item.docTitle || '未命名文献',
              url: item.url || '',
              items: []
            });
          }
          groupMap.get(key).items.push(item);
        }

        let md = `---\n`;
        md += `title: "${docTitle.replace(/"/g, '\\"')}"\n`;
        md += `export_tool: PaperDict\n`;
        md += `date: ${dateStr}\n`;
        md += `total_papers: ${groupMap.size}\n`;
        md += `total_annotations: ${annotations.length}\n`;
        md += `tags:\n  - academic\n  - literature-notes\n`;
        md += `---\n\n`;

        md += `# 学术文献阅读与批注集锦\n\n`;
        md += `*导出工具: PaperDict 论文阅读助手 | 导出时间: ${dateStr} ${timeStr} | 共汇总 ${groupMap.size} 篇文献，${annotations.length} 条批注*\n\n`;
        md += `---\n\n`;

        let docIndex = 1;
        for (const grp of groupMap.values()) {
          md += `## ${docIndex++}. ${grp.title}\n\n`;
          if (grp.url) {
            md += `- **文献链接**: [${grp.url}](${grp.url})\n`;
          }
          md += `- **批注数量**: ${grp.items.length} 条\n\n`;

          grp.items.forEach((item, idx) => {
            const tag = colorLabels[item.color] || '要点';
            const itemDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : dateStr;
            md += `### ${idx + 1}. [${tag}] (${itemDate})\n`;
            md += `> ${item.text.replace(/\n+/g, ' ')}\n\n`;
            if (item.note) {
              md += `**思考批注:**\n${item.note}\n\n`;
            }
            if (item.pdfAnchor && item.pdfAnchor.pageNumber) {
              md += `*论文位置: 第 ${item.pdfAnchor.pageNumber} 页*\n\n`;
            }
            md += `---\n\n`;
          });
        }

        return md;
      }

      // Single Paper Comprehensive Reading Notes
      const paperUrl = options.url || (annotations[0] && annotations[0].url) || '';

      let md = `---\n`;
      md += `title: "${(docTitle || 'Paper Reading Notes').replace(/"/g, '\\"')}"\n`;
      if (paperUrl) md += `url: "${paperUrl}"\n`;
      md += `date: ${dateStr}\n`;
      md += `total_annotations: ${(annotations || []).length}\n`;
      md += `tags:\n  - paper-reading\n  - academic\n  - paperdict\n`;
      md += `---\n\n`;

      md += `# 学术论文阅读笔记: ${docTitle}\n\n`;
      if (paperUrl) {
        md += `- **文献链接**: [${paperUrl}](${paperUrl})\n`;
      }
      md += `*导出工具: PaperDict 论文阅读助手 | 导出时间: ${dateStr} ${timeStr}*\n\n`;
      md += `---\n\n`;

      if (annotations && annotations.length > 0) {
        md += `## 批注与高亮精选 (${annotations.length} 条)\n\n`;

        annotations.forEach((item, idx) => {
          const tag = colorLabels[item.color] || '高亮';
          const time = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : dateStr;
          md += `### ${idx + 1}. [${tag}] (${time})\n`;
          md += `> ${item.text.replace(/\n+/g, ' ')}\n\n`;

          if (item.note) {
            md += `**思考批注:**\n${item.note}\n\n`;
          }

          if (item.pdfAnchor && item.pdfAnchor.pageNumber) {
            md += `*论文位置: 第 ${item.pdfAnchor.pageNumber} 页*\n\n`;
          }

          md += `---\n\n`;
        });
      }

      // Paper-specific Glossary Table (if available)
      if (options.glossary && Array.isArray(options.glossary) && options.glossary.length > 0) {
        md += `## 本篇论文专有术语与缩写表 (Paper Glossary)\n\n`;
        md += `| 缩写 / 术语 | 英文全称 / 论文定义 | 出处例句 |\n`;
        md += `| :--- | :--- | :--- |\n`;
        options.glossary.forEach(g => {
          const t = g.term || '';
          const d = (g.definition || '').replace(/\|/g, '\\|');
          const s = (g.sentence || '').replace(/\n+/g, ' ').replace(/\|/g, '\\|');
          md += `| **${t}** | ${d} | ${s} |\n`;
        });
        md += `\n---\n\n`;
      }

      // Vocabulary Table (if available)
      if (options.vocabulary && Array.isArray(options.vocabulary) && options.vocabulary.length > 0) {
        md += `## 重点查词与生词记录 (Vocabulary)\n\n`;
        md += `| 单词 | 音标 | 释义 |\n`;
        md += `| :--- | :--- | :--- |\n`;
        options.vocabulary.forEach(v => {
          const w = v.word || '';
          const ph = v.phonetic ? `/${v.phonetic}/` : '-';
          const tr = (v.translation || '').replace(/\n+/g, '；').replace(/\|/g, '\\|');
          md += `| **${w}** | ${ph} | ${tr} |\n`;
        });
        md += `\n---\n\n`;
      }

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
        const date = item.date || item.createdAt ? new Date(item.date || item.createdAt).toLocaleDateString() : dateStr;
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
