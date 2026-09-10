import assert from 'node:assert/strict'
import {searchExcerpt} from '../dist-electron/searchExcerpt.js'

const prefix = '🧪··· '.repeat(120)
const source = prefix + 'Background is irrelevant. The measured U–Pb ratio retained ²⁰⁶Pb in the specimen. A later result differs.'
const result = searchExcerpt(source, 'u pb ratio')
assert(result.includes('The measured U–Pb ratio retained ²⁰⁶Pb in the specimen.'))
assert(!result.includes('🧪'), 'Normalized offsets must map back past removed punctuation and emoji')
assert(!result.includes('206Pb'), 'Preview must retain source typography, not normalized spelling')

const composed = 'Unrelated material. ' + 'ﬃ '.repeat(80) + 'The coeﬃcient measured in this experiment was stable. Next sentence.'
assert(searchExcerpt(composed, 'coefficient').includes('The coeﬃcient measured in this experiment was stable.'))
const korean = '서론. 이 시편의 기공 비율은 전체 개수로 계산했다. 결론.'
assert(searchExcerpt(korean, '기공 비율').includes('기공 비율은 전체 개수로 계산했다.'))
const words = 'background '.repeat(50) + 'conductivity describes heat transfer under these conditions. ' + 'context '.repeat(50)
const excerpt = searchExcerpt(words, 'how conductivity is measured')
assert(excerpt.includes('conductivity describes heat transfer'))
assert(!excerpt.startsWith('…ground'), 'Normal words must not start with suffix fragments')
const late = searchExcerpt('context '.repeat(22) + 'conductivity was measured.', 'conductivity')
assert(late.indexOf('conductivity') < 50, 'The matching term should be visible near the start of a narrow result preview')

const emoji = '🧬'.repeat(5000)
const bounded = searchExcerpt(emoji, 'absent')
assert(bounded.length <= 321, 'Long unbroken content must not create an unbounded preview')
assert.equal(bounded.isWellFormed(), true)
assert.equal(searchExcerpt('', 'query'), '')
assert.equal(searchExcerpt('A short sentence.', 'missing'), 'A short sentence.')
console.log('search-excerpt: original offsets after Unicode normalization, source typography, sentence/word context and bounded unbroken text passed')
