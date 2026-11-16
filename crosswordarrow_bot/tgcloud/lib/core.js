// Pure scanword logic shared by the endpoints, the offline generator and the Mini App.
// Keep it import-free: it runs in the cloud runtime, under Node and in the browser.

export const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
const LETTER_SET = new Set(LETTERS)

export const MAX_CLUE_LENGTH = 60

export function normalizeLetter(input) {
  if (typeof input !== 'string' || [...input].length !== 1) return null
  const ch = input.toUpperCase().replace('Ё', 'Е')
  return LETTER_SET.has(ch) ? ch : null
}

export function wordCells(puzzle, word) {
  const step = word.dir === 'right' ? 1 : puzzle.width
  return Array.from({ length: word.len }, (_, i) => word.start + i * step)
}

// cell index -> ids of the words passing through it
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

export function isWordSolved(puzzle, word, letterAt) {
  return wordCells(puzzle, word).every((idx, i) => letterAt(idx) === word.answer[i])
}

// A word starts next to its clue cell: straight ahead, or one step sideways with a
// bent arrow. Returns the arrow kind, or null when the two are not neighbours.
//   'right'       clue | W O R D          'down'        clue above, word goes down
//   'down-right'  clue above, word goes right
//   'right-down'  clue on the left, word goes down
export function arrowKind(width, clueIdx, word) {
  const lastCol = clueIdx % width === width - 1
  if (word.start === clueIdx + 1 && !lastCol) return word.dir === 'right' ? 'right' : 'right-down'
  if (word.start === clueIdx + width) return word.dir === 'down' ? 'down' : 'down-right'
  return null
}

// What the Mini App may see: everything but the answers.
export function publicPuzzle(puzzle) {
  return {
    width: puzzle.width,
    height: puzzle.height,
    clues: puzzle.clues.map((c) => ({ idx: c.idx, slots: c.slots.map((s) => ({ wordId: s.wordId })) })),
    words: puzzle.words.map(({ id, dir, start, len, clue }) => ({ id, dir, start, len, clue })),
  }
}

// Returns a list of problems; an empty list means the puzzle is playable.
// `strict` adds the layout rules the generator promises (see tools/generator).
export function validatePuzzle(p, { strict = false } = {}) {
  if (!p || typeof p !== 'object') return ['not an object']
  const errors = []
  const { width: W, height: H, words, clues } = p
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 5 || H < 5 || W > 30 || H > 30) errors.push('bad size')
  if (!Array.isArray(words) || !words.length) errors.push('no words')
  if (!Array.isArray(clues)) errors.push('no clues')
  if (errors.length) return errors

  const clueCells = new Set(clues.map((c) => c.idx))
  if (clueCells.size !== clues.length) errors.push('duplicate clue cell')
  const letters = new Map()
  const answers = new Set()
  words.forEach((w, i) => {
    const tag = `word ${i}`
    if (!w || w.id !== i) return errors.push(`${tag}: id must equal index`)
    if (w.dir !== 'right' && w.dir !== 'down') return errors.push(`${tag}: bad dir`)
    if (typeof w.answer !== 'string' || w.answer.length !== w.len || w.len < 2 || ![...w.answer].every((ch) => LETTER_SET.has(ch))) {
      return errors.push(`${tag}: bad answer`)
    }
    if (typeof w.clue !== 'string' || !w.clue.trim() || w.clue.length > MAX_CLUE_LENGTH) errors.push(`${tag}: bad clue`)
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
    if (!Number.isInteger(clue.idx) || clue.idx < 0 || clue.idx >= W * H) {
      errors.push(`clue ${clue.idx}: out of grid`)
      continue
    }
    if (!Array.isArray(clue.slots) || clue.slots.length < 1 || clue.slots.length > 2) {
      errors.push(`clue ${clue.idx}: bad slots`)
      continue
    }
    for (const s of clue.slots) {
      const w = words[s.wordId]
      if (!w) {
        errors.push(`clue ${clue.idx}: bad slot`)
        continue
      }
      if (!arrowKind(W, clue.idx, w)) errors.push(`clue ${clue.idx}: word ${w.id} not adjacent`)
      if (slotted.has(w.id)) errors.push(`word ${w.id}: in two clues`)
      slotted.add(w.id)
    }
  }
  words.forEach((w) => {
    if (!slotted.has(w.id)) errors.push(`word ${w.id}: no clue`)
  })

  if (strict && !errors.length) {
    for (let idx = 0; idx < W * H; idx++) {
      if (!clueCells.has(idx) && !letters.has(idx)) errors.push(`cell ${idx}: neither clue nor letter`)
    }
    // Every run of two or more letter cells must be exactly one word.
    const runs = new Set(words.map((w) => `${w.dir}:${w.start}:${w.len}`))
    const scan = (dir, lines, len, at) => {
      for (let a = 0; a < lines; a++) {
        let b = 0
        while (b < len) {
          if (!letters.has(at(a, b))) { b++; continue }
          let e = b
          while (e < len && letters.has(at(a, e))) e++
          if (e - b >= 2 && !runs.has(`${dir}:${at(a, b)}:${e - b}`)) errors.push(`${dir} run at ${at(a, b)} is not a word`)
          b = e
        }
      }
    }
    scan('right', H, W, (r, c) => r * W + c)
    scan('down', W, H, (c, r) => r * W + c)
  }
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
  if (h >= 48) return `${Math.round(h / 24)} дн`
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}

// "1 слово", "2 слова", "5 слов"
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}
