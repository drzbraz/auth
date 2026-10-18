---

description: "Task list for Persistent Auth with Rotating Tokens"
---

# Tasks: Persistent Auth with Rotating Tokens

**Input**: Design documents from `/specs/001-persistent-jwt-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-api.md, quickstart.md

**Tests**: Included. The constitution (Principle II, NON-NEGOTIABLE) requires unit + e2e tests for
every endpoint and error path, written first and seen failing.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4 from spec.md)
- Paths are relative to the repository root (single NestJS project: `src/`, `test/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and environment

- [X] T001 Run `npm install` at repository root (no `node_modules` exists yet) and confirm `npm run build` succeeds on the current code
- [X] T002 Add `mongodb-memory-server` as a devDependency via `npm install -D mongodb-memory-server` (justified in plan.md Complexity Tracking) in package.json
- [X] T003 [P] Update .env.example: remove `JWT_REFRESH_SECRET`; add `JWT_ACCESS_TTL=15m`, `REFRESH_TOKEN_TTL_DAYS=7`, `INITIAL_USER_USERNAME=`, `INITIAL_USER_PASSWORD=` (keep `MONGODB_URI`, `JWT_ACCESS_SECRET`, `PORT`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config, validation, schemas, token primitives and the e2e harness that every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Unit tests for env validation (missing `MONGODB_URI` throws, missing `JWT_ACCESS_SECRET` throws, defaults applied, non-numeric `REFRESH_TOKEN_TTL_DAYS` throws) in src/config/env.validation.spec.ts
- [X] T005 Create `validate(config)` in src/config/env.validation.ts: throw an Error naming the variable if `MONGODB_URI` or `JWT_ACCESS_SECRET` is missing/empty; default `JWT_ACCESS_TTL` to `'15m'` and `REFRESH_TOKEN_TTL_DAYS` to `7` (parsed as a positive integer, throw otherwise); pass through optional `INITIAL_USER_USERNAME`, `INITIAL_USER_PASSWORD`, `PORT` (research R5)
- [X] T006 Wire config validation and global validation into src/app.module.ts: `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate })`; add provider `{ provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) }` (research R7)
- [X] T007 [P] Create User schema in src/users/schemas/user.schema.ts with `@Schema({ timestamps: true })`: `username` "required, trimmed, 3–64 chars, unique index"; `passwordHash` "required; argon2id encoded hash (includes salt + params); never selected by default (`select: false`)"; export `User`, `UserDocument`, `UserSchema`
- [X] T008 [P] Create RefreshSession schema in src/auth/schemas/refresh-session.schema.ts with `@Schema({ timestamps: { createdAt: true, updatedAt: false } })`: `userId` ObjectId ref User "required, indexed"; `tokenHash` "required, SHA-256 hex of the opaque token, unique index"; `expiresAt` Date "required; TTL index (`expireAfterSeconds: 0`)"; `usedAt`, `revokedAt` Date default `null`; `replacedBy` ObjectId default `null` (data-model.md)
- [X] T009 Create src/users/users.module.ts registering `MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])`, providing and exporting `UsersService` (empty class stub in src/users/users.service.ts for now); import `UsersModule` in src/app.module.ts
- [X] T010 [P] Unit tests for TokensService (hashToken is deterministic 64-hex; generateRefreshToken returns distinct 43-char base64url strings; signAccessToken payload has `sub`, `username`, `exp - iat = 900`; createRefreshSession returns `{ token, sessionId }` and stores only the hash, never the raw token) in src/auth/tokens.service.spec.ts
- [X] T011 Create `TokensService` in src/auth/tokens.service.ts: `hashToken(token)` → sha256 hex; `generateRefreshToken()` → `crypto.randomBytes(32).toString('base64url')`; `signAccessToken({ id, username })` → `jwtService.signAsync({ sub: id, username })`; `createRefreshSession(userId)` → inserts RefreshSession with `tokenHash` and `expiresAt = now + REFRESH_TOKEN_TTL_DAYS days`, returns `{ token, sessionId }` (raw token only in the return value); `issueTokenPair(user)` → `{ accessToken, refreshToken }` (research R2, R8)
- [X] T012 Update src/auth/auth.module.ts: import `UsersModule`, `MongooseModule.forFeature([RefreshSession])`, `JwtModule.registerAsync({ inject: [ConfigService], useFactory: c => ({ secret: c.get('JWT_ACCESS_SECRET'), signOptions: { expiresIn: c.get('JWT_ACCESS_TTL') } }) })`; provide `TokensService`
- [X] T013 Create e2e harness in test/setup-mongo.ts: `startTestApp()` starts `MongoMemoryServer`, sets `process.env.MONGODB_URI`, `JWT_ACCESS_SECRET` (test value ≥ 32 chars), `INITIAL_USER_USERNAME=admin`, `INITIAL_USER_PASSWORD=Secret123!`, compiles `AppModule`, returns `{ app, connection, stop }`; plus `clearSessions(connection)` helper. Set `testTimeout: 30000` in test/jest-e2e.json
- [X] T014 Replace the hard-coded `admin`/`secret` in-memory store: remove `users`, `accessTokens`, `refreshTokens` Maps and the scrypt `hashPassword` from src/auth/auth.service.ts, inject `UsersService`, `TokensService` and the RefreshSession model, leaving `login`/`refresh`/`logout` throwing `NotImplementedException` until their stories land; delete the obsolete tests in src/auth/auth.service.spec.ts, keeping only a `should be defined` test with mocked providers

**Checkpoint**: `npm run build` and `npm test` pass; app refuses to start without `JWT_ACCESS_SECRET`

---

## Phase 3: User Story 1 - Log in and stay logged in across restarts (Priority: P1) 🎯 MVP

**Goal**: Accounts stored in MongoDB with argon2id hashes; login issues a token pair from persisted data

**Independent Test**: Log in, restart the app against the same database, log in again; inspect `users` and see a `$argon2id$` hash and no plaintext

### Tests for User Story 1 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T015 [P] [US1] Unit tests for UsersService in src/users/users.service.spec.ts: `create` stores a hash starting with `$argon2id$` (never the password); `verifyCredentials` returns the user for the right password and `null` for wrong password and unknown username; `verifyCredentials` calls `argon2.verify` even for an unknown username (dummy hash, research R1); `seedInitialUser` inserts once and does not overwrite an existing user's password on a second call; seeding is skipped if either env var is unset
- [X] T016 [P] [US1] Unit tests for `AuthService.login` in src/auth/auth.service.spec.ts (mock UsersService/TokensService): valid credentials → `issueTokenPair` result; wrong password and unknown user → `UnauthorizedException('Invalid credentials')` with identical message; UsersService throwing (database down) → error propagates and `issueTokenPair` is never called
- [X] T017 [P] [US1] E2E tests for POST /auth/login in test/auth.e2e-spec.ts using test/setup-mongo.ts: 200 with `accessToken` (3 dot-separated parts) and `refreshToken`; 401 identical body for wrong password and unknown user; 400 for `{}`, empty strings, and an extra field `x`; after `app.close()` and a new app on the same Mongo instance, login still returns 200; the `users` document's `passwordHash` starts with `$argon2id$`; 20 sequential logins have p95 < 1000 ms (SC-005)

### Implementation for User Story 1

- [X] T018 [US1] Implement UsersService in src/users/users.service.ts: `create(username, password)` hashes with `argon2.hash(password, { type: argon2.argon2id })`; `findByUsername` with `.select('+passwordHash')`; `verifyCredentials(username, password)` runs `argon2.verify` against the stored hash or a module-level dummy argon2id hash when user is missing, returns user or `null`; `seedInitialUser()` upserts with `$setOnInsert` from `INITIAL_USER_USERNAME`/`INITIAL_USER_PASSWORD`; call it from `onApplicationBootstrap()` (research R1, R9)
- [X] T019 [US1] Create LoginDto in src/auth/dto/login.dto.ts with `@IsString() @IsNotEmpty()` on `username` and `password`
- [X] T020 [US1] Implement `async login(dto)` in src/auth/auth.service.ts: `verifyCredentials` → on `null` throw `UnauthorizedException('Invalid credentials')` → return `tokensService.issueTokenPair(user)`
- [X] T021 [US1] Make `login` async in src/auth/auth.controller.ts (`Promise<TokenPair>`), keeping `@Post('login') @HttpCode(HttpStatus.OK)`

**Checkpoint**: T015–T017 pass; login works against MongoDB and survives restarts

---

## Phase 4: User Story 2 - Self-contained, short-lived access tokens (Priority: P1)

**Goal**: Access tokens are verifiable JWTs that expire after 15 minutes; tampered/expired tokens are rejected

**Independent Test**: Decode a login access token (has `sub`, `username`, `exp - iat = 900`); flip a character → rejected; expired token → rejected

### Tests for User Story 2 ⚠️

- [X] T022 [P] [US2] Unit tests for `TokensService.verifyAccessToken` in src/auth/tokens.service.spec.ts: valid token → payload `{ sub, username }`; token with one altered character → `UnauthorizedException('Invalid or expired access token')`; token signed with another secret → same exception; token with `expiresIn: '1s'` checked after jest fake timers advance 2 s (or signed with past `exp`) → same exception; malformed string → same exception
- [X] T023 [P] [US2] E2E test in test/auth.e2e-spec.ts: decode the login `accessToken` (base64url payload) and assert `sub` equals the admin user's `_id`, `username === 'admin'`, `exp - iat === 900`

### Implementation for User Story 2

- [X] T024 [US2] Implement `verifyAccessToken(token)` in src/auth/tokens.service.ts: `jwtService.verifyAsync(token)`; on any error throw `UnauthorizedException('Invalid or expired access token')` without including the token or error details; return `{ sub, username }`
- [X] T025 [US2] Add `AccessTokenPayload` interface `{ sub: string; username: string }` to src/auth/auth.types.ts and use it in TokensService

**Checkpoint**: T022–T023 pass

---

## Phase 5: User Story 3 - Refresh tokens rotate on every use (Priority: P2)

**Goal**: Each refresh returns a new pair and consumes the old token; reuse revokes all the user's sessions

**Independent Test**: Login → refresh R1 (get R2) → refresh R1 again (401) → refresh R2 (401)

### Tests for User Story 3 ⚠️

- [X] T026 [P] [US3] Unit tests for `AuthService.refresh` in src/auth/auth.service.spec.ts (mock model): active token → new pair and old session gets `usedAt` + `replacedBy`; already-used token → 401 `'Invalid or expired refresh token'` and `updateMany({ userId, revokedAt: null }, { $set: { revokedAt } })` called; unknown, expired and revoked tokens → 401 without bulk revoke; old session found revoked on the re-check after inserting the new session → new session gets `revokedAt`, 401, and `signAccessToken` is never called; model throwing (database down) → error propagates and no tokens are issued
- [X] T027 [P] [US3] E2E tests for POST /auth/refresh in test/auth.e2e-spec.ts: 200 returns both `accessToken` and a different `refreshToken`; reusing R1 → 401; then R2 → 401 (revoked by reuse); two concurrent refreshes with the same token (`Promise.all`) → at most one 200 (both may be 401 if the reuse revoke lands before the winner's re-check), and any refresh token returned by a winner then also gets 401 (all sessions revoked, spec edge case); session with `expiresAt` set in the past directly in Mongo → 401; 400 for `{}` and `{ "refreshToken": "" }`; refresh token from before an app restart still works; `refreshsessions` documents contain a 64-hex `tokenHash` and never the raw token

### Implementation for User Story 3

- [X] T028 [US3] Create RefreshDto in src/auth/dto/refresh.dto.ts with `@IsString() @IsNotEmpty() refreshToken`
- [X] T029 [US3] Implement `async refresh(token)` in src/auth/auth.service.ts per research R4: `findOneAndUpdate({ tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } })`; on match load the user, `createRefreshSession(userId)`, set `replacedBy` on the old session to the new `sessionId`, then re-read the old session: if `revokedAt` is set, set `revokedAt` on the new session and throw 401; only then `signAccessToken` and return the pair. On no match `findOne({ tokenHash })` and if `usedAt` is set revoke all of that user's sessions with `updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } })`; then throw `UnauthorizedException('Invalid or expired refresh token')`
- [X] T030 [US3] Update `refresh` in src/auth/auth.controller.ts to take `@Body() dto: RefreshDto` and return `Promise<TokenPair>` (contract change: response now includes `refreshToken`)

**Checkpoint**: T026–T027 pass; rotation and reuse detection work, including concurrently

---

## Phase 6: User Story 4 - Logout ends the user's sessions (Priority: P2)

**Goal**: Logout with a valid access token revokes all of the user's refresh sessions

**Independent Test**: Login → logout → refresh with that refresh token → 401

### Tests for User Story 4 ⚠️

- [X] T031 [P] [US4] Unit tests for `AuthService.logout` in src/auth/auth.service.spec.ts: valid token → `updateMany({ userId: sub, revokedAt: null }, { $set: { revokedAt } })`; invalid token → `UnauthorizedException` propagated from `verifyAccessToken`; second call with the same token succeeds (idempotent)
- [X] T032 [P] [US4] E2E tests for POST /auth/logout in test/auth.e2e-spec.ts: 200 `{ "message": "Logged out successfully" }`; refresh afterwards → 401; two logins (two sessions) are both revoked by one logout; second logout with same token → 200; tampered token → 401; 400 for `{}` and `{ "accessToken": "" }`

### Implementation for User Story 4

- [X] T033 [US4] Create LogoutDto in src/auth/dto/logout.dto.ts with `@IsString() @IsNotEmpty() accessToken`
- [X] T034 [US4] Implement `async logout(accessToken)` in src/auth/auth.service.ts: `verifyAccessToken` → `updateMany({ userId: sub, revokedAt: null }, { $set: { revokedAt: new Date() } })`
- [X] T035 [US4] Update `logout` in src/auth/auth.controller.ts to take `@Body() dto: LogoutDto`, `await` the service and return `{ message: 'Logged out successfully' }`

**Checkpoint**: All four stories pass their tests

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T036 [P] Update test/app.e2e-spec.ts to use `startTestApp()` from test/setup-mongo.ts so it no longer needs a real `MONGODB_URI`
- [X] T037 [P] Security pass: grep src/ for `console.log`, `Logger` calls and exception messages; confirm no password, token, hash or secret is logged or returned (Principle I, FR-012)
- [X] T038 [P] Document env vars, the initial-user seeding and the refresh contract change in README.md
- [X] T039 Run `npm run lint`, `npm test`, `npm run test:e2e`; fix any failures
- [X] T040 Walk through the manual scenarios in specs/001-persistent-jwt-auth/quickstart.md against a real MongoDB and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: start immediately
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all stories
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational; independent of US1 at unit level, but its e2e test (T023) needs login from US1
- **US3 (Phase 5)**: depends on US1 (needs login to obtain a refresh token)
- **US4 (Phase 6)**: depends on US1 (login) and US2 (`verifyAccessToken`)
- **Polish (Phase 7)**: after all stories

```text
Setup → Foundational → US1 ─┬─▶ US3
                      └ US2 ┴─▶ US4 → Polish
```

### Within Each User Story

- Tests first; confirm they fail
- DTOs/services before controller changes
- Story checkpoint before moving on

### Parallel Opportunities

- Phase 1: T003 alongside T001/T002
- Phase 2: T004, T007, T008, T010 (tests and schemas) in parallel; write each test before its implementation (T004 → T005, T010 → T011)
- US2 can be built in parallel with US1 (different methods/files) once Foundational is done
- US3 and US4 can be built in parallel after US1 + US2
- Within each story, all `[P]` test tasks can be written together

---

## Parallel Example: User Story 1

```bash
Task: "Unit tests for UsersService in src/users/users.service.spec.ts"
Task: "Unit tests for AuthService.login in src/auth/auth.service.spec.ts"
Task: "E2E tests for POST /auth/login in test/auth.e2e-spec.ts"
```

## Parallel Example: User Stories 3 + 4

```bash
Task: "E2E tests for POST /auth/refresh in test/auth.e2e-spec.ts"   # US3
Task: "Create LogoutDto in src/auth/dto/logout.dto.ts"               # US4
```

Note: T016/T026/T031 all edit src/auth/auth.service.spec.ts and T017/T023/T027/T032 all edit
test/auth.e2e-spec.ts; when running stories in parallel, use separate `describe` blocks and merge
carefully.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2
2. Phase 3 (US1): durable accounts, argon2id, login
3. **STOP and VALIDATE** with T017. Note: refresh and logout return 501 until US3/US4, so the
   MVP is not deployable to existing clients on its own

### Incremental Delivery

1. Setup + Foundational
2. US1 → US2 (both P1): login with verified JWTs
3. US3 → refresh with rotation
4. US4 → logout; all three existing routes work again → **first releasable increment**
5. Polish

---

## Notes

- `src/auth/tokens.service.ts` is an addition to the plan's file list: it isolates JWT and
  refresh-token primitives shared by all stories
- Commit after each task or checkpoint
- Constraints from data-model.md are quoted verbatim in T007/T008
