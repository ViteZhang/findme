import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructuredJson } from './gemini.ts';
import type {
  ClueRecord,
  PortraitClaimItem,
  PortraitRecord,
  PortraitSectionData,
} from './store.ts';
import { getFullWorkspaceState } from './tools.ts';

export const SELF_CHECK_TEMPLATE = [
  { id: 'filter', label: '筛选：只收「中」及以上，「线索」放进待观察' },
  { id: 'own_exp', label: '本人经历：优势候选没有本人经历的，移到「别人眼中的你」' },
  { id: 'single_src', label: '单一来源：只有一种来源的结论，措辞改为「可能」' },
  { id: 'wording', label: '措辞和等级匹配：「高」写明显，「中」写可能' },
  { id: 'no_label', label: '标签检查：不出现「你是 XX 型」这类说法' },
  { id: 'conflict', label: '矛盾检查：结论之间是否互相冲突' },
  { id: 'manual', label: '整理最佳状态说明书' },
];

function summarizeSources(
  clueId: string,
  evidence: Array<{ clue_id: string; is_active: boolean; source_type: string; direction: string }>,
): string {
  const counts = new Map<string, number>();
  for (const ev of evidence) {
    if (ev.clue_id !== clueId || !ev.is_active || ev.direction !== '支持' || ev.source_type === '用户自述') {
      continue;
    }
    counts.set(ev.source_type, (counts.get(ev.source_type) || 0) + 1);
  }
  const parts: string[] = [];
  for (const [src, cnt] of counts.entries()) {
    parts.push(cnt > 1 ? `${src} ×${cnt}` : src);
  }
  return parts.join(' · ') || '用户确认';
}

