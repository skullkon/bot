import { db, EndpointError } from 'sdk'
import { eq, and, gt, inArray, sql } from 'sdk/db'
import { puzzles, games, cells, players } from '../schema.js'
import { wordsAt, wordCells, isWordSolved } from './core.js'
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

export async function createGame(chatId) {
  const existing = await db.select().from(games)
    .where(and(eq(games.chatId, chatId), eq(games.status, 'active'))).get()
  if (existing) return { game: existing, created: false }
  const pick = await pickPuzzle(chatId)
  if (!pick) throw new Error('puzzle pool is empty')
  const [game] = await db.insert(games).values({ chatId, puzzleId: pick.id, startedAt: now() }).returning()
  return { game, created: true }
}

// Live puzzles form a chain (see tools/generator) in which words come back only after
// many puzzles, so a chat continues from the puzzle after its last one.
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
  // A new chat starts anywhere on the chain.
  return db.get(sql`SELECT id FROM puzzles WHERE retired = 0 ORDER BY random() LIMIT 1`)
}

export async function setMessageId(gameId, messageId) {
  await db.update(games).set({ messageId }).where(eq(games.id, gameId))
}

export async function loadCells(gameId) {
  return db.select().from(cells).where(eq(cells.gameId, gameId))
}

export function toClientCell(row) {
  return { idx: row.idx, letter: row.letter ?? null, userId: row.userId ?? null, rev: row.rev, locked: Boolean(row.locked) }
}

export async function changesSince(gameId, since) {
  const rows = await db.select().from(cells).where(and(eq(cells.gameId, gameId), gt(cells.rev, since)))
  return rows.map(toClientCell)
}

async function bumpRev(gameId) {
  const res = await db.run(sql`UPDATE games SET rev = rev + 1 WHERE id = ${gameId} RETURNING rev`)
  return res.rows[0].rev
}

// Writes one letter (or clears it with null), locks words that became correct and
// marks the game solved when every word is locked.
export async function applyMove({ game, puzzle, idx, letter, userId, revealed = false }) {
  const through = wordsAt(puzzle, idx)
  if (!through.length) throw new EndpointError('Not a letter cell', { code: 'BAD_CELL' })
  const current = await db.select().from(cells).where(and(eq(cells.gameId, game.id), eq(cells.idx, idx))).get()
  if (current?.locked) throw new EndpointError('Cell is locked', { code: 'LOCKED' })

  const rev = await bumpRev(game.id)
  await db.run(sql`INSERT INTO cells (game_id, idx, letter, user_id, rev, locked, revealed)
    VALUES (${game.id}, ${idx}, ${letter}, ${userId}, ${rev}, 0, ${revealed ? 1 : 0})
    ON CONFLICT (game_id, idx) DO UPDATE SET letter = excluded.letter, user_id = excluded.user_id,
      rev = excluded.rev, revealed = excluded.revealed
    WHERE cells.locked = 0`)

  const rows = await loadCells(game.id)
  const byIdx = new Map(rows.map((r) => [r.idx, r]))
  const letterAt = (i) => byIdx.get(i)?.letter ?? null
  const toLock = []
  for (const word of through) {
    const wc = wordCells(puzzle, word)
    if (wc.every((i) => byIdx.get(i)?.locked)) continue
    if (isWordSolved(puzzle, word, letterAt)) toLock.push(...wc)
  }
  if (toLock.length) {
    await db.update(cells).set({ locked: true, rev })
      .where(and(eq(cells.gameId, game.id), inArray(cells.idx, toLock)))
    for (const i of toLock) Object.assign(byIdx.get(i), { locked: true, rev })
  }

  let justSolved = false
  if (puzzle.words.every((w) => isWordSolved(puzzle, w, letterAt))) {
    const res = await db.run(sql`UPDATE games SET status = 'solved', solved_at = ${now()}
      WHERE id = ${game.id} AND status = 'active'`)
    justSolved = res.rowsAffected === 1
  }
  const changed = [...new Set([idx, ...toLock])]
  return { rev, changes: changed.map((i) => byIdx.get(i)).filter(Boolean).map(toClientCell), justSolved }
}

export async function touchPresence(gameId, userId, wordId, cellIdx) {
  await db.run(sql`INSERT INTO presence (game_id, user_id, word_id, cell_idx, seen_at)
    VALUES (${gameId}, ${userId}, ${wordId}, ${cellIdx}, ${now()})
    ON CONFLICT (game_id, user_id) DO UPDATE SET word_id = excluded.word_id,
      cell_idx = excluded.cell_idx, seen_at = excluded.seen_at`)
}

export async function activePresence(gameId, exceptUserId) {
  return db.all(sql`SELECT p.user_id AS userId, p.word_id AS wordId, p.cell_idx AS cellIdx,
      pl.name AS name, pl.photo_url AS photoUrl
    FROM presence p JOIN players pl ON pl.game_id = p.game_id AND pl.user_id = p.user_id
    WHERE p.game_id = ${gameId} AND p.seen_at > ${now() - PRESENCE_TTL_SEC} AND p.user_id != ${exceptUserId}`)
}

export async function listPlayers(gameId) {
  return db.select({ userId: players.userId, name: players.name, photoUrl: players.photoUrl })
    .from(players).where(eq(players.gameId, gameId))
}

export async function solvers(gameId) {
  return db.all(sql`SELECT DISTINCT pl.user_id AS userId, pl.name AS name
    FROM cells c JOIN players pl ON pl.game_id = c.game_id AND pl.user_id = c.user_id
    WHERE c.game_id = ${gameId} AND c.letter IS NOT NULL`)
}
