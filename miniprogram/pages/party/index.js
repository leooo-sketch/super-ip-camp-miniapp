const {
  ensureRegistered,
  createGameRoom,
  joinGameRoom,
  getGameRoom,
  startGameRoom,
  nextPartyRound,
  guessPartyNumber
} = require('../../utils/api')

const GAMES = [
  { id: 'truth', icon: '真', title: '真心话', note: '轮流回答，轻松认识彼此' },
  { id: 'spy', icon: '卧', title: '谁是卧底', note: '每个人私下查看自己的词' },
  { id: 'draw', icon: '画', title: '你画我猜', note: '画手单独看词，其他人猜' },
  { id: 'dice', icon: '骰', title: '骰子挑战', note: '轮流接受随机轻松挑战' },
  { id: 'bomb', icon: '数', title: '数字炸弹', note: '多人轮流猜，范围实时同步' }
]

Page({
  data: {
    games: GAMES,
    stage: 'loading',
    roomId: '',
    room: null,
    players: [],
    isOwner: false,
    gameTitle: '',
    party: {},
    secret: '',
    guess: ''
  },

  async onLoad(options) {
    const roomId = String(options.roomId || '')
    const returnUrl = roomId ? `/pages/party/index?roomId=${roomId}` : '/pages/party/index'
    try {
      const profile = await ensureRegistered(returnUrl)
      if (!profile) return
      if (roomId) await this.joinRoom(roomId)
      else this.setData({ stage: 'choose' })
    } catch (error) {
      wx.showToast({ title: error.message || '进入失败', icon: 'none' })
      this.setData({ stage: 'choose' })
    }
  },

  onUnload() { this.stopPolling() },

  async createRoom(event) {
    const gameId = event.currentTarget.dataset.id
    wx.showLoading({ title: '创建房间', mask: true })
    try {
      const room = await createGameRoom('party', gameId)
      this.applyRoom(room)
      this.startPolling()
    } catch (error) {
      wx.showToast({ title: error.message || '创建失败', icon: 'none' })
    } finally { wx.hideLoading() }
  },

  async joinRoom(roomId) {
    wx.showLoading({ title: '加入聚会', mask: true })
    try {
      const room = await joinGameRoom(roomId)
      this.applyRoom(room)
      this.startPolling()
    } finally { wx.hideLoading() }
  },

  async startRoom() {
    try { this.applyRoom(await startGameRoom(this.data.roomId)) }
    catch (error) { wx.showToast({ title: error.message || '暂时不能开始', icon: 'none' }) }
  },

  async nextRound() {
    try { this.applyRoom(await nextPartyRound(this.data.roomId)) }
    catch (error) { wx.showToast({ title: error.message || '切换失败', icon: 'none' }) }
  },

  onGuessInput(event) { this.setData({ guess: event.detail.value }) },

  async submitGuess() {
    try {
      const room = await guessPartyNumber(this.data.roomId, Number(this.data.guess))
      this.setData({ guess: '' })
      this.applyRoom(room)
    } catch (error) { wx.showToast({ title: error.message || '数字无效', icon: 'none' }) }
  },

  applyRoom(room) {
    if (!room) return
    this.setData({
      roomId: room.id,
      room,
      players: room.players || [],
      isOwner: room.isOwner,
      gameTitle: room.gameTitle,
      party: room.party || {},
      secret: room.secret || '',
      stage: room.status === 'waiting' ? 'lobby' : 'playing'
    })
  },

  startPolling() {
    this.stopPolling()
    this.poller = setInterval(async () => {
      if (this.polling || !this.data.roomId) return
      this.polling = true
      try { this.applyRoom(await getGameRoom(this.data.roomId)) }
      catch (error) { console.warn('聚会房间同步失败', error) }
      finally { this.polling = false }
    }, 1500)
  },

  stopPolling() { if (this.poller) clearInterval(this.poller); this.poller = null },

  backToGames() {
    this.stopPolling()
    this.setData({ stage: 'choose', roomId: '', room: null, players: [], secret: '', party: {} })
  },

  onShareAppMessage() {
    if (this.data.roomId) return { title: `我开了“${this.data.gameTitle}”房间，来一起玩`, path: `/pages/party/index?roomId=${this.data.roomId}` }
    return { title: '聚会不冷场，选个小游戏一起玩', path: '/pages/party/index' }
  }
})
