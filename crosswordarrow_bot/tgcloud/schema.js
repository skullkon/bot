import { table, integer, text, json, boolean, index, primaryKey } from 'sdk/db'

// Puzzle pool, filled by tools/upload.js through endpoints/importPuzzles.
export const puzzles = table('puzzles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  data: json('data').notNull(),
  createdAt: integer('created_at'),
  // Retired puzzles stay for old games but are never picked for new ones.
  retired: boolean('retired').notNull().default(false),
})

// One shared game per group chat at a time. `rev` grows with every change.
export const games = table('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  puzzleId: integer('puzzle_id').notNull(),
  rev: integer('rev').notNull().default(0),
  status: text('status').notNull().default('active'),
  startedAt: integer('started_at').notNull(),
  solvedAt: integer('solved_at'),
  messageId: integer('message_id'),
}, (t) => ({
  chatStatusIdx: index('idx_games_chat_status').on(t.chatId, t.status),
}))

// Letters typed into a game; `rev` is the game revision of the last change.
export const cells = table('cells', {
  gameId: integer('game_id').notNull(),
  idx: integer('idx').notNull(),
  letter: text('letter'),
  userId: integer('user_id'),
  rev: integer('rev').notNull(),
  locked: boolean('locked').notNull().default(false),
  revealed: boolean('revealed').notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.idx] }),
  revIdx: index('idx_cells_game_rev').on(t.gameId, t.rev),
}))

// Chat members who opened the game (membership checked once per game).
export const players = table('players', {
  gameId: integer('game_id').notNull(),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  photoUrl: text('photo_url'),
  joinedAt: integer('joined_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.userId] }),
}))

// Who is looking at which word right now (refreshed by every poll).
export const presence = table('presence', {
  gameId: integer('game_id').notNull(),
  userId: integer('user_id').notNull(),
  wordId: integer('word_id'),
  cellIdx: integer('cell_idx'),
  seenAt: integer('seen_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.userId] }),
}))
