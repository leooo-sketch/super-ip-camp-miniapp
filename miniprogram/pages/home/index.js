const { workflows } = require('../../data/workflows')
const { bootstrap, ensureRegistered } = require('../../utils/api')
const { formatTokens } = require('../../utils/format')

Page({
  data: {
    workflows,
    featured: workflows.slice(0, 2),
    balanceText: '登录后查看',
    registered: false
  },

  async onShow() {
    try {
      const state = await bootstrap()
      this.setData({
        registered: Boolean(state && state.registered),
        balanceText: state && state.registered ? formatTokens(state.profile.balance) : '登录后查看'
      })
    } catch (error) {
      this.setData({ registered: false, balanceText: '登录后查看' })
    }
  },

  async handleWorkflowSelect(event) {
    const id = (event.detail && event.detail.id) || event.currentTarget.dataset.id
    const workflow = workflows.find((item) => item.id === id)
    if (!workflow || !workflow.enabled) {
      wx.showToast({ title: '该工作流即将开放', icon: 'none' })
      return
    }
    const profile = await ensureRegistered(`/pages/create/index?workflowId=${id}`)
    if (!profile) return
    wx.navigateTo({ url: `/pages/create/index?workflowId=${id}` })
  }
})
