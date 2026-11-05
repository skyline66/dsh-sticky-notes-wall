import { readFileSync } from 'node:fs'

for (const file of ['package.json', 'locale/zh.json', 'locale/en.json']) {
  JSON.parse(readFileSync(file, 'utf8'))
  console.log(`${file}: json ok`)
}

const client = readFileSync('client.js', 'utf8')
const replacement = (client.match(/\uFFFD/g) ?? []).length
console.log('client chars:', client.length)
console.log('replacement chars:', replacement)
console.log('has zh sidebar label:', client.includes("'便签墙'"))
console.log('has float css:', client.includes('FLOAT_CSS'))
console.log('has float registration:', client.includes("'sticky-notes.float'"))
console.log('pointer-events auto:', client.includes('pointer-events: auto'))