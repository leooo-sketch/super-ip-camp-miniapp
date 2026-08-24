function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(timestamp) {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatTokens(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

module.exports = { formatDate, formatTokens }
