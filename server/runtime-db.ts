import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from './store.ts';

function normalizeRowDates(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export function wrapPgliteAsSupabase(pg: any): SupabaseClient {
  const memBuckets = new Map<string, Buffer>();

  class QueryBuilder {
    private table: string;
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private headOnly = false;
    private wantCount = false;
    private filters: Array<{ sql: string; vals: any[] }> = [];
    private orderClause = '';
    private limitCount: number | null = null;
    private payload: any = null;
    private conflictCols = '';
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';

    constructor(table: string) {
      this.table = table;
    }

    select(_cols = '*', opts?: { count?: string; head?: boolean }) {
      if (opts?.count) this.wantCount = true;
      if (opts?.head) this.headOnly = true;
      return this;
    }

    insert(values: any) {
      this.op = 'insert';
      this.payload = Array.isArray(values) ? values[0] : values;
      return this;
    }

    upsert(values: any, opts?: { onConflict?: string }) {
      this.op = 'upsert';
      this.payload = values;
      this.conflictCols = opts?.onConflict || '';
      return this;
    }

    update(values: any) {
      this.op = 'update';
      this.payload = values;
      return this;
    }

    delete() {
      this.op = 'delete';
      return this;
    }

    eq(col: string, val: any) {
      if (val === null) {
        this.filters.push({ sql: `"${col}" is null`, vals: [] });
      } else {
        this.filters.push({ sql: `"${col}" = $`, vals: [val] });
      }
      return this;
    }

    neq(col: string, val: any) {
      this.filters.push({ sql: `"${col}" <> $`, vals: [val] });
      return this;
    }

    or(expr: string) {
      const parts = expr.split(',');
      const subSql: string[] = [];
      const vals: any[] = [];
      for (const p of parts) {
        const idx1 = p.indexOf('.eq.');
        if (idx1 > 0) {
          const col = p.slice(0, idx1);
          const v = p.slice(idx1 + 4);
          subSql.push(`"${col}" = $`);
          vals.push(v);
        }
      }
      if (subSql.length > 0) {
        this.filters.push({ sql: `(${subSql.join(' or ')})`, vals });
      }
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.orderClause = ` order by "${col}" ${opts?.ascending === false ? 'desc' : 'asc'}`;
      return this;
    }

    limit(n: number) {
      this.limitCount = n;
      return this;
    }

    single() {
      this.singleMode = 'single';
      return this.execute();
    }

    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this.execute();
    }

    then<TResult1 = any, TResult2 = never>(
      onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected);
    }

    private buildWhere(startIdx: number): { clause: string; params: any[] } {
      if (this.filters.length === 0) return { clause: '', params: [] };
      const params: any[] = [];
      let idx = startIdx;
      const parts = this.filters.map((f) => {
        let s = f.sql;
        for (const v of f.vals) {
          s = s.replace('$', `$${idx++}`);
          params.push(v);
        }
        return s;
      });
      return { clause: ` where ${parts.join(' and ')}`, params };
    }

    private serializeVal(v: any): any {
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    }

    async execute(): Promise<{ data: any; error: any; count?: number }> {
      try {
        if (this.op === 'select') {
          const { clause, params } = this.buildWhere(1);
          if (this.headOnly && this.wantCount) {
            const r = await pg.query(
              `select count(*)::text as cnt from public."${this.table}"${clause}`,
              params,
            );
            return { data: null, error: null, count: Number(r.rows[0]?.cnt || 0) };
          }
          const lim = this.limitCount !== null ? ` limit ${this.limitCount}` : '';
          const r = await pg.query(
            `select * from public."${this.table}"${clause}${this.orderClause}${lim}`,
            params,
          );
          const rows = r.rows.map(normalizeRowDates);
          if (this.singleMode === 'single') {
            if (rows.length === 0) return { data: null, error: { message: 'Row not found' } };
            return { data: rows[0], error: null };
          }
          if (this.singleMode === 'maybeSingle') {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null, count: rows.length };
        }

        if (this.op === 'insert' || this.op === 'upsert') {
          const keys = Object.keys(this.payload).filter((k) => this.payload[k] !== undefined);
          const cols = keys.map((k) => `"${k}"`).join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const vals = keys.map((k) => this.serializeVal(this.payload[k]));

          let conflictSql = '';
          if (this.op === 'upsert' && this.conflictCols) {
            const cCols = this.conflictCols
              .split(',')
              .map((c) => `"${c.trim()}"`)
              .join(', ');
            const updates = keys
              .filter((k) => !this.conflictCols.split(',').map((s) => s.trim()).includes(k))
              .map((k) => `"${k}" = excluded."${k}"`)
              .join(', ');
            conflictSql = updates
              ? ` on conflict (${cCols}) do update set ${updates}`
              : ` on conflict (${cCols}) do nothing`;
          }

          const r = await pg.query(
            `insert into public."${this.table}" (${cols}) values (${placeholders})${conflictSql} returning *`,
            vals,
          );
          const rows = r.rows.map(normalizeRowDates);
          const data = this.singleMode !== 'none' ? (rows[0] ?? null) : rows;
          return { data, error: null };
        }

        if (this.op === 'update') {
          const keys = Object.keys(this.payload).filter((k) => this.payload[k] !== undefined);
          const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
          const vals = keys.map((k) => this.serializeVal(this.payload[k]));
          const { clause, params } = this.buildWhere(keys.length + 1);
          const r = await pg.query(
            `update public."${this.table}" set ${sets}${clause} returning *`,
            [...vals, ...params],
          );
          const rows = r.rows.map(normalizeRowDates);
          const data = this.singleMode !== 'none' ? (rows[0] ?? null) : rows;
          return { data, error: null };
        }

        if (this.op === 'delete') {
          const { clause, params } = this.buildWhere(1);
          const r = await pg.query(
            `delete from public."${this.table}"${clause} returning *`,
            params,
          );
          return { data: r.rows.map(normalizeRowDates), error: null };
        }

        return { data: null, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    }
  }

  return {
    from: (table: string) => new QueryBuilder(table),
    storage: {
      from: (_bucket: string) => ({
        upload: async (filePath: string, buf: Buffer) => {
          memBuckets.set(filePath, buf);
          return { data: { path: filePath }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) memBuckets.delete(p);
          return { data: paths, error: null };
        },
      }),
    },
    __ensureAuthUser: async (userId: string) => {
      await pg.query(
        `insert into auth.users (id) values ($1) on conflict (id) do nothing`,
        [userId],
      );
    },
  } as unknown as SupabaseClient;
}

let cachedDb: SupabaseClient | null = null;
let remoteReadyChecked = false;
let usingLocalFallback = false;

export async function getRuntimeDb(ensureUserId?: string): Promise<{
  db: SupabaseClient;
  mode: 'supabase' | 'local-pglite';
}> {
  if (!remoteReadyChecked) {
    remoteReadyChecked = true;
    try {
      const sb = createServiceSupabase();
      const { error } = await sb.from('user_profiles').select('user_id').limit(1);
      if (!error) {
        cachedDb = sb;
        usingLocalFallback = false;
      } else {
        usingLocalFallback = true;
      }
    } catch {
      usingLocalFallback = true;
    }
  }

  if (!cachedDb) {
    const { PGlite } = await import('@electric-sql/pglite');
    const dataDir = path.resolve(process.cwd(), '.local-pgdata');
    const isInitialized = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
    const pg = new PGlite(dataDir);

    if (!isInitialized) {
      await pg.exec(`
        create schema if not exists auth;
        create table if not exists auth.users (id uuid primary key);
        create or replace function auth.uid() returns uuid language sql stable as $$
          select '00000000-0000-0000-0000-000000000001'::uuid;
        $$;
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        end $$;
      `);
      const sqlPath = path.resolve(
        process.cwd(),
        'supabase/migrations/20261128140000_findme_v05_init.sql',
      );
      await pg.exec(fs.readFileSync(sqlPath, 'utf8'));
    }
    cachedDb = wrapPgliteAsSupabase(pg);
  }

  if (usingLocalFallback && ensureUserId && (cachedDb as any).__ensureAuthUser) {
    await (cachedDb as any).__ensureAuthUser(ensureUserId);
  }

  return {
    db: cachedDb,
    mode: usingLocalFallback ? 'local-pglite' : 'supabase',
  };
}
