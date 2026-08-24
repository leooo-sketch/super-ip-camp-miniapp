const { bootstrap, registerAccount, uploadMedia } = require('../../utils/api')
const {
  hasLocalPrivacyConsent,
  savePrivacyConsent,
  clearPrivacyConsent,
  getPlatformPrivacySetting,
  openPrivacyContract
} = require('../../utils/privacy')

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    loading: true,
    submitting: false,
    termsChecked: false,
    privacyAgreed: false,
    platformPrivacyNeeded: false,
    showPrivacyDialog: false,
    privacyContractName: '《用户隐私保护指引》'
  },

  onLoad(options) {
    this.redirect = decodeURIComponent(options.redirect || '/pages/home/index')
  },

  async onShow() {
    await this.initializePrivacy()
    if (!this.data.privacyAgreed) {
      this.setData({ loading: false })
      return
    }
    try {
      const state = await bootstrap()
      if (state && state.registered) return this.enterApp()
    } catch (error) {
      console.warn('读取注册状态失败', error)
    }
    this.setData({ loading: false })
  },

  async initializePrivacy() {
    const setting = await getPlatformPrivacySetting()
    let localAgreed = hasLocalPrivacyConsent()
    if (setting.needAuthorization && localAgreed) {
      clearPrivacyConsent()
      localAgreed = false
    }
    const ready = localAgreed && !setting.needAuthorization
    this.setData({
      termsChecked: ready,
      privacyAgreed: ready,
      platformPrivacyNeeded: setting.needAuthorization,
      privacyContractName: setting.privacyContractName,
      showPrivacyDialog: false
    })
    getApp().globalData.privacyAgreed = ready
  },

  async onPrivacyChange(event) {
    const values = event.detail.value || []
    const checked = values.includes('agreed')
    if (!checked) {
      clearPrivacyConsent()
      getApp().globalData.privacyAgreed = false
      this.setData({ termsChecked: false, privacyAgreed: false, showPrivacyDialog: false })
      return
    }

    const setting = await getPlatformPrivacySetting()
    if (setting.needAuthorization) {
      this.setData({
        termsChecked: true,
        privacyAgreed: false,
        platformPrivacyNeeded: true,
        privacyContractName: setting.privacyContractName,
        showPrivacyDialog: true
      })
      return
    }

    this.acceptPrivacyConsent()
  },

  acceptPrivacyConsent() {
    savePrivacyConsent()
    getApp().globalData.privacyAgreed = true
    this.setData({ termsChecked: true, privacyAgreed: true, platformPrivacyNeeded: false, showPrivacyDialog: false })
  },

  handleAgreePrivacyAuthorization() {
    this.acceptPrivacyConsent()
  },

  handlePrivacyDisagree() {
    clearPrivacyConsent()
    getApp().globalData.privacyAgreed = false
    this.setData({ termsChecked: false, privacyAgreed: false, showPrivacyDialog: false })
  },

  openPrivacy() {
    openPrivacyContract('/pages/about/index')
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' })
  },

  onNicknameInput(event) {
    this.setData({ nickname: String(event.detail.value || '').slice(0, 20) })
  },

  onChooseAvatar(event) {
    if (!this.data.privacyAgreed) return
    this.setData({ avatarUrl: event.detail.avatarUrl || '' })
  },

  async register() {
    if (this.data.submitting) return
    if (!this.data.privacyAgreed) {
      wx.showToast({ title: '请先阅读并同意用户协议与隐私保护指引', icon: 'none' })
      return
    }
    const nickname = this.data.nickname.trim() || '微信用户'
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在登录', mask: true })
    try {
      let avatarUrl = ''
      if (this.data.avatarUrl) avatarUrl = (await uploadMedia(this.data.avatarUrl, 'avatar')).fileId
      const result = await registerAccount({ nickname, avatarUrl })
      const app = getApp()
      app.globalData.registered = true
      app.globalData.profile = result.profile
      wx.showToast({ title: result.welcomeGranted ? '已送 500 创作点' : '登录成功', icon: 'success' })
      setTimeout(() => this.enterApp(), 650)
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  enterApp() {
    const target = this.redirect || '/pages/home/index'
    if (/^\/pages\/(home|works|profile)\/index$/.test(target)) wx.switchTab({ url: target })
    else wx.reLaunch({ url: target })
  }
})
