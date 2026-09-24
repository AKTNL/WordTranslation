/**
 * PaperDict - Academic PDF Reader Controller
 * High-performance PDF reader with on-demand viewport lazy rendering,
 * two-column academic paper paragraph extraction, smooth zoom with reading position preservation,
 * and seamless Shadow DOM selection translation.
 */

(function () {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  }

  // DOM Elements
  const fileInput = document.getElementById('file-input');
  const docTitle = document.getElementById('doc-title');
  const welcomeDropzone = document.getElementById('welcome-dropzone');
  const dropzoneBox = document.getElementById('dropzone-box');
  const viewerContainer = document.getElementById('viewer-container');
  const pdfViewer = document.getElementById('pdf-viewer');

  const pageControls = document.getElementById('page-controls');
  const zoomControls = document.getElementById('zoom-controls');
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');
  const pageNumInput = document.getElementById('page-num');
  const pageCountSpan = document.getElementById('page-count');

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnFitWidth = document.getElementById('btn-fit-width');
  const zoomValueSpan = document.getElementById('zoom-value');

  // Bilingual Controls
  const bilingualControls = document.getElementById('bilingual-controls');
  const btnModeOrig = document.getElementById('btn-reader-mode-orig');
  const btnModeBi = document.getElementById('btn-reader-mode-bi');
  const btnModeZh = document.getElementById('btn-reader-mode-zh');
  const readerBilingualStatus = document.getElementById('reader-bilingual-status');

  const formulaProtector = typeof FormulaProtector !== 'undefined' ? new FormulaProtector() : null;
  const dictService = typeof DictService !== 'undefined' ? new DictService() : null;
  const annotationManager = typeof AnnotationManager !== 'undefined' ? new AnnotationManager() : null;
  const citationParser = typeof CitationParser !== 'undefined' ? new CitationParser() : null;

  // Reader Notes Elements
  const btnReaderNotes = document.getElementById('btn-reader-notes');
  const readerNotesCount = document.getElementById('reader-notes-count');
  const readerNotesDrawer = document.getElementById('reader-notes-drawer');
  const btnCloseNotesDrawer = document.getElementById('btn-close-notes-drawer');
  const btnDrawerExportMd = document.getElementById('btn-drawer-export-md');
  const drawerNotesList = document.getElementById('drawer-notes-list');

  async function updateReaderNotes() {
    if (!annotationManager) return;
    const docKey = AnnotationManager.getDocKey(window.location.href, docTitle.textContent);
    const notes = await annotationManager.getAnnotationsForDoc(docKey);
    if (readerNotesCount) readerNotesCount.textContent = notes.length;

    if (!drawerNotesList) return;
    if (notes.length === 0) {
      drawerNotesList.innerHTML = '<div class="empty-drawer-hint" style="color:#94a3b8;font-size:12px;text-align:center;padding-top:30px;">暂无论文批注，划选文字后点击高亮或输入笔记即可创建！</div>';
      return;
    }

    const colorLabels = {
      yellow: '[核心]',
      green:  '[方法]',
      blue:   '[结论]',
      pink:   '[疑问]'
    };

    drawerNotesList.innerHTML = notes.map((item) => `
      <div class="drawer-note-item">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">${colorLabels[item.color] || '[要点]'} ${new Date(item.createdAt).toLocaleDateString()}</div>
        <div class="drawer-note-text">“${escapeHtml(item.text)}”</div>
        ${item.note ? `<div class="drawer-note-comment">批注: ${escapeHtml(item.note)}</div>` : ''}
      </div>
    `).join('');
  }

  if (btnReaderNotes && readerNotesDrawer) {
    btnReaderNotes.addEventListener('click', () => {
      const isHidden = readerNotesDrawer.style.display === 'none';
      readerNotesDrawer.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) updateReaderNotes();
    });
  }

  if (btnCloseNotesDrawer && readerNotesDrawer) {
    btnCloseNotesDrawer.addEventListener('click', () => {
      readerNotesDrawer.style.display = 'none';
    });
  }

  if (btnDrawerExportMd) {
    btnDrawerExportMd.addEventListener('click', async () => {
      if (!annotationManager) return;
      const docKey = AnnotationManager.getDocKey(window.location.href, docTitle.textContent);
      const notes = await annotationManager.getAnnotationsForDoc(docKey);
      const terms = glossaryExtractor ? glossaryExtractor.getAllTerms() : [];
      if (notes.length === 0 && terms.length === 0) return alert('本篇论文暂无可导出的批注或专有术语');
      const md = AnnotationManager.exportToMarkdown(notes, docTitle.textContent || 'PDF 论文笔记', {
        url: window.location.href,
        glossary: terms
      });
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docTitle.textContent || 'paper'}_notes.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Reader Glossary Elements
  const glossaryExtractor = typeof GlossaryExtractor !== 'undefined' ? new GlossaryExtractor() : null;
  const btnReaderGlossary = document.getElementById('btn-reader-glossary');
  const readerGlossaryCount = document.getElementById('reader-glossary-count');
  const readerGlossaryDrawer = document.getElementById('reader-glossary-drawer');
  const btnCloseGlossaryDrawer = document.getElementById('btn-close-glossary-drawer');
  const drawerGlossaryList = document.getElementById('drawer-glossary-list');

  function updateReaderGlossary() {
    if (!glossaryExtractor) return;
    const terms = glossaryExtractor.getAllTerms();
    if (readerGlossaryCount) readerGlossaryCount.textContent = terms.length;

    if (!drawerGlossaryList) return;
    if (terms.length === 0) {
      drawerGlossaryList.innerHTML = '<div class="empty-drawer-hint" style="color:#94a3b8;font-size:12px;text-align:center;padding-top:30px;">暂未在本篇论文中检测到显式定义的专有缩写与术语</div>';
      return;
    }

    drawerGlossaryList.innerHTML = terms.map((item) => `
      <div class="drawer-note-item" style="border-left:3px solid #f59e0b;">
        <div style="font-size:13px;font-weight:700;color:#fbbf24;margin-bottom:2px;">${escapeHtml(item.term)}</div>
        <div style="font-size:12.5px;color:#f8fafc;margin-bottom:4px;">${escapeHtml(item.definition)}</div>
        <div style="font-size:11px;color:#94a3b8;background:#1e293b;padding:4px 6px;border-radius:4px;line-height:1.4;">
          “${escapeHtml(item.sentence)}”
        </div>
      </div>
    `).join('');
  }

  if (btnReaderGlossary && readerGlossaryDrawer) {
    btnReaderGlossary.addEventListener('click', () => {
      const isHidden = readerGlossaryDrawer.style.display === 'none';
      if (readerNotesDrawer) readerNotesDrawer.style.display = 'none';
      readerGlossaryDrawer.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) updateReaderGlossary();
    });
  }

  if (btnCloseGlossaryDrawer && readerGlossaryDrawer) {
    btnCloseGlossaryDrawer.addEventListener('click', () => {
      readerGlossaryDrawer.style.display = 'none';
    });
  }

  let currentPdfDoc = null;
  let currentScale = 1.35;
  let totalPages = 0;
  let currentPage = 1;
  let currentBilingualMode = 'original'; // 'original' | 'bilingual' | 'chinese'
  const pageParagraphsMap = new Map(); // pageNumber -> [{ orig, trans, pDiv, transDiv }]
  const renderedPagesSet = new Set(); // pageNumber set
  let pageLazyObserver = null;
  let bilingualObserver = null;

  // File loading
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
        loadPdfFile(file);
      }
    });
  }

  // Drag and drop handlers
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    const box = document.getElementById('dropzone-box');
    if (box) box.classList.add('drag-over');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.target === document.body || e.target === welcomeDropzone) {
      const box = document.getElementById('dropzone-box');
      if (box) box.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const box = document.getElementById('dropzone-box');
    if (box) box.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        loadPdfFile(file);
      }
    }
  });

  function loadPdfFile(file) {
    docTitle.textContent = file.name;
    document.title = `${file.name} - PaperDict 阅读器`;

    const reader = new FileReader();
    reader.onload = function (ev) {
      const typedArray = new Uint8Array(ev.target.result);
      renderPdf(typedArray);
    };
    reader.readAsArrayBuffer(file);
  }

  // Load PDF from URL
  async function loadPdfFromUrl(url) {
    if (!url) return;
    try {
      const decodedUrl = decodeURIComponent(url);
      let fileName = decodedUrl.split('/').pop().split('?')[0].split('#')[0] || 'paper.pdf';
      if (!fileName.toLowerCase().endsWith('.pdf')) {
        fileName += '.pdf';
      }
      docTitle.textContent = fileName;
      document.title = `${fileName} - PaperDict 阅读器`;

      welcomeDropzone.style.display = 'flex';
      viewerContainer.style.display = 'none';

      welcomeDropzone.innerHTML = `
        <div class="dropzone-box" id="dropzone-box">
          <div class="loading-spinner"></div>
          <h2 style="margin-top: 16px; font-size: 18px;">正在加载论文 PDF...</h2>
          <p style="color: #2563eb; word-break: break-all; margin-top: 8px; font-size: 13px;">${escapeHtml(fileName)}</p>
        </div>
      `;

      const response = await fetch(decodedUrl);
      if (!response.ok) {
        throw new Error(`无法获取 PDF (HTTP ${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const typedArray = new Uint8Array(arrayBuffer);
      await renderPdf(typedArray);
    } catch (err) {
      console.warn('Direct fetch failed, showing fallback UI:', err);
      showDropzoneFallback(url, err.message);
    }
  }

  function showDropzoneFallback(url, errMsg) {
    const decodedUrl = decodeURIComponent(url || '');
    let fileName = decodedUrl.split('/').pop().split('?')[0].split('#')[0] || '文档.pdf';
    welcomeDropzone.style.display = 'flex';
    viewerContainer.style.display = 'none';

    welcomeDropzone.innerHTML = `
      <div class="dropzone-box" id="dropzone-box">
        <div class="dropzone-icon">📄</div>
        <h2>打开本地论文 PDF</h2>
        <p style="color: #64748b; margin-bottom: 12px; font-size: 14px;">
          检测到您正在打开本地文件：<br><b style="color: #0f172a;">${escapeHtml(fileName)}</b>
        </p>
        <p style="color: #2563eb; font-size: 13px; background: #eff6ff; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; line-height: 1.6;">
          受浏览器本地安全策略限制，请<b>将该 PDF 直接拖入此窗口</b>，或点击下方按钮手动选择该文件，即可开启无限制划词翻译！
        </p>
        <label class="btn-file-open" style="padding: 8px 22px; font-size: 14px; cursor: pointer;">
          📁 选择 ${escapeHtml(fileName)}
          <input type="file" id="fallback-file-input" accept="application/pdf">
        </label>
      </div>
    `;

    const fallbackInput = document.getElementById('fallback-file-input');
    if (fallbackInput) {
      fallbackInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadPdfFile(file);
      });
    }
  }

  // Render PDF with On-Demand Viewport Virtualization
  async function renderPdf(data) {
    try {
      welcomeDropzone.style.display = 'none';
      viewerContainer.style.display = 'flex';
      pageControls.style.display = 'inline-flex';
      zoomControls.style.display = 'inline-flex';
      if (bilingualControls) bilingualControls.style.display = 'inline-flex';

      pdfViewer.innerHTML = '';
      pageParagraphsMap.clear();
      renderedPagesSet.clear();

      const loadingTask = pdfjsLib.getDocument({ data });
      currentPdfDoc = await loadingTask.promise;
      totalPages = currentPdfDoc.numPages;
      pageCountSpan.textContent = totalPages;
      pageNumInput.max = totalPages;

      updateZoomDisplay();

      // Estimate initial dimensions from Page 1
      const samplePage = await currentPdfDoc.getPage(1);
      const sampleViewport = samplePage.getViewport({ scale: currentScale });
      const estWidth = Math.floor(sampleViewport.width);
      const estHeight = Math.floor(sampleViewport.height);

      // Create on-demand page placeholders
      for (let i = 1; i <= totalPages; i++) {
        createPagePlaceholder(i, estWidth, estHeight);
      }

      // Setup lazy page rendering observer
      setupPageLazyObserver();

      // Setup bilingual translation observer
      setupBilingualObserver();

      // Immediately render first visible pages
      await renderPage(1);
      if (totalPages >= 2) renderPage(2);
    } catch (err) {
      console.error('Failed to load PDF:', err);
      alert('加载 PDF 失败: ' + err.message);
    }
  }

  function createPagePlaceholder(pageNumber, width, height) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'pdf-page-row';
    rowDiv.id = `pdf-row-${pageNumber}`;
    rowDiv.dataset.pageNumber = pageNumber;

    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.id = `pdf-page-${pageNumber}`;
    pageDiv.dataset.pageNumber = pageNumber;
    pageDiv.style.width = `${width}px`;
    pageDiv.style.height = `${height}px`;

    // Canvas placeholder
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    pageDiv.appendChild(canvas);

    // Text layer placeholder
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = `${width}px`;
    textLayerDiv.style.height = `${height}px`;
    pageDiv.appendChild(textLayerDiv);

    rowDiv.appendChild(pageDiv);

    // Bilingual side panel
    const bilingualPanel = document.createElement('div');
    bilingualPanel.className = `pdf-page-bilingual ${currentBilingualMode === 'chinese' ? 'full-chinese' : ''}`;
    bilingualPanel.id = `pdf-bilingual-${pageNumber}`;
    bilingualPanel.style.display = currentBilingualMode === 'original' ? 'none' : 'block';
    bilingualPanel.style.minHeight = `${height}px`;
    rowDiv.appendChild(bilingualPanel);

    pdfViewer.appendChild(rowDiv);
  }

  function setupPageLazyObserver() {
    if (pageLazyObserver) pageLazyObserver.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;

    pageLazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (pNum && !renderedPagesSet.has(pNum)) {
            renderPage(pNum);
          }
        }
      }
    }, {
      root: viewerContainer,
      rootMargin: '500px 0px 500px 0px',
      threshold: 0.01
    });

    const rows = document.querySelectorAll('.pdf-page-row');
    rows.forEach(r => pageLazyObserver.observe(r));
  }

  async function renderPage(pageNumber) {
    if (!currentPdfDoc || pageNumber < 1 || pageNumber > totalPages) return;
    renderedPagesSet.add(pageNumber);

    const page = await currentPdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: currentScale });

    const pageDiv = document.getElementById(`pdf-page-${pageNumber}`);
    const rowDiv = document.getElementById(`pdf-row-${pageNumber}`);
    const bilingualPanel = document.getElementById(`pdf-bilingual-${pageNumber}`);
    if (!pageDiv || !rowDiv) return;

    pageDiv.style.width = `${Math.floor(viewport.width)}px`;
    pageDiv.style.height = `${Math.floor(viewport.height)}px`;
    if (bilingualPanel) {
      bilingualPanel.style.minHeight = `${Math.floor(viewport.height)}px`;
    }

    const canvas = pageDiv.querySelector('canvas') || document.createElement('canvas');
    const context = canvas.getContext('2d');
    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

    const renderContext = {
      canvasContext: context,
      transform: transform,
      viewport: viewport
    };

    if (!canvas.parentElement) pageDiv.appendChild(canvas);

    // Text layer
    let textLayerDiv = pageDiv.querySelector('.textLayer');
    if (!textLayerDiv) {
      textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      pageDiv.appendChild(textLayerDiv);
    }
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
    textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
    textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

    // Render canvas
    await page.render(renderContext).promise;

    // Render text layer
    const textContent = await page.getTextContent();
    if (textContent && textContent.items) {
      const pageText = textContent.items.map(i => i.str).join(' ');
      if (glossaryExtractor) {
        glossaryExtractor.extractFromText(pageText);
        if (dictService) {
          dictService.setPaperGlossary(glossaryExtractor);
        }
        if (readerGlossaryCount) {
          readerGlossaryCount.textContent = glossaryExtractor.getAllTerms().length;
        }
      }
      if (citationParser) {
        citationParser.extractFromText(pageText);
      }
    }
    pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: []
    });

    // Extract & cluster paragraphs for bilingual rendering
    if (bilingualPanel && !pageParagraphsMap.has(pageNumber)) {
      setupPageBilingualContent(pageNumber, textContent, bilingualPanel);
    }
  }

  function setupPageBilingualContent(pageNumber, textContent, panel) {
    const paras = clusterPdfTextIntoParagraphs(textContent);
    const paraItems = [];
    panel.innerHTML = '';

    if (paras.length === 0) {
      panel.innerHTML = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding-top:40px;">（此页面未检测到可提取的连续学术正文段落）</p>';
      pageParagraphsMap.set(pageNumber, []);
      return;
    }

    paras.forEach((pText) => {
      const pDiv = document.createElement('div');
      pDiv.className = 'pdf-bilingual-p';

      const origDiv = document.createElement('div');
      origDiv.className = 'pdf-p-orig';
      origDiv.textContent = pText;

      const transDiv = document.createElement('div');
      transDiv.className = 'pdf-p-trans';
      transDiv.innerHTML = '<span style="color:#94a3b8;font-size:12px;">待视口加载...</span>';

      pDiv.appendChild(origDiv);
      pDiv.appendChild(transDiv);
      panel.appendChild(pDiv);

      paraItems.push({
        orig: pText,
        trans: null,
        status: 'idle',
        pDiv,
        transDiv
      });
    });

    pageParagraphsMap.set(pageNumber, paraItems);

    if (currentBilingualMode !== 'original' && pageNumber === currentPage) {
      translatePageParagraphs(pageNumber);
    }
  }

  // Academic Two-Column & Multi-Column Aware Paragraph Clustering
  function clusterPdfTextIntoParagraphs(textContent) {
    if (!textContent || !textContent.items || textContent.items.length === 0) {
      return [];
    }

    const rawItems = textContent.items.filter(item => item.str && item.str.trim().length > 0);
    if (rawItems.length === 0) return [];

    // Analyze X coordinates for column separation
    const xs = rawItems.map(it => (it.transform ? it.transform[4] : 0));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const midX = (minX + maxX) / 2;

    const leftCol = [];
    const rightCol = [];
    const fullSpan = [];

    for (const item of rawItems) {
      const x = item.transform ? item.transform[4] : 0;
      const strLen = item.str ? item.str.length : 0;
      const width = item.width || (strLen * 6.5);

      if (x < midX - 25 && (x + width) < midX + 25) {
        leftCol.push(item);
      } else if (x > midX - 10) {
        rightCol.push(item);
      } else {
        fullSpan.push(item);
      }
    }

    // Determine if page has two distinct columns
    const isTwoColumn = leftCol.length > 20 && rightCol.length > 20;

    if (isTwoColumn) {
      const fullParas = clusterItemsToParagraphs(fullSpan);
      const leftParas = clusterItemsToParagraphs(leftCol);
      const rightParas = clusterItemsToParagraphs(rightCol);
      return [...fullParas, ...leftParas, ...rightParas];
    }

    return clusterItemsToParagraphs(rawItems);
  }

  function isDifferentLine(y1, y2, tolerance = 3.5) {
    return y1 === null || Math.abs(y1 - y2) > tolerance;
  }

  function clusterItemsToParagraphs(items) {
    if (!items || items.length === 0) return [];

    // Sort items by Y (top to bottom), then X (left to right)
    const sorted = [...items].sort((a, b) => {
      const ya = a.transform ? a.transform[5] : 0;
      const yb = b.transform ? b.transform[5] : 0;
      if (Math.abs(ya - yb) <= 3) {
        const xa = a.transform ? a.transform[4] : 0;
        const xb = b.transform ? b.transform[4] : 0;
        return xa - xb;
      }
      return yb - ya; // Higher Y is earlier in PDF coordinates
    });

    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of sorted) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (isDifferentLine(currentY, y)) {
        if (currentLine.length > 0) {
          lines.push({ y: currentY, text: currentLine.map(i => i.str).join(' ').trim() });
        }
        currentLine = [item];
        currentY = y;
      } else {
        currentLine.push(item);
      }
    }
    if (currentLine.length > 0) {
      lines.push({ y: currentY, text: currentLine.map(i => i.str).join(' ').trim() });
    }

    const paragraphs = [];
    let currentPara = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : null;

      if (prevLine) {
        const lineGap = Math.abs(prevLine.y - line.y);
        const isLargeGap = lineGap > 22;
        const prevEndsWithPeriod = /[.!?:]$/.test(prevLine.text.trim());

        if (isLargeGap || (prevEndsWithPeriod && /^[A-Z0-9]/.test(line.text.trim()) && currentPara.join(' ').length > 80)) {
          if (currentPara.length > 0) {
            const raw = currentPara.join('\n');
            const cleaned = dictService ? dictService.cleanPaperText(raw, true) : raw;
            if (cleaned.length >= 15 && dictService && dictService.isEnglishSourceText(cleaned)) {
              paragraphs.push(cleaned);
            }
          }
          currentPara = [line.text];
          continue;
        }
      }
      currentPara.push(line.text);
    }

    if (currentPara.length > 0) {
      const raw = currentPara.join('\n');
      const cleaned = dictService ? dictService.cleanPaperText(raw, true) : raw;
      if (cleaned.length >= 15 && dictService && dictService.isEnglishSourceText(cleaned)) {
        paragraphs.push(cleaned);
      }
    }

    return paragraphs;
  }

  async function translatePageParagraphs(pageNumber) {
    const items = pageParagraphsMap.get(pageNumber);
    if (!items || items.length === 0) return;

    if (readerBilingualStatus) {
      readerBilingualStatus.textContent = `第 ${pageNumber} 页翻译中...`;
      readerBilingualStatus.style.color = '#60a5fa';
    }

    for (const item of items) {
      if (item.status === 'done') continue;
      item.status = 'translating';
      item.transDiv.innerHTML = '<div class="pdf-p-loading">正在速译学术段落...</div>';

      let textToTranslate = item.orig;
      let tokenMap = null;

      if (formulaProtector) {
        const pRes = formulaProtector.protect(item.orig);
        textToTranslate = pRes.protectedText;
        tokenMap = pRes.tokenMap;
      }

      const reqId = `reader_p${pageNumber}_${i}_${Date.now()}`;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_ONLINE',
          text: textToTranslate,
          requestId: reqId
        });

        if (res && res.success && res.translation) {
          let finalText = res.translation;
          if (formulaProtector && tokenMap) {
            finalText = formulaProtector.restore(res.translation, tokenMap);
          }
          item.trans = finalText;
          item.transDiv.innerHTML = finalText;
          item.status = 'done';
        } else {
          const errorMessage = escapeHtml(res?.error || '翻译失败，请稍后重试');
          item.transDiv.innerHTML = `
            <span style="color:#f87171;font-size:12px;">(${errorMessage})</span>
            <button class="pdf-btn-retry" style="margin-left:6px;padding:1px 5px;font-size:11px;background:#334155;border:1px solid #475569;border-radius:3px;color:#93c5fd;cursor:pointer;">重试</button>
          `;
          const btnR = item.transDiv.querySelector('.pdf-btn-retry');
          if (btnR) {
            btnR.onclick = () => {
              item.status = 'idle';
              translatePageParagraphs(pageNumber);
            };
          }
          item.status = 'idle';
        }
      } catch (e) {
        item.transDiv.innerHTML = `<span style="color:#f87171;font-size:12px;">(网络超时)</span>`;
        item.status = 'idle';
      }
    }

    if (readerBilingualStatus) {
      readerBilingualStatus.textContent = `就绪`;
      readerBilingualStatus.style.color = '#94a3b8';
    }
  }

  function setReaderBilingualMode(mode) {
    currentBilingualMode = mode;

    if (btnModeOrig) btnModeOrig.classList.toggle('active', mode === 'original');
    if (btnModeBi) btnModeBi.classList.toggle('active', mode === 'bilingual');
    if (btnModeZh) btnModeZh.classList.toggle('active', mode === 'chinese');

    if (readerBilingualStatus) {
      if (mode === 'bilingual') {
        readerBilingualStatus.textContent = '双语对照已开启';
        readerBilingualStatus.style.color = '#60a5fa';
      } else if (mode === 'chinese') {
        readerBilingualStatus.textContent = '纯中文速读已开启';
        readerBilingualStatus.style.color = '#4ade80';
      } else {
        readerBilingualStatus.textContent = '原版英文排版';
        readerBilingualStatus.style.color = '#94a3b8';
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'CANCEL_ALL_TRANSLATIONS', prefix: 'reader_' }).catch(() => {});
        }
      }
    }

    const panels = document.querySelectorAll('.pdf-page-bilingual');
    panels.forEach((p) => {
      if (mode === 'original') {
        p.style.display = 'none';
      } else {
        p.style.display = 'block';
        p.classList.toggle('full-chinese', mode === 'chinese');
      }
    });

    if (mode !== 'original') {
      translatePageParagraphs(currentPage);
    }
  }

  function setupBilingualObserver() {
    if (bilingualObserver) bilingualObserver.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;

    bilingualObserver = new IntersectionObserver((entries) => {
      if (currentBilingualMode === 'original') return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNum) {
            translatePageParagraphs(pageNum);
          }
        }
      }
    }, {
      root: viewerContainer,
      rootMargin: '200px 0px 200px 0px',
      threshold: 0.05
    });

    const rows = document.querySelectorAll('.pdf-page-row');
    rows.forEach(r => bilingualObserver.observe(r));
  }

  // Bind Mode Buttons
  if (btnModeOrig) btnModeOrig.addEventListener('click', () => setReaderBilingualMode('original'));
  if (btnModeBi) btnModeBi.addEventListener('click', () => setReaderBilingualMode('bilingual'));
  if (btnModeZh) btnModeZh.addEventListener('click', () => setReaderBilingualMode('chinese'));

  // Alt + B Shortcut in Reader
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'b' || e.key === 'B' || e.code === 'KeyB')) {
      e.preventDefault();
      const modeCycle = {
        original: 'bilingual',
        bilingual: 'chinese',
        chinese: 'original'
      };
      setReaderBilingualMode(modeCycle[currentBilingualMode] || 'bilingual');
    }
  }, true);

  function updateZoomDisplay() {
    zoomValueSpan.textContent = `${Math.round(currentScale * 100)}%`;
  }

  // Smooth Zoom with Reading Position Preservation (Never clear DOM)
  async function applyZoomWithPreservation() {
    if (!currentPdfDoc) return;
    const targetPage = currentPage;
    updateZoomDisplay();

    // Re-render currently rendered pages at new scale
    for (const pNum of Array.from(renderedPagesSet)) {
      await renderPage(pNum);
    }

    // Smoothly restore reading position
    scrollToPage(targetPage);
  }

  // Zoom buttons
  btnZoomIn.addEventListener('click', () => {
    if (currentScale >= 3.0) return;
    currentScale = Math.min(3.0, currentScale + 0.15);
    applyZoomWithPreservation();
  });

  btnZoomOut.addEventListener('click', () => {
    if (currentScale <= 0.6) return;
    currentScale = Math.max(0.6, currentScale - 0.15);
    applyZoomWithPreservation();
  });

  btnFitWidth.addEventListener('click', async () => {
    if (!currentPdfDoc) return;
    const firstPage = await currentPdfDoc.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const availableWidth = viewerContainer.clientWidth - 48;
    currentScale = Math.max(0.6, Math.min(2.5, availableWidth / unscaledViewport.width));
    applyZoomWithPreservation();
  });

  // Page navigation
  btnPrevPage.addEventListener('click', () => {
    if (currentPage > 1) {
      scrollToPage(currentPage - 1);
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (currentPage < totalPages) {
      scrollToPage(currentPage + 1);
    }
  });

  pageNumInput.addEventListener('change', () => {
    let p = parseInt(pageNumInput.value, 10);
    if (isNaN(p)) p = 1;
    if (p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    scrollToPage(p);
  });

  function scrollToPage(p) {
    currentPage = p;
    pageNumInput.value = p;
    const el = document.getElementById(`pdf-page-${p}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Monitor scroll to update current page
  viewerContainer.addEventListener('scroll', () => {
    if (!currentPdfDoc) return;
    const pages = document.querySelectorAll('.pdf-page');
    const containerTop = viewerContainer.scrollTop;

    for (const p of pages) {
      const pageTop = p.offsetTop;
      const pageHeight = p.offsetHeight;
      if (pageTop + pageHeight / 3 >= containerTop) {
        const num = parseInt(p.dataset.pageNumber, 10);
        if (num !== currentPage) {
          currentPage = num;
          pageNumInput.value = num;
        }
        break;
      }
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Check URL query param ?file=
  const urlParams = new URLSearchParams(window.location.search);
  const fileUrl = urlParams.get('file');
  if (fileUrl) {
    loadPdfFromUrl(fileUrl);
  }
})();
