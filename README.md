# Task Management API

A small Task Management REST API built with Node.js (ESM), Express 5 and Zod.
Tasks are kept in memory, so data resets when the process restarts.

## Getting started

```bash
npm install
npm start          # http://localhost:3000 (override with PORT=xxxx)
npm test           # Vitest + Supertest
```

CI (`.github/workflows/test.yml`) runs `npm ci && npm test` on Node 22 and 24 for every pull request and for every push to `main`.

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
  domain/taskStatus.js      # task status state machine (transition rules)
  domain/taskQuery.js       # pure filter / sort / paginate functions for listing
  validation/               # Zod schemas
  middleware/
    validate.js             # generic Zod request validation
    notFound.js             # 404 for unknown routes
    errorHandler.js         # centralized error responses
  errors/AppError.js        # AppError, ValidationError, NotFoundError, ConflictError
tests/
```

## Task model

| Field         | Type                                  | Notes                         |
|---------------|---------------------------------------|-------------------------------|
| `id`          | string (UUID v4)                      | Server-generated              |
| `title`       | string                                |                               |
| `description` | string \| null                        | `null` if not provided        |
| `priority`    | `"low"` \| `"medium"` \| `"high"` \| null | `null` if not provided    |
| `status`      | `"pending"` \| `"in_progress"` \| `"completed"` | `"pending"` on creation. Change it only through `PATCH /api/tasks/:id/status` |
| `createdAt`   | ISO 8601 string                       | Server-generated              |
| `updatedAt`   | ISO 8601 string                       | Server-generated. Changes on every successful update |
| `completedAt` | ISO 8601 string \| null               | Set when the task becomes `completed`; `null` otherwise. Never overwritten |

## Endpoints

All task endpoints are served under `/api/tasks`. The original `/tasks` prefix still works and points to the same endpoints and data. Successful responses wrap their payload in `data`.

### `POST /api/tasks`: create a task

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Write docs", "description": "Update the README", "priority": "medium"}'
```

**201 Created** (the `Location` header is set to `/api/tasks/<id>`)

```json
{
  "data": {
    "id": "4a48179c-efa4-46db-b546-8d6bca43192e",
    "title": "Write docs",
    "description": "Update the README",
    "priority": "medium",
    "status": "pending",
    "createdAt": "2026-10-19T07:16:43.291Z",
    "updatedAt": "2026-10-19T07:16:43.291Z",
    "completedAt": null
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

### `GET /api/tasks`: list tasks

Returns one page of tasks. You can filter by status and priority and sort by an allowlisted field.

| Parameter  | Type / allowed values                                                       | Default     |
|------------|-----------------------------------------------------------------------------|-------------|
| `status`   | `pending`, `in_progress`, `completed`                                       | (all)       |
| `priority` | `low`, `medium`, `high`                                                     | (all)       |
| `page`     | positive integer (`1`, `2`, …)                                              | `1`         |
| `limit`    | positive integer, at most `100`                                             | `10`        |
| `sortBy`   | `createdAt`, `updatedAt`, `completedAt`, `title`, `priority`, `status`      | `createdAt` |
| `order`    | `asc`, `desc`                                                               | `asc`       |

**Example queries**

```bash
# First 10 tasks, oldest first
curl 'http://localhost:3000/api/tasks'

# Page 2, 5 per page
curl 'http://localhost:3000/api/tasks?page=2&limit=5'

# High-priority tasks that are still pending
curl 'http://localhost:3000/api/tasks?status=pending&priority=high'

# Most important first (high → medium → low → no priority)
curl 'http://localhost:3000/api/tasks?sortBy=priority&order=desc'

