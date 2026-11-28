import { computeConfidence } from './confidence.ts';
import type {
  ArchiveReason,
  ClueType,
  ConfidenceLevel,
  ConfidenceResult,
  EvidenceInput,
  UserStance,
} from './types.ts';

export interface ClueForImpact {
  id: string;
  statement: string;
  userStatement?: string | null;
  type: ClueType;
  userStance: UserStance;
  denyCount: number;
  archiveReason?: ArchiveReason;
  createdByUser?: boolean;
  evidence: Array<EvidenceInput & { storyId?: string | null }>;
}

export interface AffectedClueImpact {
  clueId: string;
  statement: string;
  before: ConfidenceResult;
  after: ConfidenceResult;
  beforeLevel: ConfidenceLevel;
  afterLevel: ConfidenceLevel;
  deactivatedEvidenceCount: number;
  autoArchived: boolean;
  summaryText: string;
}

export interface StoryDeletionPreview {
  storyId: string;
  deactivatedEvidenceCount: number;
  affectedClues: AffectedClueImpact[];
  highCountBefore: number;
  highCountAfter: number;
}

export function previewStoryDeletion(
  storyId: string,
  allClues: ClueForImpact[],
): StoryDeletionPreview {
  let deactivatedEvidenceCount = 0;
  let highCountBefore = 0;
  let highCountAfter = 0;
  const affectedClues: AffectedClueImpact[] = [];

  for (const clue of allClues) {
    const before = computeConfidence({
      clueId: clue.id,
      type: clue.type,
      userStance: clue.userStance,
      denyCount: clue.denyCount,
      archiveReason: clue.archiveReason,
      createdByUser: clue.createdByUser,
      evidence: clue.evidence,
    });

    if (before.level === '高' || before.level === '已验证') {
      highCountBefore += 1;
    }

    const matchingEvidence = clue.evidence.filter(
      (e) =>
        e.isActive &&
        (e.storyId === storyId || e.independenceKey === `story:${storyId}`),
    );

    if (matchingEvidence.length === 0) {
      if (before.level === '高' || before.level === '已验证') {
        highCountAfter += 1;
      }
      continue;
    }

    const countedDeactivated = matchingEvidence.filter((e) => e.sourceType !== '用户自述').length;
    deactivatedEvidenceCount += countedDeactivated || matchingEvidence.length;

    const remainingEvidence = clue.evidence.map((e) =>
      e.storyId === storyId || e.independenceKey === `story:${storyId}`
        ? { ...e, isActive: false }
        : e,
    );

    const anyRemainingActive = remainingEvidence.some((e) => e.isActive);
    const nextArchiveReason: ArchiveReason =
      !anyRemainingActive && !clue.archiveReason ? 'source_deleted' : (clue.archiveReason ?? null);

    const after = computeConfidence({
      clueId: clue.id,
      type: clue.type,
      userStance: clue.userStance,
      denyCount: clue.denyCount,
      archiveReason: nextArchiveReason,
      createdByUser: clue.createdByUser,
      evidence: remainingEvidence,
    });

    if (after.level === '高' || after.level === '已验证') {
      highCountAfter += 1;
    }

    let detailNote = `证据 ${before.N} → ${after.N} · 加权分 ${before.W_plus.toFixed(1)} → ${after.W_plus.toFixed(1)}`;
    if (after.level === '已归档' && nextArchiveReason === 'source_deleted') {
      detailNote = '没有剩下的证据';
    } else if (before.level === after.level && clue.userStance === '认同' && after.N === 1) {
      detailNote = `证据 ${before.N} → ${after.N} · 你认同过`;
    }

    affectedClues.push({
      clueId: clue.id,
      statement: clue.userStatement || clue.statement,
      before,
      after,
      beforeLevel: before.level,
      afterLevel: after.level,
      deactivatedEvidenceCount: matchingEvidence.length,
      autoArchived: after.level === '已归档' && nextArchiveReason === 'source_deleted',
      summaryText: detailNote,
    });
  }

  return {
    storyId,
    deactivatedEvidenceCount,
    affectedClues,
    highCountBefore,
    highCountAfter,
  };
}
