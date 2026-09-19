/**
 * PaperDict - Popup Controller
 * Manages settings toggles, quick search, audio playback, and PDF reader shortcuts.
 */

document.addEventListener('DOMContentLoaded', () => {
  const dictService = new (window.DictService || globalThis.DictService)(
    typeof ACADEMIC_DICT !== 'undefined' ? ACADEMIC_DICT : null
  );

  // Elements
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleDehyphen = document.getElementById('toggle-dehyphen');
  const toggleAutoAudio = document.getElementById('toggle-autoaudio');
  const toggleOnline = document.getElementById('toggle-online');
  const toggleInterceptPdf = document.getElementById('toggle-interceptpdf');

  const pdfDetectBanner = document.getElementById('pdf-detect-banner');
  const btnConvertCurrentPdf = document.getElementById('btn-convert-current-pdf');

  const searchInput = document.getElementById('search-input');
  const btnSearchClear = document.getElementById('btn-search-clear');
  const btnSearchGo = document.getElementById('btn-search-go');

  const quickResultCard = document.getElementById('quick-result');
  const resWord = document.getElementById('res-word');
  const resPhonetic = document.getElementById('res-phonetic');
  const resSpeaker = document.getElementById('res-speaker');
  const resCopy = document.getElementById('res-copy');
  const resBody = document.getElementById('res-body');
  const resSource = document.getElementById('res-source');
  const resCopyHint = document.getElementById('res-copy-hint');

  const btnOpenReader = document.getElementById('btn-open-reader');

  let currentAudio = null;
  let activeWord = '';
  let activeTrans = '';

  // 1. Load Settings
  const defaultSettings = {
    enabled: true,
    deHyphen: true,
    autoAudio: false,
    onlineFallback: true,
    autoInterceptPdf: true
  };

  chrome.storage.sync.get(defaultSettings, (items) => {
    toggleEnabled.checked = items.enabled !== false;
    toggleDehyphen.checked = items.deHyphen !== false;
    toggleAutoAudio.checked = items.autoAudio === true;
    toggleOnline.checked = items.onlineFallback !== false;
    if (toggleInterceptPdf) {
      toggleInterceptPdf.checked = items.autoInterceptPdf !== false;
    }
  });

  // Settings change listeners
  toggleEnabled.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggleEnabled.checked });
  });
  toggleDehyphen.addEventListener('change', () => {
    chrome.storage.sync.set({ deHyphen: toggleDehyphen.checked });
  });
  toggleAutoAudio.addEventListener('change', () => {
    chrome.storage.sync.set({ autoAudio: toggleAutoAudio.checked });
  });
  toggleOnline.addEventListener('change', () => {
    chrome.storage.sync.set({ onlineFallback: toggleOnline.checked });
  });
  if (toggleInterceptPdf) {
    toggleInterceptPdf.addEventListener('change', () => {
      chrome.storage.sync.set({ autoInterceptPdf: toggleInterceptPdf.checked });
    });
  }

  // Detect if active tab is a PDF
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const activeUrl = tabs[0].url;
      const isPdf = isPdfTabUrl(activeUrl);
      if (isPdf && pdfDetectBanner && btnConvertCurrentPdf) {
        pdfDetectBanner.style.display = 'flex';
        btnConvertCurrentPdf.onclick = () => {
          const readerUrl = chrome.runtime.getURL(`reader/reader.html?file=${encodeURIComponent(activeUrl)}`);
          chrome.tabs.update(tabs[0].id, { url: readerUrl });
          window.close();
        };
      }
    }
  });

  function isPdfTabUrl(url) {
    if (!url) return false;
    if (url.includes('reader/reader.html')) return false;
    try {
      const u = new URL(url);
      const path = u.pathname.toLowerCase();
      if (path.endsWith('.pdf')) return true;
      if (path.includes('/pdf/') || path.startsWith('/pdf/')) return true;
      if (u.searchParams.has('pdf') || (path.includes('pdf') && u.searchParams.has('id'))) return true;
    } catch (e) {
      if (/\.pdf($|[?#])/i.test(url)) return true;
    }
    return false;
  }

  // 2. Open Academic PDF Reader
  if (btnOpenReader) {
    btnOpenReader.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html') });
    });
  }

  // 3. Search handling
  function doSearch(text) {
    if (!text || !text.trim()) {
      quickResultCard.style.display = 'none';
      return;
    }

    const query = dictService.cleanPaperText(text.trim(), toggleDehyphen.checked);
    activeWord = query;
    resWord.textContent = query;
    resCopyHint.classList.remove('show');
    quickResultCard.style.display = 'block';

    const isSingleWord = dictService.isSingleWord(query);

    if (isSingleWord) {
      const local = dictService.lookupLocal(query);
      if (local && local.found) {
        resPhonetic.textContent = local.phonetic ? `/${local.phonetic}/` : '';
        resPhonetic.style.display = local.phonetic ? 'inline-block' : 'none';
        resSpeaker.style.display = 'inline-flex';

        activeTrans = local.translation;
        const defs = dictService.parseDefinitions(local.translation);
        resBody.innerHTML = defs.map(d => `
          <div class="res-def-item">
            <span class="pos-tag">${escapeHtml(d.pos)}</span>
            <span class="def-text">${escapeHtml(d.text)}</span>
          </div>
        `).join('');

        resSource.textContent = '● 离线学术词典';
        resSource.style.color = '#059669';

        if (toggleAutoAudio.checked) {
          playWordAudio(local.baseWord || query);
        }
        return;
      }
    }

    // Fallback to online translation
    resPhonetic.style.display = 'none';
    resSpeaker.style.display = isSingleWord ? 'inline-flex' : 'none';
    resBody.innerHTML = '<span style="color: #64748b;">正在查询翻译...</span>';
    resSource.textContent = '● 在线翻译中...';
    resSource.style.color = '#2563eb';

    chrome.runtime.sendMessage({
      type: 'TRANSLATE_ONLINE',
      text: query
    }, (response) => {
      if (response && response.success) {
        activeTrans = response.translation;
        resBody.textContent = response.translation;
        resSource.textContent = `● ${response.source || '在线翻译'}`;
        resSource.style.color = '#2563eb';

        if (isSingleWord && toggleAutoAudio.checked) {
          playWordAudio(query);
        }
      } else {
        activeTrans = '';
        resBody.textContent = response?.error || '未查到对应释义';
        resSource.textContent = '● 查询失败';
        resSource.style.color = '#dc2626';
      }
    });
  }

  // Audio playback
  function playWordAudio(word) {
    if (!word) return;
    resSpeaker.classList.add('playing');

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    const audio = new Audio(url);
    currentAudio = audio;

    const stopPlay = () => resSpeaker.classList.remove('playing');
    audio.onended = stopPlay;
    audio.onerror = () => {
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'en-US';
        utter.onend = stopPlay;
        utter.onerror = stopPlay;
        window.speechSynthesis.speak(utter);
      } else {
        stopPlay();
      }
    };
    audio.play().catch(() => {
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = 'en-US';
        utter.onend = stopPlay;
        utter.onerror = stopPlay;
        window.speechSynthesis.speak(utter);
      } else {
        stopPlay();
      }
    });
  }

  resSpeaker.addEventListener('click', () => {
    playWordAudio(activeWord);
  });

  // Copy result
  resCopy.addEventListener('click', () => {
    const textToCopy = `${activeWord}\n${activeTrans}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      resCopyHint.classList.add('show');
      setTimeout(() => resCopyHint.classList.remove('show'), 1500);
    });
  });

  // Search input events
  searchInput.addEventListener('input', () => {
    btnSearchClear.style.display = searchInput.value ? 'inline-flex' : 'none';
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      doSearch(searchInput.value);
    }
  });

  btnSearchGo.addEventListener('click', () => {
    doSearch(searchInput.value);
  });

  btnSearchClear.addEventListener('click', () => {
    searchInput.value = '';
    btnSearchClear.style.display = 'none';
    quickResultCard.style.display = 'none';
    searchInput.focus();
  });

  // 4. Handle URL query param (e.g. popup opened from PDF context menu)
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('q');
  if (q) {
    searchInput.value = decodeURIComponent(q);
    btnSearchClear.style.display = 'inline-flex';
    doSearch(q);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
