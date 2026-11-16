// The whole game for a Mini App that has just been opened.
import { EndpointError } from 'sdk'
import { requirePlayer, displayName } from '../lib/access.js'
import { loadPuzzle, loadCells, toClientCell, listPlayers, activePresence, activeGame, gameNumber, refreshPlayer } from '../lib/games.js'
import { publicPuzzle, parseStartParam } from '../lib/core.js'

export default async function (input, ctx) {
  const gameId = Number.isInteger(input.gameId) ? input.gameId : parseStartParam(ctx.initData?.start_param)
  if (!gameId) throw new EndpointError('No game selected', { code: 'NO_GAME' })
  const { user, game, joined } = await requirePlayer(ctx, gameId)
  if (!joined) await refreshPlayer(game.id, user.id, displayName(user), user.photo_url ?? null)
  if (game.status === 'abandoned') throw new EndpointError('Game was closed', { code: 'GAME_CLOSED' })
  const puzzle = await loadPuzzle(game.puzzleId)
  const cells = (await loadCells(game.id)).map(toClientCell)
  // An old link may point at a finished game while the chat already plays the next one.
  const current = game.status === 'solved' ? await activeGame(game.chatId) : null
  return {
    me: user.id,
    game: {
      id: game.id,
      number: await gameNumber(game),
      status: game.status,
      startedAt: game.startedAt,
      solvedAt: game.solvedAt ?? null,
      solo: game.chatId > 0,
      nextGameId: current?.id ?? null,
    },
    puzzle: publicPuzzle(puzzle),
    cells,
    rev: cells.reduce((m, c) => Math.max(m, c.rev), 0),
    players: await listPlayers(game.id),
    presence: await activePresence(game.id, user.id),
  }
}
