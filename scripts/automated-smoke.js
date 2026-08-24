const path = require('path')

async function main() {
  const automator = require(path.join(process.env.TEMP, 'codex-miniapp-automator', 'node_modules', 'miniprogram-automator'))
  const port = process.env.MINI_AUTOMATOR_PORT || '9420'
  const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` })

  await miniProgram.reLaunch('/pages/profile/index')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  let page = await miniProgram.currentPage()
  const profilePath = page.path
  const gamesEntry = await page.$('.mind-break')
  if (!gamesEntry) throw new Error('账户页未找到益智游戏入口')
  await gamesEntry.tap()
  await new Promise((resolve) => setTimeout(resolve, 500))

  page = await miniProgram.currentPage()
  const gamesPath = page.path
  const quizEntry = await page.$('.quiz-card')
  if (!quizEntry) throw new Error('游戏中心未找到王者对决')
  await quizEntry.tap()
  await new Promise((resolve) => setTimeout(resolve, 500))

  page = await miniProgram.currentPage()
  const quizPath = page.path
  const question = await page.$('.question')
  const questionText = question ? await question.text() : ''
  if (!questionText) throw new Error('王者对决未显示题目')

  await miniProgram.reLaunch('/pages/party/index')
  await new Promise((resolve) => setTimeout(resolve, 500))
  page = await miniProgram.currentPage()
  const partyCards = await page.$$('.party-card')
  if (partyCards.length !== 5) throw new Error(`聚会小游戏数量异常：${partyCards.length}`)

  console.log(JSON.stringify({ profilePath, gamesPath, quizPath, questionLoaded: true, partyGames: partyCards.length }))
  await miniProgram.disconnect()
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
