// Scanword layouts: which cells hold clues and which hold letters.
//
// A layout is found by simulated annealing over the clue/letter split. Hard rules
// (cost HARD each): every run of letters is 1 or 3..maxLen long, every run of 3+
// gets a clue cell next to its start, every clue cell serves 1-2 words, every letter
// belongs to a word and the words form one connected crossing. Soft terms push the
// layout towards what is pleasant to solve: few 3-letter words, a handful of long
// ones, most letters crossed, clue cells spread out and rarely split in two.

const HARD = 12

export function findSlots(mask, W, H, maxLen) {
  const slots = []
  let shortRuns = 0
  let longRuns = 0
  const add = (dir, start, len, step) => {
    if (len === 1) return
    if (len === 2) { shortRuns++; return }
    if (len > maxLen) { longRuns += len - maxLen; return }
    const cells = Array.from({ length: len }, (_, i) => start + i * step)
    slots.push({ dir, start, len, cells })
  }
  for (let r = 0; r < H; r++) {
    let c = 0
    while (c < W) {
      if (mask[r * W + c]) { c++; continue }
      let e = c
      while (e < W && !mask[r * W + e]) e++
      add('right', r * W + c, e - c, 1)
      c = e
    }
  }
  for (let c = 0; c < W; c++) {
    let r = 0
    while (r < H) {
      if (mask[r * W + c]) { r++; continue }
      let e = r
      while (e < H && !mask[e * W + c]) e++
      add('down', r * W + c, e - r, W)
      r = e
    }
  }
  return { slots, shortRuns, longRuns }
}

// Clue cells that may point at a slot: the one straight before it, or the one
// beside its first cell (a bent arrow).
function clueCandidates(mask, W, slot) {
  const out = []
  const s = slot.start
  if (s % W > 0 && mask[s - 1]) out.push(s - 1)
  if (s >= W && mask[s - W]) out.push(s - W)
  return out
}

// Gives every slot a clue cell and every clue cell one or two slots, when possible.
// Each clue cell has a mandatory and an optional port; matching the mandatory ports
// first and then augmenting from the slots keeps the mandatory ones matched.
export function assignClues(mask, W, slots) {
  const cand = slots.map((s) => clueCandidates(mask, W, s))
  const byClue = new Map()
  cand.forEach((list, si) => list.forEach((c) => { if (!byClue.has(c)) byClue.set(c, []); byClue.get(c).push(si) }))
  const slotPort = new Array(slots.length).fill(-1)
  const portSlot = new Map()

  let visited
  const fromPort = (port) => {
    for (const si of byClue.get(port >> 1) ?? []) {
      if (visited.has(si)) continue
      visited.add(si)
      if (slotPort[si] === -1 || fromPort(slotPort[si])) {
        slotPort[si] = port
        portSlot.set(port, si)
        return true
      }
    }
    return false
  }
  let deadClues = 0
  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx]) continue
    visited = new Set()
    if (!fromPort(idx * 2)) deadClues++
  }
  let seen
  const fromSlot = (si) => {
    for (const c of cand[si]) {
      for (const port of [c * 2, c * 2 + 1]) {
        if (seen.has(port)) continue
        seen.add(port)
        const cur = portSlot.get(port)
        if (cur === undefined || fromSlot(cur)) {
          slotPort[si] = port
          portSlot.set(port, si)
          return true
        }
      }
    }
    return false
  }
  let orphanSlots = 0
  for (let si = 0; si < slots.length; si++) {
    if (slotPort[si] !== -1) continue
    seen = new Set()
    if (!fromSlot(si)) orphanSlots++
  }
  return { clueOf: slotPort.map((p) => (p === -1 ? -1 : p >> 1)), deadClues, orphanSlots }
}

export function analyze(mask, W, H, opts) {
  const { maxLen } = opts
  const { slots, shortRuns, longRuns } = findSlots(mask, W, H, maxLen)
  const cover = new Uint8Array(W * H)
  for (const s of slots) for (const c of s.cells) cover[c]++
  let letters = 0
  let loose = 0
  let unchecked = 0
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) continue
    letters++
    if (cover[i] === 0) loose++
    else if (cover[i] === 1) unchecked++
  }
  const { clueOf, deadClues, orphanSlots } = assignClues(mask, W, slots)

  // Connectivity of the crossing graph (slots joined through shared cells).
  const parent = slots.map((_, i) => i)
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])))
  const owner = new Int32Array(W * H).fill(-1)
  slots.forEach((s, si) => {
    for (const c of s.cells) {
      if (owner[c] === -1) owner[c] = si
      else parent[find(si)] = find(owner[c])
    }
  })
  const components = new Set(slots.map((_, i) => find(i))).size

  const hard = shortRuns + longRuns + loose + deadClues + orphanSlots + Math.max(0, components - 1)
  return { slots, clueOf, hard, letters, unchecked, shortRuns, longRuns, loose, deadClues, orphanSlots, components }
}

