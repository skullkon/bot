import { render } from 'preact'
import '@fontsource/golos-text/cyrillic-400.css'
import '@fontsource/golos-text/cyrillic-500.css'
import '@fontsource/golos-text/cyrillic-600.css'
import '@fontsource/golos-text/latin-400.css'
import '@fontsource/golos-text/latin-600.css'
import '@fontsource/fira-sans-extra-condensed/cyrillic-400.css'
import '@fontsource/fira-sans-extra-condensed/cyrillic-500.css'
import './styles.css'
import { App } from './app.jsx'
import { createApi, telegram, haptic } from './api.js'
import { createStore } from './store.js'

const tg = telegram()
try {
  tg?.ready()
  tg?.expand()
  tg?.disableVerticalSwipes?.()
} catch { /* not in Telegram */ }

// Keep the game inside the part of the screen the keyboard leaves free.
const vv = window.visualViewport
if (vv) {
  const fit = () => {
    document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
    document.documentElement.style.setProperty('--app-top', `${vv.offsetTop}px`)
  }
  vv.addEventListener('resize', fit)
  vv.addEventListener('scroll', fit)
  fit()
}

createApi().then((api) => {
  const store = createStore(api, haptic)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) store.wake() })
  render(<App store={store} />, document.getElementById('root'))
  store.load()
})
