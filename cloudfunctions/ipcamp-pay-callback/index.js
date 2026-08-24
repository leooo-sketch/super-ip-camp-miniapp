const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const command = db.command

function success() {
  return { errcode: 0, errmsg: 'ok' }
}

function retry(message) {
  return { errcode: -1, errmsg: String(message || 'callback failed').slice(0, 120) }
}

exports.main = async (event) => {
  if (!event || event.return_code !== 'SUCCESS' || event.result_code !== 'SUCCESS') return success()
  const orderId = String(event.out_trade_no || '').trim()
  const openid = String(event.openid || '').trim()
  const amountFen = Number(event.total_fee)
  if (!orderId || !openid || !Number.isInteger(amountFen) || amountFen <= 0) return retry('invalid payment callback')

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection('orders').doc(orderId)
      const orderResult = await orderRef.get()
      const order = orderResult.data
      if (!order) throw new Error('order not found')
      if (order.status === 'paid') return
      if (order.ownerOpenId !== openid) throw new Error('openid mismatch')
      if (Number(order.amountFen) !== amountFen) throw new Error('amount mismatch')
      if (!Number.isInteger(Number(order.tokens)) || Number(order.tokens) <= 0) throw new Error('invalid points')

      const now = Date.now()
      await transaction.collection('users').doc(openid).update({
        data: { balance: command.inc(Number(order.tokens)), updatedAt: now }
      })
      await orderRef.update({ data: {
        status: 'paid',
        transactionId: String(event.transaction_id || '').slice(0, 64),
        paidAt: now,
        updatedAt: now
      } })
      await transaction.collection('token_ledger').doc(`${orderId}_credit`).set({ data: {
        ownerOpenId: openid,
        orderId,
        type: 'recharge_credit',
        amount: Number(order.tokens),
        amountFen,
        createdAt: now
      } })
    })
    return success()
  } catch (error) {
    console.error('ipcamp-pay-callback error', { orderId, message: error.message, stack: error.stack })
    return retry(error.message)
  }
}

exports._test = { success, retry }
