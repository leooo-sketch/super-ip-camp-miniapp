const { ViduProvider } = require('./vidu')
const { MockProvider } = require('./mock')
const { KlingProvider } = require('./kling')
const { ToApisProvider } = require('./toapis')
const { KlingDirectProvider } = require('./kling-direct')
const { DifyProvider } = require('./dify')
const { TokenhubHyProvider } = require('./tokenhub-hy')

function createProvider(name) {
  const provider = String(name || process.env.VIDEO_PROVIDER || 'kling-direct').toLowerCase()
  if (provider === 'tokenhub-hy') {
    return new TokenhubHyProvider({
      apiKey: process.env.TOKENHUB_API_KEY,
      baseUrl: process.env.TOKENHUB_BASE_URL,
      model: process.env.TOKENHUB_VIDEO_MODEL
    })
  }
  if (provider === 'dify') {
    return new DifyProvider({
      apiKey: process.env.DIFY_WORKFLOW_API_KEY,
      baseUrl: process.env.DIFY_API_BASE_URL,
      allowedHosts: process.env.DIFY_ALLOWED_HOSTS,
      userPrefix: process.env.DIFY_USER_PREFIX
    })
  }
  if (provider === 'toapis') {
    return new ToApisProvider({
      apiKey: process.env.AI_RELAY_API_KEY,
      baseUrl: process.env.AI_RELAY_BASE_URL,
      videoModel: process.env.TOAPIS_VIDEO_MODEL,
      editModel: process.env.TOAPIS_EDIT_MODEL
    })
  }
  if (provider === 'kling') {
    return new KlingProvider({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseUrl: process.env.DASHSCOPE_BASE_URL
    })
  }
  if (provider === 'kling-direct') {
    return new KlingDirectProvider({
      apiKey: process.env.KLING_API_KEY,
      baseUrl: process.env.KLING_API_BASE_URL
    })
  }
  if (provider === 'vidu') return new ViduProvider({ token: process.env.VIDU_API_TOKEN })
  if (provider === 'mock') return new MockProvider()
  throw new Error(`不支持的视频服务提供方：${provider}`)
}

module.exports = { createProvider }
