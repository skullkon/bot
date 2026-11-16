import { requirePlayer } from '../lib/access.js'
import { changesSince, touchPresence, activePresence } from '../lib/games.js'

const intOrNull = (v) => (Number.isInteger(v) ? v : null)

export default async function (input, ctx) {
  const { user, game } = await requirePlayer(ctx, input.gameId)
  const since = Number.isInteger(input.since) && input.since > 0 ? input.since : 0
  await touchPresence(game.id, user.id, intOrNull(input.wordId), intOrNull(input.cellIdx))
  return {
    rev: game.rev,
    status: game.status,
    changes: await changesSince(game.id, since),
    presence: await activePresence(game.id, user.id),
  }
}
