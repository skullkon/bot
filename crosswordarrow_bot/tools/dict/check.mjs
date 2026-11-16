// Validates a dictionary JSONL file. Usage: node tools/dict/check.mjs <file.jsonl> [--review chunks/N.tsv] [--new]
// Line format: {"w":"ОКОП","t":1,"c":["Траншея на фронте","Укрытие пехотинца"]}   (+ "p":1 for proper nouns)
import fs from 'node:fs'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const file = args[0]
const reviewOf = args.includes('--review') ? args[args.indexOf('--review') + 1] : null
const isNew = args.includes('--new')
const lemmas = new Set(fs.readFileSync(`${dir}/lemmas.txt`, 'utf8').split('\n'))
const old = new Set(fs.readFileSync(`${dir}/old-words.txt`, 'utf8').split('\n'))
const errors = []
const warns = []
const seen = new Set()
const lens = {}
const tiers = {}
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
lines.forEach((line, i) => {
  let e
  try { e = JSON.parse(line) } catch { return errors.push(`line ${i + 1}: not JSON`) }
  const tag = `line ${i + 1} ${e.w}`
  if (typeof e.w !== 'string' || !/^[А-ЯЬЪЫ]{3,10}$/.test(e.w) || /Ё/.test(e.w)) return errors.push(`${tag}: word must be 3-10 letters А-Я uppercase, no Ё`)
  if (seen.has(e.w)) errors.push(`${tag}: duplicate in file`)
  seen.add(e.w)
  if (![0, 1, 2, 3].includes(e.t)) errors.push(`${tag}: t must be 0..3`)
  tiers[e.t] = (tiers[e.t] || 0) + 1
  if (e.t === 0) return
  lens[e.w.length] = (lens[e.w.length] || 0) + 1
  if (!Array.isArray(e.c) || e.c.length < 1 || e.c.length > 3) return errors.push(`${tag}: c must hold 1-3 clues`)
  const want = e.w.length <= 4 ? 3 : 2
  if (e.c.length < want) errors.push(`${tag}: needs ${want} clues, has ${e.c.length}`)
  if (new Set(e.c.map((c) => c.toLowerCase())).size !== e.c.length) errors.push(`${tag}: repeated clue`)
  for (const c of e.c) {
    if (typeof c !== 'string' || c.trim() !== c || c.length < 3) { errors.push(`${tag}: bad clue`); continue }
    if (c.length > 42) errors.push(`${tag}: clue longer than 42 chars (${c.length}): ${c}`)
    if (/[.!]$/.test(c)) errors.push(`${tag}: clue must not end with a period: ${c}`)
    const stem = e.w.slice(0, Math.min(e.w.length, e.w.length <= 4 ? 3 : 4)).toLowerCase()
    const norm = c.toLowerCase().replaceAll('ё', 'е')
    if (norm.split(/[^а-я]+/).some((tok) => tok.startsWith(stem) && tok.length >= stem.length + (e.w.length <= 4 ? 0 : 0) && e.w.length > 3)) warns.push(`${tag}: clue may contain a cognate: ${c}`)
    if (norm.split(/[^а-я]+/).includes(e.w.toLowerCase())) errors.push(`${tag}: clue contains the answer: ${c}`)
  }
  if (isNew && old.has(e.w)) errors.push(`${tag}: already in the old dictionary`)
  if (!e.p && !lemmas.has(e.w)) warns.push(`${tag}: not found in the spelling dictionary as a base form — double-check spelling/form`)
})
if (reviewOf) {
  const expect = fs.readFileSync(reviewOf, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0])
  for (const w of expect) if (!seen.has(w)) errors.push(`missing word from chunk: ${w}`)
  for (const w of seen) if (!expect.includes(w)) errors.push(`word not from chunk: ${w}`)
}
for (const w of warns) console.log('WARN ', w)
for (const e of errors) console.log('ERROR', e)
console.log(`\n${lines.length} lines, tiers ${JSON.stringify(tiers)}, lengths ${JSON.stringify(lens)}, ${errors.length} errors, ${warns.length} warnings`)
process.exit(errors.length ? 1 : 0)
