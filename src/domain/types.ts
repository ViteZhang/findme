export type ClueType =
  | '优势候选'
  | '习得技能'
  | '短板候选'
  | '价值观'
  | '能量来源'
  | '能量消耗'
  | '行为模式'
  | '盲点'
  | '不一致';

export type DimensionType = '性格' | '能力' | '价值观' | '能量' | '关系' | '盲点';

export type ConfidenceLevel = '线索' | '中' | '高' | '已验证' | '已归档';

export type ClueStatus = '待观察' | '成立中' | '已成立' | '已验证' | '已归档';

export type UserStance = '未回应' | '认同' | '部分认同' | '否认';

export type EvidenceDirection = '支持' | '反对';

export type EvidenceSourceType =
  | '经历'
  | '价值观'
  | '能量'
  | '他人反馈'
  | '测评'
  | '实验'
  | '用户自述';

export type EvidenceStrength = '弱' | '中' | '强';

export type ArchiveReason = 'denied' | 'source_deleted' | 'merged' | 'manual' | null;

export type StoryMode = '高光' | '低谷' | '日常';

export type StoryDomain = '学业' | '工作' | '家庭' | '社交' | '兴趣' | '其他';

export interface StoryStar {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface EvidenceInput {
  id: string;
  direction: EvidenceDirection;
  sourceType: EvidenceSourceType;
  independenceKey: string;
  strength: EvidenceStrength;
  isActive: boolean;
  verdict?: '支持' | '部分支持' | '推翻' | '无法判断';
  excerpt?: string | null;
  sourceTitle?: string;
  occurredAt?: string;
}

export interface GateProgress<T = number> {
  value: T;
  target?: number;
  met: boolean;
  applies?: boolean;
}

export interface ConfidenceResult {
  clueId: string;
  level: ConfidenceLevel;
  status: ClueStatus;
  N: number;
  S: number;
  W_plus: number;
  W_minus: number;
  gates: {
    evidence_count: GateProgress<number>;
    source_kinds: GateProgress<number>;
    weighted_score: GateProgress<number>;
    own_experience: GateProgress<boolean>;
  };
  caps: string[];
  hasOwnExperience: boolean;
  needsExample: boolean;
  hasMixedOpposition: boolean;
  supportingSources: EvidenceSourceType[];
  tallyStrokes: Array<{
    evidenceId?: string;
    kind: 'strong' | 'medium' | 'weak' | 'self' | 'slot';
    weight?: number;
    sourceType?: EvidenceSourceType;
  }>;
  next_needed: string;
}
