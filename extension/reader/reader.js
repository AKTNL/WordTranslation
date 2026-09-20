/**
 * PaperDict - Academic PDF Reader Controller
 * Uses PDF.js to render PDF pages and selectable text layers.
 * Seamlessly integrates with PaperDict's Shadow DOM selection translation.
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

  let currentPdfDoc = null;
  let currentScale = 1.35;
  let totalPages = 0;
  let currentPage = 1;
  let currentBilingualMode = 'original'; // 'original' | 'bilingual' | 'chinese'
  const pageParagraphsMap = new Map(); // pageNumber -> [{ orig, trans, pDiv, transDiv }]
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

  // Load PDF from URL (e.g. arXiv, online PDF, or web link)
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

      // Fetch PDF data
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

  async function renderPdf(data) {
    try {
      welcomeDropzone.style.display = 'none';
      viewerContainer.style.display = 'flex';
      pageControls.style.display = 'inline-flex';
      zoomControls.style.display = 'inline-flex';
      if (bilingualControls) bilingualControls.style.display = 'inline-flex';

      pdfViewer.innerHTML = '';
      pageParagraphsMap.clear();

      const loadingTask = pdfjsLib.getDocument({ data });
      currentPdfDoc = await loadingTask.promise;
      totalPages = currentPdfDoc.numPages;
      pageCountSpan.textContent = totalPages;
      pageNumInput.max = totalPages;

      updateZoomDisplay();

      // Render all pages
      for (let i = 1; i <= totalPages; i++) {
        await renderPage(i);
      }
    } catch (err) {
      console.error('Failed to load PDF:', err);
      alert('加载 PDF 失败: ' + err.message);
    }
  }

  async function renderPage(pageNumber) {
    const page = await currentPdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: currentScale });

    // Page wrapper
    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.id = `pdf-page-${pageNumber}`;
    pageDiv.dataset.pageNumber = pageNumber;
    pageDiv.style.width = `${Math.floor(viewport.width)}px`;
    pageDiv.style.height = `${Math.floor(viewport.height)}px`;

    // Canvas
    const canvas = document.createElement('canvas');
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

    pageDiv.appendChild(canvas);

    // Text layer for selectable text & selection translation
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
    textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
    textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
    pageDiv.appendChild(textLayerDiv);

    // Row wrapper for side-by-side bilingual reading
    const rowDiv = document.createElement('div');
    rowDiv.className = 'pdf-page-row';
    rowDiv.id = `pdf-row-${pageNumber}`;
    rowDiv.dataset.pageNumber = pageNumber;
    rowDiv.appendChild(pageDiv);

    // Bilingual side panel
    const bilingualPanel = document.createElement('div');
    bilingualPanel.className = `pdf-page-bilingual ${currentBilingualMode === 'chinese' ? 'full-chinese' : ''}`;
    bilingualPanel.id = `pdf-bilingual-${pageNumber}`;
    bilingualPanel.style.display = currentBilingualMode === 'original' ? 'none' : 'block';
    bilingualPanel.style.minHeight = `${Math.floor(viewport.height)}px`;
    rowDiv.appendChild(bilingualPanel);

    pdfViewer.appendChild(rowDiv);

    // Render canvas
    await page.render(renderContext).promise;

    // Render text layer
    const textContent = await page.getTextContent();
    pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: []
    });

    // Extract & cluster paragraphs for bilingual rendering
    setupPageBilingualContent(pageNumber, textContent, bilingualPanel);

    // Observe row for viewport lazy translation
    if (bilingualObserver) {
      bilingualObserver.observe(rowDiv);
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

    paras.forEach((pText, idx) => {
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

    // If currently in bilingual/chinese mode and page is visible, start translation
    if (currentBilingualMode !== 'original' && pageNumber === currentPage) {
      translatePageParagraphs(pageNumber);
    }
  }

  function clusterPdfTextIntoParagraphs(textContent) {
    if (!textContent || !textContent.items || textContent.items.length === 0) {
      return [];
    }

    // Group items into lines
    const lines = [];
    let currentLine = [];
    let currentY = null;

    const items = textContent.items.filter(item => item.str && item.str.trim().length > 0);

    for (const item of items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (currentY === null || Math.abs(y - currentY) > 3) {
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

    // Cluster lines into paragraphs
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
            if (cleaned.length >= 15 && /[a-zA-Z]{2,}/.test(cleaned)) {
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
      if (cleaned.length >= 15 && /[a-zA-Z]{2,}/.test(cleaned)) {
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

      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_ONLINE',
          text: textToTranslate
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
          item.transDiv.innerHTML = `<span style="color:#f87171;font-size:12px;">(翻译超时，请稍后重试)</span>`;
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

    // Update buttons
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
      }
    }

    // Update all page bilingual panels
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
      // Trigger translation for currently visible page
      translatePageParagraphs(currentPage);
    }
  }

  // Setup Viewport IntersectionObserver for lazy translating PDF pages
  if (typeof IntersectionObserver !== 'undefined') {
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

  async function reRenderAll() {
    if (!currentPdfDoc) return;
    pdfViewer.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      await renderPage(i);
    }
  }

  // Zoom buttons
  btnZoomIn.addEventListener('click', () => {
    if (currentScale >= 3.0) return;
    currentScale = Math.min(3.0, currentScale + 0.15);
    updateZoomDisplay();
    reRenderAll();
  });

  btnZoomOut.addEventListener('click', () => {
    if (currentScale <= 0.6) return;
    currentScale = Math.max(0.6, currentScale - 0.15);
    updateZoomDisplay();
    reRenderAll();
  });

  btnFitWidth.addEventListener('click', async () => {
    if (!currentPdfDoc) return;
    const firstPage = await currentPdfDoc.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    const availableWidth = viewerContainer.clientWidth - 48;
    currentScale = Math.max(0.6, Math.min(2.5, availableWidth / unscaledViewport.width));
    updateZoomDisplay();
    reRenderAll();
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
