# Research: Persistent Auth with Rotating Tokens

No NEEDS CLARIFICATION items remained in the Technical Context. The decisions below cover each
technology choice and integration point.

## R1. Password hashing parameters

- **Decision**: `argon2.hash(password, { type: argon2.argon2id })` with library defaults
  (m=64 MiB, t=3, p=4); verify with `argon2.verify(hash, password)`. The salt and parameters are
  encoded in the hash string, so no separate `salt` field.
- **Rationale**: Mandated by the constitution; defaults meet OWASP guidance and keep login well
  under 1 s. `verify` compares in constant time.
- **Alternatives**: Node `crypto.scrypt` (rejected by constitution decision); tuning parameters
  higher (unnecessary at current scale; revisit with load data).
- **Timing note**: when the username is unknown, still run `argon2.verify` against a fixed dummy
  hash so response time does not reveal whether the account exists.

## R2. Refresh token format

- **Decision**: opaque token = 32 random bytes, base64url (`crypto.randomBytes(32)`). Store only
  `sha256(token)` hex.
- **Rationale**: 256 bits of entropy makes a fast hash safe (no brute force possible), and a
  deterministic hash allows direct indexed lookup. Opaque tokens carry no data to leak and are
  always checked against the DB anyway, so a JWT adds nothing.
- **Alternatives**: refresh JWT signed with `JWT_REFRESH_SECRET` (redundant: still needs DB state
  for rotation); argon2-hashed refresh tokens (cannot be looked up by hash; would need a
  selector/verifier split for no security gain).

## R3. Constant-time comparison for refresh tokens

- **Decision**: look up sessions by `tokenHash` equality in MongoDB; no in-process string compare.
- **Rationale**: an attacker cannot learn useful timing information about a SHA-256 preimage of a
  256-bit random value. Constitution v1.0.1 (Principle I) explicitly permits this; in-process
  comparisons (passwords) stay constant-time via argon2 `verify`.

## R4. Atomic rotation and reuse detection

- **Decision**: consume with a single
  `findOneAndUpdate({ tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
  { $set: { usedAt: now } })`.
  - Match → insert the new session, set `replacedBy` on the old one, then **re-read the old
    session**: if its `revokedAt` is now set, reuse handling ran concurrently (its
    `updateMany({ userId, revokedAt: null })` also matches used sessions), so set `revokedAt` on
    the new session and return 401. Sign the access token only after this check passes. This
    closes the race where a session inserted just after the bulk revoke would survive it.
  - No match → `findOne({ tokenHash })`. If it exists with `usedAt` set → **reuse**:
    `updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } })`, return 401.
    Otherwise (unknown, expired, revoked) → 401.
- **Rationale**: the conditional update is atomic on a single document, so two concurrent
  refreshes with the same token cannot both succeed; the loser is treated as reuse and, with the
  re-check above, every session of the user ends up revoked, including the winner's (spec edge
  case: clients must serialize refreshes). No transactions or replica set required.
- **Alternatives**: multi-document transactions (need replica set, heavier); token families with
  a `familyId` (finer-grained revocation, but the spec requires revoking all user sessions).

## R5. Configuration and startup validation

- **Decision**: `ConfigModule.forRoot({ validate })` with a small hand-written `validate`
  function in `src/config/env.validation.ts` that throws if `MONGODB_URI` or `JWT_ACCESS_SECRET`
  is missing and applies defaults: `JWT_ACCESS_TTL=15m`, `REFRESH_TOKEN_TTL_DAYS=7`.
  Optional `INITIAL_USER_USERNAME` / `INITIAL_USER_PASSWORD`.
- **Rationale**: reuses variable names already in `.env.example`; avoids adding Joi/zod
  (Principle V).
- **Alternatives**: Joi schema (new dependency); `class-validator` on an env class (works, more
  boilerplate than needed for 6 variables).

## R6. E2E test database

- **Decision**: `mongodb-memory-server` as devDependency; e2e tests start an in-memory
  `MongoMemoryServer`, set `MONGODB_URI` before compiling `AppModule`, and drop collections
  between tests.
- **Rationale**: hermetic, fast, runs in CI without Docker; exercises real query semantics.
- **Alternatives**: Docker Compose Mongo (extra tooling for contributors); shared Atlas test DB
  (flaky, needs secrets in CI).

## R7. Request validation

- **Decision**: register `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
  transform: true })` as `APP_PIPE` provider in `AppModule` (not in `main.ts`) so e2e tests get it
  automatically. DTOs use `@IsString() @IsNotEmpty()`.
- **Rationale**: one place, applies identically in prod and tests. Empty/missing tokens now
  return 400 from the pipe, matching current behavior.

## R8. Access token claims

- **Decision**: HS256 JWT via `JwtModule.registerAsync` with `secret: JWT_ACCESS_SECRET`,
  `signOptions.expiresIn: JWT_ACCESS_TTL`. Payload `{ sub: userId, username }` plus standard
  `iat`/`exp`. Logout verifies with `jwtService.verifyAsync`; any failure → 401.
- **Rationale**: symmetric signing is sufficient while this service is the only verifier.
- **Alternatives**: RS256 with key pair (needed only once other services verify tokens
  themselves; easy to switch later).

## R9. Initial user seeding

- **Decision**: `UsersService.onApplicationBootstrap` upserts the configured initial user with
  `$setOnInsert` (never overwrites an existing password). Skipped if either variable is unset.
- **Rationale**: idempotent across restarts and instances; satisfies FR-013 without a
  registration endpoint.

## R10. Expired session cleanup

- **Decision**: TTL index on `refreshsessions.expiresAt` (`expireAfterSeconds: 0`).
- **Rationale**: MongoDB removes expired sessions automatically; correctness never depends on it
  because queries also filter on `expiresAt`.
