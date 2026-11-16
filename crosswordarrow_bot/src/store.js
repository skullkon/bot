// Game state of the Mini App: the server's cells, the letters typed here and not yet
// confirmed, the selection, and the sync loop that keeps everyone's grid the same.
import { wordCells, buildCellIndex, arrowKind } from '../tgcloud/lib/core.js'

const SYNC_BUSY_MS = 1000 // someone else is in the game
const SYNC_ALONE_MS = 2500
const SYNC_TYPING_MS = 70 // lets a burst of letters travel in one call
const RETRY_MS = 2000
const MAX_MOVES = 40

const LIGHT = ['#1c6fe8', '#d9480f', '#0b8a43', '#c2255c', '#6741d9', '#0b7285', '#946c00', '#a61e4d']
const DARK = ['#6ea8ff', '#ff922b', '#51cf66', '#ff6b9d', '#b197fc', '#3bc9db', '#fcc419', '#f783ac']
let palette = LIGHT

export function setDarkPalette(dark) {
  palette = dark ? DARK : LIGHT
}

export function createStore(api, haptic = () => {}) {
  const listeners = new Set()
  const s = {
    phase: 'loading', // loading | game | error
    error: null,
    me: null,
    game: null,
    puzzle: null,
    words: [],
    cellWords: new Map(),
    clueAt: new Map(),
    server: new Map(),
    pending: new Map(),
    rev: 0,
    players: [],
    playersKey: '',
    presence: [],
    sel: { wordId: null, idx: null },
    flash: new Map(), // idx -> timestamp of the lock animation
    shake: { wordId: null, at: 0 },
    offline: false,
    starting: false,
    version: 0,
  }
  let queue = []
  let seq = 0
  let inFlight = false
  let timer = null
  let stopped = false

  const emit = () => {
    s.version++
    for (const l of listeners) l()
  }

  // ---- reading -----------------------------------------------------------

  const letterAt = (idx) => {
    const p = s.pending.get(idx)
    if (p) return p.reveal ? '' : p.letter
    return s.server.get(idx)?.letter ?? null
  }
  const isLocked = (idx) => Boolean(s.server.get(idx)?.locked)
  const isWordSolved = (word) => word.cells.every(isLocked)
  const solvedCount = () => s.words.reduce((n, w) => n + (isWordSolved(w) ? 1 : 0), 0)
  const colorOf = (userId) => {
    const i = s.players.findIndex((p) => p.userId === userId)
    return palette[(i < 0 ? 0 : i) % palette.length]
  }

  // Per-player result, the same way the bot counts it for the chat message.
  const scoreboard = () => {
    const stats = new Map(s.players.map((p) => [p.userId, { ...p, words: 0, letters: 0, hints: 0 }]))
    const of = (id) => {
      if (!stats.has(id)) stats.set(id, { userId: id, name: 'Игрок', words: 0, letters: 0, hints: 0 })
      return stats.get(id)
    }
    for (const c of s.server.values()) {
      if (!c.letter || c.userId == null) continue
      if (c.revealed) of(c.userId).hints++
      else of(c.userId).letters++
    }
    for (const w of s.words) {
      if (!isWordSolved(w)) continue
      const last = w.cells.map((i) => s.server.get(i)).reduce((a, b) => (b.rev > a.rev ? b : a))
      const by = last.lockedBy ?? last.userId
      if (by != null) of(by).words++
    }
    return [...stats.values()].sort((a, b) => b.words - a.words || b.letters - a.letters)
  }

  // ---- loading -----------------------------------------------------------

  async function load(gameId) {
    stopped = false
    clearTimeout(timer)
    queue = []
    s.pending = new Map()
    s.phase = 'loading'
    emit()
    try {
      const data = await api.call('getGame', gameId ? { gameId } : {})
      s.me = data.me
      s.game = data.game
      s.puzzle = data.puzzle
      s.words = data.puzzle.words.map((w) => ({ ...w, cells: wordCells(data.puzzle, w) }))
      s.cellWords = buildCellIndex(data.puzzle)
      s.clueAt = new Map(data.puzzle.clues.map((c) => [c.idx, c]))
      for (const clue of data.puzzle.clues) {
        for (const slot of clue.slots) {
          const w = s.words[slot.wordId]
          w.clueIdx = clue.idx
          w.arrow = arrowKind(data.puzzle.width, clue.idx, w)
        }
      }
      s.server = new Map(data.cells.map((c) => [c.idx, c]))
      s.rev = data.rev
      s.players = data.players
      s.playersKey = ''
      s.presence = data.presence
      s.flash = new Map()
      s.phase = 'game'
      s.offline = false
      const first = s.words.find((w) => !isWordSolved(w)) ?? s.words[0]
      s.sel = { wordId: first.id, idx: firstOpenCell(first) }
      emit()
      schedule(SYNC_BUSY_MS)
    } catch (e) {
      s.phase = 'error'
      s.error = { code: e.parameters?.code ?? e.type ?? 'UNKNOWN', message: e.message }
      emit()
    }
  }

  // ---- sync loop ---------------------------------------------------------

  function schedule(ms) {
    clearTimeout(timer)
    if (stopped || s.phase !== 'game') return
    timer = setTimeout(sync, ms)
  }

  async function sync() {
    if (inFlight || stopped || s.phase !== 'game') return
    if (typeof document !== 'undefined' && document.hidden && !queue.length) return
    inFlight = true
    const moves = queue.splice(0, MAX_MOVES)
    const gameId = s.game.id
    try {
      const res = await api.call('sync', {
        gameId,
        since: s.rev,
        moves: moves.map(({ idx, letter, reveal }) => (reveal ? { idx, reveal: true } : { idx, letter })),
        wordId: s.sel.wordId,
        cellIdx: s.sel.idx,
        playersKey: s.playersKey,
      })
      if (gameId !== s.game?.id) return
      applySync(res, moves)
      s.offline = false
    } catch (e) {
      if (gameId !== s.game?.id) return
      queue = [...moves, ...queue]
      s.offline = true
      emit()
      inFlight = false
      schedule(RETRY_MS)
      return
    }
    inFlight = false
    if (queue.length) schedule(0)
    else if (s.game.status === 'solved') schedule(SYNC_ALONE_MS * 4)
    else schedule(s.presence.length ? SYNC_BUSY_MS : SYNC_ALONE_MS)
  }

  function applySync(res, sent) {
    const now = Date.now()
    const before = new Set(s.words.filter(isWordSolved).map((w) => w.id))
    for (const c of res.changes) {
      const prev = s.server.get(c.idx)
      if (prev && prev.rev >= c.rev) continue
      s.server.set(c.idx, c)
      if (c.locked && !prev?.locked) s.flash.set(c.idx, now)
      // A cell that got locked under our fingers wins over whatever we typed there.
      if (c.locked) s.pending.delete(c.idx)
    }
    for (const m of sent) {
      if (s.pending.get(m.idx)?.seq === m.seq) s.pending.delete(m.idx)
    }
    s.rev = Math.max(s.rev, res.rev)
    s.presence = res.presence
    if (res.players) s.players = res.players
    s.playersKey = res.playersKey
    const wasActive = s.game.status === 'active'
    s.game = { ...s.game, status: res.status }
    if (wasActive && res.status === 'solved') s.game.solvedAt = Math.floor(now / 1000)

    const newlySolved = s.words.filter((w) => !before.has(w.id) && isWordSolved(w))
    if (newlySolved.length) haptic(res.lockedWords?.length ? 'success' : 'light')

    const current = s.words[s.sel.wordId]
    if (current && isWordSolved(current) && res.status === 'active') {
      const next = nextOpenWord(current.id, 1)
      if (next) s.sel = { wordId: next.id, idx: firstOpenCell(next) }
    } else if (current && sent.length && !isWordSolved(current)) {
      // The word is full, nothing is on its way, and it did not lock: it is wrong.
      const full = current.cells.every((i) => letterAt(i))
      const settled = current.cells.every((i) => !s.pending.has(i))
      const touched = sent.some((m) => current.cells.includes(m.idx))
      if (full && settled && touched) {
        s.shake = { wordId: current.id, at: now }
        haptic('error')
      }
    }
    emit()
  }

  // ---- selection ---------------------------------------------------------

  function firstOpenCell(word) {
    return word.cells.find((i) => !isLocked(i) && !letterAt(i)) ?? word.cells.find((i) => !isLocked(i)) ?? word.cells[0]
  }

  function nextOpenWord(fromId, step) {
    const n = s.words.length
    for (let k = 1; k <= n; k++) {
      const w = s.words[(((fromId + step * k) % n) + n) % n]
      if (!isWordSolved(w)) return w
    }
    return null
  }

  function selectCell(idx) {
    const clue = s.clueAt.get(idx)
    if (clue) {
      // Tapping a clue picks its word; tapping a split clue again picks the other one.
      const ids = clue.slots.map((x) => x.wordId)
      const at = ids.indexOf(s.sel.wordId)
      const word = s.words[ids[(at + 1) % ids.length]]
      s.sel = { wordId: word.id, idx: firstOpenCell(word) }
      return emit()
    }
    const ids = s.cellWords.get(idx)
    if (!ids) return
    let wordId
    if (s.sel.idx === idx && ids.length > 1) wordId = ids[(ids.indexOf(s.sel.wordId) + 1) % ids.length]
    else if (ids.includes(s.sel.wordId)) wordId = s.sel.wordId
    else wordId = ids.find((id) => !isWordSolved(s.words[id])) ?? ids[0]
    s.sel = { wordId, idx }
    emit()
  }

  function stepWord(step) {
    const w = nextOpenWord(s.sel.wordId ?? 0, step) ?? s.words[(((s.sel.wordId ?? 0) + step) % s.words.length + s.words.length) % s.words.length]
    s.sel = { wordId: w.id, idx: firstOpenCell(w) }
    emit()
  }

  function moveCursor(dx, dy) {
    const W = s.puzzle.width
    const H = s.puzzle.height
    let c = (s.sel.idx % W) + dx
    let r = Math.floor(s.sel.idx / W) + dy
    while (c >= 0 && c < W && r >= 0 && r < H) {
      const idx = r * W + c
      const ids = s.cellWords.get(idx)
      if (ids) {
        const dir = dx ? 'right' : 'down'
        const wordId = ids.find((id) => s.words[id].dir === dir) ?? (ids.includes(s.sel.wordId) ? s.sel.wordId : ids[0])
        s.sel = { wordId, idx }
        return emit()
      }
      c += dx
      r += dy
    }
  }

  // ---- input -------------------------------------------------------------

  function push(move) {
    move.seq = ++seq
    s.pending.set(move.idx, move)
    const same = queue.findIndex((m) => m.idx === move.idx)
    if (same !== -1) queue.splice(same, 1)
    queue.push(move)
    emit()
    if (!inFlight) schedule(SYNC_TYPING_MS)
  }

  function type(letter) {
    if (s.phase !== 'game' || s.game.status !== 'active') return
    const word = s.words[s.sel.wordId]
    if (!word) return
    let at = word.cells.indexOf(s.sel.idx)
    if (at === -1) return
    while (at < word.cells.length && isLocked(word.cells[at])) at++
    if (at >= word.cells.length) return
    const idx = word.cells[at]
    push({ idx, letter })
    let next = at + 1
    while (next < word.cells.length && isLocked(word.cells[next])) next++
    s.sel = { wordId: word.id, idx: next < word.cells.length ? word.cells[next] : idx }
    emit()
  }

  function backspace() {
    if (s.phase !== 'game' || s.game.status !== 'active') return
    const word = s.words[s.sel.wordId]
    if (!word) return
    let at = word.cells.indexOf(s.sel.idx)
    if (at === -1) return
    if (isLocked(word.cells[at]) || !letterAt(word.cells[at])) {
      let prev = at - 1
      while (prev >= 0 && isLocked(word.cells[prev])) prev--
      if (prev < 0) return
      at = prev
    }
    const idx = word.cells[at]
    if (letterAt(idx)) push({ idx, letter: null })
    s.sel = { wordId: word.id, idx }
    emit()
  }

  function hint() {
    if (s.phase !== 'game' || s.game.status !== 'active') return
    const idx = s.sel.idx
    if (idx == null || isLocked(idx) || s.pending.get(idx)?.reveal) return
    push({ idx, reveal: true, letter: null })
  }

  async function startNext() {
    if (s.starting) return
    if (s.game.nextGameId) return load(s.game.nextGameId)
    s.starting = true
    emit()
    try {
      const res = await api.call('newGame', { gameId: s.game.id })
      s.starting = false
      await load(res.gameId)
    } catch (e) {
      s.starting = false
      s.offline = true
      emit()
    }
  }

  function wake() {
    if (s.phase === 'game' && !inFlight) schedule(0)
  }

  return {
    state: s,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    load, selectCell, stepWord, moveCursor, type, backspace, hint, startNext, wake,
    stop: () => { stopped = true; clearTimeout(timer) },
    letterAt, isLocked, isWordSolved, solvedCount, colorOf, scoreboard,
  }
}
