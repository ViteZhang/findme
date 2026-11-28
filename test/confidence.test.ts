import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptJson, decryptText, encryptJson, encryptText } from '../server/crypto.ts';
import { buildIndependenceKey, computeConfidence } from '../src/domain/confidence.ts';
import { checkPortraitEligibility } from '../src/domain/portrait-eligibility.ts';
import { previewStoryDeletion } from '../src/domain/story-impact.ts';

test('7.3 向量 1 · 数据模型 8.6：同一故事第二条去重 + 多位反馈人各自计数 + 测评', () => {
  const res = computeConfidence({
    clueId: 'clue_0007',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      {
        id: 'ev_1',
        direction: '支持',
        sourceType: '经历',
        independenceKey: buildIndependenceKey('经历', '0003'),
        strength: '强',
        isActive: true,
      },
      {
        id: 'ev_2',
        direction: '支持',
        sourceType: '经历',
        independenceKey: buildIndependenceKey('经历', '0003'),
        strength: '中',
        isActive: true,
      },
      {
        id: 'ev_3',
        direction: '支持',
        sourceType: '他人反馈',
        independenceKey: buildIndependenceKey('他人反馈', 'fbr_0002'),
        strength: '中',
        isActive: true,
      },
      {
        id: 'ev_4',
        direction: '支持',
        sourceType: '测评',
        independenceKey: buildIndependenceKey('测评', '大五'),
        strength: '中',
        isActive: true,
      },
      {
        id: 'ev_5',
        direction: '支持',
        sourceType: '他人反馈',
        independenceKey: buildIndependenceKey('他人反馈', 'fbr_0004'),
        strength: '中',
        isActive: true,
      },
    ],
  });

  assert.equal(res.N, 4);
  assert.equal(res.S, 3);
  assert.equal(res.W_plus, 4.0);
  assert.equal(res.level, '高');
  assert.equal(res.status, '已成立');
});

test('7.3 向量 2 & 3 · 升级路线样例 3 与样例 7（含自述不计入 W+ 与 2.9 差 0.1 拦截）', () => {
  const step3 = computeConfidence({
    clueId: 'clue_0001',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      {
        id: 'ev_1',
        direction: '支持',
        sourceType: '经历',
        independenceKey: 'story:story_0001',
        strength: '强',
        isActive: true,
      },
      {
        id: 'ev_self',
        direction: '支持',
        sourceType: '用户自述',
        independenceKey: 'self:clue_0001',
        strength: '中',
        isActive: true,
      },
      {
        id: 'ev_3',
        direction: '支持',
        sourceType: '经历',
        independenceKey: 'story:story_0002',
        strength: '中',
        isActive: true,
      },
    ],
  });

  assert.equal(step3.N, 2);
  assert.equal(step3.S, 1);
  assert.equal(step3.W_plus, 2.5);
  assert.equal(step3.level, '中');
  assert.equal(step3.next_needed, '还差 1 条来自测评、价值观澄清或他人反馈的证据');

  const step7 = computeConfidence({
    clueId: 'clue_0001',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      ...step3.tallyStrokes
        .filter((s) => s.evidenceId)
        .map((s) => ({
          id: s.evidenceId!,
          direction: '支持' as const,
          sourceType: s.sourceType!,
          independenceKey: s.evidenceId === 'ev_1' ? 'story:story_0001' : 'story:story_0002',
          strength: (s.kind === 'strong' ? '强' : '中') as '强' | '中',
          isActive: true,
        })),
      {
        id: 'ev_energy',
        direction: '支持',
        sourceType: '能量',
        independenceKey: 'energy:er_0001',
        strength: '弱',
        isActive: true,
      },
    ],
  });

  assert.equal(step7.N, 3);
  assert.equal(step7.S, 2);
  assert.equal(step7.W_plus, 2.9);
  assert.equal(step7.level, '中');
});

