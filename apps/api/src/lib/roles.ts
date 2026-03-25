export const ADMIN_ROLE_NAME = 'admin';
export const DEFAULT_USER_ROLE_NAME = 'learner';
export const CONTRIBUTOR_ROLE_NAME = 'contributor';

export function toStoredRoleName(role: string): string {
  return role === ADMIN_ROLE_NAME ? ADMIN_ROLE_NAME : DEFAULT_USER_ROLE_NAME;
}
