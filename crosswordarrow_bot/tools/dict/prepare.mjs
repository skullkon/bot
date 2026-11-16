// One-off: builds review chunks from the old puzzle dump and a lemma list from hunspell.
import fs from 'node:fs'
const [dump, dic, out] = process.argv.slice(2)
const all = JSON.parse(fs.readFileSync(dump, 'utf8'))
const m = new Map()
for (const p of all) for (const [a, c] of p.w) { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(c) }
const words = [...m.keys()].sort()
fs.writeFileSync(`${out}/old-words.txt`, words.join('\n') + '\n')
const N = 6
for (let k = 0; k < N; k++) {
  const lines = words.filter((_, i) => i % N === k).map((w) => `${w}\t${[...m.get(w)].join(' | ')}`)
  fs.writeFileSync(`${out}/chunks/${k + 1}.tsv`, lines.join('\n') + '\n')
}
const lemmas = new Set()
for (const line of fs.readFileSync(dic, 'utf8').split('\n')) {
  const w = line.split('/')[0].trim()
  if (!w || !/^[а-яё]+$/.test(w)) continue
  lemmas.add(w.toUpperCase().replaceAll('Ё', 'Е'))
}
fs.writeFileSync(`${out}/lemmas.txt`, [...lemmas].sort().join('\n') + '\n')
console.log('words', words.length, 'lemmas', lemmas.size)
