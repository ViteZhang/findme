-- FindMe「照见」V0.5 完整生产表结构（对齐《04_数据模型设计 v0.6》与全部设计稿画板）
-- 清理旧版简化原型表与函数

drop function if exists public.apply_coach_action(uuid, text, text, jsonb) cascade;
drop function if exists public.exploration_data(uuid, boolean) cascade;

drop table if exists public.tuning_logs cascade;
drop table if exists public.change_logs cascade;
drop table if exists public.change_log cascade;
drop table if exists public.safety_events cascade;
drop table if exists public.background_tasks cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.coach_sessions cascade;
drop table if exists public.portrait_items cascade;
drop table if exists public.portrait_versions cascade;
drop table if exists public.portraits cascade;
drop table if exists public.feedback_responses cascade;
drop table if exists public.feedback_requests cascade;
drop table if exists public.energy_logs cascade;
drop table if exists public.assessments cascade;
drop table if exists public.value_rankings cascade;
drop table if exists public.clue_merges cascade;
drop table if exists public.evidence cascade;
drop table if exists public.clues cascade;
drop table if exists public.stories cascade;
drop table if exists public.exploration_preferences cascade;
drop table if exists public.exploration_state cascade;
drop table if exists public.progress cascade;
drop table if exists public.profiles cascade;
drop table if exists public.user_profiles cascade;

-- 1. 用户档案 UserProfile
create table public.user_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  nickname text not null default '',
  reason text not null default '',
  goal text not null default '',
  current_puzzle text not null default '',
  life_stage text not null default '',
  comm_style jsonb not null default '{"directness":"直接","examples":"要"}'::jsonb,
  privacy jsonb not null default '{"allow_training":false,"retention":"永久","keep_raw_assessment":null}'::jsonb,
  region text not null default 'CN',
  reminder_enabled boolean not null default false,
  reminder_time text not null default '21:30',
  notify_portrait_updates boolean not null default true,
  consent_version text not null default 'v0.5',
  consented_at timestamptz,
  goal_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 对话进度与安全状态 Progress
create table public.progress (
  user_id uuid primary key references auth.users on delete cascade,
  modules jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{"highlight_stories":0,"low_stories":0,"daily_stories":0,"energy_days":0,"feedback_count":0}'::jsonb,
  last_session jsonb,
  paused_by_safety boolean not null default false,
  safety_level text not null default 'none' check (safety_level in ('none', 'low', 'medium', 'high')),
  resume_not_before timestamptz,
  pending_recovery_confirm boolean not null default false,
  dismissed_reminder_nudge_until timestamptz,
  updated_at timestamptz not null default now()
);