test('7.3 向量 4 · V0.5 路线：经历强 + 经历中 + 测评中 → N=3, S=2, W+=3.0, 高', () => {
  const res = computeConfidence({
    clueId: 'clue_0001',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      {
        id: 'ev_1',
        direction: '支持',
        sourceType: '经历',
        independenceKey: 'story:story_0001',
        strength: '强',
        isActive: true,
      },
      {
        id: 'ev_2',
        direction: '支持',
        sourceType: '经历',
        independenceKey: 'story:story_0002',
        strength: '中',
        isActive: true,
      },
      {
        id: 'ev_3',
        direction: '支持',
        sourceType: '测评',
        independenceKey: 'assess:大五人格',
        strength: '中',
        isActive: true,
      },
    ],
  });

  assert.equal(res.N, 3);
  assert.equal(res.S, 2);
  assert.equal(res.W_plus, 3.0);
  assert.equal(res.level, '高');
  assert.equal(res.gates.own_experience.applies, true);
  assert.equal(res.gates.own_experience.met, true);
});

test('7.3 向量 5 · 测试样例 9：优势候选无本人经历时封顶为「中」，caps 含「缺本人经历」', () => {
  const res = computeConfidence({
    clueId: 'clue_0007',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      { id: 'f1', direction: '支持', sourceType: '他人反馈', independenceKey: 'feedback:1', strength: '中', isActive: true },
      { id: 'f2', direction: '支持', sourceType: '他人反馈', independenceKey: 'feedback:2', strength: '中', isActive: true },
      { id: 'f3', direction: '支持', sourceType: '他人反馈', independenceKey: 'feedback:3', strength: '中', isActive: true },
      { id: 'a1', direction: '支持', sourceType: '测评', independenceKey: 'assess:大五', strength: '中', isActive: true },
    ],
  });

  assert.equal(res.N, 4);
  assert.equal(res.S, 2);
  assert.equal(res.W_plus, 3.5);
  assert.equal(res.level, '中');
  assert.ok(res.caps.includes('缺本人经历'));
  assert.equal(res.needsExample, true);
  assert.equal(res.gates.own_experience.met, false);
});

test('7.3 向量 6 · 设计第 2 批删除预览：高→中(3.0→1.5)、中→中、中→已归档', () => {
  const preview = previewStoryDeletion('story_0001', [
    {
      id: 'clue_0001',
      statement: '在混乱的局面里，擅长先梳理结构再推进',
      type: '优势候选',
      userStance: '认同',
      denyCount: 0,
      evidence: [
        { id: 'e1', direction: '支持', sourceType: '经历', independenceKey: 'story:story_0001', storyId: 'story_0001', strength: '强', isActive: true },
        { id: 'e2', direction: '支持', sourceType: '经历', independenceKey: 'story:story_0002', storyId: 'story_0002', strength: '中', isActive: true },
        { id: 'e3', direction: '支持', sourceType: '测评', independenceKey: 'assess:大五', strength: '中', isActive: true },
        { id: 'e4', direction: '支持', sourceType: '用户自述', independenceKey: 'self:clue_0001', storyId: 'story_0001', strength: '中', isActive: true },
      ],
    },
    {
      id: 'clue_0002',
      statement: '习惯用画图、画表的方式理清思路',
      type: '行为模式',
      userStance: '认同',
      denyCount: 0,
      evidence: [
        { id: 'e5', direction: '支持', sourceType: '经历', independenceKey: 'story:story_0001', storyId: 'story_0001', strength: '中', isActive: true },
        { id: 'e6', direction: '支持', sourceType: '经历', independenceKey: 'story:story_0002', storyId: 'story_0002', strength: '中', isActive: true },
      ],
    },
    {
      id: 'clue_0009',
      statement: '能牵头大型活动，但做完需要较长时间恢复',
      type: '习得技能',
      userStance: '认同',
      denyCount: 0,
      evidence: [
        { id: 'e7', direction: '支持', sourceType: '经历', independenceKey: 'story:story_0001', storyId: 'story_0001', strength: '强', isActive: true },
      ],
    },
  ]);

  assert.equal(preview.highCountBefore, 1);
  assert.equal(preview.highCountAfter, 0);
  assert.equal(preview.affectedClues.length, 3);

  const [c1, c2, c3] = preview.affectedClues;
  assert.equal(c1.beforeLevel, '高');
  assert.equal(c1.afterLevel, '中');
  assert.equal(c1.before.W_plus, 3.0);
  assert.equal(c1.after.W_plus, 1.5);

  assert.equal(c2.beforeLevel, '中');
  assert.equal(c2.afterLevel, '中');
  assert.equal(c2.summaryText, '证据 2 → 1 · 你认同过');

  assert.equal(c3.beforeLevel, '中');
  assert.equal(c3.afterLevel, '已归档');
  assert.equal(c3.autoArchived, true);
});

