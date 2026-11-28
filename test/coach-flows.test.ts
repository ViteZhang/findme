import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  VALUES_POOL_30,
  disposeAssessmentRawFileTool,
  parseAndCreateAssessmentTool,
  respondAssessmentComparisonTool,
  startOrUpdateValuesTool,
} from '../server/assessment-values.ts';
import {
  processUserTurn,
  startOrResumeConversation,
} from '../server/coach-orchestrator.ts';
import { buildPortraitDocxBase64 } from '../server/docx-export.ts';
import {
  confirmPortraitSectionTool,
  renderPortraitMarkdown,
  runPortraitGenerationStep,
  startOrGetPortraitDraft,
} from '../server/portrait-builder.ts';
import { wrapPgliteAsSupabase } from '../server/runtime-db.ts';
import {
  addEvidenceTool,
  createClueTool,
  deleteStoryTool,
  getFullWorkspaceState,
  saveStoryTool,
} from '../server/tools.ts';

async function createTestDb() {
  const pg = new PGlite();
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
  await pg.exec(fs.readFileSync(sqlPath, 'utf8'));
  const userId = '33333333-3333-4333-8333-333333333333';
  await pg.exec(`insert into auth.users (id) values ('${userId}');`);
  return { pg, db: wrapPgliteAsSupabase(pg), userId };
}

