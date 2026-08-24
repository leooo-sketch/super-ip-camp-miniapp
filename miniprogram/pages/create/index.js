const { getWorkflowById } = require('../../data/workflows')
const { validateCreation } = require('../../utils/validator')
const { createTask, uploadMedia, ensureRegistered } = require('../../utils/api')

const PLATFORM_OPTIONS = ['小红书', '视频号', '抖音', 'B站']
const STYLE_OPTIONS = ['真实纪实', '轻商业质感', '训练日志', '口播叙事']
const RATIO_OPTIONS = ['9:16', '16:9', '1:1']
const RESOLUTION_OPTIONS = ['720p', '1080p']
const SOURCE_OPTIONS = ['本人原创', '已获书面授权']

Page({
  data: {
    workflow: {},
    hasAudience: false,
    hasScene: false,
    hasRemoveAudio: false,
    images: [],
    video: null,
    platformOptions: PLATFORM_OPTIONS,
    styleOptions: STYLE_OPTIONS,
    ratioOptions: RATIO_OPTIONS,
    resolutionOptions: RESOLUTION_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
    platformIndex: 0,
    styleIndex: 0,
    ratioIndex: 0,
    resolutionIndex: 0,
    sourceIndex: 0,
    form: {
      topic: '',
      audience: '关注个人成长与健身的人群',
      scene: '',
      removeAudio: true,
      authorized: false,
      aiDisclosure: true
    },
    submitting: false
  },

  onLoad(options) {
    const workflow = getWorkflowById(options.workflowId)
    if (!workflow.enabled) {
      wx.showModal({
        title: '功能适配中',
        content: '该创作工作流正在适配模型能力，暂未开放。请先使用“一键创作爆款视频”。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/home/index' })
      })
      return
    }
    this.setData({
      workflow,
      hasAudience: workflow.fields.includes('audience'),
      hasScene: workflow.fields.includes('scene'),
      hasRemoveAudio: workflow.fields.includes('removeAudio')
    })
    wx.setNavigationBarTitle({ title: workflow.shortTitle })
    ensureRegistered(`/pages/create/index?workflowId=${workflow.id}`)
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  handlePicker(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`${field}Index`]: Number(event.detail.value) })
  },

  handleSwitch(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  async chooseImages() {
    const remaining = this.data.workflow.maxImages - this.data.images.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${this.data.workflow.maxImages} 张`, icon: 'none' })
      return
    }
    const result = await wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed']
    })
    wx.showLoading({ title: '正在上传', mask: true })
    try {
      const uploaded = []
      for (const file of result.tempFiles) {
        uploaded.push(await uploadMedia(file.tempFilePath, 'image'))
      }
      this.setData({ images: this.data.images.concat(uploaded) })
    } catch (error) {
      wx.showToast({ title: error.message || '图片上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async chooseVideo() {
    const result = await wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 10
    })
    wx.showLoading({ title: '正在上传', mask: true })
    try {
      const uploaded = await uploadMedia(result.tempFiles[0].tempFilePath, 'video')
      this.setData({ video: uploaded })
    } catch (error) {
      wx.showToast({ title: error.message || '视频上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  removeVideo() {
    this.setData({ video: null })
  },

  async submit() {
    if (this.data.submitting) return
    const payload = {
      workflowId: this.data.workflow.id,
      topic: this.data.form.topic.trim(),
      audience: this.data.form.audience.trim(),
      scene: this.data.form.scene.trim(),
      platform: PLATFORM_OPTIONS[this.data.platformIndex],
      style: STYLE_OPTIONS[this.data.styleIndex],
      ratio: RATIO_OPTIONS[this.data.ratioIndex],
      resolution: RESOLUTION_OPTIONS[this.data.resolutionIndex],
      duration: 10,
      sourceType: this.data.sourceIndex === 0 ? 'self-owned' : 'licensed',
      removeAudio: this.data.form.removeAudio,
      authorized: this.data.form.authorized,
      aiDisclosure: this.data.form.aiDisclosure,
      images: this.data.images.map((item) => item.fileId),
      video: this.data.video ? this.data.video.fileId : '',
      requestId: `${Date.now()}_${Math.random().toString(16).slice(2)}`
    }
    const validationMessage = validateCreation(payload, this.data.workflow)
    if (validationMessage) {
      wx.showToast({ title: validationMessage, icon: 'none', duration: 3000 })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在创建', mask: true })
    try {
      const task = await createTask(payload)
      wx.redirectTo({ url: `/pages/task/index?id=${task.id}` })
    } catch (error) {
      wx.showToast({ title: error.message || '创建失败', icon: 'none', duration: 3000 })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  }
})
