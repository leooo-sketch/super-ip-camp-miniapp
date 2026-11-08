const https = require('https')

const BASE_URL = 'https://tokenhub.tencentmaas.com'
const MODEL = 'hy-video-v1.5'
const RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4'])

function normalizeBaseUrl(value) {
  const url = String(value || BASE_URL).replace(/\/$/, '')
  if (url !== BASE_URL) throw new Error('TokenHub 接口地址不在允许列表')
  return url
}

function buildHyRequest(input, model = MODEL) {
  if (model !== MODEL) throw new Error('不支持的混元视频模型')
  const prompt = String(input.prompt || '').trim()
  if (!prompt || prompt.length > 2000) throw new Error('视频提示词应为 1-2000 个字符')
  const images = Array.isArray(input.images) ? input.images : []
  if (input.mode === 'text2video') {
    if (images.length || input.video) throw new Error('文生视频不能携带参考素材')
    if (!RATIOS.has(input.aspectRatio)) throw new Error('不支持的文生视频画面比例')
    return { model, prompt, aspect_ratio: input.aspectRatio, duration: 5, resolution: '720p', n: 1, footnote: 'AI生成' }
  }
  if (input.mode === 'img2video') {
    if (images.length !== 1 || input.video) throw new Error('图生视频只允许一张参考图片')
    if (input.aspectRatio) throw new Error('图生视频不能指定画面比例')
    const url = new URL(String(images[0]))
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('参考图片须为可公开访问的 HTTPS 地址')
    return { model, prompt, image_url: url.toString(), duration: 5, resolution: '720p', n: 1, footnote: 'AI生成' }
  }
  throw new Error('不支持的混元视频工作流')
}

function safeError(status) {
  if (status === 400) return '混元视频请求参数或内容审核未通过'
  if (status === 401) return 'TokenHub API Key 无效，请检查云函数环境变量'
  if (status === 403) return 'TokenHub 模型权限未开通，请在控制台检查后付费权限'
  if (status === 429) return 'TokenHub 额度或调用频率受限'
  if (status >= 500) return 'TokenHub 服务暂时不可用'
  return `TokenHub 请求失败 (${status})`
}

function requestTokenhub(url, options = {}, transport = https) {
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 262144) request.destroy(new Error('TokenHub 响应过大'))
      })
      response.on('end', () => {
        let data
        try { data = JSON.parse(raw || '{}') } catch (error) {
          reject(new Error('TokenHub 返回无效响应'))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(safeError(response.statusCode))
          error.status = response.statusCode
          error.code = data && data.error && data.error.code
          reject(error)
          return
        }
        resolve(data)
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('TokenHub 请求超时；可能已受理，请勿自动重试')))
    request.on('error', reject)
    if (options.body) request.write(JSON.stringify(options.body))
    request.end()
  })
}

function normalizeHyTask(data) {
  const state = String(data && data.status || '').toLowerCase()
  if (state === 'succeeded') {
    const first = data && Array.isArray(data.videos) ? data.videos[0] : null
    const outputUrl = String(first && first.url || '')
    if (!outputUrl) throw new Error('混元视频任务成功但未返回视频地址')
    return { status: 'succeeded', progress: 100, outputUrl }
  }
  if (state === 'failed') {
    return { status: 'failed', progress: 100, errorMessage: '混元视频生成失败' }
  }
  if (state === 'queued') return { status: 'queued', progress: 20, rawState: state }
  if (state === 'running') return { status: 'processing', progress: 55, rawState: state }
  throw new Error('TokenHub 返回未知任务状态')
}

class TokenhubHyProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.model = options.model || MODEL
    this.request = options.request || requestTokenhub
    if (!this.apiKey) throw new Error('服务端未配置 TOKENHUB_API_KEY')
    if (this.model !== MODEL) throw new Error('TOKENHUB_VIDEO_MODEL 必须为 hy-video-v1.5')
  }

  headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
  }

  async create(input) {
    const body = buildHyRequest(input, this.model)
    let data
    try {
      data = await this.request(`${this.baseUrl}/v1/wand/hunyuan-video/generation`, {
        method: 'POST', headers: this.headers(), body, timeout: 30000
      })
    } catch (error) {
      // Without a definite HTTP rejection the provider may already have accepted the paid task.
      if (!error.status || error.status >= 500) error.submissionUncertain = true
      throw error
    }
    const providerTaskId = String(data && data.task_id || '')
    if (!providerTaskId) {
      const error = new Error('TokenHub 未返回任务编号，须人工核对')
      error.submissionUncertain = true
      throw error
    }
    return { providerTaskId, rawState: 'queued', model: this.model }
  }

  async query(providerTaskId) {
    const id = String(providerTaskId || '')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('无效的 TokenHub 任务编号')
    const data = await this.request(`${this.baseUrl}/v1/wand/hunyuan-video/tasks/${encodeURIComponent(id)}`, {
      headers: this.headers(), timeout: 15000
    })
    return normalizeHyTask(data)
  }
}

module.exports = { TokenhubHyProvider, buildHyRequest, normalizeHyTask, requestTokenhub, normalizeBaseUrl, MODEL }