test('7.3 向量 7 & 反证临界值：否认 1 次降级 / 2 次归档，W- >= 0.3*W+ 封顶中，W- >= W+ 降为线索', () => {
  const baseEv = [
    { id: 'e1', direction: '支持' as const, sourceType: '经历' as const, independenceKey: 'story:1', strength: '强' as const, isActive: true },
    { id: 'e2', direction: '支持' as const, sourceType: '经历' as const, independenceKey: 'story:2', strength: '中' as const, isActive: true },
    { id: 'e3', direction: '支持' as const, sourceType: '测评' as const, independenceKey: 'assess:大五', strength: '中' as const, isActive: true },
  ];

  const deniedOnce = computeConfidence({
    clueId: 'c1',
    type: '优势候选',
    userStance: '否认',
    denyCount: 1,
    evidence: baseEv,
  });
  assert.equal(deniedOnce.level, '中');

  const deniedTwice = computeConfidence({
    clueId: 'c1',
    type: '优势候选',
    userStance: '否认',
    denyCount: 2,
    evidence: baseEv,
  });
  assert.equal(deniedTwice.level, '已归档');
  assert.equal(deniedTwice.status, '已归档');

  // W+ = 3.0, W- = 0.9 (恰好 30%) → 封顶为中
  const cappedOpp = computeConfidence({
    clueId: 'c1',
    type: '价值观',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      ...baseEv,
      { id: 'opp1', direction: '反对', sourceType: '价值观', independenceKey: 'values:1', strength: '强', isActive: true }, // 0.8 * 1.5 = 1.2 >= 0.9
    ],
  });
  assert.equal(cappedOpp.level, '中');
  assert.equal(cappedOpp.hasMixedOpposition, true);

  // W- >= W+ → 降为线索
  const dominatedOpp = computeConfidence({
    clueId: 'c2',
    type: '价值观',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      { id: 's1', direction: '支持', sourceType: '测评', independenceKey: 'assess:1', strength: '中', isActive: true }, // 0.5
      { id: 'o1', direction: '反对', sourceType: '经历', independenceKey: 'story:9', strength: '中', isActive: true }, // 1.0
    ],
  });
  assert.equal(dominatedOpp.level, '线索');
  assert.ok(dominatedOpp.caps.includes('反证占优'));
});

test('画像准入资格与 AES-256-GCM 敏感字段加解密验证', () => {
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const cipher = encryptText('其实是前期把一团乱麻理清楚的那段，熬夜都不觉得累', secret);
  assert.ok(cipher.startsWith('enc:v1:'));
  assert.notEqual(cipher, '其实是前期把一团乱麻理清楚的那段，熬夜都不觉得累');
  assert.equal(decryptText(cipher, secret), '其实是前期把一团乱麻理清楚的那段，熬夜都不觉得累');

  const star = { situation: '很乱', task: '统筹', action: '画流程表', result: '顺利' };
  const starEnc = encryptJson(star, secret);
  assert.deepEqual(decryptJson(starEnc, { situation: '', task: '', action: '', result: '' }, secret), star);

  const highConf = computeConfidence({
    clueId: 'h1',
    type: '优势候选',
    userStance: '认同',
    denyCount: 0,
    evidence: [
      { id: '1', direction: '支持', sourceType: '经历', independenceKey: 'story:1', strength: '强', isActive: true },
      { id: '2', direction: '支持', sourceType: '经历', independenceKey: 'story:2', strength: '中', isActive: true },
      { id: '3', direction: '支持', sourceType: '测评', independenceKey: 'assess:大五', strength: '中', isActive: true },
    ],
  });

  const notYet = checkPortraitEligibility({
    clues: [{ id: 'h1', statement: '梳理结构', type: '优势候选', confidence: highConf }],
    valuesCompleted: true,
  });
  assert.equal(notYet.eligible, false);
  assert.equal(notYet.blockingReason, '还差 2 条「高」置信线索');

  const ready = checkPortraitEligibility({
    clues: [
      { id: 'h1', statement: '梳理结构', type: '优势候选', confidence: highConf },
      { id: 'h2', statement: '自主权', type: '价值观', confidence: highConf },
      { id: 'h3', statement: '被管过细消耗', type: '能量消耗', confidence: highConf },
    ],
    valuesCompleted: true,
  });
  assert.equal(ready.eligible, true);
});
