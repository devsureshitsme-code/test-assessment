# Task Management API

A small Task Management REST API built with Node.js (ESM), Express 5 and Zod.
Tasks are kept in memory, so data resets when the process restarts.

## Getting started

```bash
npm install
npm start          # http://localhost:3000 (override with PORT=xxxx)
npm test           # Vitest + Supertest
```

| Variable   | Default | Purpose                                                                 |
|------------|---------|-------------------------------------------------------------------------|
| `PORT`     | `3000`  | HTTP port                                                               |
| `NODE_ENV` | —       | Set to `development` to include stack traces in 500 responses. Any other value (including `production`) never exposes them. |

## Project structure

```
src/
  app.js                    # builds the Express app (used by server and tests)
  server.js                 # starts the HTTP server
  routes/task.routes.js     # route definitions + validation wiring
  controllers/              # HTTP request/response handling
  services/task.service.js  # business logic + in-memory store
  validation/               # Zod schemas
  middleware/
    validate.js             # generic Zod request validation
    notFound.js             # 404 for unknown routes
    errorHandler.js         # centralized error responses
  errors/AppError.js        # AppError, ValidationError, NotFoundError
tests/
```

## Task model

| Field         | Type                                  | Notes                         |
|---------------|---------------------------------------|-------------------------------|
| `id`          | string (UUID v4)                      | Server-generated              |
| `title`       | string                                |                               |
| `description` | string \| null                        | `null` if not provided        |
| `priority`    | `"low"` \| `"medium"` \| `"high"` \| null | `null` if not provided    |
| `status`      | string                                | Always `"pending"` on creation |
| `createdAt`   | ISO 8601 string                       | Server-generated              |
| `updatedAt`   | ISO 8601 string                       | Server-generated              |

## Endpoints

Successful responses wrap their payload in `data`.

### `POST /tasks`: create a task

```bash
curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Write docs", "description": "Update the README", "priority": "medium"}'
```

**201 Created** (the `Location` header is set to `/tasks/<id>`)

```json
{
  "data": {
    "id": "4a48179c-efa4-46db-b546-8d6bca43192e",
    "title": "Write docs",
    "description": "Update the README",
    "priority": "medium",
    "status": "pending",
    "createdAt": "2026-10-19T07:16:43.291Z",
    "updatedAt": "2026-10-19T07:16:43.291Z"
  }
}
```

#### Validation rules

| Field         | Rules                                                                                     |
|---------------|-------------------------------------------------------------------------------------------|
| `title`       | **Required.** Must be a string. Leading and trailing whitespace is trimmed; the trimmed value must be 1–100 characters, so empty or whitespace-only titles are rejected. |
| `description` | Optional. Must be a string. It is trimmed and may be at most 1000 characters. An empty string is allowed. |
| `priority`    | Optional. Must be exactly one of `low`, `medium`, `high` (case-sensitive).                |
| other fields  | **Rejected.** Unknown fields, including `id`, `status`, `createdAt` and `updatedAt`, cause a 400. Clients cannot set server-controlled fields. |

The body must be a JSON object sent with `Content-Type: application/json` and must not exceed 100 KB.

### `GET /tasks`: list tasks

```bash
curl http://localhost:3000/tasks
```

**200 OK**: `{ "data": [ { ...task }, ... ] }`

### `GET /tasks/:id`: get one task

```bash
curl http://localhost:3000/tasks/4a48179c-efa4-46db-b546-8d6bca43192e
```

**200 OK**: `{ "data": { ...task } }`

`id` must be a valid UUID. A malformed ID returns **400**; a valid UUID with no matching task returns **404**.

### `GET /health`

**200 OK**: `{ "status": "ok" }`

## Error responses

Every error uses the same shape. The centralized middleware in `src/middleware/errorHandler.js` produces all of them:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "location": "body", "field": "title", "message": "Title must not be empty" },
      { "location": "body", "field": "priority", "message": "Priority must be one of: low, medium, high" }
    ]
  }
}
```

`details` appears only on validation errors and lists **every** invalid field, not just the first. `location` is `body` or `params`. `field` is `null` when the problem concerns the whole body (for example, the body is not a JSON object).

| Status | `code`                   | When                                                         |
|--------|--------------------------|--------------------------------------------------------------|
| 400    | `VALIDATION_ERROR`       | Missing or invalid fields, unknown fields, invalid task ID, missing or non-object body |
| 400    | `INVALID_JSON`           | The request body is not valid JSON                           |
| 404    | `NOT_FOUND`              | The task does not exist, or the route is unknown             |
| 413    | `PAYLOAD_TOO_LARGE`      | The body exceeds 100 KB                                      |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | The body uses an unsupported encoding or charset             |
| 500    | `INTERNAL_SERVER_ERROR`  | Any unexpected error                                         |

Examples:

```bash
# Malformed JSON → 400
curl -X POST http://localhost:3000/tasks -H 'Content-Type: application/json' -d '{"title":'
# {"error":{"code":"INVALID_JSON","message":"Request body contains malformed JSON"}}

# Invalid ID → 400
curl http://localhost:3000/tasks/abc
# {"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"location":"params","field":"id","message":"Task ID must be a valid UUID"}]}}

# Nonexistent task → 404
curl http://localhost:3000/tasks/3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e
# {"error":{"code":"NOT_FOUND","message":"Task with id '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e' not found"}}
```

### What 500 responses do not expose

Unexpected errors always return the generic message `An unexpected error occurred`. The original error message never reaches the client, so stack traces, file paths, environment variables and connection strings stay private. The full error is logged on the server. Stack traces are added to the response body only when `NODE_ENV=development`. The `X-Powered-By` header is disabled.

To add a new client-facing error, throw an `AppError` subclass from a service. The error handler passes on its `statusCode`, `code` and `message`. Route handlers never build error responses themselves.
