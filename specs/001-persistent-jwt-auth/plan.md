# Implementation Plan: Persistent Auth with Rotating Tokens

**Branch**: `001-persistent-jwt-auth` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-persistent-jwt-auth/spec.md`

## Summary

Replace the in-memory `AuthService` with MongoDB-backed users and refresh sessions. Passwords are
hashed with argon2id, access tokens become 15-minute HS256 JWTs signed with `JWT_ACCESS_SECRET`,
and refresh tokens stay opaque random strings stored only as SHA-256 hashes with a 7-day expiry.
Each refresh atomically consumes the presented session and issues a new pair; presenting an
already-consumed token revokes every session of that user. A new `users` module owns accounts
and seeds one initial user from configuration. The `/auth/login`, `/auth/refresh` and
`/auth/logout` routes keep their shape; refresh additionally returns `refreshToken`.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node.js 22

**Primary Dependencies**: NestJS 11, `@nestjs/mongoose` + Mongoose 9, `@nestjs/jwt`, `argon2`,
`class-validator` / `class-transformer`, `@nestjs/config` (all already in `package.json`)

**Storage**: MongoDB (Atlas in dev, via `MONGODB_URI`); collections `users`, `refreshsessions`

**Testing**: Jest + ts-jest (unit), supertest (e2e), `mongodb-memory-server` for self-contained
e2e runs (new devDependency, see research R6)

**Target Platform**: Linux/macOS Node server

**Project Type**: Web service (REST API)

**Performance Goals**: login p95 < 1 s (argon2 dominates, ~50–100 ms with default params);
refresh/logout p95 < 100 ms

**Constraints**: no plaintext passwords or tokens stored or logged; refresh rotation must be safe
under concurrent requests; service must not start without `JWT_ACCESS_SECRET` and `MONGODB_URI`

**Scale/Scope**: small, single-instance service; thousands of users; 2 modules, 3 endpoints

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-design | Post-design |
|-----------|------|------------|-------------|
| I. Security First | argon2id hashing; constant-time compares; no secrets in logs/errors; generic auth errors; secrets from config | PASS | PASS – argon2 `verify` is constant-time; refresh lookup is by SHA-256 hash of a 256-bit token, permitted by constitution v1.0.1 (R3); config validated at boot (R5) |
| II. Test-First | unit + e2e for every endpoint and error path; tests written first | PASS | PASS – e2e for all 3 routes incl. rotation/reuse; quickstart lists scenarios |
| III. Modular NestJS | domain modules, thin controllers, DTOs + global `ValidationPipe` | PASS | PASS – `users` + `auth` modules; `APP_PIPE` with whitelist (R7) |
| IV. Token Lifecycle | stateless JWT access; hashed, expiring, rotated refresh; reuse → revoke all; logout revokes | PASS | PASS – data-model state machine; atomic consume (R4) |
| V. Simplicity | new deps justified; unused deps removed | PASS with notes | PASS with notes – see Complexity Tracking |

## Project Structure

### Documentation (this feature)

```text
specs/001-persistent-jwt-auth/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── auth-api.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── main.ts                       # unchanged
├── app.module.ts                 # + config validation, APP_PIPE, UsersModule
├── config/
│   └── env.validation.ts         # validate required env at boot
├── users/
│   ├── users.module.ts           # exports UsersService
│   ├── users.service.ts          # findByUsername, create, seed initial user
│   ├── users.service.spec.ts
│   └── schemas/user.schema.ts
└── auth/
    ├── auth.module.ts            # imports UsersModule, JwtModule, RefreshSession model
    ├── auth.controller.ts        # same routes, DTO-typed bodies
    ├── auth.service.ts           # login / refresh / logout over Mongo
    ├── auth.service.spec.ts      # rewritten against mocked models
    ├── auth.types.ts
    ├── dto/{login,refresh,logout}.dto.ts
    └── schemas/refresh-session.schema.ts

test/
├── auth.e2e-spec.ts              # login/refresh/logout incl. rotation & reuse
├── setup-mongo.ts                # mongodb-memory-server bootstrapping
└── jest-e2e.json
```

**Structure Decision**: Keep the existing single NestJS project. Add a `users` domain module
(Principle III) alongside `auth`; schemas live under each module's `schemas/` folder.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| New devDependency `mongodb-memory-server` | e2e tests need a real MongoDB to exercise atomic rotation and TTL behavior without depending on Atlas or Docker | Mocking Mongo in e2e cannot verify atomic `findOneAndUpdate` semantics; requiring a shared Atlas DB makes tests non-hermetic |
| `passport`, `@nestjs/passport`, `passport-jwt` remain unused by this feature | A protected-route guard (`/auth/me`) is the next planned feature and will use them | Removing then re-adding churns the lockfile. **Time box**: removed by 2026-11-30 unless the `/auth/me` guard feature has merged (Principle V) |
| `JWT_REFRESH_SECRET` in `.env.example` becomes unused | Refresh tokens are opaque random values, not JWTs (R2) | Remove it from `.env.example` in this feature |
