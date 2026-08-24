const {
  bootstrap,
  registerAccount,
  registerWithPhone,
  uploadMedia,
  deleteAccount,
  ensureRegistered
} = require('../../utils/api')
const { formatTokens } = require('../../utils/format')
const {
  hasLocalPrivacyConsent,
  savePrivacyConsent,
  clearPrivacyConsent,
  getPlatformPrivacySetting,
  openPrivacyContract
} = require('../../utils/privacy')

Page({
  data: {
    registered: false,
    loading: true,
    submitting: false,
    profile: {},
    balanceText: '---',
    nickname: '',
    avatarUrl: '',
    loginMethodText: '',
    termsChecked: false,
    privacyAgreed: false,
    platformPrivacyNeeded: false,
    showPrivacyDialog: false,
    privacyContractName: '《用户隐私保护指引》'
  },

  onShow() {
    this.initializePrivacy()
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
    if (ready) await this.loadState()
    else this.setData({ registered: false, loading: false, profile: {}, balanceText: '---' })
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
    await this.loadState()
  },

  acceptPrivacyConsent() {
    savePrivacyConsent()
    getApp().globalData.privacyAgreed = true
    this.setData({
      termsChecked: true,
      privacyAgreed: true,
      platformPrivacyNeeded: false,
      showPrivacyDialog: false
    })
  },

  async handleAgreePrivacyAuthorization() {
    this.acceptPrivacyConsent()
    await this.loadState()
  },

  handlePrivacyDisagree() {
    clearPrivacyConsent()
    getApp().globalData.privacyAgreed = false
    this.setData({
      termsChecked: false,
      privacyAgreed: false,
      showPrivacyDialog: false
    })
  },

  openPrivacy() {
    openPrivacyContract('/pages/about/index')
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' })
  },

  async loadState() {
    this.setData({ loading: true })
    try {
      const state = await bootstrap()
      if (state && state.privacyRequired) {
        this.setData({ registered: false, loading: false, profile: {}, balanceText: '---' })
        return
      }
      const profile = state && state.profile ? state.profile : {}
      const registered = Boolean(state && state.registered)
      this.setData({
        registered,
        profile,
        balanceText: registered ? formatTokens(profile.balance) : '---',
        loginMethodText: profile.loginMethod === 'phone'
          ? `手机号授权${profile.phoneMasked ? ` · ${profile.phoneMasked}` : ''}`
          : '微信账号',
        loading: false
      })
      const app = getApp()
      app.globalData.registered = registered
      app.globalData.profile = registered ? profile : null
      app.globalData.bootstrapped = true
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '账户状态读取失败', icon: 'none' })
    }
  },

  onNicknameInput(event) {
    this.setData({ nickname: String(event.detail.value || '').trim().slice(0, 20) })
  },

  onChooseAvatar(event) {
    if (!this.data.privacyAgreed) return
    this.setData({ avatarUrl: event.detail.avatarUrl || '' })
  },

  async buildRegistrationPayload() {
    let avatarUrl = ''
    if (this.data.avatarUrl) avatarUrl = (await uploadMedia(this.data.avatarUrl, 'avatar')).fileId
    return { nickname: this.data.nickname || '微信用户', avatarUrl }
  },

  ensurePrivacyAccepted() {
    if (this.data.privacyAgreed) return true
    wx.showToast({ title: '请先阅读并同意用户协议与隐私保护指引', icon: 'none' })
    return false
  },

  async wechatLogin() {
    if (this.data.submitting || !this.ensurePrivacyAccepted()) return
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在登录', mask: true })
    try {
      const result = await registerAccount(await this.buildRegistrationPayload())
      await this.finishLogin(result)
    } catch (error) {
      wx.showToast({ title: error.message || '微信登录失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  async phoneLogin(event) {
    if (this.data.submitting || !this.ensurePrivacyAccepted()) return
    const detail = event.detail || {}
    if (!detail.code) {
      wx.showToast({ title: detail.errMsg && /deny|cancel/i.test(detail.errMsg) ? '你已取消手机号授权' : '手机号授权失败，请重试', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在登录', mask: true })
    try {
      const payload = await this.buildRegistrationPayload()
      const result = await registerWithPhone({ ...payload, code: detail.code })
      await this.finishLogin(result)
    } catch (error) {
      wx.showToast({ title: error.message || '手机号登录失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  async finishLogin(result) {
    const app = getApp()
    app.globalData.registered = true
    app.globalData.profile = result.profile
    this.setData({ nickname: '', avatarUrl: '' })
    wx.showToast({ title: result.welcomeGranted ? '已送 500 创作点' : '登录成功', icon: 'success' })
    await this.loadState()
    const target = wx.getStorageSync('ipcamp_login_return')
    if (target) {
      wx.removeStorageSync('ipcamp_login_return')
      setTimeout(() => {
        if (/^\/pages\/(home|works|profile)\/index$/.test(target)) wx.switchTab({ url: target })
        else wx.navigateTo({ url: target })
      }, 650)
    }
  },

  async requireLogin(returnUrl) {
    if (this.data.registered) return true
    await ensureRegistered(returnUrl)
    return false
  },

  async openWorks() {
    if (!(await this.requireLogin('/pages/works/index'))) return
    wx.switchTab({ url: '/pages/works/index' })
  },

  openAbout() { wx.navigateTo({ url: '/pages/about/index' }) },

  async openWallet() {
    if (!(await this.requireLogin('/pages/wallet/index'))) return
    wx.navigateTo({ url: '/pages/wallet/index' })
  },

  async openGames() {
    if (!(await this.requireLogin('/pages/games/index'))) return
    wx.navigateTo({ url: '/pages/games/index' })
  },

  async requestDeleteAccount() {
    if (!(await this.requireLogin())) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '注销账号并删除数据',
        content: '将删除账户、创作任务、创作点流水和已上传素材。依法必须保留的交易记录除外，此操作无法恢复。',
        confirmText: '确认删除',
        confirmColor: '#B92520',
        success: (result) => resolve(result.confirm)
      })
    })
    if (!confirmed) return
    wx.showLoading({ title: '正在删除', mask: true })
    try {
      await deleteAccount()
      wx.clearStorageSync()
      const app = getApp()
      app.globalData.registered = false
      app.globalData.profile = null
      app.globalData.privacyAgreed = false
      wx.showToast({ title: '账户数据已删除', icon: 'success' })
      setTimeout(() => this.initializePrivacy(), 800)
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
