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

  let currentPdfDoc = null;
  let currentScale = 1.35;
  let totalPages = 0;
  let currentPage = 1;

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

      pdfViewer.innerHTML = '';

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

    pdfViewer.appendChild(pageDiv);

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
  }

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
