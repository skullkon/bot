import { useEffect, useLayoutEffect, useRef, useState, useReducer } from 'preact/hooks'
import { normalizeLetter, formatDuration, plural } from '../tgcloud/lib/core.js'
import { haptic, telegram } from './api.js'
import { setDarkPalette } from './store.js'

// Letters typed on a Latin layout land where they sit on the Russian one (q -> Й).
const LATIN = Object.fromEntries([..."qwertyuiop[]asdfghjkl;'zxcvbnm,.`"].map((ch, i) => [ch, 'ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЕ'[i]]))
const toLetter = (ch) => normalizeLetter(ch) ?? (LATIN[ch.toLowerCase()] ? LATIN[ch.toLowerCase()] : null)

// The system keyboard only opens for a focused text field, so the game keeps one
// out of sight and reads what is typed into it. Its value is never empty, or a
// backspace on an empty field would not reach us on Android.
const SENTINEL = '\u00a0\u00a0'
let field = null
let fieldFocused = false
const openKeyboard = () => {
  if (!field) return
  field.focus({ preventScroll: true })
  field.value = SENTINEL
  field.setSelectionRange(SENTINEL.length, SENTINEL.length)
}

function useStore(store) {
  const [, force] = useReducer((n) => n + 1, 0)
  useEffect(() => store.subscribe(force), [store])
  return store.state
}

