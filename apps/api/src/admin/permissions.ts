/** Every admin permission. Contract: docs/api/admin.md. Add new ones here and in the doc. */
export const PERMISSIONS = [
  'analytics.read',
  'llm.read',
  'users.read',
  'users.write',
  'users.delete',
  'conversations.read',
  'conversations.flag',
  'content.read',
  'content.write',
  'audit.read',
  'team.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The built-in role that always has every permission, so new permissions need no migration. */
export const SUPER_ROLE = 'admin';
