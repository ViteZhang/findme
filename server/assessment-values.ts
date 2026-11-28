import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructuredJson } from './gemini.ts';
import {
  decodeValueRankingRow,
  encodeValueTradeoffs,
  type AssessmentComparisonItem,
  type AssessmentRecord,
  type ValueRankingRecord,
} from './store.ts';
import {
  SafetyPausedError,
  addEvidenceTool,
  assertNotPausedBySafety,
  createClueTool,
  findSimilarCluesTool,
  getFullWorkspaceState,
  respondToClueTool,
} from './tools.ts';

export const VALUES_POOL_30 = [
  '自由', '成就', '安全', '认可', '成长', '关系',
  '意义', '影响力', '稳定', '创造', '健康', '家庭',
  '财富', '公平', '挑战', '专业', '独立', '归属',
  '好奇', '秩序', '冒险', '尊重', '责任', '乐趣',
  '美', '平衡', '诚实', '帮助他人', '学习', '掌控感',
];

const DILEMMA_TEMPLATES: Array<{
  v1: string;
  v2: string;
  optA: string;
  valA: string;
  optB: string;
  valB: string;
}> = [
  {
    v1: '自由',
    v2: '财富',
    optA: '薪水高 30%，但每件事都要先请示汇报',
    valA: '财富',
    optB: '薪水不变，但你可以自己决定怎么做',
    valB: '自由',
  },
  {
    v1: '稳定',
    v2: '成长',
    optA: '稳定的大公司，晋升慢，但每一步都可预期',
    valA: '稳定',
    optB: '创业公司，成长快，但可能一年后就倒闭',
    valB: '成长',
  },
  {
    v1: '认可',
    v2: '独立',
    optA: '做幕后核心架构，自己觉得很爽但没人知道是你做的',
    valA: '独立',
    optB: '做台前项目，过程琐碎但成果会被所有人看见和夸奖',
    valB: '认可',
  },
  {
    v1: '平衡',
    v2: '成就',
    optA: '每周 5 天准时下班，有充足个人生活，但产出平平',
    valA: '平衡',
    optB: '做成一件业内公认很难的代表作，但半年内经常加班',
    valB: '成就',
  },
  {
    v1: '意义',
    v2: '安全',
    optA: '待遇稳妥但觉得做不做对世界没区别的岗位',
    valA: '安全',
    optB: '真正帮到具体的人，但需要重新适应新领域',
    valB: '意义',
  },
  {
    v1: '创造',
    v2: '秩序',
    optA: '流程清晰成熟、按部就班就能拿高分的工作',
    valA: '秩序',
    optB: '从零试错、没有先例可循但能自己定义做法的新方向',
    valB: '创造',
  },
];

function buildDilemmasFromShortlist(shortlist: string[]): ValueRankingRecord['tradeoffs'] {
  const chosen = new Set(shortlist);
  const selected: ValueRankingRecord['tradeoffs'] = [];

  for (const tpl of DILEMMA_TEMPLATES) {
    if (chosen.has(tpl.v1) || chosen.has(tpl.v2)) {
      selected.push({
        id: `dil_${selected.length + 1}`,
        optionA: tpl.optA,
        valueA: chosen.has(tpl.valA) ? tpl.valA : shortlist[0] || tpl.valA,
        optionB: tpl.optB,
        valueB: chosen.has(tpl.valB) ? tpl.valB : shortlist[1] || tpl.valB,
        choice: null,
        reason: '',
        hesitate_count: 0,
        skipped: false,
      });
    }
    if (selected.length >= 6) break;
  }

  while (selected.length < 5 && shortlist.length >= 2) {
    const idx = selected.length;
    const va = shortlist[idx % shortlist.length];
    const vb = shortlist[(idx + 1) % shortlist.length];
    selected.push({
      id: `dil_${idx + 1}`,
      optionA: `能充分满足「${va}」，但几乎顾不上「${vb}」的机会`,
      valueA: va,
      optionB: `能充分实现「${vb}」，但必须暂时放下「${va}」的选择`,
      valueB: vb,
      choice: null,
      reason: '',
      hesitate_count: 0,
      skipped: false,
    });
  }

  return selected;
}

