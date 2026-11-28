import React, { useEffect, useState } from 'react';
import {
  Archive,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react';
import { GateBars, Tally } from '../components/Primitives.tsx';

const CLUE_TYPES = [
  '全部',
  '优势候选',
  '习得技能',
  '短板候选',
  '盲点',
  '能量来源',
  '能量消耗',
  '价值观',
] as const;

const LEVEL_RANK: Record<string, number> = {
  已验证: 4,
  高: 3,
  中: 2,
  线索: 1,
  已归档: 0,
};

const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// ==================== P4.1 线索库列表视图 ====================
export function ClueLibraryView({
  state,
  onOpenClue,
  onClueAction,
  onStartStory,
  onOpenFeedback,
}: {
  state: any;
  onOpenClue: (clueId: string) => void;
  onClueAction: (payload: Record<string, any>, toastText?: string) => Promise<void>;
  onStartStory: (opts?: { focusClueId?: string; mode?: '高光' | '低谷' | '日常' }) => void;
  onOpenFeedback: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string>('全部');
  const [levelFilter, setLevelFilter] = useState<string>('全部');
  const [onlyMissingExample, setOnlyMissingExample] = useState(false);
  const [sortBy, setSortBy] = useState<'level' | 'recent'>('level');
  const [showMerges, setShowMerges] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const allClues: any[] = state.clues || [];
  const activeClues = allClues.filter(
    (c) => c.confidence?.level !== '已归档' && c.type !== '不一致',
  );
  const archivedClues = allClues.filter((c) => c.confidence?.level === '已归档');
  const highCount = activeClues.filter(
    (c) => c.confidence?.level === '高' || c.confidence?.level === '已验证',
  ).length;
  const pendingMerges = (state.merges || []).filter((m: any) => m.review_status === '待过目');

  const filtered = activeClues
    .filter((c) => (typeFilter === '全部' ? true : c.type === typeFilter))
    .filter((c) => {
      if (levelFilter === '全部') return true;
      if (levelFilter === '高') {
        return c.confidence?.level === '高' || c.confidence?.level === '已验证';
      }
      return c.confidence?.level === levelFilter;
    })
    .filter((c) => (onlyMissingExample ? Boolean(c.needs_example) : true))
    .sort((a, b) => {
      if (sortBy === 'recent') {
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      }
      const diff =
        (LEVEL_RANK[b.confidence?.level] || 0) - (LEVEL_RANK[a.confidence?.level] || 0);
      if (diff !== 0) return diff;
      return (b.confidence?.W_plus || 0) - (a.confidence?.W_plus || 0);
    });

  return (
    <>
      <header className="hdr">
        <h2>线索</h2>
        <div className="l">
          <button type="button" className="btn btn-s btn-sm" onClick={onOpenFeedback}>
            <Users size={14} /> 收集他人反馈
          </button>
          <button type="button" className="btn btn-p btn-sm" onClick={() => onStartStory()}>
            <Plus size={14} /> 讲一个新故事
          </button>
        </div>
      </header>

      <div className="home-wrap" style={{ gap: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: '36px', fontWeight: 500 }}>
            {activeClues.length > 0
              ? `${activeClues.length} 条线索，${highCount} 条已经可以写进画像`
              : '还没有整理出线索'}
          </h1>
          <p className="c2" style={{ margin: '8px 0 0', fontSize: 14 }}>
            每条线索都由真实经历、价值观取舍或测评证据累积。你可以随时改写说法，也可以推翻不准的判断
          </p>
        </div>

        {/* 自动合并待过目提示条 */}
        {pendingMerges.length > 0 && (
          <div
            style={{
              border: '1px solid var(--page-line-2)',
              borderRadius: 12,
              background: 'var(--page-surface)',
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 14 }}>
                有 <b style={{ fontWeight: 500 }}>{pendingMerges.length}</b> 处相近说法已自动并入已有线索，生成画像前可随时拆开
              </div>
              <button
                type="button"
                className="btn btn-t btn-sm"
                onClick={() => setShowMerges((v) => !v)}
              >
                {showMerges ? '收起' : '展开过目'}
              </button>
            </div>

            {showMerges && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--page-line)' }}>
                {pendingMerges.map((mg: any) => {
                  const target = allClues.find((c) => c.id === mg.target_clue_id);
                  return (
                    <div
                      key={mg.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                        padding: '10px 0',
                        borderBottom: '1px solid var(--page-line)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontSize: 13 }}>
                        <span className="c2">「{mg.merged_statement}」</span>
                        <span className="mono"> → 并入 </span>
                        <b style={{ fontWeight: 500 }}>
                          「{target?.user_statement || target?.statement || '原线索'}」
                        </b>
                        {mg.source_story_title && (
                          <span className="mono"> · 来自《{mg.source_story_title}》</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-s btn-sm"
                          onClick={() =>
                            onClueAction(
                              { subAction: 'review_merge', mergeId: mg.id, decision: 'confirm' },
                              '已确认合并',
                            )
                          }
                        >
                          对，是一回事
                        </button>
                        <button
                          type="button"
                          className="btn btn-t btn-sm"
                          onClick={() =>
                            onClueAction(
                              { subAction: 'review_merge', mergeId: mg.id, decision: 'split' },
                              '已拆分为独立线索',
                            )
                          }
                        >
                          拆开单独记
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeClues.length === 0 ? (
          <div className="card" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <Tally strokes={[{ kind: 'slot' }, { kind: 'slot' }, { kind: 'slot' }]} large />
              <div>
                <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 500 }}>
                  先讲一个具体的故事，记下第一道刻痕
                </h3>
                <p className="c2" style={{ margin: 0, fontSize: 14 }}>
                  高光经历容易看见优势和充电时刻，低谷经历容易看见消耗边界
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-p btn-sm"
                onClick={() => onStartStory({ mode: '高光' })}
              >
                讲一个高光故事
              </button>
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={() => onStartStory({ mode: '低谷' })}
              >
                讲一个低谷故事
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 筛选与排序栏 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CLUE_TYPES.map((t) => {
                  const isOn = typeFilter === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      style={{
                        height: 30,
                        padding: '0 10px',
                        borderRadius: 6,
                        border: `1px solid ${isOn ? 'var(--page-ink)' : 'var(--page-line-2)'}`,
                        background: isOn ? 'var(--page-ink)' : 'var(--page-surface)',
                        color: isOn ? '#fff' : 'var(--page-ink-2)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {(['全部', '高', '中', '线索'] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    className="btn-t"
                    style={{
                      height: 28,
                      fontSize: 12,
                      color: levelFilter === lv ? 'var(--page-accent)' : 'var(--page-ink-3)',
                      fontWeight: levelFilter === lv ? 500 : 400,
                    }}
                    onClick={() => setLevelFilter(lv)}
                  >
                    {lv === '全部' ? '全部等级' : lv}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setOnlyMissingExample((v) => !v)}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: `1px dashed ${onlyMissingExample ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                    background: onlyMissingExample ? 'var(--page-accent-50)' : 'transparent',
                    color: onlyMissingExample ? 'var(--page-accent)' : 'var(--page-ink-2)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  只看缺例子的
                </button>

                <button
                  type="button"
                  className="btn btn-t btn-sm"
                  onClick={() => setSortBy((s) => (s === 'level' ? 'recent' : 'level'))}
                >
                  <ArrowUpDown size={13} />
                  {sortBy === 'level' ? '等级 ↓' : '最近更新 ↓'}
                </button>
              </div>
            </div>

            {/* 线索表格 */}
            <div style={{ overflowX: 'auto' }}>
              <table className="cl">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>刻痕</th>
                    <th>线索</th>
                    <th style={{ width: 180 }}>来源</th>
                    <th className="r" style={{ width: 88 }}>等级</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--page-ink-3)', height: 96 }}>
                        当前筛选条件下没有线索
                      </td>
                    </tr>
                  ) : (
                    filtered.map((clue) => {
                      const lv = clue.confidence?.level || '线索';
                      const isHigh = lv === '高' || lv === '已验证';
                      const sources = clue.confidence?.supportingSources || [];
                      return (
                        <tr key={clue.id} onClick={() => onOpenClue(clue.id)}>
                          <td>
                            <Tally strokes={clue.confidence?.tallyStrokes || []} />
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, fontSize: 15 }}>
                              {clue.user_statement || clue.statement}
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                alignItems: 'center',
                                marginTop: 4,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span className="tag">{clue.type}</span>
                              <span className="mono">{clue.dimension}</span>
                              {clue.user_statement && <span className="tag">你修改过</span>}
                              {clue.needs_example && (
                                <span className="tag dash">还缺具体例子</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="mono">
                              {sources.length > 0 ? sources.join(' · ') : '自述 · 待补例子'}
                            </span>
                            <span className="sub">
                              {clue.confidence?.N || 0} 条有效 · {Number(clue.confidence?.W_plus || 0).toFixed(1)} 分
                            </span>
                          </td>
                          <td className="r">
                            <span className={`tag${isHigh ? ' ok' : ''}`}>{lv}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 底部可展开已归档区域 */}
        {archivedClues.length > 0 && (
          <div style={{ borderTop: '1px solid var(--page-line)', paddingTop: 16 }}>
            <button
              type="button"
              className="btn btn-t btn-sm"
              style={{ padding: 0 }}
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive size={14} />
              <span>已归档（{archivedClues.length}）</span>
              {showArchived ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showArchived && (
              <div style={{ marginTop: 12 }}>
                {archivedClues.map((ac) => (
                  <div
                    key={ac.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '10px 0',
                      borderBottom: '1px solid var(--page-line)',
                    }}
                  >
                    <div>
                      <span className="c3" style={{ fontSize: 14 }}>
                        {ac.user_statement || ac.statement}
                      </span>
                      <span className="mono" style={{ marginLeft: 10 }}>
                        {ac.archive_reason === 'source_deleted'
                          ? '因关联故事删除而归档'
                          : '你推翻过两次'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={() =>
                        onClueAction(
                          { subAction: 'restore', clueId: ac.id },
                          '已恢复到线索库',
                        )
                      }
                    >
                      <RotateCcw size={13} /> 恢复
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ==================== P4.2 线索详情视图 ====================
export function ClueDetailView({
  clueId,
  state,
  onBack,
  onClueAction,
  onOpenStory,
  onOpenClue,
  onStartExampleForClue,
}: {
  clueId: string;
  state: any;
  onBack: () => void;
  onClueAction: (payload: Record<string, any>, toastText?: string) => Promise<void>;
  onOpenStory: (storyId: string) => void;
  onOpenClue: (otherClueId: string) => void;
  onStartExampleForClue: (clueId: string) => void;
}) {
  const clue = (state.clues || []).find((c: any) => c.id === clueId);
  const [editingStmt, setEditingStmt] = useState(false);
  const [stmtDraft, setStmtDraft] = useState('');
  const [openMenuEvId, setOpenMenuEvId] = useState<string | null>(null);
  const [denyModalOpen, setDenyModalOpen] = useState(false);
  const [denyNote, setDenyNote] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  if (!clue) {
    return (
      <div className="home-wrap">
        <button type="button" className="btn btn-s btn-sm" onClick={onBack} style={{ width: 'fit-content' }}>
          <ChevronLeft size={14} /> 返回线索列表
        </button>
        <p className="c2">未找到这条线索，可能已被清理</p>
      </div>
    );
  }

  const conf = clue.confidence || {};
  const level = conf.level || '线索';
  const isArchived = level === '已归档';
  const isHigh = level === '高' || level === '已验证';
  const displayText = clue.user_statement || clue.statement;

  const allClueEvs = (state.evidence || []).filter((e: any) => e.clue_id === clue.id);
  const supportingEvs = allClueEvs.filter(
    (e: any) => e.is_active && e.direction === '支持' && e.source_type !== '用户自述',
  );
  const opposingEvs = allClueEvs.filter((e: any) => e.is_active && e.direction === '反向');
  const uncountedEvs = allClueEvs.filter(
    (e: any) => !e.is_active || e.source_type === '用户自述',
  );

  const portraitPreviewText = (() => {
    if (isArchived) return '已归档，不会进入画像';
    if (level === '线索') {
      return `暂不写进正文，放在第 7 节「待观察」—— ${conf.next_needed || '继续积累独立证据后升级'}`;
    }
    if (clue.type === '习得技能') {
      return `归在第 1 节「核心优势 · 习得技能」子项：${displayText}`;
    }
    if (clue.type === '优势候选' && !conf.hasOwnExperience) {
      return `归在第 2 节「别人眼中的你」：【可能】${displayText}（补充本人经历后移入核心优势）`;
    }
    const prefix = isHigh ? '【明显】' : '【可能】';
    const suffix = conf.hasMixedOpposition ? '，但也有相反的情况' : '';
    return `${prefix}${displayText}${suffix}`;
  })();

  const relatedList: any[] = [];
  for (const rel of clue.related_clues || []) {
    const found = (state.clues || []).find((c: any) => c.id === rel.clue_id);
    if (found) relatedList.push({ clue: found, relation: rel.relation });
  }
  if (relatedList.length === 0) {
    const sameDim = (state.clues || [])
      .filter(
        (c: any) =>
          c.id !== clue.id &&
          c.dimension === clue.dimension &&
          c.confidence?.level !== '已归档',
      )
      .slice(0, 3);
    for (const s of sameDim) {
      relatedList.push({ clue: s, relation: '同维度' });
    }
  }

  const clueLogs = (state.changeLogs || []).filter((l: any) => l.target_id === clue.id);

  const saveStatement = async () => {
    const trimmed = stmtDraft.trim();
    if (!trimmed) return;
    await onClueAction(
      {
        subAction: 'respond',
        clueId: clue.id,
        stance: '部分认同',
        userStatement: trimmed,
      },
      '已保存你修改的说法',
    );
    setEditingStmt(false);
  };

  const confirmDeny = async () => {
    const willArchive = (clue.deny_count || 0) >= 1;
    await onClueAction(
      {
        subAction: 'respond',
        clueId: clue.id,
        stance: '否认',
        denyNote: denyNote.trim() || undefined,
      },
      willArchive ? '已归档这条线索' : '已将这条线索往后放',
    );
    setDenyModalOpen(false);
    setDenyNote('');
  };

  const strengthWeightLabel = (st: string) =>
    st === '强' ? '强 · +1.5' : st === '中' ? '中 · +1.0' : '弱 · +0.5';

  return (
    <>
      <header className="hdr">
        <div className="l">
          <button type="button" className="btn btn-t btn-sm" onClick={onBack} style={{ paddingLeft: 0 }}>
            <ChevronLeft size={16} /> 返回
          </button>
          <span className="mono">clue_{String(clue.seq || 1).padStart(4, '0')}</span>
        </div>
        <span className={`tag${isHigh ? ' ok' : ''}`}>{level}</span>
      </header>

      <div className="home-wrap" style={{ paddingBottom: 96 }}>
        <div className="detail-grid">
          {/* 左侧主内容区 */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="tag">{clue.type}</span>
              <span className="tag">{clue.dimension}</span>
              {clue.user_statement && <span className="tag ok">你修改过</span>}
              {clue.needs_example && <span className="tag dash">还缺具体例子</span>}
            </div>

            {editingStmt ? (
              <div style={{ marginTop: 14 }}>
                <input
                  type="text"
                  value={stmtDraft}
                  onChange={(e) => setStmtDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveStatement();
                  }}
                  style={{
                    width: '100%',
                    height: 44,
                    border: '1px solid var(--page-accent)',
                    borderRadius: 8,
                    padding: '0 14px',
                    fontSize: 18,
                    background: 'var(--page-surface)',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-p btn-sm" onClick={saveStatement}>
                    保存说法
                  </button>
                  <button
                    type="button"
                    className="btn btn-t btn-sm"
                    onClick={() => setEditingStmt(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 style={{ margin: '14px 0 6px', fontSize: 28, lineHeight: '36px', fontWeight: 500 }}>
                  {displayText}
                </h1>
                {clue.user_statement && (
                  <div className="mono">原提炼：{clue.statement}</div>
                )}
              </>
            )}
          </div>

          {/* 证据刻痕与门槛条卡片 */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 16,
                paddingBottom: 20,
                borderBottom: '1px solid var(--page-line)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                <Tally strokes={conf.tallyStrokes || []} large />
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {conf.N || 0} 条有效证据 · {conf.S || 0} 种独立来源
                  </div>
                  <div className="mono" style={{ marginTop: 2 }}>
                    正向加权 {Number(conf.W_plus || 0).toFixed(1)} 分
                    {conf.W_minus > 0 ? ` · 反向 ${Number(conf.W_minus).toFixed(1)} 分` : ''}
                  </div>
                </div>
              </div>
              <span className="mono">{conf.next_needed}</span>
            </div>

            <div style={{ paddingTop: 16 }}>
              <GateBars confidence={conf} />
            </div>

            {conf.caps_applied && conf.caps_applied.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--page-raised)',
                  fontSize: 12,
                  color: 'var(--page-ink-2)',
                }}
              >
                当前封顶说明：{conf.caps_applied.join('；')}
              </div>
            )}
          </div>

          {/* 画像里会这样写 */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 12,
              border: '1px solid var(--page-line-2)',
              background: 'var(--page-surface)',
            }}
          >
            <span className="mono" style={{ display: 'block', marginBottom: 6 }}>
              画像里会这样写
            </span>
            <div style={{ fontSize: 15, lineHeight: '24px' }}>{portraitPreviewText}</div>
          </div>

          {/* 三组证据列表：支持 / 相反的情况 / 不计数 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--page-line-2)',
                }}
              >
                <b style={{ fontWeight: 500 }}>支持（{supportingEvs.length}）</b>
                <span className="mono">计入置信度</span>
              </div>

              {supportingEvs.length === 0 ? (
                <div className="c3" style={{ padding: '14px 0', fontSize: 13 }}>
                  还没有计入分数的独立证据，讲一个具体故事即可补上第一条
                </div>
              ) : (
                supportingEvs.map((ev: any) => (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px minmax(0,1fr) auto 32px',
                      gap: 12,
                      alignItems: 'start',
                      padding: '14px 0',
                      borderBottom: '1px solid var(--page-line)',
                      position: 'relative',
                    }}
                  >
                    <span className="tag" style={{ justifyContent: 'center' }}>
                      {ev.source_type}
                    </span>
                    <div>
                      <div style={{ fontSize: 14, lineHeight: '22px' }}>
                        {ev.excerpt || ev.interpretation}
                      </div>
                      {ev.source_title && (
                        <div className="mono" style={{ marginTop: 4 }}>
                          来自：{ev.source_title}
                        </div>
                      )}
                    </div>
                    <span className="mono" style={{ marginTop: 3 }}>
                      {strengthWeightLabel(ev.strength)}
                    </span>
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="tb"
                        onClick={() =>
                          setOpenMenuEvId((prev) => (prev === ev.id ? null : ev.id))
                        }
                        aria-label="证据操作"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenuEvId === ev.id && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 34,
                            width: 148,
                            background: 'var(--page-surface)',
                            border: '1px solid var(--page-line-2)',
                            borderRadius: 10,
                            boxShadow: '0 8px 24px rgba(0,0,0,.08)',
                            padding: 4,
                            zIndex: 25,
                          }}
                        >
                          {ev.story_id && (
                            <button
                              type="button"
                              className="btn-t"
                              style={{ width: '100%', justifyContent: 'flex-start', padding: '0 10px' }}
                              onClick={() => {
                                setOpenMenuEvId(null);
                                onOpenStory(ev.story_id);
                              }}
                            >
                              打开原故事
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-t"
                            style={{ width: '100%', justifyContent: 'flex-start', padding: '0 10px' }}
                            onClick={() => {
                              setOpenMenuEvId(null);
                              onClueAction(
                                {
                                  subAction: 'evidence_active',
                                  evidenceId: ev.id,
                                  isActive: false,
                                },
                                '已排除这条证据',
                              );
                            }}
                          >
                            这条不算
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {opposingEvs.length > 0 && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--page-line-2)',
                  }}
                >
                  <b style={{ fontWeight: 500 }}>相反的情况（{opposingEvs.length}）</b>
                  <span className="mono">帮助你看见情境边界</span>
                </div>
                {opposingEvs.map((ev: any) => (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px minmax(0,1fr) auto',
                      gap: 12,
                      padding: '12px 0',
                      borderBottom: '1px solid var(--page-line)',
                    }}
                  >
                    <span className="tag">{ev.source_type}</span>
                    <div>
                      <div style={{ fontSize: 14 }}>{ev.excerpt || ev.interpretation}</div>
                      {ev.source_title && <div className="mono">{ev.source_title}</div>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-t btn-sm"
                      onClick={() =>
                        onClueAction(
                          { subAction: 'evidence_active', evidenceId: ev.id, isActive: false },
                          '已排除这条反向记录',
                        )
                      }
                    >
                      这条不算
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uncountedEvs.length > 0 && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--page-line)',
                  }}
                >
                  <span className="c2" style={{ fontWeight: 500 }}>
                    不计数（{uncountedEvs.length}）
                  </span>
                  <span className="mono">用户自述或你手动排除的记录</span>
                </div>
                {uncountedEvs.map((ev: any) => (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '64px minmax(0,1fr) auto',
                      gap: 12,
                      padding: '12px 0',
                      borderBottom: '1px solid var(--page-line)',
                      color: 'var(--page-ink-3)',
                    }}
                  >
                    <span className="mono">
                      {ev.source_type === '用户自述' ? '自述' : '已排除'}
                    </span>
                    <div style={{ fontSize: 13 }}>{ev.excerpt || ev.interpretation}</div>
                    {!ev.is_active ? (
                      <button
                        type="button"
                        className="btn btn-t btn-sm"
                        onClick={() =>
                          onClueAction(
                            { subAction: 'evidence_active', evidenceId: ev.id, isActive: true },
                            '已恢复计入这条证据',
                          )
                        }
                      >
                        恢复计入
                      </button>
                    ) : (
                      <span className="mono">虚线刻痕 · 0 分</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 变更记录 */}
          {clueLogs.length > 0 && (
            <div style={{ borderTop: '1px solid var(--page-line)', paddingTop: 12 }}>
              <button
                type="button"
                className="btn btn-t btn-sm"
                style={{ padding: 0 }}
                onClick={() => setShowLogs((v) => !v)}
              >
                <span>变更记录（{clueLogs.length}）</span>
                {showLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {showLogs && (
                <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
                  {clueLogs.map((log: any) => (
                    <li
                      key={log.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 0',
                        borderBottom: '1px solid var(--page-line)',
                        fontSize: 12,
                        color: 'var(--page-ink-3)',
                      }}
                    >
                      <span>{log.action}</span>
                      <span className="mono">{String(log.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 右侧操作与元数据栏 */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            background: 'var(--page-surface)',
            border: '1px solid var(--page-line)',
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 10 }}>
              你可以对这条线索做的事
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isArchived ? (
                <button
                  type="button"
                  className="btn btn-p"
                  onClick={() =>
                    onClueAction({ subAction: 'restore', clueId: clue.id }, '已恢复这条线索')
                  }
                >
                  <RotateCcw size={15} /> 恢复这条线索
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-p"
                    onClick={() => onStartExampleForClue(clue.id)}
                  >
                    <Plus size={15} /> 补一个例子
                  </button>
                  <button
                    type="button"
                    className="btn btn-s"
                    onClick={() => {
                      setStmtDraft(displayText);
                      setEditingStmt(true);
                    }}
                  >
                    <Pencil size={15} /> 改说法
                  </button>
                  <button
                    type="button"
                    className="btn btn-s"
                    onClick={() => setDenyModalOpen(true)}
                  >
                    这不像我
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--page-line)', paddingTop: 16 }}>
            <span className="mono" style={{ display: 'block', marginBottom: 8 }}>信息</span>
            <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr', rowGap: 6, fontSize: 13 }}>
              <span className="c3">首次出现</span>
              <span>{clue.created_by}</span>
              <span className="c3">你的态度</span>
              <span>{clue.user_stance}</span>
              <span className="c3">推翻次数</span>
              <span className="mono">{clue.deny_count || 0} 次</span>
            </div>
          </div>

          {relatedList.length > 0 && (
            <div style={{ borderTop: '1px solid var(--page-line)', paddingTop: 16 }}>
              <span className="mono" style={{ display: 'block', marginBottom: 8 }}>相关线索</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {relatedList.map(({ clue: rc, relation }) => (
                  <button
                    key={rc.id}
                    type="button"
                    onClick={() => onOpenClue(rc.id)}
                    style={{
                      textAlign: 'left',
                      border: '1px solid var(--page-line)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: 'var(--page-bg)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {rc.user_statement || rc.statement}
                    </div>
                    <div className="mono" style={{ marginTop: 2 }}>
                      {relation} · {rc.confidence?.level}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
        </div>
      </div>

      {/* 移动端底部三按钮快捷栏 */}
      {!isArchived && (
        <div
          className="mid-only"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 68,
            padding: '8px 16px',
            background: 'var(--page-surface)',
            borderTop: '1px solid var(--page-line)',
            gap: 8,
            justifyContent: 'space-between',
            zIndex: 35,
          }}
        >
          <button
            type="button"
            className="btn btn-s btn-sm"
            style={{ flex: 1 }}
            onClick={() => {
              setStmtDraft(displayText);
              setEditingStmt(true);
            }}
          >
            改说法
          </button>
          <button
            type="button"
            className="btn btn-p btn-sm"
            style={{ flex: 1 }}
            onClick={() => onStartExampleForClue(clue.id)}
          >
            补一个例子
          </button>
          <button
            type="button"
            className="btn btn-s btn-sm"
            style={{ flex: 1 }}
            onClick={() => setDenyModalOpen(true)}
          >
            这不像我
          </button>
        </div>
      )}

      {/* 「这不像我」第 1 次降级 / 第 2 次归档弹层（严格使用 .btn-k 主文字色实底按钮） */}
      {denyModalOpen && (
        <div className="overlay" onClick={() => setDenyModalOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>{(clue.deny_count || 0) === 0 ? '先把这条往后放？' : '把这条归档？'}</h3>
            <p>
              {(clue.deny_count || 0) === 0
                ? '这是你第一次觉得它不准。我会把它的置信等级下调一级，先不急着写进核心结论；如果下次还是觉得不像你，就会彻底归档'
                : '这是你第二次觉得它不像你。归档后它不会再出现在对话和画像里，以后想看随时可以在线索库底部恢复'}
            </p>
            <div style={{ marginTop: 16 }}>
              <label className="mono" style={{ display: 'block', marginBottom: 6 }}>
                可以顺便记一句原因（选填）
              </label>
              <input
                type="text"
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
                placeholder="比如：那次只是迫不得已，平时我不这样"
                style={{
                  width: '100%',
                  height: 38,
                  border: '1px solid var(--page-line-2)',
                  borderRadius: 8,
                  padding: '0 12px',
                  fontSize: 14,
                }}
              />
            </div>
            <div className="ft">
              <button
                type="button"
                className="btn btn-s"
                onClick={() => setDenyModalOpen(false)}
              >
                取消
              </button>
              <button type="button" className="btn btn-k" onClick={confirmDeny}>
                {(clue.deny_count || 0) === 0 ? '往后放' : '归档'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ==================== P3.1 全部故事列表视图 ====================
export function StoryListView({
  state,
  onOpenStory,
  onStartStory,
}: {
  state: any;
  onOpenStory: (storyId: string) => void;
  onStartStory: (opts?: { mode?: '高光' | '低谷' | '日常'; conversationId?: string }) => void;
}) {
  const [modeFilter, setModeFilter] = useState<'全部' | '高光' | '低谷' | '日常'>('全部');
  const stories: any[] = state.stories || [];
  const filtered = stories.filter((s) =>
    modeFilter === '全部' ? true : s.mode === modeFilter,
  );

  return (
    <>
      <header className="hdr">
        <h2>全部故事</h2>
        <button type="button" className="btn btn-p btn-sm" onClick={() => onStartStory()}>
          <Plus size={14} /> 讲一个新故事
        </button>
      </header>

      <div className="home-wrap" style={{ gap: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: '36px', fontWeight: 500 }}>
            {stories.length} 个真实经历故事
          </h1>
          <p className="c2" style={{ margin: '8px 0 0', fontSize: 14 }}>
            你讲过的每个具体情境、行动和感受都在这里。删掉任何一个故事，从它提炼的证据也会实时重算
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['全部', '高光', '低谷', '日常'] as const).map((m) => {
            const on = modeFilter === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setModeFilter(m)}
                style={{
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: `1px solid ${on ? 'var(--page-ink)' : 'var(--page-line-2)'}`,
                  background: on ? 'var(--page-ink)' : 'var(--page-surface)',
                  color: on ? '#fff' : 'var(--page-ink-2)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        {stories.length === 0 ? (
          <div className="card" style={{ maxWidth: 520 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 500 }}>还没有记录故事</h3>
            <p className="c2" style={{ margin: '0 0 16px', fontSize: 14 }}>
              不用提前打草稿，想到哪件印象深的事都可以开始
            </p>
            <button
              type="button"
              className="btn btn-p btn-sm"
              onClick={() => onStartStory({ mode: '高光' })}
            >
              开始讲第一个故事
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cl">
              <thead>
                <tr>
                  <th>故事标题</th>
                  <th style={{ width: 88 }}>模式</th>
                  <th style={{ width: 120 }}>STAR 完整度</th>
                  <th style={{ width: 96 }}>衍生证据</th>
                  <th className="r" style={{ width: 112 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((st) => {
                  const star = st.star || {};
                  const starFlags = [
                    Boolean(star.situation),
                    Boolean(star.task),
                    Boolean(star.action),
                    Boolean(star.result),
                  ];
                  const evCount = (state.evidence || []).filter(
                    (e: any) => e.story_id === st.id && e.is_active,
                  ).length;
                  const linkedConv = (state.conversations || []).find((c: any) =>
                    (c.story_ids || []).includes(st.id),
                  );

                  return (
                    <tr key={st.id} onClick={() => onOpenStory(st.id)}>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 15 }}>{st.title}</div>
                        <span className="sub">
                          {[st.period, st.domain].filter(Boolean).join(' · ') || '个人经历'}
                        </span>
                      </td>
                      <td>
                        <span className="tag">{st.mode}</span>
                      </td>
                      <td>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {(['S', 'T', 'A', 'R'] as const).map((k, idx) => (
                            <span
                              key={k}
                              title={k}
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 3,
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: 10,
                                fontFamily: 'var(--page-mono)',
                                background: starFlags[idx]
                                  ? 'var(--page-accent-50)'
                                  : 'var(--page-raised)',
                                color: starFlags[idx]
                                  ? 'var(--page-accent)'
                                  : 'var(--page-ink-3)',
                              }}
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="mono">{evCount} 条</span>
                      </td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        {st.completeness !== '完整' ? (
                          <button
                            type="button"
                            className="btn btn-s btn-sm"
                            onClick={() =>
                              onStartStory({
                                mode: st.mode,
                                conversationId: linkedConv?.id,
                              })
                            }
                          >
                            继续讲完
                          </button>
                        ) : (
                          <span className="mono">{String(st.created_at || '').slice(5, 10)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// 将故事段落中的证据原话渲染为带墨水蓝下划线与编号角标的 <mark className="e">
function highlightStoryParagraph(
  text: string,
  anchors: Array<{ num: string; excerpt: string }>,
): { nodes: React.ReactNode; matchedIndices: Set<number> } {
  const matched = new Set<number>();
  if (!text) return { nodes: '（暂未补充）', matchedIndices: matched };

  let segments: Array<{ str: string; anchorIdx?: number }> = [{ str: text }];

  anchors.forEach((anc, aIdx) => {
    const needle = (anc.excerpt || '').trim();
    if (!needle || needle.length < 2) return;
    const nextSegments: Array<{ str: string; anchorIdx?: number }> = [];
    for (const seg of segments) {
      if (seg.anchorIdx !== undefined) {
        nextSegments.push(seg);
        continue;
      }
      const pos = seg.str.indexOf(needle);
      if (pos >= 0) {
        matched.add(aIdx);
        if (pos > 0) nextSegments.push({ str: seg.str.slice(0, pos) });
        nextSegments.push({ str: needle, anchorIdx: aIdx });
        if (pos + needle.length < seg.str.length) {
          nextSegments.push({ str: seg.str.slice(pos + needle.length) });
        }
      } else {
        nextSegments.push(seg);
      }
    }
    segments = nextSegments;
  });

  return {
    matchedIndices: matched,
    nodes: segments.map((seg, idx) =>
      seg.anchorIdx !== undefined ? (
        <mark key={idx} className="e">
          {seg.str}
          <sup className="n">{anchors[seg.anchorIdx].num}</sup>
        </mark>
      ) : (
        <React.Fragment key={idx}>{seg.str}</React.Fragment>
      ),
    ),
  };
}

// ==================== P3.2 故事详情与删除影响预览弹层 ====================
export function StoryDetailView({
  storyId,
  state,
  onBack,
  onOpenClue,
  onOpenConversation,
  onStoryUpdateTitle,
  onStoryPreviewDelete,
  onStoryConfirmDelete,
}: {
  storyId: string;
  state: any;
  onBack: () => void;
  onOpenClue: (clueId: string) => void;
  onOpenConversation: (opts: { conversationId?: string; starterPrompt?: string; mode?: '高光' | '低谷' | '日常' }) => void;
  onStoryUpdateTitle: (storyId: string, title: string) => Promise<void>;
  onStoryPreviewDelete: (storyId: string) => Promise<any>;
  onStoryConfirmDelete: (storyId: string) => Promise<void>;
}) {
  const story = (state.stories || []).find((s: any) => s.id === storyId);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePreview, setDeletePreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDeleteModalOpen(false);
    setDeletePreview(null);
  }, [storyId]);

  if (!story) {
    return (
      <div className="home-wrap">
        <button type="button" className="btn btn-s btn-sm" onClick={onBack} style={{ width: 'fit-content' }}>
          <ChevronLeft size={14} /> 返回全部故事
        </button>
        <p className="c2">这个故事已不存在</p>
      </div>
    );
  }

  const derivedEvs = (state.evidence || []).filter(
    (e: any) => e.story_id === story.id && e.is_active,
  );
  const anchors = derivedEvs.map((ev: any, idx: number) => ({
    num: CIRCLED_NUMS[idx] || `[${idx + 1}]`,
    excerpt: ev.excerpt || '',
    ev,
  }));

  const starRows: Array<[string, string, string]> = [
    ['S', '当时的背景', story.star?.situation || ''],
    ['T', '面对的任务', story.star?.task || ''],
    ['A', '你具体做了什么', story.star?.action || ''],
    ['R', '后来的结果与感受', story.star?.result || ''],
  ];

  const allMatched = new Set<number>();
  const renderedRows = starRows.map(([code, label, content]) => {
    const res = highlightStoryParagraph(content, anchors);
    res.matchedIndices.forEach((i) => allMatched.add(i));
    return { code, label, nodes: res.nodes };
  });

  const unmatchedAnchors = anchors.filter((_: any, idx: number) => !allMatched.has(idx));

  const linkedConv = (state.conversations || []).find((c: any) =>
    (c.story_ids || []).includes(story.id),
  );

  const openDeletePreview = async () => {
    setDeleteModalOpen(true);
    setLoadingPreview(true);
    try {
      const p = await onStoryPreviewDelete(story.id);
      setDeletePreview(p);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onStoryConfirmDelete(story.id);
      setDeleteModalOpen(false);
      onBack();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <header className="hdr">
        <div className="l">
          <button type="button" className="btn btn-t btn-sm" onClick={onBack} style={{ paddingLeft: 0 }}>
            <ChevronLeft size={16} /> 返回
          </button>
          <span className="mono">story_{String(story.seq || 1).padStart(4, '0')}</span>
        </div>
        <span className="tag">{story.mode}</span>
      </header>

      <div className="home-wrap">
        <div className="detail-grid">
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="tag">{story.mode}经历</span>
              {story.period && <span className="mono">{story.period}</span>}
              {story.domain && <span className="mono">· {story.domain}</span>}
              <span className="tag">{story.completeness}</span>
            </div>

            {editingTitle ? (
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  style={{
                    flex: 1,
                    height: 40,
                    border: '1px solid var(--page-accent)',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 18,
                  }}
                />
                <button
                  type="button"
                  className="btn btn-p btn-sm"
                  onClick={async () => {
                    if (titleDraft.trim()) {
                      await onStoryUpdateTitle(story.id, titleDraft.trim());
                    }
                    setEditingTitle(false);
                  }}
                >
                  保存
                </button>
                <button type="button" className="btn btn-t btn-sm" onClick={() => setEditingTitle(false)}>
                  取消
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <h1 style={{ margin: 0, fontSize: 28, lineHeight: '36px', fontWeight: 500 }}>
                  {story.title}
                </h1>
                <button
                  type="button"
                  className="tb"
                  onClick={() => {
                    setTitleDraft(story.title);
                    setEditingTitle(true);
                  }}
                  title="修改标题"
                >
                  <Pencil size={15} />
                </button>
              </div>
            )}
          </div>

          {story.key_moment && (
            <div
              style={{
                padding: '14px 18px',
                borderLeft: '2px solid var(--page-accent)',
                background: 'var(--page-accent-50)',
                borderRadius: '0 10px 10px 0',
              }}
            >
              <span className="mono" style={{ display: 'block', marginBottom: 4, color: 'var(--page-accent)' }}>
                {story.mode === '低谷' ? '最消耗的一刻' : '最投入的一刻'}
              </span>
              <div style={{ fontSize: 15, lineHeight: '24px' }}>{story.key_moment}</div>
            </div>
          )}

          {/* STAR 四段正文（含证据原话墨水蓝下划线锚点） */}
          <div className="card" style={{ padding: '12px 28px' }}>
            {renderedRows.map(({ code, label, nodes }, idx) => (
              <div
                key={code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px minmax(0, 1fr)',
                  gap: 16,
                  padding: '18px 0',
                  borderBottom: idx < 3 ? '1px solid var(--page-line)' : 'none',
                }}
              >
                <div>
                  <span className="mono" style={{ color: 'var(--page-accent)' }}>{code}</span>
                  <div className="c3" style={{ fontSize: 12, marginTop: 2 }}>{label}</div>
                </div>
                <div style={{ fontSize: 15, lineHeight: '26px', whiteSpace: 'pre-wrap' }}>
                  {nodes}
                </div>
              </div>
            ))}

            {unmatchedAnchors.length > 0 && (
              <div
                style={{
                  borderTop: '1px solid var(--page-line)',
                  padding: '16px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span className="mono">对话原话摘录锚点</span>
                {unmatchedAnchors.map((anc: any) => (
                  <div key={anc.ev.id} style={{ fontSize: 14, lineHeight: '24px' }}>
                    <mark className="e">
                      {anc.excerpt || anc.ev.interpretation}
                      <sup className="n">{anc.num}</sup>
                    </mark>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧衍生证据编号对照与操作栏 */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            background: 'var(--page-surface)',
            border: '1px solid var(--page-line)',
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 10 }}>
              从这个故事提炼的证据（{anchors.length}）
            </span>
            {anchors.length === 0 ? (
              <div className="c3" style={{ fontSize: 13 }}>暂时还没有关联的有效证据</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {anchors.map(({ num, ev }: any) => {
                  const targetClue = (state.clues || []).find((c: any) => c.id === ev.clue_id);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => targetClue && onOpenClue(targetClue.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--page-line)',
                        background: 'var(--page-bg)',
                        cursor: targetClue ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="mono" style={{ color: 'var(--page-accent)' }}>
                          {num} 支撑线索
                        </span>
                        <span className="mono">{targetClue?.confidence?.level || ''}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
                        {targetClue?.user_statement || targetClue?.statement || '已清理线索'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--page-line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {linkedConv && (
              <button
                type="button"
                className="btn btn-s"
                onClick={() => onOpenConversation({ conversationId: linkedConv.id })}
              >
                <MessageSquare size={15} /> 打开原对话
              </button>
            )}
            <button
              type="button"
              className="btn btn-s"
              onClick={() =>
                onOpenConversation({
                  mode: story.mode,
                  starterPrompt: `我想给《${story.title}》再补充一点细节：`,
                })
              }
            >
              <Plus size={15} /> 补充细节
            </button>
            <button
              type="button"
              className="btn btn-s"
              onClick={openDeletePreview}
            >
              <Trash2 size={15} /> 删除这个故事
            </button>
          </div>
        </aside>
        </div>
      </div>

      {/* 删除故事实时影响预览弹层（严格遵守 05 补充规则：确认删除按钮用 .btn-k 主文字色实底） */}
      {deleteModalOpen && (
        <div className="overlay" onClick={() => setDeleteModalOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>删除《{story.title}》？</h3>
            <p>
              删除后，从这个故事提炼的证据会立即移除，受影响的线索等级将实时重新计算；已定稿历史画像中的原话引用会标为「来源已删除」
            </p>

            {loadingPreview ? (
              <div className="mono" style={{ marginTop: 20 }}>正在计算受影响的线索与等级变化…</div>
            ) : deletePreview ? (
              <div style={{ marginTop: 18 }}>
                {deletePreview.affectedClues?.length > 0 ? (
                  <div
                    style={{
                      border: '1px solid var(--page-line-2)',
                      borderRadius: 10,
                      padding: '8px 14px',
                      background: 'var(--page-bg)',
                    }}
                  >
                    <span className="mono" style={{ display: 'block', padding: '4px 0 8px' }}>
                      受影响的 {deletePreview.affectedClues.length} 条线索
                    </span>
                    {deletePreview.affectedClues.map((ac: any) => (
                      <div
                        key={ac.clueId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 0',
                          borderTop: '1px solid var(--page-line)',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{ac.statement}</div>
                          <div className="mono">
                            {ac.summaryText ||
                              `证据 ${ac.before?.N ?? 0} → ${ac.after?.N ?? 0} · 加权分 ${Number(ac.before?.W_plus ?? 0).toFixed(1)} → ${Number(ac.after?.W_plus ?? 0).toFixed(1)}`}
                          </div>
                        </div>
                        <span className="tag">
                          {ac.beforeLevel} → {ac.afterLevel}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mono" style={{ padding: '10px 0' }}>
                    没有其他线索受这个故事删除影响
                  </div>
                )}

                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--page-ink-2)',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span>
                    「高」置信线索：{deletePreview.highCountBefore ?? 0} →{' '}
                    {deletePreview.highCountAfter ?? 0} 条
                  </span>
                  {(deletePreview.deactivatedEvidenceCount ?? 0) > 0 && (
                    <span>将移除衍生证据 {deletePreview.deactivatedEvidenceCount} 条</span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="ft">
              <button
                type="button"
                className="btn btn-s"
                disabled={deleting}
                onClick={() => setDeleteModalOpen(false)}
              >
                保留故事
              </button>
              <button
                type="button"
                className="btn btn-k"
                disabled={loadingPreview || deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? '正在删除…' : '删除故事'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
