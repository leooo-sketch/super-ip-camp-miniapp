const test = require('node:test')
const assert = require('node:assert/strict')
const { WORKFLOWS } = require('../cloudfunctions/ipcamp-api/lib/catalog')
const { validatePayload } = require('../cloudfunctions/ipcamp-api/lib/compliance')
const { buildDirectorPrompt } = require('../cloudfunctions/ipcamp-api/lib/prompt')
const { buildKlingRequest } = require('../cloudfunctions/ipcamp-api/lib/providers/kling')
const { buildToApisRequest, normalizeBaseUrl, outputUrl } = require('../cloudfunctions/ipcamp-api/lib/providers/toapis')
const { buildKlingDirectRequest, normalizeTask } = require('../cloudfunctions/ipcamp-api/lib/providers/kling-direct')

function payload(overrides = {}) {
  return {
    workflowId: 'same-style',
    topic: '真实记录一周三练后的状态',
    sourceType: 'self-owned',
    authorized: true,
    aiDisclosure: true,
    images: ['cloud://image.jpg'],
    video: 'cloud://video.mp4',
    ratio: '9:16',
    resolution: '720p',
    removeAudio: true,
    ...overrides
  }
}

test('服务端再次校验授权和素材数量', () => {
  const value = validatePayload(payload(), WORKFLOWS['same-style'])
  assert.equal(value.topic, '真实记录一周三练后的状态')
  assert.equal(value.images.length, 1)
})

test('服务端拒绝未授权视频', () => {
  assert.throws(
    () => validatePayload(payload({ authorized: false }), WORKFLOWS['same-style']),
    /授权/
  )
})

test('导演提示词要求重构而非复制', () => {
  const prompt = buildDirectorPrompt(payload())
  assert.match(prompt, /不复制参考素材/)
  assert.match(prompt, /真实皮肤纹理/)
  assert.match(prompt, /无文字水印/)
})

test('可灵同款路由使用基础视频与本人参考图', () => {
  const request = buildKlingRequest({
    mode: 'trending',
    video: 'https://example.com/self.mp4',
    images: ['https://example.com/me.jpg'],
    prompt: '真实健身记录',
    resolution: '1080p',
    aspectRatio: '9:16',
    removeAudio: true
  })
  assert.equal(request.model, 'kling/kling-v3-omni-video-generation')
  assert.equal(request.input.media[0].type, 'base')
  assert.equal(request.input.media[0].keep_original_sound, 'no')
  assert.equal(request.input.media[1].type, 'refer')
  assert.match(request.input.prompt, /<<<video_1>>>/)
  assert.equal(request.parameters.mode, 'pro')
})

test('ToAPIs 图生视频只把首图作为首帧，其余图片作为参考', () => {
  const request = buildToApisRequest({
    mode: 'img2video',
    images: ['https://example.com/me.jpg', 'https://example.com/clothes.jpg'],
    prompt: '真实自然的男士通勤穿搭展示',
    resolution: '1080p',
    aspectRatio: '9:16',
    duration: 10
  }, { videoModel: 'kling-v3' })
  assert.equal(request.model, 'kling-v3')
  assert.equal(request.mode, 'pro')
  assert.deepEqual(request.image_with_roles, [{ url: 'https://example.com/me.jpg', role: 'first_frame' }])
  assert.deepEqual(request.reference_images, ['https://example.com/clothes.jpg'])
})

test('ToAPIs 授权视频重构使用支持视频输入的 O1 模型', () => {
  const request = buildToApisRequest({
    mode: 'trending',
    images: ['https://example.com/me.jpg'],
    video: 'https://example.com/source.mp4',
    prompt: '保留通用节奏并重建原创场景',
    resolution: '720p',
    aspectRatio: '9:16',
    duration: 10,
    removeAudio: true,
    clientBusinessId: 'task-1'
  })
  assert.equal(request.model, 'kling-video-o1')
  assert.equal(request.video_list[0].keep_original_sound, 'no')
  assert.match(request.prompt, /<<<video_1>>>/)
  assert.match(request.prompt, /<<<image_1>>>/)
})

test('ToAPIs 地址白名单与完成结果解析', () => {
  assert.equal(normalizeBaseUrl('https://toapis.com/v1/'), 'https://toapis.com/v1')
  assert.throws(() => normalizeBaseUrl('https://example.com/v1'), /允许列表/)
  assert.equal(outputUrl({ result: { data: [{ url: 'https://example.com/result.mp4' }] } }), 'https://example.com/result.mp4')
})

test('Kling 3.0 Turbo 官方图生视频请求使用首帧素材', () => {
  const request = buildKlingDirectRequest({
    images: ['https://example.com/first.jpg', 'https://example.com/reference.jpg'],
    prompt: '真实自然的创作者工作场景',
    resolution: '1080p',
    duration: 10,
    clientBusinessId: 'task-1'
  })
  assert.equal(request.contents[0].type, 'prompt')
  assert.deepEqual(request.contents[1], { type: 'first_frame', url: 'https://example.com/first.jpg' })
  assert.equal(request.settings.resolution, '1080p')
  assert.equal(request.settings.duration, 10)
  assert.equal(request.options.external_task_id, 'task-1')
})

test('Kling 3.0 Turbo 完成结果解析', () => {
  const state = normalizeTask({ data: [{ id: 'k-1', status: 'succeeded', outputs: [{ type: 'video', url: 'https://example.com/result.mp4' }] }] })
  assert.equal(state.providerTaskId, 'k-1')
  assert.equal(state.status, 'succeeded')
  assert.equal(state.outputUrl, 'https://example.com/result.mp4')
})
