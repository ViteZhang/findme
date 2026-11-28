import type { ConfidenceResult, EvidenceSourceType } from './types.ts';

export interface PortraitEligibilityInput {
  clues: Array<{
    id: string;
    statement: string;
    type: string;
    confidence: ConfidenceResult;
  }>;
  valuesCompleted: boolean;
}

export interface PortraitEligibilityResult {
  eligible: boolean;
  highClueCount: number;
  highClueTarget: number;
  valuesCompleted: boolean;
  distinctSourceCount: number;
  distinctSourceTarget: number;
  gates: {
    high_clues: { value: number; target: number; met: boolean };
    values_clarified: { value: boolean; met: boolean };
    source_kinds: { value: number; target: number; met: boolean };
  };
  highClues: Array<{ id: string; statement: string; type: string; confidence: ConfidenceResult }>;
  closestClues: Array<{ id: string; statement: string; type: string; confidence: ConfidenceResult }>;
  blockingReason: string;
}

const VALID_PORTRAIT_SOURCES = new Set<EvidenceSourceType>([
  '经历',
  '价值观',
  '测评',
  '他人反馈',
  '能量',
  '实验',
]);

export function checkPortraitEligibility(
  input: PortraitEligibilityInput,
): PortraitEligibilityResult {
  const activeClues = input.clues.filter(
    (c) => c.confidence.level !== '已归档' && c.type !== '不一致',
  );

  const highClues = activeClues.filter(
    (c) => c.confidence.level === '高' || c.confidence.level === '已验证',
  );

  // 统计有效独立证据来源种类（优先统计所有活跃线索的有效来源，且确保高置信线索本身满足 S>=2）
  const allValidSources = new Set<EvidenceSourceType>();
  for (const clue of activeClues) {
    for (const src of clue.confidence.supportingSources) {
      if (VALID_PORTRAIT_SOURCES.has(src)) {
        allValidSources.add(src);
      }
    }
  }

  const highClueCount = highClues.length;
  const distinctSourceCount = allValidSources.size;

  const highMet = highClueCount >= 3;
  const valuesMet = input.valuesCompleted;
  const sourcesMet = distinctSourceCount >= 2;

  const eligible = highMet && valuesMet && sourcesMet;

  // 找出离「高」最近的线索（按等级 中 > 线索，W_plus 降序，N 降序）
  const closestClues = activeClues
    .filter((c) => c.confidence.level === '中' || c.confidence.level === '线索')
    .sort((a, b) => {
      const rankA = a.confidence.level === '中' ? 2 : 1;
      const rankB = b.confidence.level === '中' ? 2 : 1;
      if (rankB !== rankA) return rankB - rankA;
      if (b.confidence.W_plus !== a.confidence.W_plus) {
        return b.confidence.W_plus - a.confidence.W_plus;
      }
      return b.confidence.N - a.confidence.N;
    })
    .slice(0, 3);

  const missingReasons: string[] = [];
  if (!highMet) {
    missingReasons.push(`还差 ${3 - highClueCount} 条「高」置信线索`);
  }
  if (!valuesMet) {
    missingReasons.push('价值观澄清尚未完成');
  }
  if (!sourcesMet) {
    missingReasons.push(`还差 ${2 - distinctSourceCount} 种证据来源`);
  }

  return {
    eligible,
    highClueCount,
    highClueTarget: 3,
    valuesCompleted: input.valuesCompleted,
    distinctSourceCount,
    distinctSourceTarget: 2,
    gates: {
      high_clues: { value: highClueCount, target: 3, met: highMet },
      values_clarified: { value: input.valuesCompleted, met: valuesMet },
      source_kinds: { value: distinctSourceCount, target: 2, met: sourcesMet },
    },
    highClues,
    closestClues,
    blockingReason: eligible ? '第一版画像的条件都满足了' : missingReasons.join(' · '),
  };
}
