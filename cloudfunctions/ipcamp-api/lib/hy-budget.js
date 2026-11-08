const DEFAULT_DAILY_LIMIT = 20
const DEFAULT_ACTIVE_LIMIT = 3

function dayKey(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function cappedLimit(value, maximum) {
  if (value === undefined || value === '') return maximum
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error('混元视频预算配置无效')
  return Math.min(number, maximum)
}

function limits(env = process.env) {
  return {
    daily: cappedLimit(env.TOKENHUB_DAILY_TASK_LIMIT, DEFAULT_DAILY_LIMIT),
    active: cappedLimit(env.TOKENHUB_MAX_ACTIVE_TASKS, DEFAULT_ACTIVE_LIMIT),
    perUserActive: 1
  }
}

function assertCapacity(budget, user, cap = limits()) {
  if (Number(budget && budget.submitted || 0) >= cap.daily) throw new Error('混元视频今日全站预算已用完')
  if (Number(budget && budget.active || 0) >= cap.active) throw new Error('混元视频当前排队已满，请稍后再试')
  if (Number(user && user.hyActive || 0) >= cap.perUserActive) throw new Error('请等待当前混元视频任务完成')
}

module.exports = { dayKey, limits, assertCapacity, DEFAULT_DAILY_LIMIT, DEFAULT_ACTIVE_LIMIT }
