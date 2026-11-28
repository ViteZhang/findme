import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptText } from './crypto.ts';
import {
  decodeEnergyRow,
  decodeEvidenceRow,
  decodeFeedbackResponseRow,
  decodeMessageRow,
  decodeStoryRow,
  decodeValueRankingRow,
  encodeEvidenceExcerpt,
  encodeStoryFields,
  type AssessmentRecord,
  type ChangeLogRecord,
  type ClueMergeRecord,
  type ClueRecord,
  type EnergyLogRecord,
  type EvidenceRecord,
  type FeedbackRequestRecord,
  type FeedbackResponseRecord,
  type PortraitRecord,
  type ProgressRecord,
  type StoryRecord,
  type UserProfileRecord,
  type ValueRankingRecord,
} from './store.ts';
import { buildIndependenceKey, computeConfidence } from '../src/domain/confidence.ts';
import { checkPortraitEligibility } from '../src/domain/portrait-eligibility.ts';
import { previewStoryDeletion, type StoryDeletionPreview } from '../src/domain/story-impact.ts';
import type {
  ArchiveReason,
  ClueType,
  ConfidenceLevel,
  ConfidenceResult,
  DimensionType,
  EvidenceDirection,
  EvidenceInput,
  EvidenceSourceType,
  EvidenceStrength,
  StoryDomain,
  StoryMode,
  StoryStar,
  UserStance,
} from '../src/domain/types.ts';

export class SafetyPausedError extends Error {
  constructor(message = '当前探索已因安全守护暂停，暂停期间的内容不会记为故事或证据') {
    super(message);
    this.name = 'SafetyPausedError';
  }
}

