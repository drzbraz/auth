# Feature Specification: Persistent Auth with Rotating Tokens

**Feature Branch**: `001-persistent-jwt-auth`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Persist users and refresh tokens in MongoDB, hash passwords with argon2id,
issue JWT access tokens, and rotate refresh tokens on every use. Existing login/refresh/logout
routes keep working."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log in and stay logged in across restarts (Priority: P1)

A user signs in with their username and password and receives an access token and a refresh
token. User accounts and active sessions are stored durably, so restarting or redeploying the
service does not log anyone out or lose accounts.

**Why this priority**: Today accounts and sessions live only in memory and vanish on restart.
Durable accounts are the foundation every other story depends on.

**Independent Test**: Log in, restart the service, then use the refresh token: it still works
and the account still exists.

**Acceptance Scenarios**:

1. **Given** a stored user account, **When** the user logs in with correct credentials,
   **Then** they receive an access token and a refresh token (same response shape as today).
2. **Given** a stored user account, **When** the user logs in with a wrong password or an
   unknown username, **Then** the request is rejected as unauthorized with the same generic
   message in both cases.
3. **Given** a user who logged in, **When** the service restarts, **Then** their refresh token
   is still accepted.
4. **Given** stored accounts, **When** anyone inspects the stored data, **Then** no password
   appears in readable or reversible form.

---

### User Story 2 - Self-contained, short-lived access tokens (Priority: P1)

Access tokens carry the user's identity and an expiry, are signed by the service, and can be
verified without looking anything up. They expire after a short period.

**Why this priority**: Consumers of this service need a cheap, standard way to verify who a
caller is; opaque in-memory tokens cannot be verified by anyone else and do not expire.

**Independent Test**: Log in, decode the access token, confirm it identifies the user and has
an expiry; tamper with it and confirm it is rejected; wait past expiry and confirm rejection.

**Acceptance Scenarios**:

1. **Given** a successful login, **When** the access token is inspected, **Then** it identifies
   the user and states an expiry 15 minutes after issue.
2. **Given** an access token with a modified payload or signature, **When** it is presented,
   **Then** it is rejected as unauthorized.
3. **Given** an expired access token, **When** it is presented, **Then** it is rejected as
   unauthorized.

---

### User Story 3 - Refresh tokens rotate on every use (Priority: P2)

When a client exchanges a refresh token, it receives a new access token **and** a new refresh
token; the old refresh token stops working immediately. If an old (already used) refresh token
is ever presented again, all of that user's sessions are revoked, because this indicates the
token was stolen.

**Why this priority**: Limits the damage of a leaked refresh token and makes theft detectable.
Depends on Story 1's durable session storage.

**Independent Test**: Log in, refresh once (get pair B), try refresh with the original token
(rejected), then try pair B's refresh token (also rejected, since reuse revoked everything).

**Acceptance Scenarios**:

1. **Given** a valid refresh token, **When** it is exchanged, **Then** the response contains a
   new access token and a new refresh token, and the presented refresh token is invalidated.
2. **Given** a refresh token that was already exchanged, **When** it is presented again,
   **Then** the request is rejected as unauthorized and every active refresh token of that user
   is revoked.
3. **Given** a refresh token older than its 7-day lifetime, **When** it is presented, **Then**
   it is rejected as unauthorized.
4. **Given** an empty or missing refresh token, **When** refresh is requested, **Then** the
   request is rejected as a bad request.

---

### User Story 4 - Logout ends the user's sessions (Priority: P2)

A logged-in user logs out by presenting their access token. All of their refresh tokens are
revoked, so no new access tokens can be obtained.

**Why this priority**: Users and clients need a reliable way to end sessions; it keeps the
existing logout route meaningful under the new token model.

**Independent Test**: Log in, log out, then try to refresh: rejected.

**Acceptance Scenarios**:

1. **Given** a valid access token, **When** the user logs out, **Then** the response confirms
   logout and all of that user's refresh tokens are revoked.
2. **Given** an invalid, tampered or expired access token, **When** logout is requested,
   **Then** the request is rejected as unauthorized.
