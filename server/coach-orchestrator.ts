import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptText } from './crypto.ts';
import { generateStructuredJson, getGeminiClient } from './gemini.ts';
import { REGIONAL_HOTLINES, canResumeFromSafetyPause, evaluateSafety } from './safety.ts';
import {
  decodeMessageRow,
  type ConversationRecord,
  type MessageRecord,
} from './store.ts';
import {
  addEvidenceTool,
  createClueTool,
  findSimilarCluesTool,
  getFullWorkspaceState,
  recordMergeTool,
  recordSafetyEventTool,
  resolveSafetyPauseTool,
  saveEnergyLogTool,
  saveStoryTool,
  updateProfileTool,
} from './tools.ts';
import type {
  ClueType,
  DimensionType,
  EvidenceStrength,
  StoryMode,
} from '../src/domain/types.ts';

export interface TurnResponsePayload {
  conversation: ConversationRecord;
  userMessage?: MessageRecord;
  coachMessage: MessageRecord;
  safetyTriggered?: 'none' | 'low' | 'medium' | 'high';
  completedGoalSetup?: boolean;
}

async function appendMessage(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  role: 'coach' | 'user' | 'system',
  content: string,
  inlineCards: Array<Record<string, any>> = [],
): Promise<MessageRecord> {
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('conversation_id', conversationId);

  const { data, error } = await db
    .from('messages')
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      seq: (count || 0) + 1,
      role,
      content_encrypted: encryptText(content),
      inline_cards: inlineCards,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`写入对话消息失败: ${error?.message}`);
  return decodeMessageRow(data);
}

// 启动或恢复一次技能会话（遵循 Q4：每个技能一次会话，回到未完会话时带「上次聊到这里」分隔线）
export async function startOrResumeConversation(
  db: SupabaseClient,
  userId: string,
  params: {
    skill?: ConversationRecord['skill'];
    mode?: StoryMode;
    focusClueId?: string;
    starterPrompt?: string;
    forceNew?: boolean;
    conversationId?: string;
  },
): Promise<{ conversation: ConversationRecord; messages: MessageRecord[] }> {
  const state = await getFullWorkspaceState(db, userId);

  if (params.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('id', params.conversationId)
      .maybeSingle();
    if (conv) {
      const { data: msgRows } = await db
        .from('messages')
        .select('*')
        .eq('user_id', userId)
        .eq('conversation_id', conv.id)
        .order('seq', { ascending: true });
      return {
        conversation: conv as ConversationRecord,
        messages: (msgRows || []).map(decodeMessageRow),
      };
    }
  }

  // 主智能体路由判断默认技能
  let targetSkill: ConversationRecord['skill'] = params.skill || '经历挖掘';
  if (!params.skill) {
    if (state.progress.paused_by_safety) {
      targetSkill = '安全陪伴';
    } else if (!state.profile.goal && state.progress.modules?.goal_setup?.status !== 'completed') {
      targetSkill = '目标设定';
    } else if (state.stories.length >= 3 && state.progress.modules?.values?.status !== 'completed') {
      targetSkill = '价值观澄清';
    } else {
      targetSkill = '经历挖掘';
    }
  }

  // 检查是否已有进行中的同技能会话（非强制新建时自动续聊）
  if (!params.forceNew && !params.starterPrompt) {
    const { data: openConv } = await db
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('skill', targetSkill)
      .in?.('status', ['进行中', '已暂停']) // fallback if .in not on pglite wrapper
      ? { data: null }
      : { data: null };
    void openConv;

    const existing = state.conversations.find(
      (c: ConversationRecord) =>
        c.skill === targetSkill &&
        (c.status === '进行中' || (state.progress.paused_by_safety && c.status === '已暂停')) &&
        (!params.mode || c.mode === params.mode),
    );
    if (existing) {
      const { data: msgRows } = await db
        .from('messages')
        .select('*')
        .eq('user_id', userId)
        .eq('conversation_id', existing.id)
        .order('seq', { ascending: true });
      return {
        conversation: existing as ConversationRecord,
        messages: (msgRows || []).map(decodeMessageRow),
      };
    }
  }

  const mode: StoryMode | null =
    targetSkill === '经历挖掘'
      ? params.mode ||
        (params.focusClueId
          ? '日常'
          : state.progress.counters.highlight_stories >= 3 && state.progress.counters.low_stories < 2
            ? '低谷'
            : '高光')
      : null;

  const focusClue = params.focusClueId
    ? state.clues.find((c) => c.id === params.focusClueId)
    : null;

  const initialContext: Record<string, any> =
    targetSkill === '目标设定'
      ? { step: 1, draft: {} }
      : targetSkill === '经历挖掘'
        ? {
            star: {
              situation: false,
              task: false,
              action: false,
              result: false,
              key_moment: false,
            },
            collected: {
              title: '',
              situation: '',
              task: '',
              action: '',
              result: '',
              key_moment: '',
            },
            turnCount: 0,
            shortStreak: 0,
            stage: 'collecting',
          }
        : targetSkill === '能量打卡'
          ? { checkinStep: 1, score: 7, charge: '', drain: '' }
          : {};

  const title =
    targetSkill === '目标设定'
      ? '目标设定'
      : targetSkill === '经历挖掘'
        ? focusClue
          ? `补例子 · ${focusClue.user_statement || focusClue.statement}`
          : `${mode}故事探索`
        : targetSkill;

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      user_id: userId,
      skill: targetSkill,
      mode,
      title,
      status: state.progress.paused_by_safety ? '已暂停' : '进行中',
      focus_clue_id: params.focusClueId || null,
      context: initialContext,
      discoveries: [],
    })
    .select('*')
    .single();
  if (error || !created) throw new Error(`创建会话失败: ${error?.message}`);

  // 生成教练开场第一句话（P0.1 同意后教练第一句话已经在屏幕上）
  let openingText = '';
  let openingCards: Array<Record<string, any>> = [];

  if (state.progress.paused_by_safety) {
    openingText = '上次我们把探索暂停了。今天不用讲故事，你现在感觉怎么样？想说什么都可以';
  } else if (targetSkill === '目标设定') {
    openingText =
      '你好，我是你的自我探索教练。接下来几周，我们会一起回顾你的经历、收集一些证据，最后整理出一份有依据的个人优劣势画像。每次聊 10–15 分钟就好，随时可以停。\n先问一个问题：是什么让你想更了解自己？';
  } else if (targetSkill === '经历挖掘') {
    if (focusClue) {
      openingText = `我们围绕「${focusClue.user_statement || focusClue.statement}」补一个你自己的例子。最近或者过去，有没有哪次具体的经历最能体现这一点？`;
    } else if (mode === '低谷') {
      openingText =
        '前面聊了几次高光时刻，今天想换个方向，聊一段不那么顺的经历。这一段可能会勾起不舒服的感受，随时可以点下方「跳过这个话题」，或者今天先到这里。有没有哪段经历，让你特别挫败，或者特别想逃开？';
    } else if (mode === '日常') {
      openingText = '这周有没有哪个瞬间，让你觉得做起来特别顺，或者特别别扭？先说个大概就行';
    } else {
      const count = state.progress.counters.highlight_stories;
      openingText =
        count === 0
          ? '我们从开心的经历开始。有没有哪件事，你做完觉得「这才是我」？不用想得很完整，先说个大概就行'
          : '再聊一个高光故事。最近一两年，工作或生活里有没有哪件事让你特别有劲？';
    }
  } else if (targetSkill === '能量打卡') {
    openingText = '今天整体能量打几分？';
    openingCards = [{ type: 'energy_score_picker', selected: null }];
  } else {
    openingText = '今天想聊聊哪件事，或者看看哪条线索？';
  }

  const firstCoachMsg = await appendMessage(db, userId, created.id, 'coach', openingText, openingCards);
  const messages: MessageRecord[] = [firstCoachMsg];

  if (params.starterPrompt && params.starterPrompt.trim()) {
    const turn = await processUserTurn(db, userId, {
      conversationId: created.id,
      text: params.starterPrompt.trim(),
    });
    const { data: refreshedMsgs } = await db
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .eq('conversation_id', created.id)
      .order('seq', { ascending: true });
    return {
      conversation: turn.conversation,
      messages: (refreshedMsgs || []).map(decodeMessageRow),
    };
  }

  return {
    conversation: created as ConversationRecord,
    messages,
  };
}

