# API Specification

## 1. Style
- REST over HTTPS
- JSON request/response
- versioned under `/v1`
- auth via bearer token

## 2. Conventions
- IDs are UUID strings
- timestamps are ISO 8601
- list endpoints support pagination with `page` and `page_size`
- errors return stable machine-readable codes

## 3. Authentication
### POST /v1/auth/register
Create user account.

Request:
```json
{
  "email": "user@example.com",
  "username": "mai",
  "password": "secret"
}
```

Response:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "mai"
  }
}
```

### POST /v1/auth/login
Authenticate and issue token.

### POST /v1/auth/logout
Invalidate session token if server-side sessioning is used.

## 4. Tracks and Lessons
### GET /v1/tracks
Returns published tracks.

### GET /v1/tracks/{track_id}
Returns track details and lessons summary.

### GET /v1/lessons/{lesson_id}
Returns lesson metadata and published version summary.

### GET /v1/lesson-versions/{lesson_version_id}
Returns full published lesson content, associated schema template summary, dataset template summary, and challenges.

## 5. Learning Sessions
### POST /v1/learning-sessions
Create learning session.

Request:
```json
{
  "lesson_version_id": "uuid",
  "challenge_version_id": "uuid"
}
```

Response:
```json
{
  "session": {
    "id": "uuid",
    "status": "provisioning"
  }
}
```

### GET /v1/learning-sessions/{session_id}
Get current session state including sandbox readiness.

### POST /v1/learning-sessions/{session_id}/end
End session explicitly.

## 6. Query Execution
### POST /v1/query-executions
Run query.

Request:
```json
{
  "learning_session_id": "uuid",
  "sql_text": "SELECT * FROM users LIMIT 10;",
  "include_plan": true,
  "plan_mode": "explain_analyze"
}
```

Response:
```json
{
  "execution": {
    "id": "uuid",
    "status": "succeeded",
    "duration_ms": 42,
    "rows_returned": 10,
    "result_preview": {
      "columns": ["id", "name"],
      "rows": [[1, "A"]]
    }
  },
  "plan": {
    "summary": {
      "node_type": "Limit"
    }
  }
}
```

### GET /v1/query-executions/{id}
Get single execution details.

### GET /v1/learning-sessions/{session_id}/query-executions
List query history for session.

## 7. Challenge Attempts
### POST /v1/challenge-attempts
Submit challenge attempt.

Request:
```json
{
  "learning_session_id": "uuid",
  "challenge_version_id": "uuid",
  "query_execution_id": "uuid"
}
```

Response:
```json
{
  "attempt": {
    "id": "uuid",
    "status": "passed",
    "score": 95
  },
  "evaluation": {
    "is_correct": true,
    "correctness_score": 100,
    "performance_score": 90,
    "feedback_text": "Correct result. Consider adding an index to improve scan cost."
  }
}
```

### GET /v1/challenge-attempts/{id}
Get attempt and evaluation.

## 8. Sandbox APIs
### POST /v1/sandboxes/{session_id}/reset
Request sandbox reset.

### GET /v1/sandboxes/{sandbox_id}
Get sandbox status.

## 9. Admin / Content APIs
### POST /v1/admin/tracks
Create track.

### POST /v1/admin/lessons
Create lesson shell.

### POST /v1/admin/lesson-versions
Create draft lesson version.

### POST /v1/admin/lesson-versions/{id}/publish
Publish lesson version.

### POST /v1/admin/challenge-versions/{id}/publish
Publish challenge version.

## 10. Error Model
Example:
```json
{
  "error": {
    "code": "QUERY_BLOCKED",
    "message": "Statement type is not allowed in this environment.",
    "details": {
      "statement_type": "DROP_TABLE"
    }
  }
}
```

## 11. Common Error Codes
- UNAUTHORIZED
- FORBIDDEN
- NOT_FOUND
- VALIDATION_ERROR
- SESSION_NOT_READY
- SANDBOX_NOT_READY
- SANDBOX_PROVISIONING_FAILED
- QUERY_BLOCKED
- QUERY_TIMEOUT
- QUERY_EXECUTION_FAILED
- RATE_LIMITED

## 12. API Versioning
- V1 uses URI versioning
- breaking changes require `/v2`
- additive changes allowed in V1 with backward compatibility