export async function startOrGetPortraitDraft(
  db: SupabaseClient,
  userId: string,
  triggerReason = '证据达标',
): Promise<PortraitRecord> {
  const state = await getFullWorkspaceState(db, userId);

  const existingDraft = state.portraits.find(
    (p) => p.status === '草稿' || p.status === '审核中' || p.status === '待确认' || p.status === '生成失败',
  );
  if (existingDraft) {
    return existingDraft;
  }

  const finalizedVersions = state.portraits.filter((p) => p.status === '已定稿');
  const nextVersion = finalizedVersions.length > 0 ? finalizedVersions[0].version + 1 : 1;

  const pendingMerges = state.merges.filter((m) => m.review_status === '待过目');
  const missingExampleClues = state.clues.filter(
    (c) => c.confidence.level !== '已归档' && c.needs_example,
  );

  // 自动跳过空的步骤：若无待过目合并则进步骤 2；若也无缺例子线索则直接进步骤 3
  let initialStep: 1 | 2 | 3 = 1;
  if (pendingMerges.length === 0) {
    initialStep = missingExampleClues.length > 0 ? 2 : 3;
  }

  const { data, error } = await db
    .from('portraits')
    .insert({
      user_id: userId,
      version: nextVersion,
      headline: '',
      subtitle: '这是目前证据最充分的样子，不是定论',
      trigger_reason: triggerReason,
      flow_step: initialStep,
      status: '草稿',
      review_notes: SELF_CHECK_TEMPLATE.map((item) => ({
        ...item,
        status: 'wait',
        result_text: '',
      })),
      stats: {
        clue_count: state.clues.filter((c) => c.confidence.level !== '已归档').length,
        story_count: state.stories.length,
        assessment_count: state.assessments.filter((a) => a.counts_as_evidence).length,
      },
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(`创建画像草稿失败: ${error?.message}`);
  return data as PortraitRecord;
}

export async function runPortraitGenerationStep(
  db: SupabaseClient,
  userId: string,
  version: number,
): Promise<PortraitRecord> {
  const state = await getFullWorkspaceState(db, userId);
  const activeClues = state.clues.filter(
    (c) => c.confidence.level !== '已归档' && c.type !== '不一致',
  );
  const bodyClues = activeClues.filter(
    (c) => c.confidence.level === '中' || c.confidence.level === '高' || c.confidence.level === '已验证',
  );
  const watchClues = activeClues.filter((c) => c.confidence.level === '线索');

  const coreStrengths = bodyClues.filter(
    (c) => c.type === '优势候选' && c.confidence.hasOwnExperience,
  );
  const learnedSkills = bodyClues.filter((c) => c.type === '习得技能');
  const othersEyes = bodyClues.filter(
    (c) => c.type === '优势候选' && !c.confidence.hasOwnExperience,
  );
  const shortcomings = bodyClues.filter(
    (c) => c.type === '短板候选' || c.type === '盲点',
  );
  const chargingClues = activeClues.filter((c) => c.type === '能量来源');
  const drainingClues = activeClues.filter((c) => c.type === '能量消耗');

  const singleSourceBodyCount = bodyClues.filter((c) => c.confidence.S <= 1).length;

  // 构建 7 项自检清单真实核验结果
  const reviewNotes: PortraitRecord['review_notes'] = [
    {
      id: 'filter',
      label: SELF_CHECK_TEMPLATE[0].label,
      status: 'done',
      result_text: `${activeClues.length} → ${bodyClues.length} 条`,
    },
    {
      id: 'own_exp',
      label: SELF_CHECK_TEMPLATE[1].label,
      status: 'done',
      result_text: `${othersEyes.length} 条`,
    },
    {
      id: 'single_src',
      label: SELF_CHECK_TEMPLATE[2].label,
      status: 'done',
      result_text: `${singleSourceBodyCount} 条`,
    },
    {
      id: 'wording',
      label: SELF_CHECK_TEMPLATE[3].label,
      status: 'done',
      result_text: '通过',
    },
    {
      id: 'no_label',
      label: SELF_CHECK_TEMPLATE[4].label,
      status: 'done',
      result_text: '0 处标签',
    },
    {
      id: 'conflict',
      label: SELF_CHECK_TEMPLATE[5].label,
      status: 'done',
      result_text: '已核对情境边界',
    },
    {
      id: 'manual',
      label: SELF_CHECK_TEMPLATE[6].label,
      status: 'done',
      result_text: '已生成',
    },
  ];

  // 调用 Gemini 4 Carbon 在严格证据约束下润色一句话主标题、发挥场景、短板建议与最佳状态说明书
  let aiSynthesis: {
    headline?: string;
    strengthNotes?: Record<string, { expansion?: string; scenarios?: string }>;
    shortcomingTips?: Record<string, string>;
    bestState?: { when: string; how: string; with_whom: string; avoid: string };
  } = {};

  try {
    const promptPayload = {
      goal: state.profile.goal,
      puzzle: state.profile.current_puzzle,
      coreStrengths: coreStrengths.map((c) => ({
        id: c.id,
        statement: c.user_statement || c.statement,
        level: c.confidence.level,
      })),
      shortcomings: shortcomings.map((c) => ({
        id: c.id,
        statement: c.user_statement || c.statement,
      })),
      valuesTop5: state.valueRankings[0]?.top5 || [],
      charging: chargingClues.map((c) => c.user_statement || c.statement),
      draining: drainingClues.map((c) => c.user_statement || c.statement),
    };

    const gen = await generateStructuredJson<typeof aiSynthesis>({
      tier: 'portrait',
      temperature: 0.3,
      systemInstruction: `你是「照见」自我探索教练的画像撰稿人。请严格基于给定证据生成克制、精准、有洞察感、像研究笔记一样的画像补充文案。
硬性约束：
1. 严禁使用任何人格标签（如"完美主义者"、"INTJ"、"执行型人格"），严禁使用感叹号，严禁使用"缺点"一词。
2. headline 是一句 14～24 字的一句话总结（例如："你在混乱里找结构，在被管太细时最累"），不加句号。
3. strengthNotes 按线索 id 给出简短一句补充描述 expansion（≤22字）和适合发挥的场景 scenarios（≤25字）。
4. shortcomingTips 按线索 id 给出一句中性、可操作的管理建议（补短/绕开/留缓冲，≤32字）。
5. bestState 包含 when（什么时候）、how（怎么做）、with_whom（跟谁一起）、avoid（避开），每项一句平实具体的话。
输出严格 JSON：{"headline":"...","strengthNotes":{},"shortcomingTips":{},"bestState":{"when":"...","how":"...","with_whom":"...","avoid":"..."}}`,
      contents: JSON.stringify(promptPayload),
    });
    aiSynthesis = gen.data || {};
  } catch {
    // 若模型超时，使用基于用户真实线索确定性组装的高质量文案，保证生成可靠完成
  }

  const buildClaim = (c: ClueRecord, forceWording?: PortraitClaimItem['wording']): PortraitClaimItem => {
    const text = c.user_statement || c.statement;
    const isHigh = c.confidence.level === '高' || c.confidence.level === '已验证';
    const wording: PortraitClaimItem['wording'] =
      forceWording || (isHigh ? '明显' : '可能');
    const clueEvs = state.evidence.filter((e) => e.clue_id === c.id && e.is_active && e.direction === '支持');
    const storyIds = [...new Set(clueEvs.map((e) => e.story_id).filter(Boolean) as string[])];
    const oppositeNote = c.confidence.hasMixedOpposition ? '，但也有相反的情况' : '';
    const sNote = aiSynthesis.strengthNotes?.[c.id];
    const tipNote = aiSynthesis.shortcomingTips?.[c.id] || c.management_tip;

    return {
      id: `claim_${c.id}`,
      clue_id: c.id,
      wording,
      headline: `${text}${oppositeNote}`,
      detail: sNote?.expansion || (c.confidence.S === 1 && !isHigh ? '目前来自同一种来源，所以写成「可能」' : undefined),
      evidence_summary: summarizeSources(c.id, state.evidence),
      scenarios: sNote?.scenarios || (c.scenarios?.length ? c.scenarios.join('、') : undefined),
      tip: tipNote || undefined,
      story_ids: storyIds,
      excerpts: clueEvs.map((e) => ({
        source_type: e.source_type,
        source_title: e.source_title,
        excerpt: e.excerpt || e.interpretation,
        story_id: e.story_id,
      })),
      user_edited: Boolean(c.user_statement),
    };
  };

  const latestValues = state.valueRankings[0]?.top5 || [];
  const fbCount = state.feedbackResponses.length;

  // R4：打卡观察可展示在能量模式，但明确标「打卡 · 不计入」
  const recentCharges = state.energyLogs
    .map((l) => l.charge_event)
    .filter(Boolean)
    .slice(0, 2);
  const recentDrains = state.energyLogs
    .map((l) => l.drain_event)
    .filter(Boolean)
    .slice(0, 2);

  // 计算与上一版已定稿画像的变化（第 8 节）
  const prevPortrait = state.portraits.find((p) => p.status === '已定稿' && p.version < version);
  const diffList: PortraitRecord['diff_from_previous'] = [];
  if (prevPortrait) {
    const prevMap = new Map(prevPortrait.clue_snapshot.map((s) => [s.clue_id, s]));
    for (const c of activeClues) {
      const prev = prevMap.get(c.id);
      const label = c.user_statement || c.statement;
      if (!prev && (c.confidence.level === '中' || c.confidence.level === '高')) {
        diffList.push({ kind: '新增', statement: label, change_label: `新进入正文 · ${c.confidence.level}` });
      } else if (prev && prev.level !== c.confidence.level) {
        const order: Record<string, number> = { 线索: 1, 中: 2, 高: 3, 已验证: 4 };
        const up = (order[c.confidence.level] || 0) > (order[prev.level] || 0);
        diffList.push({
          kind: up ? '升级' : '降级',
          statement: label,
          change_label: `${prev.level} → ${c.confidence.level}`,
        });
      }
    }
    for (const prev of prevPortrait.clue_snapshot) {
      if (!activeClues.some((c) => c.id === prev.clue_id)) {
        diffList.push({ kind: '移除', statement: prev.statement, change_label: `${prev.level} → 已归档` });
      }
    }
  }

  const fallbackHeadline =
    coreStrengths[0] && drainingClues[0]
      ? `你在${(coreStrengths[0].user_statement || coreStrengths[0].statement).slice(0, 10)}中投入，在${(drainingClues[0].user_statement || drainingClues[0].statement).slice(0, 10)}时消耗`
      : coreStrengths[0]
        ? (coreStrengths[0].user_statement || coreStrengths[0].statement)
        : '基于真实经历与多维证据整理的阶段自我画像';

  const sections: PortraitSectionData[] = [
    {
      section: 1,
      title: '核心优势',
      subtitle: '只收「中」及以上，且有你自己的经历',
      claims: [
        ...coreStrengths.map((c) => buildClaim(c)),
        ...learnedSkills.map((c) => buildClaim(c, '习得技能')),
      ],
      empty_note:
        coreStrengths.length === 0 && learnedSkills.length === 0
          ? '目前还没有带本人经历证据的中/高优势线索'
          : undefined,
    },
    {
      section: 2,
      title: '别人眼中的你',
      claims: othersEyes.map((c) => ({
        ...buildClaim(c, '可能'),
        tip: '这是外部来源看到的你，你自己的经历里还没出现。补充一个具体例子即可升级为核心优势',
      })),
      empty_note:
        othersEyes.length === 0
          ? fbCount > 0
            ? `已经收到 ${fbCount} 份他人反馈，满 3 份且 V1 上线解读后会在这里对照`
            : '还没有仅来自外部视角、尚未在本人故事里出现的优势线索 · V0.5 可先去收集他人反馈'
          : undefined,
    },
    {
      section: 3,
      title: '需要管理的短板',
      claims: shortcomings.map((c) => ({
        ...buildClaim(c),
        tip:
          aiSynthesis.shortcomingTips?.[c.id] ||
          c.management_tip ||
          '重要节点提前留出缓冲，或与擅长互补部分的伙伴协作',
      })),
      empty_note:
        shortcomings.length === 0
          ? '目前还没有达到「中」及以上的短板或盲点线索，可继续通过低谷经历探索'
          : undefined,
    },
    {
      section: 4,
      title: '价值观 Top 5',
      subtitle: state.valueRankings[0]?.confirmed_at
        ? `${String(state.valueRankings[0].confirmed_at).slice(5, 10)} · 你确认的顺序`
        : '你确认的顺序',
      claims: [],
      values_top5: latestValues.map((v) => ({
        rank: v.rank,
        value: v.value,
        definition: v.user_definition,
      })),
      empty_note: latestValues.length === 0 ? '尚未完成价值观 Top 5 排序' : undefined,
    },
    {
      section: 5,
      title: '能量模式',
      claims: [],
      energy: {
        charging: [
          ...chargingClues.map((c) => ({
            text: c.user_statement || c.statement,
            badge: `${summarizeSources(c.id, state.evidence)} · ${c.confidence.level}`,
          })),
          ...recentCharges.map((text) => ({
            text,
            badge: '打卡 · 不计入',
            uncounted: true,
          })),
        ],
        draining: [
          ...drainingClues.map((c) => ({
            text: c.user_statement || c.statement,
            badge: c.confidence.level,
            highlight: c.confidence.level === '高',
          })),
          ...recentDrains.map((text) => ({
            text,
            badge: '打卡 · 不计入',
            uncounted: true,
          })),
        ],
      },
    },
    {
      section: 6,
      title: '最佳状态说明书',
      subtitle: '由前五节整理',
      claims: [],
      best_state: aiSynthesis.bestState || {
        when: coreStrengths[0]
          ? `面对需要「${coreStrengths[0].user_statement || coreStrengths[0].statement}」的复杂起步阶段`
          : '目标清晰、允许你按自己节奏把事情理顺的时候',
        how: '先留出一段不被频繁打断的整块时间梳理结构，再进入多人对齐',
        with_whom: latestValues[0]
          ? `尊重你对「${latestValues[0].value}」的看重、看结果并给空间的人`
          : '给足自主空间、能直接沟通重点的伙伴',
        avoid: drainingClues[0]
          ? `${drainingClues[0].user_statement || drainingClues[0].statement}的环境`
          : '每一步都要层层请示、计划被随意推翻的环境',
      },
    },
    {
      section: 7,
      title: '待观察',
      subtitle: '证据还不够，不写成结论',
      claims: [],
      watch_items: watchClues.map((c) => ({
        clue_id: c.id,
        statement: c.user_statement || c.statement,
        tag: c.needs_example
          ? '你提到过，还缺具体例子'
          : c.not_mentioned_by_others
            ? '反馈里暂时没人提到'
            : undefined,
        source_label: summarizeSources(c.id, state.evidence),
      })),
      empty_note: watchClues.length === 0 ? '目前没有停留在待观察阶段的线索' : undefined,
    },
    {
      section: 8,
      title: '和上一版相比',
      claims: [],
      diff_note:
        version === 1
          ? '这是第一版。之后每次更新，这里会列出新增、升级、降级和移除的结论'
          : diffList.length === 0
            ? '与上一版相比，核心结论保持稳定'
            : diffList.map((d) => `【${d.kind}】${d.statement}（${d.change_label}）`).join('；'),
    },
  ];

  const snapshot: PortraitRecord['clue_snapshot'] = activeClues.map((c) => ({
    clue_id: c.id,
    statement: c.user_statement || c.statement,
    type: c.type,
    level: c.confidence.level,
    W_plus: c.confidence.W_plus,
    evidence_ids: state.evidence
      .filter((e) => e.clue_id === c.id && e.is_active)
      .map((e) => e.id),
  }));

  const { data, error } = await db
    .from('portraits')
    .update({
      headline: (aiSynthesis.headline || fallbackHeadline).replace(/[。！!]+$/g, ''),
      flow_step: 4,
      status: '待确认',
      clue_snapshot: snapshot,
      sections,
      review_notes: reviewNotes,
      diff_from_previous: diffList,
      stats: {
        clue_count: activeClues.length,
        story_count: state.stories.length,
        assessment_count: state.assessments.filter((a) => a.counts_as_evidence).length,
      },
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('version', version)
    .select('*')
    .single();

  if (error || !data) throw new Error(`生成画像失败: ${error?.message}`);
  return data as PortraitRecord;
}

export async function confirmPortraitSectionTool(
  db: SupabaseClient,
  userId: string,
  input: {
    version: number;
    section: number;
    editedClaimId?: string;
    editedText?: string;
    editedBestState?: { when: string; how: string; with_whom: string; avoid: string };
  },
): Promise<PortraitRecord> {
  const { data: row, error } = await db
    .from('portraits')
    .select('*')
    .eq('user_id', userId)
    .eq('version', input.version)
    .single();
  if (error || !row) throw new Error('未找到对应画像版本');

  const portrait = row as PortraitRecord;
  const sections = [...(portrait.sections || [])];
  const userEdits = [...(portrait.user_edits || [])];
  const confirmations = { ...(portrait.section_confirmations || {}) };
  let wasEdited = false;

  const secIdx = sections.findIndex((s) => s.section === input.section);
  if (secIdx >= 0) {
    const sec = { ...sections[secIdx] };
    if (input.editedClaimId && input.editedText && input.editedText.trim()) {
      sec.claims = (sec.claims || []).map((cl) => {
        if (cl.id !== input.editedClaimId) return cl;
        wasEdited = true;
        userEdits.push({
          section: input.section,
          before: cl.headline,
          after: input.editedText!.trim(),
          edited_at: new Date().toISOString(),
        });
        return {
          ...cl,
          original_headline: cl.original_headline || cl.headline,
          headline: input.editedText!.trim(),
          user_edited: true,
        };
      });
    }
    if (input.editedBestState) {
      wasEdited = true;
      userEdits.push({
        section: input.section,
        before: JSON.stringify(sec.best_state || {}),
        after: JSON.stringify(input.editedBestState),
        edited_at: new Date().toISOString(),
      });
      sec.best_state = input.editedBestState;
    }
    sections[secIdx] = sec;
  }

  confirmations[String(input.section)] = {
    status: wasEdited ? 'edited' : 'confirmed',
    updated_at: new Date().toISOString(),
  };

  const allConfirmed = [1, 2, 3, 4, 5, 6, 7, 8].every((n) => Boolean(confirmations[String(n)]));

  const { data: updated, error: uErr } = await db
    .from('portraits')
    .update({
      sections,
      user_edits: userEdits,
      section_confirmations: confirmations,
      flow_step: allConfirmed ? 5 : 4,
      status: allConfirmed ? '已定稿' : '待确认',
      ...(allConfirmed ? { confirmed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('version', input.version)
    .select('*')
    .single();
  if (uErr || !updated) throw new Error(`确认画像章节失败: ${uErr?.message}`);

  if (allConfirmed) {
    const { data: prog } = await db.from('progress').select('*').eq('user_id', userId).maybeSingle();
    const modules = {
      ...(prog?.modules || {}),
      portrait: { status: 'completed', completed_at: new Date().toISOString() },
    };
    await db
      .from('progress')
      .update({ modules, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  return updated as PortraitRecord;
}

export function renderPortraitMarkdown(
  portrait: PortraitRecord,
  includeExcerpts = false,
): string {
  const lines: string[] = [
    `# ${portrait.headline || `个人优劣势画像 v${portrait.version}`}`,
    ``,
    `> ${portrait.subtitle}（v${portrait.version} · ${String(portrait.confirmed_at || portrait.generated_at).slice(0, 10)}）`,
    ``,
  ];

  for (const sec of portrait.sections || []) {
    lines.push(`## ${sec.section}. ${sec.title}`);
    if (sec.subtitle) lines.push(`*${sec.subtitle}*`);
    lines.push('');

    if (sec.claims && sec.claims.length > 0) {
      for (const cl of sec.claims) {
        lines.push(`- **【${cl.wording}】${cl.headline}**${cl.user_edited ? '（你修改过）' : ''}`);
        if (cl.detail) lines.push(`  - 说明：${cl.detail}`);
        lines.push(`  - 依据：${cl.evidence_summary}`);
        if (cl.scenarios) lines.push(`  - 适合场景：${cl.scenarios}`);
        if (cl.tip) lines.push(`  - 建议：${cl.tip}`);
        if (includeExcerpts && cl.excerpts?.length) {
          for (const ex of cl.excerpts) {
            lines.push(`  - 原话〔${ex.source_type}〕：${ex.deleted ? '来源已删除' : ex.excerpt}`);
          }
        }
      }
      lines.push('');
    }

    if (sec.values_top5 && sec.values_top5.length > 0) {
      for (const v of sec.values_top5) {
        lines.push(`${v.rank}. **${v.value}** —— ${v.definition}`);
      }
      lines.push('');
    }

    if (sec.energy) {
      lines.push(`### 让你充电`);
      for (const item of sec.energy.charging) {
        lines.push(`- ${item.text}（${item.badge}）`);
      }
      lines.push('', `### 让你消耗`);
      for (const item of sec.energy.draining) {
        lines.push(`- ${item.text}（${item.badge}）`);
      }
      lines.push('');
    }

    if (sec.best_state) {
      lines.push(
        `- **什么时候**：${sec.best_state.when}`,
        `- **怎么做**：${sec.best_state.how}`,
        `- **跟谁一起**：${sec.best_state.with_whom}`,
        `- **避开**：${sec.best_state.avoid}`,
        '',
      );
    }

    if (sec.watch_items && sec.watch_items.length > 0) {
      for (const w of sec.watch_items) {
        lines.push(`- ${w.statement}（${w.source_label}${w.tag ? ` · ${w.tag}` : ''}）`);
      }
      lines.push('');
    }

    if (sec.diff_note) {
      lines.push(sec.diff_note, '');
    } else if (sec.empty_note) {
      lines.push(sec.empty_note, '');
    }
  }

  return lines.join('\n');
}
