import { api, BotApiError } from 'sdk'
import { createGame, loadGame, setMessageId, solvers } from './games.js'
import { formatDuration } from './core.js'

let username = null

export async function botUsername() {
  if (!username) username = (await api.getMe()).username
  return username
}

async function sendGameMessage(game) {
  const name = await botUsername()
  const msg = await api.sendMessage({
    chat_id: game.chatId,
    text: `Сканворд №${game.id}\nРешаем всем чатом: открывайте и вписывайте слова вместе.`,
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть сканворд', url: `https://t.me/${name}?startapp=g_${game.id}` }]],
    },
  })
  await setMessageId(game.id, msg.message_id)
}

// Starts a game in the chat, or re-posts the button of the one already running.
export async function startGameInChat(chatId, { announceExisting = true } = {}) {
  const { game, created } = await createGame(chatId)
  if (created || announceExisting) await sendGameMessage(game)
  return { game, created }
}

export async function announceSolved(gameId) {
  const game = await loadGame(gameId)
  const names = (await solvers(gameId)).map((p) => p.name).join(', ')
  const duration = formatDuration((game.solvedAt ?? Math.floor(Date.now() / 1000)) - game.startedAt)
  try {
    await api.sendMessage({
      chat_id: game.chatId,
      text: `Сканворд №${game.id} решён за ${duration}.${names ? `\nРешали: ${names}.` : ''}`,
      reply_markup: { inline_keyboard: [[{ text: 'Новый сканворд', callback_data: 'new' }]] },
    })
  } catch (e) {
    // The bot may have been removed from the group; the game itself is still fine.
    if (!(e instanceof BotApiError)) throw e
    console.warn('could not announce solved game', { gameId, code: e.code, description: e.description })
  }
}