test('测试对话全链路验收：目标设定 → 自述追问 → 价值观(R1/R3) → 测评(MBTI/大五) → 四步画像与删故事脱敏 → 安全红线(E3/E4/E5)', async () => {
  const { pg, db, userId } = await createTestDb();

  // 1. 样例 1：目标设定多轮对话闭环
  const goalSession = await startOrResumeConversation(db, userId, { skill: '目标设定' });
  assert.equal(goalSession.conversation.skill, '目标设定');
  assert.equal(goalSession.messages.length, 1);

  await processUserTurn(db, userId, {
    conversationId: goalSession.conversation.id,
    text: '工作五年了，最近在想接下来往哪走',
  });
  await processUserTurn(db, userId, {
    conversationId: goalSession.conversation.id,
    text: '朋友创业叫我过去做合伙人，我拿不准自己适不适合从零搭摊子',
  });
  await processUserTurn(db, userId, {
    conversationId: goalSession.conversation.id,
    text: '职业方向的参考',
  });
  const goalTurn4 = await processUserTurn(db, userId, {
    conversationId: goalSession.conversation.id,
    text: '直接说就行，最好举例子',
  });
  assert.ok(
    goalTurn4.coachMessage.inline_cards.some((c: any) => c.type === 'goal_summary'),
    '第 4 轮后应产出可编辑的目标设定总结卡',
  );

  // 2. E3 越界请求：要求替做重大决定时明确拒绝并拉回证据探索
  const storySession = await startOrResumeConversation(db, userId, {
    skill: '经历挖掘',
    mode: '高光',
    forceNew: true,
  });
  const boundaryTurn = await processUserTurn(db, userId, {
    conversationId: storySession.conversation.id,
    text: '你直接告诉我，我到底该不该辞职去朋友的创业公司？',
  });
  assert.ok(
    boundaryTurn.coachMessage.content.includes('决定') ||
      boundaryTurn.coachMessage.content.includes('替你'),
    '面对代做人生决定请求应温和守住教练边界',
  );

  // 3. 样例 4：用户主动自我评价（「用户自述」虚线不计分 + 立即追问具体例子）
  const selfClueTurn = await processUserTurn(db, userId, {
    conversationId: storySession.conversation.id,
    text: '我觉得我其实挺擅长沟通协调的',
  });
  assert.ok(
    selfClueTurn.coachMessage.content.includes('例子') ||
      selfClueTurn.coachMessage.content.includes('哪次') ||
      selfClueTurn.coachMessage.content.includes('具体'),
  );

  // 4. 样例 6 + E7 + R3：价值观澄清（10 词 → 两难题无理由降弱 & 连续两次犹豫可跳过 → Top5 定稿）
  await startOrUpdateValuesTool(db, userId, { kind: 'init' });
  const shortlist10 = VALUES_POOL_30.slice(0, 10);
  const afterShortlist = await startOrUpdateValuesTool(db, userId, {
    kind: 'save_shortlist',
    shortlist: shortlist10,
  });
  assert.equal(afterShortlist.ranking.step, 'tradeoffs');

  // 第 1 题：只选 A 不填理由 → 记弱证据 (R1)
  const d1 = afterShortlist.ranking.tradeoffs[0];
  await startOrUpdateValuesTool(db, userId, {
    kind: 'answer_dilemma',
    rankingId: afterShortlist.ranking.id,
    dilemmaId: d1.id,
    choice: 'A',
    reason: '',
  });

  // 第 2 题：连续两次「都重要」后允许跳过且不产生证据 (R3)
  let rState = (await getFullWorkspaceState(db, userId)).valueRankings[0];
  const d2 = rState.tradeoffs.find((t: any) => !t.skipped && t.choice === null)!;
  await startOrUpdateValuesTool(db, userId, {
    kind: 'answer_dilemma',
    rankingId: rState.id,
    dilemmaId: d2.id,
    bothImportant: true,
  });
  await startOrUpdateValuesTool(db, userId, {
    kind: 'answer_dilemma',
    rankingId: rState.id,
    dilemmaId: d2.id,
    bothImportant: true,
  });
  await startOrUpdateValuesTool(db, userId, {
    kind: 'answer_dilemma',
    rankingId: rState.id,
    dilemmaId: d2.id,
    bothImportant: true,
    skipAfterHesitate: true,
  });

  // 答完剩余两难题并完成讨论与 Top 5 确认
  rState = (await getFullWorkspaceState(db, userId)).valueRankings[0];
  for (const rem of rState.tradeoffs.filter((t: any) => !t.skipped && t.choice === null)) {
    await startOrUpdateValuesTool(db, userId, {
      kind: 'answer_dilemma',
      rankingId: rState.id,
      dilemmaId: rem.id,
      choice: 'A',
      reason: '比起安稳按部就班，我更需要自己决定怎么把事情做成',
    });
  }
  rState = (await getFullWorkspaceState(db, userId)).valueRankings[0];
  if (rState.step === 'discussion') {
    rState = (
      await startOrUpdateValuesTool(db, userId, {
        kind: 'respond_inconsistency',
        rankingId: rState.id,
        agreed: true,
      })
    ).ranking;
  }
  const top5Payload = (rState.top5 || shortlist10.slice(0, 5).map((v, i) => ({ rank: i + 1, value: v, user_definition: '' }))).map(
    (item: any, i: number) => ({
      rank: i + 1,
      value: item.value,
      user_definition: `第 ${i + 1} 重要的原则：按自己的理解把事做扎实`,
    }),
  );
  const confirmedVal = await startOrUpdateValuesTool(db, userId, {
    kind: 'confirm_top5',
    rankingId: rState.id,
    top5: top5Payload,
  });
  assert.equal(confirmedVal.ranking.step, 'completed');

  // 5. E8：MBTI 粘贴结果不计入证据权重
  const mbtiAssess = await parseAndCreateAssessmentTool(db, userId, {
    pastedText: '我测出来是 INTJ 建筑师型',
  });
  assert.equal(mbtiAssess.instrument, 'MBTI');
  assert.equal(mbtiAssess.counts_as_evidence, false);

  // 6. 构建 3 条「高」置信线索（故事 + 大五测评跨来源验证）并走通 P5.2 四步画像定稿与导出
  const stA = await saveStoryTool(db, userId, {
    mode: '高光',
    title: '跨部门救火重构排期',
    star: { situation: '排期失控', task: '接手统筹', action: '拆解关键路径', result: '提前交付' },
    keyMoment: '把乱成一团的依赖关系画清楚的那晚',
  });
  const stB = await saveStoryTool(db, userId, {
    mode: '高光',
    title: '从零搭建知识库体系',
    star: { situation: '新人上手慢', task: '整理体系', action: '搭建分层目录', result: '效率翻倍' },
    keyMoment: '看着大家按新结构顺畅协作',
  });
  const stLow = await saveStoryTool(db, userId, {
    mode: '低谷',
    title: '被每天三次日报盯细节的项目',
    star: { situation: '微管理严重', task: '执行固定模板', action: '机械填表', result: '极度疲惫' },
    keyMoment: '连改一个字段都要层层审批的时候',
  });

  const c1 = await createClueTool(db, userId, {
    statement: '面对混乱局面擅长先搭建清晰结构',
    type: '优势候选',
    dimension: '能力',
    createdBy: '经历挖掘',
    userStance: '认同',
  });
  const c2 = await createClueTool(db, userId, {
    statement: '自主把控节奏时创造力与投入度最高',
    type: '能量来源',
    dimension: '能量',
    createdBy: '经历挖掘',
    userStance: '认同',
  });
  const c3 = await createClueTool(db, userId, {
    statement: '在频繁琐碎汇报与微管理下迅速消耗',
    type: '能量消耗',
    dimension: '能量',
    createdBy: '经历挖掘',
    userStance: '认同',
  });

  for (const [cid, ex1, ex2] of [
    [c1.id, '把乱成一团的依赖关系画清楚的那晚', '看着大家按新结构顺畅协作'],
    [c2.id, '自己决定拆解路径时熬夜也不累', '独立搭完分层目录非常有成就感'],
  ] as const) {
    await addEvidenceTool(db, userId, {
      clueId: cid,
      sourceType: '经历',
      sourceRef: stA.id,
      sourceTitle: stA.title,
      storyId: stA.id,
      excerpt: ex1,
      interpretation: '故事 A 支撑',
      strength: '强',
      createdBy: '经历挖掘',
    });
    await addEvidenceTool(db, userId, {
      clueId: cid,
      sourceType: '经历',
      sourceRef: stB.id,
      sourceTitle: stB.title,
      storyId: stB.id,
      excerpt: ex2,
      interpretation: '故事 B 支撑',
      strength: '强',
      createdBy: '经历挖掘',
    });
  }

  await addEvidenceTool(db, userId, {
    clueId: c3.id,
    sourceType: '经历',
    sourceRef: stLow.id,
    sourceTitle: stLow.title,
    storyId: stLow.id,
    excerpt: '连改一个字段都要层层审批的时候',
    interpretation: '低谷消耗',
    strength: '强',
    createdBy: '经历挖掘',
  });
  await addEvidenceTool(db, userId, {
    clueId: c3.id,
    sourceType: '价值观',
    sourceRef: confirmedVal.ranking.id,
    sourceTitle: '价值观取舍',
    excerpt: '看重自主胜过按部就班',
    interpretation: '价值观印证',
    strength: '强',
    createdBy: '价值观澄清',
  });
  await addEvidenceTool(db, userId, {
    clueId: c3.id,
    sourceType: '测评',
    sourceRef: '大五人格',
    sourceTitle: '大五人格',
    excerpt: '开放性 78',
    interpretation: '测评印证',
    strength: '中',
    createdBy: '测评解读',
  });

  // 解析大五测评并对前两条线索回应认同，使 c1, c2 同样跨来源升「高」
  const big5 = await parseAndCreateAssessmentTool(db, userId, {
    pastedText: '开放性 78\n尽责性 85\n外向性 32',
    fileName: 'big5.pdf',
  });
  assert.equal(big5.counts_as_evidence, true);

  await addEvidenceTool(db, userId, {
    clueId: c1.id,
    sourceType: '测评',
    sourceRef: big5.id,
    sourceTitle: '大五人格',
    excerpt: '尽责性 85',
    interpretation: '高尽责性印证结构化能力',
    strength: '中',
    createdBy: '测评解读',
  });
  await addEvidenceTool(db, userId, {
    clueId: c2.id,
    sourceType: '测评',
    sourceRef: big5.id,
    sourceTitle: '大五人格',
    excerpt: '开放性 78',
    interpretation: '高开放性印证自主探索能量',
    strength: '中',
    createdBy: '测评解读',
  });

  // 测试测评对照「先跳过」(R2) 与原件销毁记忆 (R7)
  if (big5.comparisons.length > 0) {
    const skipRes = await respondAssessmentComparisonTool(db, userId, {
      assessmentId: big5.id,
      comparisonId: big5.comparisons[0].id,
      action: 'skip',
    });
    assert.equal(skipRes.assessment.comparisons[0].status, 'skipped');
  }
  await disposeAssessmentRawFileTool(db, userId, {
    assessmentId: big5.id,
    deleteFile: true,
    rememberChoice: true,
  });

  const readyState = await getFullWorkspaceState(db, userId);
  assert.equal(readyState.eligibility.eligible, true, '此时三条高线索+价值观+多来源应满足画像生成门槛');

  // 生成画像 v1 并逐节确认（含原地改写一句结论）
  const draft = await startOrGetPortraitDraft(db, userId, '证据达标');
  const generated = await runPortraitGenerationStep(db, userId, draft.version);
  assert.equal(generated.status, '待确认');
  assert.equal(generated.sections.length, 8);
  assert.equal(generated.review_notes.length, 7);

  const firstClaim = generated.sections[0].claims[0];
  await confirmPortraitSectionTool(db, userId, {
    version: generated.version,
    section: 1,
    editedClaimId: firstClaim.id,
    editedText: '在复杂无序的起步期，擅长先搭出清晰骨架再推进',
  });
  for (let sec = 2; sec <= 8; sec++) {
    await confirmPortraitSectionTool(db, userId, {
      version: generated.version,
      section: sec,
    });
  }

  const afterFinal = await getFullWorkspaceState(db, userId);
  const v1 = afterFinal.portraits.find((p) => p.version === 1)!;
  assert.equal(v1.status, '已定稿');
  assert.equal(v1.sections[0].claims[0].user_edited, true);

  // 验证 Markdown 与 Word (.docx) 导出
  const mdNoExcerpts = renderPortraitMarkdown(v1, false);
  assert.ok(!mdNoExcerpts.includes('原话〔'));
  const docxB64 = await buildPortraitDocxBase64(v1, true);
  assert.ok(docxB64.length > 200, '应生成有效的 .docx 二进制文档');

  // 删除故事 A 后，验证历史已定稿画像 v1 中的原话摘录已被自动脱敏标为「来源已删除」
  await deleteStoryTool(db, userId, stA.id, { preview: false });
  const afterDelStory = await getFullWorkspaceState(db, userId);
  const v1AfterDel = afterDelStory.portraits.find((p) => p.version === 1)!;
  const mdWithExcerpts = renderPortraitMarkdown(v1AfterDel, true);
  assert.ok(mdWithExcerpts.includes('来源已删除'), '删除原故事后历史画像摘录须显示来源已删除');

  // 7. E5 高风险危机信号拦截：立即返回 12356 热线、锁死写入、且 safety_events 绝不落对话原话
  const crisisTurn = await processUserTurn(db, userId, {
    conversationId: storySession.conversation.id,
    text: '我觉得活着没意思，甚至想过结束这一切',
  });
  assert.equal(crisisTurn.safetyTriggered, 'high');
  assert.ok(
    crisisTurn.coachMessage.inline_cards.some(
      (c: any) => c.type === 'safety_card' && c.level === 'high' && c.hotlineNumber === '12356',
    ),
  );
  const rawSafetyRows = await pg.query<{ signal_category: string }>(
    `select signal_category from public.safety_events where user_id = $1`,
    [userId],
  );
  assert.ok(rawSafetyRows.rows.length >= 1);
  assert.ok(
    !JSON.stringify(rawSafetyRows.rows).includes('活着没意思'),
    '安全日志严禁存储任何用户原话',
  );

  await pg.close();
});
