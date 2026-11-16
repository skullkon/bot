import { EndpointError } from 'sdk'
import { requirePlayer } from '../lib/access.js'
import { loadPuzzle, loadCells, toClientCell, listPlayers, activePresence, solvers } from '../lib/games.js'
import { publicPuzzle, parseStartParam } from '../lib/core.js'

export default async function (input, ctx) {
  const gameId = Number.isInteger(input.gameId) ? input.gameId : parseStartParam(ctx.initData?.start_param)
  if (!gameId) throw new EndpointError('No game selected', { code: 'NO_GAME' })
  const { user, game } = await requirePlayer(ctx, gameId)
  const puzzle = await loadPuzzle(game.puzzleId)
  const cellRows = await loadCells(game.id)
  return {
    me: user.id,
    game: { id: game.id, status: game.status, rev: game.rev, startedAt: game.startedAt, solvedAt: game.solvedAt ?? null },
    puzzle: publicPuzzle(puzzle),
    cells: cellRows.map(toClientCell),
    players: await listPlayers(game.id),
    presence: await activePresence(game.id, user.id),
    solvers: game.status === 'solved' ? await solvers(game.id) : [],
  }
}
