import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import {
  drizzle,
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Builds a Drizzle client over a postgres.js pool.
 *
 * `max` is left to the caller: migrate scripts want 1, the API wants more, and
 * Testcontainers wants a fresh short-lived client.
 */
export function createDb(connectionString: string, max = 10): Db {
  const client = postgres(connectionString, { max });
  return drizzle(client, { schema });
}

export { schema };