# Most recently completed tasks
curl 'http://localhost:3000/api/tasks?status=completed&sortBy=completedAt&order=desc&limit=20'
```

**200 OK**

```json
{
  "data": [ { "id": "…", "title": "Review PR", "priority": "high", "status": "pending", "…": "…" } ],
  "pagination": { "page": 1, "limit": 10, "totalItems": 1, "totalPages": 1 }
}
```

**How the parameters combine**

- **Filters first, then sort, then paginate.** `totalItems` and `totalPages` count the *filtered* tasks, not the whole collection. Multiple filters combine with AND.
- **Pages never overlap.** Page `n` holds items `(n-1)·limit + 1` through `n·limit` of the sorted result, and the last page may be shorter than `limit`.
- **Out-of-range pages.** A `page` beyond `totalPages` returns `200` with `"data": []` and accurate totals. An empty result reports `totalItems: 0, totalPages: 0`.
- **Sort order.**
  - `title` ignores case and orders numbers naturally (`Task 2` before `Task 10`).
  - `priority` sorts by rank (`low < medium < high`), not alphabetically.
  - `status` follows the lifecycle (`pending < in_progress < completed`).
- **Missing values** (a task with no `priority`, or with no `completedAt` yet) always sort **last**, whichever direction you choose.
- **Sorting is deterministic.** Ties are broken by `createdAt` and then by creation order, both in the requested direction. Repeating the same request returns the same page, and pages stay consistent with one another.

**Validation (400 `VALIDATION_ERROR`, `location: "query"`)**

| Input                                                    | Example                         |
|----------------------------------------------------------|---------------------------------|
| `page` or `limit` that is not a plain positive integer   | `page=0`, `limit=-5`, `page=1.5`, `page=1e2`, `page=01`, `limit=` |
| `limit` greater than 100                                 | `limit=101` → `limit must not exceed 100` |
| a value outside the allowed list (case-sensitive)        | `status=done`, `priority=urgent`, `order=DESC` |
| a sort field that isn't on the allowlist                 | `sortBy=id`, `sortBy=description`, `sortBy=__proto__` |
| a parameter given more than once                         | `status=pending&status=completed` |
| an unknown parameter                                     | `search=x`, `offset=10` → `Unknown query parameter(s): …` |

Every invalid parameter is reported in a single response:

```bash
curl 'http://localhost:3000/api/tasks?limit=500&sortBy=id'
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "location": "query", "field": "limit", "message": "limit must not exceed 100" },
      { "location": "query", "field": "sortBy", "message": "sortBy must be one of: createdAt, updatedAt, completedAt, title, priority, status" }
    ]
  }
}
```

### `GET /api/tasks/:id`: get one task

```bash
curl http://localhost:3000/api/tasks/4a48179c-efa4-46db-b546-8d6bca43192e
```

**200 OK**: `{ "data": { ...task } }`

`id` must be a valid UUID. A malformed ID returns **400**; a valid UUID with no matching task returns **404**.

### `PATCH /api/tasks/:id`: update task details

Updates any combination of `title`, `description` and `priority`. Fields you leave out stay as they are. This endpoint **never** changes `status` or `completedAt`, so you can edit a completed task without losing its completion time.

```bash
curl -X PATCH http://localhost:3000/api/tasks/4a48179c-efa4-46db-b546-8d6bca43192e \
  -H 'Content-Type: application/json' \
  -d '{"title": "Write better docs"}'
```

**200 OK**: `{ "data": { ...updated task } }`

- Each field follows the same validation rules as `POST /api/tasks`.
- You must provide at least one field.
- Unknown fields are rejected with a 400. This includes `status`, and the error message points you to the status endpoint below.
- If any field is invalid, nothing is changed.

### `PATCH /api/tasks/:id/status`: change task status

```bash
curl -X PATCH http://localhost:3000/api/tasks/4a48179c-efa4-46db-b546-8d6bca43192e/status \
  -H 'Content-Type: application/json' \
  -d '{"status": "in_progress"}'
```

**200 OK**: `{ "data": { ...task with new status } }`

The body must be exactly `{ "status": "<pending|in_progress|completed>" }`.

### `GET /health`

**200 OK**: `{ "status": "ok" }`

## Task lifecycle

```
            ┌──────────────┐
            ▼              │
 ┌─────────┐   ┌─────────────┐   ┌───────────┐
 │ pending │──▶│ in_progress │──▶│ completed │  (terminal)
 └─────────┘   └─────────────┘   └───────────┘
