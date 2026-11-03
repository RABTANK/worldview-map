import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/open.js';
import { runMigrations } from './db/migrate.js';
import * as schema from './db/schema.js';
import { KeyService, type DB } from './domain/auth.js';
import { WorldService } from './domain/world.js';

export type Runtime = {
  sqlite: Database.Database;
  db: DB;
  config: AppConfig;
  world: WorldService;
  keys: KeyService;
};

export function createRuntime(overrides: Partial<AppConfig> = {}): Runtime {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  if (config.dbPath !== ':memory:') config.dbPath = path.resolve(config.dbPath);
  const sqlite = openDatabase(config.dbPath);
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const world = new WorldService(sqlite, db, {
    snapshotLimit: config.snapshotLimit,
    conflictDistance: config.conflictDistance,
  });
  const keys = new KeyService(db);
  return { sqlite, db, config, world, keys };
}
