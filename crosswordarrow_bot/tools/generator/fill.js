// Fills a layout with words: depth-first search over the slots, always taking the
// slot with the fewest fitting words, with forward checking through the crossings.
// Word choice is a weighted lottery that favours well-known words and words that
// have been used least, under per-puzzle budgets for the weaker tiers.

const ALPHABET = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
const LETTER_ID = new Map([...ALPHABET].map((ch, i) => [ch, i]))

function popcount(x) {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// Index of the dictionary by length: for every (position, letter) a bitset of words.
export function buildIndex(entries) {
  const byLen = new Map()
  for (const e of entries) {
    if (!byLen.has(e.w.length)) byLen.set(e.w.length, [])
    byLen.get(e.w.length).push(e)
  }
  const index = new Map()
  for (const [len, list] of byLen) {
    const size = Math.ceil(list.length / 32)
    const bits = Array.from({ length: len }, () => Array.from({ length: ALPHABET.length }, () => new Uint32Array(size)))
    const tier = [0, 1, 2, 3].map(() => new Uint32Array(size))
    const proper = new Uint32Array(size)
    list.forEach((e, i) => {
      for (let p = 0; p < len; p++) bits[p][LETTER_ID.get(e.w[p])][i >>> 5] |= 1 << (i & 31)
      tier[e.t][i >>> 5] |= 1 << (i & 31)
      if (e.p) proper[i >>> 5] |= 1 << (i & 31)
    })
    index.set(len, { list, size, bits, tier, proper })
  }
  return index
}

export const DEFAULT_FILL_OPTS = {
  maxTier2: 6,
  maxTier3: 0,
  maxProper: 4,
  maxNodes: 30000,
  branch: 10,
  tierWeight: [0, 1, 0.12, 0.01],
}

// `banned` holds words that may not be used (recently played in the chain);
// `usage` maps word -> how many puzzles already contain it.
export function fillMask({ slots, W, H, index, rnd, banned = new Set(), usage = new Map(), options = {} }) {
  const opts = { ...DEFAULT_FILL_OPTS, ...options }
  const grid = new Int8Array(W * H).fill(-1)
  const cellSlots = Array.from({ length: W * H }, () => [])
  slots.forEach((s, si) => s.cells.forEach((c, k) => cellSlots[c].push([si, k])))
  for (const s of slots) if (!index.has(s.len)) return null

  // Words that may still be placed, per length.
  const avail = new Map()
  for (const [len, ix] of index) {
    const a = new Uint32Array(ix.size)
    ix.list.forEach((e, i) => { if (e.t > 0 && !banned.has(e.w)) a[i >>> 5] |= 1 << (i & 31) })
    avail.set(len, a)
  }
  const assigned = new Array(slots.length).fill(null)
  const usedStems = new Set()
  const count = { 2: 0, 3: 0, proper: 0 }
  let nodes = 0
  const scratch = new Map([...index].map(([len, ix]) => [len, new Uint32Array(ix.size)]))

  const candidates = (si, out) => {
    const s = slots[si]
    const ix = index.get(s.len)
    out.set(avail.get(s.len))
    if (count[2] >= opts.maxTier2) for (let k = 0; k < ix.size; k++) out[k] &= ~ix.tier[2][k]
    if (count[3] >= opts.maxTier3) for (let k = 0; k < ix.size; k++) out[k] &= ~ix.tier[3][k]
    if (count.proper >= opts.maxProper) for (let k = 0; k < ix.size; k++) out[k] &= ~ix.proper[k]
    for (let p = 0; p < s.len; p++) {
      const ch = grid[s.cells[p]]
      if (ch === -1) continue
      const b = ix.bits[p][ch]
      for (let k = 0; k < ix.size; k++) out[k] &= b[k]
    }
    let n = 0
    for (let k = 0; k < ix.size; k++) n += popcount(out[k])
    return n
  }

  const weightOf = (e) => opts.tierWeight[e.t] / Math.pow(1 + (usage.get(e.w) ?? 0), 2)

  const solve = () => {
    if (++nodes > opts.maxNodes) return false
    // most constrained open slot
    let best = -1
    let bestN = Infinity
    for (let si = 0; si < slots.length; si++) {
      if (assigned[si]) continue
      const n = candidates(si, scratch.get(slots[si].len))
      if (n === 0) return false
      // fewest fitting words first; long slots break ties
      const key = n - slots[si].len * 0.01
      if (key < bestN) { bestN = key; best = si }
    }
    if (best === -1) return true

    const s = slots[best]
    const ix = index.get(s.len)
    const set = new Uint32Array(ix.size)
    candidates(best, set)
    const picks = []
    for (let k = 0; k < ix.size; k++) {
      let v = set[k]
      while (v) {
        const bit = v & -v
        const i = (k << 5) + (31 - Math.clz32(bit))
        v ^= bit
        const e = ix.list[i]
        if (usedStems.has(e.w.slice(0, 4))) continue
        picks.push([-Math.log(1 - rnd()) / weightOf(e), i])
      }
    }
    picks.sort((a, b) => a[0] - b[0])
    const limit = Math.min(picks.length, opts.branch)
    for (let n = 0; n < limit; n++) {
      const i = picks[n][1]
      const e = ix.list[i]
      const changed = []
      for (let p = 0; p < s.len; p++) {
        const c = s.cells[p]
        if (grid[c] === -1) { grid[c] = LETTER_ID.get(e.w[p]); changed.push(c) }
      }
      assigned[best] = e
      avail.get(s.len)[i >>> 5] &= ~(1 << (i & 31))
      const stem = e.w.slice(0, 4)
      usedStems.add(stem)
      if (e.t >= 2) count[e.t]++
      if (e.p) count.proper++

      // forward check the crossing slots
      let ok = true
      const seen = new Set()
      for (const c of changed) {
        for (const [sj] of cellSlots[c]) {
          if (sj === best || assigned[sj] || seen.has(sj)) continue
          seen.add(sj)
          if (candidates(sj, scratch.get(slots[sj].len)) === 0) { ok = false; break }
        }
        if (!ok) break
      }
      if (ok && solve()) return true

      assigned[best] = null
      avail.get(s.len)[i >>> 5] |= 1 << (i & 31)
      usedStems.delete(stem)
      if (e.t >= 2) count[e.t]--
      if (e.p) count.proper--
      for (const c of changed) grid[c] = -1
      if (nodes > opts.maxNodes) return false
    }
    return false
  }

  if (!solve()) return null
  return { words: assigned, nodes, count: { ...count } }
}
