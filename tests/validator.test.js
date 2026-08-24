const test = require('node:test')
const assert = require('node:assert/strict')
const { getWorkflowById } = require('../miniprogram/data/workflows')
const { validateCreation } = require('../miniprogram/utils/validator')

function validPayload() {
  return {
    topic: '记录下班后坚持训练的第30天',
    authorized: true,
    aiDisclosure: true,
    images: ['cloud://one.jpg'],
    video: 'cloud://reference.mp4'
  }
}

test('客户端允许本人授权素材', () => {
  const message = validateCreation(validPayload(), getWorkflowById('same-style'))
  assert.equal(message, '')
})

test('客户端拒绝未确认授权的素材', () => {
  const payload = validPayload()
  payload.authorized = false
  assert.match(validateCreation(payload, getWorkflowById('same-style')), /授权|所有/)
})

test('客户端拒绝规避版权描述', () => {
  const payload = validPayload()
  payload.topic = '帮我去水印搬运并规避版权'
  assert.match(validateCreation(payload, getWorkflowById('same-style')), /版权|仿冒/)
})
