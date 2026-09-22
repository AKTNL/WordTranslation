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
  const btnTestApi = document.getElementById('btn-test-api');
  const btnSaveApi = document.getElementById('btn-save-api');
  const apiSaveTip = document.getElementById('api-save-tip');

  // Glossary Elements
  const glossaryPackList = document.getElementById('glossary-pack-list');
  const glossarySource = document.getElementById('glossary-source');
  const glossaryTarget = document.getElementById('glossary-target');
  const btnSaveTerm = document.getElementById('btn-save-term');
  const btnCancelTerm = document.getElementById('btn-cancel-term');
  const glossarySearch = document.getElementById('glossary-search');
  const inputGlossaryFile = document.getElementById('input-glossary-file');
  const btnExportGlossary = document.getElementById('btn-export-glossary');
  const btnClearGlossary = document.getElementById('btn-clear-glossary');
  const glossaryStatus = document.getElementById('glossary-status');
  const glossaryCount = document.getElementById('glossary-count');
  const userGlossaryList = document.getElementById('user-glossary-list');

  let currentAudio = null;
  let activeWord = '';
  let activeTrans = '';
  let activePhonetic = '';
  let currentActiveTabHost = '';
  let userGlossary = [];
  let enabledGlossaryPacks = ['general-academic'];
  let editingGlossarySource = '';

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
    if (inputApiEndpoint) inputApiEndpoint.value = items.customApiEndpoint || '';
    if (inputApiModel) inputApiModel.value = items.customModel || '';
    updateApiFieldsVisibility(items.customEngine || 'default');

    // Site blacklist check
    initCurrentSite(items.blacklist || []);

    chrome.storage.local.get({
      customApiKey: '',
      userGlossary: [],
      enabledGlossaryPacks: ['general-academic'],
      glossaryVersion: 0
    }, (localItems) => {
      const apiKey = localItems.customApiKey || items.customApiKey || '';
      if (inputApiKey) inputApiKey.value = apiKey;
      if (!localItems.customApiKey && items.customApiKey) {
        chrome.storage.local.set({ customApiKey: items.customApiKey });
        chrome.storage.sync.remove('customApiKey');
      }
      userGlossary = GlossaryService.mergeEntries(
        [],
        Array.isArray(localItems.userGlossary) ? localItems.userGlossary : []
      ).entries;
      enabledGlossaryPacks = Array.isArray(localItems.enabledGlossaryPacks)
        ? localItems.enabledGlossaryPacks
        : ['general-academic'];
      renderGlossaryPacks();
      renderGlossaryList();
    });
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
  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: '扩展后台无响应' });
        }
      });
    });
  }

  async function doSearch(text) {
    if (!text || !text.trim()) {
      quickResultCard.style.display = 'none';
      return;
    }

    const query = dictService.cleanPaperText(text.trim(), toggleDehyphen ? toggleDehyphen.checked : true);
    activeWord = query;
    resWord.textContent = query;
    resCopyHint.classList.remove('show');
    quickResultCard.style.display = 'block';

    if (!dictService.isEnglishSourceText(query)) {
      activeTrans = '';
      resPhonetic.style.display = 'none';
      resSpeaker.style.display = 'none';
      resBody.textContent = 'PaperDict 仅处理英语到中文的翻译';
      resSource.textContent = '● 仅支持英语输入';
      resSource.style.color = '#dc2626';
      return;
    }

    // Record history
    recordHistory(query);

    const isSingleWord = dictService.isSingleWord(query);

    const glossaryResult = await sendRuntimeMessage({ type: 'LOOKUP_GLOSSARY', text: query });
    if (glossaryResult.success && glossaryResult.found) {
      activeTrans = glossaryResult.translation;
      resPhonetic.style.display = 'none';
      resSpeaker.style.display = isSingleWord ? 'inline-flex' : 'none';
      resBody.textContent = glossaryResult.translation;
      resSource.textContent = `● ${glossaryResult.source || '离线术语库'}`;
      resSource.style.color = '#059669';
      updateStarState(query);
      return;
    }

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

    if (toggleOnline && !toggleOnline.checked) {
      activeTrans = '';
      resPhonetic.style.display = 'none';
      resSpeaker.style.display = 'none';
      resBody.textContent = '本地词典与术语库未收录；整句翻译需要在线引擎';
      resSource.textContent = '● 仅离线查询';
      resSource.style.color = '#64748b';
      return;
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
        wordbookList.innerHTML = '<div class="empty-hint">生词本空空如也，查词时点击卡片右上角 ⭐ 即可收藏！</div>';
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

  // Export Anki / CSV
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
  function showStatus(element, message, type = '') {
    if (!element) return;
    element.textContent = message;
    element.className = `api-status-text${type ? ` ${type}` : ''}`;
  }

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

  function getApiFormConfig() {
    return {
      engine: selectCustomEngine ? selectCustomEngine.value : 'default',
      apiKey: inputApiKey ? inputApiKey.value.trim() : '',
      endpoint: inputApiEndpoint ? inputApiEndpoint.value.trim() : '',
      model: inputApiModel ? inputApiModel.value.trim() : ''
    };
  }

  function validateApiForm(config) {
    if (config.engine === 'default') return '';
    if (!config.apiKey) return '请填写 API Key';
    if (config.engine === 'openai' && !config.model) return '请填写模型名称';
    if (config.endpoint) {
      try {
        const url = new URL(config.endpoint);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Endpoint 必须使用 HTTP 或 HTTPS';
      } catch (error) {
        return 'Endpoint 地址格式无效';
      }
    }
    return '';
  }

  if (btnTestApi) {
    btnTestApi.addEventListener('click', async () => {
      const config = getApiFormConfig();
      const validationError = validateApiForm(config);
      if (validationError) {
        showStatus(apiSaveTip, validationError, 'error');
        return;
      }

      btnTestApi.disabled = true;
      showStatus(apiSaveTip, '正在连接所选翻译引擎...', 'pending');
      const response = await sendRuntimeMessage({ type: 'TEST_TRANSLATION_ENGINE', config });
      btnTestApi.disabled = false;
      if (response.success) {
        showStatus(apiSaveTip, `连接成功：${response.source || '翻译引擎已响应'}`, 'success');
      } else {
        showStatus(apiSaveTip, response.error || '连接测试失败', 'error');
      }
    });
  }

  if (btnSaveApi) {
    btnSaveApi.addEventListener('click', () => {
      const config = getApiFormConfig();
      const validationError = validateApiForm(config);
      if (validationError) {
        showStatus(apiSaveTip, validationError, 'error');
        return;
      }

      chrome.storage.sync.set({
        customEngine: config.engine,
        customApiEndpoint: config.endpoint,
        customModel: config.model
      }, () => {
        chrome.storage.local.set({ customApiKey: config.apiKey }, () => {
          chrome.storage.sync.remove('customApiKey');
          showStatus(apiSaveTip, '配置已保存；可使用“测试连接”验证', 'success');
        });
      });
    });
  }

  function renderGlossaryPacks() {
    if (!glossaryPackList) return;
    glossaryPackList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = enabledGlossaryPacks.includes(checkbox.value);
    });
  }

  function renderGlossaryList() {
    if (!userGlossaryList) return;
    const keyword = glossarySearch ? glossarySearch.value.trim().toLowerCase() : '';
    const visibleEntries = userGlossary.filter((entry) =>
      !keyword || entry.source.toLowerCase().includes(keyword) || entry.target.toLowerCase().includes(keyword)
    );
    if (glossaryCount) glossaryCount.textContent = `${userGlossary.length} 条自定义`;
    if (visibleEntries.length === 0) {
      userGlossaryList.innerHTML = '<div class="empty-hint">暂无匹配的自定义术语</div>';
      return;
    }
    userGlossaryList.innerHTML = visibleEntries.map((entry) => `
      <div class="glossary-row" data-source="${escapeHtml(entry.source)}">
        <span class="glossary-source">${escapeHtml(entry.source)}</span>
        <span class="glossary-target">${escapeHtml(entry.target)}</span>
        <span class="glossary-row-actions">
          <button data-action="edit" title="编辑术语">✎</button>
          <button data-action="delete" title="删除术语">×</button>
        </span>
      </div>
    `).join('');
  }

  function persistGlossaryState(entries, packs, successMessage) {
    chrome.storage.local.get({ glossaryVersion: 0 }, (stored) => {
      userGlossary = entries;
      enabledGlossaryPacks = packs;
      chrome.storage.local.set({
        userGlossary,
        enabledGlossaryPacks,
        glossaryVersion: (Number(stored.glossaryVersion) || 0) + 1
      }, () => {
        renderGlossaryPacks();
        renderGlossaryList();
        showStatus(glossaryStatus, successMessage, 'success');
      });
    });
  }

  function resetGlossaryEditor() {
    editingGlossarySource = '';
    if (glossarySource) glossarySource.value = '';
    if (glossaryTarget) glossaryTarget.value = '';
    if (btnSaveTerm) btnSaveTerm.textContent = '添加';
    if (btnCancelTerm) btnCancelTerm.style.display = 'none';
  }

  if (glossaryPackList) {
    glossaryPackList.addEventListener('change', () => {
      const packs = Array.from(glossaryPackList.querySelectorAll('input:checked')).map((input) => input.value);
      persistGlossaryState(userGlossary, packs, '内置术语包设置已更新');
    });
  }

  if (btnSaveTerm) {
    btnSaveTerm.addEventListener('click', () => {
      const source = glossarySource.value.trim();
      const target = glossaryTarget.value.trim();
      if (!source || !target) {
        showStatus(glossaryStatus, '英文术语和中文译法都不能为空', 'error');
        return;
      }
      if (!dictService.isEnglishSourceText(source)) {
        showStatus(glossaryStatus, '术语源文本必须是英语', 'error');
        return;
      }
      const baseEntries = editingGlossarySource
        ? userGlossary.filter((entry) => entry.source !== editingGlossarySource)
        : userGlossary;
      const merged = GlossaryService.mergeEntries(baseEntries, [{ source, target }]);
      persistGlossaryState(merged.entries, enabledGlossaryPacks, editingGlossarySource ? '术语已更新' : '术语已添加');
      resetGlossaryEditor();
    });
  }

  if (btnCancelTerm) btnCancelTerm.addEventListener('click', resetGlossaryEditor);
  if (glossarySearch) glossarySearch.addEventListener('input', renderGlossaryList);

  if (userGlossaryList) {
    userGlossaryList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      const row = event.target.closest('.glossary-row');
      if (!button || !row) return;
      const source = row.dataset.source;
      const entry = userGlossary.find((item) => item.source === source);
      if (!entry) return;
      if (button.dataset.action === 'edit') {
        editingGlossarySource = entry.source;
        glossarySource.value = entry.source;
        glossaryTarget.value = entry.target;
        btnSaveTerm.textContent = '保存';
        btnCancelTerm.style.display = 'inline-flex';
        glossarySource.focus();
      } else if (button.dataset.action === 'delete') {
        persistGlossaryState(
          userGlossary.filter((item) => item.source !== source),
          enabledGlossaryPacks,
          '术语已删除'
        );
      }
    });
  }

  if (inputGlossaryFile) {
    inputGlossaryFile.addEventListener('change', async () => {
      const file = inputGlossaryFile.files && inputGlossaryFile.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const incoming = file.name.toLowerCase().endsWith('.json')
          ? GlossaryService.parseJson(text)
          : GlossaryService.parseCsv(text);
        const merged = GlossaryService.mergeEntries(userGlossary, incoming);
        persistGlossaryState(
          merged.entries,
          enabledGlossaryPacks,
          `导入完成：新增 ${merged.stats.added}，更新 ${merged.stats.updated}，忽略 ${merged.stats.ignored}`
        );
      } catch (error) {
        showStatus(glossaryStatus, error.message || '术语文件导入失败', 'error');
      } finally {
        inputGlossaryFile.value = '';
      }
    });
  }

  if (btnExportGlossary) {
    btnExportGlossary.addEventListener('click', () => {
      const csvEscape = (value) => `"${String(value).replace(/"/g, '""')}"`;
      const csv = ['source,target']
        .concat(userGlossary.map((entry) => `${csvEscape(entry.source)},${csvEscape(entry.target)}`))
        .join('\n');
      downloadFile(`\uFEFF${csv}`, 'paperdict-glossary.csv', 'text/csv;charset=utf-8');
      showStatus(glossaryStatus, `已导出 ${userGlossary.length} 条术语`, 'success');
    });
  }

  if (btnClearGlossary) {
    btnClearGlossary.addEventListener('click', () => {
      if (!userGlossary.length) return;
      if (!confirm(`确定清空 ${userGlossary.length} 条自定义术语吗？`)) return;
      persistGlossaryState([], enabledGlossaryPacks, '自定义术语已清空');
      resetGlossaryEditor();
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
