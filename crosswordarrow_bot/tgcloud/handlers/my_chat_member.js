// handlers/my_chat_member.js — greets the group when the bot is added.
import { api } from 'sdk'

export default async function (update) {
  const { chat, old_chat_member: before, new_chat_member: after } = update
  if (chat.type === 'private') return
  const joined = ['member', 'administrator'].includes(after.status) && ['left', 'kicked'].includes(before.status)
  if (!joined) return
  await api.sendMessage({ chat_id: chat.id, text: 'Привет! Я провожу сканворды для всего чата. Напишите /play, чтобы начать.' })
}
