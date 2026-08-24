const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const errors = []

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

const files = walk(root)

for (const file of files.filter((item) => item.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(root, file)}: JSON 无效 - ${error.message}`)
  }
}

for (const file of files.filter((item) => item.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) errors.push(`${path.relative(root, file)}: JS 语法错误\n${result.stderr}`)
}

for (const file of files.filter((item) => item.endsWith('.wxml'))) {
  const content = fs.readFileSync(file, 'utf8')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\{\{[^}]*\}\}/g, 'EXPR')
  const stack = []
  const tagPattern = /<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*?)?\s*\/?>/g
  let match
  while ((match = tagPattern.exec(content))) {
    const token = match[0]
    const tag = match[1]
    if (token.startsWith('</')) {
      const expected = stack.pop()
      if (expected !== tag) {
        errors.push(`${path.relative(root, file)}: 标签闭合错误，期望 </${expected}>，实际 </${tag}>`)
        break
      }
    } else if (!token.endsWith('/>')) {
      stack.push(tag)
    }
  }
  if (stack.length) errors.push(`${path.relative(root, file)}: 未闭合标签 <${stack[stack.length - 1]}>`)
}

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram', 'app.json'), 'utf8'))
for (const page of appConfig.pages) {
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    const file = path.join(root, 'miniprogram', `${page}${extension}`)
    if (!fs.existsSync(file)) errors.push(`缺少页面文件: ${path.relative(root, file)}`)
  }
}

for (const file of files.filter((item) => /\.(js|json|wxml|wxss|md)$/.test(item))) {
  const content = fs.readFileSync(file, 'utf8')
  if (content.includes('\uFFFD')) errors.push(`${path.relative(root, file)}: 包含无效 UTF-8 替换字符`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`项目检查通过：${appConfig.pages.length} 个页面，${files.length} 个文件。`)
}
