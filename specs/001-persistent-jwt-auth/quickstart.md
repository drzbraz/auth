# Quickstart: Persistent Auth with Rotating Tokens

Validation guide proving the feature works end to end. Contract details:
[contracts/auth-api.md](./contracts/auth-api.md). Data shapes: [data-model.md](./data-model.md).

## Prerequisites

- Node.js 22, `npm install` done
- A MongoDB URI (Atlas or local) for manual runs; e2e tests need none (in-memory server)
- `.env` with:
  ```
  MONGODB_URI=mongodb+srv://...
  JWT_ACCESS_SECRET=<at least 32 random chars>
  INITIAL_USER_USERNAME=admin
  INITIAL_USER_PASSWORD=<choose one>
  ```

## Automated checks

```bash
npm run lint
npm test            # unit: users + auth services
npm run test:e2e    # e2e: all scenarios below against in-memory MongoDB
```
All must pass.

## Manual scenarios

Start: `npm run start:dev`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Login | `POST /auth/login` with initial user | 200, `accessToken` (3-part JWT) + `refreshToken` |
| 2 | Generic failure | login with wrong password, then with unknown user | both 401, identical `message` |
| 3 | Hash at rest | inspect `users` document in MongoDB | `passwordHash` starts with `$argon2id$`; no plaintext |
| 4 | Survives restart | restart server, `POST /auth/refresh` with token from #1 | 200 with new pair |
| 5 | Rotation | refresh with token R1 → get R2; refresh with R1 again | first 200; second 401 |
| 6 | Reuse revokes all | after #5, refresh with R2 | 401 (revoked by reuse detection) |
| 7 | Logout | login, `POST /auth/logout` with access token, then refresh | logout 200; refresh 401 |
| 8 | Tampered JWT | change one char of access token, logout | 401 |
| 9 | Validation | login with `{}` or extra field `{"username":"a","password":"b","x":1}` | 400 |
| 10 | Missing secret | unset `JWT_ACCESS_SECRET`, start server | process exits with config error |
| 11 | Token at rest | inspect `refreshsessions` | only `tokenHash` (64 hex chars); raw token absent |
