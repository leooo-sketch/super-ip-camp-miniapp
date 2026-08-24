const { ensureRegistered } = require('../../utils/api')

Page({
  async onLoad() { await ensureRegistered('/pages/games/index') },
  openQuiz() { wx.navigateTo({ url: '/pages/quiz/index' }) },
  openParty() { wx.navigateTo({ url: '/pages/party/index' }) },
  onShareAppMessage() {
    return { title: '来超级IP创造营一起换个脑筋', path: '/pages/games/index' }
  }
})
