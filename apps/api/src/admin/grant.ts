/**
 * Gives a user the built-in admin role (all permissions).
 *   cd apps/api && yarn admin:grant you@example.com
 * The user must already have an account. Idempotent.
 */
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../database/schema';
import { roles, userRoles, users } from '../database/schema';
import { SUPER_ROLE } from './permissions';

config({ path: ['.env', '../../.env'] });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('usage: yarn admin:grant <email>');
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) throw new Error(`no account for ${email}; sign up first`);
    await db.insert(roles).values({ key: SUPER_ROLE, name: 'Admin' }).onConflictDoNothing();
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, SUPER_ROLE));
    await db.insert(userRoles).values({ userId: user.id, roleId: role.id }).onConflictDoNothing();
    console.log(`${email} now has the ${SUPER_ROLE} role`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