export function App({ store }) {
  const s = useStore(store)

  useEffect(() => {
    const tg = telegram()
    const apply = () => {
      const dark = (tg?.colorScheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      setDarkPalette(dark)
      store.wake()
    }
    apply()
    tg?.onEvent?.('themeChanged', apply)
    return () => tg?.offEvent?.('themeChanged', apply)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Letters typed into the hidden field arrive through its input event.
      if (e.target === field && e.key !== 'Backspace' && !e.key.startsWith('Arrow') && e.key !== 'Enter' && e.key !== 'Tab') return
      const letter = e.key.length === 1 ? toLetter(e.key) : null
      if (letter) store.type(letter)
      else if (e.key === 'Backspace') store.backspace()
      else if (e.key === 'ArrowLeft') store.moveCursor(-1, 0)
      else if (e.key === 'ArrowRight') store.moveCursor(1, 0)
      else if (e.key === 'ArrowUp') store.moveCursor(0, -1)
      else if (e.key === 'ArrowDown') store.moveCursor(0, 1)
      else if (e.key === 'Tab' || e.key === 'Enter') store.stepWord(e.shiftKey ? -1 : 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (s.phase === 'loading') return <div class="center"><div class="spinner" /></div>
  if (s.phase === 'error') return <ErrorScreen error={s.error} onRetry={() => store.load()} />

  const solved = s.game.status === 'solved'
  return (
    <div class="app">
      <TopBar store={store} s={s} />
      <Grid store={store} s={s} />
      {solved ? <SolvedSheet store={store} s={s} /> : (
        <div class="dock">
          <ClueBar store={store} s={s} />
        </div>
      )}
      {!solved && <TypingField store={store} />}
    </div>
  )
}

function initials(name) {
  return (name.trim()[0] ?? '?').toUpperCase()
}

function Avatar({ player, color, dim, size = 24 }) {
  const [broken, setBroken] = useState(false)
  return (
    <span class={`avatar${dim ? ' dim' : ''}`} style={{ '--c': color, width: size, height: size, fontSize: size * 0.48 }} title={player.name}>
      {player.photoUrl && !broken
        ? <img src={player.photoUrl} alt="" onError={() => setBroken(true)} />
        : initials(player.name)}
    </span>
  )
}

function TopBar({ store, s }) {
  const done = store.solvedCount()
  const total = s.words.length
  const online = new Set(s.presence.map((p) => p.userId))
  online.add(s.me)
  const shown = [...s.players].sort((a, b) => online.has(b.userId) - online.has(a.userId)).slice(0, 5)
  return (
    <header class="top">
      <div class="top-row">
        <div class="title">
          <b>Сканворд №{s.game.number}</b>
          <span>{done} из {total} {plural(total, 'слова', 'слов', 'слов')}</span>
        </div>
        {s.offline && <span class="offline">нет связи…</span>}
        <div class="avatars">
          {shown.map((p) => <Avatar key={p.userId} player={p} color={store.colorOf(p.userId)} dim={!online.has(p.userId)} />)}
          {s.players.length > shown.length && <span class="more">+{s.players.length - shown.length}</span>}
        </div>
      </div>
      <div class="progress"><i style={{ width: `${(100 * done) / total}%` }} /></div>
    </header>
  )
}

const ARROWS = {
  right: <svg viewBox="0 0 10 10"><path d="M1 1.5 L8 5 L1 8.5 Z" fill="currentColor" /></svg>,
  down: <svg viewBox="0 0 10 10"><path d="M1.5 1 L5 8 L8.5 1 Z" fill="currentColor" /></svg>,
  'right-down': <svg viewBox="0 0 10 10"><path d="M0 2.5 H5 V6" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M2 5.5 L5 10 L8 5.5 Z" fill="currentColor" /></svg>,
  'down-right': <svg viewBox="0 0 10 10"><path d="M2.5 0 V5 H6" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M5.5 2 L10 5 L5.5 8 Z" fill="currentColor" /></svg>,
}

function Grid({ store, s }) {
  const wrap = useRef(null)
  const [cell, setCell] = useState(0)
  const { width: W, height: H } = s.puzzle

  useLayoutEffect(() => {
    const el = wrap.current
    const measure = () => {
      const cs = getComputedStyle(el)
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 3
      setCell(Math.max(18, Math.min(54, Math.floor(inner / W))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W])

  // Shrink every clue until it fits its cell.
  useLayoutEffect(() => {
    if (!cell) return
    const fit = () => {
      for (const box of wrap.current.querySelectorAll('.clue-half')) {
        const text = box.firstElementChild
        let size = cell * (box.parentElement.classList.contains('split') ? 0.215 : 0.27)
        text.style.fontSize = `${size}px`
        while (size > 4.6 && (text.offsetHeight > box.clientHeight + 0.5 || text.scrollWidth > box.clientWidth + 0.5)) {
          size -= 0.3
          text.style.fontSize = `${size}px`
        }
      }
    }
    fit()
    document.fonts?.ready?.then(fit)
  }, [cell, s.puzzle])

  useEffect(() => {
    wrap.current?.querySelector('.cursor')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [s.sel.idx, cell])

  const word = s.words[s.sel.wordId]
  const inWord = new Set(word?.cells ?? [])
  const others = new Map()
  for (const p of s.presence) if (p.cellIdx != null) others.set(p.cellIdx, p.userId)
  const starts = new Map()
  for (const w of s.words) {
    if (!starts.has(w.start)) starts.set(w.start, [])
    starts.get(w.start).push(w.arrow)
  }
  const now = Date.now()
  const shaking = now - s.shake.at < 600 ? new Set(s.words[s.shake.wordId]?.cells) : null

  const cells = []
  for (let idx = 0; idx < W * H; idx++) {
    const clue = s.clueAt.get(idx)
    if (clue) {
      const active = clue.slots.some((x) => x.wordId === s.sel.wordId)
      cells.push(
        <div key={idx} class={`cell clue${clue.slots.length > 1 ? ' split' : ''}${active ? ' active' : ''}`} onClick={() => { store.selectCell(idx); openKeyboard() }}>
          {clue.slots.map((x) => {
            const w = s.words[x.wordId]
            return (
              <div key={x.wordId} class={`clue-half${x.wordId === s.sel.wordId ? ' on' : ''}${store.isWordSolved(w) ? ' done' : ''}`}>
                <span class="clue-text" lang="ru">{w.clue}</span>
              </div>
            )
          })}
        </div>,
      )
      continue
    }
    if (!s.cellWords.has(idx)) {
      cells.push(<div key={idx} class="cell void" />)
      continue
    }
    const server = s.server.get(idx)
    const pending = s.pending.get(idx)
    const letter = store.letterAt(idx)
    const locked = Boolean(server?.locked)
    const author = pending ? s.me : server?.userId
    const other = others.get(idx)
    const flashAt = s.flash.get(idx)
    let cls = 'cell letter'
    if (inWord.has(idx)) cls += ' in-word'
    if (idx === s.sel.idx) cls += ' cursor'
    if (locked) cls += ' locked'
    if (flashAt && now - flashAt < 900) cls += ' flash'
    if (shaking?.has(idx)) cls += ' shake'
    if (pending?.reveal) cls += ' revealing'
    const style = {}
    if (locked) style['--tint'] = store.colorOf(server.lockedBy ?? server.userId)
    else if (letter && author != null) style.color = store.colorOf(author)
    if (other != null) style['--other'] = store.colorOf(other)
    cells.push(
      <div key={idx} class={cls} style={style} onClick={() => { store.selectCell(idx); openKeyboard() }}>
        {starts.get(idx)?.map((a) => <i key={a} class={`arrow a-${a}`}>{ARROWS[a]}</i>)}
        {letter}
        {other != null && <i class="other" />}
      </div>,
    )
  }

  return (
    <main class="board" ref={wrap}>
      {cell > 0 && (
        <div class="grid" style={{ '--cell': `${cell}px`, gridTemplateColumns: `repeat(${W}, ${cell}px)`, gridAutoRows: `${cell}px` }}>
          {cells}
        </div>
      )}
    </main>
  )
}

function ClueBar({ store, s }) {
  const word = s.words[s.sel.wordId]
  const watching = s.presence.filter((p) => p.wordId === word?.id).map((p) => s.players.find((x) => x.userId === p.userId)).filter(Boolean)
  return (
    <div class="cluebar">
      <button class="nav" aria-label="Предыдущее слово" {...keepKeyboard} onClick={tap(() => store.stepWord(-1))}>‹</button>
      <div class="clue-main" onClick={openKeyboard}>
        <div class="clue-big">{word?.clue}</div>
        <div class="clue-meta">
          {word?.len} {plural(word?.len ?? 0, 'буква', 'буквы', 'букв')} · {word?.dir === 'right' ? 'по горизонтали' : 'по вертикали'}
          {watching.length > 0 && <span class="also" style={{ color: store.colorOf(watching[0].userId) }}> · здесь {watching.map((p) => p.name.split(' ')[0]).join(', ')}</span>}
        </div>
      </div>
      <button class="hint" aria-label="Открыть букву" {...keepKeyboard} onClick={tap(() => { haptic('light'); store.hint() })}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z" /></svg>
      </button>
      <button class="nav" aria-label="Следующее слово" {...keepKeyboard} onClick={tap(() => store.stepWord(1))}>›</button>
    </div>
  )
}

function TypingField({ store }) {
  const ref = useRef(null)
  useEffect(() => {
    field = ref.current
    field.value = SENTINEL
    return () => {
      field?.blur()
      field = null
      fieldFocused = false
    }
  }, [])
  const reset = (el) => {
    el.value = SENTINEL
    el.setSelectionRange(SENTINEL.length, SENTINEL.length)
  }
  const onInput = (e) => {
    const el = e.currentTarget
    const kind = e.inputType ?? ''
    if (kind.startsWith('delete')) {
      store.backspace()
    } else if (e.data) {
      // A keyboard that composes words re-sends the whole word: only its last letter is new.
      const chars = kind === 'insertCompositionText' ? [...e.data].slice(-1) : [...e.data]
      for (const ch of chars) {
        const letter = toLetter(ch)
        if (letter) store.type(letter)
      }
    } else if (el.value.length < SENTINEL.length) {
      store.backspace()
    }
    reset(el)
  }
  return (
    <input
      ref={ref}
      class="typing"
      type="text"
      lang="ru"
      inputMode="text"
      enterKeyHint="next"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="characters"
      spellcheck={false}
      aria-label="Ввод букв"
      onInput={onInput}
      onFocus={() => { fieldFocused = true }}
      onBlur={() => { fieldFocused = false }}
    />
  )
}

// Buttons must not take the focus away from the field, or the keyboard would close.
const keepKeyboard = { onPointerDown: (e) => e.preventDefault(), onMouseDown: (e) => e.preventDefault() }
const tap = (fn) => () => {
  const wasOpen = fieldFocused
  fn()
  if (wasOpen) openKeyboard()
}

const MEDALS = ['🥇', '🥈', '🥉']

function SolvedSheet({ store, s }) {
  const board = store.scoreboard().filter((p) => p.words || p.letters || p.hints)
  const took = s.game.solvedAt ? formatDuration(s.game.solvedAt - s.game.startedAt) : null
  return (
    <div class="sheet">
      <h2>Сканворд решён{took ? ` за ${took}` : ''}!</h2>
      <ul class="board-list">
        {board.map((p, i) => (
          <li key={p.userId}>
            <span class="medal">{board.length > 1 ? MEDALS[i] ?? '' : ''}</span>
            <Avatar player={p} color={store.colorOf(p.userId)} size={28} />
            <span class="who">{p.name}</span>
            <span class="score">
              <b>{p.words}</b> {plural(p.words, 'слово', 'слова', 'слов')}
              {p.hints > 0 && <small> · {p.hints} {plural(p.hints, 'подсказка', 'подсказки', 'подсказок')}</small>}
            </span>
          </li>
        ))}
      </ul>
      <button class="primary" disabled={s.starting} onClick={() => store.startNext()}>
        {s.starting ? 'Готовим…' : s.game.nextGameId ? 'К текущему сканворду' : 'Следующий сканворд'}
      </button>
    </div>
  )
}

const ERRORS = {
  NO_GAME: ['Сканворд не выбран', 'Откройте его кнопкой «Открыть сканворд» в чате. Чтобы начать новый, напишите в чате /play.'],
  NO_USER: ['Откройте игру из Telegram', 'Сканворд работает внутри Telegram: нажмите кнопку под сообщением бота в чате.'],
  NOT_A_MEMBER: ['Это сканворд другого чата', 'Решать его могут участники чата, где он запущен. Добавьте бота в свой чат и напишите там /play.'],
  GAME_CLOSED: ['Этот сканворд закрыт', 'Мы обновили сканворды. Напишите в чате /play — начнём новый, с новыми словами.'],
  GAME_NOT_FOUND: ['Сканворд не найден', 'Возможно, ссылка устарела. Напишите в чате /play, чтобы получить новую кнопку.'],
}

function ErrorScreen({ error, onRetry }) {
  const known = ERRORS[error.code]
  return (
    <div class="center error">
      <h2>{known ? known[0] : 'Не получилось загрузить'}</h2>
      <p>{known ? known[1] : 'Проверьте соединение и попробуйте ещё раз.'}</p>
      {!known && <button class="primary" onClick={onRetry}>Повторить</button>}
    </div>
  )
}
