import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decryptJson, decryptText, encryptJson, encryptText } from './crypto.ts';
import type {
  ArchiveReason,
  ClueStatus,
  ClueType,
  ConfidenceResult,
  DimensionType,
  EvidenceDirection,
  EvidenceSourceType,
  EvidenceStrength,
  StoryDomain,
  StoryMode,
  StoryStar,
  UserStance,
} from '../src/domain/types.ts';

export interface UserProfileRecord {
  user_id: string;
  nickname: string;
  reason: string;
  goal: string;
  current_puzzle: string;
  life_stage: string;
  comm_style: { directness: '直接' | '温和'; examples: '要' | '不要' };
  privacy: {
    allow_training: false;
    retention: string;
    keep_raw_assessment: boolean | null;
  };
  region: string;
  reminder_enabled: boolean;
  reminder_time: string;
  notify_portrait_updates: boolean;
  consent_version: string;
  consented_at: string | null;
  goal_history: Array<{ goal: string; puzzle: string; changed_at: string }>;
  created_at: string;
  updated_at: string;
}

export interface ProgressRecord {
  user_id: string;
  modules: Record<
    string,
    { status: 'not_started' | 'in_progress' | 'completed'; started_at?: string; completed_at?: string }
  >;
  counters: {
    highlight_stories: number;
    low_stories: number;
    daily_stories: number;
    energy_days: number;
    feedback_count: number;
  };
  last_session: {
    date: string;
    skill: string;
    summary: string;
    open_thread?: string;
    conversation_id?: string;
    story_title?: string;
    story_mode?: string;
  } | null;
  paused_by_safety: boolean;
  safety_level: 'none' | 'low' | 'medium' | 'high';
  resume_not_before: string | null;
  pending_recovery_confirm: boolean;
  dismissed_reminder_nudge_until: string | null;
  updated_at: string;
}

