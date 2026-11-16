// handlers/callback_query.js — the "Новый сканворд" button under a solved game.
import { api } from 'sdk'
import { startGameInChat } from '../lib/announce.js'

export default async function (query) {
  if (query.data !== 'new' || !query.message) {
    await api.answerCallbackQuery({ callback_query_id: query.id })
    return
  }
  const { created } = await startGameInChat(query.message.chat.id, { announceExisting: false })
  await api.answerCallbackQuery({
    callback_query_id: query.id,
    text: created ? 'Новый сканворд готов' : 'Сканворд уже идёт, кнопка выше в чате',
  })
}
