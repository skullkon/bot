import { EndpointError } from 'sdk'
import { requirePlayer } from '../lib/access.js'
import { loadPuzzle, loadCells, applyMove } from '../lib/games.js'
import { announceSolved } from '../lib/announce.js'
import { nextRevealCell } from '../lib/core.js'

export default async function (input, ctx) {
  const { user, game } = await requirePlayer(ctx, input.gameId)
  if (game.status !== 'active') throw new EndpointError('Game is over', { code: 'GAME_SOLVED' })
  const puzzle = await loadPuzzle(game.puzzleId)
  const word = Number.isInteger(input.wordId) ? puzzle.words[input.wordId] : null
  if (!word) throw new EndpointError('Bad word', { code: 'BAD_WORD' })

  const byIdx = new Map((await loadCells(game.id)).map((r) => [r.idx, r]))
  const target = nextRevealCell(puzzle, word, (i) => byIdx.get(i)?.letter ?? null)
  if (!target) return { rev: game.rev, changes: [], solved: false }
  const result = await applyMove({ game, puzzle, idx: target.idx, letter: target.letter, userId: user.id, revealed: true })
  if (result.justSolved) await announceSolved(game.id)
  return { rev: result.rev, changes: result.changes, solved: result.justSolved }
}
