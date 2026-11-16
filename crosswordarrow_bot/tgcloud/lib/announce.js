import { api, BotApiError } from 'sdk'
import { createGame, loadGame, loadPuzzle, setMessageId, gameNumber, scoreboard } from './games.js'
import { formatDuration, plural } from './core.js'

let username = null

export async function botUsername() {
  if (!username) username = (await api.getMe()).username
  return username
}

async function sendGameMessage(game, { fresh }) {
  const name = await botUsername()
  const no = await gameNumber(game)
  const solo = game.chatId > 0
  const lead = fresh ? `Сканворд №${no} готов.` : `Сканворд №${no} ещё не решён.`
  const text = solo
    ? `${lead}\nОткрывайте и разгадывайте. А в группе с друзьями его можно решать всем вместе.`
    : `${lead}\nРешаем всем чатом: открывайте и вписывайте слова одновременно, буквы друг друга видны сразу.`
  const msg = await api.sendMessage({
    chat_id: game.chatId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть сканворд', url: `https://t.me/${name}?startapp=g_${game.id}` }]],
    },
  })
  await setMessageId(game.id, msg.message_id)
}

// Starts a game in the chat, or re-posts the button of the one already running.
export async function startGameInChat(chatId, { announceExisting = true } = {}) {
  const { game, created } = await createGame(chatId)
  if (created || announceExisting) await sendGameMessage(game, { fresh: created })
  return { game, created }
}

const MEDALS = ['🥇', '🥈', '🥉']

export async function announceSolved(gameId) {
  const game = await loadGame(gameId)
  const puzzle = await loadPuzzle(game.puzzleId)
  const board = await scoreboard(game, puzzle)
  const no = await gameNumber(game)
  const duration = formatDuration((game.solvedAt ?? Math.floor(Date.now() / 1000)) - game.startedAt)
  const lines = [`Сканворд №${no} решён за ${duration}!`]
  if (board.length > 1) {
    lines.push('')
    board.forEach((p, i) => {
      const hints = p.hints ? `, ${p.hints} ${plural(p.hints, 'подсказка', 'подсказки', 'подсказок')}` : ''
      lines.push(`${MEDALS[i] ?? '▫️'} ${p.name}: ${p.words} ${plural(p.words, 'слово', 'слова', 'слов')}${hints}`)
    })
  } else if (board.length === 1 && board[0].hints) {
    lines.push(`Подсказок: ${board[0].hints}.`)
  }
  try {
    await api.sendMessage({
      chat_id: game.chatId,
      text: lines.join('\n'),
      reply_markup: { inline_keyboard: [[{ text: 'Новый сканворд', callback_data: 'new' }]] },
    })
  } catch (e) {
    // The bot may have been removed from the group; the game itself is still fine.
    if (!(e instanceof BotApiError)) throw e
    console.warn('could not announce solved game', { gameId, code: e.code, description: e.description })
  }
}
