// handlers/message.js — group commands; in private chats explains how to start.
import { api } from 'sdk'
import { parseCommand } from '../lib/core.js'
import { botUsername, startGameInChat } from '../lib/announce.js'

const HELP = 'Команда /play начинает сканворд для всего чата. Открывайте его по кнопке и решайте вместе, одновременно.'

export default async function (message) {
  const chat = message.chat
  const name = await botUsername()
  if (chat.type === 'private') {
    await api.sendMessage({
      chat_id: chat.id,
      text: 'Я провожу сканворды для групп. Добавьте меня в чат с друзьями и напишите там /play.',
      reply_markup: { inline_keyboard: [[{ text: 'Добавить в группу', url: `https://t.me/${name}?startgroup=play` }]] },
    })
    return
  }
  if (chat.type !== 'group' && chat.type !== 'supergroup') return
  const command = parseCommand(message.text, name)
  if (!command) return
  if (command.cmd === 'play' || command.cmd === 'start') await startGameInChat(chat.id)
  else if (command.cmd === 'help') await api.sendMessage({ chat_id: chat.id, text: HELP })
}
