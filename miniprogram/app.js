const { CLOUD_ENV_ID } = require('./config')
const { hasLocalPrivacyConsent } = require('./utils/privacy')

App({
  globalData: {
    cloudEnvId: '',
    demoMode: true,
    profile: null,
    registered: false,
    bootstrapped: false,
    privacyAgreed: false
  },

  onLaunch() {
    const envId = String(CLOUD_ENV_ID || '').trim()
    this.globalData.cloudEnvId = envId
    this.globalData.demoMode = !envId
    this.globalData.privacyAgreed = hasLocalPrivacyConsent()

    if (wx.cloud && envId) {
      wx.cloud.init({ env: envId, traceUser: true })
    }

    // 不在小程序启动时读取 OPENID 或账户状态。
    // 首次用户必须先主动同意《用户服务协议》和《隐私保护指引》，
    // 后续页面再按需调用 bootstrap()。
  }
})
