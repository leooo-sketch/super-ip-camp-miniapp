const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createInputs,
  normalizeBaseUrl,
  parseWorkflowOutput
} = require('../cloudfunctions/ipcamp-api/lib/providers/dify')

test('Dify 地址默认只允许官方 API 域名', () => {
  assert.equal(normalizeBaseUrl('https://api.dify.ai/v1/'), 'https://api.dify.ai/v1')
  assert.throws(() => normalizeBaseUrl('https://example.com/v1'), /允许列表/)
  assert.equal(normalizeBaseUrl('https://dify.example.cn/v1', 'dify.example.cn'), 'https://dify.example.cn/v1')
})

test('Dify 创建输入保持现有 provider 契约', () => {
  const inputs = createInputs({
    workflowId: 'viral-film',
    clientBusinessId: 'task-1',
    prompt: '导演提示词',
    images: ['https://example.com/first.jpg'],
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 10
  })
  assert.equal(inputs.operation, 'create')
  assert.equal(inputs.workflow_id, 'viral-film')
  assert.equal(inputs.images_json, '["https://example.com/first.jpg"]')
  assert.equal(inputs.resolution, '1080p')
})

test('Dify Workflow blocking 输出可归一化', () => {
  const result = parseWorkflowOutput({
    data: {
      status: 'succeeded',
      outputs: {
        result_json: JSON.stringify({
          ok: true,
          data: { provider_task_id: 'py-1', status: 'processing' }
        })
      }
    }
  })
  assert.equal(result.provider_task_id, 'py-1')
  assert.equal(result.status, 'processing')
})
