const { requestJson } = require('../http')

const DEFAULT_BASE_URL = 'https://api.dify.ai/v1'

function normalizeBaseUrl(value, allowedHostsValue) {
  const raw = String(value || DEFAULT_BASE_URL).trim()
  const parsed = new URL(raw)
  const allowedHosts = new Set(String(allowedHostsValue || 'api.dify.ai')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('Dify 服务地址不在允许列表中')
  }
  return parsed.toString().replace(/\/$/, '')
}

function parseJsonObject(value) {
  if (value && typeof value === 'object') return value
  const text = String(value || '').trim()
  if (!text) return {}
  try { return JSON.parse(text) } catch (error) {
    throw new Error('Dify 工作流返回了无效 JSON')
  }
}

function parseWorkflowOutput(response) {
  const data = response && response.data
  if (!data) throw new Error('Dify 工作流未返回 data')
  if (data.status && data.status !== 'succeeded') {
    throw new Error(data.error || `Dify 工作流执行失败：${data.status}`)
  }
  const outputs = data.outputs || {}
  const raw = outputs.result_json !== undefined
    ? outputs.result_json
    : (outputs.result !== undefined ? outputs.result : outputs.body)
  const result = parseJsonObject(raw)
  if (result.ok === false) throw new Error(result.error || result.message || 'Python 模型服务调用失败')
  return result.data && typeof result.data === 'object' ? result.data : result
}

function createInputs(input) {
  return {
    operation: 'create',
    workflow_id: String(input.workflowId || ''),
    client_business_id: String(input.clientBusinessId || ''),
    director_prompt: String(input.prompt || ''),
    images_json: JSON.stringify((input.images || []).filter(Boolean)),
    video_url: String(input.video || ''),
    aspect_ratio: String(input.aspectRatio || '9:16'),
    resolution: String(input.resolution || '720p'),
    duration: Number(input.duration || 10),
    remove_audio: input.removeAudio !== false
  }
}

class DifyProvider {
  constructor(options = {}) {
    this.apiKey = String(options.apiKey || '').trim()
    this.baseUrl = normalizeBaseUrl(options.baseUrl, options.allowedHosts)
    this.userPrefix = String(options.userPrefix || 'ipcamp').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'ipcamp'
    if (!this.apiKey) throw new Error('服务端未配置 DIFY_WORKFLOW_API_KEY')
  }

  async run(inputs, userSuffix) {
    return requestJson(`${this.baseUrl}/workflows/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: {
        inputs,
        response_mode: 'blocking',
        user: `${this.userPrefix}:${String(userSuffix || 'worker').slice(0, 96)}`
      },
      timeout: 95000
    })
  }

  async create(input) {
    const response = await this.run(createInputs(input), input.clientBusinessId)
    const result = parseWorkflowOutput(response)
    const providerTaskId = String(result.provider_task_id || result.providerTaskId || '')
    if (!providerTaskId) throw new Error('Dify 工作流未返回 Python 模型任务编号')
    return {
      providerTaskId,
      rawState: String(result.raw_state || result.status || 'submitted'),
      model: String(result.provider_model || result.model || 'python-model-service'),
      traceId: String(response.workflow_run_id || (response.data && response.data.id) || '')
    }
  }

  async query(providerTaskId) {
    const response = await this.run({
      operation: 'query',
      workflow_id: '',
      client_business_id: '',
      director_prompt: '',
      images_json: '[]',
      video_url: '',
      aspect_ratio: '9:16',
      resolution: '720p',
      duration: 10,
      remove_audio: true,
      provider_task_id: String(providerTaskId || '')
    }, providerTaskId)
    const result = parseWorkflowOutput(response)
    return {
      status: String(result.status || 'processing'),
      progress: Number(result.progress || 0),
      outputUrl: String(result.output_url || result.outputUrl || ''),
      coverUrl: String(result.cover_url || result.coverUrl || ''),
      errorMessage: String(result.error_message || result.errorMessage || ''),
      traceId: String(response.workflow_run_id || (response.data && response.data.id) || '')
    }
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DifyProvider,
  createInputs,
  normalizeBaseUrl,
  parseWorkflowOutput
}
