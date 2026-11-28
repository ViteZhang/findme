import type {
  ArchiveReason,
  ClueStatus,
  ClueType,
  ConfidenceLevel,
  ConfidenceResult,
  EvidenceInput,
  EvidenceSourceType,
  EvidenceStrength,
  UserStance,
} from './types.ts';

export const SOURCE_WEIGHTS: Record<EvidenceSourceType, number> = {
  经历: 1.0,
  他人反馈: 1.0,
  价值观: 0.8,
  能量: 0.8,
  测评: 0.5,
  实验: 1.2,
  用户自述: 0.3,
};

export const STRENGTH_MULTIPLIERS: Record<EvidenceStrength, number> = {
  强: 1.5,
  中: 1.0,
  弱: 0.5,
};

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  强: 3,
  中: 2,
  弱: 1,
};

const LEVEL_TO_STATUS: Record<ConfidenceLevel, ClueStatus> = {
  线索: '待观察',
  中: '成立中',
  高: '已成立',
  已验证: '已验证',
  已归档: '已归档',
};

export interface ComputeConfidenceParams {
  clueId: string;
  type: ClueType;
  userStance: UserStance;
  denyCount: number;
  archiveReason?: ArchiveReason;
  createdByUser?: boolean;
  evidence: EvidenceInput[];
}

function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}

function deduplicateByIndependenceKey(items: EvidenceInput[]): EvidenceInput[] {
  const bestByKey = new Map<string, EvidenceInput>();
  for (const item of items) {
    if (!item.isActive) continue;
    const key = `${item.direction}::${item.independenceKey}`;
    const existing = bestByKey.get(key);
    if (!existing || STRENGTH_RANK[item.strength] > STRENGTH_RANK[existing.strength]) {
      bestByKey.set(key, item);
    }
  }
  return [...bestByKey.values()];
}

function downgradeOnce(level: Exclude<ConfidenceLevel, '已归档'>): Exclude<ConfidenceLevel, '已归档'> {
  if (level === '已验证') return '高';
  if (level === '高') return '中';
  if (level === '中') return '线索';
  return '线索';
}

export function buildIndependenceKey(
  sourceType: EvidenceSourceType,
  ref: string,
  clueId?: string,
): string {
  switch (sourceType) {
    case '经历':
      return `story:${ref}`;
    case '价值观':
      return `values:${ref}`;
    case '能量':
      return `energy:${ref}`;
    case '他人反馈':
      return `feedback:${ref}`;
    case '测评':
      return `assess:${ref}`;
    case '实验':
      return `exp:${ref}`;
    case '用户自述':
      return `self:${clueId || ref}`;
  }
}

