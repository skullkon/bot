// Merges the edited parts (reviewed/*.jsonl, new/*.jsonl) into tools/dict/dictionary.json.
import fs from 'node:fs'
import path from 'node:path'
const dir = path.dirname(new URL(import.meta.url).pathname)
const read = (sub) => fs.readdirSync(`${dir}/${sub}`).filter((f) => f.endsWith('.jsonl')).sort()
  .flatMap((f) => fs.readFileSync(`${dir}/${sub}/${f}`, 'utf8').split('\n').filter((l) => l.trim()).map((l) => ({ ...JSON.parse(l), src: `${sub}/${f}` })))
const out = new Map()
let dropped = 0
let dup = 0
for (const e of [...read('reviewed'), ...read('new')]) {
  if (!/^[А-Я]{3,10}$/.test(e.w) || e.w.includes('Ё')) throw new Error(`bad word ${e.w} in ${e.src}`)
  if (e.t === 0) { dropped++; continue }
  if (out.has(e.w)) { dup++; continue }
  const clues = [...new Set((e.c ?? []).map((c) => c.trim()).filter((c) => c.length >= 3 && c.length <= 42))]
  if (!clues.length) { dropped++; continue }
  out.set(e.w, { w: e.w, t: e.t, c: clues, ...(e.p ? { p: 1 } : {}) })
}
const list = [...out.values()].sort((a, b) => (a.w < b.w ? -1 : 1))
fs.writeFileSync(`${dir}/dictionary.json`, '[\n' + list.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n')
const stat = {}
for (const e of list) { const k = `${e.w.length}`; stat[k] ??= [0, 0, 0]; stat[k][e.t - 1]++ }
console.log(`${list.length} words (${dropped} dropped, ${dup} duplicates)`)
console.log('length: [tier1, tier2, tier3]', JSON.stringify(stat))
