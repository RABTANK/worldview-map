import path from 'node:path';

export type AppConfig = {
  port: number;
  host: string;
  dbPath: string;
  rateLimitPerMin: number;
  snapshotLimit: number;
  conflictDistance: number;
};

function resolveDbPath(value: string): string {
  if (value === ':memory:') return value;
  return path.resolve(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3780),
    host: env.HOST ?? '0.0.0.0',
    dbPath: resolveDbPath(env.WORLDVIEW_DB ?? path.join(process.cwd(), 'data', 'worldview.sqlite')),
    rateLimitPerMin: Math.max(1, Number(env.RATE_LIMIT_PER_MIN ?? 120)),
    snapshotLimit: Math.max(1, Number(env.SNAPSHOT_LIMIT ?? 30)),
    conflictDistance: Math.max(0, Number(env.PLACE_CONFLICT_DISTANCE ?? 8)),
  };
}
