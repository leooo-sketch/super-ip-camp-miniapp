const {
  getDemoProfile,
  getDemoTasks,
  createDemoTask,
  hydrateDemoTask,
  topUpDemo,
  deleteDemoAccount
} = require('./mock')
const { isPrivacyReady } = require('./privacy')

function isDemoMode() {
  const app = getApp()
  return !app.globalData.cloudEnvId
}

function cloudCallErrorMessage(error) {
  const detail = String((error && (error.errMsg || error.message)) || error || '')
  if (/-404011|invalid env|environment.*not.*exist|环境.*不存在/i.test(detail)) {
    return '云开发环境未关联当前小程序，请检查环境 ID 与 AppID 绑定'
  }
  if (/-501000|-501005|function.*not.*exist|FUNCTION_NOT_FOUND|云函数.*不存在/i.test(detail)) {
    return '云函数 ipcamp-api 尚未部署到当前环境'
  }
  if (/-504002|FUNCTIONS_EXECUTE_FAIL|functions execute fail|Cannot find module/i.test(detail)) {
    return '云服务启动失败，请检查云函数依赖与运行日志'
  }
  if (/timeout|timed out|超时/i.test(detail)) return '云服务响应超时，请稍后重试'
  return '云服务连接失败，请检查网络和 CloudBase 配置后重试'
}

async function requirePrivacyReady() {
  const ready = await isPrivacyReady()
  if (!ready) {
    const error = new Error('请先阅读并同意用户服务协议与隐私保护指引')
    error.code = 'PRIVACY_REQUIRED'
    throw error
  }
}

async function call(action, data) {
  if (isDemoMode()) throw new Error('DEMO_MODE')
  await requirePrivacyReady()
  let result
  try {
    result = await wx.cloud.callFunction({
      name: 'ipcamp-api',
      data: { action, data: data || {} }
    })
  } catch (error) {
    console.error('cloud.callFunction failed', {
      action,
      errCode: error && error.errCode,
      errMsg: error && (error.errMsg || error.message)
    })
    throw new Error(cloudCallErrorMessage(error))
  }
  const response = result.result || {}
  if (!response.ok) throw new Error(response.message || '服务暂时不可用')
  return response.data
}

async function bootstrap() {
  const ready = await isPrivacyReady()
  if (!ready) return { registered: false, profile: null, privacyRequired: true }
  if (isDemoMode()) {
    return {
      registered: Boolean(wx.getStorageSync('ipcamp_demo_registered')),
      profile: wx.getStorageSync('ipcamp_demo_registered') ? getDemoProfile() : null,
      privacyRequired: false
    }
  }
  return call('bootstrap')
}

async function getProfile() {
  if (isDemoMode()) {
    await requirePrivacyReady()
    if (!wx.getStorageSync('ipcamp_demo_registered')) throw new Error('请先注册')
    return getDemoProfile()
  }
  return call('wallet.get')
}

async function registerAccount(profile) {
  await requirePrivacyReady()
  if (isDemoMode()) {
    wx.setStorageSync('ipcamp_demo_registered', true)
    return { registered: true, profile: getDemoProfile(), welcomeGranted: true }
  }
  return call('account.register', profile || {})
}

async function registerWithPhone(payload) {
  await requirePrivacyReady()
  if (isDemoMode()) {
    wx.setStorageSync('ipcamp_demo_registered', true)
    return { registered: true, profile: getDemoProfile(), welcomeGranted: true }
  }
  return call('account.register.phone', payload || {})
}

async function ensureRegistered(returnUrl) {
  const ready = await isPrivacyReady()
  if (!ready) {
    if (returnUrl) wx.setStorageSync('ipcamp_login_return', returnUrl)
    wx.showToast({ title: '请先阅读并同意协议后登录', icon: 'none' })
    setTimeout(() => wx.switchTab({ url: '/pages/profile/index' }), 350)
    return null
  }
  const state = await bootstrap()
  if (state && state.registered) return state.profile
  if (returnUrl) wx.setStorageSync('ipcamp_login_return', returnUrl)
  wx.showToast({ title: '请先登录后使用', icon: 'none' })
  setTimeout(() => wx.switchTab({ url: '/pages/profile/index' }), 350)
  return null
}

async function getPaymentStatus() {
  if (isDemoMode()) return { configured: false }
  return call('payment.status')
}

async function createGameRoom(type, gameId) {
  return call('game.room.create', { type, gameId })
}

async function joinGameRoom(roomId) {
  return call('game.room.join', { roomId })
}

async function getGameRoom(roomId) {
  return call('game.room.get', { roomId })
}

async function startGameRoom(roomId) {
  return call('game.room.start', { roomId })
}

async function answerQuizRoom(roomId, questionIndex, selected) {
  return call('game.quiz.answer', { roomId, questionIndex, selected })
}

async function nextPartyRound(roomId) {
  return call('game.party.next', { roomId })
}

async function guessPartyNumber(roomId, guess) {
  return call('game.party.guess', { roomId, guess })
}

async function createTask(payload) {
  if (isDemoMode()) {
    await requirePrivacyReady()
    return createDemoTask(payload)
  }
  return call('task.create', payload)
}

async function listTasks() {
  if (isDemoMode()) {
    await requirePrivacyReady()
    return getDemoTasks().map(hydrateDemoTask)
  }
  return call('task.list')
}

async function getTask(id) {
  if (isDemoMode()) {
    await requirePrivacyReady()
    const task = getDemoTasks().find((item) => item.id === id)
    return hydrateDemoTask(task)
  }
  return call('task.get', { id })
}

async function uploadMedia(filePath, kind) {
  await requirePrivacyReady()
  if (isDemoMode()) return { fileId: filePath, tempPath: filePath, kind }
  const extension = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(filePath || ''))
  const suffix = extension ? extension[1].toLowerCase() : (kind === 'video' ? 'mp4' : 'jpg')
  const cloudPath = `ipcamp/${kind}/${Date.now()}_${Math.random().toString(16).slice(2)}.${suffix}`
  const result = await wx.cloud.uploadFile({ cloudPath, filePath })
  return { fileId: result.fileID, tempPath: filePath, kind }
}

async function createOrder(packageId) {
  if (isDemoMode()) {
    await requirePrivacyReady()
    const packages = { starter: 300, creator: 980, studio: 2280 }
    return { demoMode: true, profile: topUpDemo(packages[packageId] || 0) }
  }
  return call('order.create', { packageId })
}

async function deleteAccount() {
  if (isDemoMode()) return deleteDemoAccount()
  return call('account.delete', { confirmation: 'DELETE' })
}

module.exports = {
  cloudCallErrorMessage,
  isDemoMode,
  bootstrap,
  registerAccount,
  registerWithPhone,
  ensureRegistered,
  getProfile,
  createTask,
  listTasks,
  getTask,
  uploadMedia,
  getPaymentStatus,
  createOrder,
  deleteAccount,
  createGameRoom,
  joinGameRoom,
  getGameRoom,
  startGameRoom,
  answerQuizRoom,
  nextPartyRound,
  guessPartyNumber
}
