/**
 * Automated Edge Cases & UX Issue Verification Test
 */
const { DictService } = require('../extension/dict_service.js');
const dictData = require('../extension/dict/academic_dict.json');

const service = new DictService(dictData);

console.log('=== PaperDict UX & Edge Cases Diagnostics ===\n');

// 1. Test Possessive Suffix ('s)
console.log('[Check 1: Possessive Suffix]');
const possessiveLookup = service.lookupLocal("model's");
console.log('Lookup "model\'s":', possessiveLookup?.found ? 'FOUND' : 'FAILED (unhandled possessive)');

// 2. Test Mixed Chinese and English Text Selection
console.log('\n[Check 2: Mixed Chinese/English Selection]');
const mixedSentence = '这篇论文提出了一种新型 CNN 架构';
const mixedEligible = service.isLookupEligible(mixedSentence);
const mixedSingle = service.isSingleWord(mixedSentence);
console.log(`Sentence "${mixedSentence}":`);
console.log(`  - isLookupEligible: ${mixedEligible} (if true, triggers translation card on Chinese text)`);
console.log(`  - isSingleWord: ${mixedSingle}`);

// 3. Test Pure Chinese Selection
console.log('\n[Check 3: Pure Chinese Text Selection]');
const pureChinese = '深度学习模型训练过程';
console.log(`Sentence "${pureChinese}": isLookupEligible = ${service.isLookupEligible(pureChinese)}`);

// 4. Test Trailing Punctuation in Phrases
console.log('\n[Check 4: Trailing Punctuation in Multi-word Phrases]');
const phraseWithPeriod = service.cleanPaperText('deep learning.', true);
const phraseWithComma = service.cleanPaperText('natural language processing,', true);
console.log(`"deep learning." -> "${phraseWithPeriod}" (Trailing period kept: ${phraseWithPeriod.endsWith('.')})`);
console.log(`"natural language processing," -> "${phraseWithComma}" (Trailing comma kept: ${phraseWithComma.endsWith(',')})`);

// 5. Test Code / Math Snippets Selection
console.log('\n[Check 5: Code & Math Snippets Selection]');
const code1 = 'x = f(y) + z;';
const code2 = 'for (let i = 0; i < n; i++)';
console.log(`Code "${code1}": isLookupEligible = ${service.isLookupEligible(code1)}`);
console.log(`Code "${code2}": isLookupEligible = ${service.isLookupEligible(code2)}`);

// 6. Test Single Letter Selection
console.log('\n[Check 6: Single Letter Selection]');
console.log(`Letter "a": isLookupEligible = ${service.isLookupEligible('a')}`);
console.log(`Letter "x": isLookupEligible = ${service.isLookupEligible('x')}`);

console.log('\n=== Diagnostics Complete ===');
