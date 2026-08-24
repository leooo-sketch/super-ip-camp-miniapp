const { requestJson } = require('../http')

class ViduProvider {
  constructor(options = {}) {
    this.token = options.token
    this.baseUrl = options.baseUrl || 'https://api.vidu.cn'
    if (!this.token) throw new Error('服务端未配置 VIDU_API_TOKEN')
  }

  headers() {
    return {
      Authorization: `Token ${this.token}`,
      'Content-Type': 'application/json'
    }
  }

  async create(input) {
    if (input.mode === 'trending') return this.createTrending(input)
    return this.createImageVideo(input)
  }

  async createImageVideo(input) {
    const data = await requestJson(`${this.baseUrl}/ent/v2/img2video`, {
      method: 'POST',
      headers: this.headers(),
      body: {
        model: process.env.VIDU_IMAGE_MODEL || 'viduq3-pro-fast',
        images: input.images,
        prompt: input.prompt,
        duration: 5,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        movement_amplitude: 'auto',
        bgm: false
      }
    })
    return { providerTaskId: data.task_id, rawState: data.state || 'created' }
  }

  async createTrending(input) {
    const data = await requestJson(`${this.baseUrl}/ent/v2/trending-replicate`, {
      method: 'POST',
      headers: this.headers(),
      body: {
        video_url: input.video,
        images: input.images,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        remove_audio: input.removeAudio !== false
      }
    })
    return { providerTaskId: data.task_id, rawState: data.state || 'created' }
  }

  async query(providerTaskId) {
    const data = await requestJson(`${this.baseUrl}/ent/v2/tasks/${encodeURIComponent(providerTaskId)}/creations`, {
      headers: this.headers()
    })
    const state = String(data.state || '').toLowerCase()
    const first = Array.isArray(data.creations) ? data.creations[0] : null
    if (['success', 'succeeded', 'completed'].includes(state)) {
      return {
        status: 'succeeded',
        progress: 100,
        outputUrl: first && (first.url || first.video_url),
        coverUrl: first && (first.cover_url || first.cover)
      }
    }
    if (['failed', 'failure'].includes(state)) {
      return { status: 'failed', progress: 100, errorMessage: data.err_code || data.message || '模型生成失败' }
    }
    const progress = Number(data.progress || 0)
    return { status: 'processing', progress: progress > 0 ? Math.min(95, progress) : 35 }
  }
}

module.exports = { ViduProvider }
