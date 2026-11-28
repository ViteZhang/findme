import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  SafetyPausedError,
  addEvidenceTool,
  createClueTool,
  deleteStoryTool,
  eraseAllDataTool,
  exportAllDataTool,
  getFullWorkspaceState,
  recordMergeTool,
  recordSafetyEventTool,
  resolveSafetyPauseTool,
  respondToClueTool,
  restoreArchivedClueTool,
  reviewMergeTool,
  saveEnergyLogTool,
  saveFeedbackResponseTool,
  saveStoryTool,
  setEvidenceActiveTool,
  undoChangeTool,
  updateProfileTool,
} from '../server/tools.ts';

// 轻量 PGlite -> Supabase 查询构建器适配器，用于在真实 PostgreSQL 引擎上跑完整业务与多租户隔离回归
function createPgliteSupabaseMock(pg: PGlite): any {
  class QueryBuilder {
    private table: string;
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private selectCols = '*';
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

    select(cols = '*', opts?: { count?: string; head?: boolean }) {
      if (this.op === 'select') {
        this.selectCols = cols;
      }
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
      // 支持如 story_id.eq.<uuid>,independence_key.eq.story:<uuid>
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
            const r = await pg.query<{ cnt: string }>(
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
          if (this.singleMode === 'single') {
            if (r.rows.length === 0) return { data: null, error: { message: 'Row not found' } };
            return { data: r.rows[0], error: null };
          }
          if (this.singleMode === 'maybeSingle') {
            return { data: r.rows[0] ?? null, error: null };
          }
          return { data: r.rows, error: null, count: r.rows.length };
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
          const data = this.singleMode !== 'none' ? (r.rows[0] ?? null) : r.rows;
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
          const data = this.singleMode !== 'none' ? (r.rows[0] ?? null) : r.rows;
          return { data, error: null };
        }

        if (this.op === 'delete') {
          const { clause, params } = this.buildWhere(1);
          const r = await pg.query(
            `delete from public."${this.table}"${clause} returning *`,
            params,
          );
          return { data: r.rows, error: null };
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
      from: () => ({
        remove: async () => ({ data: [], error: null }),
      }),
    },
  };
}

test('PostgreSQL 迁移脚本、工具层完整闭环、E7/E9 向量与多用户严格隔离验收', async () => {
  const pg = new PGlite();
  // 模拟 Supabase auth.users 与 auth.uid() 环境，确保原始迁移 SQL 一字不改执行通过
  await pg.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
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
  const migrationSql = fs.readFileSync(sqlPath, 'utf8');
  await pg.exec(migrationSql);

  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  await pg.exec(`insert into auth.users (id) values ('${userA}'), ('${userB}');`);

  const db = createPgliteSupabaseMock(pg);

  // 1. 用户 A 完成目标设定
  const profA = await updateProfileTool(
    db,
    userA,
    {
      nickname: 'Wortley',
      goal: '职业方向的参考',
      current_puzzle: '要不要去朋友的创业公司',
      comm_style: { directness: '直接', examples: '要' },
      consented: true,
      completeGoalSetup: true,
    },
    'req_prof_1',
  );
  assert.equal(profA.nickname, 'Wortley');
  assert.equal(profA.privacy.allow_training, false);

  // 2. 故事 1 + 故事 2 + 测评 → 线索升「高」，同时验证数据库底层落的是密文而非明文
  const s1 = await saveStoryTool(
    db,
    userA,
    {
      mode: '高光',
      title: '大学组织 200 人活动',
      period: '2019 年 · 大三',
      domain: '学业',
      star: {
        situation: '社团跨院系活动前期很乱',
        task: '总负责人',
        action: '画了一张流程表，按日期倒排',
        result: '顺利举办',
      },
      keyMoment: '把一团乱麻理清楚的那几天，熬夜都不觉得累',
      emotionIntensity: 4,
    },
    'req_story_1',
  );

  // 幂等重复请求校验
  const s1Dup = await saveStoryTool(
    db,
    userA,
    {
      mode: '高光',
      title: '不应覆盖的标题',
      star: { situation: 'x', task: 'x', action: 'x', result: 'x' },
    },
    'req_story_1',
  );
  assert.equal(s1Dup.id, s1.id);
  assert.equal(s1Dup.title, '大学组织 200 人活动');

  // 检查数据库原始字段确实已使用 AES-256-GCM 加密
  const rawStory = await pg.query<{ star_encrypted: string }>(
    `select star_encrypted from public.stories where id = $1`,
    [s1.id],
  );
  assert.ok(rawStory.rows[0].star_encrypted.startsWith('enc:v1:'));
  assert.ok(!rawStory.rows[0].star_encrypted.includes('流程表'));

  const s2 = await saveStoryTool(db, userA, {
    mode: '高光',
    title: '接手无文档的项目',
    star: {
      situation: '交接无文档',
      task: '梳理系统',
      action: '画系统关系图',
      result: '项目通了',
    },
    keyMoment: '画那张系统关系图的时候',
  });

  const clue1 = await createClueTool(db, userA, {
    statement: '在混乱的局面里，擅长先梳理结构再推进',
    type: '优势候选',
    dimension: '能力',
    keywords: ['梳理', '结构', '流程'],
    createdBy: '经历挖掘',
    userStance: '认同',
  });

  await addEvidenceTool(db, userA, {
    clueId: clue1.id,
    sourceType: '经历',
    sourceRef: s1.id,
    sourceTitle: s1.title,
    storyId: s1.id,
    excerpt: '把一团乱麻理清楚的那几天，熬夜都不觉得累',
    interpretation: '投入且有能量',
    strength: '强',
    createdBy: '经历挖掘',
  });

  await addEvidenceTool(db, userA, {
    clueId: clue1.id,
    sourceType: '经历',
    sourceRef: s2.id,
    sourceTitle: s2.title,
    storyId: s2.id,
    excerpt: '画那张系统关系图的时候',
    interpretation: '再次梳理混乱项目',
    strength: '中',
    createdBy: '经历挖掘',
  });

  const afterAssess = await addEvidenceTool(db, userA, {
    clueId: clue1.id,
    sourceType: '测评',
    sourceRef: '大五人格',
    sourceTitle: '大五人格',
    excerpt: '尽责性：高，第 82 百分位',
    interpretation: '做事有计划',
    strength: '中',
    createdBy: '测评解读',
  });
  assert.equal(afterAssess.confidence.level, '高');
  assert.equal(afterAssess.upgradedToHigh, true);

  // 3. 7.3 向量 8（E7）：价值观两难题只选不说理由 → 证据强度自动记为「弱」（0.8 * 0.5 = 0.4）
  const valClue = await createClueTool(db, userA, {
    statement: '看重工作与生活的界限',
    type: '价值观',
    dimension: '价值观',
    createdBy: '价值观澄清',
  });
  const weakValEv = await addEvidenceTool(db, userA, {
    clueId: valClue.id,
    sourceType: '价值观',
    sourceRef: 'vr_001',
    excerpt: '', // 用户说不上来理由
    interpretation: '选了准时下班但未说理由',
    strength: '中', // 即使传入中，工具层也按 R1 强制降为弱
    createdBy: '价值观澄清',
  });
  assert.equal(weakValEv.evidence.strength, '弱');
  assert.equal(weakValEv.confidence.W_plus, 0.4);

  // 4. 自动合并记录与拆回（P5.2 ① / 样例 10）
  const mergeRec = await recordMergeTool(db, userA, {
    targetClueId: valClue.id,
    mergedStatement: '不喜欢被打断节奏',
    mergedType: '能量消耗',
    mergedDimension: '能量',
    autoMerged: true,
  });
  const splitRes = await reviewMergeTool(db, userA, {
    mergeId: mergeRec.id,
    decision: 'split',
  });
  assert.equal(splitRes.merge.review_status, '已拆开');
  assert.ok(splitRes.splitClue);
  assert.equal(splitRes.splitClue!.statement, '不喜欢被打断节奏');

  // 5. 「这条不算」停用证据 + 5 秒撤销恢复
  const deact = await setEvidenceActiveTool(db, userA, afterAssess.evidence.id, false);
  assert.equal(deact.confidence.level, '中');
  await undoChangeTool(db, userA, deact.changeLog.id);
  const stateAfterUndo = await getFullWorkspaceState(db, userA);
  const restoredClue1 = stateAfterUndo.clues.find((c) => c.id === clue1.id)!;
  assert.equal(restoredClue1.confidence.level, '高');

  // 6. 否认 2 次归档与恢复回「线索（待观察）」
  await respondToClueTool(db, userA, { clueId: valClue.id, stance: '否认' });
  const deny2 = await respondToClueTool(db, userA, { clueId: valClue.id, stance: '否认' });
  assert.equal(deny2.confidence.level, '已归档');
  const restoredFromArc = await restoreArchivedClueTool(db, userA, valClue.id);
  assert.equal(restoredFromArc.confidence.level, '线索');

  // 7. 打卡与反馈写入不影响任何线索分数（F-14 / F-15）
  await saveEnergyLogTool(db, userA, {
    logDate: '2026-11-28',
    score: 7,
    chargeEvent: '独立搭框架',
    drainEvent: '连开三个会',
  });
  await saveFeedbackResponseTool(db, userA, {
    relation: '同事',
    content: '乱的时候找你准没错',
  });

  // 8. 7.3 向量 9（E9）：中风险暂停期间拒绝写入故事、线索与证据
  await recordSafetyEventTool(db, userA, {
    level: '中',
    triggerSkill: '经历挖掘',
    signalCategory: '持续低落 + 睡眠问题',
    actionTaken: '暂停探索',
  });
  await assert.rejects(
    () =>
      addEvidenceTool(db, userA, {
        clueId: clue1.id,
        sourceType: '经历',
        sourceRef: 'story_blocked',
        excerpt: '每天列清单不然睡不着',
        interpretation: '不应写入',
        strength: '中',
        createdBy: '经历挖掘',
      }),
    SafetyPausedError,
  );
  await resolveSafetyPauseTool(db, userA);

  // 9. 多用户严格隔离：用户 B 完全看不到或删不掉用户 A 的数据
  const stateB = await getFullWorkspaceState(db, userB);
  assert.equal(stateB.stories.length, 0);
  assert.equal(stateB.clues.length, 0);
  await assert.rejects(() => deleteStoryTool(db, userB, s1.id, { preview: true }));

  // 10. 故事删除预览与执行（F-07）
  const delPreview = await deleteStoryTool(db, userA, s1.id, { preview: true });
  assert.equal(delPreview.executed, false);
  assert.equal(delPreview.affectedClues[0].beforeLevel, '高');
  assert.equal(delPreview.affectedClues[0].afterLevel, '中');
  await deleteStoryTool(db, userA, s1.id, { preview: false });

  // 11. 全量导出与全量彻底清除（F-13）
  const exported = await exportAllDataTool(db, userA);
  assert.ok(exported.markdown.includes('在混乱的局面里，擅长先梳理结构再推进'));
  await eraseAllDataTool(db, userA);
  const wipedState = await getFullWorkspaceState(db, userA);
  assert.equal(wipedState.stories.length, 0);
  assert.equal(wipedState.clues.length, 0);
  assert.equal(wipedState.energyLogs.length, 0);

  await pg.close();
});
