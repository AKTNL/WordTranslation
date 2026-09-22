/**
 * PaperDict online translation adapters with strict engine routing.
 */
(function (global) {
  'use strict';

  const ERROR_MESSAGES = {
    INVALID_CONFIG: '翻译引擎配置不完整',
    INVALID_ENDPOINT: 'API Endpoint 必须是有效的 HTTP 或 HTTPS 地址',
    AUTHENTICATION_FAILED: 'API Key 无效或认证失败',
    PERMISSION_DENIED: '当前 API Key 没有访问该服务或模型的权限',
    NOT_FOUND: 'API Endpoint 或模型不存在',
    RATE_LIMITED: '请求过于频繁或额度已用尽，请稍后重试',
    INVALID_RESPONSE: '翻译服务返回了无法识别的数据',
    SERVICE_UNAVAILABLE: '翻译服务暂时不可用',
    TIMEOUT: '连接翻译服务超时',
    NETWORK_ERROR: '无法连接翻译服务，请检查网络与 Endpoint',
    TRANSLATION_FAILED: '在线翻译失败，请稍后重试'
  };

  function failure(code, engine, detail = '') {
    return {
      success: false,
      code,
      error: detail || ERROR_MESSAGES[code] || ERROR_MESSAGES.TRANSLATION_FAILED,
      engine
    };
  }

  function validateEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (error) {
      return false;
    }
  }

  function httpFailure(status, engine) {
    if (status === 400) return failure('INVALID_CONFIG', engine, '请求参数无效，请检查 Endpoint 与模型名称');
    if (status === 401) return failure('AUTHENTICATION_FAILED', engine);
    if (status === 403) return failure('PERMISSION_DENIED', engine);
    if (status === 404) return failure('NOT_FOUND', engine);
    if (status === 429) return failure('RATE_LIMITED', engine);
    if (status >= 500) return failure('SERVICE_UNAVAILABLE', engine);
    return failure('TRANSLATION_FAILED', engine, `翻译服务请求失败 (HTTP ${status})`);
  }

  function buildCacheKey(text, config = {}) {
    return JSON.stringify([
      config.engine || 'default',
      config.endpoint || '',
      config.model || '',
      Number(config.glossaryVersion) || 0,
      String(text || '').trim()
    ]);
  }

  function shouldRequestOnline(settings = {}) {
    return settings.onlineFallback !== false;
  }

  class TranslationService {
    constructor(options = {}) {
      this.fetchImpl = options.fetchImpl || global.fetch;
      this.timeoutMs = options.timeoutMs || 10000;
    }

    validateConfig(config = {}) {
      const engine = config.engine || 'default';
      if (!['default', 'openai', 'deepl'].includes(engine)) return failure('INVALID_CONFIG', engine);
      if (engine === 'default') return { success: true };
      if (!String(config.apiKey || '').trim()) return failure('INVALID_CONFIG', engine, '请填写 API Key');
      if (engine === 'openai' && !String(config.model || '').trim()) {
        return failure('INVALID_CONFIG', engine, '请填写模型名称');
      }
      const endpoint = this.resolveEndpoint(config);
      if (!validateEndpoint(endpoint)) return failure('INVALID_ENDPOINT', engine);
      return { success: true, endpoint };
    }

    resolveEndpoint(config) {
      if (config.endpoint) return String(config.endpoint).trim();
      if (config.engine === 'openai') return 'https://api.openai.com/v1/chat/completions';
      if (config.engine === 'deepl') {
        return String(config.apiKey || '').endsWith(':fx')
          ? 'https://api-free.deepl.com/v2/translate'
          : 'https://api.deepl.com/v2/translate';
      }
      return '';
    }

    async request(url, options, engine) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.fetchImpl(url, Object.assign({}, options, { signal: controller.signal }));
      } catch (error) {
        if (error && error.name === 'AbortError') return failure('TIMEOUT', engine);
        return failure('NETWORK_ERROR', engine);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async translate(text, config = {}) {
      const query = String(text || '').trim();
      const engine = config.engine || 'default';
      if (!query) return failure('INVALID_CONFIG', engine, '输入文本为空');

      const validation = this.validateConfig(config);
      if (!validation.success) return validation;
      if (engine === 'openai') return this.translateOpenAI(query, config, validation.endpoint);
      if (engine === 'deepl') return this.translateDeepL(query, config, validation.endpoint);
      return this.translatePublic(query);
    }

    async translateOpenAI(text, config, endpoint) {
      const engine = 'openai';
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${String(config.apiKey).trim()}`
        },
        body: JSON.stringify({
          model: String(config.model).trim(),
          messages: [
            {
              role: 'system',
              content: 'Translate English academic text into professional Simplified Chinese. Preserve PDMATH_n and PDTERM_n tokens exactly. Output only the translation.'
            },
            { role: 'user', content: text }
          ],
          temperature: 0.2
        })
      }, engine);
      if (response && response.success === false) return response;
      if (!response.ok) return httpFailure(response.status, engine);

      try {
        const data = await response.json();
        const translation = data && data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || '').trim()
          : '';
        if (!translation) return failure('INVALID_RESPONSE', engine);
        return { success: true, translation, source: `OpenAI 兼容 API (${config.model})`, engine };
      } catch (error) {
        return failure('INVALID_RESPONSE', engine);
      }
    }

    async translateDeepL(text, config, endpoint) {
      const engine = 'deepl';
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `DeepL-Auth-Key ${String(config.apiKey).trim()}`
        },
        body: JSON.stringify({ text: [text], target_lang: 'ZH-HANS' })
      }, engine);
      if (response && response.success === false) return response;
      if (!response.ok) return httpFailure(response.status, engine);

      try {
        const data = await response.json();
        const translation = data && data.translations && data.translations[0]
          ? String(data.translations[0].text || '').trim()
          : '';
        if (!translation) return failure('INVALID_RESPONSE', engine);
        return { success: true, translation, source: 'DeepL 翻译 API', engine };
      } catch (error) {
        return failure('INVALID_RESPONSE', engine);
      }
    }

    async translatePublic(text) {
      const engine = 'default';
      const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
      const myMemoryResponse = await this.request(myMemoryUrl, { method: 'GET' }, engine);
      if (myMemoryResponse && myMemoryResponse.ok) {
        try {
          const data = await myMemoryResponse.json();
          const translation = data && data.responseData
            ? String(data.responseData.translatedText || '').trim()
            : '';
          if (translation && !translation.startsWith('MYMEMORY WARNING')) {
            return { success: true, translation, source: 'MyMemory 在线翻译', engine };
          }
        } catch (error) {}
      }

      const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
      const googleResponse = await this.request(googleUrl, { method: 'GET' }, engine);
      if (googleResponse && googleResponse.ok) {
        try {
          const data = await googleResponse.json();
          const translation = Array.isArray(data && data[0])
            ? data[0].map((item) => item && item[0] ? item[0] : '').join('').trim()
            : '';
          if (translation) return { success: true, translation, source: 'Google 在线翻译', engine };
        } catch (error) {}
      }

      if (googleResponse && googleResponse.success === false) return googleResponse;
      if (myMemoryResponse && myMemoryResponse.success === false) return myMemoryResponse;
      return failure('TRANSLATION_FAILED', engine);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TranslationService,
      ERROR_MESSAGES,
      validateEndpoint,
      buildCacheKey,
      shouldRequestOnline
    };
  } else {
    global.TranslationService = TranslationService;
    global.paperDictBuildCacheKey = buildCacheKey;
    global.paperDictShouldRequestOnline = shouldRequestOnline;
  }
})(typeof self !== 'undefined' ? self : globalThis);