```

| From          | Allowed next status       |
|---------------|---------------------------|
| `pending`     | `in_progress`             |
| `in_progress` | `completed`, `pending`    |
| `completed`   | none (terminal)           |

Every other change is rejected, including:

- skipping `in_progress` (`pending → completed`)
- setting a task to the status it already has (for example, completing a task that is already completed)
- moving a completed task to any status

The rules live in one place, `src/domain/taskStatus.js`. Every status change in the service goes through `assertTransition()`.

**`completedAt` rules**

- It is `null` when a task is created and stays `null` while the task moves between `pending` and `in_progress`.
- It is set to the time of the move into `completed`, the same value as `updatedAt` in that response.
- Because `completed` is terminal, `completedAt` is never overwritten. Repeated completion requests return 409 and leave the original timestamp alone. Detail edits through `PATCH /api/tasks/:id` don't touch it either.

**Updates are all-or-nothing.** The service builds the complete updated task and stores it only after every check passes. A rejected request (400, 404 or 409) leaves the task exactly as it was, including `updatedAt` and `completedAt`.

**Example: an invalid transition → 409**

```bash
curl -X PATCH http://localhost:3000/api/tasks/<pending-task-id>/status \
  -H 'Content-Type: application/json' -d '{"status": "completed"}'
```

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot transition task from 'pending' to 'completed'",
    "details": {
      "currentStatus": "pending",
      "requestedStatus": "completed",
      "allowedTransitions": ["in_progress"]
    }
  }
}
```

**Example: completing a task that is already completed → 409**

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot change status of a completed task; 'completed' is a terminal status",
    "details": { "currentStatus": "completed", "requestedStatus": "completed", "allowedTransitions": [] }
  }
}
```

**Example: an unsupported status → 400**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "location": "body", "field": "status", "message": "Status must be one of: pending, in_progress, completed" }
    ]
  }
}
```

Checks run in this order: task ID and body validation (**400**), then whether the task exists (**404**), then the transition rules (**409**).

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

On validation errors, `details` is an array that lists **every** invalid field, not just the first. `location` is `body`, `params` or `query`. `field` is `null` when the problem concerns the whole body (for example, the body is not a JSON object). On `INVALID_STATUS_TRANSITION` errors, `details` is an object describing the conflict (see [Task lifecycle](#task-lifecycle)). Other errors have no `details`.

| Status | `code`                   | When                                                         |
|--------|--------------------------|--------------------------------------------------------------|
| 400    | `VALIDATION_ERROR`       | Missing or invalid fields, unknown fields, invalid task ID, missing or non-object body, invalid or unknown query parameters |
| 400    | `INVALID_JSON`           | The request body is not valid JSON                           |
| 404    | `NOT_FOUND`              | The task does not exist, or the route is unknown             |
| 409    | `INVALID_STATUS_TRANSITION` | The requested status change is not allowed from the task's current status |
| 413    | `PAYLOAD_TOO_LARGE`      | The body exceeds 100 KB                                      |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | The body uses an unsupported encoding or charset             |
| 500    | `INTERNAL_SERVER_ERROR`  | Any unexpected error                                         |

Examples:

```bash
# Malformed JSON → 400
curl -X POST http://localhost:3000/api/tasks -H 'Content-Type: application/json' -d '{"title":'
# {"error":{"code":"INVALID_JSON","message":"Request body contains malformed JSON"}}

# Invalid ID → 400
curl http://localhost:3000/api/tasks/abc
# {"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"location":"params","field":"id","message":"Task ID must be a valid UUID"}]}}

# Nonexistent task → 404
curl http://localhost:3000/api/tasks/3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e
# {"error":{"code":"NOT_FOUND","message":"Task with id '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e' not found"}}
```

### What 500 responses do not expose

Unexpected errors always return the generic message `An unexpected error occurred`. The original error message never reaches the client, so stack traces, file paths, environment variables and connection strings stay private. The full error is logged on the server. Stack traces are added to the response body only when `NODE_ENV=development`. The `X-Powered-By` header is disabled.

To add a new client-facing error, throw an `AppError` subclass from a service. The error handler passes on its `statusCode`, `code` and `message`. Route handlers never build error responses themselves.
