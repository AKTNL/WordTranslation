/**
 * Test Suite: Translation Cache & Request Cancellation / Concurrency Coalescing
 */

const {
  normalizeQuery,
  createCombinedSignal,
  activeRequests,
  pendingInFlight,
  getCachedTranslation,
  setCachedTranslation,
  memoryCache
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
  console.log('=== Running Translation Cache & Cancellation Tests ===\n');

  // Test 1: Query normalization
  console.log('[Test 1: normalizeQuery]');
  assert(normalizeQuery('  neural   network  \n ') === 'neural network', 'Multiple whitespace and newlines collapsed');
  assert(normalizeQuery('') === '', 'Empty string handled safely');
  assert(normalizeQuery(null) === '', 'Null input handled safely');
  assert(normalizeQuery('transformer') === 'transformer', 'Standard word unchanged');

  // Test 2: Combined Signal & Abort propagation
  console.log('\n[Test 2: Combined AbortSignal Propagation]');
  const parentCtrl = new AbortController();
  const combo = createCombinedSignal(parentCtrl.signal, 5000);
  assert(!combo.signal.aborted, 'Initial combo signal is not aborted');

  parentCtrl.abort(new Error('User cancelled'));
  assert(combo.signal.aborted, 'Combo signal correctly aborted when parent aborted');
  combo.cleanup();

  // Test 3: Combined Signal Timeout
  console.log('\n[Test 3: Combined AbortSignal Timeout]');
  const fastCombo = createCombinedSignal(null, 50);
  assert(!fastCombo.signal.aborted, 'Before timeout, signal not aborted');
  await new Promise((r) => setTimeout(r, 70));
  assert(fastCombo.signal.aborted, 'Signal aborted on timeout expiration');
  fastCombo.cleanup();

  // Test 4: Memory Cache operations
  console.log('\n[Test 4: Cache storage and retrieval]');
  await setCachedTranslation('deep residual learning', '深度残差学习');
  const hit = await getCachedTranslation('  deep   residual   learning  ');
  assert(hit === '深度残差学习', 'Normalized cache hit succeeds');

  const miss = await getCachedTranslation('unknown academic text 12345');
  assert(miss === null, 'Cache miss returns null');

  // Test 5: Active requests map
  console.log('\n[Test 5: Active Request Cancellation Tracker]');
  const testReqId = 'test_req_' + Date.now();
  const ctrl = new AbortController();
  activeRequests.set(testReqId, ctrl);
  assert(activeRequests.has(testReqId), 'Active request registered in tracker');

  ctrl.abort();
  assert(ctrl.signal.aborted, 'Controller signal aborted');
  activeRequests.delete(testReqId);
  assert(!activeRequests.has(testReqId), 'Active request cleanly deregistered');

  console.log(`\n==============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
