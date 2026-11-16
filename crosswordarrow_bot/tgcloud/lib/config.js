// A negative user id never appears in init data verified by the platform, so it can
// only come from `npx tgcloud run ... --ctx '{ initData: { user: { id: -1 } } }'`.
export const ADMIN_USER_ID = -1

export const PRESENCE_TTL_SEC = 10
