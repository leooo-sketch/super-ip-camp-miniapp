const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('CloudBase doc.set 不把系统 _id 重复写进 data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'ipcamp-api', 'index.js'), 'utf8')
  const setBlocks = source.match(/\.set\(\{ data: [\s\S]{0,700}?\}\s*\)/g) || []
  assert.ok(setBlocks.length >= 4)
  for (const block of setBlocks) assert.doesNotMatch(block, /\b_id\s*:/)
})
