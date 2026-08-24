const { requestJson } = require('../http')

const DEFAULT_BASE_URL = 'https://api-beijing.klingai.com'

function buildKlingDirectRequest(input) {
  const firstImage = Array.isArray(input.images) ? input.images[0] : ''
  if (!firstImage) throw new Error('Kling 3.0 Turbo 图生视频需要至少一张首帧图')
  const duration = Math.max(3, Math.min(15, Number(input.duration || 10)))
  return {
    contents: [
      { type: 'prompt', text: String(input.prompt || '').slice(0, 2500) },
      { type: 'first_frame', url: firstImage }
    ],
    settings: {
      resolution: input.resolution === '1080p' ? '1080p' : '720p',
      duration
    },
    options: {
      external_task_id: String(input.clientBusinessId || ''),
      watermark_info: { enabled: true }
    }
  }
}

function normalizeTask(payload) {
  const root = payload && payload.data !== undefined ? payload.data : payload
  const task = Array.isArray(root)
    ? root[0]
    : (root && (root.items || root.tasks) ? (root.items || root.tasks)[0] : root)
  const state = String((task && (task.status || task.task_status)) || 'submitted').toLowerCase()
  const outputs = (task && (task.outputs || (task.task_result && task.task_result.videos))) || []
  const video = outputs.find((item) => item && (item.type === 'video' || item.url)) || outputs[0] || {}
  return {
    providerTaskId: String((task && (task.id || task.task_id)) || ''),
    rawState: state,
    status: state === 'succeeded' || state === 'succeed'
      ? 'succeeded'
      : state === 'failed' ? 'failed' : 'processing',
    progress: state === 'succeeded' || state === 'failed' ? 100 : (state === 'processing' ? 55 : 20),
    outputUrl: String(video.url || video.watermark_url || ''),
    errorMessage: String((task && (task.message || task.task_status_msg)) || '')
  }
}

class KlingDirectProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
    if (!this.apiKey) throw new Error('服务端未配置 KLING_API_KEY')
    if (this.baseUrl !== DEFAULT_BASE_URL) throw new Error('可灵接口地址不在允许列表')
  }

  headers() {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  async create(input) {
    if (input.mode === 'trending') {
      throw new Error('授权视频重构仍在适配，可先使用“一键创作爆款视频”')
    }
    const data = await requestJson(`${this.baseUrl}/kling/image-to-video/kling-3.0-turbo`, {
      method: 'POST',
      headers: this.headers(),
      body: buildKlingDirectRequest(input),
      timeout: 45000
    })
    if (Number(data.code || 0) !== 0) throw new Error(data.message || `可灵服务错误：${data.code}`)
    const task = normalizeTask(data)
    return { providerTaskId: task.providerTaskId, rawState: task.rawState, model: 'kling-3.0-turbo' }
  }

  async query(providerTaskId) {
    const data = await requestJson(`${this.baseUrl}/kling/tasks?task_ids=${encodeURIComponent(providerTaskId)}`, {
      headers: this.headers(),
      timeout: 30000
    })
    if (Number(data.code || 0) !== 0) throw new Error(data.message || `可灵服务错误：${data.code}`)
    return normalizeTask(data)
  }
}

module.exports = { KlingDirectProvider, buildKlingDirectRequest, normalizeTask, DEFAULT_BASE_URL }