-- 3. 故事库 Story（STAR 与关键时刻采用 AES-256-GCM 密文存储）
create table public.stories (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  seq integer not null default 1,
  mode text not null check (mode in ('高光', '低谷', '日常')),
  title text not null,
  period text not null default '',
  domain text not null default '工作' check (domain in ('学业', '工作', '家庭', '社交', '兴趣', '其他')),
  star_encrypted text not null,
  key_moment_encrypted text not null default '',
  feelings jsonb not null default '[]'::jsonb,
  emotion_intensity integer not null default 3 check (emotion_intensity between 1 and 5),
  people jsonb not null default '[]'::jsonb,
  completeness text not null default '完整' check (completeness in ('完整', '缺 STAR 要素', '中断')),
  missing_part text,
  duration_minutes integer not null default 10,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index stories_user_created_idx on public.stories (user_id, created_at desc);

-- 4. 线索库 Clue
create table public.clues (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  seq integer not null default 1,
  statement text not null check (char_length(statement) between 1 and 60),
  user_statement text,
  type text not null check (type in ('优势候选', '习得技能', '短板候选', '价值观', '能量来源', '能量消耗', '行为模式', '盲点', '不一致')),
  dimension text not null check (dimension in ('性格', '能力', '价值观', '能量', '关系', '盲点')),
  keywords jsonb not null default '[]'::jsonb,
  status text not null default '待观察' check (status in ('待观察', '成立中', '已成立', '已验证', '已归档')),
  confidence jsonb not null default '{}'::jsonb,
  user_stance text not null default '未回应' check (user_stance in ('未回应', '认同', '部分认同', '否认')),
  deny_count integer not null default 0 check (deny_count >= 0),
  deny_note text,
  archive_reason text check (archive_reason in ('denied', 'source_deleted', 'merged', 'manual')),
  needs_example boolean not null default false,
  not_mentioned_by_others boolean not null default false,
  merge_review text not null default '无' check (merge_review in ('无', '待过目', '已过目', '已撤销')),
  related_clues jsonb not null default '[]'::jsonb,
  scenarios jsonb not null default '[]'::jsonb,
  management_tip text,
  created_by text not null default '经历挖掘',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index clues_user_updated_idx on public.clues (user_id, updated_at desc);

-- 5. 证据库 Evidence（原话摘录采用 AES-256-GCM 密文存储）
create table public.evidence (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  seq integer not null default 1,
  clue_id uuid not null,
  direction text not null default '支持' check (direction in ('支持', '反对')),
  source_type text not null check (source_type in ('经历', '价值观', '能量', '他人反馈', '测评', '实验', '用户自述')),
  source_ref text not null,
  source_title text not null default '',
  story_id uuid,
  independence_key text not null,
  excerpt_encrypted text,
  interpretation text not null default '',
  dedup_note text,
  anchor_field text,
  strength text not null check (strength in ('弱', '中', '强')),
  user_confirmed boolean not null default false,
  is_active boolean not null default true,
  created_by text not null default '经历挖掘',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, clue_id) references public.clues (user_id, id) on delete cascade
);
create index evidence_user_clue_idx on public.evidence (user_id, clue_id);
create index evidence_user_story_idx on public.evidence (user_id, story_id);

-- 6. 线索合并记录（支持统一过目与拆回）
create table public.clue_merges (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  target_clue_id uuid not null,
  merged_statement text not null,
  merged_type text not null default '优势候选',
  merged_dimension text not null default '能力',
  source_story_title text,
  source_date text,
  evidence_id uuid,
  auto_merged boolean not null default true,
  review_status text not null default '待过目' check (review_status in ('待过目', '已过目', '已拆开')),
  split_clue_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, target_clue_id) references public.clues (user_id, id) on delete cascade
);