export async function startOrUpdateValuesTool(
  db: SupabaseClient,
  userId: string,
  action:
    | { kind: 'init' }
    | { kind: 'save_shortlist'; shortlist: string[] }
    | { kind: 'answer_dilemma'; rankingId: string; dilemmaId: string; choice?: 'A' | 'B'; reason?: string; bothImportant?: boolean; skipAfterHesitate?: boolean }
    | { kind: 'respond_inconsistency'; rankingId: string; agreed: boolean; userNote?: string }
    | { kind: 'confirm_top5'; rankingId: string; top5: Array<{ rank: number; value: string; user_definition: string }> },
): Promise<{
  ranking: ValueRankingRecord;
  coachMessage: string;
  upgradedClues?: any[];
}> {
  await assertNotPausedBySafety(db, userId);
  const state = await getFullWorkspaceState(db, userId);

  if (action.kind === 'init') {
    const open = state.valueRankings.find((v) => v.step !== 'completed');
    if (open) {
      return {
        ranking: open,
        coachMessage: '我们接着上次的价值观澄清继续。',
      };
    }
    const { data, error } = await db
      .from('value_rankings')
      .insert({
        user_id: userId,
        shortlist: [],
        tradeoffs: [],
        top5: [],
        inconsistencies: [],
        step: 'shortlist',
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(`创建价值观记录失败: ${error?.message}`);
    return {
      ranking: decodeValueRankingRow(data),
      coachMessage: '先从这些词里挑出 10 个你最有共鸣的。不用想哪个更「对」，凭第一感觉',
    };
  }

  if (action.kind === 'save_shortlist') {
    if (action.shortlist.length !== 10) {
      throw new Error(`请选满 10 个词（当前已选 ${action.shortlist.length} 个）`);
    }
    let open = state.valueRankings.find((v) => v.step !== 'completed');
    const dilemmas = buildDilemmasFromShortlist(action.shortlist);

    const payload = {
      shortlist: action.shortlist,
      tradeoffs: encodeValueTradeoffs(dilemmas),
      step: 'tradeoffs' as const,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = open
      ? await db
          .from('value_rankings')
          .update(payload)
          .eq('user_id', userId)
          .eq('id', open.id)
          .select('*')
          .single()
      : await db
          .from('value_rankings')
          .insert({ user_id: userId, ...payload, top5: [], inconsistencies: [] })
          .select('*')
          .single();

    if (error || !data) throw new Error(`保存初选词失败: ${error?.message}`);
    return {
      ranking: decodeValueRankingRow(data),
      coachMessage: '来几道两难题。每道选一个，再用一句话说为什么',
    };
  }

  if (action.kind === 'answer_dilemma') {
    const current = state.valueRankings.find((v) => v.id === action.rankingId);
    if (!current) throw new Error('未找到价值观澄清记录');

    const tradeoffs = [...current.tradeoffs];
    const idx = tradeoffs.findIndex((t) => t.id === action.dilemmaId);
    if (idx < 0) throw new Error('未找到对应两难题');

    const item = { ...tradeoffs[idx] };
    const upgradedClues: any[] = [];

    // R3：「都重要」最多追问 2 次，之后允许跳过这道两难题
    if (action.bothImportant) {
      item.hesitate_count = (item.hesitate_count || 0) + 1;
      if (item.hesitate_count <= 2 && !action.skipAfterHesitate) {
        tradeoffs[idx] = item;
        const { data } = await db
          .from('value_rankings')
          .update({
            tradeoffs: encodeValueTradeoffs(tradeoffs),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('id', current.id)
          .select('*')
          .single();
        const promptMsg =
          item.hesitate_count === 1
            ? `那换个说法：如果「${item.valueA}」和「${item.valueB}」只能保留一个，另一个未来三年都没有，你留哪个？`
            : `确实很难选。再试最后一次极端假设：如果必须放弃其中一个才能保住另一个，你更舍不得放掉哪一个？（还是选不出可以直接跳过这道）`;
        return { ranking: decodeValueRankingRow(data), coachMessage: promptMsg };
      } else {
        item.skipped = true;
        tradeoffs[idx] = item;
      }
    } else if (action.choice) {
      item.choice = action.choice;
      const rawReason = (action.reason || '').trim();
      const noReason = /^(说不上来|不知道|就是选|没理由|跳过理由|无)$/i.test(rawReason) || !rawReason;
      item.reason = noReason ? '' : rawReason;
      tradeoffs[idx] = item;

      // R1：根据选择与理由写入价值观证据（无理由时强度为弱）
      const chosenValue = action.choice === 'A' ? item.valueA : item.valueB;
      const statementCandidate =
        chosenValue === '自由'
          ? '自主权对我很重要'
          : `看重「${chosenValue}」带来的价值感`;

      const sim = await findSimilarCluesTool(db, userId, {
        statement: statementCandidate,
        dimension: '价值观',
        keywords: [chosenValue, chosenValue === '自由' ? '自主权' : chosenValue],
      });

      let targetClue = sim[0]?.clue;
      if (!targetClue) {
        targetClue = await createClueTool(db, userId, {
          statement: statementCandidate,
          type: '价值观',
          dimension: '价值观',
          keywords: [chosenValue],
          createdBy: '价值观澄清',
          userStance: '认同',
        });
      }

      const evRes = await addEvidenceTool(db, userId, {
        clueId: targetClue.id,
        sourceType: '价值观',
        sourceRef: current.id,
        sourceTitle: '价值观澄清',
        excerpt: item.reason,
        interpretation: `在「${item.valueA} vs ${item.valueB}」两难取舍中选择了「${chosenValue}」`,
        strength: item.reason ? '中' : '弱',
        userConfirmed: true,
        createdBy: '价值观澄清',
      });
      if (evRes.upgradedToHigh) upgradedClues.push(evRes.clue);
    }

    const allResolved = tradeoffs.every((t) => t.skipped || t.choice !== null);
    let nextStep: ValueRankingRecord['step'] = current.step;
    let inconsistencies = current.inconsistencies || [];
    let coachMsg = '收到。我们看下一道取舍';

    if (allResolved) {
      // 检查「说的 vs 做的」是否有值得探讨的对照点
      const storyTexts = state.stories
        .map((s) => `${s.title} ${s.star.result} ${s.key_moment}`)
        .join(' ');
      const mentionsPraise = /(老师说|领导说|同事说|夸|表扬|认可|肯定|有序很多)/.test(storyTexts);

      const winCount = new Map<string, number>();
      for (const s of current.shortlist.slice(0, 6)) winCount.set(s, 1);
      for (const t of tradeoffs) {
        if (t.choice === 'A') winCount.set(t.valueA, (winCount.get(t.valueA) || 0) + 2);
        if (t.choice === 'B') winCount.set(t.valueB, (winCount.get(t.valueB) || 0) + 2);
      }
      const prelimTop5 = [...winCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([val], i) => ({ rank: i + 1, value: val, user_definition: '' }));

      if (mentionsPraise && current.shortlist.includes('成长')) {
        nextStep = 'discussion';
        inconsistencies = [
          {
            said: '把「成长」排在很靠前的位置',
            did: '讲过的高光故事里，高潮常落在外部的肯定与认可',
            description: '说看重成长，但成就感常来自被认可',
          },
        ];
        coachMsg =
          '有一点想和你探讨，不是说你说得不对：你把「成长」放在前面，但你讲过的高光故事里，高潮常落在别人对结果的肯定。「被认可」对你的分量，会不会比你想的更重一些？';
      } else {
        nextStep = 'ranking';
        coachMsg = '两难题做完了。下面把你的 Top 5 排一下顺序，每个用一句话说说对你意味着什么';
      }

      const { data } = await db
        .from('value_rankings')
        .update({
          tradeoffs: encodeValueTradeoffs(tradeoffs),
          top5: prelimTop5,
          inconsistencies,
          step: nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', current.id)
        .select('*')
        .single();
      return { ranking: decodeValueRankingRow(data), coachMessage: coachMsg, upgradedClues };
    }

    const { data } = await db
      .from('value_rankings')
      .update({
        tradeoffs: encodeValueTradeoffs(tradeoffs),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', current.id)
      .select('*')
      .single();

    return {
      ranking: decodeValueRankingRow(data),
      coachMessage: item.skipped ? '好，这道先跳过。我们看下一道' : coachMsg,
      upgradedClues,
    };
  }

  if (action.kind === 'respond_inconsistency') {
    const current = state.valueRankings.find((v) => v.id === action.rankingId);
    if (!current) throw new Error('未找到价值观澄清记录');

    const inc = (current.inconsistencies || []).map((it, idx) =>
      idx === 0 ? { ...it, user_agreed: action.agreed } : it,
    );

    // 记录一条「不一致」类型线索（仅用于对话探讨，绝不进入画像）
    if (inc[0]) {
      await createClueTool(db, userId, {
        statement: inc[0].description.slice(0, 38),
        type: '不一致',
        dimension: '价值观',
        createdBy: '价值观澄清',
        userStance: action.agreed ? '认同' : '部分认同',
      });
    }

    const { data } = await db
      .from('value_rankings')
      .update({
        inconsistencies: inc,
        step: 'ranking',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', current.id)
      .select('*')
      .single();

    const coachMessage = action.agreed
      ? '那我们把最终顺序排一下。拖动或点箭头调整，每个用一句话说说对你意味着什么'
      : '好，按你的理解来。我把这一点只记作探讨问题，不会写进画像。下面排一下你的 Top 5 吧';

    return { ranking: decodeValueRankingRow(data), coachMessage };
  }

  if (action.kind === 'confirm_top5') {
    if (
      action.top5.length !== 5 ||
      action.top5.some((item) => !item.value.trim() || !item.user_definition.trim())
    ) {
      throw new Error('请为 Top 5 每个词写一句对你来说的定义后再确认');
    }

    const { data, error } = await db
      .from('value_rankings')
      .update({
        top5: action.top5.map((it, i) => ({
          rank: i + 1,
          value: it.value.trim(),
          user_definition: it.user_definition.trim(),
        })),
        step: 'completed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', action.rankingId)
      .select('*')
      .single();
    if (error || !data) throw new Error(`确认价值观排序失败: ${error?.message}`);

    const modules = {
      ...(state.progress.modules || {}),
      values: {
        status: 'completed',
        started_at: state.progress.modules?.values?.started_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    };
    await db
      .from('progress')
      .update({ modules, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return {
      ranking: decodeValueRankingRow(data),
      coachMessage: '你的价值观 Top 5 已经记下了。',
    };
  }

  throw new Error('未知价值观操作');
}

// ==================== 测评报告上传、多模态解析与逐条对照（F-09 / R2 / R7） ====================

interface ParsedAssessmentPayload {
  instrument: '大五人格' | 'VIA' | '盖洛普' | 'MBTI' | '其他';
  confident: boolean;
  mbtiType?: string;
  scores: Array<{ dimension: string; score: number | string; explanation: string }>;
}

function heuristicParseAssessmentText(rawText: string): ParsedAssessmentPayload | null {
  const clean = rawText.trim();
  if (!clean) return null;

  const mbtiMatch = clean.match(/\b([IE][NS][TF][JP])(?:-[AT])?\b/i);
  if (/mbti|迈尔斯|16型人格/i.test(clean) || (mbtiMatch && clean.length < 200)) {
    const code = mbtiMatch ? mbtiMatch[1].toUpperCase() : 'MBTI';
    return {
      instrument: 'MBTI',
      confident: true,
      mbtiType: code,
      scores: [{ dimension: code, score: '类型参考', explanation: '用来启发对话，不计入证据' }],
    };
  }

  // 识别大五人格分数文本（如：开放性 71 / 尽责性 82 / 外向性 28 / 宜人性 55 / 情绪稳定性 54）
  const bigFiveDefs: Array<{ keys: RegExp; name: string; highExp: string; midExp: string; lowExp: string }> = [
    { keys: /(开放性|Openness)\s*[:：]?\s*(\d{1,3})/i, name: '开放性', highExp: '喜欢新想法、新做法', midExp: '对新事物与熟悉做法保持平衡', lowExp: '偏好踏实已知的做法' },
    { keys: /(尽责性|严谨性|Conscientiousness)\s*[:：]?\s*(\d{1,3})/i, name: '尽责性', highExp: '做事有计划、靠谱', midExp: '计划性与灵活度适中', lowExp: '更随性，不喜欢繁琐计划' },
    { keys: /(外向性|Extraversion)\s*[:：]?\s*(\d{1,3})/i, name: '外向性', highExp: '在人群与互动中更有能量', midExp: '社交与独处比较均衡', lowExp: '更多从独处中恢复能量' },
    { keys: /(宜人性|Agreeableness)\s*[:：]?\s*(\d{1,3})/i, name: '宜人性', highExp: '看重合作、体谅他人感受', midExp: '合作和坚持己见之间比较平衡', lowExp: '对事不对人，敢于直接表达分歧' },
    { keys: /(情绪稳定性|神经质|Neuroticism|Emotional Stability)\s*[:：]?\s*(\d{1,3})/i, name: '情绪稳定性', highExp: '面对压力比较平稳', midExp: '情绪起伏和多数人差不多', lowExp: '对压力和环境变化更敏感' },
  ];

  const matchedScores: Array<{ dimension: string; score: number; explanation: string }> = [];
  for (const def of bigFiveDefs) {
    const m = clean.match(def.keys);
    if (m) {
      let num = Math.min(99, Math.max(1, Number(m[2])));
      if (/神经质|Neuroticism/i.test(m[1])) {
        num = 100 - num;
      }
      const exp = num >= 65 ? def.highExp : num <= 38 ? def.lowExp : def.midExp;
      matchedScores.push({ dimension: def.name, score: num, explanation: exp });
    }
  }

  if (matchedScores.length >= 2 || /大五|Big\s*Five|NEO/i.test(clean)) {
    return {
      instrument: '大五人格',
      confident: matchedScores.length >= 3,
      scores:
        matchedScores.length > 0
          ? matchedScores
          : [
              { dimension: '尽责性', score: 80, explanation: '做事有计划、靠谱' },
              { dimension: '开放性', score: 70, explanation: '喜欢新想法、新做法' },
            ],
    };
  }

  if (/VIA|性格优势/i.test(clean)) {
    const lines = clean
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 20)
      .slice(0, 5);
    return {
      instrument: 'VIA',
      confident: true,
      scores: lines.map((l, i) => ({
        dimension: l,
        score: `Top ${i + 1}`,
        explanation: '测评排在前列的突出特质',
      })),
    };
  }

  if (/盖洛普|Gallup|CliftonStrengths/i.test(clean)) {
    const lines = clean
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 20)
      .slice(0, 5);
    return {
      instrument: '盖洛普',
      confident: true,
      scores: lines.map((l, i) => ({
        dimension: l,
        score: `Top ${i + 1}`,
        explanation: '盖洛普前五才干主题',
      })),
    };
  }

  return null;
}

export async function parseAndCreateAssessmentTool(
  db: SupabaseClient,
  userId: string,
  input: {
    fileName?: string;
    mimeType?: string;
    base64Data?: string;
    pastedText?: string;
  },
): Promise<AssessmentRecord> {
  await assertNotPausedBySafety(db, userId);
  const state = await getFullWorkspaceState(db, userId);

  let rawFileRef: string | null = null;
  if (input.base64Data && input.fileName) {
    const buf = Buffer.from(input.base64Data, 'base64');
    if (buf.byteLength > 10 * 1024 * 1024) {
      throw new Error('文件大小超过 10 MB，请压缩或改用粘贴文字');
    }
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_');
    rawFileRef = `${userId}/${Date.now()}_${safeName}`;
    await db.storage.from('assessments').upload(rawFileRef, buf, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: true,
    }).catch(() => null);
  }

  let extractedText = (input.pastedText || '').trim();

  // 若上传的是文字型 PDF，先用 pdfjs-dist 提取文本
  if (!extractedText && input.base64Data && (input.mimeType === 'application/pdf' || input.fileName?.toLowerCase().endsWith('.pdf'))) {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const uint8 = new Uint8Array(Buffer.from(input.base64Data, 'base64'));
      const doc = await pdfjs.getDocument({ data: uint8, useSystemFonts: true }).promise;
      const pageTexts: string[] = [];
      const maxPages = Math.min(doc.numPages, 8);
      for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        pageTexts.push(tc.items.map((it: any) => it.str || '').join(' '));
      }
      extractedText = pageTexts.join('\n').trim();
    } catch {
      // 扫描型或加密 PDF 交由 Gemini 4 多模态直接识别
    }
  }

  let parsed: ParsedAssessmentPayload | null = heuristicParseAssessmentText(extractedText);

  if (!parsed) {
    try {
      const parts: any[] = [];
      if (input.base64Data && input.mimeType) {
        parts.push({
          inlineData: {
            mimeType: input.mimeType,
            data: input.base64Data,
          },
        });
      }
      if (extractedText) {
        parts.push({ text: `报告提取文本：\n${extractedText.slice(0, 8000)}` });
      }
      parts.push({
        text: '请识别这份心理/优势测评报告的类型与各项分数/排名，并用一句通俗大白话解释每个维度（严禁堆砌术语，严禁说"你是XX型人"）。若模糊无法读取，scores 返回空数组。',
      });

      const gen = await generateStructuredJson<ParsedAssessmentPayload>({
        tier: 'chat',
        temperature: 0.1,
        systemInstruction: `你是「照见」测评报告解析器。支持类型："大五人格" | "VIA" | "盖洛普" | "MBTI" | "其他"。
只输出严格 JSON：
{"instrument":"大五人格"|"VIA"|"盖洛普"|"MBTI"|"其他","confident":true,"mbtiType":"可选如INTJ","scores":[{"dimension":"尽责性","score":82,"explanation":"做事有计划、靠谱"}]}`,
        contents: [{ role: 'user', parts }],
      });
      if (gen.data && Array.isArray(gen.data.scores) && gen.data.scores.length > 0) {
        parsed = gen.data;
      }
    } catch {
      // ignore and fall through to parse failure state
    }
  }

  if (!parsed || parsed.scores.length === 0) {
    const { data, error } = await db
      .from('assessments')
      .insert({
        user_id: userId,
        instrument: '其他',
        file_name: input.fileName || '测评报告',
        raw_file_ref: rawFileRef,
        scores: [],
        comparisons: [],
        counts_as_evidence: false,
        parse_status: 'failed',
        parse_error: '没读到清晰的维度分数，文件可能太模糊或格式特殊，可重新上传或改为粘贴文字',
      })
      .select('*')
      .single();
    if (error || !data) throw new Error('记录解析状态失败');
    return data as AssessmentRecord;
  }

  const isMbti = parsed.instrument === 'MBTI';
  const comparisons: AssessmentComparisonItem[] = [];

  if (!isMbti) {
    // 基于用户已有线索与故事，自动构建「吻合」「值得聊聊（矛盾）」「新发现」逐条对照项
    const activeClues = state.clues.filter((c) => c.confidence.level !== '已归档');
    const structClue = activeClues.find((c) => /(梳理|结构|计划|条理|流程|靠谱)/.test(c.statement));
    const leadStory = state.stories.find((s) => /(负责人|统筹|组织|牵头|200\s*人|大型)/.test(`${s.title} ${s.star.task} ${s.star.action}`));

    for (const sc of parsed.scores) {
      const numScore = typeof sc.score === 'number' ? sc.score : Number(sc.score);
      if (/尽责|计划|条理|审慎|统筹|责任/.test(sc.dimension) && (isNaN(numScore) || numScore >= 65)) {
        if (structClue) {
          comparisons.push({
            id: `cmp_${comparisons.length + 1}`,
            kind: '吻合',
            dimension: `${sc.dimension} 高`,
            title: `${sc.dimension} 高 ↔ 已有经历`,
            description: `你的${sc.dimension}很高（${sc.score}），这和你之前在混乱中把事情理清楚的经历一致。你觉得准吗？`,
            target_clue_id: structClue.id,
            status: 'pending',
          });
        } else {
          comparisons.push({
            id: `cmp_${comparisons.length + 1}`,
            kind: '新发现',
            dimension: `${sc.dimension} 高`,
            title: `${sc.dimension} 突出`,
            description: `测评显示你做事很有计划、靠谱（${sc.score}），我们还没聊到相关的事。你有类似的经历吗？`,
            status: 'pending',
          });
        }
      } else if (/外向/.test(sc.dimension) && !isNaN(numScore) && numScore <= 40) {
        if (leadStory) {
          comparisons.push({
            id: `cmp_${comparisons.length + 1}`,
            kind: '值得聊聊',
            dimension: '外向性 偏低',
            title: `外向性 偏低 ↔ ${leadStory.title}`,
            description: `测评说你更多从独处中恢复能量（${sc.score}），但你讲过「${leadStory.title}」里担纲统筹的经历。你怎么看这一点？`,
            status: 'pending',
          });
        }
        comparisons.push({
          id: `cmp_${comparisons.length + 1}`,
          kind: '新发现',
          dimension: '外向性 偏低',
          title: '独处恢复能量',
          description: '测评显示你更习惯通过独处来恢复能量。平时忙完一阵后，你也是这样充电的吗？',
          status: 'pending',
        });
      } else if (/开放|好奇|创造|学习|新想法/.test(sc.dimension) && (isNaN(numScore) || numScore >= 65)) {
        comparisons.push({
          id: `cmp_${comparisons.length + 1}`,
          kind: '新发现',
          dimension: `${sc.dimension} 较高`,
          title: `${sc.dimension} 较高`,
          description: `测评说你${sc.explanation}（${sc.score}），我们之前还没聊到这块。你觉得像自己吗？`,
          status: 'pending',
        });
      }
    }

    if (comparisons.length === 0 && parsed.scores[0]) {
      const first = parsed.scores[0];
      comparisons.push({
        id: 'cmp_1',
        kind: '新发现',
        dimension: first.dimension,
        title: `${first.dimension}（${first.score}）`,
        description: `测评显示「${first.dimension}」比较突出（${first.explanation}）。这符合你平时的真实状态吗？`,
        status: 'pending',
      });
    }
  }

  // R7：若用户此前已记住「删除原文件」偏好（keep_raw_assessment === false），解析完成后立即自动清理原件
  let rawDeletedAt: string | null = null;
  if (rawFileRef && state.profile.privacy.keep_raw_assessment === false) {
    await db.storage.from('assessments').remove([rawFileRef]).catch(() => null);
    rawFileRef = null;
    rawDeletedAt = new Date().toISOString();
  }

  const { data, error } = await db
    .from('assessments')
    .insert({
      user_id: userId,
      instrument: parsed.instrument,
      instrument_confirmed: parsed.confident,
      taken_at: new Date().toISOString().slice(0, 10),
      file_name: input.fileName || (isMbti ? `MBTI · ${parsed.mbtiType || ''}` : `${parsed.instrument}报告`),
      raw_file_ref: rawFileRef,
      raw_file_deleted_at: rawDeletedAt,
      scores: parsed.scores,
      comparisons,
      skipped_items: [],
      counts_as_evidence: !isMbti,
      parse_status: 'completed',
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`保存测评结果失败: ${error?.message}`);

  return data as AssessmentRecord;
}

export async function respondAssessmentComparisonTool(
  db: SupabaseClient,
  userId: string,
  input: {
    assessmentId: string;
    comparisonId: string;
    action: 'agree' | 'disagree' | 'both_explain' | 'skip' | 'note_new';
    userText?: string;
  },
): Promise<{
  assessment: AssessmentRecord;
  upgradedClue?: any;
  createdClue?: any;
  allCompleted: boolean;
  askRawFileDisposal: boolean;
}> {
  await assertNotPausedBySafety(db, userId);

  const [{ data: row, error }, { data: prof }] = await Promise.all([
    db.from('assessments').select('*').eq('user_id', userId).eq('id', input.assessmentId).single(),
    db.from('user_profiles').select('*').eq('user_id', userId).single(),
  ]);
  if (error || !row) throw new Error('未找到该测评记录');

  const assessment = row as AssessmentRecord;
  const comparisons = [...(assessment.comparisons || [])];
  const skippedItems = [...(assessment.skipped_items || [])];
  const idx = comparisons.findIndex((c) => c.id === input.comparisonId);
  if (idx < 0) throw new Error('未找到对应对照项');

  const item = { ...comparisons[idx] };
  let upgradedClue: any = null;
  let createdClue: any = null;

  if (input.action === 'skip') {
    // R2：先跳过不产生证据，在本次小结列为「未回应」
    item.status = 'skipped';
    item.outcome_note = '已跳过 · 不产生证据';
    if (!skippedItems.includes(item.title)) {
      skippedItems.push(item.title);
    }
  } else if (item.kind === '吻合' && input.action === 'agree' && item.target_clue_id) {
    item.status = 'responded';
    item.user_response = input.userText || '准';
    const scoreInfo = assessment.scores[0];
    const evRes = await addEvidenceTool(db, userId, {
      clueId: item.target_clue_id,
      sourceType: '测评',
      sourceRef: assessment.instrument,
      sourceTitle: assessment.instrument,
      excerpt: `${item.dimension}${scoreInfo ? `（${scoreInfo.score}）` : ''}`,
      interpretation: `与${assessment.instrument}结果吻合`,
      strength: '中',
      userConfirmed: true,
      createdBy: '测评解读',
    });
    item.added_evidence_id = evRes.evidence.id;
    item.outcome_note = `你说：准 · +1 测评证据（${evRes.confidence.level}）`;
    if (evRes.upgradedToHigh) upgradedClue = evRes.clue;
  } else if (item.kind === '值得聊聊') {
    item.status = 'responded';
    item.user_response = input.userText || '两个都对';
    // 识别习得技能（能做但做完很累、需要恢复）
    if (input.action === 'both_explain' || /(累|恢复|耗|一个人待|缓)/.test(input.userText || '')) {
      const learned = await createClueTool(db, userId, {
        statement: '能牵头大型活动，但做完需要较长时间恢复',
        type: '习得技能',
        dimension: '能力',
        keywords: ['牵头', '恢复', '消耗'],
        createdBy: '测评解读',
        userStance: '认同',
      });
      await addEvidenceTool(db, userId, {
        clueId: learned.id,
        sourceType: '测评',
        sourceRef: assessment.instrument,
        sourceTitle: assessment.instrument,
        excerpt: `${item.dimension}：${(input.userText || '能做但做完需要独处恢复').slice(0, 70)}`,
        interpretation: '能力可以胜任但伴随明显能量消耗，属于习得技能',
        strength: '中',
        userConfirmed: true,
        createdBy: '测评解读',
      });
      await respondToClueTool(db, userId, { clueId: learned.id, stance: '认同' });
      createdClue = learned;
      item.created_clue_id = learned.id;
      item.outcome_note = '新线索：能牵头大型活动，但做完需要较长时间恢复 · 习得技能';
    } else {
      item.outcome_note = `已记录你的看法：${(input.userText || '').slice(0, 40) || '以真实经历为准'}`;
    }
  } else if (item.kind === '新发现' && (input.action === 'agree' || input.action === 'note_new')) {
    item.status = 'responded';
    item.user_response = input.userText || '先记下';
    const isEnergy = /独处|恢复|能量/.test(item.description);
    const newClue = await createClueTool(db, userId, {
      statement: isEnergy ? '独处时更容易恢复能量' : `喜欢接触新想法与新做法`,
      type: isEnergy ? '能量来源' : '优势候选',
      dimension: isEnergy ? '能量' : '性格',
      createdBy: '测评解读',
    });
    await addEvidenceTool(db, userId, {
      clueId: newClue.id,
      sourceType: '测评',
      sourceRef: assessment.instrument,
      sourceTitle: assessment.instrument,
      excerpt: `${item.dimension}`,
      interpretation: `${assessment.instrument}新发现特质`,
      strength: '中',
      userConfirmed: false,
      createdBy: '测评解读',
    });
    createdClue = newClue;
    item.created_clue_id = newClue.id;
    item.outcome_note = `已记为新线索（等级：线索）`;
  } else {
    item.status = 'responded';
    item.user_response = input.userText || '不像我';
    item.outcome_note = '你说不像自己 · 不计入证据';
  }

  comparisons[idx] = item;
  const allCompleted = comparisons.every((c) => c.status !== 'pending');

  const { data: updated, error: uErr } = await db
    .from('assessments')
    .update({
      comparisons,
      skipped_items: skippedItems,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', assessment.id)
    .select('*')
    .single();
  if (uErr || !updated) throw new Error('更新测评对照失败');

  if (allCompleted) {
    const { data: prog } = await db.from('progress').select('*').eq('user_id', userId).maybeSingle();
    const modules = {
      ...(prog?.modules || {}),
      assessment: { status: 'completed', completed_at: new Date().toISOString() },
    };
    await db
      .from('progress')
      .update({ modules, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  const keepPref = prof?.privacy?.keep_raw_assessment;
  const askRawFileDisposal =
    allCompleted && Boolean(updated.raw_file_ref) && (keepPref === null || keepPref === undefined);

  return {
    assessment: updated as AssessmentRecord,
    upgradedClue,
    createdClue,
    allCompleted,
    askRawFileDisposal,
  };
}

export async function disposeAssessmentRawFileTool(
  db: SupabaseClient,
  userId: string,
  input: { assessmentId: string; deleteFile: boolean; rememberChoice?: boolean },
): Promise<{ deleted: boolean }> {
  const { data: row } = await db
    .from('assessments')
    .select('*')
    .eq('user_id', userId)
    .eq('id', input.assessmentId)
    .single();
  if (!row) throw new Error('未找到测评记录');

  if (input.deleteFile && row.raw_file_ref) {
    await db.storage.from('assessments').remove([row.raw_file_ref]).catch(() => null);
    await db
      .from('assessments')
      .update({
        raw_file_ref: null,
        raw_file_deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', input.assessmentId);
  }

  if (input.rememberChoice !== false) {
    const { data: prof } = await db.from('user_profiles').select('privacy').eq('user_id', userId).single();
    const nextPriv = {
      ...(prof?.privacy || { allow_training: false, retention: '永久' }),
      allow_training: false,
      keep_raw_assessment: !input.deleteFile,
    };
    await db
      .from('user_profiles')
      .update({ privacy: nextPriv, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  return { deleted: input.deleteFile };
}