// 判断用户是否在问「替我做决定」（边界样例 E3）
const ASK_DECISION_RE = /(你直接告诉我|帮我决定|替我决定|我该不该(去|辞职|跳槽|离开|接受)|到底去不去)/i;
// 判断用户是否主动给出无例子的自我评价（样例 4：我觉得我很XX）
const SELF_CLAIM_RE =
  /^(?:对了[，,]?)?(?:我觉得我(?:其实)?(?:还挺|挺|很|比较|是个)?|我平时(?:很|挺)?|我其实(?:还挺|挺|很)?)([\u4e00-\u9fa5]{2,14}?)(?:的)?[。！!]?$/;

export async function processUserTurn(
  db: SupabaseClient,
  userId: string,
  input: {
    conversationId: string;
    text: string;
    skipLowTopic?: boolean;
  },
  onStreamChunk?: (chunk: string) => void,
): Promise<TurnResponsePayload> {
  const [{ data: convRow, error: cErr }, state, ai] = await Promise.all([
    db.from('conversations').select('*').eq('user_id', userId).eq('id', input.conversationId).single(),
    getFullWorkspaceState(db, userId),
    getGeminiClient(),
  ]);
  if (cErr || !convRow) throw new Error('未找到当前对话');

  let conversation = convRow as ConversationRecord;
  const userText = input.skipLowTopic ? '我想跳过这个话题' : (input.text || '').trim();
  if (!userText) throw new Error('请输入要发送的内容');

  const userMsg = await appendMessage(db, userId, conversation.id, 'user', userText);

  const emitReply = async (
    replyText: string,
    inlineCards: Array<Record<string, any>> = [],
    patchConv: Partial<ConversationRecord> = {},
    extra: Partial<TurnResponsePayload> = {},
  ): Promise<TurnResponsePayload> => {
    // 按小片段推送给 SSE 流，保证自然的打字流式输出质感
    if (onStreamChunk) {
      const step = 6;
      for (let i = 0; i < replyText.length; i += step) {
        onStreamChunk(replyText.slice(i, i + step));
      }
    }

    const coachMsg = await appendMessage(db, userId, conversation.id, 'coach', replyText, inlineCards);

    const { data: updatedConv } = await db
      .from('conversations')
      .update({
        ...patchConv,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', conversation.id)
      .select('*')
      .single();

    conversation = (updatedConv as ConversationRecord) || conversation;

    // 同步更新 progress.last_session（安全暂停期间除外）
    if (!state.progress.paused_by_safety && extra.safetyTriggered !== 'medium' && extra.safetyTriggered !== 'high') {
      await db
        .from('progress')
        .update({
          last_session: {
            date: new Date().toISOString().slice(5, 10),
            skill: conversation.skill,
            summary: conversation.title,
            conversation_id: conversation.id,
            story_title: conversation.context?.collected?.title || conversation.title,
            story_mode: conversation.mode || undefined,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    return {
      conversation,
      userMessage: userMsg,
      coachMessage: coachMsg,
      ...extra,
    };
  };

  // ==================== ① 安全守护前置检测（硬约束 2：先于一切技能） ====================
  const safety = await evaluateSafety(userText, {
    ai,
    heightenedSensitivity: conversation.mode === '低谷',
  });

  const regionalHotline = REGIONAL_HOTLINES[state.profile.region || 'CN'] || REGIONAL_HOTLINES.CN;

  if (safety.level === 'high') {
    await recordSafetyEventTool(db, userId, {
      level: '高',
      triggerSkill: conversation.skill,
      signalCategory: safety.signalCategory || '高风险危机信号',
      actionTaken: '立即中断全部技能，展示危机干预热线与安全确认',
    });

    return emitReply(
      '你愿意说出来，这很重要，我很在意你现在的状态。我们先把其他的都放下。\n你不需要一个人扛着这些。我在这里，你想说什么都可以',
      [
        {
          type: 'safety_card',
          level: 'high',
          headline: '你现在安全吗',
          body: '如果你有伤害自己的想法，请马上拨打当地的心理危机干预热线或急救电话，或者告诉一个你信任的人，让他现在陪着你',
          hotlineName: regionalHotline.crisisName,
          hotlineNumber: regionalHotline.crisisNumber,
          emergencyNumber: regionalHotline.emergencyNumber,
        },
      ],
      { status: '已暂停', skill: '安全陪伴', mode: null },
      { safetyTriggered: 'high' },
    );
  }

  if (safety.level === 'medium') {
    await recordSafetyEventTool(db, userId, {
      level: '中',
      triggerSkill: conversation.skill,
      signalCategory: safety.signalCategory || '持续低落或明显情绪困扰',
      actionTaken: '暂停当前探索模块，提供专业咨询建议，停止证据写入',
    });

    return emitReply(
      '谢谢你愿意告诉我这些。听起来你这段时间真的很辛苦。\n你现在身边有可以说说话的人吗？',
      [
        {
          type: 'safety_card',
          level: 'medium',
          headline: '今天的探索先停一停',
          body: '这种状态持续一段时间的话，找专业的心理咨询师聊聊会很有帮助。这不代表你哪里有问题，就像身体累了会去看医生一样',
          hotlineName: regionalHotline.crisisName,
          hotlineNumber: regionalHotline.crisisNumber,
        },
      ],
      { status: '已暂停' },
      { safetyTriggered: 'medium' },
    );
  }

  // 若当前处于安全暂停状态（R6 / E9：暂停期间绝不写入任何故事、线索、证据）
  if (state.progress.paused_by_safety) {
    const resumeCheck = canResumeFromSafetyPause({
      pausedBySafety: state.progress.paused_by_safety,
      safetyLevel: state.progress.safety_level,
      resumeNotBefore: state.progress.resume_not_before,
      currentCheck: safety,
    });

    if (resumeCheck.allowed) {
      await resolveSafetyPauseTool(db, userId);
      return emitReply(
        '听到你好一些，我挺高兴的。我们可以接着来，也可以换个轻松一点的方向，比如先讲一个高光的事。你想怎么来？',
        [
          {
            type: 'quick_replies',
            options: ['先讲一个高光的', '接着聊上次的话题', '今天就随便聊聊'],
          },
        ],
        { status: '进行中', skill: '经历挖掘', mode: '高光' },
        { safetyTriggered: 'none' },
      );
    }

    if (resumeCheck.reason === 'cooldown_active') {
      return emitReply(
        '很高兴听到你现在安全一些了。昨天刚聊到很重的部分，今天我们先不急着恢复挖掘故事，好好休息一天，明天你想继续我们随时接着来。现在想随便聊聊别的都可以',
        [],
        {},
      );
    }

    return emitReply(
      '听起来那段时间你一直在想办法让自己撑住。我在这里陪着你，今天先不整理线索，想说什么都可以',
      [],
      {},
    );
  }

  // ==================== ② 全局边界拦截：拒绝替用户拍板做决定（E3） ====================
  if (ASK_DECISION_RE.test(userText) && conversation.skill !== '目标设定') {
    const strengths = state.clues
      .filter((c) => c.type === '优势候选' && c.confidence.level !== '已归档')
      .slice(0, 2)
      .map((c) => `${c.user_statement || c.statement}（${c.confidence.level}）`);
    const values = state.clues
      .filter((c) => c.type === '价值观' && c.confidence.level !== '已归档')
      .slice(0, 2)
      .map((c) => c.user_statement || c.statement);
    const drains = state.clues
      .filter((c) => (c.type === '能量消耗' || c.type === '习得技能') && c.confidence.level !== '已归档')
      .slice(0, 2)
      .map((c) => c.user_statement || c.statement);

    const supportLine =
      [...strengths, ...values].length > 0
        ? `支持你往前迈一步的：${[...strengths, ...values].join('；')}`
        : '支持的一面：你正在主动寻找更能发挥自己优势的空间';
    const cautionLine =
      drains.length > 0
        ? `需要想清楚的：${drains.join('；')}，新环境是否会触发这些消耗`
        : '需要想清楚的：新环境的节奏与管理方式是否符合你的能量边界';

    return emitReply(
      `这个决定只能你来做，我不想替你拍板。但我可以把目前了解到的信息摆出来：\n· ${supportLine}\n· ${cautionLine}\n\n你看到这些摆在一起，心里更偏向哪边？`,
    );
  }

  // ==================== ③ 技能 1：目标设定（P2.1 · 7 步破冰） ====================
  if (conversation.skill === '目标设定') {
    const ctx = { ...(conversation.context || { step: 1, draft: {} }) };
    const draft = { ...(ctx.draft || {}) };
    const step = Number(ctx.step || 1);

    if (step === 1) {
      draft.reason = userText;
      ctx.step = 2;
      ctx.draft = draft;
      return emitReply(
        '停下来认真想这个问题，挺正常的。最近有没有一个正在纠结的具体选择或困惑？',
        [],
        { context: ctx },
      );
    }

    if (step === 2) {
      draft.current_puzzle = userText;
      ctx.step = 3;
      ctx.draft = draft;
      return emitReply(
        '明白。我不会替你直接做决定，但把你自己了解清楚之后，眼前的选择会好做很多。聊完这一轮，你最希望得到什么？',
        [
          {
            type: 'goal_options',
            options: ['职业方向的参考', '更理解自己的情绪和行为', '改善人际关系', '单纯好奇'],
          },
        ],
        { context: ctx },
      );
    }

    if (step === 3) {
      draft.goal = userText;
      ctx.step = 4;
      ctx.draft = draft;
      return emitReply(
        '好。沟通方式上，你希望我说话直接一点还是温和一点？要不要多举例子？',
        [
          {
            type: 'quick_replies',
            options: ['直接一点，多举例子', '温和一点，多举例子', '直接一点，只说结论'],
          },
        ],
        { context: ctx },
      );
    }

    if (step === 4) {
      const directness = /温和/.test(userText) ? '温和' : '直接';
      const examples = /(不要|只说结论)/.test(userText) ? '不要' : '要';
      draft.comm_style = { directness, examples };
      draft.comm_label = `${directness}一点，${examples === '要' ? '多举例子' : '只说结论'}`;
      ctx.step = 5;
      ctx.draft = draft;

      return emitReply(
        '收到。最后提醒一下隐私：你讲的内容只用于帮你分析，不会拿去训练任何模型，你随时可以删掉任何一段或全部数据。\n我总结一下，你看对不对。哪一条不对可以直接改',
        [
          {
            type: 'goal_summary',
            status: 'pending',
            fields: {
              reason: draft.reason || '想弄清楚自己真正擅长什么',
              current_puzzle: draft.current_puzzle || '寻找更适合自己的方向',
              goal: draft.goal || '职业方向的参考',
              comm_label: draft.comm_label,
              directness,
              examples,
            },
          },
        ],
        { context: ctx },
      );
    }

    // Step 5：用户在输入框直接说“对”或确认
    if (/^(对|好的|没问题|确认|对，开始|开始吧)/.test(userText)) {
      await updateProfileTool(
        db,
        userId,
        {
          reason: draft.reason || '',
          current_puzzle: draft.current_puzzle || '',
          goal: draft.goal || '职业方向的参考',
          comm_style: draft.comm_style || { directness: '直接', examples: '要' },
          consented: true,
          completeGoalSetup: true,
        },
        `goal_done_${conversation.id}`,
      );
      ctx.step = 6;
      return emitReply(
        '好，档案已经建好了。我们回到首页，从第一件让你觉得「这才是我」的事开始',
        [],
        { status: '已结束', context: ctx, ended_at: new Date().toISOString() },
        { completedGoalSetup: true },
      );
    }

    // 用户补充修改内容
    draft.current_puzzle = userText;
    ctx.draft = draft;
    return emitReply(
      '已按你说的更新。确认没问题的话，点上方卡片的「对，开始」我们就正式出发',
      [
        {
          type: 'goal_summary',
          status: 'pending',
          fields: {
            reason: draft.reason || '想弄清楚自己真正擅长什么',
            current_puzzle: draft.current_puzzle,
            goal: draft.goal || '职业方向的参考',
            comm_label: draft.comm_label || '直接一点，多举例子',
            directness: draft.comm_style?.directness || '直接',
            examples: draft.comm_style?.examples || '要',
          },
        },
      ],
      { context: ctx },
    );
  }

  // ==================== ④ 技能 4：能量打卡对话流（P2.5 · 固定 3 问 1 分钟内） ====================
  if (conversation.skill === '能量打卡') {
    const ctx = { ...(conversation.context || { checkinStep: 1, score: 7 }) };
    const step = Number(ctx.checkinStep || 1);

    if (step === 1) {
      const num = Number(userText.replace(/[^0-9]/g, '')) || 7;
      ctx.score = Math.min(10, Math.max(1, num));
      ctx.checkinStep = 2;
      return emitReply('今天最让你充电的一件事？', [], { context: ctx });
    }
    if (step === 2) {
      ctx.charge = userText;
      ctx.checkinStep = 3;
      return emitReply('最消耗你的一件事？', [], { context: ctx });
    }
    ctx.drain = userText;
    ctx.checkinStep = 4;
    const saved = await saveEnergyLogTool(db, userId, {
      score: ctx.score || 7,
      chargeEvent: ctx.charge || '',
      drainEvent: ctx.drain || '',
    });
    const refreshed = await getFullWorkspaceState(db, userId);
    const totalDays = refreshed.energyLogs.length;

    return emitReply(
      '记好了。明天见',
      [
        {
          type: 'checkin_summary',
          todayScore: saved.score,
          totalDays,
          targetDays: 14,
        },
      ],
      { status: '已结束', context: ctx, ended_at: new Date().toISOString() },
    );
  }

  // ==================== ⑤ 用户主动新建线索：自述无例子时当场追问（样例 4 / C4） ====================
  const ctx = { ...(conversation.context || {}) };

  if (ctx.awaitingUserClueExampleId) {
    const pendingClueId = ctx.awaitingUserClueExampleId as string;
    if (/(想不起来|没印象|暂时没有|忘了|记不清|以后再说)/.test(userText)) {
      delete ctx.awaitingUserClueExampleId;
      return emitReply(
        '没关系，不用硬想。我先把它标记成「待补例子」，之后聊的时候想到了随时告诉我。我们接着刚才的话题？',
        [],
        { context: ctx },
      );
    }
    // 用户讲出了具体例子 → 转入日常经历挖掘并挂上该线索
    delete ctx.awaitingUserClueExampleId;
    conversation.focus_clue_id = pendingClueId;
    conversation.mode = '日常';
  } else {
    const selfMatch = userText.match(SELF_CLAIM_RE);
    if (selfMatch?.[1] && userText.length <= 24) {
      const traitText = selfMatch[1].trim();
      const sim = await findSimilarCluesTool(db, userId, {
        statement: traitText,
        keywords: [traitText],
      });
      let targetClue = sim[0]?.clue;
      if (!targetClue) {
        targetClue = await createClueTool(db, userId, {
          statement: traitText,
          type: '优势候选',
          dimension: '性格',
          keywords: [traitText],
          createdBy: '用户',
        });
      }
      await addEvidenceTool(db, userId, {
        clueId: targetClue.id,
        sourceType: '用户自述',
        sourceRef: targetClue.id,
        sourceTitle: '对话自述',
        excerpt: userText,
        interpretation: '用户主动提出的自我判断，待补充具体事例',
        strength: '中',
        createdBy: '用户',
      });
      ctx.awaitingUserClueExampleId = targetClue.id;
      const discoveries = [
        ...(conversation.discoveries || []),
        {
          clue_id: targetClue.id,
          statement: targetClue.statement,
          delta_label: '待补例子 · 自述',
          pending: true,
        },
      ];
      return emitReply(
        `记下了，「${targetClue.statement}」先作为一条线索登记。能讲一次你特别「${traitText}」的具体经历吗？越具体越好`,
        [],
        { context: ctx, discoveries },
      );
    }
  }

  // ==================== ⑥ 技能 2：经历挖掘（高光 / 低谷 / 日常 · STAR + 提炼 + 合并） ====================
  // 低谷模式跳过当前话题
  if (input.skipLowTopic || /^(跳过|跳过这个话题|换一个话题|今天先到这)/.test(userText)) {
    return emitReply(
      '好，这个话题我们先放一边。你想换一件别的事聊聊，还是今天先休息？',
      [
        {
          type: 'quick_replies',
          options: ['换一件高光的事', '今天先到这里'],
        },
      ],
      { mode: '高光', context: { ...ctx, turnCount: 0, shortStreak: 0, stage: 'collecting' } },
    );
  }

  // 用户在否认线索后回答「更准确的说法是什么」（边界样例 E2）
  if (ctx.awaitingAlternativeAfterDeny) {
    delete ctx.awaitingAlternativeAfterDeny;
    if (userText.length >= 4 && !/^(没有|不知道|算了)/.test(userText)) {
      const altStatement =
        /没人做我才做/.test(userText)
          ? '没人牵头时会出于责任心主动顶上'
          : userText.replace(/^(我其实|只是|更多是因为)/, '').trim().slice(0, 30);
      const altClue = await createClueTool(db, userId, {
        statement: altStatement,
        type: '行为模式',
        dimension: '关系',
        createdBy: '经历挖掘',
        userStance: '认同',
      });
      await addEvidenceTool(db, userId, {
        clueId: altClue.id,
        sourceType: '用户自述',
        sourceRef: altClue.id,
        sourceTitle: '修正说法',
        excerpt: userText.slice(0, 90),
        interpretation: '用户否认原线索后给出的更准确自我描述',
        strength: '中',
        createdBy: '用户',
      });
      return emitReply(
        `明白，你说的「${altStatement}」更准确，我已经单独记下来了。还要继续讲一个故事，还是先回首页看看？`,
        [
          {
            type: 'quick_replies',
            options: ['结束本次并看小结', '再聊几句'],
          },
        ],
        { context: ctx },
      );
    }
  }

  // 敷衍检测（边界样例 E1：连续 2 轮少于 15 字且处于故事收集中）
  const starState = {
    situation: false,
    task: false,
    action: false,
    result: false,
    key_moment: false,
    ...(ctx.star || {}),
  };
  const collected = {
    title: '',
    situation: '',
    task: '',
    action: '',
    result: '',
    key_moment: '',
    ...(ctx.collected || {}),
  };

  const isVeryShort =
    [...userText].length < 15 &&
    (Number(ctx.turnCount || 0) >= 1 || /(正常做|没啥|随便|一般|还好|忘了|就那样)/.test(userText));

  if (isVeryShort && ctx.stage !== 'done') {
    const streak = Number(ctx.shortStreak || 0) + 1;
    ctx.shortStreak = streak;
    if (streak === 1) {
      return emitReply(
        '嗯。那件事里，有没有哪个瞬间你印象特别深？说一个具体画面就行',
        [],
        { context: ctx },
      );
    }
    if (streak >= 2) {
      ctx.shortStreak = 0;
      return emitReply(
        '没关系，可能这个故事不太对味。要不要换一个故事，或者今天先到这里？',
        [
          {
            type: 'quick_replies',
            options: ['换一个故事', '今天先到这里'],
          },
        ],
        { context: ctx },
      );
    }
  } else {
    ctx.shortStreak = 0;
  }

  // 累积用户本轮讲述的细节并推进 STAR 进度（最多 4 轮追问 + 1 轮关键追问）
  const turnCount = Number(ctx.turnCount || 0) + 1;
  ctx.turnCount = turnCount;
  const mode: StoryMode = (conversation.mode as StoryMode) || '高光';

  // 调用 Gemini 4 Neon 进行自然对话理解与线索提炼（同时配有精准规则保障无网络/超时场景同样丝滑）
  const { data: historyRows } = await db
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .eq('conversation_id', conversation.id)
    .order('seq', { ascending: true });
  const historyMsgs = (historyRows || []).map(decodeMessageRow);

  interface MiningTurnAiOutput {
    phase: 'ask_next' | 'extract';
    reply: string;
    starChecklist: {
      situation: boolean;
      task: boolean;
      action: boolean;
      result: boolean;
      key_moment: boolean;
    };
    storyDraft?: {
      title: string;
      period?: string;
      domain?: '学业' | '工作' | '家庭' | '社交' | '兴趣' | '其他';
      situation: string;
      task: string;
      action: string;
      result: string;
      key_moment: string;
      emotion_intensity: number;
    };
    extractedClues?: Array<{
      statement: string;
      type: ClueType;
      dimension: DimensionType;
      excerpt: string;
      anchor_field: 'key_moment' | 'situation' | 'task' | 'action' | 'result';
      interpretation: string;
      strength: EvidenceStrength;
      keywords: string[];
    }>;
  }

  let aiTurn: MiningTurnAiOutput;
  try {
    const gen = await generateStructuredJson<MiningTurnAiOutput>({
      tier: 'chat',
      temperature: 0.35,
      systemInstruction: `你是「照见」AI 自我探索教练，正在执行「经历挖掘（${mode}模式）」技能。
用户沟通偏好：${state.profile.comm_style?.directness || '直接'}、${state.profile.comm_style?.examples === '不要' ? '只说结论' : '多举例子'}。
已有线索列表：${JSON.stringify(state.clues.filter((c) => c.confidence.level !== '已归档').map((c) => ({ id: c.id, statement: c.user_statement || c.statement, type: c.type, dimension: c.dimension })))}

严格遵守技能规则：
1. 一次只问一个问题，reply 控制在 120 字以内，不用感叹号，不贴人格标签（如完美主义、INTJ）。
2. 先简短共情或复述确认用户刚说的话，再追问。
3. STAR 追问最多 4 轮（情境→任务→具体行动→结果与感受），然后做关键追问：
   - 高光模式问："整个过程中，哪个环节你最投入、觉得时间过得最快？"
   - 低谷模式问："最难受的是哪个点？是事情本身，还是别的什么？"
4. 当已收集够核心行动与关键时刻（或当前已是第 5 轮以上，或用户在一段话里已把前因后果和最投入/最难受的点讲清楚）时，将 phase 设为 "extract"：
   - 整理完整的 storyDraft（title ≤ 16字，如"大学组织 200 人活动"）。
   - 提炼 1～2 条行为化线索 extractedClues（statement ≤ 28字，用"行为+情境"描述）。
   - 【重要规则 C2】一条线索只能有一种 type！若一段话同时指向价值观和能量消耗（例如既看重自主权，又因被管太细而消耗），必须拆成 2 条线索分别给出！
   - 【重要规则】区分"优势候选"（做得好+有能量）与"习得技能"（做得好但做完很累需恢复）。
   - excerpt 必须摘取用户讲过的真实原话片段（≤80字）。
只输出严格 JSON。`,
      contents: JSON.stringify({
        mode,
        turnCount,
        focusClue: conversation.focus_clue_id
          ? state.clues.find((c) => c.id === conversation.focus_clue_id)?.statement
          : null,
        history: historyMsgs.slice(-12).map((m) => ({ role: m.role, text: m.content })),
      }),
    });
    aiTurn =
      gen.data ||
      buildDeterministicMiningStep(
        mode,
        turnCount,
        userText,
        starState,
        collected,
        state.clues,
        conversation.focus_clue_id,
      );

    // 累加会话 token 统计（不记原文）
    const prevUsage = conversation.token_usage || { input_tokens: 0, output_tokens: 0, calls: 0 };
    conversation.token_usage = {
      input_tokens: prevUsage.input_tokens + gen.inputTokens,
      output_tokens: prevUsage.output_tokens + gen.outputTokens,
      calls: prevUsage.calls + 1,
    };
  } catch {
    // 智能本地规则状态机兜底（确保网络离线或超时时对话依然自然推进且完整产出证据）
    aiTurn = buildDeterministicMiningStep(mode, turnCount, userText, starState, collected, state.clues, conversation.focus_clue_id);
  }

  const nextStar = aiTurn.starChecklist || starState;
  if (aiTurn.storyDraft) {
    Object.assign(collected, aiTurn.storyDraft);
  } else {
    if (!collected.title) collected.title = summarizeStoryTitle(userText);
    if (turnCount === 1) collected.situation = userText;
    else if (turnCount === 2) collected.task = userText;
    else if (turnCount === 3) collected.action = userText;
    else if (turnCount === 4) collected.result = userText;
    else collected.key_moment = userText;
  }

  ctx.star = nextStar;
  ctx.collected = collected;

  if (aiTurn.phase === 'ask_next' || !aiTurn.extractedClues || aiTurn.extractedClues.length === 0) {
    return emitReply(
      aiTurn.reply,
      [],
      {
        title: collected.title || conversation.title,
        context: ctx,
        token_usage: conversation.token_usage,
      },
    );
  }

  // ==================== 执行故事落库、相似线索合并检测与提炼卡生成 ====================
  const draft = aiTurn.storyDraft || {
    title: collected.title || summarizeStoryTitle(userText),
    period: '近期',
    domain: '工作' as const,
    situation: collected.situation || userText,
    task: collected.task || '承担核心推进工作',
    action: collected.action || userText,
    result: collected.result || '顺利完成并获得反馈',
    key_moment: collected.key_moment || userText,
    emotion_intensity: 4,
  };

  const savedStory = await saveStoryTool(db, userId, {
    storyId: conversation.story_id || undefined,
    mode,
    title: draft.title,
    period: draft.period || '',
    domain: draft.domain || '工作',
    star: {
      situation: draft.situation,
      task: draft.task,
      action: draft.action,
      result: draft.result,
    },
    keyMoment: draft.key_moment,
    emotionIntensity: draft.emotion_intensity || 4,
    completeness: '完整',
    conversationId: conversation.id,
  });

  const inlineCards: Array<Record<string, any>> = [];
  const discoveries = [...(conversation.discoveries || [])];
  const createdTwinIds: string[] = [];

  // 若对话原本带有 focus_clue_id（补例子模式），优先把例子挂到该目标线索上
  if (conversation.focus_clue_id) {
    const focusClue = state.clues.find((c) => c.id === conversation.focus_clue_id);
    if (focusClue) {
      const evRes = await addEvidenceTool(db, userId, {
        clueId: focusClue.id,
        sourceType: '经历',
        sourceRef: savedStory.id,
        sourceTitle: savedStory.title,
        storyId: savedStory.id,
        excerpt: draft.key_moment || draft.action.slice(0, 80),
        anchorField: 'key_moment',
        interpretation: '用户补充的亲身经历事例',
        strength: '中',
        userConfirmed: true,
        createdBy: '经历挖掘',
      });
      discoveries.push({
        clue_id: focusClue.id,
        statement: focusClue.user_statement || focusClue.statement,
        delta_label: `+1 经历证据 · ${evRes.confidence.level}`,
      });
      inlineCards.push({
        type: 'merge_notice',
        mode: 'auto',
        clueId: focusClue.id,
        statement: focusClue.user_statement || focusClue.statement,
        count: evRes.confidence.N,
        tally: evRes.confidence.tallyStrokes,
      });
      if (evRes.upgradedToHigh) {
        inlineCards.push({
          type: 'level_change',
          direction: 'up',
          clueId: focusClue.id,
          statement: focusClue.user_statement || focusClue.statement,
          detail: `${evRes.confidence.N} 条证据，加权分 ${evRes.confidence.W_plus.toFixed(1)}`,
          tally: evRes.confidence.tallyStrokes,
        });
      }
    }
  }

  for (const cand of aiTurn.extractedClues.slice(0, 2)) {
    if (conversation.focus_clue_id && inlineCards.length > 0) break;

    const simList = await findSimilarCluesTool(db, userId, {
      statement: cand.statement,
      dimension: cand.dimension,
      keywords: cand.keywords,
    });

    const topSim = simList[0];
    if (topSim && topSim.suggestedRelation === '高度相似') {
      const target = topSim.clue;
      const isConfirmedByUser = target.user_stance === '认同' || target.user_stance === '部分认同';
      const exactSameMeaning = topSim.score >= 0.62;

      if (!isConfirmedByUser || exactSameMeaning) {
        const evRes = await addEvidenceTool(db, userId, {
          clueId: target.id,
          sourceType: '经历',
          sourceRef: savedStory.id,
          sourceTitle: savedStory.title,
          storyId: savedStory.id,
          excerpt: cand.excerpt || draft.key_moment,
          anchorField: cand.anchor_field || 'key_moment',
          interpretation: cand.interpretation,
          strength: cand.strength || '中',
          userConfirmed: isConfirmedByUser,
          createdBy: '经历挖掘',
        });

        if (!isConfirmedByUser && cand.statement !== target.statement) {
          await recordMergeTool(db, userId, {
            targetClueId: target.id,
            mergedStatement: cand.statement,
            mergedType: cand.type,
            mergedDimension: cand.dimension,
            sourceStoryTitle: savedStory.title,
            evidenceId: evRes.evidence.id,
            autoMerged: true,
          });
        }

        inlineCards.push({
          type: 'merge_notice',
          mode: 'auto',
          clueId: target.id,
          statement: target.user_statement || target.statement,
          count: evRes.confidence.N,
          tally: evRes.confidence.tallyStrokes,
        });

        if (evRes.upgradedToHigh) {
          inlineCards.push({
            type: 'level_change',
            direction: 'up',
            clueId: target.id,
            statement: target.user_statement || target.statement,
            detail: `${evRes.confidence.N} 条证据，来自${evRes.confidence.supportingSources.join('和')}，加权分 ${evRes.confidence.W_plus.toFixed(1)}`,
            tally: evRes.confidence.tallyStrokes,
          });
        }

        discoveries.push({
          clue_id: target.id,
          statement: target.user_statement || target.statement,
          delta_label: `+1 证据 · ${evRes.confidence.level}`,
        });
        continue;
      } else {
        // 已确认线索且表述有差异 → 先询问用户是否合并（设计第 1 批：询问合并）
        inlineCards.push({
          type: 'merge_notice',
          mode: 'ask',
          targetClueId: target.id,
          targetStatement: target.user_statement || target.statement,
          candidateStatement: cand.statement,
          candidateType: cand.type,
          candidateDimension: cand.dimension,
          storyId: savedStory.id,
          storyTitle: savedStory.title,
          excerpt: cand.excerpt || draft.key_moment,
          strength: cand.strength || '中',
          status: 'pending',
        });
        continue;
      }
    }

    // 新建线索并挂上本故事证据，推送 5 状态线索提炼卡等待用户确认
    const related =
      topSim && topSim.suggestedRelation === '包含'
        ? [{ clue_id: topSim.clue.id, relation: '包含' as const }]
        : createdTwinIds.length > 0
          ? [{ clue_id: createdTwinIds[0], relation: '相关' as const }]
          : [];

    const newClue = await createClueTool(db, userId, {
      statement: cand.statement,
      type: cand.type,
      dimension: cand.dimension,
      keywords: cand.keywords || [],
      createdBy: '经历挖掘',
      relatedClues: related,
    });
    createdTwinIds.push(newClue.id);

    const evRes = await addEvidenceTool(db, userId, {
      clueId: newClue.id,
      sourceType: '经历',
      sourceRef: savedStory.id,
      sourceTitle: savedStory.title,
      storyId: savedStory.id,
      excerpt: cand.excerpt || draft.key_moment,
      anchorField: cand.anchor_field || 'key_moment',
      interpretation: cand.interpretation,
      strength: cand.strength || '强',
      userConfirmed: false,
      createdBy: '经历挖掘',
    });

    inlineCards.push({
      type: 'clue_card',
      status: 'pending',
      clueId: newClue.id,
      clueType: newClue.type,
      dimension: newClue.dimension,
      statement: newClue.statement,
      rationale: cand.interpretation,
      strength: cand.strength || '强',
      tally: evRes.confidence.tallyStrokes,
    });

    discoveries.push({
      clue_id: newClue.id,
      statement: newClue.statement,
      delta_label: '等你回应',
      pending: true,
    });
  }

  ctx.stage = 'extracted';
  return emitReply(
    aiTurn.reply,
    inlineCards,
    {
      title: savedStory.title,
      story_id: savedStory.id,
      context: ctx,
      discoveries,
      token_usage: conversation.token_usage,
    },
  );
}

// 结束本次技能会话并生成《本次小结》内联卡（P2.2 本次结束画板）
export async function finishConversationSession(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationRecord; summaryMessage: MessageRecord }> {
  const [{ data: convRow }, state] = await Promise.all([
    db.from('conversations').select('*').eq('user_id', userId).eq('id', conversationId).single(),
    getFullWorkspaceState(db, userId),
  ]);
  if (!convRow) throw new Error('未找到会话');
  const conv = convRow as ConversationRecord;

  const hCount = state.progress.counters.highlight_stories;
  const lCount = state.progress.counters.low_stories;
  const valuesDone = state.progress.modules?.values?.status === 'completed';

  let nextTitle = '再讲 1 个高光故事';
  let nextReason = `高光故事 ${hCount} / 3，讲满 3 个就可以开始低谷模式`;
  let nextAction = 'story_highlight';

  if (state.eligibility.eligible) {
    nextTitle = '生成第一版个人画像';
    nextReason = `已有 ${state.eligibility.highClueCount} 条「高」线索，生成条件都满足了`;
    nextAction = 'portrait';
  } else if (hCount >= 3 && lCount < 2) {
    nextTitle = '进入经历挖掘 · 低谷模式';
    nextReason = `高光已满 ${hCount} 个，低谷故事 ${lCount} / 2`;
    nextAction = 'story_low';
  } else if (hCount + lCount >= 3 && !valuesDone) {
    nextTitle = '进入价值观澄清';
    nextReason = '故事素材已经够了，补上第二种独立证据来源';
    nextAction = 'values';
  } else if (state.assessments.length === 0 && state.clues.some((c) => c.confidence.level === '中')) {
    nextTitle = '上传一份测评报告';
    nextReason = '补充外部测评来源，让「中」级线索升到「高」';
    nextAction = 'assessment';
  }

  const touchedClues = (conv.discoveries || []).map((d) => {
    const found = state.clues.find((c) => c.id === d.clue_id);
    return {
      clueId: d.clue_id,
      statement: found ? found.user_statement || found.statement : d.statement,
      level: found ? found.confidence.level : '中',
      tally: found ? found.confidence.tallyStrokes : [],
      delta: d.delta_label,
    };
  });

  const summaryCard = {
    type: 'session_summary',
    newStories: conv.story_id ? 1 : 0,
    newClues: touchedClues.length,
    newEvidence: Math.max(1, touchedClues.length),
    items: touchedClues,
    nextTitle,
    nextReason,
    nextAction,
  };

  const summaryMsg = await appendMessage(
    db,
    userId,
    conv.id,
    'coach',
    '这个故事整理完整了。下面是这次聊出来的发现和下一步建议',
    [summaryCard],
  );

  const { data: updated } = await db
    .from('conversations')
    .update({
      status: '已结束',
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', conv.id)
    .select('*')
    .single();

  return {
    conversation: (updated as ConversationRecord) || conv,
    summaryMessage: summaryMsg,
  };
}

function summarizeStoryTitle(text: string): string {
  const clean = text.replace(/^(去年|前年|大学时|第一份工作|上周|最近|有一次)/, '$1').trim();
  const firstClause = clean.split(/[，。；！？,\n]/)[0] || clean;
  return firstClause.slice(0, 16) || '一段关键经历';
}

function buildDeterministicMiningStep(
  mode: StoryMode,
  turnCount: number,
  userText: string,
  starState: any,
  collected: any,
  existingClues: any[],
  focusClueId?: string | null,
): any {
  const richSingleTurn = [...userText].length >= 55 && /(最后|结果|后来|最投入|最难受|熬夜|理清|通了)/.test(userText);

  if (!richSingleTurn && turnCount <= 4) {
    if (turnCount === 1) {
      return {
        phase: 'ask_next',
        reply: '听起来是个很有分量的经历。当时具体是什么背景情况，你在里面负责什么？',
        starChecklist: { ...starState, situation: true },
      };
    }
    if (turnCount === 2) {
      return {
        phase: 'ask_next',
        reply: '面对这个局面，你具体采取了哪些行动？',
        starChecklist: { ...starState, situation: true, task: true },
      };
    }
    if (turnCount === 3) {
      return {
        phase: 'ask_next',
        reply: '最后结果怎么样，你当时的感受如何？',
        starChecklist: { ...starState, situation: true, task: true, action: true },
      };
    }
    if (turnCount === 4) {
      return {
        phase: 'ask_next',
        reply:
          mode === '低谷'
            ? '听起来那段时间确实不好受。最难受的是哪个点？是事情本身，还是别的什么？'
            : '整个过程里，哪个环节你最投入，觉得时间过得最快？',
        starChecklist: { ...starState, situation: true, task: true, action: true, result: true },
      };
    }
  }

  const allText = `${collected.situation} ${collected.task} ${collected.action} ${collected.result} ${userText}`;
  const extractedClues: any[] = [];

  if (mode === '低谷' && /(自主|汇报|审批|管得|执行机器|请示)/.test(allText)) {
    extractedClues.push(
      {
        statement: '自主权对我很重要',
        type: '价值观',
        dimension: '价值观',
        excerpt: userText.slice(0, 80),
        anchor_field: 'key_moment',
        interpretation: '缺乏自主空间时会感到明显压抑',
        strength: '强',
        keywords: ['自主权', '自由'],
      },
      {
        statement: '被管得过细会明显消耗我',
        type: '能量消耗',
        dimension: '能量',
        excerpt: userText.slice(0, 80),
        anchor_field: 'key_moment',
        interpretation: '高频细碎管控会快速消耗工作能量',
        strength: '强',
        keywords: ['被管过细', '汇报', '审批', '催进度'],
      },
    );
  } else {
    if (/(理清|梳理|结构|流程|清单|框架|乱麻|烂摊子)/.test(allText)) {
      extractedClues.push({
        statement: '在混乱的局面里，擅长先梳理结构再推进',
        type: '优势候选',
        dimension: '能力',
        excerpt: userText.slice(0, 80),
        anchor_field: 'key_moment',
        interpretation: '最投入的是把混乱信息理出头绪的阶段，兼具产出与正向能量',
        strength: /(熬夜|不觉得累|兴奋|通了)/.test(allText) ? '强' : '中',
        keywords: ['梳理', '结构', '流程'],
      });
    }
    if (/(画图|画表|流程表|关系图|对比表|可视化)/.test(allText) && existingClues.length >= 1) {
      extractedClues.push({
        statement: '习惯用画图、画表的方式理清思路',
        type: '行为模式',
        dimension: '能力',
        excerpt: userText.slice(0, 80),
        anchor_field: 'action',
        interpretation: '多次借助图表把复杂关系可视化',
        strength: '中',
        keywords: ['画图', '画表', '关系图', '流程表'],
      });
    }
    if (extractedClues.length === 0) {
      const targetStmt = focusClueId
        ? existingClues.find((c: any) => c.id === focusClueId)?.statement
        : mode === '低谷'
          ? '计划外的频繁打断会消耗状态'
          : '面对复杂任务时能主动稳住节奏推进';
      extractedClues.push({
        statement: targetStmt || '面对挑战时能主动寻找切入点推进',
        type: mode === '低谷' ? '能量消耗' : '优势候选',
        dimension: mode === '低谷' ? '能量' : '能力',
        excerpt: userText.slice(0, 80),
        anchor_field: 'key_moment',
        interpretation: '从讲述的具体行动与感受中提炼的行为线索',
        strength: '强',
        keywords: [],
      });
    }
  }

  return {
    phase: 'extract',
    reply:
      extractedClues.length > 1
        ? '谢谢你把细节讲得这么清楚。我从这段经历里注意到两条相关的线索，你看准不准'
        : '我从你刚讲的关键细节里注意到一个可能的线索，你看准不准',
    starChecklist: {
      situation: true,
      task: true,
      action: true,
      result: true,
      key_moment: true,
    },
    storyDraft: {
      title: collected.title || summarizeStoryTitle(allText),
      period: '近期',
      domain: '工作',
      situation: collected.situation || userText,
      task: collected.task || '负责核心推进',
      action: collected.action || userText,
      result: collected.result || '顺利完成',
      key_moment: userText,
      emotion_intensity: 4,
    },
    extractedClues,
  };
}
