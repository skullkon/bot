import { db } from 'sdk'
import { eq, and, gt, sql } from 'sdk/db'
import { puzzles, games, cells, players } from '../schema.js'
import { buildCellIndex, wordCells } from './core.js'
import { PRESENCE_TTL_SEC } from './config.js'

const now = () => Math.floor(Date.now() / 1000)

export async function loadGame(gameId) {
  if (!Number.isInteger(gameId)) return null
  return db.select().from(games).where(eq(games.id, gameId)).get()
}

export async function loadPuzzle(puzzleId) {
  const row = await db.select().from(puzzles).where(eq(puzzles.id, puzzleId)).get()
  return row ? row.data : null
}

export async function activeGame(chatId) {
  return db.select().from(games).where(and(eq(games.chatId, chatId), eq(games.status, 'active'))).get()
}

// The game's ordinal within its chat: "Сканворд №3" reads better than a global id.
export async function gameNumber(game) {
  const row = await db.get(sql`SELECT count(*) AS n FROM games WHERE chat_id = ${game.chatId} AND id <= ${game.id}`)
  return row.n
}

export async function createGame(chatId) {
  const existing = await activeGame(chatId)
  if (existing) return { game: existing, created: false }
  const pick = await pickPuzzle(chatId)
  if (!pick) throw new Error('puzzle pool is empty')
  const [game] = await db.insert(games).values({ chatId, puzzleId: pick.id, startedAt: now() }).returning()
  return { game, created: true }
}

// Live puzzles form a chain (see tools/generator) in which a word comes back only
// after many puzzles, so a chat continues from the puzzle after its last one.
async function pickPuzzle(chatId) {
  const unplayed = sql`retired = 0 AND id NOT IN (SELECT puzzle_id FROM games WHERE chat_id = ${chatId})`
  const last = await db.get(sql`SELECT g.puzzle_id AS id FROM games g JOIN puzzles p ON p.id = g.puzzle_id
    WHERE g.chat_id = ${chatId} AND p.retired = 0 ORDER BY g.id DESC LIMIT 1`)
  if (last) {
    const next =
      (await db.get(sql`SELECT id FROM puzzles WHERE ${unplayed} AND id > ${last.id} ORDER BY id LIMIT 1`)) ??
      (await db.get(sql`SELECT id FROM puzzles WHERE ${unplayed} ORDER BY id LIMIT 1`))
    if (next) return next
  }
  // A new chat (or one that has played everything) starts anywhere on the chain.
  return db.get(sql`SELECT id FROM puzzles WHERE retired = 0 ORDER BY random() LIMIT 1`)
}

export async function setMessageId(gameId, messageId) {
  await db.update(games).set({ messageId }).where(eq(games.id, gameId))
}

export function toClientCell(row) {
  return {
    idx: row.idx,
    letter: row.letter ?? null,
    userId: row.userId ?? null,
    rev: row.rev,
    locked: Boolean(row.locked),
    revealed: Boolean(row.revealed),
    lockedBy: row.lockedBy ?? null,
  }
}

export async function loadCells(gameId) {
  return db.select().from(cells).where(eq(cells.gameId, gameId))
}

export async function changesSince(gameId, since) {
  const rows = await db.select().from(cells).where(and(eq(cells.gameId, gameId), gt(cells.rev, since)))
  return rows.map(toClientCell)
}

const nextRev = (gameId) => sql`(SELECT coalesce(max(rev), 0) + 1 FROM cells WHERE game_id = ${gameId})`

