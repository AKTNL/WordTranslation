const assert = require('assert');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
  }
}

function createChromeMock(options = {}) {
  let sendCount = 0;
  const injections = [];
  const failuresBeforeSuccess = options.failuresBeforeSuccess === undefined ? 1 : options.failuresBeforeSuccess;
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      sendMessage(tabId, message, callback) {
        sendCount++;
        if (sendCount <= failuresBeforeSuccess) {
          chromeApi.runtime.lastError = { message: 'Receiving end does not exist.' };
          callback(undefined);
          chromeApi.runtime.lastError = null;
          return;
        }
        callback({ success: true, mode: message.mode });
      }
    },
    scripting: {
      async insertCSS(details) { injections.push({ type: 'css', details }); },
      async executeScript(details) {
        injections.push({ type: details.func ? 'probe' : 'js', details });
        if (options.injectionError && !details.func) throw options.injectionError;
        if (details.func) return [{ result: options.probeResult || { contentLoaded: false, managerLoaded: false } }];
      }
    }
  };
  return { chromeApi, injections, getSendCount: () => sendCount };
}

async function run() {
  console.log('=== PaperDict Tab Bridge Tests ===');
  const { sendMessageWithRecovery } = require('../extension/popup/tab_bridge.js');

  await test('reinjects content scripts and retries after an extension reload', async () => {
    const mock = createChromeMock();
    const result = await sendMessageWithRecovery(
      mock.chromeApi,
      { id: 42, url: 'https://example.com/paper' },
      { type: 'SET_BILINGUAL_MODE', mode: 'bilingual' }
    );

    assert.deepEqual(result, { success: true, mode: 'bilingual' });
    assert.equal(mock.getSendCount(), 2);
    assert.equal(mock.injections.length, 3);
    assert.equal(mock.injections[0].type, 'probe');
    assert.equal(mock.injections[1].type, 'css');
    assert.equal(mock.injections[2].type, 'js');
    assert(mock.injections[2].details.files.includes('bilingual.js'));
  });

  await test('coalesces concurrent GET and SET recovery for the same tab', async () => {
    const mock = createChromeMock({ failuresBeforeSuccess: 2 });
    const tab = { id: 42, url: 'https://example.com/paper' };
    const [status, mode] = await Promise.all([
      sendMessageWithRecovery(mock.chromeApi, tab, { type: 'GET_BILINGUAL_MODE' }),
      sendMessageWithRecovery(mock.chromeApi, tab, { type: 'SET_BILINGUAL_MODE', mode: 'chinese' })
    ]);

    assert.equal(status.success, true);
    assert.equal(mode.mode, 'chinese');
    assert.equal(mock.injections.filter((item) => item.type === 'js').length, 1);
  });

  await test('injects only the bilingual manager when selection content is already loaded', async () => {
    const mock = createChromeMock({
      probeResult: { contentLoaded: true, managerLoaded: false }
    });
    await sendMessageWithRecovery(
      mock.chromeApi,
      { id: 42, url: 'https://example.com/paper' },
      { type: 'GET_BILINGUAL_MODE' }
    );
    const scriptInjection = mock.injections.find((item) => item.type === 'js');
    assert.deepEqual(scriptInjection.details.files, ['bilingual.js']);
  });

  await test('reexecutes the bilingual bootstrap when a stale manager is detected', async () => {
    const mock = createChromeMock({
      probeResult: { contentLoaded: true, managerLoaded: true }
    });
    await sendMessageWithRecovery(
      mock.chromeApi,
      { id: 42, url: 'https://example.com/paper' },
      { type: 'GET_BILINGUAL_MODE' }
    );
    const scriptInjection = mock.injections.find((item) => item.type === 'js');
    assert.deepEqual(scriptInjection.details.files, ['bilingual.js']);
  });

  await test('does not inject when the content script is already healthy', async () => {
    const mock = createChromeMock({ failuresBeforeSuccess: 0 });
    const result = await sendMessageWithRecovery(
      mock.chromeApi,
      { id: 42, url: 'https://example.com/paper' },
      { type: 'SET_BILINGUAL_MODE', mode: 'bilingual' }
    );
    assert.equal(result.mode, 'bilingual');
    assert.equal(mock.injections.length, 0);
  });

  await test('reports restricted browser pages instead of failing silently', async () => {
    const mock = createChromeMock();
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 7, url: 'edge://extensions/' },
        { type: 'SET_BILINGUAL_MODE', mode: 'chinese' }
      ),
      (error) => error.code === 'RESTRICTED_PAGE' && /\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u6574\u9875\u7ffb\u8bd1/.test(error.message)
    );
    assert.equal(mock.injections.length, 0);
  });

  await test('reports browser extension stores as permanently restricted', async () => {
    const mock = createChromeMock();
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 8, url: 'https://microsoftedge.microsoft.com/addons/detail/example' },
        { type: 'GET_BILINGUAL_MODE' }
      ),
      (error) => error.code === 'EXTENSION_STORE' && /扩展商店/.test(error.message)
    );
    assert.equal(mock.injections.length, 0);
  });

  await test('gives file-access guidance when local page injection is denied', async () => {
    const mock = createChromeMock({ injectionError: new Error('Cannot access contents of url') });
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 9, url: 'file:///C:/papers/paper.html' },
        { type: 'GET_BILINGUAL_MODE' }
      ),
      (error) => error.code === 'FILE_ACCESS_REQUIRED' && /允许访问文件网址/.test(error.message)
    );
  });

  await test('directs reader pages to their built-in mode controls', async () => {
    const mock = createChromeMock();
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 10, url: 'chrome-extension://extension-id/reader/reader.html' },
        { type: 'SET_BILINGUAL_MODE', mode: 'bilingual' }
      ),
      (error) => error.code === 'READER_PAGE' && /阅读器顶部/.test(error.message)
    );
  });

  await test('directs native PDF tabs to the PaperDict reader', async () => {
    const mock = createChromeMock();
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 11, url: 'https://example.com/paper.pdf' },
        { type: 'SET_BILINGUAL_MODE', mode: 'chinese' }
      ),
      (error) => error.code === 'PDF_PAGE' && /PaperDict 阅读器/.test(error.message)
    );
  });

  await test('recognizes PDF routes without a .pdf suffix', async () => {
    const mock = createChromeMock();
    await assert.rejects(
      sendMessageWithRecovery(
        mock.chromeApi,
        { id: 12, url: 'https://arxiv.org/pdf/2401.12345' },
        { type: 'GET_BILINGUAL_MODE' }
      ),
      (error) => error.code === 'PDF_PAGE'
    );
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
