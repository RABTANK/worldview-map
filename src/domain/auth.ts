import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { apiKeys } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { Actor, PublicKey, Scope } from '../shared/types.js';
import { AppError } from './errors.js';
import { newId, normalizeName, normalizeScopes, nowIso } from './validate.js';

export type DB = BetterSQLite3Database<typeof schema>;

export function hashKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hasScope(actor: Actor, scope: Scope): boolean {
  if (actor.scopes.includes('admin')) return true;
  return actor.scopes.includes(scope);
}

type KeyRow = typeof apiKeys.$inferSelect;

function toPublic(row: KeyRow): PublicKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: JSON.parse(row.scopes) as Scope[],
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export class KeyService {
  constructor(private db: DB) {}

  create(input: { name: string; scopes: string[] }): { token: string; key: PublicKey } {
    const name = normalizeName(input.name);
    const scopes = normalizeScopes(input.scopes);
    const token = `wm_${randomBytes(32).toString('base64url')}`;
    const row: KeyRow = {
      id: newId(),
      name,
      keyPrefix: token.slice(0, 11),
      keyHash: hashKey(token),
      scopes: JSON.stringify(scopes),
      createdAt: nowIso(),
      revokedAt: null,
    };
    this.db.insert(apiKeys).values(row).run();
    return { token, key: toPublic(row) };
  }

  list(): PublicKey[] {
    return this.db.select().from(apiKeys).all().map(toPublic);
  }

  revoke(id: string): PublicKey {
    const row = this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'API Key 不存在');
    if (!row.revokedAt) {
      this.db.update(apiKeys).set({ revokedAt: nowIso() }).where(eq(apiKeys.id, id)).run();
    }
    const next = this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
    return toPublic(next ?? row);
  }

  authenticate(token: string): Actor | null {
    if (!token || token.length > 200) return null;
    const digest = hashKey(token);
    const row = this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, digest)).get();
    if (!row || row.revokedAt) return null;
    const expected = Buffer.from(row.keyHash, 'hex');
    const actual = Buffer.from(digest, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return {
      keyId: row.id,
      name: row.name,
      scopes: JSON.parse(row.scopes) as Scope[],
    };
  }
}
