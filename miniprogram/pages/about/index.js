const { AI_PROVIDER_NAME, AI_MODEL_NAME, AI_REGISTRATION_NUMBER } = require('../../config')
const { openPrivacyContract } = require('../../utils/privacy')

Page({
  data: {
    aiProviderName: AI_PROVIDER_NAME,
    aiModelName: AI_MODEL_NAME,
    aiRegistrationNumber: AI_REGISTRATION_NUMBER
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' })
  },

  openPrivacy() {
    openPrivacyContract('/pages/about/index')
  }
})
