// Pure scanword logic shared by endpoints, the offline generator and the Mini App.
// Keep it import-free: it also runs under Node tests and in the browser.

export const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
const LETTER_SET = new Set(LETTERS)

export function normalizeLetter(input) {
  if (typeof input !== 'string' || [...input].length !== 1) return null
  const ch = input.toUpperCase().replace('Ё', 'Е')
  return LETTER_SET.has(ch) ? ch : null
}

export function normalizeWord(word) {
  return word.toUpperCase().replaceAll('Ё', 'Е')
}

export function wordCells(puzzle, word) {
  const step = word.dir === 'right' ? 1 : puzzle.width
  return Array.from({ length: word.len }, (_, i) => word.start + i * step)
}

export function buildCellIndex(puzzle) {
  const index = new Map()
  for (const word of puzzle.words) {
    for (const idx of wordCells(puzzle, word)) {
      if (!index.has(idx)) index.set(idx, [])
      index.get(idx).push(word.id)
    }
  }
  return index
}

export function wordsAt(puzzle, idx) {
  return puzzle.words.filter((word) => wordCells(puzzle, word).includes(idx))
}

export function isWordSolved(puzzle, word, letterAt) {
  return wordCells(puzzle, word).every((idx, i) => letterAt(idx) === word.answer[i])
}

export function nextRevealCell(puzzle, word, letterAt) {
  const cells = wordCells(puzzle, word)
  const i = cells.findIndex((idx, k) => letterAt(idx) !== word.answer[k])
  return i === -1 ? null : { idx: cells[i], letter: word.answer[i] }
}

export function publicPuzzle(puzzle) {
  return {
    width: puzzle.width,
    height: puzzle.height,
    clues: puzzle.clues.map((c) => ({ idx: c.idx, slots: c.slots.map((s) => ({ dir: s.dir, wordId: s.wordId })) })),
    words: puzzle.words.map(({ id, dir, start, len, clue }) => ({ id, dir, start, len, clue })),
  }
}

export function validatePuzzle(p) {
  if (!p || typeof p !== 'object') return ['not an object']
  const errors = []
  const { width: W, height: H, words, clues } = p
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 5 || H < 5 || W > 30 || H > 30) errors.push('bad size')
  if (!Array.isArray(words) || !words.length) errors.push('no words')
  if (!Array.isArray(clues)) errors.push('no clues')
  if (errors.length) return errors

  const clueCells = new Set(clues.map((c) => c.idx))
  const letters = new Map()
  const answers = new Set()
  words.forEach((w, i) => {
    const tag = `word ${i}`
    if (w.id !== i) errors.push(`${tag}: id must equal index`)
    if (w.dir !== 'right' && w.dir !== 'down') return errors.push(`${tag}: bad dir`)
    if (typeof w.answer !== 'string' || w.answer.length !== w.len || ![...w.answer].every((ch) => LETTER_SET.has(ch))) {
      return errors.push(`${tag}: bad answer`)
    }
    if (typeof w.clue !== 'string' || !w.clue.trim() || w.clue.length > 60) errors.push(`${tag}: bad clue`)
    if (answers.has(w.answer)) errors.push(`${tag}: duplicate answer`)
    answers.add(w.answer)
    const r = Math.floor(w.start / W)
    const c = w.start % W
    const fits = Number.isInteger(w.start) && w.start >= 0 && r < H && (w.dir === 'right' ? c + w.len <= W : r + w.len <= H)
    if (!fits) return errors.push(`${tag}: out of grid`)
    wordCells(p, w).forEach((idx, k) => {
      if (clueCells.has(idx)) errors.push(`${tag}: covers clue cell ${idx}`)
      const prev = letters.get(idx)
      if (prev && prev !== w.answer[k]) errors.push(`${tag}: conflict at ${idx}`)
      letters.set(idx, w.answer[k])
    })
  })

  const slotted = new Set()
  for (const clue of clues) {
    if (!Array.isArray(clue.slots) || clue.slots.length < 1 || clue.slots.length > 2) {
      errors.push(`clue ${clue.idx}: bad slots`)
      continue
    }
    for (const s of clue.slots) {
      const w = words[s.wordId]
      if (!w || w.dir !== s.dir) {
        errors.push(`clue ${clue.idx}: bad slot`)
        continue
      }
      const expected = s.dir === 'right' ? clue.idx + 1 : clue.idx + W
      const wraps = s.dir === 'right' && clue.idx % W === W - 1
      if (w.start !== expected || wraps) errors.push(`clue ${clue.idx}: word ${w.id} not adjacent`)
      if (slotted.has(w.id)) errors.push(`word ${w.id}: in two clues`)
      slotted.add(w.id)
    }
  }
  words.forEach((w) => {
    if (!slotted.has(w.id)) errors.push(`word ${w.id}: no clue`)
  })
  return errors
}

export function parseCommand(text, botUsername) {
  const m = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec((text ?? '').trim())
  if (!m) return null
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null
  return { cmd: m[1], arg: (m[3] ?? '').trim() }
}

export function parseStartParam(param) {
  const m = /^g_(\d+)$/.exec(param ?? '')
  return m ? Number(m[1]) : null
}

export function formatDuration(sec) {
  const min = Math.max(1, Math.round(sec / 60))
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}
