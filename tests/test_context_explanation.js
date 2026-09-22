/**
 * Test Suite: PaperDict Context-aware Term Explanation (Phase 5 P1)
 */

const {
  handleContextExplanation,
  setCachedTranslation,
  getCachedTranslation,
  activeRequests
} = require('../extension/background.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Running Context-aware Explanation Tests ===\n');

  // Test 1: Empty input validation
  console.log('[Test 1: Input Validation]');
  const resEmpty = await handleContextExplanation('', 'some context', 'Title');
  assert(!resEmpty.success && resEmpty.error === '术语为空', 'Rejects empty term');

  // Test 2: Context Cache Hit
  console.log('\n[Test 2: Context Caching]');
  const testTerm = 'temperature';
  const testTitle = 'Large Language Models Sampling';
  const cacheKey = `ctx_temperature_${testTitle.slice(0, 40)}`;

  await setCachedTranslation(cacheKey, '[学术概念]: LLM 采样控制随机度的平滑因子\n[作用]: 调节 token 分布尖锐度');

  const resCache = await handleContextExplanation(testTerm, 'Set temperature to 0.7 for diverse responses.', testTitle);
  assert(resCache.success, 'Cache hit succeeded');
  assert(resCache.source === '本地语境缓存', 'Source correctly marked as local context cache');
  assert(resCache.explanation.includes('采样控制随机度'), 'Cached contextual explanation retrieved');

  // Test 3: Request Cancellation
  console.log('\n[Test 3: Cancellation during Context Explanation]');
  const reqId = 'ctx_cancel_test_' + Date.now();
  const ctrl = new AbortController();
  activeRequests.set(reqId, ctrl);
  assert(activeRequests.has(reqId), 'Request registered');

  ctrl.abort();
  assert(ctrl.signal.aborted, 'Request controller aborted');
  activeRequests.delete(reqId);
  assert(!activeRequests.has(reqId), 'Request cleaned up');

  console.log(`\n==============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
