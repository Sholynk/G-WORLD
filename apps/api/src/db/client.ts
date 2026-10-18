/**
 * Sholynk Tech — D1 access layer.
 *
 * Every query in the application goes through `Db`, which:
 *   - always uses prepared statements with bound parameters (no string
 *     concatenation, so SQL injection has no entry point)
 *   - takes the SQL as the first argument, so a query is readable and greppable
 *     at the call site inside a repository
 *   - normalises D1 result types and reports affected-row counts
 *   - logs slow statements together with the request id
 *
 * Repositories receive a `Db` instance; route handlers never touch `env.DB`
 * directly, which keeps all SQL in one reviewable directory.
 */

export type SqlValue = string | number | boolean | null | Uint8Array;
/** Bind values. Mutable so callers can build the list incrementally. */
export type SqlParams = SqlValue[];

export interface StatementResult {
  success: boolean;
  changes: number;
  durationMs: number | undefined;
  lastRowId: number | string | undefined;
}

function toParams(params: SqlParams): SqlValue[] {
  return [...params];
}

export class Db {
  constructor(
    private readonly database: D1Database,
    private readonly log?: (message: string, fields?: Record<string, unknown>) => void,
  ) {}

  private observe(sql: string, durationMs: number, changes?: number): void {
    if (!this.log) return;
    if (durationMs >= 50) {
      this.log('slow query', { durationMs, changes: changes ?? 0, sql: sql.slice(0, 200) });
    }
  }

  private bind(sql: string, params: SqlParams): D1PreparedStatement {
    const statement = this.database.prepare(sql);
    return params.length ? statement.bind(...toParams(params)) : statement;
  }

  /** Select many rows. */
  async all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    const started = Date.now();
    const result = await this.bind(sql, params).all<T>();
    this.observe(sql, Date.now() - started, result.meta?.changes ?? undefined);
    return (result.results ?? []) as T[];
  }

  /** Select a single row (or null). */
  async first<T>(sql: string, params: SqlParams = []): Promise<T | null> {
    const started = Date.now();
    const row = await this.bind(sql, params).first<T>();
    this.observe(sql, Date.now() - started);
    return row ?? null;
  }

  /** Any single scalar as a number — used for COUNT(*). */
  async count(sql: string, params: SqlParams = []): Promise<number> {
    const row = await this.first<{ total: number | string | null }>(sql, params);
    return Number(row?.total ?? 0);
  }

  /** Writes a row and reports how many rows changed. */
  async run(sql: string, params: SqlParams = []): Promise<StatementResult> {
    const started = Date.now();
    const result = await this.bind(sql, params).run();
    const durationMs = Date.now() - started;
    this.observe(sql, durationMs, result.meta?.changes ?? undefined);
    return {
      success: result.success,
      changes: result.meta?.changes ?? 0,
      durationMs: result.meta?.duration ?? durationMs,
      lastRowId: result.meta?.last_row_id,
    };
  }

  /** Convenience wrapper when only the changed-row count matters. */
  async changes(sql: string, params: SqlParams = []): Promise<number> {
    return (await this.run(sql, params)).changes;
  }

  /** SELECT 1 … existence probe (callers use indexed predicates). */
  async exists(sql: string, params: SqlParams = []): Promise<boolean> {
    const row = await this.first<{ found: number | null }>(sql, params);
    return Number(row?.found ?? 0) > 0;
  }

  /**
   * Atomic batch. D1 executes the statements in an implicit transaction, so a
   * partially applied write is never observable.
   */
  async batch(statements: D1PreparedStatement[]): Promise<StatementResult[]> {
    if (statements.length === 0) return [];
    const started = Date.now();
    const results = await this.database.batch(statements);
    this.log?.('batch executed', { statements: statements.length, durationMs: Date.now() - started });
    return results.map((result) => ({
      success: result.success,
      changes: result.meta?.changes ?? 0,
      durationMs: result.meta?.duration,
      lastRowId: result.meta?.last_row_id,
    }));
  }

  /** Prepared statement for use inside `batch()`. */
  prepare(sql: string, params: SqlParams = []): D1PreparedStatement {
    return this.bind(sql, params);
  }

  /**
   * Builds `VALUES` placeholders for a multi-row insert:
   * `placeholders(3, 4)` -> `(?, ?, ?), (?, ?, ?), (?, ?, ?)`
   */
  placeholders(rows: number, columns: number): string {
    if (rows < 1 || columns < 1) throw new RangeError('rows and columns must be >= 1');
    const row = `(${Array.from({ length: columns }, () => '?').join(', ')})`;
    return Array.from({ length: rows }, () => row).join(', ');
  }

  /** Explicit transaction escape hatch: BEGIN/COMMIT around raw statements. */
  async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try {
      const result = await work(this);
      await this.database.exec('COMMIT');
      return result;
    } catch (error) {
      await this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createDb(
  database: D1Database,
  log?: (message: string, fields?: Record<string, unknown>) => void,
): Db {
  return new Db(database, log);
}

/**
 * Translates D1/SQLite constraint failures into stable information so handlers
 * can return a meaningful 409 instead of a generic 500. D1 error messages
 * include the constraint target, e.g. "UNIQUE constraint failed: users.email".
 */
export interface SqliteConstraintInfo {
  kind: 'unique' | 'foreign_key' | 'check' | 'not_null' | 'other';
  target: string | null;
  message: string;
}

export function classifySqliteError(error: unknown): SqliteConstraintInfo {
  const message = error instanceof Error ? error.message : String(error);
  const unique = /UNIQUE constraint failed: ([^\n]*)/i.exec(message);
  if (unique) return { kind: 'unique', target: unique[1]?.trim() ?? null, message };
  if (/FOREIGN KEY constraint failed/i.test(message)) return { kind: 'foreign_key', target: null, message };
  const check = /CHECK constraint failed: ([^\n]*)/i.exec(message);
  if (check) return { kind: 'check', target: check[1]?.trim() ?? null, message };
  const notNull = /NOT NULL constraint failed: ([^\n]*)/i.exec(message);
  if (notNull) return { kind: 'not_null', target: notNull[1]?.trim() ?? null, message };
  return { kind: 'other', target: null, message };
}
