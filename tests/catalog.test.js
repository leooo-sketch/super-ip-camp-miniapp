const test = require('node:test')
const assert = require('node:assert/strict')
const { workflows } = require('../miniprogram/data/workflows')
const { WORKFLOWS } = require('../cloudfunctions/ipcamp-api/lib/catalog')

test('已开放的前端工作流都有服务端计费配置', () => {
  const enabled = workflows.filter((item) => item.enabled)
  assert.ok(enabled.length >= 1)
  for (const workflow of enabled) {
    assert.ok(WORKFLOWS[workflow.id], `缺少 ${workflow.id} 的服务端配置`)
    assert.equal(WORKFLOWS[workflow.id].tokenCost, workflow.tokenCost)
  }
})
