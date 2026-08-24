const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  if (!process.env.WORKER_TOKEN) throw new Error('未配置 WORKER_TOKEN')
  const result = await cloud.callFunction({
    name: 'ipcamp-api',
    data: {
      action: 'worker.sync',
      data: { workerToken: process.env.WORKER_TOKEN }
    }
  })
  if (!result.result || !result.result.ok) {
    throw new Error((result.result && result.result.message) || '任务同步失败')
  }
  return result.result.data
}
