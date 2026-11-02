import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, DrizzleDB } from '../database/database.module';
import { rolePermissions, roles, userRoles } from '../database/schema';
import { Permission, PERMISSIONS, SUPER_ROLE } from './permissions';

export interface AdminAccess {
  roles: { key: string; name: string }[];
  permissions: Permission[];
}

/** Resolves a user's admin roles and permissions. */
@Injectable()
export class AdminAccessService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  async forUser(userId: string): Promise<AdminAccess> {
    const userRoleRows = await this.db
      .select({ id: roles.id, key: roles.key, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    if (!userRoleRows.length) return { roles: [], permissions: [] };

    const granted = userRoleRows.some((r) => r.key === SUPER_ROLE)
      ? [...PERMISSIONS]
      : (
          await this.db
            .select({ permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(inArray(rolePermissions.roleId, userRoleRows.map((r) => r.id)))
        )
          .map((r) => r.permission)
          .filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    return {
      roles: userRoleRows.map(({ key, name }) => ({ key, name })),
      permissions: PERMISSIONS.filter((p) => granted.includes(p)),
    };
  }
}
