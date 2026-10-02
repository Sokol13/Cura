import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ensureUserDirectories, type UserPaths } from './paths.js';
import * as schema from './schema.js';

export const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../drizzle/', import.meta.url),
);

export interface AppDatabase {
  database: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close: () => void;
}

export function openDatabase(paths: UserPaths): AppDatabase {
  ensureUserDirectories(paths);
  const sqlite = new Database(join(paths.data, 'cura.sqlite'));

  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const database = drizzle(sqlite, { schema });
    migrate(database, { migrationsFolder: MIGRATIONS_ROOT });
    return {
      database,
      sqlite,
      close: () => {
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
