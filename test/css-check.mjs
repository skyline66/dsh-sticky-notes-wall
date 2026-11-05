import { readFileSync } from 'node:fs'
const source = readFileSync('client.js', 'utf8')
for (const name of ['ICON_CSS', 'WALL_CSS', 'TOAST_CSS', 'FLOAT_CSS', 'THEME_CSS', 'SETTINGS_CSS']) {
  const marker = `const ${name} = \``
  const start = source.indexOf(marker)
  if (start < 0) {
    console.log(`${name}: NOT FOUND`)
    continue
  }
  const from = start + marker.length
  const end = source.indexOf('`', from)
  const css = source.slice(from, end)
  let balance = 0
  let min = 0
  for (const char of css) {
    if (char === '{') balance += 1
    else if (char === '}') {
      balance -= 1
      if (balance < min) min = balance
    }
  }
  console.log(`${name}: chars=${css.length} braces=${balance} min=${min} interpolation=${css.includes('${')}`)
  if (balance !== 0 || min < 0) throw new Error(`${name} has unbalanced braces`)
  if (css.includes('${')) throw new Error(`${name} contains an unexpected template interpolation`)
}