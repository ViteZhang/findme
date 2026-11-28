import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Pencil,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { Tally } from '../components/Primitives.tsx';

function triggerDownloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PortraitView({
  state,
  autoStartGenerate = false,
  onClearAutoStart,
  onPortraitAction,
  onClueAction,
  onOpenClue,
  onOpenStory,
  onOpenValues,
  onOpenUploadModal,
  onOpenFeedback,
  onStartStoryForClue,
  onBackHome,
  onShowToast,
}: {
  state: any;
  autoStartGenerate?: boolean;
  onClearAutoStart?: () => void;
  onPortraitAction: (payload: Record<string, any>) => Promise<any>;
  onClueAction: (payload: Record<string, any>, toastText?: string) => Promise<void>;
  onOpenClue: (clueId: string) => void;
  onOpenStory: (storyId: string) => void;
  onOpenValues: () => void;
  onOpenUploadModal: () => void;
  onOpenFeedback: () => void;
  onStartStoryForClue: (clueId?: string) => void;
  onBackHome: () => void;
  onShowToast: (text: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'main' | 'flow' | 'history'>('main');
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState<number | null>(null);
  const [activeConfirmSection, setActiveConfirmSection] = useState<number>(1);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [editingClaimText, setEditingClaimText] = useState('');
  const [editingBestState, setEditingBestState] = useState<{
    when: string;
    how: string;
    with_whom: string;
    avoid: string;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [drawerClaim, setDrawerClaim] = useState<any | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [includeExcerpts, setIncludeExcerpts] = useState(false);
  const [activeTocSec, setActiveTocSec] = useState<number>(1);

  const portraits: any[] = state.portraits || [];
  const activeDraft = portraits.find(
    (p) => p.status === '草稿' || p.status === '审核中' || p.status === '待确认' || p.status === '生成失败',
  );
  const finalizedPortraits = portraits.filter((p) => p.status === '已定稿');
  const currentFinalized = finalizedPortraits[0] || null;

  useEffect(() => {
    if (autoStartGenerate) {
      onClearAutoStart?.();
      handleStartOrResumeFlow();
    } else if (activeDraft && !currentFinalized) {
      setViewMode('flow');
    }
  }, [autoStartGenerate, activeDraft?.version]);

  // 自动在步骤 3 执行 7 项自检与画像草稿生成
  useEffect(() => {
    if (
      viewMode === 'flow' &&
      activeDraft &&
      activeDraft.flow_step === 3 &&
      activeDraft.status === '草稿' &&
      !generating &&
      !genError
    ) {
      runStep3Generation(activeDraft.version);
    }
  }, [viewMode, activeDraft?.version, activeDraft?.flow_step, activeDraft?.status]);

  // 当进入第 4 步逐节确认时，默认定位到第一个未确认的章节
  useEffect(() => {
    if (activeDraft && activeDraft.flow_step === 4) {
      const firstUnconfirmed = [1, 2, 3, 4, 5, 6, 7, 8].find(
        (n) => !activeDraft.section_confirmations?.[String(n)],
      );
      if (firstUnconfirmed) setActiveConfirmSection(firstUnconfirmed);
    }
  }, [activeDraft?.version, activeDraft?.flow_step]);

  const handleStartOrResumeFlow = async () => {
    setGenError('');
    const res = await onPortraitAction({
      subAction: 'start_draft',
      triggerReason: currentFinalized ? '补充新证据后更新' : '证据达标',
    });
    setViewMode('flow');
    if (res?.portrait?.flow_step === 3 && res.portrait.status === '草稿') {
      await runStep3Generation(res.portrait.version);
    }
  };

  const runStep3Generation = async (version: number) => {
    setGenerating(true);
    setGenError('');
    try {
      await onPortraitAction({ subAction: 'generate', version });
    } catch (err: any) {
      setGenError(err?.message || '整理画像时遇到波动，可以重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async (format: 'markdown' | 'docx' | 'text', version: number) => {
    const res = await onPortraitAction({
      subAction: 'export',
      version,
      format: format === 'docx' ? 'docx' : 'markdown',
      includeExcerpts,
    });
    setExportMenuOpen(false);
    if (format === 'docx' && res?.base64) {
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      triggerDownloadBlob(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        res.fileName || `照见_个人画像_v${version}.docx`,
      );
      onShowToast('已下载 Word 文档');
    } else if (format === 'text' && res?.text) {
      await navigator.clipboard?.writeText(res.text);
      onShowToast('已复制画像全文到剪贴板');
    } else if (res?.text) {
      triggerDownloadBlob(
        new Blob([res.text], { type: 'text/markdown;charset=utf-8' }),
        res.fileName || `照见_个人画像_v${version}.md`,
      );
      onShowToast('已下载 Markdown 文件');
    }
  };

  const pendingMerges = (state.merges || []).filter((m: any) => m.review_status === '待过目');
  const missingExampleClues = (state.clues || []).filter(
    (c: any) => c.confidence?.level !== '已归档' && c.needs_example,
  );

  // ==================== 视图 1：P5.2 四步生成与逐节确认流 ====================
  if (viewMode === 'flow' && activeDraft) {
    const step = activeDraft.flow_step || 1;
    const stepLabels = [
      [1, '合并过目'],
      [2, '待补例子'],
      [3, '自检整理'],
      [4, '逐节确认'],
    ] as const;

    const curSecData = (activeDraft.sections || []).find(
      (s: any) => s.section === activeConfirmSection,
    );

    return (
      <>
        <header className="hdr">
          <div className="l">
            <h2>生成画像 v{activeDraft.version}</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {stepLabels.map(([num, label]) => {
                const isCur = step === num;
                const isDone = step > num;
                return (
                  <span
                    key={num}
                    className="mono"
                    style={{
                      color: isCur
                        ? 'var(--page-accent)'
                        : isDone
                          ? 'var(--page-ink)'
                          : 'var(--page-ink-3)',
                      fontWeight: isCur ? 500 : 400,
                    }}
                  >
                    {num}. {label}
                  </span>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-s btn-sm"
            onClick={() => {
              if (currentFinalized) setViewMode('main');
              else onBackHome();
            }}
          >
            稍后继续
          </button>
        </header>

        <div className="home-wrap" style={{ maxWidth: 820 }}>
          {step === 1 && (
            <div className="card">
              <span className="mono">第 1 步 · 合并过目</span>
              <h3 style={{ margin: '8px 0 8px', fontSize: 22, fontWeight: 500 }}>
                先看一眼自动合并过的线索
              </h3>
              <p className="c2" style={{ margin: '0 0 20px' }}>
                如果觉得哪两条其实不是一回事，点「拆开」就会各自独立计算
              </p>

              {pendingMerges.length === 0 ? (
                <div className="mono" style={{ padding: '12px 0' }}>
                  所有合并项都已过目完毕
                </div>
              ) : (
                pendingMerges.map((mg: any) => {
                  const target = (state.clues || []).find((c: any) => c.id === mg.target_clue_id);
                  return (
                    <div
                      key={mg.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 16,
                        padding: '12px 0',
                        borderTop: '1px solid var(--page-line)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14 }}>
                          「{mg.merged_statement}」 → 并入{' '}
                          <b style={{ fontWeight: 500 }}>
                            「{target?.user_statement || target?.statement || '原线索'}」
                          </b>
                        </div>
                        {mg.source_story_title && (
                          <div className="mono">来自《{mg.source_story_title}》</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-s btn-sm"
                          onClick={() =>
                            onClueAction({
                              subAction: 'review_merge',
                              mergeId: mg.id,
                              decision: 'confirm',
                            })
                          }
                        >
                          对
                        </button>
                        <button
                          type="button"
                          className="btn btn-t btn-sm"
                          onClick={() =>
                            onClueAction({
                              subAction: 'review_merge',
                              mergeId: mg.id,
                              decision: 'split',
                            })
                          }
                        >
                          拆开
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  type="button"
                  className={`btn ${pendingMerges.length === 0 ? 'btn-p' : 'btn-x'}`}
                  disabled={pendingMerges.length > 0}
                  onClick={async () => {
                    const nextStep = missingExampleClues.length > 0 ? 2 : 3;
                    await onPortraitAction({
                      subAction: 'set_step',
                      version: activeDraft.version,
                      step: nextStep,
                    });
                    if (nextStep === 3) {
                      await runStep3Generation(activeDraft.version);
                    }
                  }}
                >
                  {pendingMerges.length === 0 ? '下一步' : `还有 ${pendingMerges.length} 条待过目`}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="card">
              <span className="mono">第 2 步 · 待补例子</span>
              <h3 style={{ margin: '8px 0 8px', fontSize: 22, fontWeight: 500 }}>
                有 {missingExampleClues.length} 条你提过的感受，还没有具体例子
              </h3>
              <p className="c2" style={{ margin: '0 0 20px' }}>
                没有真实经历支撑的自述不会直接写进结论。你可以现在补一个例子，也可以先放进第 7 节「待观察」
              </p>

              {missingExampleClues.map((mc: any) => (
                <div
                  key={mc.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 0',
                    borderTop: '1px solid var(--page-line)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{mc.user_statement || mc.statement}</div>
                    <span className="mono">{mc.type} · 目前仅自述</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={() => onStartStoryForClue(mc.id)}
                  >
                    现在补一个例子
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-p"
                  onClick={async () => {
                    await onPortraitAction({
                      subAction: 'set_step',
                      version: activeDraft.version,
                      step: 3,
                    });
                    await runStep3Generation(activeDraft.version);
                  }}
                >
                  先放进待观察，开始整理画像
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="card">
              <span className="mono">第 3 步 · 7 项证据自检</span>
              <h3 style={{ margin: '8px 0 8px', fontSize: 22, fontWeight: 500 }}>
                {generating ? '正在按证据规则逐项核对…' : genError ? '整理中断了' : '7 项自检全部通过'}
              </h3>
              <p className="c2" style={{ margin: '0 0 20px' }}>
                确保每一句结论都和证据等级严格对应，不贴人格标签，不夸大单一来源
              </p>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {(activeDraft.review_notes || []).map((note: any) => {
                  const done = note.status === 'done';
                  return (
                    <li
                      key={note.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 0',
                        borderTop: '1px solid var(--page-line)',
                        fontSize: 14,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          border: `1.5px solid ${done ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                          background: done ? 'var(--page-accent)' : 'transparent',
                          display: 'grid',
                          placeItems: 'center',
                          flex: 'none',
                        }}
                      >
                        {done && <Check size={11} color="#fff" strokeWidth={3} />}
                      </span>
                      <span style={{ flex: 1 }}>{note.label}</span>
                      <span className="mono">{note.result_text || (generating ? '核对中…' : '')}</span>
                    </li>
                  );
                })}
              </ul>

              {genError && (
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="c2" style={{ fontSize: 13 }}>{genError}</span>
                  <button
                    type="button"
                    className="btn btn-p btn-sm"
                    onClick={() => runStep3Generation(activeDraft.version)}
                  >
                    <RefreshCw size={14} /> 从这一步重试
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 4 && curSecData && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span className="mono">
                  第 {activeConfirmSection} 节 · 共 8 节
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                    const conf = activeDraft.section_confirmations?.[String(n)];
                    const isCur = n === activeConfirmSection;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setActiveConfirmSection(n)}
                        title={`第 ${n} 节`}
                        style={{
                          width: 24,
                          height: 6,
                          border: 0,
                          padding: 0,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: isCur
                            ? 'var(--page-accent)'
                            : conf
                              ? 'var(--page-ink-3)'
                              : 'var(--page-line-2)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <h3 style={{ margin: '14px 0 4px', fontSize: 24, fontWeight: 500 }}>
                {curSecData.section}. {curSecData.title}
              </h3>
              {curSecData.subtitle && (
                <p className="c2" style={{ margin: '0 0 16px', fontSize: 13 }}>
                  {curSecData.subtitle}
                </p>
              )}

              <div style={{ marginTop: 16, borderTop: '1px solid var(--page-line)', paddingTop: 16 }}>
                {/* 结论型章节 (1, 2, 3) */}
                {curSecData.claims && curSecData.claims.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {curSecData.claims.map((cl: any) => (
                      <div
                        key={cl.id}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 12,
                          border: '1px solid var(--page-line-2)',
                          background: 'var(--page-bg)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span className={`tag${cl.wording === '明显' ? ' ok' : ''}`}>
                              {cl.wording}
                            </span>
                            <span className="mono">依据：{cl.evidence_summary}</span>
                            {cl.user_edited && <span className="tag">你修改过</span>}
                          </div>
                          <button
                            type="button"
                            className="btn btn-t btn-sm"
                            onClick={() => {
                              setEditingClaimId(cl.id);
                              setEditingClaimText(cl.headline);
                            }}
                          >
                            <Pencil size={13} /> 改一下
                          </button>
                        </div>

                        {editingClaimId === cl.id ? (
                          <div style={{ marginTop: 10 }}>
                            <input
                              type="text"
                              value={editingClaimText}
                              onChange={(e) => setEditingClaimText(e.target.value)}
                              style={{
                                width: '100%',
                                height: 38,
                                border: '1px solid var(--page-accent)',
                                borderRadius: 8,
                                padding: '0 10px',
                                fontSize: 15,
                                background: 'var(--page-surface)',
                              }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <button
                                type="button"
                                className="btn btn-p btn-sm"
                                onClick={async () => {
                                  await onPortraitAction({
                                    subAction: 'confirm_section',
                                    version: activeDraft.version,
                                    section: curSecData.section,
                                    editedClaimId: cl.id,
                                    editedText: editingClaimText,
                                  });
                                  setEditingClaimId(null);
                                }}
                              >
                                保存这句修改
                              </button>
                              <button
                                type="button"
                                className="btn btn-t btn-sm"
                                onClick={() => setEditingClaimId(null)}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 8 }}>
                            {cl.headline}
                          </div>
                        )}

                        {cl.scenarios && (
                          <div className="c2" style={{ fontSize: 13, marginTop: 6 }}>
                            适合场景：{cl.scenarios}
                          </div>
                        )}
                        {cl.tip && (
                          <div className="c2" style={{ fontSize: 13, marginTop: 6 }}>
                            建议：{cl.tip}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 第 4 节 价值观 Top 5 */}
                {curSecData.values_top5 && curSecData.values_top5.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                    {curSecData.values_top5.map((v: any) => (
                      <div
                        key={v.rank}
                        style={{
                          padding: 14,
                          borderRadius: 10,
                          border: '1px solid var(--page-line)',
                          background: 'var(--page-bg)',
                        }}
                      >
                        <span className="mono">#{v.rank}</span>
                        <div style={{ fontSize: 16, fontWeight: 500, margin: '4px 0' }}>{v.value}</div>
                        <div className="c2" style={{ fontSize: 12 }}>{v.definition}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 第 5 节 能量模式 */}
                {curSecData.energy && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                    <div>
                      <span className="mono">让你充电</span>
                      {(curSecData.energy.charging || []).map((it: any, i: number) => (
                        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 14 }}>
                          <div>{it.text}</div>
                          <span className={`tag${it.uncounted ? ' dash' : ''}`} style={{ marginTop: 4 }}>
                            {it.badge}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <span className="mono">让你消耗</span>
                      {(curSecData.energy.draining || []).map((it: any, i: number) => (
                        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 14 }}>
                          <div>{it.text}</div>
                          <span className={`tag${it.uncounted ? ' dash' : ''}`} style={{ marginTop: 4 }}>
                            {it.badge}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 第 6 节 最佳状态说明书（支持原地编辑四项） */}
                {curSecData.best_state && (
                  <div>
                    {editingBestState ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {(
                          [
                            ['when', '什么时候'],
                            ['how', '怎么做'],
                            ['with_whom', '跟谁一起'],
                            ['avoid', '避开'],
                          ] as const
                        ).map(([k, lab]) => (
                          <div key={k}>
                            <label className="mono" style={{ display: 'block', marginBottom: 4 }}>{lab}</label>
                            <input
                              type="text"
                              value={editingBestState[k]}
                              onChange={(e) =>
                                setEditingBestState({ ...editingBestState, [k]: e.target.value })
                              }
                              style={{
                                width: '100%',
                                height: 36,
                                border: '1px solid var(--page-line-2)',
                                borderRadius: 8,
                                padding: '0 10px',
                                fontSize: 14,
                              }}
                            />
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-p btn-sm"
                            onClick={async () => {
                              await onPortraitAction({
                                subAction: 'confirm_section',
                                version: activeDraft.version,
                                section: 6,
                                editedBestState: editingBestState,
                              });
                              setEditingBestState(null);
                              setActiveConfirmSection(7);
                            }}
                          >
                            保存并进下一节
                          </button>
                          <button
                            type="button"
                            className="btn btn-t btn-sm"
                            onClick={() => setEditingBestState(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', rowGap: 12, fontSize: 14 }}>
                          <span className="c3">什么时候</span>
                          <span>{curSecData.best_state.when}</span>
                          <span className="c3">怎么做</span>
                          <span>{curSecData.best_state.how}</span>
                          <span className="c3">跟谁一起</span>
                          <span>{curSecData.best_state.with_whom}</span>
                          <span className="c3">避开</span>
                          <span>{curSecData.best_state.avoid}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-t btn-sm"
                          style={{ marginTop: 12, paddingLeft: 0 }}
                          onClick={() => setEditingBestState({ ...curSecData.best_state })}
                        >
                          <Pencil size={13} /> 改一下说明书
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* 第 7 节 待观察 */}
                {curSecData.watch_items && curSecData.watch_items.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {curSecData.watch_items.map((w: any) => (
                      <div key={w.clue_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 14 }}>
                        <span>{w.statement}</span>
                        <span className="mono">{w.tag || w.source_label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {curSecData.diff_note && <p className="c2" style={{ margin: 0 }}>{curSecData.diff_note}</p>}
                {curSecData.empty_note && <p className="c2" style={{ margin: 0 }}>{curSecData.empty_note}</p>}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: '1px solid var(--page-line)',
                }}
              >
                <button
                  type="button"
                  className="btn btn-s btn-sm"
                  disabled={activeConfirmSection <= 1}
                  onClick={() => setActiveConfirmSection((n) => Math.max(1, n - 1))}
                >
                  上一节
                </button>
                <button
                  type="button"
                  className="btn btn-p"
                  onClick={async () => {
                    const res = await onPortraitAction({
                      subAction: 'confirm_section',
                      version: activeDraft.version,
                      section: activeConfirmSection,
                    });
                    if (res?.portrait?.status === '已定稿') {
                      setViewMode('main');
                      onShowToast(`画像 v${res.portrait.version} 已确认定稿`);
                    } else if (activeConfirmSection < 8) {
                      setActiveConfirmSection((n) => n + 1);
                    }
                  }}
                >
                  {activeConfirmSection === 8
                    ? '确认并定稿画像'
                    : curSecData.empty_note
                      ? '知道了，下一节'
                      : '准，下一节'}
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // ==================== 视图 2：P5.3 历史版本与对比视图 ====================
  if (viewMode === 'history' && finalizedPortraits.length > 0) {
    const viewing =
      finalizedPortraits.find((p) => p.version === selectedHistoryVersion) || finalizedPortraits[0];

    return (
      <>
        <header className="hdr">
          <div className="l">
            <button
              type="button"
              className="btn btn-t btn-sm"
              style={{ paddingLeft: 0 }}
              onClick={() => setViewMode('main')}
            >
              <ChevronLeft size={16} /> 返回当前画像
            </button>
            <h2>历史版本对比</h2>
          </div>
        </header>

        <div className="home-wrap" style={{ gap: 28 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {finalizedPortraits.map((fp, idx) => {
              const on = viewing.version === fp.version;
              return (
                <button
                  key={fp.version}
                  type="button"
                  onClick={() => setSelectedHistoryVersion(fp.version)}
                  style={{
                    height: 36,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: `1px solid ${on ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                    background: on ? 'var(--page-accent-50)' : 'var(--page-surface)',
                    color: on ? 'var(--page-accent)' : 'var(--page-ink)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  v{fp.version} {idx === 0 ? '· 当前' : ''}（{String(fp.confirmed_at || fp.generated_at).slice(5, 10)}）
                </button>
              );
            })}
          </div>

          {viewing.diff_from_previous && viewing.diff_from_previous.length > 0 && (
            <div className="card">
              <span className="mono">与上一版相比的变化</span>
              <div style={{ marginTop: 10 }}>
                {viewing.diff_from_previous.map((d: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--page-line)',
                      fontSize: 14,
                    }}
                  >
                    <div>
                      <span className={`tag${d.kind === '升级' || d.kind === '新增' ? ' ok' : ''}`} style={{ marginRight: 8 }}>
                        {d.kind}
                      </span>
                      <span>{d.statement}</span>
                    </div>
                    <span className="mono">{d.change_label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <span className="mono">只读存档 · v{viewing.version}</span>
            <h2 style={{ margin: '8px 0 4px', fontSize: 24, fontWeight: 500 }}>{viewing.headline}</h2>
            <p className="c2" style={{ margin: '0 0 20px', fontSize: 13 }}>{viewing.subtitle}</p>

            {(viewing.sections || []).map((sec: any) => (
              <div key={sec.section} style={{ padding: '14px 0', borderTop: '1px solid var(--page-line)' }}>
                <b style={{ fontWeight: 500 }}>{sec.section}. {sec.title}</b>
                {(sec.claims || []).map((cl: any) => (
                  <div key={cl.id} style={{ marginTop: 8, fontSize: 14 }}>
                    <div>【{cl.wording}】{cl.headline}</div>
                    {(cl.excerpts || []).map((ex: any, i: number) => (
                      <div key={i} className="mono" style={{ marginTop: 2 }}>
                        原话：{ex.deleted ? '来源已删除' : ex.excerpt}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  // ==================== 视图 3：P5.1 已定稿完整八节画像 ====================
  if (currentFinalized) {
    const p = currentFinalized;
    const sections: any[] = p.sections || [];

    return (
      <>
        <header className="hdr">
          <div className="l">
            <h2>个人画像</h2>
            <span className="tag ok">v{p.version}</span>
            {activeDraft && (
              <button
                type="button"
                className="btn btn-t btn-sm"
                style={{ color: 'var(--page-accent)' }}
                onClick={() => setViewMode('flow')}
              >
                继续确认 v{activeDraft.version} 草稿
              </button>
            )}
          </div>
          <div className="l" style={{ position: 'relative' }}>
            {finalizedPortraits.length > 0 && (
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={() => {
                  setSelectedHistoryVersion(p.version);
                  setViewMode('history');
                }}
              >
                <History size={14} /> 历史版本
              </button>
            )}
            {!activeDraft && state.eligibility?.eligible && (
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={handleStartOrResumeFlow}
              >
                <Sparkles size={14} /> 更新下一版
              </button>
            )}
            <button
              type="button"
              className="btn btn-p btn-sm"
              onClick={() => setExportMenuOpen((v) => !v)}
            >
              <Download size={14} /> 导出
            </button>

            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 44,
                  width: 240,
                  background: 'var(--page-surface)',
                  border: '1px solid var(--page-line-2)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,.1)',
                  padding: 12,
                  zIndex: 40,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--page-ink-2)',
                    paddingBottom: 10,
                    marginBottom: 8,
                    borderBottom: '1px solid var(--page-line)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeExcerpts}
                    onChange={(e) => setIncludeExcerpts(e.target.checked)}
                  />
                  <span>附上证据原话（默认不附）</span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    type="button"
                    className="btn-t"
                    style={{ justifyContent: 'flex-start', padding: '0 8px' }}
                    onClick={() => handleExport('markdown', p.version)}
                  >
                    下载 Markdown (.md)
                  </button>
                  <button
                    type="button"
                    className="btn-t"
                    style={{ justifyContent: 'flex-start', padding: '0 8px' }}
                    onClick={() => handleExport('docx', p.version)}
                  >
                    下载 Word 文档 (.docx)
                  </button>
                  <button
                    type="button"
                    className="btn-t"
                    style={{ justifyContent: 'flex-start', padding: '0 8px' }}
                    onClick={() => handleExport('text', p.version)}
                  >
                    复制为纯文本
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="home-wrap" style={{ gap: 36 }}>
          {/* 顶部总标题与固定副标题 (R5) */}
          <div style={{ borderBottom: '1px solid var(--page-line)', paddingBottom: 28 }}>
            <div className="mono">
              v{p.version} · {String(p.confirmed_at || p.generated_at).slice(0, 10)} 定稿 · 基于{' '}
              {p.stats?.story_count || 0} 个故事与 {p.stats?.clue_count || 0} 条线索
            </div>
            <h1 style={{ margin: '12px 0 8px', fontSize: 34, lineHeight: '42px', fontWeight: 500 }}>
              {p.headline}
            </h1>
            <p className="c2" style={{ margin: 0, fontSize: 15 }}>
              这是目前证据最充分的样子，不是定论
            </p>
          </div>

          {/* 移动端横向章节锚点条 */}
          <div
            className="mid-only"
            style={{
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {sections.map((sec) => (
              <a
                key={sec.section}
                href={`#psec-${sec.section}`}
                onClick={() => setActiveTocSec(sec.section)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: activeTocSec === sec.section ? 'var(--page-ink)' : 'var(--page-raised)',
                  color: activeTocSec === sec.section ? '#fff' : 'var(--page-ink-2)',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                {sec.section}. {sec.title}
              </a>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 32,
            }}
          >
            <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
              {/* 桌面左侧八节目录 */}
              <nav
                className="desktop-only"
                style={{
                  width: 180,
                  flex: 'none',
                  position: 'sticky',
                  top: 80,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {sections.map((sec) => (
                  <a
                    key={sec.section}
                    href={`#psec-${sec.section}`}
                    onClick={() => setActiveTocSec(sec.section)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      color: activeTocSec === sec.section ? 'var(--page-accent)' : 'var(--page-ink-2)',
                      background: activeTocSec === sec.section ? 'var(--page-accent-50)' : 'transparent',
                    }}
                  >
                    <span className="mono" style={{ marginRight: 6 }}>{sec.section}</span>
                    {sec.title}
                  </a>
                ))}
              </nav>

              {/* 右侧八节正文 */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 36 }}>
                {sections.map((sec) => {
                  const mainClaims = (sec.claims || []).filter((c: any) => c.wording !== '习得技能');
                  const skillClaims = (sec.claims || []).filter((c: any) => c.wording === '习得技能');

                  return (
                    <section
                      key={sec.section}
                      id={`psec-${sec.section}`}
                      className="card"
                      style={{ scrollMarginTop: 72 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>
                          <span className="mono" style={{ marginRight: 8 }}>0{sec.section}</span>
                          {sec.title}
                        </h3>
                        {sec.subtitle && <span className="mono">{sec.subtitle}</span>}
                      </div>

                      <div style={{ marginTop: 16 }}>
                        {mainClaims.map((cl: any) => (
                          <div
                            key={cl.id}
                            onClick={() => setDrawerClaim(cl)}
                            style={{
                              padding: '14px 0',
                              borderTop: '1px solid var(--page-line)',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span className={`tag${cl.wording === '明显' ? ' ok' : ''}`}>
                                {cl.wording}
                              </span>
                              <span style={{ fontSize: 16, fontWeight: 500 }}>{cl.headline}</span>
                              {cl.user_edited && <span className="tag">你修改过</span>}
                            </div>
                            {cl.detail && (
                              <div className="c2" style={{ fontSize: 13, marginTop: 4 }}>{cl.detail}</div>
                            )}
                            {cl.scenarios && (
                              <div className="c2" style={{ fontSize: 13, marginTop: 4 }}>
                                适合发挥的场景：{cl.scenarios}
                              </div>
                            )}
                            {cl.tip && (
                              <div className="c2" style={{ fontSize: 13, marginTop: 4 }}>
                                管理建议：{cl.tip}
                              </div>
                            )}
                            <div className="mono" style={{ marginTop: 6 }}>
                              依据：{cl.evidence_summary} · 点击查看原话依据
                            </div>
                          </div>
                        ))}

                        {/* 第 1 节子分组：习得技能 */}
                        {skillClaims.length > 0 && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: '12px 16px',
                              borderRadius: 10,
                              background: 'var(--page-bg)',
                              border: '1px solid var(--page-line)',
                            }}
                          >
                            <span className="mono">习得技能 · 做得熟但未必享受</span>
                            {skillClaims.map((sk: any) => (
                              <div
                                key={sk.id}
                                onClick={() => setDrawerClaim(sk)}
                                style={{ paddingTop: 8, cursor: 'pointer' }}
                              >
                                <div style={{ fontWeight: 500 }}>{sk.headline}</div>
                                <div className="mono">依据：{sk.evidence_summary}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 第 2 节空态附收集反馈入口 */}
                        {sec.section === 2 && mainClaims.length === 0 && (
                          <div style={{ paddingTop: 8 }}>
                            <p className="c2" style={{ margin: '0 0 12px' }}>{sec.empty_note}</p>
                            <button type="button" className="btn btn-s btn-sm" onClick={onOpenFeedback}>
                              <Users size={14} /> 去收集他人反馈
                            </button>
                          </div>
                        )}

                        {sec.section !== 2 && sec.empty_note && (
                          <p className="c2" style={{ margin: '8px 0 0' }}>{sec.empty_note}</p>
                        )}

                        {/* 第 4 节 价值观 5 列网格 */}
                        {sec.values_top5 && sec.values_top5.length > 0 && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(136px, 1fr))',
                              gap: 12,
                              marginTop: 8,
                            }}
                          >
                            {sec.values_top5.map((v: any) => (
                              <div
                                key={v.rank}
                                style={{
                                  padding: 14,
                                  borderRadius: 10,
                                  border: '1px solid var(--page-line)',
                                  background: 'var(--page-bg)',
                                }}
                              >
                                <span className="mono">TOP {v.rank}</span>
                                <div style={{ fontSize: 17, fontWeight: 500, margin: '6px 0' }}>{v.value}</div>
                                <div className="c2" style={{ fontSize: 12, lineHeight: '18px' }}>
                                  {v.definition}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 第 5 节 能量模式双栏 */}
                        {sec.energy && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                              gap: 24,
                              marginTop: 8,
                            }}
                          >
                            <div>
                              <span className="mono">让你充电</span>
                              {(sec.energy.charging || []).length === 0 ? (
                                <div className="c3" style={{ paddingTop: 8, fontSize: 13 }}>待继续记录</div>
                              ) : (
                                sec.energy.charging.map((it: any, i: number) => (
                                  <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--page-line)' }}>
                                    <div style={{ fontSize: 14 }}>{it.text}</div>
                                    <span className={`tag${it.uncounted ? ' dash' : ''}`} style={{ marginTop: 4 }}>
                                      {it.badge}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div>
                              <span className="mono">让你消耗</span>
                              {(sec.energy.draining || []).length === 0 ? (
                                <div className="c3" style={{ paddingTop: 8, fontSize: 13 }}>待继续记录</div>
                              ) : (
                                sec.energy.draining.map((it: any, i: number) => (
                                  <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--page-line)' }}>
                                    <div style={{ fontSize: 14 }}>{it.text}</div>
                                    <span className={`tag${it.uncounted ? ' dash' : it.highlight ? ' ok' : ''}`} style={{ marginTop: 4 }}>
                                      {it.badge}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}

                        {/* 第 6 节 最佳状态说明书 */}
                        {sec.best_state && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '96px 1fr',
                              rowGap: 14,
                              paddingTop: 8,
                              fontSize: 14,
                            }}
                          >
                            <span className="c3">什么时候</span>
                            <span>{sec.best_state.when}</span>
                            <span className="c3">怎么做</span>
                            <span>{sec.best_state.how}</span>
                            <span className="c3">跟谁一起</span>
                            <span>{sec.best_state.with_whom}</span>
                            <span className="c3">避开</span>
                            <span>{sec.best_state.avoid}</span>
                          </div>
                        )}

                        {/* 第 7 节 待观察 */}
                        {sec.watch_items && sec.watch_items.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {sec.watch_items.map((w: any) => (
                              <div
                                key={w.clue_id}
                                onClick={() => onOpenClue(w.clue_id)}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 12,
                                  padding: '10px 0',
                                  borderTop: '1px solid var(--page-line)',
                                  cursor: 'pointer',
                                }}
                              >
                                <span style={{ fontSize: 14 }}>{w.statement}</span>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  {w.tag && <span className="tag dash">{w.tag}</span>}
                                  <span className="mono">{w.source_label}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {sec.diff_note && (
                          <p className="c2" style={{ margin: '8px 0 0' }}>{sec.diff_note}</p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 点击结论弹出的右侧原话证据抽屉 */}
        {drawerClaim && (
          <>
            <div className="drawer-backdrop" onClick={() => setDrawerClaim(null)} />
            <div className="right-drawer" style={{ width: 360, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono">结论依据追溯</span>
                <button type="button" className="tb" onClick={() => setDrawerClaim(null)}>
                  <X size={16} />
                </button>
              </div>
              <h4 style={{ margin: '12px 0 8px', fontSize: 17, fontWeight: 500 }}>
                【{drawerClaim.wording}】{drawerClaim.headline}
              </h4>
              <div className="mono" style={{ marginBottom: 16 }}>{drawerClaim.evidence_summary}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(drawerClaim.excerpts || []).map((ex: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: 'var(--page-bg)',
                      border: '1px solid var(--page-line)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tag">{ex.source_type}</span>
                      {ex.story_id && !ex.deleted && (
                        <button
                          type="button"
                          className="btn-t"
                          style={{ height: 22, fontSize: 12 }}
                          onClick={() => {
                            setDrawerClaim(null);
                            onOpenStory(ex.story_id);
                          }}
                        >
                          打开原故事
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        color: ex.deleted ? 'var(--page-ink-3)' : 'var(--page-ink)',
                      }}
                    >
                      {ex.deleted ? '来源已删除' : ex.excerpt}
                    </div>
                  </div>
                ))}
              </div>

              {drawerClaim.clue_id && (
                <button
                  type="button"
                  className="btn btn-s"
                  style={{ width: '100%', marginTop: 20 }}
                  onClick={() => {
                    const id = drawerClaim.clue_id;
                    setDrawerClaim(null);
                    onOpenClue(id);
                  }}
                >
                  打开线索详情 <ChevronRight size={14} />
                </button>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  // ==================== 视图 4：P5.1 未生成门槛引导页 ====================
  const elig = state.eligibility || {
    eligible: false,
    highClueCount: 0,
    valuesCompleted: false,
    distinctSourceCount: 0,
    blockingReasons: [],
    closestClues: [],
  };

  return (
    <>
      <header className="hdr">
        <h2>个人画像</h2>
        <span className="mono">{elig.eligible ? '条件已就绪' : '探索积累中'}</span>
      </header>

      <div className="home-wrap" style={{ maxWidth: 880, gap: 36 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: '40px', fontWeight: 500 }}>
            {elig.eligible
              ? '生成第一版画像的三个条件都满足了'
              : '攒够跨来源的真实证据后，这里会生成你的个人画像'}
          </h1>
          <p className="c2" style={{ margin: '10px 0 0', fontSize: 15 }}>
            为了不给你贴空洞的标签，第一版画像需要至少 3 条「高」置信线索、完成一次价值观澄清，并且证据来自至少 2 种不同来源
          </p>
        </div>

        <div className="card">
          <span className="mono">第一版生成门槛</span>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="gate" style={{ gridTemplateColumns: '140px 1fr 72px' }}>
              <span className="lab">「高」置信线索</span>
              <span className={`bar${elig.highClueCount >= 3 ? ' done' : ''}`}>
                <b style={{ width: `${Math.min(100, (elig.highClueCount / 3) * 100)}%` }} />
              </span>
              <span className="v">{elig.highClueCount} / 3</span>
            </div>

            <div className="gate" style={{ gridTemplateColumns: '140px 1fr 72px' }}>
              <span className="lab">价值观澄清</span>
              <span className={`bar${elig.valuesCompleted ? ' done' : ''}`}>
                <b style={{ width: elig.valuesCompleted ? '100%' : '0%' }} />
              </span>
              <span className="v">{elig.valuesCompleted ? '已完成' : '未完成'}</span>
            </div>

            <div className="gate" style={{ gridTemplateColumns: '140px 1fr 72px' }}>
              <span className="lab">有效证据来源种类</span>
              <span className={`bar${elig.distinctSourceCount >= 2 ? ' done' : ''}`}>
                <b style={{ width: `${Math.min(100, (elig.distinctSourceCount / 2) * 100)}%` }} />
              </span>
              <span className="v">{elig.distinctSourceCount} / 2</span>
            </div>
          </div>

          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: '1px solid var(--page-line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!elig.valuesCompleted && (
                <button type="button" className="btn btn-s btn-sm" onClick={onOpenValues}>
                  去做价值观澄清
                </button>
              )}
              {elig.distinctSourceCount < 2 && (
                <button type="button" className="btn btn-s btn-sm" onClick={onOpenUploadModal}>
                  上传测评报告
                </button>
              )}
              <button
                type="button"
                className="btn btn-s btn-sm"
                onClick={() => onStartStoryForClue()}
              >
                继续讲故事
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <button
                type="button"
                className={`btn ${elig.eligible ? 'btn-p' : 'btn-x'}`}
                disabled={!elig.eligible}
                onClick={handleStartOrResumeFlow}
              >
                生成第一版画像
              </button>
              {!elig.eligible && elig.blockingReasons?.length > 0 && (
                <span className="mono">{elig.blockingReasons.join(' · ')}</span>
              )}
            </div>
          </div>
        </div>

        {/* 离「高」最近的线索 */}
        {elig.closestClues && elig.closestClues.length > 0 && (
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 10 }}>
              离写进画像最近的线索
            </span>
            <table className="cl">
              <tbody>
                {elig.closestClues.map((cc: any) => {
                  const full = (state.clues || []).find((c: any) => c.id === cc.id);
                  return (
                    <tr key={cc.id} onClick={() => onOpenClue(cc.id)}>
                      <td style={{ width: 88 }}>
                        <Tally strokes={full?.confidence?.tallyStrokes || []} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{cc.statement}</div>
                        <span className="sub">{cc.nextNeeded}</span>
                      </td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-s btn-sm"
                          onClick={() => onStartStoryForClue(cc.id)}
                        >
                          讲个相关故事
                        </button>
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
