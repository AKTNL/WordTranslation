const assert = require('assert');
const {
  TranslationService,
  buildCacheKey,
  shouldRequestOnline
} = require('../extension/translation_service.js');

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

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

async function run() {
  console.log('=== PaperDict Translation Engine Tests ===');

  await test('sends a real OpenAI-compatible chat completion request', async () => {
    const calls = [];
    const service = new TranslationService({
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { choices: [{ message: { content: '学术文本' } }] });
      }
    });

    const result = await service.translate('Academic text', {
      engine: 'openai',
      endpoint: 'https://example.test/v1/chat/completions',
      apiKey: 'secret',
      model: 'model-a'
    });

    assert.equal(result.success, true);
    assert.equal(result.engine, 'openai');
    assert.equal(result.translation, '学术文本');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
    assert.equal(JSON.parse(calls[0].options.body).model, 'model-a');
  });

  await test('sends DeepL authentication and target language', async () => {
    const calls = [];
    const service = new TranslationService({
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, { translations: [{ text: '置信区间' }] });
      }
    });

    const result = await service.translate('confidence interval', {
      engine: 'deepl',
      endpoint: 'https://api-free.deepl.com/v2/translate',
      apiKey: 'deepl-key:fx'
    });

    assert.equal(result.success, true);
    assert.equal(result.engine, 'deepl');
    assert.equal(calls[0].options.headers.Authorization, 'DeepL-Auth-Key deepl-key:fx');
    assert.equal(JSON.parse(calls[0].options.body).target_lang, 'ZH-HANS');
  });

  await test('returns authentication errors without public fallback', async () => {
    let calls = 0;
    const service = new TranslationService({
      fetchImpl: async () => {
        calls++;
        return response(401, { error: { message: 'invalid api key' } });
      }
    });

    const result = await service.translate('text', {
      engine: 'openai', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'bad', model: 'model-a'
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'AUTHENTICATION_FAILED');
    assert.equal(calls, 1);
  });

  await test('maps rate limiting to a stable error', async () => {
    const service = new TranslationService({ fetchImpl: async () => response(429, {}) });
    const result = await service.translate('text', {
      engine: 'deepl', endpoint: 'https://api.deepl.com/v2/translate', apiKey: 'key'
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'RATE_LIMITED');
  });

  await test('keeps the browser fetch receiver when no custom fetch is provided', async () => {
    const originalFetch = global.fetch;
    global.fetch = async function browserFetch() {
      if (this !== global) throw new TypeError('Illegal invocation');
      return response(200, { responseData: { translatedText: '你好' } });
    };

    try {
      const service = new TranslationService();
      const result = await service.translate('hello', { engine: 'default' });
      assert.equal(result.success, true);
      assert.equal(result.translation, '你好');
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('aborts requests that exceed the configured timeout', async () => {
    const service = new TranslationService({
      timeoutMs: 5,
      fetchImpl: (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    });
    const result = await service.translate('text', {
      engine: 'openai', endpoint: 'https://example.test/v1/chat/completions', apiKey: 'key', model: 'model-a'
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'TIMEOUT');
  });

  await test('isolates cache entries by engine, model, and glossary version', async () => {
    const base = buildCacheKey('text', { engine: 'openai', endpoint: 'https://api.test', model: 'a', glossaryVersion: 1 });
    assert.notEqual(base, buildCacheKey('text', { engine: 'openai', endpoint: 'https://api.test', model: 'b', glossaryVersion: 1 }));
    assert.notEqual(base, buildCacheKey('text', { engine: 'deepl', endpoint: 'https://api.test', model: 'a', glossaryVersion: 1 }));
    assert.notEqual(base, buildCacheKey('text', { engine: 'openai', endpoint: 'https://api.test', model: 'a', glossaryVersion: 2 }));
  });

  await test('does not request any online engine when online translation is disabled', async () => {
    assert.equal(shouldRequestOnline({ onlineFallback: false }), false);
    assert.equal(shouldRequestOnline({ onlineFallback: true }), true);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