3. **Given** an empty or missing access token, **When** logout is requested, **Then** the
   request is rejected as a bad request.

---

### Edge Cases

- A refresh token is used twice concurrently: at most one request succeeds; the other is treated
  as reuse and all of the user's sessions are revoked, including the one just issued. Clients
  MUST serialize refresh calls.
- The data store is unavailable: login/refresh/logout fail with a server error and never fall
  back to issuing tokens without recording the session.
- The token signing secret is missing at startup: the service refuses to start.
- An access token issued before logout is presented after logout: it remains valid until its
  15-minute expiry (accepted trade-off of self-contained tokens).
- Logout is called twice with the same still-valid access token: the second call also succeeds
  (idempotent), since there is nothing left to revoke.
- Request bodies with missing, wrongly typed or unexpected fields are rejected as bad requests.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store user accounts durably so they survive service restarts.
- **FR-002**: System MUST store passwords only as salted, memory-hard one-way hashes
  (argon2id per the constitution).
- **FR-003**: System MUST authenticate users by username and password and respond to failures
  with one generic "invalid credentials" message regardless of the cause.
- **FR-004**: System MUST issue, on successful login, a signed, self-contained access token
  identifying the user and expiring 15 minutes after issue, plus a refresh token.
- **FR-005**: System MUST reject access tokens that are expired, tampered with, or not signed by
  the service.
- **FR-006**: System MUST store refresh tokens durably, only in hashed form, linked to their user,
  with a 7-day expiry.
- **FR-007**: On refresh, System MUST invalidate the presented refresh token and return a new
  access token and a new refresh token.
- **FR-008**: System MUST detect reuse of an already-exchanged refresh token, reject it, and
  revoke all active refresh tokens of that user.
- **FR-009**: On logout with a valid access token, System MUST revoke all refresh tokens of the
  token's user.
- **FR-010**: The existing login, refresh and logout routes MUST keep their paths, methods,
  request field names and success status codes. The only response change is that refresh
  additionally returns a refresh token.
- **FR-011**: System MUST validate all request bodies and reject missing, malformed or
  unexpected fields with a bad-request response.
- **FR-012**: System MUST NOT log or return passwords, tokens or secrets.
- **FR-013**: System MUST provide an initial user account, configured outside the code, created
  at startup only if no account with that username exists.

### Key Entities

- **User**: A person who can sign in. Unique username, password hash, creation timestamp.
- **Refresh Session**: A refresh token issued to a user. Token hash, owning user, expiry,
  whether it has been used/revoked, and which session replaced it (to detect reuse).
- **Access Token**: Not stored. A signed statement of user identity with issue and expiry times.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of accounts and unexpired, unrevoked sessions remain usable after a service
  restart.
- **SC-002**: 0 passwords or raw refresh tokens are recoverable from stored data or logs.
- **SC-003**: 100% of reused refresh tokens are rejected and cause revocation of all that user's
  sessions.
- **SC-004**: Existing clients of login, refresh and logout continue to work without changes to
  their requests (verified by end-to-end tests covering all three routes).
- **SC-005**: Login completes in under 1 second for 95% of requests under normal load.
- **SC-006**: Access tokens are rejected within 1 second after their 15-minute expiry.

## Assumptions

- Storage (MongoDB), hashing (argon2id) and token format (JWT) are fixed by the project
  constitution and the user's description, so they are constraints, not design choices.
- User registration, password reset and account management are out of scope; accounts come from
  the configured initial user (FR-013) until a registration feature is specified.
- The current demo account (`admin` / `secret`) is replaced by the configured initial user.
  Accounts and sessions held in memory today are not migrated.
- Logout revokes **all** of the user's sessions (matching today's behavior), not only the
  current device.
- Token lifetimes default to 15 minutes (access) and 7 days (refresh) and are configurable.
- The existing unit test expecting a second logout with the same access token to fail no longer
  applies (see Edge Cases) and will be updated.
- A protected-route guard (e.g. `GET /auth/me`) is out of scope; this feature only covers issuing,
  refreshing and revoking tokens.
