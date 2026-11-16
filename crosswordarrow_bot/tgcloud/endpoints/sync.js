// The heartbeat of a game: sends what the player typed since the last call, reports
// their cursor, and brings back everything the others changed meanwhile.
import { requirePlayer } from '../lib/access.js'
import { loadPuzzle, applyMoves, changesSince, touchPresence, activePresence, listPlayers } from '../lib/games.js'
import { announceSolved } from '../lib/announce.js'
import { normalizeLetter } from '../lib/core.js'
import { MAX_MOVES_PER_SYNC } from '../lib/config.js'

const intOrNull = (v) => (Number.isInteger(v) ? v : null)

function parseMoves(raw) {
  if (!Array.isArray(raw)) return []
  const moves = []
  for (const m of raw.slice(0, MAX_MOVES_PER_SYNC)) {
    if (!m || !Number.isInteger(m.idx)) continue
    if (m.reveal === true) { moves.push({ idx: m.idx, reveal: true }); continue }
    const empty = m.letter === null || m.letter === undefined || m.letter === ''
    const letter = empty ? null : normalizeLetter(m.letter)
    if (!empty && !letter) continue
    moves.push({ idx: m.idx, letter })
  }
  return moves
}

export default async function (input, ctx) {
  const { user, game } = await requirePlayer(ctx, input.gameId)
  const since = Number.isInteger(input.since) && input.since > 0 ? input.since : 0
  let status = game.status
  let lockedWords = []

  const moves = status === 'active' ? parseMoves(input.moves) : []
  if (moves.length) {
    const puzzle = await loadPuzzle(game.puzzleId)
    const result = await applyMoves({ game, puzzle, moves, userId: user.id })
    lockedWords = result.lockedWords
    if (result.justSolved) {
      status = 'solved'
      await announceSolved(game.id)
    }
  }
  await touchPresence(game.id, user.id, intOrNull(input.wordId), intOrNull(input.cellIdx))

  const changes = await changesSince(game.id, since)
  const players = await listPlayers(game.id)
  return {
    rev: changes.reduce((m, c) => Math.max(m, c.rev), since),
    status,
    changes,
    lockedWords,
    presence: await activePresence(game.id, user.id),
    // The list is sent only when someone joined or changed since the client's copy.
    players: input.playersKey === playersKey(players) ? null : players,
    playersKey: playersKey(players),
  }
}

function playersKey(players) {
  return players.map((p) => `${p.userId}:${p.name}:${p.photoUrl ?? ''}`).join('|').length + ':' + players.length
}
