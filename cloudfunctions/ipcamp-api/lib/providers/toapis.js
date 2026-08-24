const { requestJson } = require('../http')

const ALLOWED_BASE_URL = 'https://toapis.com/v1'
const DEFAULT_VIDEO_MODEL = 'kling-v3'
const DEFAULT_EDIT_MODEL = 'kling-video-o1'
const ALLOWED_VIDEO_MODELS = new Set([
  'kling-v3',
  'kling-3.0-turbo',
  'doubao-seedance-1-5-pro',
  'seedance-2-fast',
  'grok-video-1.5'
])

function normalizeBaseUrl(value) {
  const raw = String(value || ALLOWED_BASE_URL).trim()
  const parsed = new URL(raw)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'toapis.com') {
    throw new Error('ToAPIs 服务地址不在允许列表中')
  }
  return parsed.toString().replace(/\/$/, '')
}

function clampDuration(value, hasImages) {
  const requested = Number(value || 10)
  const maximum = hasImages ? 10 : 15
  if (!Number.isFinite(requested)) return 10
  return Math.max(5, Math.min(maximum, Math.round(requested)))
}

function configuredVideoModel(value) {
  const model = String(value || DEFAULT_VIDEO_MODEL).trim()
  if (!ALLOWED_VIDEO_MODELS.has(model)) throw new Error('服务端配置了不支持的视频模型')
  return model
}

function referencePrompt(prompt, imageCount, includeVideo) {
  const imageTokens = Array.from({ length: imageCount }, (_, index) => `<<<image_${index + 1}>>>`)
  const references = [includeVideo ? '<<<video_1>>>' : '', ...imageTokens].filter(Boolean).join('、')
  return references ? `使用 ${references} 作为已授权参考素材。\n${prompt}` : prompt
}

function buildToApisRequest(input, options = {}) {
  const editing = input.mode === 'trending'
  const images = (input.images || []).filter(Boolean).slice(0, 7)
  const mode = input.resolution === '1080p' ? 'pro' : 'std'
  const duration = clampDuration(input.duration, images.length > 0)

  if (editing) {
    if (!input.video) throw new Error('视频重构任务缺少授权参考视频')
    const model = String(options.editModel || DEFAULT_EDIT_MODEL).trim()
    if (model !== DEFAULT_EDIT_MODEL) throw new Error('视频重构模型配置不受支持')
    return {
      model,
      client_business_id: input.clientBusinessId,
      prompt: referencePrompt(input.prompt, images.length, true),
      mode,
      duration: Math.min(duration, 10),
      aspect_ratio: input.aspectRatio,
      video_list: [{
        video_url: input.video,
        refer_type: 'base',
        keep_original_sound: input.removeAudio === false ? 'yes' : 'no'
      }],
      metadata: {
        image_list: images.map((imageUrl) => ({ image_url: imageUrl })),
        watermark: true
      }
    }
  }

  const model = configuredVideoModel(options.videoModel)
  const body = {
    model,
    prompt: input.prompt,
    mode,
    duration,
    aspect_ratio: input.aspectRatio,
    audio: false,
    metadata: {
      negative_prompt: 'plastic skin, face distortion, extra fingers, deformed limbs, flicker, identity drift, text, logo, watermark',
      watermark: true
    }
  }

  if (images.length) {
    body.image_with_roles = [{ url: images[0], role: 'first_frame' }]
    if (images.length > 1) body.reference_images = images.slice(1)
  }
  return body
}

function outputUrl(data) {
  if (data.video_url) return data.video_url
  const rows = data.result && Array.isArray(data.result.data) ? data.result.data : []
  return rows[0] && (rows[0].url || rows[0].video_url) || ''
}

function coverUrl(data) {
  if (data.cover_url || data.thumbnail_url) return data.cover_url || data.thumbnail_url
  const rows = data.result && Array.isArray(data.result.data) ? data.result.data : []
  return rows[0] && (rows[0].cover_url || rows[0].thumbnail_url) || ''
}

class ToApisProvider {
  constructor(options = {}) {
    this.apiKey = String(options.apiKey || '').trim()
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.videoModel = options.videoModel || DEFAULT_VIDEO_MODEL
    this.editModel = options.editModel || DEFAULT_EDIT_MODEL
    if (!this.apiKey) throw new Error('服务端未配置 AI_RELAY_API_KEY')
  }

  headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  }

  async create(input) {
    const body = buildToApisRequest(input, {
      videoModel: this.videoModel,
      editModel: this.editModel
    })
    const data = await requestJson(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: this.headers(),
      body,
      timeout: 45000
    })
    return {
      providerTaskId: data.id || data.task_id,
      rawState: data.status || 'queued',
      model: data.model || body.model
    }
  }

  async query(providerTaskId) {
    const data = await requestJson(`${this.baseUrl}/videos/generations/${encodeURIComponent(providerTaskId)}`, {
      headers: this.headers(),
      timeout: 30000
    })
    const state = String(data.status || '').toLowerCase()
    if (['completed', 'success', 'succeeded'].includes(state)) {
      return {
        status: 'succeeded',
        progress: 100,
        outputUrl: outputUrl(data),
        coverUrl: coverUrl(data)
      }
    }
    if (['failed', 'failure', 'canceled', 'cancelled'].includes(state)) {
      const message = data.error && (data.error.message || data.error.code)
      return { status: 'failed', progress: 100, errorMessage: message || data.message || 'ToAPIs 模型生成失败' }
    }
    const progress = Number(data.progress || 0)
    return { status: 'processing', progress: progress > 0 ? Math.min(95, progress) : 25 }
  }
}

module.exports = {
  ALLOWED_VIDEO_MODELS,
  ToApisProvider,
  buildToApisRequest,
  clampDuration,
  normalizeBaseUrl,
  outputUrl
}