export interface StoryRecord {
  user_id: string;
  id: string;
  seq: number;
  mode: StoryMode;
  title: string;
  period: string;
  domain: StoryDomain;
  star: StoryStar;
  key_moment: string;
  feelings: string[];
  emotion_intensity: number;
  people: string[];
  completeness: '完整' | '缺 STAR 要素' | '中断';
  missing_part: string | null;
  duration_minutes: number;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClueRecord {
  user_id: string;
  id: string;
  seq: number;
  statement: string;
  user_statement: string | null;
  type: ClueType;
  dimension: DimensionType;
  keywords: string[];
  status: ClueStatus;
  confidence: ConfidenceResult;
  user_stance: UserStance;
  deny_count: number;
  deny_note: string | null;
  archive_reason: ArchiveReason;
  needs_example: boolean;
  not_mentioned_by_others: boolean;
  merge_review: '无' | '待过目' | '已过目' | '已撤销';
  related_clues: Array<{ clue_id: string; relation: '相关' | '矛盾' | '包含' }>;
  scenarios: string[];
  management_tip: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRecord {
  user_id: string;
  id: string;
  seq: number;
  clue_id: string;
  direction: EvidenceDirection;
  source_type: EvidenceSourceType;
  source_ref: string;
  source_title: string;
  story_id: string | null;
  independence_key: string;
  excerpt: string | null;
  interpretation: string;
  dedup_note: string | null;
  anchor_field: string | null;
  strength: EvidenceStrength;
  user_confirmed: boolean;
  is_active: boolean;
  created_by: string;
  occurred_at: string;
  created_at: string;
}

export interface ClueMergeRecord {
  user_id: string;
  id: string;
  target_clue_id: string;
  merged_statement: string;
  merged_type: ClueType;
  merged_dimension: DimensionType;
  source_story_title: string | null;
  source_date: string | null;
  evidence_id: string | null;
  auto_merged: boolean;
  review_status: '待过目' | '已过目' | '已拆开';
  split_clue_id: string | null;
  created_at: string;
}

export interface ValueRankingRecord {
  user_id: string;
  id: string;
  shortlist: string[];
  tradeoffs: Array<{
    id: string;
    optionA: string;
    valueA: string;
    optionB: string;
    valueB: string;
    choice: 'A' | 'B' | null;
    reason: string;
    hesitate_count: number;
    skipped: boolean;
  }>;
  top5: Array<{ rank: number; value: string; user_definition: string }>;
  inconsistencies: Array<{ said: string; did: string; description: string; user_agreed?: boolean }>;
  step: 'shortlist' | 'tradeoffs' | 'discussion' | 'ranking' | 'completed';
  conversation_id: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssessmentComparisonItem {
  id: string;
  kind: '吻合' | '值得聊聊' | '新发现';
  dimension: string;
  title: string;
  description: string;
  target_clue_id?: string | null;
  status: 'pending' | 'responded' | 'skipped';
  user_response?: string;
  outcome_note?: string;
  created_clue_id?: string | null;
  added_evidence_id?: string | null;
}

export interface AssessmentRecord {
  user_id: string;
  id: string;
  instrument: '大五人格' | 'VIA' | '盖洛普' | 'MBTI' | '其他';
  instrument_confirmed: boolean;
  taken_at: string | null;
  file_name: string | null;
  raw_file_ref: string | null;
  raw_file_deleted_at: string | null;
  scores: Array<{ dimension: string; score: number | string; explanation: string }>;
  comparisons: AssessmentComparisonItem[];
  skipped_items: string[];
  counts_as_evidence: boolean;
  parse_status: 'uploading' | 'parsing' | 'completed' | 'failed';
  parse_error: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnergyLogRecord {
  user_id: string;
  id: string;
  log_date: string;
  score: number;
  charge_event: string;
  drain_event: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackRequestRecord {
  user_id: string;
  id: string;
  mode: '匿名' | '实名';
  questions: string[];
  planned_relations: Record<string, number>;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackResponseRecord {
  user_id: string;
  id: string;
  request_id: string | null;
  relation: '家人' | '朋友' | '同事' | '上级' | '下属' | '其他';
  content: string;
  summary: string;
  created_at: string;
}

export interface PortraitClaimItem {
  id: string;
  clue_id?: string;
  wording: '明显' | '可能' | '习得技能' | '观察';
  headline: string;
  detail?: string;
  evidence_summary: string;
  scenarios?: string;
  tip?: string;
  story_ids: string[];
  excerpts?: Array<{ source_type: string; source_title: string; excerpt: string; story_id?: string | null; deleted?: boolean }>;
  user_edited?: boolean;
  original_headline?: string;
}

export interface PortraitSectionData {
  section: number;
  title: string;
  subtitle?: string;
  claims: PortraitClaimItem[];
  empty_note?: string;
  values_top5?: Array<{ rank: number; value: string; definition: string }>;
  energy?: {
    charging: Array<{ text: string; badge: string; uncounted?: boolean }>;
    draining: Array<{ text: string; badge: string; highlight?: boolean; uncounted?: boolean }>;
  };
  best_state?: {
    when: string;
    how: string;
    with_whom: string;
    avoid: string;
  };
  watch_items?: Array<{
    clue_id: string;
    statement: string;
    tag?: string;
    source_label: string;
  }>;
  diff_note?: string;
}

export interface PortraitRecord {
  user_id: string;
  id: string;
  version: number;
  headline: string;
  subtitle: string;
  trigger_reason: string;
  flow_step: 1 | 2 | 3 | 4 | 5;
  status: '草稿' | '审核中' | '待确认' | '已定稿' | '生成失败';
  clue_snapshot: Array<{
    clue_id: string;
    statement: string;
    type: ClueType;
    level: string;
    W_plus: number;
    evidence_ids: string[];
  }>;
  sections: PortraitSectionData[];
  review_notes: Array<{
    id: string;
    label: string;
    status: 'done' | 'running' | 'wait' | 'failed';
    result_text: string;
  }>;
  user_edits: Array<{ section: number; before: string; after: string; edited_at: string }>;
  section_confirmations: Record<string, { status: 'confirmed' | 'edited'; updated_at: string }>;
  diff_from_previous: Array<{
    kind: '升级' | '新增' | '降级' | '移除' | '改写';
    statement: string;
    change_label: string;
  }>;
  stats: { clue_count: number; story_count: number; assessment_count: number };
  generated_at: string;
  confirmed_at: string | null;
  updated_at: string;
}

export interface ConversationRecord {
  user_id: string;
  id: string;
  skill: '目标设定' | '经历挖掘' | '价值观澄清' | '测评解读' | '能量打卡' | '自由聊天' | '安全陪伴';
  mode: string | null;
  title: string;
  status: '进行中' | '已暂停' | '已结束';
  story_id: string | null;
  assessment_id: string | null;
  ranking_id: string | null;
  focus_clue_id: string | null;
  context: Record<string, any>;
  discoveries: Array<{ clue_id: string; statement: string; delta_label: string; pending?: boolean }>;
  token_usage: { input_tokens: number; output_tokens: number; calls: number };
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface MessageRecord {
  user_id: string;
  id: string;
  conversation_id: string;
  seq: number;
  role: 'coach' | 'user' | 'system';
  content: string;
  inline_cards: Array<Record<string, any>>;
  created_at: string;
}

export interface ChangeLogRecord {
  user_id: string;
  id: string;
  target_type: string;
  target_id: string;
  action: string;
  summary: string;
  before_state: any;
  after_state: any;
  actor: string;
  reason: string | null;
  request_id: string | null;
  undo_payload: any;
  undone: boolean;
  created_at: string;
}

export function createServiceSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase 服务端环境变量尚未配置');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// 透明编解码辅助：数据库行 <-> 业务对象
export function decodeStoryRow(row: any): StoryRecord {
  return {
    ...row,
    star: decryptJson<StoryStar>(row.star_encrypted, {
      situation: '',
      task: '',
      action: '',
      result: '',
    }),
    key_moment: decryptText(row.key_moment_encrypted),
  };
}

export function encodeStoryFields(star: StoryStar, keyMoment: string) {
  return {
    star_encrypted: encryptJson(star),
    key_moment_encrypted: encryptText(keyMoment),
  };
}

export function decodeEvidenceRow(row: any): EvidenceRecord {
  return {
    ...row,
    excerpt: row.excerpt_encrypted ? decryptText(row.excerpt_encrypted) : null,
  };
}

export function encodeEvidenceExcerpt(excerpt: string | null | undefined) {
  return excerpt ? encryptText(excerpt) : null;
}

export function decodeEnergyRow(row: any): EnergyLogRecord {
  return {
    user_id: row.user_id,
    id: row.id,
    log_date: String(row.log_date || '').slice(0, 10),
    score: row.score,
    charge_event: decryptText(row.charge_encrypted),
    drain_event: decryptText(row.drain_encrypted),
    note: decryptText(row.note_encrypted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function decodeFeedbackResponseRow(row: any): FeedbackResponseRecord {
  return {
    user_id: row.user_id,
    id: row.id,
    request_id: row.request_id,
    relation: row.relation,
    content: decryptText(row.content_encrypted),
    summary: decryptText(row.summary_encrypted),
    created_at: row.created_at,
  };
}

export function decodeMessageRow(row: any): MessageRecord {
  return {
    user_id: row.user_id,
    id: row.id,
    conversation_id: row.conversation_id,
    seq: row.seq,
    role: row.role,
    content: decryptText(row.content_encrypted),
    inline_cards: row.inline_cards || [],
    created_at: row.created_at,
  };
}

export function decodeValueRankingRow(row: any): ValueRankingRecord {
  const rawTradeoffs = Array.isArray(row.tradeoffs) ? row.tradeoffs : [];
  return {
    ...row,
    tradeoffs: rawTradeoffs.map((t: any) => ({
      ...t,
      reason: t.reason_encrypted ? decryptText(t.reason_encrypted) : (t.reason || ''),
    })),
  };
}

export function encodeValueTradeoffs(tradeoffs: ValueRankingRecord['tradeoffs']) {
  return tradeoffs.map((t) => ({
    id: t.id,
    optionA: t.optionA,
    valueA: t.valueA,
    optionB: t.optionB,
    valueB: t.valueB,
    choice: t.choice,
    reason_encrypted: encryptText(t.reason || ''),
    hesitate_count: t.hesitate_count || 0,
    skipped: Boolean(t.skipped),
  }));
}