// Writes letters (null clears a cell), then locks every word that became correct.
// Each statement stamps its own revision, and the lock re-checks the letters inside
// the statement, so simultaneous moves by several players cannot lock a wrong word.
// Returns the ids of the words locked by this call and whether the game got solved.
export async function applyMoves({ game, puzzle, moves, userId }) {
  const cellWords = buildCellIndex(puzzle)
  const touched = new Set()
  for (const move of moves) {
    if (!cellWords.has(move.idx)) continue
    const letter = move.reveal ? answerAt(puzzle, cellWords, move.idx) : move.letter
    const res = await db.run(sql`INSERT INTO cells (game_id, idx, letter, user_id, rev, locked, revealed)
      VALUES (${game.id}, ${move.idx}, ${letter}, ${userId}, ${nextRev(game.id)}, 0, ${move.reveal ? 1 : 0})
      ON CONFLICT (game_id, idx) DO UPDATE SET letter = excluded.letter, user_id = excluded.user_id,
        rev = excluded.rev, revealed = excluded.revealed
      WHERE cells.locked = 0`)
    if (res.rowsAffected) for (const wordId of cellWords.get(move.idx)) touched.add(wordId)
  }
  if (!touched.size) return { lockedWords: [], justSolved: false }

  const rows = await loadCells(game.id)
  const byIdx = new Map(rows.map((r) => [r.idx, r]))
  const lockedWords = []
  for (const wordId of touched) {
    const word = puzzle.words[wordId]
    const wc = wordCells(puzzle, word)
    if (!wc.every((idx, k) => byIdx.get(idx)?.letter === word.answer[k])) continue
    if (wc.every((idx) => byIdx.get(idx).locked)) continue
    const match = sql.raw('0')
    let cond = match
    wc.forEach((idx, k) => { cond = sql`${cond} OR (idx = ${idx} AND letter = ${word.answer[k]})` })
    const res = await db.run(sql`UPDATE cells SET locked = 1, locked_by = ${userId}, rev = ${nextRev(game.id)}
      WHERE game_id = ${game.id} AND locked = 0 AND idx IN (${sql.raw(wc.join(','))})
        AND (SELECT count(*) FROM cells c WHERE c.game_id = ${game.id} AND (${cond})) = ${wc.length}`)
    if (res.rowsAffected) lockedWords.push(wordId)
  }
  if (!lockedWords.length) return { lockedWords, justSolved: false }

  const lockedCount = (await db.get(sql`SELECT count(*) AS n FROM cells WHERE game_id = ${game.id} AND locked = 1`)).n
  let justSolved = false
  if (lockedCount >= cellWords.size) {
    const res = await db.run(sql`UPDATE games SET status = 'solved', solved_at = ${now()}
      WHERE id = ${game.id} AND status = 'active'`)
    justSolved = res.rowsAffected === 1
  }
  return { lockedWords, justSolved }
}

function answerAt(puzzle, cellWords, idx) {
  const word = puzzle.words[cellWords.get(idx)[0]]
  return word.answer[wordCells(puzzle, word).indexOf(idx)]
}

export async function touchPresence(gameId, userId, wordId, cellIdx) {
  await db.run(sql`INSERT INTO presence (game_id, user_id, word_id, cell_idx, seen_at)
    VALUES (${gameId}, ${userId}, ${wordId}, ${cellIdx}, ${now()})
    ON CONFLICT (game_id, user_id) DO UPDATE SET word_id = excluded.word_id,
      cell_idx = excluded.cell_idx, seen_at = excluded.seen_at`)
}

export async function activePresence(gameId, exceptUserId) {
  return db.all(sql`SELECT user_id AS userId, word_id AS wordId, cell_idx AS cellIdx FROM presence
    WHERE game_id = ${gameId} AND seen_at > ${now() - PRESENCE_TTL_SEC} AND user_id != ${exceptUserId}`)
}

// In joining order: the Mini App gives players their colours by position in this list.
export async function listPlayers(gameId) {
  return db.all(sql`SELECT user_id AS userId, name, photo_url AS photoUrl FROM players
    WHERE game_id = ${gameId} ORDER BY joined_at, user_id`)
}

export async function refreshPlayer(gameId, userId, name, photoUrl) {
  await db.update(players).set({ name, photoUrl })
    .where(and(eq(players.gameId, gameId), eq(players.userId, userId)))
}

// Per-player result of a game: words completed, letters that stayed, hints taken.
export async function scoreboard(game, puzzle) {
  const rows = await loadCells(game.id)
  const byIdx = new Map(rows.map((r) => [r.idx, r]))
  const stats = new Map()
  const of = (userId) => {
    if (!stats.has(userId)) stats.set(userId, { userId, words: 0, letters: 0, hints: 0 })
    return stats.get(userId)
  }
  for (const r of rows) {
    if (!r.letter || r.userId == null) continue
    if (r.revealed) of(r.userId).hints++
    else of(r.userId).letters++
  }
  for (const word of puzzle.words) {
    // The word belongs to whoever locked its last cell.
    let last = null
    let complete = true
    for (const idx of wordCells(puzzle, word)) {
      const r = byIdx.get(idx)
      if (!r?.locked) { complete = false; break }
      if (!last || r.rev > last.rev) last = r
    }
    if (complete && (last.lockedBy ?? last.userId) != null) of(last.lockedBy ?? last.userId).words++
  }
  const names = new Map((await listPlayers(game.id)).map((p) => [p.userId, p.name]))
  return [...stats.values()]
    .map((s) => ({ ...s, name: names.get(s.userId) ?? 'Игрок' }))
    .sort((a, b) => b.words - a.words || b.letters - a.letters)
}