-- 7. 价值观排序 ValueRanking
create table public.value_rankings (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  shortlist jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '[]'::jsonb,
  top5 jsonb not null default '[]'::jsonb,
  inconsistencies jsonb not null default '[]'::jsonb,
  step text not null default 'shortlist' check (step in ('shortlist', 'tradeoffs', 'discussion', 'ranking', 'completed')),
  conversation_id uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 8. 测评结果 Assessment
create table public.assessments (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  instrument text not null check (instrument in ('大五人格', 'VIA', '盖洛普', 'MBTI', '其他')),
  instrument_confirmed boolean not null default true,
  taken_at text,
  file_name text,
  raw_file_ref text,
  raw_file_deleted_at timestamptz,
  scores jsonb not null default '[]'::jsonb,
  comparisons jsonb not null default '[]'::jsonb,
  skipped_items jsonb not null default '[]'::jsonb,
  counts_as_evidence boolean not null default true,
  parse_status text not null default 'completed' check (parse_status in ('uploading', 'parsing', 'completed', 'failed')),
  parse_error text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 9. 能量打卡 EnergyLog（V0.5 仅存储展示，不生成周报证据）
create table public.energy_logs (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  log_date date not null,
  score integer not null check (score between 1 and 10),
  charge_encrypted text not null default '',
  drain_encrypted text not null default '',
  note_encrypted text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, log_date)
);

-- 10. 他人反馈收集 FeedbackRequest & FeedbackResponse（V0.5 仅存储）
create table public.feedback_requests (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  mode text not null default '匿名' check (mode in ('匿名', '实名')),
  questions jsonb not null default '[]'::jsonb,
  planned_relations jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.feedback_responses (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  request_id uuid,
  relation text not null check (relation in ('家人', '朋友', '同事', '上级', '下属', '其他')),
  content_encrypted text not null,
  summary_encrypted text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 11. 个人画像版本 Portrait
create table public.portraits (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  headline text not null default '',
  subtitle text not null default '这是目前证据最充分的样子，不是定论',
  trigger_reason text not null default '证据达标',
  flow_step integer not null default 1 check (flow_step between 1 and 5),
  status text not null default '草稿' check (status in ('草稿', '审核中', '待确认', '已定稿', '生成失败')),
  clue_snapshot jsonb not null default '[]'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  review_notes jsonb not null default '[]'::jsonb,
  user_edits jsonb not null default '[]'::jsonb,
  section_confirmations jsonb not null default '{}'::jsonb,
  diff_from_previous jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- 12. 会话与消息流 Conversations & Messages（Q4：按技能一次会话，可回看续聊）
create table public.conversations (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  skill text not null check (skill in ('目标设定', '经历挖掘', '价值观澄清', '测评解读', '能量打卡', '自由聊天', '安全陪伴')),
  mode text,
  title text not null default '',
  status text not null default '进行中' check (status in ('进行中', '已暂停', '已结束')),
  story_id uuid,
  assessment_id uuid,
  ranking_id uuid,
  focus_clue_id uuid,
  context jsonb not null default '{}'::jsonb,
  discoveries jsonb not null default '[]'::jsonb,
  token_usage jsonb not null default '{"input_tokens":0,"output_tokens":0,"calls":0}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (user_id, id)
);
create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

create table public.messages (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  seq integer not null default 1,
  role text not null check (role in ('coach', 'user', 'system')),
  content_encrypted text not null default '',
  inline_cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, conversation_id) references public.conversations (user_id, id) on delete cascade
);
create index messages_user_conv_seq_idx on public.messages (user_id, conversation_id, seq asc);

-- 13. 后台任务 BackgroundTasks（画像自检与文件解析跨刷新续办）
create table public.background_tasks (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('portrait_generate', 'assessment_parse')),
  target_ref text not null,
  status text not null default 'running' check (status in ('pending', 'running', 'completed', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 14. 安全事件 SafetyEvent（严格脱敏，绝不保存用户原话）
create table public.safety_events (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  level text not null check (level in ('低', '中', '高')),
  trigger_skill text not null default '',
  signal_category text not null,
  action_taken text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (user_id, id)
);

-- 15. 变更日志 ChangeLog 与 调参日志 TuningLog
create table public.change_logs (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  target_type text not null,
  target_id text not null,
  action text not null,
  summary text not null default '',
  before_state jsonb,
  after_state jsonb,
  actor text not null default '系统',
  reason text,
  request_id text,
  undo_payload jsonb,
  undone boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, request_id)
);
create index change_logs_user_target_idx on public.change_logs (user_id, target_id, created_at desc);

create table public.tuning_logs (
  user_id uuid not null references auth.users on delete cascade,
  id uuid not null default gen_random_uuid(),
  clue_id uuid not null,
  level_at_time text not null,
  user_feedback text not null check (user_feedback in ('不像我', '早该成立', '部分认同改写', '其他')),
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 16. 全面启用 RLS 用户数据隔离（服务端 Service Role 通过显式 user_id 校验访问，客户端直连严格限制本人）
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'user_profiles', 'progress', 'stories', 'clues', 'evidence', 'clue_merges',
    'value_rankings', 'assessments', 'energy_logs', 'feedback_requests',
    'feedback_responses', 'portraits', 'conversations', 'messages',
    'background_tasks', 'safety_events', 'change_logs', 'tuning_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon', tbl);
    execute format('grant select on public.%I to authenticated', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      tbl || '_owner_isolation',
      tbl
    );
  end loop;
end
$$;
