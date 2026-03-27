import { ApiCode } from '@sqlcraft/types';

export function success<T>(data: T, message = 'Success', code: ApiCode = ApiCode.SUCCESS) {
  return { success: true, code, message, data };
}

export function created<T>(data: T, message = 'Created successfully') {
  return { success: true, code: ApiCode.CREATED, message, data };
}

export function error(code: string, message: string, data: unknown = null) {
  return { success: false, code, message, data };
}

export const MESSAGES = {
  // Auth
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logged out successfully',
  REGISTER_SUCCESS: 'Account created successfully',
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOKEN_EXPIRED: 'Token has expired',
  TOKEN_INVALID: 'Invalid token',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have permission to access this resource',

  // Common
  NOT_FOUND: 'Resource not found',
  VALIDATION_ERROR: 'Validation failed',
  ALREADY_EXISTS: 'Resource already exists',

  // Tracks/Lessons
  TRACKS_RETRIEVED: 'Tracks retrieved successfully',
  TRACK_RETRIEVED: 'Track retrieved successfully',
  TRACK_CREATED: 'Track created successfully',
  LESSONS_RETRIEVED: 'Lessons retrieved successfully',
  LESSON_RETRIEVED: 'Lesson retrieved successfully',
  LESSON_VERSION_RETRIEVED: 'Lesson version retrieved successfully',

  // Sessions
  SESSION_CREATED: 'Learning session created',
  SESSION_RETRIEVED: 'Session retrieved successfully',
  SESSION_ENDED: 'Session ended successfully',
  SESSION_HEARTBEAT: 'Session activity refreshed',
  SESSION_NOT_READY: 'Session is not ready yet',

  // Query
  QUERY_SUBMITTED: 'Query submitted successfully',
  QUERY_RETRIEVED: 'Query execution retrieved',
  QUERY_HISTORY_RETRIEVED: 'Query history retrieved',
  QUERY_BLOCKED: 'Statement type is not allowed in this environment',
  QUERY_TIMEOUT: 'Query execution timed out',
  QUERY_FAILED: 'Query execution failed',

  // Sandbox
  SANDBOX_RETRIEVED: 'Sandbox status retrieved',
  SANDBOX_RESET_REQUESTED: 'Sandbox reset requested',
  SANDBOX_NOT_READY: 'Sandbox is not ready',

  // Challenges
  CHALLENGE_VERSION_RETRIEVED: 'Challenge version retrieved successfully',
  ATTEMPT_SUBMITTED: 'Challenge attempt submitted',
  ATTEMPT_RETRIEVED: 'Attempt retrieved successfully',
  ATTEMPTS_RETRIEVED: 'Challenge attempts retrieved successfully',
  LEADERBOARD_RETRIEVED: 'Challenge leaderboard retrieved successfully',

  // Admin
  CONTENT_PUBLISHED: 'Content published successfully',

  // Users
  USER_RETRIEVED: 'User retrieved successfully',
  USERS_RETRIEVED: 'Users retrieved successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
};
