// A negative user id never appears in init data verified by the platform, so it can
// only come from `npx tgcloud run ... --ctx '{ initData: { user: { id: -1 } } }'`.
export const ADMIN_USER_ID = -1

// A cursor older than this is no longer shown to the other players.
export const PRESENCE_TTL_SEC = 12

// Most letters one sync call may carry (a client batches what was typed meanwhile).
export const MAX_MOVES_PER_SYNC = 40
