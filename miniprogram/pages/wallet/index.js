const { ensureRegistered, getProfile, createOrder, getPaymentStatus } = require('../../utils/api')
const { formatTokens } = require('../../utils/format')

const PACKAGES = [
  { id: 'starter', name: '轻量创作服务包', points: 300, price: 29, note: '适合尝试基础视频工作流' },
  { id: 'creator', name: '创作者服务包', points: 980, price: 79, note: '适合持续更新内容', recommended: true },
  { id: 'studio', name: '工作室服务包', points: 2280, price: 159, note: '适合多工作流创作' }
]

Page({
  data: {
    packages: PACKAGES,
    selectedId: 'creator',
    balanceText: '---',
    paymentConfigured: false,
    checking: true,
    paying: false
  },

  async onShow() {
    const profile = await ensureRegistered('/pages/wallet/index')
    if (!profile) return
    await this.loadWallet()
  },

  async loadWallet() {
    this.setData({ checking: true })
    try {
      const [profile, payment] = await Promise.all([getProfile(), getPaymentStatus()])
      this.setData({ balanceText: formatTokens(profile.balance), paymentConfigured: Boolean(payment.configured), checking: false })
    } catch (error) {
      this.setData({ checking: false })
      wx.showToast({ title: error.message || '充值信息读取失败', icon: 'none' })
    }
  },

  selectPackage(event) {
    this.setData({ selectedId: event.currentTarget.dataset.id })
  },

  async buy() {
    if (this.data.paying || this.data.checking) return
    if (!this.data.paymentConfigured) {
      wx.showModal({
        title: '微信支付正在配置',
        content: '充值入口已接入正式订单流程，但商户号尚未完成绑定。配置完成前不会扣款，也不会产生虚假到账。',
        showCancel: false
      })
      return
    }
    const selected = PACKAGES.find((item) => item.id === this.data.selectedId)
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认购买',
        content: `购买${selected.name}，获得 ${selected.points} 创作点，应付 ¥${selected.price}。`,
        confirmText: '微信支付',
        success: (result) => resolve(result.confirm)
      })
    })
    if (!confirmed) return
    this.setData({ paying: true })
    try {
      const order = await createOrder(selected.id)
      if (!order.paymentConfigured || !order.paymentParams) {
        this.setData({ paymentConfigured: false })
        throw new Error(order.message || '微信支付尚未配置完成')
      }
      await new Promise((resolve, reject) => wx.requestPayment({ ...order.paymentParams, success: resolve, fail: reject }))
      wx.showLoading({ title: '确认到账', mask: true })
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await this.loadWallet()
      wx.showToast({ title: '支付成功', icon: 'success' })
    } catch (error) {
      const message = error && error.errMsg && /cancel/i.test(error.errMsg) ? '已取消支付' : (error.message || '充值未完成')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ paying: false })
    }
  }
})
