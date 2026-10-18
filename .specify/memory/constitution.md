<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1 (PATCH: clarification)
- Modified principles: I. Security First — constant-time rule clarified to cover in-process
  comparisons; indexed SHA-256 lookup permitted for >=256-bit CSPRNG tokens
- Previous report (1.0.0):
- Version change: (template) → 1.0.0
- Modified principles: placeholders replaced with:
  I. Security First (NON-NEGOTIABLE)
  II. Test-First (NON-NEGOTIABLE)
  III. Modular NestJS Architecture
  IV. Token Lifecycle
  V. Simplicity
- Added sections: Technology & Security Constraints; Development Workflow & Quality Gates
- Removed sections: none
- Deferred TODOs: none
- Known gaps between current code and this constitution (to be closed by future features):
  - AuthService keeps users/tokens in in-memory Maps; must move to MongoDB (Principle IV).
  - Passwords hashed with crypto.scryptSync; must migrate to argon2id (Principle I).
  - Access tokens are opaque random strings; must become signed JWTs (Principle IV).
  - Refresh tokens are not rotated on use and are stored in plain text (Principle IV).
  - LoginDto has no class-validator decorators and no global ValidationPipe exists (Principle III).
  - Password hash comparison uses `!==` instead of a constant-time compare (Principle I).
  - No e2e tests exist for /auth routes (Principle II).
-->

# Auth API Constitution

## Core Principles

### I. Security First (NON-NEGOTIABLE)

- Passwords MUST be hashed with argon2id via the `argon2` package. Plain-text or reversibly
  encrypted passwords MUST NOT be stored anywhere.
- Secret comparisons performed in application code (password hashes, token hashes) MUST be
  constant-time. Looking up a token by its SHA-256 hash through a database index is permitted
  only for tokens with at least 256 bits of entropy from a CSPRNG.
- Passwords, tokens, secrets and raw `Authorization` headers MUST NOT be logged, returned in
  error messages, or included in exception payloads.
- Authentication failures MUST return a generic message (e.g. "Invalid credentials") that does
  not reveal whether the user exists.
- Secrets (JWT signing keys, `MONGODB_URI`) MUST come from configuration (`@nestjs/config` /
  environment) and MUST NOT be committed to the repository.

**Rationale**: This service is the trust boundary for every consumer; a single leak compromises
all of them.

### II. Test-First (NON-NEGOTIABLE)

- Every endpoint MUST have unit tests for its service logic (Jest, `*.spec.ts` next to the
  source) and e2e tests for its HTTP contract (supertest, `test/*.e2e-spec.ts`).
- Tests for a feature MUST be written before or alongside its implementation and MUST be seen
  failing before the implementation makes them pass.
- Every error path (400, 401, 409, etc.) MUST have at least one test asserting status and body.
- `npm test` and `npm run test:e2e` MUST pass before a change is merged.

**Rationale**: Auth bugs are silent until exploited; tests are the only reliable regression net.

### III. Modular NestJS Architecture

- Each domain (e.g. `auth`, `users`) MUST live in its own Nest module under `src/<domain>/` with
  its own controller, service, DTOs (`dto/`) and Mongoose schemas (`schemas/`).
- Controllers MUST stay thin: parse input, call a service, shape the response. Business logic
  MUST live in services.
- All request bodies MUST be typed DTO classes validated with `class-validator`, enforced by a
  global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`.
- Modules MUST interact only through exported providers, never by importing another module's
  internal files.

**Rationale**: Clear boundaries keep the codebase testable and let domains evolve independently.

### IV. Token Lifecycle

- Access tokens MUST be short-lived, signed JWTs (`@nestjs/jwt`) verified statelessly; the
  server MUST NOT need a database lookup to validate one.
- Refresh tokens MUST be stored in MongoDB only as hashes, linked to their user, with an
  expiry date.
- Refresh tokens MUST be rotated on every use: the presented token is invalidated and a new
  pair is issued. Reuse of an already-rotated refresh token MUST revoke all refresh tokens for
  that user.
- Logout MUST revoke the user's refresh token(s). Because access tokens are stateless, their
  lifetime MUST be short enough (default 15 minutes) that revocation via expiry is acceptable.

**Rationale**: Stateless access tokens keep validation cheap; hashed, rotated refresh tokens limit
the damage of a stolen token and make theft detectable.

### V. Simplicity

- New runtime dependencies MUST be justified in the feature's `plan.md` (why the platform or an
  existing dependency is insufficient).
- Unused dependencies MUST be removed.
- Prefer NestJS and Node built-ins and the already-installed stack over new abstractions.
- No speculative features: build only what a spec requires (YAGNI).

**Rationale**: Every dependency in an auth service is attack surface and maintenance cost.

## Technology & Security Constraints

- **Runtime**: Node.js with TypeScript, NestJS 11, Express platform.
- **Persistence**: MongoDB via Mongoose (`@nestjs/mongoose`), connection from `MONGODB_URI`.
- **Auth stack**: `argon2` (hashing), `@nestjs/jwt` + `passport-jwt` (access tokens and guards),
  `class-validator` / `class-transformer` (input validation).
- **Testing**: Jest + ts-jest for unit tests, supertest for e2e tests.
- **Code style**: ESLint + Prettier configuration in the repo is authoritative; `npm run lint`
  MUST pass.
- **API**: JSON over HTTP. Auth routes are grouped under `/auth`. Errors use Nest's standard
  HTTP exceptions.

## Development Workflow & Quality Gates

- Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-clarify` (as needed) →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, one feature per numbered branch.
- Each `plan.md` MUST include a Constitution Check confirming compliance with every principle, or
  documenting a justified, time-boxed exception.
- Before merge: lint, unit tests and e2e tests pass; no secrets in the diff; any new dependency is
  justified per Principle V.
- Code review MUST explicitly check Principles I and IV for any change touching credentials or
  tokens.

## Governance

- This constitution supersedes other project practices. Where code conflicts with it, the code is
  the thing to change, unless the constitution is formally amended.
- **Amendments**: proposed via `/speckit-constitution`, recorded in a commit that updates the
  version and Last Amended date below, with the rationale in the commit message.
- **Versioning**: semantic versioning. MAJOR for removing or redefining a principle, MINOR for
  adding a principle or materially expanding guidance, PATCH for wording and clarifications.
- **Compliance**: `/speckit-plan` and `/speckit-analyze` check plans and tasks against these
  principles; reviewers verify compliance on every PR.

**Version**: 1.0.1 | **Ratified**: 2026-10-18 | **Last Amended**: 2026-10-18
