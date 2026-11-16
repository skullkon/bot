import { EndpointError } from 'sdk'
import { requirePlayer } from '../lib/access.js'
import { startGameInChat } from '../lib/announce.js'

export default async function (input, ctx) {
  const { game } = await requirePlayer(ctx, input.gameId)
  if (game.status !== 'solved') throw new EndpointError('Current game is not solved yet', { code: 'GAME_ACTIVE' })
  const { game: next } = await startGameInChat(game.chatId, { announceExisting: false })
  return { gameId: next.id }
}
