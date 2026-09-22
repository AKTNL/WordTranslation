/**
 * Test Suite: Paper-specific Glossary Extractor & DictService Integration (Phase 3 P0)
 */

const { GlossaryExtractor } = require('../extension/glossary_extractor.js');
const { DictService } = require('../extension/dict_service.js');

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

console.log('=== Running Paper-specific Glossary Tests ===\n');

// Test 1: Acronym Matching Heuristics
console.log('[Test 1: Acronym Matching Algorithm]');
assert(GlossaryExtractor.matchesAcronym('LoRA', 'Low-Rank Adaptation'), 'Matches LoRA to Low-Rank Adaptation');
assert(GlossaryExtractor.matchesAcronym('DPO', 'Direct Preference Optimization'), 'Matches DPO to Direct Preference Optimization');
assert(GlossaryExtractor.matchesAcronym('ViT', 'Vision Transformer'), 'Matches ViT to Vision Transformer');
assert(GlossaryExtractor.matchesAcronym('RoPE', 'Rotary Position Embedding'), 'Matches RoPE to Rotary Position Embedding');
assert(!GlossaryExtractor.matchesAcronym('XYZ', 'Completely Unrelated String'), 'Rejects mismatching acronyms');

// Test 2: Extraction from Scientific Paper Sentences
console.log('\n[Test 2: Extract Terms from Paper Sentences]');
const extractor = new GlossaryExtractor();

const samplePaperText = `
In this work, we propose Low-Rank Adaptation (LoRA), which freezes the pre-trained model weights.
Furthermore, we employ Direct Preference Optimization (DPO) to align our models with human feedback.
For vision tasks, we incorporate ViT (Vision Transformer) backbones.
Throughout the experiments, we define MPO as Multi-Policy Optimization benchmark.
`;

const extracted = extractor.extractFromText(samplePaperText);
assert(extracted.length >= 4, `Extracted ${extracted.length} academic terms (expected >= 4)`);

const lora = extractor.lookup('LoRA');
assert(lora && lora.definition === 'Low-Rank Adaptation', 'Found LoRA definition');
assert(lora.sentence.includes('freezes the pre-trained model weights'), 'Context sentence preserved for LoRA');

const dpo = extractor.lookup('dpo');
assert(dpo && dpo.definition === 'Direct Preference Optimization', 'Case-insensitive lookup for DPO');

const vit = extractor.lookup('ViT');
assert(vit && vit.definition === 'Vision Transformer', 'Acronym-first format recognized (ViT)');

const mpo = extractor.lookup('MPO');
assert(mpo && mpo.definition.includes('Multi-Policy Optimization'), 'Explicit definition clause recognized (MPO)');

// Test 3: Integration with DictService
console.log('\n[Test 3: Integration with DictService Lookup]');
const dictService = new DictService({
  transformer: [['trænsˈfɔːrmər'], 'n. 变压器; [计] 变换器']
});

dictService.setPaperGlossary(extractor);

// Query for LoRA (not in standard dictionary)
const resLoRA = dictService.lookupLocal('LoRA');
assert(resLoRA && resLoRA.found, 'LoRA found via paper glossary');
assert(resLoRA.isPaperGlossary === true, 'Flagged as paper-specific glossary term');
assert(resLoRA.baseWord === 'LoRA', 'Base word matches extracted term');
assert(resLoRA.translation.includes('Low-Rank Adaptation'), 'Translation presents paper definition');
assert(resLoRA.translation.includes('freezes the pre-trained model weights'), 'Translation presents context sentence');

// Lowercase lookup still hits glossary
const resLower = dictService.lookupLocal('lora');
assert(resLower && resLower.isPaperGlossary === true, 'Lowercase lora successfully hits paper glossary');

// Standard word in general dictionary still works
const resTrans = dictService.lookupLocal('transformer');
assert(resTrans && resTrans.found && !resTrans.isPaperGlossary, 'Standard word falls back to offline dictionary');

console.log(`\n==============================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
