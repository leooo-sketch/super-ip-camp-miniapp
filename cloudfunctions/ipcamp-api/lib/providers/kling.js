const { requestJson } = require('../http')

function buildKlingRequest(input) {
  const editing = input.mode === 'trending'
  const media = editing
    ? [
        { type: 'base', url: input.video, keep_original_sound: input.removeAudio === false ? 'yes' : 'no' },
        ...input.images.slice(0, 6).map((url) => ({ type: 'refer', url }))
      ]
    : [{ type: 'first_frame', url: input.images[0] }]

  const imageReferences = editing
    ? input.images.slice(0, 6).map((_, index) => `<<<image_${index + 1}>>>`).join('、')
    : ''
  const prompt = editing
    ? `以 <<<video_1>>> 为已授权基础视频，使用 ${imageReferences} 作为同一位用户的人物参考。${input.prompt}`
    : input.prompt

  const body = {
    model: process.env.KLING_VIDEO_MODEL || 'kling/kling-v3-omni-video-generation',
    input: { prompt, media, multi_shot: false },
    parameters: {
      mode: input.resolution === '1080p' ? 'pro' : 'std',
      duration: editing ? 10 : Number(process.env.KLING_DURATION || 15),
      audio: false,
      watermark: true
    }
  }
  if (editing) body.parameters.aspect_ratio = input.aspectRatio
  return body
}

class KlingProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl || 'https://dashscope.aliyuncs.com/api/v1'
    if (!this.apiKey) throw new Error('服务端未配置 DASHSCOPE_API_KEY')
  }

  headers(asyncRequest = false) {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
    if (asyncRequest) headers['X-DashScope-Async'] = 'enable'
    return headers
  }

  async create(input) {
    const data = await requestJson(`${this.baseUrl}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: this.headers(true),
      body: buildKlingRequest(input)
    })
    const output = data.output || {}
    return { providerTaskId: output.task_id, rawState: output.task_status || 'PENDING' }
  }

  async query(providerTaskId) {
    const data = await requestJson(`${this.baseUrl}/tasks/${encodeURIComponent(providerTaskId)}`, {
      headers: this.headers(false)
    })
    const output = data.output || {}
    const state = String(output.task_status || '').toUpperCase()
    if (state === 'SUCCEEDED') {
      return { status: 'succeeded', progress: 100, outputUrl: output.video_url || output.watermark_video_url || '' }
    }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(state)) {
      return { status: 'failed', progress: 100, errorMessage: output.message || output.code || `可灵任务状态：${state}` }
    }
    return { status: 'processing', progress: state === 'RUNNING' ? 55 : 20 }
  }
}

module.exports = { KlingProvider, buildKlingRequest }
