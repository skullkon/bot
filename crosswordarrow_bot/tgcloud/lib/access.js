import { db, api, BotApiError, EndpointError } from 'sdk'
import { sql } from 'sdk/db'
import { loadGame } from './games.js'

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member'])

export function displayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'Игрок'
}

// Resolves the caller and the game. The first call for a game checks that the
// caller belongs to the chat and adds them to the players.
export async function requirePlayer(ctx, gameId) {
  const user = ctx.initData?.user
  if (!user?.id) throw new EndpointError('Open the game from Telegram', { code: 'NO_USER' })
  const game = await loadGame(gameId)
  if (!game) throw new EndpointError('Game not found', { code: 'GAME_NOT_FOUND' })

  const known = await db.get(sql`SELECT 1 AS ok FROM players WHERE game_id = ${game.id} AND user_id = ${user.id}`)
  if (!known) {
    await assertMember(game.chatId, user.id)
    await db.run(sql`INSERT OR IGNORE INTO players (game_id, user_id, name, photo_url, joined_at)
      VALUES (${game.id}, ${user.id}, ${displayName(user)}, ${user.photo_url ?? null}, ${Math.floor(Date.now() / 1000)})`)
  }
  return { user, game, joined: !known }
}

async function assertMember(chatId, userId) {
  // A private chat with the bot is a solo game.
  if (chatId > 0) {
    if (chatId !== userId) throw new EndpointError('Not your game', { code: 'NOT_A_MEMBER' })
    return
  }
  let member
  try {
    member = await api.getChatMember({ chat_id: chatId, user_id: userId })
  } catch (e) {
    if (e instanceof BotApiError) throw new EndpointError('Not a member of this chat', { code: 'NOT_A_MEMBER' })
    throw e
  }
  const ok = MEMBER_STATUSES.has(member.status) || (member.status === 'restricted' && member.is_member)
  if (!ok) throw new EndpointError('Not a member of this chat', { code: 'NOT_A_MEMBER' })
}
