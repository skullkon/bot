// A stand-in server for `npm run dev`: one puzzle from data/puzzles, kept in memory,
// with a second player who solves a word now and then. Never part of the build.
import { wordCells, buildCellIndex, publicPuzzle } from '../tgcloud/lib/core.js'

const files = import.meta.glob('../data/puzzles/*.json', { eager: true, import: 'default' })

export function createDemoApi() {
  const params = new URLSearchParams(location.search)
  const pool = Object.values(files).flat()
  let number = Number(params.get('n') ?? 0)
  let game

  const start = () => {
    const puzzle = pool[number % pool.length]
    game = { id: 1000 + number, puzzle, cells: new Map(), rev: 0, status: 'active', startedAt: Math.floor(Date.now() / 1000) - 780, cellWords: buildCellIndex(puzzle), presence: [] }
    // ?solved=N opens the puzzle with N words already in place, shared between the players
    const pre = Number(params.get('solved') ?? 0)
    for (let i = 0; i < pre && i < puzzle.words.length; i++) solveWord((i * 7) % puzzle.words.length, [1, 2, 2, 3][i % 4])
    if (params.get('wrong')) write(wordCells(puzzle, puzzle.words[1])[0], 'Ъ', 2)
  }
  const players = [
    { userId: 1, name: 'Костя', photoUrl: null },
    { userId: 2, name: 'Аня Соколова', photoUrl: null },
    { userId: 3, name: 'Миша', photoUrl: null },
  ]

  function write(idx, letter, userId, revealed = false) {
    const cur = game.cells.get(idx)
    if (cur?.locked) return
    game.cells.set(idx, { idx, letter, userId, rev: ++game.rev, locked: false, revealed, lockedBy: null })
    for (const id of game.cellWords.get(idx) ?? []) {
      const w = game.puzzle.words[id]
      const wc = wordCells(game.puzzle, w)
      if (!wc.every((i, k) => game.cells.get(i)?.letter === w.answer[k])) continue
      const rev = ++game.rev
      for (const i of wc) { const c = game.cells.get(i); if (!c.locked) Object.assign(c, { locked: true, lockedBy: userId, rev }) }
    }
    if ([...game.cellWords.keys()].every((i) => game.cells.get(i)?.locked)) game.status = 'solved'
  }
  function solveWord(id, userId) {
    const w = game.puzzle.words[id]
    wordCells(game.puzzle, w).forEach((i, k) => write(i, w.answer[k], userId))
  }
  start()

  // The other player: picks an open word, moves the cursor there, types it letter by letter.
  if (!params.get('still')) {
    let job = null
    setInterval(() => {
      if (game.status !== 'active') return
      if (!job) {
        const open = game.puzzle.words.filter((w) => !wordCells(game.puzzle, w).every((i) => game.cells.get(i)?.locked))
        if (!open.length) return
        const w = open[Math.floor(Math.random() * open.length)]
        job = { w, k: 0, wait: 4 }
      }
      const wc = wordCells(game.puzzle, job.w)
      game.presence = [{ userId: 2, wordId: job.w.id, cellIdx: wc[Math.min(job.k, wc.length - 1)] }]
      if (job.wait-- > 0) return
      if (job.k < wc.length) { write(wc[job.k], job.w.answer[job.k], 2); job.k++ } else job = null
    }, 700)
  } else {
    const w = game.puzzle.words[5]
    game.presence = [{ userId: 2, wordId: w.id, cellIdx: wordCells(game.puzzle, w)[1] }]
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  return async (name, input) => {
    await delay(120)
    if (name === 'getGame') {
      return {
        me: 1,
        game: { id: game.id, number: number + 12, status: game.status, startedAt: game.startedAt, solvedAt: null, solo: false, nextGameId: null },
        puzzle: publicPuzzle(game.puzzle), cells: [...game.cells.values()].map((c) => ({ ...c })), rev: game.rev, players, presence: game.presence,
      }
    }
    if (name === 'sync') {
      const before = new Set(game.puzzle.words.filter((w) => wordCells(game.puzzle, w).every((i) => game.cells.get(i)?.locked)).map((w) => w.id))
      for (const m of input.moves ?? []) {
        if (m.reveal) { const w = game.puzzle.words[game.cellWords.get(m.idx)[0]]; write(m.idx, w.answer[wordCells(game.puzzle, w).indexOf(m.idx)], 1, true) } else write(m.idx, m.letter, 1)
      }
      const lockedWords = game.puzzle.words.filter((w) => !before.has(w.id) && wordCells(game.puzzle, w).every((i) => game.cells.get(i)?.locked)).map((w) => w.id)
      return { rev: game.rev, status: game.status, changes: [...game.cells.values()].filter((c) => c.rev > input.since).map((c) => ({ ...c })), lockedWords, presence: game.presence, players: input.playersKey ? null : players, playersKey: 'k' }
    }
    if (name === 'newGame') { number++; start(); return { gameId: game.id } }
    throw new Error('unknown endpoint ' + name)
  }
}
