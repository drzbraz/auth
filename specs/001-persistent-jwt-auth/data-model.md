# Data Model: Persistent Auth with Rotating Tokens

## User (`users` collection)

| Field | Type | Rules |
|-------|------|-------|
| `_id` | ObjectId | primary key; used as JWT `sub` |
| `username` | string | required, trimmed, 3–64 chars, **unique index** |
| `passwordHash` | string | required; argon2id encoded hash (includes salt + params); never selected by default (`select: false`) |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

Validation: `username` uniqueness enforced by index; seeding uses upsert with `$setOnInsert`.

## RefreshSession (`refreshsessions` collection)

| Field | Type | Rules |
|-------|------|-------|
| `_id` | ObjectId | primary key |
| `userId` | ObjectId → User | required, **indexed** (bulk revoke) |
| `tokenHash` | string | required, SHA-256 hex of the opaque token, **unique index** |
| `expiresAt` | Date | required; issue time + `REFRESH_TOKEN_TTL_DAYS`; **TTL index** (`expireAfterSeconds: 0`) |
| `usedAt` | Date \| null | set when exchanged in a refresh |
| `revokedAt` | Date \| null | set by logout or reuse detection |
| `replacedBy` | ObjectId \| null | session issued in exchange for this one |
| `createdAt` | Date | Mongoose timestamps |

Relationships: User 1 — N RefreshSession.

### State transitions

```text
            refresh (atomic consume)
  ACTIVE ─────────────────────────────▶ USED ──(presented again)──▶ reuse detected:
    │                                                               all ACTIVE sessions
    │ logout / reuse detected                                       of user → REVOKED
    ▼
  REVOKED

  ACTIVE ──(expiresAt passes)──▶ EXPIRED ──(TTL index)──▶ deleted
```

- **ACTIVE**: `usedAt = null`, `revokedAt = null`, `expiresAt > now`. Only state accepted by refresh.
- **USED**: `usedAt != null`. Presenting it again triggers reuse handling (FR-008).
- **REVOKED**: `revokedAt != null`. Rejected.
- **EXPIRED**: `expiresAt <= now`. Rejected; removed by TTL index.

## Access Token (not persisted)

JWT HS256: `{ sub: <User._id>, username, iat, exp }`, `exp = iat + JWT_ACCESS_TTL` (default 15 min).

## Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MONGODB_URI` | yes | – | database connection |
| `JWT_ACCESS_SECRET` | yes | – | HS256 signing key (≥ 32 chars recommended) |
| `JWT_ACCESS_TTL` | no | `15m` | access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | refresh session lifetime |
| `INITIAL_USER_USERNAME` | no | – | seeded account username |
| `INITIAL_USER_PASSWORD` | no | – | seeded account password |
| `PORT` | no | `3000` | HTTP port |
