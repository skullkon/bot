// handlers/message.js — chat commands. /play starts a scanword for the whole chat.
import { api } from 'sdk'
import { parseCommand } from '../lib/core.js'
import { botUsername, startGameInChat } from '../lib/announce.js'

const HELP = [
  'Я провожу сканворды для всего чата.',
  '',
  '/play — начать сканворд или показать кнопку текущего',
  '/help — эта подсказка',
  '',
  'Сканворд один на чат: все открывают его по кнопке и вписывают слова одновременно. Верно отгаданное слово закрепляется и засчитывается тому, кто вписал последнюю букву.',
].join('\n')

export default async function (message) {
  const chat = message.chat
  if (!['private', 'group', 'supergroup'].includes(chat.type)) return
  const name = await botUsername()
  const command = parseCommand(message.text, name)

  if (chat.type === 'private') {
    if (command?.cmd === 'play') {
      await startGameInChat(chat.id)
      return
    }
    await api.sendMessage({
      chat_id: chat.id,
      text: 'Я провожу сканворды для компаний. Добавьте меня в чат с друзьями и напишите там /play — решать вместе веселее.\n\nА здесь можно разгадывать в одиночку: /play',
      reply_markup: { inline_keyboard: [[{ text: 'Добавить в группу', url: `https://t.me/${name}?startgroup=play` }]] },
    })
    return
  }
  if (!command) return
  if (command.cmd === 'play' || command.cmd === 'start') await startGameInChat(chat.id)
  else if (command.cmd === 'help') await api.sendMessage({ chat_id: chat.id, text: HELP })
}