export async function ensureUserInitialized(
  db: SupabaseClient,
  userId: string,
  defaultNickname = '',
): Promise<{ profile: UserProfileRecord; progress: ProgressRecord }> {
  const [profRes, progRes] = await Promise.all([
    db.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
    db.from('progress').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  let profile = profRes.data as UserProfileRecord | null;
  if (!profile) {
    const { data, error } = await db
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          nickname: defaultNickname,
          privacy: { allow_training: false, retention: '永久', keep_raw_assessment: null },
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`初始化用户档案失败: ${error.message}`);
    profile = data as UserProfileRecord;
  }

  let progress = progRes.data as ProgressRecord | null;
  if (!progress) {
    const { data, error } = await db
      .from('progress')
      .upsert(
        {
          user_id: userId,
          modules: {
            goal_setup: { status: 'not_started' },
            story_mining: { status: 'not_started' },
            values: { status: 'not_started' },
            assessment: { status: 'not_started' },
            portrait: { status: 'not_started' },
          },
          counters: {
            highlight_stories: 0,
            low_stories: 0,
            daily_stories: 0,
            energy_days: 0,
            feedback_count: 0,
          },
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`初始化探索进度失败: ${error.message}`);
    progress = data as ProgressRecord;
  }

  return { profile, progress };
}

export async function assertNotPausedBySafety(db: SupabaseClient, userId: string): Promise<void> {
  const { data } = await db
    .from('progress')
    .select('paused_by_safety')
    .eq('user_id', userId)
    .maybeSingle();
  if (data?.paused_by_safety) {
    throw new SafetyPausedError();
  }
}

async function checkIdempotentRequest(
  db: SupabaseClient,
  userId: string,
  requestId?: string,
): Promise<ChangeLogRecord | null> {
  if (!requestId) return null;
  const { data } = await db
    .from('change_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('request_id', requestId)
    .maybeSingle();
  return (data as ChangeLogRecord | null) || null;
}

async function appendChangeLog(
  db: SupabaseClient,
  params: {
    userId: string;
    targetType: string;
    targetId: string;
    action: string;
    summary: string;
    beforeState?: any;
    afterState?: any;
    actor?: string;
    reason?: string;
    requestId?: string;
    undoPayload?: any;
  },
): Promise<ChangeLogRecord> {
  const { data, error } = await db
    .from('change_logs')
    .insert({
      user_id: params.userId,
      target_type: params.targetType,
      target_id: params.targetId,
      action: params.action,
      summary: params.summary,
      before_state: params.beforeState ?? null,
      after_state: params.afterState ?? null,
      actor: params.actor ?? '系统',
      reason: params.reason ?? null,
      request_id: params.requestId ?? null,
      undo_payload: params.undoPayload ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`写入变更日志失败: ${error.message}`);
  return data as ChangeLogRecord;
}

function toEvidenceInput(ev: EvidenceRecord): EvidenceInput {
  return {
    id: ev.id,
    direction: ev.direction,
    sourceType: ev.source_type,
    independenceKey: ev.independence_key,
    strength: ev.strength,
    isActive: ev.is_active,
    excerpt: ev.excerpt,
    sourceTitle: ev.source_title,
    occurredAt: ev.occurred_at,
  };
}

export async function recomputeAndPersistClue(
  db: SupabaseClient,
  userId: string,
  clueId: string,
  overrideArchiveReason?: ArchiveReason | undefined,
): Promise<{ clue: ClueRecord; confidence: ConfidenceResult; evidence: EvidenceRecord[] }> {
  const [{ data: clueRow, error: cErr }, { data: evRows, error: eErr }] = await Promise.all([
    db.from('clues').select('*').eq('user_id', userId).eq('id', clueId).single(),
    db
      .from('evidence')
      .select('*')
      .eq('user_id', userId)
      .eq('clue_id', clueId)
      .order('created_at', { ascending: true }),
  ]);
  if (cErr || !clueRow) throw new Error('未找到对应线索');
  if (eErr) throw new Error('读取证据失败');

  const decodedEv = (evRows || []).map(decodeEvidenceRow);
  const archiveReason =
    overrideArchiveReason !== undefined ? overrideArchiveReason : clueRow.archive_reason;

  const computed = computeConfidence({
    clueId,
    type: clueRow.type as ClueType,
    userStance: clueRow.user_stance as UserStance,
    denyCount: clueRow.deny_count,
    archiveReason,
    createdByUser: clueRow.created_by === '用户',
    evidence: decodedEv.map(toEvidenceInput),
  });

  const { data: updated, error: uErr } = await db
    .from('clues')
    .update({
      status: computed.status,
      confidence: computed,
      needs_example: computed.needsExample,
      archive_reason: archiveReason,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', clueId)
    .select('*')
    .single();
  if (uErr || !updated) throw new Error('更新线索置信度失败');

  return { clue: updated as ClueRecord, confidence: computed, evidence: decodedEv };
}

export async function refreshStoryCounters(db: SupabaseClient, userId: string): Promise<void> {
  const [{ data: stories }, { data: energy }, { data: fb }, { data: prog }] = await Promise.all([
    db.from('stories').select('mode, completeness').eq('user_id', userId),
    db.from('energy_logs').select('id').eq('user_id', userId),
    db.from('feedback_responses').select('id').eq('user_id', userId),
    db.from('progress').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  const list = stories || [];
  const highlight = list.filter((s) => s.mode === '高光' && s.completeness === '完整').length;
  const low = list.filter((s) => s.mode === '低谷' && s.completeness === '完整').length;
  const daily = list.filter((s) => s.mode === '日常' && s.completeness === '完整').length;

  const modules = { ...(prog?.modules || {}) };
  if (list.length > 0) {
    modules.story_mining = {
      status: highlight >= 3 && low >= 2 ? 'completed' : 'in_progress',
      started_at: modules.story_mining?.started_at || new Date().toISOString(),
      ...(highlight >= 3 && low >= 2 ? { completed_at: new Date().toISOString() } : {}),
    };
  }

  await db
    .from('progress')
    .update({
      modules,
      counters: {
        highlight_stories: highlight,
        low_stories: low,
        daily_stories: daily,
        energy_days: (energy || []).length,
        feedback_count: (fb || []).length,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

// ==================== 用户档案与安全 ====================

export async function updateProfileTool(
  db: SupabaseClient,
  userId: string,
  patch: Partial<{
    nickname: string;
    reason: string;
    goal: string;
    current_puzzle: string;
    life_stage: string;
    comm_style: { directness: '直接' | '温和'; examples: '要' | '不要' };
    region: string;
    reminder_enabled: boolean;
    reminder_time: string;
    notify_portrait_updates: boolean;
    consented: boolean;
    keep_raw_assessment: boolean | null;
    completeGoalSetup: boolean;
  }>,
  requestId?: string,
): Promise<UserProfileRecord> {
  const { profile, progress } = await ensureUserInitialized(db, userId);

  const goalHistory = [...(profile.goal_history || [])];
  if (patch.goal && profile.goal && patch.goal !== profile.goal) {
    goalHistory.push({
      goal: profile.goal,
      puzzle: profile.current_puzzle,
      changed_at: new Date().toISOString(),
    });
  }

  const nextPrivacy = {
    ...profile.privacy,
    allow_training: false as const,
    ...(patch.keep_raw_assessment !== undefined
      ? { keep_raw_assessment: patch.keep_raw_assessment }
      : {}),
  };

  const updatePayload: Record<string, any> = {
    updated_at: new Date().toISOString(),
    privacy: nextPrivacy,
    goal_history: goalHistory,
  };
  for (const key of [
    'nickname',
    'reason',
    'goal',
    'current_puzzle',
    'life_stage',
    'comm_style',
    'region',
    'reminder_enabled',
    'reminder_time',
    'notify_portrait_updates',
  ] as const) {
    if (patch[key] !== undefined) updatePayload[key] = patch[key];
  }
  if (patch.consented) {
    updatePayload.consented_at = profile.consented_at || new Date().toISOString();
  }

  const { data, error } = await db
    .from('user_profiles')
    .update(updatePayload)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !data) throw new Error(`更新档案失败: ${error?.message}`);

  if (patch.completeGoalSetup) {
    const modules = {
      ...(progress.modules || {}),
      goal_setup: {
        status: 'completed' as const,
        started_at: progress.modules?.goal_setup?.started_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    };
    await db
      .from('progress')
      .update({ modules, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  if (requestId) {
    await appendChangeLog(db, {
      userId,
      targetType: 'profile',
      targetId: userId,
      action: '更新档案',
      summary: patch.completeGoalSetup ? '完成目标设定' : '更新个人档案或偏好设置',
      actor: '用户',
      requestId,
    });
  }

  return data as UserProfileRecord;
}

export async function recordSafetyEventTool(
  db: SupabaseClient,
  userId: string,
  input: {
    level: '低' | '中' | '高';
    triggerSkill: string;
    signalCategory: string;
    actionTaken: string;
  },
): Promise<{ paused: boolean; resumeNotBefore: string | null }> {
  await ensureUserInitialized(db, userId);
  await db.from('safety_events').insert({
    user_id: userId,
    level: input.level,
    trigger_skill: input.triggerSkill,
    signal_category: input.signalCategory.slice(0, 60),
    action_taken: input.actionTaken,
    resolved: input.level === '低',
  });

  if (input.level === '中' || input.level === '高') {
    const resumeNotBefore =
      input.level === '高'
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;
    await db
      .from('progress')
      .update({
        paused_by_safety: true,
        safety_level: input.level === '高' ? 'high' : 'medium',
        resume_not_before: resumeNotBefore,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    return { paused: true, resumeNotBefore };
  }

  return { paused: false, resumeNotBefore: null };
}

export async function resolveSafetyPauseTool(db: SupabaseClient, userId: string): Promise<void> {
  await db
    .from('progress')
    .update({
      paused_by_safety: false,
      safety_level: 'none',
      resume_not_before: null,
      pending_recovery_confirm: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  await db
    .from('safety_events')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('resolved', false);
}

// ==================== 故事 CRUD 与删除预览 ====================

export async function saveStoryTool(
  db: SupabaseClient,
  userId: string,
  input: {
    storyId?: string;
    mode: StoryMode;
    title: string;
    period?: string;
    domain?: StoryDomain;
    star: StoryStar;
    keyMoment?: string;
    feelings?: string[];
    emotionIntensity?: number;
    people?: string[];
    completeness?: '完整' | '缺 STAR 要素' | '中断';
    missingPart?: string | null;
    durationMinutes?: number;
    conversationId?: string | null;
  },
  requestId?: string,
): Promise<StoryRecord> {
  await assertNotPausedBySafety(db, userId);

  const existingIdem = await checkIdempotentRequest(db, userId, requestId);
  if (existingIdem && existingIdem.after_state?.id) {
    const { data } = await db
      .from('stories')
      .select('*')
      .eq('user_id', userId)
      .eq('id', existingIdem.after_state.id)
      .maybeSingle();
    if (data) return decodeStoryRow(data);
  }

  const encoded = encodeStoryFields(input.star, input.keyMoment || '');
  const intensity = Math.min(5, Math.max(1, input.emotionIntensity ?? 3));

  let row: any;
  if (input.storyId) {
    const { data, error } = await db
      .from('stories')
      .update({
        mode: input.mode,
        title: input.title.trim().slice(0, 80),
        period: input.period ?? '',
        domain: input.domain ?? '工作',
        ...encoded,
        feelings: input.feelings ?? [],
        emotion_intensity: intensity,
        people: input.people ?? [],
        completeness: input.completeness ?? '完整',
        missing_part: input.missingPart ?? null,
        duration_minutes: input.durationMinutes ?? 12,
        ...(input.conversationId !== undefined ? { conversation_id: input.conversationId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', input.storyId)
      .select('*')
      .single();
    if (error || !data) throw new Error(`更新故事失败: ${error?.message}`);
    row = data;
  } else {
    const { count } = await db
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { data, error } = await db
      .from('stories')
      .insert({
        user_id: userId,
        seq: (count || 0) + 1,
        mode: input.mode,
        title: input.title.trim().slice(0, 80),
        period: input.period ?? '',
        domain: input.domain ?? '工作',
        ...encoded,
        feelings: input.feelings ?? [],
        emotion_intensity: intensity,
        people: input.people ?? [],
        completeness: input.completeness ?? '完整',
        missing_part: input.missingPart ?? null,
        duration_minutes: input.durationMinutes ?? 12,
        conversation_id: input.conversationId ?? null,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(`创建故事失败: ${error?.message}`);
    row = data;
  }

  // 低谷故事情绪强度 >= 4 时自动通知安全守护关注（记低风险记录，提高敏感度）
  if (input.mode === '低谷' && intensity >= 4) {
    await recordSafetyEventTool(db, userId, {
      level: '低',
      triggerSkill: '经历挖掘 · 低谷',
      signalCategory: '低谷经历情绪强度较高（≥4）',
      actionTaken: '提高后续检测敏感度，放慢提问节奏并保持共情',
    });
  }

  await refreshStoryCounters(db, userId);

  const decoded = decodeStoryRow(row);
  if (requestId) {
    await appendChangeLog(db, {
      userId,
      targetType: 'story',
      targetId: decoded.id,
      action: input.storyId ? '更新故事' : '新建故事',
      summary: `${decoded.mode}故事「${decoded.title}」`,
      afterState: { id: decoded.id, title: decoded.title, mode: decoded.mode },
      actor: '经历挖掘',
      requestId,
    });
  }

  return decoded;
}

export async function deleteStoryTool(
  db: SupabaseClient,
  userId: string,
  storyId: string,
  options: { preview: boolean; requestId?: string },
): Promise<StoryDeletionPreview & { messageCount: number; executed: boolean }> {
  const [{ data: storyRow, error: sErr }, { data: clueRows }, { data: evRows }] = await Promise.all([
    db.from('stories').select('*').eq('user_id', userId).eq('id', storyId).single(),
    db.from('clues').select('*').eq('user_id', userId).order('seq', { ascending: true }),
    db.from('evidence').select('*').eq('user_id', userId),
  ]);
  if (sErr || !storyRow) throw new Error('未找到该故事');

  let messageCount = 0;
  if (storyRow.conversation_id) {
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('conversation_id', storyRow.conversation_id);
    messageCount = count || 0;
  }

  const decodedEv = (evRows || []).map(decodeEvidenceRow);
  const cluesForImpact = (clueRows || []).map((c: any) => ({
    id: c.id,
    statement: c.statement,
    userStatement: c.user_statement,
    type: c.type as ClueType,
    userStance: c.user_stance as UserStance,
    denyCount: c.deny_count,
    archiveReason: c.archive_reason as ArchiveReason,
    createdByUser: c.created_by === '用户',
    evidence: decodedEv
      .filter((e) => e.clue_id === c.id)
      .map((e) => ({
        ...toEvidenceInput(e),
        storyId: e.story_id,
      })),
  }));

  const impact = previewStoryDeletion(storyId, cluesForImpact);

  if (options.preview) {
    return { ...impact, messageCount, executed: false };
  }

  // 执行不可逆删除：1) 失效所有衍生证据并抹除原话摘录；2) 重算受影响线索；3) 脱敏历史画像快照；4) 删除会话与故事
  await db
    .from('evidence')
    .update({
      is_active: false,
      excerpt_encrypted: null,
      story_id: null,
    })
    .eq('user_id', userId)
    .or(`story_id.eq.${storyId},independence_key.eq.story:${storyId}`);

  for (const affected of impact.affectedClues) {
    const nextArchive: ArchiveReason | undefined = affected.autoArchived
      ? 'source_deleted'
      : undefined;
    await recomputeAndPersistClue(db, userId, affected.clueId, nextArchive);
    await appendChangeLog(db, {
      userId,
      targetType: 'clue',
      targetId: affected.clueId,
      action: affected.autoArchived ? '归档' : '降级/重算',
      summary: `删除故事「${storyRow.title}」后，${affected.beforeLevel} → ${affected.afterLevel}`,
      beforeState: { level: affected.beforeLevel, W_plus: affected.before.W_plus },
      afterState: { level: affected.afterLevel, W_plus: affected.after.W_plus },
      actor: '用户',
    });
  }

  // C 项决定：历史画像保留版本与等级快照，清除指向已删故事的原话摘录并标为「来源已删除」
  const { data: portraits } = await db.from('portraits').select('*').eq('user_id', userId);
  for (const p of (portraits || []) as PortraitRecord[]) {
    let touched = false;
    const nextSections = (p.sections || []).map((sec) => ({
      ...sec,
      claims: (sec.claims || []).map((claim) => {
        const referencesDeleted = (claim.story_ids || []).includes(storyId);
        const nextExcerpts = (claim.excerpts || []).map((ex) => {
          if (ex.story_id === storyId) {
            touched = true;
            return { ...ex, excerpt: '来源已删除', deleted: true };
          }
          return ex;
        });
        if (referencesDeleted) touched = true;
        return { ...claim, excerpts: nextExcerpts };
      }),
    }));
    if (touched) {
      await db
        .from('portraits')
        .update({ sections: nextSections, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('version', p.version);
    }
  }

  if (storyRow.conversation_id) {
    await db
      .from('conversations')
      .delete()
      .eq('user_id', userId)
      .eq('id', storyRow.conversation_id);
  }
  await db.from('stories').delete().eq('user_id', userId).eq('id', storyId);
  await refreshStoryCounters(db, userId);

  await appendChangeLog(db, {
    userId,
    targetType: 'story',
    targetId: storyId,
    action: '删除故事',
    summary: `删除故事「${storyRow.title}」，${impact.affectedClues.length} 条线索已重算`,
    actor: '用户',
    requestId: options.requestId,
  });

  return { ...impact, messageCount, executed: true };
}

// ==================== 线索检索、创建、证据追加、回应与合并 ====================

function bigrams(text: string): Set<string> {
  const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2));
  }
  if (clean.length === 1) set.add(clean);
  return set;
}

export async function findSimilarCluesTool(
  db: SupabaseClient,
  userId: string,
  params: { statement: string; dimension?: DimensionType; keywords?: string[] },
): Promise<Array<{ clue: ClueRecord; score: number; suggestedRelation: '高度相似' | '包含' }>> {
  const { data: rows } = await db
    .from('clues')
    .select('*')
    .eq('user_id', userId)
    .neq('status', '已归档');

  const queryGrams = bigrams(params.statement);
  const queryKw = new Set((params.keywords || []).map((k) => k.trim()).filter(Boolean));
  const candidates: Array<{ clue: ClueRecord; score: number; suggestedRelation: '高度相似' | '包含' }> = [];

  for (const row of (rows || []) as ClueRecord[]) {
    const targetText = row.user_statement || row.statement;
    const rowGrams = bigrams(targetText);
    let overlap = 0;
    for (const g of queryGrams) {
      if (rowGrams.has(g)) overlap += 1;
    }
    const union = Math.max(1, queryGrams.size + rowGrams.size - overlap);
    let score = overlap / union;

    for (const kw of row.keywords || []) {
      if (queryKw.has(kw) || params.statement.includes(kw) || targetText.includes(kw)) {
        score += 0.22;
      }
    }
    if (params.dimension && row.dimension === params.dimension) {
      score += 0.08;
    }

    if (score >= 0.35) {
      candidates.push({
        clue: row,
        score: Math.min(1, Math.round(score * 100) / 100),
        suggestedRelation: score >= 0.55 ? '高度相似' : '包含',
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function createClueTool(
  db: SupabaseClient,
  userId: string,
  input: {
    statement: string;
    type: ClueType;
    dimension: DimensionType;
    keywords?: string[];
    scenarios?: string[];
    managementTip?: string;
    createdBy: string;
    userStance?: UserStance;
    relatedClues?: Array<{ clue_id: string; relation: '相关' | '矛盾' | '包含' }>;
  },
  requestId?: string,
): Promise<ClueRecord> {
  await assertNotPausedBySafety(db, userId);

  const existingIdem = await checkIdempotentRequest(db, userId, requestId);
  if (existingIdem && existingIdem.after_state?.id) {
    const { data } = await db
      .from('clues')
      .select('*')
      .eq('user_id', userId)
      .eq('id', existingIdem.after_state.id)
      .maybeSingle();
    if (data) return data as ClueRecord;
  }

  const { count } = await db
    .from('clues')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const clueId = randomUUID();
  const initialConf = computeConfidence({
    clueId,
    type: input.type,
    userStance: input.userStance ?? '未回应',
    denyCount: 0,
    createdByUser: input.createdBy === '用户',
    evidence: [],
  });

  const { data, error } = await db
    .from('clues')
    .insert({
      user_id: userId,
      id: clueId,
      seq: (count || 0) + 1,
      statement: input.statement.trim().slice(0, 40),
      type: input.type,
      dimension: input.dimension,
      keywords: input.keywords ?? [],
      scenarios: input.scenarios ?? [],
      management_tip: input.managementTip ?? null,
      status: initialConf.status,
      confidence: initialConf,
      user_stance: input.userStance ?? '未回应',
      needs_example: input.createdBy === '用户',
      related_clues: input.relatedClues ?? [],
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`新建线索失败: ${error?.message}`);

  // 双向同步 related_clues
  for (const rel of input.relatedClues || []) {
    const { data: peer } = await db
      .from('clues')
      .select('related_clues')
      .eq('user_id', userId)
      .eq('id', rel.clue_id)
      .maybeSingle();
    if (peer) {
      const peerRels = Array.isArray(peer.related_clues) ? peer.related_clues : [];
      if (!peerRels.some((r: any) => r.clue_id === clueId)) {
        await db
          .from('clues')
          .update({ related_clues: [...peerRels, { clue_id: clueId, relation: rel.relation }] })
          .eq('user_id', userId)
          .eq('id', rel.clue_id);
      }
    }
  }

  await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: clueId,
    action: '新建',
    summary: `新建线索「${data.statement}」`,
    afterState: { id: clueId, statement: data.statement, level: initialConf.level },
    actor: input.createdBy,
    requestId,
  });

  return data as ClueRecord;
}

export async function addEvidenceTool(
  db: SupabaseClient,
  userId: string,
  input: {
    clueId: string;
    direction?: EvidenceDirection;
    sourceType: EvidenceSourceType;
    sourceRef: string;
    sourceTitle?: string;
    storyId?: string | null;
    excerpt: string;
    interpretation: string;
    dedupNote?: string | null;
    anchorField?: string | null;
    strength: EvidenceStrength;
    userConfirmed?: boolean;
    createdBy: string;
    occurredAt?: string;
  },
  requestId?: string,
): Promise<{
  evidence: EvidenceRecord;
  clue: ClueRecord;
  confidence: ConfidenceResult;
  previousLevel: ConfidenceLevel;
  upgradedToHigh: boolean;
}> {
  await assertNotPausedBySafety(db, userId);

  const { data: prevClue, error: pcErr } = await db
    .from('clues')
    .select('*')
    .eq('user_id', userId)
    .eq('id', input.clueId)
    .single();
  if (pcErr || !prevClue) throw new Error('目标线索不存在');

  const previousLevel: ConfidenceLevel =
    (prevClue.confidence as ConfidenceResult)?.level || '线索';

  // R1：价值观澄清没有理由时，证据强度强制记为「弱」
  const cleanExcerpt = (input.excerpt || '').trim().slice(0, 100);
  const finalStrength: EvidenceStrength =
    input.sourceType === '价值观' && !cleanExcerpt ? '弱' : input.strength;

  const independenceKey = buildIndependenceKey(input.sourceType, input.sourceRef, input.clueId);

  const { count } = await db
    .from('evidence')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: evRow, error: evErr } = await db
    .from('evidence')
    .insert({
      user_id: userId,
      seq: (count || 0) + 1,
      clue_id: input.clueId,
      direction: input.direction ?? '支持',
      source_type: input.sourceType,
      source_ref: input.sourceRef,
      source_title: input.sourceTitle ?? '',
      story_id: input.storyId ?? null,
      independence_key: independenceKey,
      excerpt_encrypted: encodeEvidenceExcerpt(cleanExcerpt),
      interpretation: input.interpretation,
      dedup_note: input.dedupNote ?? null,
      anchor_field: input.anchorField ?? null,
      strength: finalStrength,
      user_confirmed: input.userConfirmed ?? false,
      is_active: true,
      created_by: input.createdBy,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    })
    .select('*')
    .single();
  if (evErr || !evRow) throw new Error(`写入证据失败: ${evErr?.message}`);

  const { clue, confidence } = await recomputeAndPersistClue(db, userId, input.clueId);

  const upgradedToHigh =
    previousLevel !== '高' &&
    previousLevel !== '已验证' &&
    (confidence.level === '高' || confidence.level === '已验证');

  const changeSummary =
    previousLevel !== confidence.level
      ? `${input.createdBy}加入 1 条证据，${previousLevel} → ${confidence.level}`
      : `${input.createdBy}加入 1 条证据`;

  await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: input.clueId,
    action: upgradedToHigh ? '升级' : '追加证据',
    summary: changeSummary,
    beforeState: { level: previousLevel },
    afterState: { level: confidence.level, evidenceId: evRow.id },
    actor: input.createdBy,
    requestId,
  });

  return {
    evidence: decodeEvidenceRow(evRow),
    clue,
    confidence,
    previousLevel,
    upgradedToHigh,
  };
}

export async function setEvidenceActiveTool(
  db: SupabaseClient,
  userId: string,
  evidenceId: string,
  isActive: boolean,
  requestId?: string,
): Promise<{ clue: ClueRecord; confidence: ConfidenceResult; changeLog: ChangeLogRecord }> {
  const { data: evRow, error } = await db
    .from('evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('id', evidenceId)
    .single();
  if (error || !evRow) throw new Error('未找到该证据');

  await db
    .from('evidence')
    .update({ is_active: isActive })
    .eq('user_id', userId)
    .eq('id', evidenceId);

  const { data: remEv } = await db
    .from('evidence')
    .select('id, is_active')
    .eq('user_id', userId)
    .eq('clue_id', evRow.clue_id);

  const anyActive = (remEv || []).some((e) => e.is_active);
  const archiveOverride: ArchiveReason | undefined = !anyActive
    ? 'source_deleted'
    : isActive
      ? null
      : undefined;

  const { clue, confidence } = await recomputeAndPersistClue(
    db,
    userId,
    evRow.clue_id,
    archiveOverride,
  );

  const changeLog = await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: evRow.clue_id,
    action: isActive ? '恢复证据' : '停用证据',
    summary: isActive ? '恢复了 1 条证据' : '将 1 条证据标为「这条不算」',
    actor: '用户',
    requestId,
    undoPayload: { kind: 'evidence_active', evidenceId, restoreActive: !isActive },
  });

  return { clue, confidence, changeLog };
}

export async function respondToClueTool(
  db: SupabaseClient,
  userId: string,
  input: {
    clueId: string;
    stance: '认同' | '部分认同' | '否认';
    userStatement?: string;
    denyNote?: string;
  },
  requestId?: string,
): Promise<{
  clue: ClueRecord;
  confidence: ConfidenceResult;
  previousLevel: ConfidenceLevel;
  changeLog: ChangeLogRecord;
  derivedClue?: ClueRecord | null;
}> {
  const { data: beforeRow, error } = await db
    .from('clues')
    .select('*')
    .eq('user_id', userId)
    .eq('id', input.clueId)
    .single();
  if (error || !beforeRow) throw new Error('未找到该线索');

  const previousLevel: ConfidenceLevel =
    (beforeRow.confidence as ConfidenceResult)?.level || '线索';

  const undoState = {
    user_stance: beforeRow.user_stance,
    user_statement: beforeRow.user_statement,
    deny_count: beforeRow.deny_count,
    deny_note: beforeRow.deny_note,
    archive_reason: beforeRow.archive_reason,
  };

  let nextDenyCount = beforeRow.deny_count;
  let nextArchiveReason: ArchiveReason = beforeRow.archive_reason;
  let nextUserStatement: string | null = beforeRow.user_statement;

  if (input.stance === '认同') {
    if (input.userStatement !== undefined && input.userStatement.trim()) {
      nextUserStatement = input.userStatement.trim().slice(0, 50);
    }
  } else if (input.stance === '部分认同') {
    if (input.userStatement && input.userStatement.trim()) {
      nextUserStatement = input.userStatement.trim().slice(0, 50);
    }
  } else if (input.stance === '否认') {
    nextDenyCount = beforeRow.deny_count + 1;
    if (nextDenyCount >= 2) {
      nextArchiveReason = 'denied';
    }
  }

  await db
    .from('clues')
    .update({
      user_stance: input.stance,
      user_statement: nextUserStatement,
      deny_count: nextDenyCount,
      deny_note: input.denyNote ? input.denyNote.trim().slice(0, 120) : beforeRow.deny_note,
      archive_reason: nextArchiveReason,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', input.clueId);

  const { clue, confidence } = await recomputeAndPersistClue(
    db,
    userId,
    input.clueId,
    nextArchiveReason,
  );

  if (input.stance === '否认' || input.stance === '部分认同') {
    await db.from('tuning_logs').insert({
      user_id: userId,
      clue_id: input.clueId,
      level_at_time: previousLevel,
      user_feedback: input.stance === '否认' ? '不像我' : '部分认同改写',
      note: input.denyNote || input.userStatement || null,
    });
  }

  const actionLabel =
    input.stance === '认同'
      ? '认同'
      : input.stance === '部分认同'
        ? '用户修改'
        : confidence.level === '已归档'
          ? '归档'
          : '降级';

  const summaryText =
    input.stance === '认同'
      ? '你认同了这条线索'
      : input.stance === '部分认同'
        ? `你改写了说法：「${nextUserStatement}」`
        : confidence.level === '已归档'
          ? '你第 2 次表示不像自己，线索已归档'
          : `你表示不太像自己，${previousLevel} → ${confidence.level}`;

  const changeLog = await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: input.clueId,
    action: actionLabel,
    summary: summaryText,
    beforeState: { level: previousLevel, ...undoState },
    afterState: { level: confidence.level, user_statement: nextUserStatement },
    actor: '用户',
    requestId,
    undoPayload: { kind: 'clue_state', clueId: input.clueId, restore: undoState },
  });

  return { clue, confidence, previousLevel, changeLog };
}

export async function restoreArchivedClueTool(
  db: SupabaseClient,
  userId: string,
  clueId: string,
  requestId?: string,
): Promise<{ clue: ClueRecord; confidence: ConfidenceResult }> {
  // 设计稿第 2 批规定：恢复后回到「线索（待观察）」级，不保留原等级
  await db
    .from('clues')
    .update({
      user_stance: '未回应',
      deny_count: 0,
      archive_reason: null,
      status: '待观察',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', clueId);

  const { clue, confidence } = await recomputeAndPersistClue(db, userId, clueId, null);
  // 若因历史多条证据算出了更高，按规范「恢复后回到线索级（待观察）」直到用户再次确认或新增证据
  const forcedConfidence: ConfidenceResult = {
    ...confidence,
    level: '线索',
    status: '待观察',
    next_needed: '已从归档恢复，再遇到相关经历时会先向你确认',
  };

  const { data: updated } = await db
    .from('clues')
    .update({
      status: '待观察',
      confidence: forcedConfidence,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', clueId)
    .select('*')
    .single();

  await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: clueId,
    action: '恢复',
    summary: '从归档恢复到「待观察」',
    actor: '用户',
    requestId,
  });

  return { clue: (updated as ClueRecord) || clue, confidence: forcedConfidence };
}

export async function recordMergeTool(
  db: SupabaseClient,
  userId: string,
  input: {
    targetClueId: string;
    mergedStatement: string;
    mergedType: ClueType;
    mergedDimension: DimensionType;
    sourceStoryTitle?: string;
    sourceDate?: string;
    evidenceId?: string | null;
    autoMerged: boolean;
  },
  requestId?: string,
): Promise<ClueMergeRecord> {
  const reviewStatus = input.autoMerged ? '待过目' : '已过目';
  const { data, error } = await db
    .from('clue_merges')
    .insert({
      user_id: userId,
      target_clue_id: input.targetClueId,
      merged_statement: input.mergedStatement,
      merged_type: input.mergedType,
      merged_dimension: input.mergedDimension,
      source_story_title: input.sourceStoryTitle ?? null,
      source_date: input.sourceDate ?? new Date().toISOString().slice(5, 10),
      evidence_id: input.evidenceId ?? null,
      auto_merged: input.autoMerged,
      review_status: reviewStatus,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`记录线索合并失败: ${error?.message}`);

  if (input.autoMerged) {
    await db
      .from('clues')
      .update({ merge_review: '待过目', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('id', input.targetClueId);
  }

  await appendChangeLog(db, {
    userId,
    targetType: 'clue',
    targetId: input.targetClueId,
    action: '合并',
    summary: `合并「${input.mergedStatement}」`,
    actor: input.autoMerged ? '系统' : '用户',
    requestId,
  });

  return data as ClueMergeRecord;
}

export async function reviewMergeTool(
  db: SupabaseClient,
  userId: string,
  input: { mergeId: string; decision: 'confirm' | 'split' },
  requestId?: string,
): Promise<{ merge: ClueMergeRecord; splitClue?: ClueRecord }> {
  const { data: mergeRow, error } = await db
    .from('clue_merges')
    .select('*')
    .eq('user_id', userId)
    .eq('id', input.mergeId)
    .single();
  if (error || !mergeRow) throw new Error('未找到合并记录');

  let splitClue: ClueRecord | undefined;

  if (input.decision === 'confirm') {
    await db
      .from('clue_merges')
      .update({ review_status: '已过目' })
      .eq('user_id', userId)
      .eq('id', input.mergeId);

    await appendChangeLog(db, {
      userId,
      targetType: 'clue',
      targetId: mergeRow.target_clue_id,
      action: '合并确认',
      summary: `你过目了 1 处合并：对（「${mergeRow.merged_statement}」）`,
      actor: '用户',
      requestId,
    });
  } else {
    // 拆开：新建独立线索并把对应证据移过去，标记「相关」
    splitClue = await createClueTool(db, userId, {
      statement: mergeRow.merged_statement,
      type: (mergeRow.merged_type as ClueType) || '行为模式',
      dimension: (mergeRow.merged_dimension as DimensionType) || '能力',
      createdBy: '用户拆开合并',
      userStance: '认同',
      relatedClues: [{ clue_id: mergeRow.target_clue_id, relation: '相关' }],
    });

    if (mergeRow.evidence_id) {
      await db
        .from('evidence')
        .update({ clue_id: splitClue.id })
        .eq('user_id', userId)
        .eq('id', mergeRow.evidence_id);
      const { clue: recomputedSplit } = await recomputeAndPersistClue(db, userId, splitClue.id);
      splitClue = recomputedSplit;
    }
    await recomputeAndPersistClue(db, userId, mergeRow.target_clue_id);

    await db
      .from('clue_merges')
      .update({ review_status: '已拆开', split_clue_id: splitClue.id })
      .eq('user_id', userId)
      .eq('id', input.mergeId);

    await appendChangeLog(db, {
      userId,
      targetType: 'clue',
      targetId: mergeRow.target_clue_id,
      action: '拆分',
      summary: `拆开了「${mergeRow.merged_statement}」，单独记为新线索`,
      actor: '用户',
      requestId,
    });
  }

  // 检查该目标线索是否还有其他待过目合并
  const { data: pendingLeft } = await db
    .from('clue_merges')
    .select('id')
    .eq('user_id', userId)
    .eq('target_clue_id', mergeRow.target_clue_id)
    .eq('review_status', '待过目');

  await db
    .from('clues')
    .update({
      merge_review: (pendingLeft || []).length > 0 ? '待过目' : input.decision === 'confirm' ? '已过目' : '已撤销',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', mergeRow.target_clue_id);

  const { data: updatedMerge } = await db
    .from('clue_merges')
    .select('*')
    .eq('user_id', userId)
    .eq('id', input.mergeId)
    .single();

  return { merge: updatedMerge as ClueMergeRecord, splitClue };
}

export async function undoChangeTool(
  db: SupabaseClient,
  userId: string,
  changeLogId: string,
): Promise<{ ok: boolean }> {
  const { data: logRow, error } = await db
    .from('change_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', changeLogId)
    .single();
  if (error || !logRow || logRow.undone || !logRow.undo_payload) {
    throw new Error('该操作无法撤销或已撤销');
  }

  const payload = logRow.undo_payload;
  if (payload.kind === 'evidence_active') {
    await db
      .from('evidence')
      .update({ is_active: payload.restoreActive })
      .eq('user_id', userId)
      .eq('id', payload.evidenceId);
    await recomputeAndPersistClue(db, userId, logRow.target_id, null);
  } else if (payload.kind === 'clue_state') {
    await db
      .from('clues')
      .update({
        ...payload.restore,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', payload.clueId);
    await recomputeAndPersistClue(
      db,
      userId,
      payload.clueId,
      payload.restore.archive_reason ?? null,
    );
  }

  await db
    .from('change_logs')
    .update({ undone: true })
    .eq('user_id', userId)
    .eq('id', changeLogId);

  return { ok: true };
}

// ==================== 能量打卡与他人反馈（V0.5 只收集，绝不写入 Evidence） ====================

export async function saveEnergyLogTool(
  db: SupabaseClient,
  userId: string,
  input: { logDate?: string; score: number; chargeEvent?: string; drainEvent?: string; note?: string },
): Promise<EnergyLogRecord> {
  const dateStr = input.logDate || new Date().toISOString().slice(0, 10);
  const score = Math.min(10, Math.max(1, Math.round(input.score)));

  const { data: existing } = await db
    .from('energy_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('log_date', dateStr)
    .maybeSingle();

  const charge = input.chargeEvent !== undefined ? input.chargeEvent : existing ? decodeEnergyRow(existing).charge_event : '';
  const drain = input.drainEvent !== undefined ? input.drainEvent : existing ? decodeEnergyRow(existing).drain_event : '';
  const note = input.note !== undefined ? input.note : existing ? decodeEnergyRow(existing).note : '';

  const { data, error } = await db
    .from('energy_logs')
    .upsert(
      {
        user_id: userId,
        log_date: dateStr,
        score,
        charge_encrypted: encryptText(charge),
        drain_encrypted: encryptText(drain),
        note_encrypted: encryptText(note),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,log_date' },
    )
    .select('*')
    .single();
  if (error || !data) throw new Error(`保存能量打卡失败: ${error?.message}`);

  await refreshStoryCounters(db, userId);
  return decodeEnergyRow(data);
}

export async function saveFeedbackResponseTool(
  db: SupabaseClient,
  userId: string,
  input: {
    relation: '家人' | '朋友' | '同事' | '上级' | '下属' | '其他';
    content: string;
    summary?: string;
    requestId?: string;
  },
): Promise<FeedbackResponseRecord> {
  const clean = input.content.trim();
  if (!clean) throw new Error('请粘贴对方的反馈内容');
  const autoSummary = (input.summary || clean.replace(/\s+/g, ' ').slice(0, 42)).trim();

  const { data, error } = await db
    .from('feedback_responses')
    .insert({
      user_id: userId,
      relation: input.relation,
      content_encrypted: encryptText(clean),
      summary_encrypted: encryptText(autoSummary),
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`保存他人反馈失败: ${error?.message}`);

  await refreshStoryCounters(db, userId);
  return decodeFeedbackResponseRow(data);
}

// ==================== 全量读取快照、全量导出与全量彻底清除 ====================

export async function getFullWorkspaceState(db: SupabaseClient, userId: string) {
  const { profile, progress } = await ensureUserInitialized(db, userId);

  const [
    storiesRes,
    cluesRes,
    evRes,
    mergesRes,
    valuesRes,
    assessRes,
    energyRes,
    fbReqRes,
    fbRespRes,
    portraitsRes,
    convsRes,
    logsRes,
  ] = await Promise.all([
    db.from('stories').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('clues').select('*').eq('user_id', userId).order('seq', { ascending: true }),
    db.from('evidence').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    db.from('clue_merges').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('value_rankings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('assessments').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('energy_logs').select('*').eq('user_id', userId).order('log_date', { ascending: false }),
    db.from('feedback_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('feedback_responses').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('portraits').select('*').eq('user_id', userId).order('version', { ascending: false }),
    db.from('conversations').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20),
    db.from('change_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
  ]);

  const stories = (storiesRes.data || []).map(decodeStoryRow);
  const evidence = (evRes.data || []).map(decodeEvidenceRow);
  const clues = ((cluesRes.data || []) as ClueRecord[]).map((c) => {
    const clueEv = evidence.filter((e) => e.clue_id === c.id);
    const computed = computeConfidence({
      clueId: c.id,
      type: c.type,
      userStance: c.user_stance,
      denyCount: c.deny_count,
      archiveReason: c.archive_reason,
      createdByUser: c.created_by === '用户',
      evidence: clueEv.map(toEvidenceInput),
    });
    return { ...c, confidence: computed, needs_example: computed.needsExample };
  });

  const valueRankings = (valuesRes.data || []).map(decodeValueRankingRow);
  const valuesCompleted =
    valueRankings.some((v) => v.step === 'completed' || Boolean(v.confirmed_at)) ||
    progress.modules?.values?.status === 'completed';

  const eligibility = checkPortraitEligibility({
    clues: clues.map((c) => ({
      id: c.id,
      statement: c.user_statement || c.statement,
      type: c.type,
      confidence: c.confidence,
    })),
    valuesCompleted,
  });

  return {
    profile,
    progress,
    stories,
    clues,
    evidence,
    merges: (mergesRes.data || []) as ClueMergeRecord[],
    valueRankings,
    assessments: (assessRes.data || []) as AssessmentRecord[],
    energyLogs: (energyRes.data || []).map(decodeEnergyRow),
    feedbackRequests: (fbReqRes.data || []) as FeedbackRequestRecord[],
    feedbackResponses: (fbRespRes.data || []).map(decodeFeedbackResponseRow),
    portraits: (portraitsRes.data || []) as PortraitRecord[],
    conversations: (convsRes.data || []) as any[],
    changeLogs: (logsRes.data || []) as ChangeLogRecord[],
    eligibility,
  };
}

export async function exportAllDataTool(db: SupabaseClient, userId: string) {
  const state = await getFullWorkspaceState(db, userId);

  const mdLines: string[] = [
    `# 照见 · 个人探索全量数据导出`,
    ``,
    `导出时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    `昵称：${state.profile.nickname || '未设置'}`,
    `探索目标：${state.profile.goal || '未设置'}`,
    `当前困惑：${state.profile.current_puzzle || '无'}`,
    ``,
    `## 一、线索库（共 ${state.clues.length} 条）`,
    ``,
  ];

  for (const c of state.clues) {
    const title = c.user_statement || c.statement;
    mdLines.push(`### ${title} 〔${c.type} · ${c.confidence.level}〕`);
    const evs = state.evidence.filter((e) => e.clue_id === c.id && e.is_active);
    for (const ev of evs) {
      mdLines.push(`- [${ev.source_type} · ${ev.strength}] ${ev.excerpt || ev.interpretation}（${ev.source_title || ''}）`);
    }
    mdLines.push('');
  }

  mdLines.push(`## 二、故事库（共 ${state.stories.length} 个）`, '');
  for (const s of state.stories) {
    const datePart = String(s.created_at || '').slice(0, 10);
    mdLines.push(`### ${s.title}（${s.mode} · ${s.period || datePart}）`);
    if (s.key_moment) mdLines.push(`- 关键时刻：${s.key_moment}`);
    mdLines.push(`- 情境：${s.star.situation}`);
    mdLines.push(`- 任务：${s.star.task}`);
    mdLines.push(`- 行动：${s.star.action}`);
    mdLines.push(`- 结果：${s.star.result}`, '');
  }

  if (state.portraits.length > 0) {
    const latest = state.portraits[0];
    mdLines.push(`## 三、最新画像（v${latest.version}）`, '', `**${latest.headline}**`, `> ${latest.subtitle}`, '');
    for (const sec of latest.sections || []) {
      mdLines.push(`### ${sec.section}. ${sec.title}`);
      for (const cl of sec.claims || []) {
        mdLines.push(`- 【${cl.wording}】${cl.headline}`);
      }
      mdLines.push('');
    }
  }

  mdLines.push(`## 四、能量打卡记录（共 ${state.energyLogs.length} 天）`, '');
  for (const log of state.energyLogs) {
    mdLines.push(`- ${log.log_date}：${log.score} 分｜充电：${log.charge_event || '—'}｜消耗：${log.drain_event || '—'}`);
  }

  return {
    json: {
      exported_at: new Date().toISOString(),
      profile: state.profile,
      progress: state.progress,
      stories: state.stories,
      clues: state.clues,
      evidence: state.evidence,
      value_rankings: state.valueRankings,
      assessments: state.assessments,
      portraits: state.portraits,
      energy_logs: state.energyLogs,
      feedback_responses: state.feedbackResponses,
    },
    markdown: mdLines.join('\n'),
  };
}

export async function eraseAllDataTool(db: SupabaseClient, userId: string): Promise<void> {
  // 1. 删除私有 Storage 桶中属于该用户的测评原文件
  const { data: assessments } = await db
    .from('assessments')
    .select('raw_file_ref')
    .eq('user_id', userId);
  const paths = (assessments || [])
    .map((a: any) => a.raw_file_ref)
    .filter((p: any): p is string => Boolean(p));
  if (paths.length > 0) {
    await db.storage.from('assessments').remove(paths).catch(() => null);
  }

  // 2. 硬删除全部业务表记录（外键级联之外显式逐表清空确保零残留）
  const tables = [
    'tuning_logs',
    'change_logs',
    'safety_events',
    'background_tasks',
    'messages',
    'conversations',
    'portraits',
    'feedback_responses',
    'feedback_requests',
    'energy_logs',
    'assessments',
    'value_rankings',
    'clue_merges',
    'evidence',
    'clues',
    'stories',
    'progress',
    'user_profiles',
  ];
  for (const tbl of tables) {
    await db.from(tbl).delete().eq('user_id', userId);
  }
}