export function maskCost(mask, W, H, opts) {
  const a = analyze(mask, W, H, opts)
  const clueCount = W * H - a.letters
  let soft = 0
  const byLen = new Array(opts.maxLen + 1).fill(0)
  for (const s of a.slots) byLen[s.len]++
  soft += Math.max(0, byLen[3] - opts.max3) * 1.5
  soft += Math.max(0, byLen[3] + byLen[4] - opts.maxShort) * 0.8
  let long = 0
  for (let l = 7; l <= opts.maxLen; l++) long += byLen[l]
  soft += Math.max(0, opts.minLong - long) * opts.longWeight
  soft += Math.max(0, long - opts.maxLong) * 1.0
  soft += Math.max(0, a.unchecked - opts.maxUnchecked * a.letters) * 0.7
  soft += Math.max(0, a.slots.length - clueCount - opts.maxDouble) * 0.8
  soft += Math.abs(clueCount - opts.clueTarget * W * H) * 0.25
  // Clue cells side by side read as a black blob; wide-open letter areas rarely fill.
  let touching = 0
  let open = 0
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      if (mask[i]) {
        if (c + 1 < W && mask[i + 1]) touching++
        if (r + 1 < H && mask[i + W]) touching++
      } else if (c + 2 < W && r + 2 < H) {
        let all = true
        for (let dr = 0; dr < 3 && all; dr++) for (let dc = 0; dc < 3; dc++) if (mask[i + dr * W + dc]) { all = false; break }
        if (all) open++
      }
    }
  }
  soft += touching * opts.touchPenalty + open * opts.openPenalty
  // Long words lying side by side cannot be filled from a modest dictionary:
  // every crossing would have to fit both of them at once.
  const across = new Int32Array(W * H).fill(-1)
  const down = new Int32Array(W * H).fill(-1)
  a.slots.forEach((s, si) => { for (const c of s.cells) (s.dir === 'right' ? across : down)[c] = si })
  const overlap = new Map()
  const bump = (x, y) => { const k = x * 1000 + y; overlap.set(k, (overlap.get(k) ?? 0) + 1) }
  for (let i = 0; i < W * H; i++) {
    if (across[i] !== -1 && i + W < W * H && across[i + W] !== -1) bump(across[i], across[i + W])
    if (down[i] !== -1 && i % W < W - 1 && down[i + 1] !== -1) bump(down[i], down[i + 1])
  }
  for (const [k, o] of overlap) {
    const longer = Math.max(a.slots[Math.floor(k / 1000)].len, a.slots[k % 1000].len)
    soft += Math.max(0, o - 2) * Math.max(0, longer - opts.stackFreeLen) * opts.stackPenalty
  }
  return { cost: a.hard * HARD + soft, hard: a.hard, soft, analysis: a }
}

export const DEFAULT_MASK_OPTS = {
  maxLen: 10,
  max3: 4,
  maxShort: 16,
  minLong: 6,
  maxLong: 9,
  maxUnchecked: 0.4,
  maxDouble: 8,
  clueTarget: 0.28,
  touchPenalty: 0.5,
  openPenalty: 0.6,
  stackFreeLen: 6,
  longWeight: 2.5,
  stackPenalty: 0.5,
}

export function generateMask(W, H, rnd, options = {}) {
  const opts = { ...DEFAULT_MASK_OPTS, ...options }
  const iterations = options.iterations ?? 160000
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = rnd() < 0.24 ? 1 : 0
  mask[0] = 1
  let cur = maskCost(mask, W, H, opts)
  let best = { cost: Infinity }
  for (let it = 0; it < iterations; it++) {
    const t = 2.5 * Math.pow(0.02, it / iterations)
    const i = Math.floor(rnd() * W * H)
    let j = -1
    if (rnd() < 0.5) {
      // move a clue cell to a neighbour instead of flipping
      const d = [1, -1, W, -W][Math.floor(rnd() * 4)]
      j = i + d
      if (j < 0 || j >= W * H || (Math.abs(d) === 1 && Math.floor(j / W) !== Math.floor(i / W)) || mask[i] === mask[j]) j = -1
    }
    mask[i] ^= 1
    if (j !== -1) mask[j] ^= 1
    const next = maskCost(mask, W, H, opts)
    if (next.cost <= cur.cost || rnd() < Math.exp((cur.cost - next.cost) / t)) {
      cur = next
      if (cur.cost < best.cost) best = { ...cur, mask: mask.slice() }
      if (cur.hard === 0 && cur.soft < 0.01) break
    } else {
      mask[i] ^= 1
      if (j !== -1) mask[j] ^= 1
    }
  }
  return best
}

export function renderMask(mask, W, H) {
  let out = ''
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) out += mask[r * W + c] ? '█' : '·'
    out += '\n'
  }
  return out
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
