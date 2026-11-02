import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openDatabase } from './open.js';
import { loadConfig } from '../config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function migrationsFolder(): string {
  return path.join(root, 'drizzle');
}

export function runMigrations(sqlite: Database.Database): void {
  migrate(drizzle(sqlite), { migrationsFolder: migrationsFolder() });
}

const invoked = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (invoked) {
  const sqlite = openDatabase(loadConfig().dbPath);
  runMigrations(sqlite);
  sqlite.close();
  console.log('migrations applied');
}
