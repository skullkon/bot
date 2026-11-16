// Builds a chain of puzzles from the layout pool and the dictionary:
//   node tools/generator/generate.js <series> <count> [seed]
// Writes data/puzzles/<series>.json. A chat plays the chain in order, so a word may
// not come back until WINDOW puzzles later, and its clues rotate between uses.
import fs from 'node:fs'
import path from 'node:path'
import { analyze, mulberry32, DEFAULT_MASK_OPTS } from './mask.js'
import { buildIndex, fillMask } from './fill.js'
import { validatePuzzle, arrowKind } from '../../tgcloud/lib/core.js'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const WINDOW = 30
const FILL_TRIES = 25

export function buildPuzzle({ slug, W, H, slots, clueOf, words, clueFor }) {
  // Number the words in reading order of their clue cells.
  const order = slots.map((_, i) => i).sort((a, b) => clueOf[a] - clueOf[b] || (slots[a].dir === 'right' ? -1 : 1))
  const puzzle = { slug, width: W, height: H, clues: [], words: [] }
  const clueAt = new Map()
  order.forEach((si, id) => {
    const s = slots[si]
    const e = words[si]
    puzzle.words.push({ id, dir: s.dir, start: s.start, len: s.len, answer: e.w, clue: clueFor(e) })
    if (!clueAt.has(clueOf[si])) {
      const clue = { idx: clueOf[si], slots: [] }
      clueAt.set(clueOf[si], clue)
      puzzle.clues.push(clue)
    }
    clueAt.get(clueOf[si]).slots.push({ wordId: id })
  })
  // In a split cell the upper half belongs to the word that leaves upwards/rightwards first.
  const rank = { right: 0, 'right-down': 1, 'down-right': 2, down: 3 }
  for (const clue of puzzle.clues) {
    clue.slots.sort((a, b) => rank[arrowKind(W, clue.idx, puzzle.words[a.wordId])] - rank[arrowKind(W, clue.idx, puzzle.words[b.wordId])])
  }
  return puzzle
}

function main() {
  const series = process.argv[2]
  const count = Number(process.argv[3] ?? 10)
  const seed = Number(process.argv[4] ?? 1)
  if (!series) throw new Error('usage: generate.js <series> <count> [seed]')
  const dictionary = JSON.parse(fs.readFileSync(`${root}/tools/dict/dictionary.json`, 'utf8'))
  const masks = JSON.parse(fs.readFileSync(`${root}/tools/generator/masks.json`, 'utf8'))
  const index = buildIndex(dictionary)
  const rnd = mulberry32(seed)
  const usage = new Map()
  const recent = []
  const puzzles = []
  const order = masks.map((_, i) => i).sort(() => rnd() - 0.5)
  let cursor = 0
  let failedMasks = 0

  while (puzzles.length < count) {
    if (cursor >= order.length * 3) throw new Error(`layout pool exhausted after ${puzzles.length} puzzles — add layouts`)
    const m = masks[order[cursor++ % order.length]]
    const mask = Uint8Array.from(m.mask, Number)
    const a = analyze(mask, m.w, m.h, DEFAULT_MASK_OPTS)
    if (a.hard !== 0) throw new Error(`layout ${m.seed} is broken`)
    const banned = new Set(recent.flat())
    let filled = null
    for (let t = 0; t < FILL_TRIES && !filled; t++) {
      filled = fillMask({ slots: a.slots, W: m.w, H: m.h, index, rnd, banned, usage })
    }
    if (!filled) { failedMasks++; continue }
    const slug = `${series}-${String(puzzles.length).padStart(4, '0')}`
    const puzzle = buildPuzzle({
      slug, W: m.w, H: m.h, slots: a.slots, clueOf: a.clueOf, words: filled.words,
      clueFor: (e) => e.c[(usage.get(e.w) ?? 0) % e.c.length],
    })
    const problems = validatePuzzle(puzzle, { strict: true })
    if (problems.length) throw new Error(`${slug}: ${problems.join('; ')}`)
    for (const e of filled.words) usage.set(e.w, (usage.get(e.w) ?? 0) + 1)
    recent.push(filled.words.map((e) => e.w))
    if (recent.length > WINDOW) recent.shift()
    puzzles.push(puzzle)
  }

  fs.mkdirSync(`${root}/data/puzzles`, { recursive: true })
  const file = `${root}/data/puzzles/${series}.json`
  fs.writeFileSync(file, '[\n' + puzzles.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n')

  // Report
  const tierOf = new Map(dictionary.map((e) => [e.w, e]))
  const lens = {}
  const tiers = { 1: 0, 2: 0, 3: 0 }
  let total = 0
  let proper = 0
  for (const p of puzzles) for (const w of p.words) {
    lens[w.len] = (lens[w.len] ?? 0) + 1
    tiers[tierOf.get(w.answer).t]++
    if (tierOf.get(w.answer).p) proper++
    total++
  }
  const top = [...usage].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, n]) => `${w}×${n}`).join(' ')
  console.log(`${puzzles.length} puzzles -> ${path.relative(root, file)}; layouts that would not fill: ${failedMasks}`)
  console.log(`words per puzzle ${(total / puzzles.length).toFixed(1)}, average length ${(Object.entries(lens).reduce((s, [l, n]) => s + l * n, 0) / total).toFixed(2)}`)
  console.log('length share', Object.entries(lens).map(([l, n]) => `${l}:${((100 * n) / total).toFixed(0)}%`).join(' '))
  console.log(`tier share 1:${((100 * tiers[1]) / total).toFixed(1)}% 2:${((100 * tiers[2]) / total).toFixed(1)}% 3:${((100 * tiers[3]) / total).toFixed(1)}%, proper nouns ${((100 * proper) / total).toFixed(1)}%`)
  console.log(`distinct words ${usage.size} of ${dictionary.length}; most used: ${top}`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) main()
