import { table, integer, text, json, boolean, index, primaryKey } from 'sdk/db'

// Puzzle pool, filled by tools/upload.js through endpoints/admin.
export const puzzles = table('puzzles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  data: json('data').notNull(),
  createdAt: integer('created_at'),
  // Retired puzzles stay for games already started but are never picked for new ones.
  retired: boolean('retired').notNull().default(false),
})

// One shared game per chat at a time.
export const games = table('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  puzzleId: integer('puzzle_id').notNull(),
  // Legacy counter of the first version; revisions now come from cells.rev.
  rev: integer('rev').notNull().default(0),
  status: text('status').notNull().default('active'),
  startedAt: integer('started_at').notNull(),
  solvedAt: integer('solved_at'),
  messageId: integer('message_id'),
}, (t) => ({
  chatStatusIdx: index('idx_games_chat_status').on(t.chatId, t.status),
}))

// Letters typed into a game. `rev` is a per-game counter stamped by the statement
// that writes the row, so "everything after rev N" never misses a change.
export const cells = table('cells', {
  gameId: integer('game_id').notNull(),
  idx: integer('idx').notNull(),
  letter: text('letter'),
  userId: integer('user_id'),
  rev: integer('rev').notNull(),
  locked: boolean('locked').notNull().default(false),
  revealed: boolean('revealed').notNull().default(false),
  // Who completed the word that locked this cell.
  lockedBy: integer('locked_by'),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.idx] }),
  revIdx: index('idx_cells_game_rev').on(t.gameId, t.rev),
}))

// People who opened the game (chat membership is checked once per game).
export const players = table('players', {
  gameId: integer('game_id').notNull(),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  photoUrl: text('photo_url'),
  joinedAt: integer('joined_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.userId] }),
}))

// Where everyone's cursor is right now (refreshed by every sync).
export const presence = table('presence', {
  gameId: integer('game_id').notNull(),
  userId: integer('user_id').notNull(),
  wordId: integer('word_id'),
  cellIdx: integer('cell_idx'),
  seenAt: integer('seen_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.userId] }),
}))
