# Contract: Auth REST API

Base path `/auth`. JSON request and response bodies. Unknown body fields → 400.
Error bodies use Nest's standard shape: `{ "statusCode": number, "message": string | string[], "error": string }`.

## POST /auth/login

Request:
```json
{ "username": "string (non-empty)", "password": "string (non-empty)" }
```

| Status | Body | When |
|--------|------|------|
| 200 | `{ "accessToken": "<JWT>", "refreshToken": "<opaque>" }` | valid credentials |
| 400 | validation error | missing/empty/non-string fields, extra fields |
| 401 | `message: "Invalid credentials"` | unknown user or wrong password (identical response) |

## POST /auth/refresh

Request:
```json
{ "refreshToken": "string (non-empty)" }
```

| Status | Body | When |
|--------|------|------|
| 200 | `{ "accessToken": "<JWT>", "refreshToken": "<new opaque>" }` | active session; old token is now consumed |
| 400 | validation error | missing/empty token |
| 401 | `message: "Invalid or expired refresh token"` | unknown, expired, revoked, or reused token (reuse also revokes all user sessions) |

**Change from current behavior**: response now also includes `refreshToken`. Clients MUST store
and use the new refresh token; the old one stops working.

## POST /auth/logout

Request:
```json
{ "accessToken": "<JWT>" }
```

| Status | Body | When |
|--------|------|------|
| 200 | `{ "message": "Logged out successfully" }` | valid, unexpired access token; all user refresh sessions revoked (idempotent) |
| 400 | validation error | missing/empty token |
| 401 | `message: "Invalid or expired access token"` | bad signature, malformed, or expired |

**Change from current behavior**: a second logout with the same still-valid access token returns
200 instead of 401. The access token itself remains valid until `exp`.

## Access token claims

```json
{ "sub": "<user id>", "username": "string", "iat": 0, "exp": 0 }
```
