const { PRIVACY_CONSENT_VERSION } = require('../config')

const STORAGE_KEY = 'ipcamp_privacy_consent'

function readConsent() {
  const value = wx.getStorageSync(STORAGE_KEY)
  if (!value || typeof value !== 'object') return null
  return value
}

function hasLocalPrivacyConsent() {
  const value = readConsent()
  return Boolean(value && value.accepted === true && value.version === PRIVACY_CONSENT_VERSION)
}

function savePrivacyConsent() {
  wx.setStorageSync(STORAGE_KEY, {
    accepted: true,
    version: PRIVACY_CONSENT_VERSION,
    acceptedAt: Date.now()
  })
}

function clearPrivacyConsent() {
  wx.removeStorageSync(STORAGE_KEY)
}

function getPlatformPrivacySetting() {
  return new Promise((resolve) => {
    if (!wx.getPrivacySetting) {
      resolve({ needAuthorization: false, privacyContractName: '《用户隐私保护指引》' })
      return
    }
    wx.getPrivacySetting({
      success: (result) => resolve({
        needAuthorization: Boolean(result && result.needAuthorization),
        privacyContractName: (result && result.privacyContractName) || '《用户隐私保护指引》'
      }),
      fail: () => resolve({ needAuthorization: false, privacyContractName: '《用户隐私保护指引》' })
    })
  })
}

async function isPrivacyReady() {
  if (!hasLocalPrivacyConsent()) return false
  const setting = await getPlatformPrivacySetting()
  if (setting.needAuthorization) {
    clearPrivacyConsent()
    return false
  }
  return true
}

function openPrivacyContract(fallbackUrl = '/pages/about/index') {
  if (wx.openPrivacyContract) {
    wx.openPrivacyContract({
      fail() {
        wx.navigateTo({ url: fallbackUrl })
      }
    })
    return
  }
  wx.navigateTo({ url: fallbackUrl })
}

module.exports = {
  STORAGE_KEY,
  readConsent,
  hasLocalPrivacyConsent,
  savePrivacyConsent,
  clearPrivacyConsent,
  getPlatformPrivacySetting,
  isPrivacyReady,
  openPrivacyContract
}
