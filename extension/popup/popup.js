/**
 * PaperDict - Popup Controller
 * Manages settings toggles, trigger modes, site blacklisting, custom API configuration,
 * wordbook (生词本) management with Anki/CSV export, and search history.
 */

document.addEventListener('DOMContentLoaded', () => {
  const dictService = new (window.DictService || globalThis.DictService)(
    typeof ACADEMIC_DICT !== 'undefined' ? ACADEMIC_DICT : null
  );

  // Tabs Navigation
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      navTabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });

      tab.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
        targetPane.style.display = 'block';
      }

      if (targetId === 'tab-wordbook') loadWordBook();
      if (targetId === 'tab-notes') loadNotes();
      if (targetId === 'tab-history') loadHistory();
    });
  });

  // Settings Elements
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleDehyphen = document.getElementById('toggle-dehyphen');
  const toggleAutoAudio = document.getElementById('toggle-autoaudio');
  const toggleOnline = document.getElementById('toggle-online');
  const toggleInterceptPdf = document.getElementById('toggle-interceptpdf');
  const toggleDefaultBilingual = document.getElementById('toggle-default-bilingual');
  const toggleCapsule = document.getElementById('toggle-capsule');
  const selectTriggerMode = document.getElementById('select-trigger-mode');
  const toggleSiteEnable = document.getElementById('toggle-site-enable');
  const currentSiteLabel = document.getElementById('current-site-label');

  const btnPopupOrig = document.getElementById('btn-popup-orig');
  const btnPopupBi = document.getElementById('btn-popup-bi');
  const btnPopupZh = document.getElementById('btn-popup-zh');
  const bilingualStatusText = document.getElementById('bilingual-status-text');

  const pdfDetectBanner = document.getElementById('pdf-detect-banner');
  const btnConvertCurrentPdf = document.getElementById('btn-convert-current-pdf');

  const searchInput = document.getElementById('search-input');
  const btnSearchClear = document.getElementById('btn-search-clear');
  const btnSearchGo = document.getElementById('btn-search-go');

  const quickResultCard = document.getElementById('quick-result');
  const resWord = document.getElementById('res-word');
  const resPhonetic = document.getElementById('res-phonetic');
  const resSpeaker = document.getElementById('res-speaker');
  const resStar = document.getElementById('res-star');
  const resCopy = document.getElementById('res-copy');
  const resBody = document.getElementById('res-body');
  const resSource = document.getElementById('res-source');
  const resCopyHint = document.getElementById('res-copy-hint');

  const btnOpenReader = document.getElementById('btn-open-reader');

  // WordBook Elements
  const wordbookTotal = document.getElementById('wordbook-total');
  const navWordbookCount = document.getElementById('nav-wordbook-count');
  const wordbookList = document.getElementById('wordbook-list');
  const btnExportWordbookMd = document.getElementById('btn-export-wordbook-md');
  const btnExportAnki = document.getElementById('btn-export-anki');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnClearWordbook = document.getElementById('btn-clear-wordbook');

  // History Elements
  const historyList = document.getElementById('history-list');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // Custom API Elements
  const selectCustomEngine = document.getElementById('select-custom-engine');
  const customApiFields = document.getElementById('custom-api-fields');
  const fieldModelName = document.getElementById('field-model-name');
  const inputApiEndpoint = document.getElementById('input-api-endpoint');
  const inputApiKey = document.getElementById('input-api-key');
  const inputApiModel = document.getElementById('input-api-model');
  const btnSaveApi = document.getElementById('btn-save-api');
  const apiSaveTip = document.getElementById('api-save-tip');

  let currentAudio = null;
  let activeWord = '';
  let activeTrans = '';
  let activePhonetic = '';
  let currentActiveTabHost = '';

  // 1. Load Settings
  const defaultSettings = {
    enabled: true,
    triggerMode: 'direct',
    deHyphen: true,
    autoAudio: false,
    onlineFallback: true,
    autoInterceptPdf: false,
    bilingualDefault: false,
    capsuleEnabled: true,
    blacklist: [],
    customEngine: 'default',
    customApiKey: '',
    customApiEndpoint: '',
    customModel: ''
  };

  chrome.storage.sync.get(defaultSettings, (items) => {
    if (toggleEnabled) toggleEnabled.checked = items.enabled !== false;
    if (toggleDehyphen) toggleDehyphen.checked = items.deHyphen !== false;
    if (toggleAutoAudio) toggleAutoAudio.checked = items.autoAudio === true;
    if (toggleOnline) toggleOnline.checked = items.onlineFallback !== false;
    if (toggleInterceptPdf) toggleInterceptPdf.checked = items.autoInterceptPdf === true;
    if (toggleDefaultBilingual) toggleDefaultBilingual.checked = items.bilingualDefault === true;
    if (toggleCapsule) toggleCapsule.checked = items.capsuleEnabled !== false;
    if (selectTriggerMode) selectTriggerMode.value = items.triggerMode || 'direct';

    // API settings
    if (selectCustomEngine) selectCustomEngine.value = items.customEngine || 'default';
    if (inputApiKey) inputApiKey.value = items.customApiKey || '';
    if (inputApiEndpoint) inputApiEndpoint.value = items.customApiEndpoint || '';
    if (inputApiModel) inputApiModel.value = items.customModel || '';
    updateApiFieldsVisibility(items.customEngine || 'default');

    // Site blacklist check
    initCurrentSite(items.blacklist || []);
  });

  // Settings Change Listeners
  if (toggleEnabled) toggleEnabled.addEventListener('change', () => chrome.storage.sync.set({ enabled: toggleEnabled.checked }));
  if (toggleDehyphen) toggleDehyphen.addEventListener('change', () => chrome.storage.sync.set({ deHyphen: toggleDehyphen.checked }));
  if (toggleAutoAudio) toggleAutoAudio.addEventListener('change', () => chrome.storage.sync.set({ autoAudio: toggleAutoAudio.checked }));
  if (toggleOnline) toggleOnline.addEventListener('change', () => chrome.storage.sync.set({ onlineFallback: toggleOnline.checked }));
  if (toggleInterceptPdf) toggleInterceptPdf.addEventListener('change', () => chrome.storage.sync.set({ autoInterceptPdf: toggleInterceptPdf.checked }));
  if (toggleDefaultBilingual) toggleDefaultBilingual.addEventListener('change', () => chrome.storage.sync.set({ bilingualDefault: toggleDefaultBilingual.checked }));
  if (toggleCapsule) toggleCapsule.addEventListener('change', () => chrome.storage.sync.set({ capsuleEnabled: toggleCapsule.checked }));
  if (selectTriggerMode) selectTriggerMode.addEventListener('change', () => chrome.storage.sync.set({ triggerMode: selectTriggerMode.value }));

  // Site blacklist handling
  function initCurrentSite(blacklist) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const u = new URL(tabs[0].url);
          currentActiveTabHost = u.hostname;
          if (currentSiteLabel) {
            currentSiteLabel.textContent = `当前网站: ${currentActiveTabHost}`;
          }
          const isBlacklisted = blacklist.some(d => currentActiveTabHost === d || currentActiveTabHost.endsWith('.' + d));
          if (toggleSiteEnable) {
            toggleSiteEnable.checked = !isBlacklisted;
            toggleSiteEnable.addEventListener('change', () => {
              chrome.storage.sync.get({ blacklist: [] }, (res) => {
                let list = res.blacklist || [];
                if (!toggleSiteEnable.checked) {
                  // Add to blacklist
                  if (!list.includes(currentActiveTabHost)) list.push(currentActiveTabHost);
                } else {
                  // Remove from blacklist
                  list = list.filter(d => d !== currentActiveTabHost);
                }
                chrome.storage.sync.set({ blacklist: list });
              });
            });
          }
        } catch (e) {
          if (currentSiteLabel) currentSiteLabel.textContent = '当前页面为本地或特殊页面';
        }
      }
    });
  }

  // Check active tab bilingual status
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_BILINGUAL_MODE' }, (res) => {
        if (!chrome.runtime.lastError && res && res.mode) {
          updatePopupBilingualUI(res.mode, res.total, res.translated);
        }
      });
    }
  });

  function updatePopupBilingualUI(mode, total, translated) {
    if (btnPopupOrig) btnPopupOrig.classList.toggle('active', mode === 'original');
    if (btnPopupBi) btnPopupBi.classList.toggle('active', mode === 'bilingual');
    if (btnPopupZh) btnPopupZh.classList.toggle('active', mode === 'chinese');

    if (bilingualStatusText) {
      if (mode === 'bilingual') {
        bilingualStatusText.textContent = total ? `双语对照就绪 (已译 ${translated || 0} / ${total} 段)` : '双语对照已激活';
      } else if (mode === 'chinese') {
        bilingualStatusText.textContent = total ? `纯中文速读就绪 (已译 ${translated || 0} / ${total} 段)` : '纯中文速读已激活';
      } else {
        bilingualStatusText.textContent = '当前为原版英文排版';
      }
    }
  }

  function setTabBilingualMode(mode) {
    updatePopupBilingualUI(mode);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_BILINGUAL_MODE', mode }, (res) => {
          if (res && res.mode) {
            updatePopupBilingualUI(res.mode);
          }
        });
      }
    });
  }

  if (btnPopupOrig) btnPopupOrig.addEventListener('click', () => setTabBilingualMode('original'));
  if (btnPopupBi) btnPopupBi.addEventListener('click', () => setTabBilingualMode('bilingual'));
  if (btnPopupZh) btnPopupZh.addEventListener('click', () => setTabBilingualMode('chinese'));

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

  // Open Academic PDF Reader
  if (btnOpenReader) {
    btnOpenReader.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html') });
    });
  }

  // Search handling
  function doSearch(text) {
    if (!text || !text.trim()) {
      quickResultCard.style.display = 'none';
      return;
    }

    const query = dictService.cleanPaperText(text.trim(), toggleDehyphen ? toggleDehyphen.checked : true);
    activeWord = query;
    resWord.textContent = query;
    resCopyHint.classList.remove('show');
    quickResultCard.style.display = 'block';

    // Record history
    recordHistory(query);

    const isSingleWord = dictService.isSingleWord(query);

    if (isSingleWord) {
      const local = dictService.lookupLocal(query);
      if (local && local.found) {
        activePhonetic = local.phonetic || '';
        resPhonetic.textContent = activePhonetic ? `/${activePhonetic}/` : '';
        resPhonetic.style.display = activePhonetic ? 'inline-block' : 'none';
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

        updateStarState(query);

        if (toggleAutoAudio && toggleAutoAudio.checked) {
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

        updateStarState(query);

        if (isSingleWord && toggleAutoAudio && toggleAutoAudio.checked) {
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

  if (resSpeaker) {
    resSpeaker.addEventListener('click', () => {
      playWordAudio(activeWord);
    });
  }

  // Copy result
  if (resCopy) {
    resCopy.addEventListener('click', () => {
      const textToCopy = `${activeWord}\n${activeTrans}`;
      navigator.clipboard.writeText(textToCopy).then(() => {
        resCopyHint.classList.add('show');
        setTimeout(() => resCopyHint.classList.remove('show'), 1500);
      });
    });
  }

  // Search input events
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      btnSearchClear.style.display = searchInput.value ? 'inline-flex' : 'none';
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch(searchInput.value);
    });
  }

  if (btnSearchGo) {
    btnSearchGo.addEventListener('click', () => doSearch(searchInput.value));
  }

  if (btnSearchClear) {
    btnSearchClear.addEventListener('click', () => {
      searchInput.value = '';
      btnSearchClear.style.display = 'none';
      quickResultCard.style.display = 'none';
      searchInput.focus();
    });
  }

  // Star in search result
  function updateStarState(word) {
    chrome.storage.local.get({ wordBook: [] }, (res) => {
      const book = res.wordBook || [];
      const hasWord = book.some(item => item.word.toLowerCase() === word.toLowerCase());
      if (resStar) {
        resStar.classList.toggle('active-starred', hasWord);
        resStar.title = hasWord ? '已在生词本中 (点击移除)' : '收藏到生词本';
      }
    });
  }

  if (resStar) {
    resStar.addEventListener('click', () => {
      if (!activeWord) return;
      chrome.storage.local.get({ wordBook: [] }, (res) => {
        let book = res.wordBook || [];
        const idx = book.findIndex(item => item.word.toLowerCase() === activeWord.toLowerCase());
        if (idx >= 0) {
          book.splice(idx, 1);
        } else {
          book.unshift({
            word: activeWord,
            phonetic: activePhonetic || '',
            translation: activeTrans || '',
            date: Date.now()
          });
        }
        chrome.storage.local.set({ wordBook: book }, () => {
          updateStarState(activeWord);
          updateWordBookCount();
        });
      });
    });
  }

  // WordBook Management
  function updateWordBookCount() {
    chrome.storage.local.get({ wordBook: [] }, (res) => {
      const count = (res.wordBook || []).length;
      if (wordbookTotal) wordbookTotal.textContent = count;
      if (navWordbookCount) navWordbookCount.textContent = count;
    });
  }
  updateWordBookCount();

  function loadWordBook() {
    chrome.storage.local.get({ wordBook: [] }, (res) => {
      const book = res.wordBook || [];
      updateWordBookCount();

      if (book.length === 0) {
        wordbookList.innerHTML = '<div class="empty-hint">生词本空空如也，查词时点击卡片右上角收藏按钮即可保存！</div>';
        return;
      }

      wordbookList.innerHTML = book.map((item, idx) => `
        <div class="word-card-item">
          <div class="word-card-info">
            <div class="word-card-head">
              <span class="word-card-title">${escapeHtml(item.word)}</span>
              ${item.phonetic ? `<span class="word-card-phonetic">/${escapeHtml(item.phonetic)}/</span>` : ''}
            </div>
            <div class="word-card-trans">${escapeHtml(item.translation)}</div>
          </div>
          <button class="btn-del-word" data-index="${idx}" title="从生词本删除">✕</button>
        </div>
      `).join('');

      const delBtns = wordbookList.querySelectorAll('.btn-del-word');
      delBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const i = parseInt(btn.dataset.index, 10);
          book.splice(i, 1);
          chrome.storage.local.set({ wordBook: book }, () => loadWordBook());
        });
      });
    });
  }

  // Export WordBook Markdown / Anki / CSV
  if (btnExportWordbookMd) {
    btnExportWordbookMd.addEventListener('click', () => {
      chrome.storage.local.get({ wordBook: [] }, (res) => {
        const book = res.wordBook || [];
        if (book.length === 0) return alert('当前生词本为空，查词时点击卡片收藏按钮即可保存！');
        const md = AnnotationManager.exportWordBookToMarkdown(book);
        downloadFile(md, 'paperdict_vocab_wordbook.md', 'text/markdown;charset=utf-8;');
      });
    });
  }

  if (btnExportAnki) {
    btnExportAnki.addEventListener('click', () => {
      chrome.storage.local.get({ wordBook: [] }, (res) => {
        const book = res.wordBook || [];
        if (book.length === 0) return alert('生词本中没有单词可导出');
        // Anki standard tab-delimited text format: Front \t Back
        const lines = book.map(w => {
          const front = w.phonetic ? `${w.word} [/${w.phonetic}/]` : w.word;
          const back = w.translation.replace(/\n/g, '<br>');
          return `${front}\t${back}`;
        }).join('\n');

        downloadFile(lines, 'paperdict_anki_vocab.txt', 'text/plain');
      });
    });
  }

  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      chrome.storage.local.get({ wordBook: [] }, (res) => {
        const book = res.wordBook || [];
        if (book.length === 0) return alert('生词本中没有单词可导出');
        let csv = 'Word,Phonetic,Translation,Date\n';
        book.forEach(w => {
          const dateStr = new Date(w.date || Date.now()).toLocaleDateString();
          csv += `"${(w.word || '').replace(/"/g, '""')}","${(w.phonetic || '').replace(/"/g, '""')}","${(w.translation || '').replace(/"/g, '""')}","${dateStr}"\n`;
        });
        downloadFile(csv, 'paperdict_vocab.csv', 'text/csv;charset=utf-8;');
      });
    });
  }

  if (btnClearWordbook) {
    btnClearWordbook.addEventListener('click', () => {
      if (confirm('确定要清空所有收藏的生词吗？此操作不可恢复。')) {
        chrome.storage.local.set({ wordBook: [] }, () => loadWordBook());
      }
    });
  }

  // History Management
  function recordHistory(query) {
    if (!query) return;
    chrome.storage.local.get({ searchHistory: [] }, (res) => {
      let history = res.searchHistory || [];
      history = history.filter(item => item.word.toLowerCase() !== query.toLowerCase());
      history.unshift({ word: query, date: Date.now() });
      if (history.length > 60) history.pop();
      chrome.storage.local.set({ searchHistory: history });
    });
  }

  function loadHistory() {
    chrome.storage.local.get({ searchHistory: [] }, (res) => {
      const history = res.searchHistory || [];
      if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-hint">暂无查词历史记录</div>';
        return;
      }

      historyList.innerHTML = history.map(item => `
        <div class="history-item" data-word="${escapeHtml(item.word)}">
          <span class="history-word">${escapeHtml(item.word)}</span>
          <span class="history-date">${new Date(item.date).toLocaleDateString()}</span>
        </div>
      `).join('');

      const items = historyList.querySelectorAll('.history-item');
      items.forEach(el => {
        el.addEventListener('click', () => {
          const w = el.dataset.word;
          // Switch to search tab
          const searchTab = document.querySelector('.nav-tab[data-tab="tab-search-settings"]');
          if (searchTab) searchTab.click();
          if (searchInput) {
            searchInput.value = w;
            btnSearchClear.style.display = 'inline-flex';
            doSearch(w);
          }
        });
      });
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      chrome.storage.local.set({ searchHistory: [] }, () => loadHistory());
    });
  }

  // Custom API configuration
  function updateApiFieldsVisibility(engine) {
    if (!customApiFields) return;
    if (engine === 'default') {
      customApiFields.style.display = 'none';
    } else {
      customApiFields.style.display = 'block';
      if (fieldModelName) {
        fieldModelName.style.display = engine === 'openai' ? 'flex' : 'none';
      }
      if (inputApiEndpoint && !inputApiEndpoint.value) {
        if (engine === 'openai') inputApiEndpoint.placeholder = 'https://api.openai.com/v1/chat/completions';
        if (engine === 'deepl') inputApiEndpoint.placeholder = 'https://api-free.deepl.com/v2/translate';
      }
    }
  }

  if (selectCustomEngine) {
    selectCustomEngine.addEventListener('change', () => {
      updateApiFieldsVisibility(selectCustomEngine.value);
    });
  }

  if (btnSaveApi) {
    btnSaveApi.addEventListener('click', () => {
      const engine = selectCustomEngine.value;
      const apiKey = inputApiKey.value.trim();
      const endpoint = inputApiEndpoint.value.trim();
      const model = inputApiModel.value.trim();

      chrome.storage.sync.set({
        customEngine: engine,
        customApiKey: apiKey,
        customApiEndpoint: endpoint,
        customModel: model
      }, () => {
        if (apiSaveTip) {
          apiSaveTip.style.display = 'block';
          setTimeout(() => apiSaveTip.style.display = 'none', 2000);
        }
      });
    });
  }

  // Annotation & Note Management
  const ANNOTATION_STORAGE_KEY = (typeof window !== 'undefined' && window.STORAGE_KEY) || 'paperdict_annotations';
  const annotationManager = typeof AnnotationManager !== 'undefined' ? new AnnotationManager() : null;
  const navNotesCount = document.getElementById('nav-notes-count');
  const notesTotal = document.getElementById('notes-total');
  const notesList = document.getElementById('notes-list');
  const btnExportNotesMd = document.getElementById('btn-export-notes-md');
  const btnExportNotesJson = document.getElementById('btn-export-notes-json');
  const btnClearNotes = document.getElementById('btn-clear-notes');

  async function updateNotesBadge() {
    if (!annotationManager) return;
    const all = await annotationManager.loadAll();
    if (navNotesCount) navNotesCount.textContent = all.length;
    if (notesTotal) notesTotal.textContent = all.length;
  }
  updateNotesBadge();

  async function loadNotes() {
    if (!annotationManager) return;
    const all = await annotationManager.loadAll();
    updateNotesBadge();

    if (!notesList) return;
    if (all.length === 0) {
      notesList.innerHTML = '<div class="empty-hint">暂无论文批注与高亮，划选学术内容后点击颜色即可高亮，点击“笔记”即可创建！</div>';
      return;
    }

    const colorBadges = {
      yellow: '[核心]',
      green:  '[方法]',
      blue:   '[结论]',
      pink:   '[疑问]'
    };

    notesList.innerHTML = all.slice().reverse().map((item) => `
      <div class="word-card-item">
        <div class="word-card-info" style="width:100%;">
          <div class="word-card-head" style="justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;font-weight:600;color:#64748b;">${colorBadges[item.color] || '[要点]'} ${escapeHtml(item.docTitle || '学术文献')}</span>
            <span style="font-size:10px;color:#94a3b8;">${new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
          <div style="font-size:12.5px;color:#1e293b;background:#f8fafc;padding:5px 8px;border-left:3px solid #cbd5e1;border-radius:3px;margin-bottom:4px;word-break:break-word;">
            “${escapeHtml(item.text)}”
          </div>
          ${item.note ? `<div style="font-size:12px;color:#2563eb;font-weight:500;">批注: ${escapeHtml(item.note)}</div>` : ''}
        </div>
        <button class="btn-del-note" data-id="${item.id}" title="删除此批注" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;font-size:13px;">✕</button>
      </div>
    `).join('');

    const delBtns = notesList.querySelectorAll('.btn-del-note');
    delBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await annotationManager.deleteAnnotation(btn.dataset.id);
        loadNotes();
      });
    });
  }

  if (btnExportNotesMd) {
    btnExportNotesMd.addEventListener('click', async () => {
      if (!annotationManager) return;
      const all = await annotationManager.loadAll();
      if (all.length === 0) return alert('当前没有可导出的论文批注与笔记');
      const md = AnnotationManager.exportToMarkdown(all, '学术文献阅读与批注集锦', { isMultiDoc: true });
      downloadFile(md, 'paperdict_reading_notes.md', 'text/markdown;charset=utf-8;');
    });
  }

  if (btnExportNotesJson) {
    btnExportNotesJson.addEventListener('click', async () => {
      if (!annotationManager) return;
      const all = await annotationManager.loadAll();
      if (all.length === 0) return alert('当前没有可导出的论文批注与笔记');
      const json = AnnotationManager.exportToJson(all);
      downloadFile(json, 'paperdict_annotations.json', 'application/json;charset=utf-8;');
    });
  }

  if (btnClearNotes) {
    btnClearNotes.addEventListener('click', async () => {
      if (confirm('确定要清空所有论文笔记与批注记录吗？此操作不可恢复。')) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [ANNOTATION_STORAGE_KEY]: [] }, () => loadNotes());
        }
      }
    });
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Handle URL query param (e.g. popup opened from PDF context menu)
  const urlParams = new URLSearchParams(window.location.search);
  const q = urlParams.get('q');
  if (q && searchInput) {
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
