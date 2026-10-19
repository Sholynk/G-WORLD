import type { DatabaseSync } from 'node:sqlite';

// Minimal D1 adapter executes actual SQL, including atomic rollback and triggers.
export function sqliteBinding(sqlite: DatabaseSync): D1Database {
  function prepare(sql: string, params: unknown[] = []) {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      async first() { return sqlite.prepare(sql).get(...params as []) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...params as []) }; },
      async run() {
        const result = sqlite.prepare(sql).run(...params as []);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
  }
  return {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
}