export function computeConfidence(params: ComputeConfidenceParams): ConfidenceResult {
  const {
    clueId,
    type,
    userStance,
    denyCount,
    archiveReason = null,
    createdByUser = false,
    evidence,
  } = params;

  const isAdvantage = type === '优势候选';
  const activeDeduped = deduplicateByIndependenceKey(evidence);

  // 支持证据（不含用户自述）计入 N、S、W+
  const countedSupport = activeDeduped.filter(
    (e) => e.direction === '支持' && e.sourceType !== '用户自述',
  );
  const selfStatements = activeDeduped.filter(
    (e) => e.direction === '支持' && e.sourceType === '用户自述',
  );
  const opposing = activeDeduped.filter(
    (e) => e.direction === '反对' && e.sourceType !== '用户自述',
  );

  const N = countedSupport.length;
  const supportingSourceSet = new Set<EvidenceSourceType>(countedSupport.map((e) => e.sourceType));
  const S = supportingSourceSet.size;

  const W_plus = roundScore(
    countedSupport.reduce(
      (sum, e) => sum + SOURCE_WEIGHTS[e.sourceType] * STRENGTH_MULTIPLIERS[e.strength],
      0,
    ),
  );
  const W_minus = roundScore(
    opposing.reduce(
      (sum, e) => sum + SOURCE_WEIGHTS[e.sourceType] * STRENGTH_MULTIPLIERS[e.strength],
      0,
    ),
  );

  const hasOwnExperience = countedSupport.some(
    (e) => e.sourceType === '经历' || e.sourceType === '实验',
  );
  const hasSupportingExperiment = countedSupport.some(
    (e) => e.sourceType === '实验' && (!e.verdict || e.verdict === '支持'),
  );

  const gates = {
    evidence_count: { value: N, target: 3, met: N >= 3 },
    source_kinds: { value: S, target: 2, met: S >= 2 },
    weighted_score: { value: W_plus, target: 3.0, met: W_plus >= 3.0 },
    own_experience: {
      value: hasOwnExperience,
      met: !isAdvantage || hasOwnExperience,
      applies: isAdvantage,
    },
  };

  const caps: string[] = [];

  // 归档判定：否认 >= 2 次，或显式归档原因（如来源删除使证据归零、被合并）
  const isArchived =
    denyCount >= 2 ||
    archiveReason === 'denied' ||
    archiveReason === 'source_deleted' ||
    archiveReason === 'merged' ||
    archiveReason === 'manual';

  if (isArchived) {
    const reasonText =
      denyCount >= 2 || archiveReason === 'denied'
        ? '你说过两次不像你，已移入归档，随时可以恢复'
        : archiveReason === 'source_deleted'
          ? '关联的原始故事已删除，没有剩余证据'
          : archiveReason === 'merged'
            ? '已并入相似线索'
            : '已归档，不再参与画像';

    return {
      clueId,
      level: '已归档',
      status: '已归档',
      N,
      S,
      W_plus,
      W_minus,
      gates,
      caps,
      hasOwnExperience,
      needsExample: false,
      hasMixedOpposition: false,
      supportingSources: [...supportingSourceSet],
      tallyStrokes: buildTallyStrokes(countedSupport, selfStatements, '已归档'),
      next_needed: reasonText,
    };
  }

  // 基础数值等级判定（第 4 步）
  const numericMeetsHigh = N >= 3 && S >= 2 && W_plus >= 3.0;
  const hasMediumOrStrongSingle =
    N >= 1 &&
    userStance === '认同' &&
    countedSupport.some((e) => e.strength === '强' || e.strength === '中');
  const numericMeetsMedium = (N >= 2 && W_plus >= 1.5) || hasMediumOrStrongSingle;

  let rawLevel: Exclude<ConfidenceLevel, '已归档'> = '线索';
  if (numericMeetsHigh) {
    rawLevel = hasSupportingExperiment ? '已验证' : '高';
  } else if (numericMeetsMedium) {
    rawLevel = '中';
  }

  // 第 5 步：反证修正、优势本人经历封顶、用户第 1 次否认修正
  let hasMixedOpposition = false;

  if (W_minus > 0 && W_minus >= W_plus) {
    rawLevel = '线索';
    caps.push('反证占优');
  } else if (W_minus > 0 && W_minus >= W_plus * 0.3) {
    hasMixedOpposition = true;
    caps.push('反对证据较多');
    if (rawLevel === '高' || rawLevel === '已验证') {
      rawLevel = '中';
    }
  }

  // B5：优势候选要达到「高」或「已验证」，至少要有 1 条本人经历证据
  if (isAdvantage && !hasOwnExperience && (rawLevel === '高' || rawLevel === '已验证')) {
    rawLevel = '中';
    caps.push('缺本人经历');
  }

  // 用户否认 1 次 → 降一级
  if (denyCount === 1) {
    rawLevel = downgradeOnce(rawLevel);
    caps.push('你曾表示不太像');
  }

  const needsExample =
    (createdByUser && !hasOwnExperience) ||
    (selfStatements.length > 0 && N === 0) ||
    (isAdvantage && !hasOwnExperience && N > 0);

  const nextNeeded = buildNextNeeded({
    level: rawLevel,
    isAdvantage,
    hasOwnExperience,
    N,
    S,
    W_plus,
    supportingSources: [...supportingSourceSet],
    selfCount: selfStatements.length,
    userStance,
    countedSupport,
    caps,
  });

  return {
    clueId,
    level: rawLevel,
    status: LEVEL_TO_STATUS[rawLevel],
    N,
    S,
    W_plus,
    W_minus,
    gates,
    caps,
    hasOwnExperience,
    needsExample,
    hasMixedOpposition,
    supportingSources: [...supportingSourceSet],
    tallyStrokes: buildTallyStrokes(countedSupport, selfStatements, rawLevel),
    next_needed: nextNeeded,
  };
}

