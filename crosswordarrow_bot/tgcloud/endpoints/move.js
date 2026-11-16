import { EndpointError } from 'sdk'
import { requirePlayer } from '../lib/access.js'
import { loadPuzzle, applyMove } from '../lib/games.js'
import { announceSolved } from '../lib/announce.js'
import { normalizeLetter } from '../lib/core.js'

export default async function (input, ctx) {
  const { user, game } = await requirePlayer(ctx, input.gameId)
  if (game.status !== 'active') throw new EndpointError('Game is over', { code: 'GAME_SOLVED' })
  if (!Number.isInteger(input.idx)) throw new EndpointError('Bad cell', { code: 'BAD_CELL' })
  const empty = input.letter === null || input.letter === undefined || input.letter === ''
  const letter = empty ? null : normalizeLetter(input.letter)
  if (!empty && !letter) throw new EndpointError('Bad letter', { code: 'BAD_LETTER' })

  const puzzle = await loadPuzzle(game.puzzleId)
  const result = await applyMove({ game, puzzle, idx: input.idx, letter, userId: user.id })
  if (result.justSolved) await announceSolved(game.id)
  return { rev: result.rev, changes: result.changes, solved: result.justSolved }
}
