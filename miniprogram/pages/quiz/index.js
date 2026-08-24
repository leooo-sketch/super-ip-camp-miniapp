const { shuffledQuestions } = require('../../data/questions')
const {
  ensureRegistered,
  createGameRoom,
  joinGameRoom,
  getGameRoom,
  startGameRoom,
  answerQuizRoom
} = require('../../utils/api')

function practiceRound() {
  const previous = wx.getStorageSync('quiz_last_question_ids') || []
  let pool = shuffledQuestions()
  const fresh = pool.filter((item) => !previous.includes(item.id))
  if (fresh.length >= 8) pool = fresh.concat(pool.filter((item) => previous.includes(item.id)))
  const selected = pool.slice(0, 8).map((item, index) => ({ ...item, index, double: false }))
  const indexes = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5).slice(0, 2)
  indexes.forEach((index) => { selected[index].double = true })
  wx.setStorageSync('quiz_last_question_ids', selected.map((item) => item.id))
  return selected
}

Page({
  data: {
    stage: 'loading', mode: '', roomId: '', room: null, players: [], isOwner: false,
    questions: [], current: 0, question: {}, seconds: 30, letters: ['A', 'B', 'C', 'D'],
    score: 0, opponentScore: 0, opponentName: '等待好友', selected: -1,
    correctIndex: -1, answered: false, correctCount: 0
  },

  async onLoad(options) {
    const roomId = String(options.roomId || '')
    const returnUrl = roomId ? `/pages/quiz/index?roomId=${roomId}` : '/pages/quiz/index'
    try {
      const profile = await ensureRegistered(returnUrl)
      if (!profile) return
      if (roomId) await this.joinRoom(roomId)
      else this.setData({ stage: 'home' })
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      this.setData({ stage: 'home' })
    }
  },

  onUnload() { this.stopTimer(); this.stopPolling() },

  startPractice() {
    this.stopPolling()
    const questions = practiceRound()
    this.setData({ mode: 'practice', roomId: '', questions, score: 0, opponentScore: 0, opponentName: '单人练习', correctCount: 0 })
    this.showQuestion(0)
  },

  async createFriendRoom() {
    wx.showLoading({ title: '创建房间', mask: true })
    try {
      const room = await createGameRoom('quiz')
      this.applyRoom(room)
      this.startPolling()
    } catch (error) {
      wx.showToast({ title: error.message || '创建失败', icon: 'none' })
    } finally { wx.hideLoading() }
  },

  async joinRoom(roomId) {
    wx.showLoading({ title: '加入房间', mask: true })
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

  applyRoom(room) {
    if (!room) return
    const opponents = (room.players || []).filter((item) => item.id !== room.selfId)
    const opponent = opponents.sort((left, right) => right.score - left.score)[0]
    this.setData({
      mode: 'room', roomId: room.id, room, players: room.players || [], isOwner: room.isOwner,
      score: room.self ? room.self.score : 0, correctCount: room.self ? room.self.correctCount : 0,
      opponentScore: opponent ? opponent.score : 0, opponentName: opponent ? opponent.nickname : '等待好友'
    })
    if (room.status === 'waiting') { this.stopTimer(); this.setData({ stage: 'lobby' }); return }
    if (room.self && room.self.finished) { this.stopTimer(); this.setData({ stage: 'result' }); return }
    if (room.status === 'playing') {
      const next = room.self ? room.self.answeredCount : 0
      if (this.transitioning) return
      if (this.data.stage !== 'playing' || this.data.current !== next || !this.data.questions.length) {
        this.setData({ questions: room.questions || [] })
        this.showQuestion(next)
      }
    }
  },

  startPolling() {
    this.stopPolling()
    this.poller = setInterval(async () => {
      if (this.polling || !this.data.roomId) return
      this.polling = true
      try { this.applyRoom(await getGameRoom(this.data.roomId)) }
      catch (error) { console.warn('房间同步失败', error) }
      finally { this.polling = false }
    }, 1500)
  },

  stopPolling() { if (this.poller) clearInterval(this.poller); this.poller = null },

  showQuestion(index) {
    this.stopTimer()
    const question = this.data.questions[index]
    if (!question) { this.setData({ stage: 'result' }); return }
    this.setData({ stage: 'playing', current: index, question, seconds: 30, selected: -1, correctIndex: -1, answered: false })
    this.timer = setInterval(() => {
      const seconds = this.data.seconds - 1
      this.setData({ seconds })
      if (seconds <= 0) this.answer({ currentTarget: { dataset: { index: -1 } } })
    }, 1000)
  },

  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null },

  async answer(event) {
    if (this.data.answered || this.transitioning) return
    this.stopTimer()
    const selected = Number(event.currentTarget.dataset.index)
    const question = this.data.question
    if (this.data.mode === 'practice') {
      const correct = selected === question.c
      const awarded = correct ? (question.double ? 200 : 100) : 0
      this.setData({ selected, correctIndex: question.c, answered: true, score: this.data.score + awarded, correctCount: this.data.correctCount + (correct ? 1 : 0) })
      setTimeout(() => { if (this.data.current >= 7) this.setData({ stage: 'result' }); else this.showQuestion(this.data.current + 1) }, 850)
      return
    }
    this.transitioning = true
    this.setData({ selected, answered: true })
    try {
      const result = await answerQuizRoom(this.data.roomId, this.data.current, selected)
      this.setData({ correctIndex: result.correctIndex, score: result.room.self.score, correctCount: result.room.self.correctCount })
      setTimeout(() => { this.transitioning = false; this.applyRoom(result.room) }, 850)
    } catch (error) {
      this.transitioning = false
      this.setData({ answered: false })
      wx.showToast({ title: error.message || '提交答案失败', icon: 'none' })
    }
  },

  backHome() {
    this.stopTimer(); this.stopPolling()
    this.setData({ stage: 'home', mode: '', roomId: '', room: null, questions: [], score: 0, correctCount: 0 })
  },

  onShareAppMessage() {
    if (this.data.roomId) return { title: '我创建了王者对决房间，等你来答 8 道题！', path: `/pages/quiz/index?roomId=${this.data.roomId}` }
    return { title: '来一场 8 题知识对决', path: '/pages/quiz/index' }
  }
})