function buildTallyStrokes(
  countedSupport: EvidenceInput[],
  selfStatements: EvidenceInput[],
  level: ConfidenceLevel,
): ConfidenceResult['tallyStrokes'] {
  const sorted = [...countedSupport].sort(
    (a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength],
  );
  const strokes: ConfidenceResult['tallyStrokes'] = sorted.map((e) => ({
    evidenceId: e.id,
    kind: e.strength === '强' ? 'strong' : e.strength === '中' ? 'medium' : 'weak',
    weight: roundScore(SOURCE_WEIGHTS[e.sourceType] * STRENGTH_MULTIPLIERS[e.strength]),
    sourceType: e.sourceType,
  }));

  if (strokes.length === 0 && selfStatements.length > 0) {
    strokes.push({
      evidenceId: selfStatements[0].id,
      kind: 'self',
      weight: 0,
      sourceType: '用户自述',
    });
  }

  if (level !== '高' && level !== '已验证' && level !== '已归档') {
    const targetSlots = 3;
    const realCount = sorted.length;
    const currentVisual = strokes.length;
    const slotsNeeded = Math.max(targetSlots - Math.max(realCount, currentVisual), realCount < 3 && selfStatements.length > 0 && realCount === 0 ? 2 : 0);
    for (let i = 0; i < slotsNeeded; i++) {
      strokes.push({ kind: 'slot' });
    }
  }

  return strokes;
}

function buildNextNeeded(ctx: {
  level: Exclude<ConfidenceLevel, '已归档'>;
  isAdvantage: boolean;
  hasOwnExperience: boolean;
  N: number;
  S: number;
  W_plus: number;
  supportingSources: EvidenceSourceType[];
  selfCount: number;
  userStance: UserStance;
  countedSupport: EvidenceInput[];
  caps: string[];
}): string {
  const {
    level,
    isAdvantage,
    hasOwnExperience,
    N,
    S,
    W_plus,
    supportingSources,
    selfCount,
    userStance,
    countedSupport,
    caps,
  } = ctx;

  if (level === '已验证') {
    return '已通过行为实验验证';
  }
  if (level === '高') {
    return '已满足「高」置信度条件，可以写进画像核心结论';
  }
  if (caps.includes('缺本人经历') || (isAdvantage && !hasOwnExperience && N >= 2)) {
    return '还差 1 个你自己的例子';
  }
  if (caps.includes('反证占优')) {
    return '目前相反的情况更多，可以在对话里进一步探讨情境差异';
  }
  if (caps.includes('反对证据较多')) {
    return '存在相反证据，最高到「中」，画像会如实保留两面情况';
  }
  if (N === 0 && selfCount > 0) {
    return '自述不计入证据数，至少需要 1 个你自己的经历';
  }
  if (N === 0) {
    return '讲一个具体的故事，为这条线索补上第一笔证据';
  }
  if (level === '线索') {
    if (
      N === 1 &&
      userStance === '未回应' &&
      countedSupport.some((e) => e.strength === '强' || e.strength === '中')
    ) {
      return '等你确认这条线索是否准确，确认后即可升为「中」';
    }
    return '再有 1 条独立证据，就能升为「中」';
  }

  // 当前在「中」，计算距离「高」(N>=3, S>=2, W+>=3.0, 优势需本人经历) 还差什么
  const missingCount = Math.max(0, 3 - N);
  const missingSources = Math.max(0, 2 - S);
  const missingScore = roundScore(Math.max(0, 3.0 - W_plus));

  if (missingSources > 0) {
    if (supportingSources.length === 1 && supportingSources[0] === '经历') {
      return '还差 1 条来自测评、价值观澄清或他人反馈的证据';
    }
    return '还差 1 条来自不同来源种类的证据（如你讲的故事、价值观或测评）';
  }
  if (missingCount > 0) {
    return `还差 ${missingCount} 条独立证据`;
  }
  if (missingScore > 0) {
    return `证据数和来源已够，加权分还差 ${missingScore}（再补 1 个具体例子即可到「高」）`;
  }
  return '再补充 1 条独立证据即可升级';
}
