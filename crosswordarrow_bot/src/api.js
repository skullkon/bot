// Calls to the bot's endpoints. Inside Telegram they go through the official
// bridge, which signs them with the init data; in `npm run dev` a local stand-in
// plays the server so the interface can be worked on in a plain browser.
const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null

export const inTelegram = Boolean(tg?.initData)

export function telegram() {
  return tg
}

export function haptic(kind) {
  const h = tg?.HapticFeedback
  if (!h) return
  try {
    if (kind === 'key') h.selectionChanged()
    else if (kind === 'light') h.impactOccurred('light')
    else h.notificationOccurred(kind)
  } catch { /* old clients */ }
}

function callTelegram(name, input) {
  return new Promise((resolve, reject) => {
    tg.Serverless.call(name, input, (err, result) => {
      if (!err) return resolve(result)
      const e = new Error(err.message ?? 'Request failed')
      e.type = err.type
      e.parameters = err.parameters
      reject(e)
    })
  })
}

export async function createApi() {
  if (inTelegram && tg.Serverless) return { call: callTelegram }
  if (import.meta.env.DEV) {
    const { createDemoApi } = await import('./demo.js')
    return { call: createDemoApi() }
  }
  return {
    call: async () => {
      const e = new Error('Open the game from Telegram')
      e.parameters = { code: 'NO_USER' }
      throw e
    },
  }
}
