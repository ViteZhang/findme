import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleAlert,
  CornerUpRight,
  FileText,
  GripVertical,
  LifeBuoy,
  PanelRight,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  RotateCw,
  WifiOff,
} from 'lucide-react';
import { CoachMark, Tally, VoiceMicButton } from '../components/Primitives.tsx';

// ==================== P2.3 价值观澄清工作区 ====================
function ValuesInteractiveStream({
  state,
  valuesPool,
  onValuesAction,
  onOpenUploadModal,
  onGoHome,
}: {
  state: any;
  valuesPool: string[];
  onValuesAction: (payload: any) => Promise<any>;
  onOpenUploadModal: () => void;
  onGoHome: () => void;
}) {
  const latestRanking = state.valueRankings?.[0] || null;
  const [selectedWords, setSelectedWords] = useState<string[]>(latestRanking?.shortlist || []);
  const [customWord, setCustomWord] = useState('');
  const [pendingChoice, setPendingChoice] = useState<'A' | 'B' | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [top5List, setTop5List] = useState<Array<{ rank: number; value: string; user_definition: string }>>(
    latestRanking?.top5 || [],
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [coachHint, setCoachHint] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!latestRanking) {
      onValuesAction({ kind: 'init' }).catch(() => null);
    } else {
      if (latestRanking.shortlist?.length && selectedWords.length === 0) {
        setSelectedWords(latestRanking.shortlist);
      }
      if (latestRanking.top5?.length) {
        setTop5List(latestRanking.top5);
      }
    }
  }, [latestRanking?.id, latestRanking?.step]);

  const step = latestRanking?.step || 'shortlist';
  const allPool = [...new Set([...valuesPool, ...selectedWords])];

  const toggleWord = (word: string) => {
    if (selectedWords.includes(word)) {
      setSelectedWords(selectedWords.filter((w) => w !== word));
    } else {
      if (selectedWords.length >= 10) {
        setCoachHint('已经选满 10 个词，想换词可以先取消一个已选的');
        return;
      }
      setSelectedWords([...selectedWords, word]);
      setCoachHint('');
    }
  };

  const addCustomWord = () => {
    const w = customWord.trim();
    if (!w) return;
    if (!selectedWords.includes(w) && selectedWords.length < 10) {
      setSelectedWords([...selectedWords, w]);
    }
    setCustomWord('');
  };

  const submitShortlist = async () => {
    setBusy(true);
    try {
      const res = await onValuesAction({ kind: 'save_shortlist', shortlist: selectedWords });
      if (res?.coachMessage) setCoachHint(res.coachMessage);
    } finally {
      setBusy(false);
    }
  };

  const tradeoffs = latestRanking?.tradeoffs || [];
  const activeDilemma = tradeoffs.find((t: any) => !t.skipped && t.choice === null);
  const completedDilemmas = tradeoffs.filter((t: any) => t.skipped || t.choice !== null);

  const submitDilemmaAnswer = async (opts: { bothImportant?: boolean; skipAfterHesitate?: boolean }) => {
    if (!latestRanking || !activeDilemma) return;
    setBusy(true);
    try {
      const res = await onValuesAction({
        kind: 'answer_dilemma',
        rankingId: latestRanking.id,
        dilemmaId: activeDilemma.id,
        choice: opts.bothImportant ? undefined : pendingChoice || undefined,
        reason: reasonText,
        bothImportant: opts.bothImportant,
        skipAfterHesitate: opts.skipAfterHesitate,
      });
      if (res?.coachMessage) setCoachHint(res.coachMessage);
      if (!opts.bothImportant || opts.skipAfterHesitate) {
        setPendingChoice(null);
        setReasonText('');
      }
    } finally {
      setBusy(false);
    }
  };

  const moveRankItem = (from: number, to: number) => {
    if (to < 0 || to >= top5List.length) return;
    const next = [...top5List];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTop5List(next.map((it, i) => ({ ...it, rank: i + 1 })));
  };

  const missingDefinitions = top5List.filter((it) => !it.user_definition.trim()).length;

  return (
    <div className="cv-body">
      <div className="cv-col">
        <div className="stream">
          {step === 'shortlist' && (
            <>
              <div className="coach">
                <CoachMark />
                <p>先从这些词里挑出 10 个你最有共鸣的。不用想哪个更「对」，凭第一感觉</p>
              </div>
              <div className="inl" style={{ maxWidth: 640 }}>
                <div className="xcard">
                  <div className="mono">
                    已选 <b style={{ color: 'var(--page-ink)', fontWeight: 500 }}>{selectedWords.length}</b> / 10
                    {selectedWords.length < 10 ? ` · 再选 ${10 - selectedWords.length} 个` : ' · 已选满'}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    {allPool.map((w) => {
                      const isOn = selectedWords.includes(w);
                      const isDim = !isOn && selectedWords.length >= 10;
                      return (
                        <button
                          key={w}
                          type="button"
                          onClick={() => toggleWord(w)}
                          style={{
                            height: 40,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0 12px',
                            borderRadius: 8,
                            border: `1px solid ${isOn ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                            boxShadow: isOn ? 'inset 0 0 0 1px var(--page-accent)' : 'none',
                            background: isOn
                              ? 'var(--page-accent-50)'
                              : isDim
                                ? 'var(--page-bg)'
                                : 'var(--page-surface)',
                            color: isDim ? '#a3a3a3' : 'var(--page-ink)',
                            fontSize: 14,
                            cursor: 'pointer',
                          }}
                        >
                          <span>{w}</span>
                          {isOn && <Check size={14} color="var(--page-accent)" />}
                        </button>
                      );
                    })}
                  </div>
                  {coachHint && (
                    <div className="mono" style={{ marginTop: 10, color: 'var(--page-ink-2)' }}>
                      {coachHint}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 16,
                      paddingTop: 12,
                      borderTop: '1px solid var(--page-line)',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="mono">想到不在这里的词，可以在下方输入添加</span>
                    <button
                      type="button"
                      className={`btn ${selectedWords.length === 10 ? 'btn-p' : 'btn-x'} btn-sm`}
                      disabled={selectedWords.length !== 10 || busy}
                      onClick={submitShortlist}
                    >
                      {selectedWords.length === 10 ? '继续进入两难取舍' : `选满 10 个后继续`}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'tradeoffs' && activeDilemma && (
            <>
              <div className="mono">选词 · 你已挑出 10 个核心词</div>
              <div className="coach">
                <CoachMark />
                <p>{coachHint || '来几道两难题。每道选一个，再用一句话说为什么'}</p>
              </div>

              {completedDilemmas.map((done: any, idx: number) => (
                <div
                  key={done.id}
                  className="inl"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'var(--page-surface)',
                    border: '1px solid var(--page-line)',
                    fontSize: 13,
                    color: 'var(--page-ink-2)',
                  }}
                >
                  <span className="mono" style={{ marginRight: 10 }}>第 {idx + 1} 道</span>
                  {done.skipped ? (
                    <span>都重要 · 已跳过（不产生证据）</span>
                  ) : (
                    <span>
                      <b style={{ color: 'var(--page-ink)', fontWeight: 500 }}>
                        {done.choice === 'A' ? done.optionA : done.optionB}
                      </b>
                      {' 胜过 '}
                      {done.choice === 'A' ? done.optionB : done.optionA}
                    </span>
                  )}
                </div>
              ))}

              <div className="inl" style={{ maxWidth: 600 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {(['A', 'B'] as const).map((side) => {
                    const isPicked = pendingChoice === side;
                    const isOtherPicked = pendingChoice && pendingChoice !== side;
                    const optText = side === 'A' ? activeDilemma.optionA : activeDilemma.optionB;
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setPendingChoice(side)}
                        style={{
                          textAlign: 'left',
                          border: `1px solid ${isPicked ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                          boxShadow: isPicked ? 'inset 0 0 0 1px var(--page-accent)' : 'none',
                          borderRadius: 12,
                          padding: 16,
                          background: 'var(--page-surface)',
                          minHeight: 112,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          opacity: isOtherPicked ? 0.55 : 1,
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          className="mono"
                          style={{ color: isPicked ? 'var(--page-accent)' : 'var(--page-ink-3)' }}
                        >
                          {side}
                          {isPicked ? ' · 你选的' : ''}
                        </span>
                        <span style={{ fontSize: 15, lineHeight: '24px' }}>{optText}</span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <span className="mono">
                    {pendingChoice
                      ? '选好了，在下方用一句话说说为什么（不说理由也可直接提交，记为弱证据）'
                      : '先点选 A 或 B'}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(activeDilemma.hesitate_count || 0) < 2 ? (
                      <button
                        type="button"
                        className="btn btn-t btn-sm"
                        disabled={busy}
                        onClick={() => submitDilemmaAnswer({ bothImportant: true })}
                      >
                        都重要，选不出
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-t btn-sm"
                        disabled={busy}
                        onClick={() => submitDilemmaAnswer({ bothImportant: true, skipAfterHesitate: true })}
                      >
                        跳过这道题
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'discussion' && (
            <>
              <div className="coach">
                <CoachMark />
                <p>
                  {coachHint ||
                    '有一点想和你探讨，不是说你说得不对：你把「成长」放在前面，但讲过的高光故事里，高潮常落在别人的肯定。被认可对你的分量，会不会比你想的更重一些？'}
                </p>
              </div>
              {latestRanking?.inconsistencies?.[0] && (
                <div
                  className="inl"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--page-surface)',
                  }}
                >
                  <div style={{ padding: '14px 16px' }}>
                    <span className="mono" style={{ display: 'block', marginBottom: 6 }}>你说的</span>
                    <div>{latestRanking.inconsistencies[0].said}</div>
                  </div>
                  <div style={{ padding: '14px 16px', borderLeft: '1px solid var(--page-line)' }}>
                    <span className="mono" style={{ display: 'block', marginBottom: 6 }}>你讲过的</span>
                    <div>{latestRanking.inconsistencies[0].did}</div>
                  </div>
                </div>
              )}
              <div className="inl" style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-s btn-sm"
                  disabled={busy}
                  onClick={() =>
                    onValuesAction({
                      kind: 'respond_inconsistency',
                      rankingId: latestRanking.id,
                      agreed: true,
                    })
                  }
                >
                  好像是的，我确实挺在意评价
                </button>
                <button
                  type="button"
                  className="btn btn-s btn-sm"
                  disabled={busy}
                  onClick={() =>
                    onValuesAction({
                      kind: 'respond_inconsistency',
                      rankingId: latestRanking.id,
                      agreed: false,
                    })
                  }
                >
                  不是，被认可只是顺带的
                </button>
              </div>
            </>
          )}

          {step === 'ranking' && (
            <>
              <div className="coach">
                <CoachMark />
                <p>把你的 Top 5 排一下顺序（桌面可拖拽，也可点箭头上下调整），每个用一句话说说对你意味着什么</p>
              </div>
              <div className="inl" style={{ maxWidth: 620 }}>
                <div className="xcard">
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {top5List.map((item, idx) => (
                      <li
                        key={item.value}
                        draggable
                        onDragStart={() => setDragIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIdx !== null && dragIdx !== idx) {
                            moveRankItem(dragIdx, idx);
                          }
                          setDragIdx(null);
                        }}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '20px 24px 72px minmax(0,1fr) 68px',
                          gap: 10,
                          alignItems: 'center',
                          padding: '10px 0',
                          borderBottom: '1px solid var(--page-line)',
                        }}
                      >
                        <GripVertical size={15} color="var(--page-ink-3)" style={{ cursor: 'grab' }} />
                        <span className="mono">{idx + 1}</span>
                        <b style={{ fontWeight: 500, fontSize: 15 }}>{item.value}</b>
                        <input
                          type="text"
                          value={item.user_definition}
                          onChange={(e) => {
                            const next = [...top5List];
                            next[idx] = { ...next[idx], user_definition: e.target.value };
                            setTop5List(next);
                          }}
                          placeholder="对你来说它意味着什么？"
                          style={{
                            height: 34,
                            border: '1px solid var(--page-line-2)',
                            borderRadius: 8,
                            padding: '0 10px',
                            fontSize: 13,
                            background: 'var(--page-surface)',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="tb"
                            disabled={idx === 0}
                            onClick={() => moveRankItem(idx, idx - 1)}
                            aria-label="上移"
                          >
                            <ChevronUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="tb"
                            disabled={idx === top5List.length - 1}
                            onClick={() => moveRankItem(idx, idx + 1)}
                            aria-label="下移"
                          >
                            <ChevronDown size={15} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 16,
                      paddingTop: 12,
                      borderTop: '1px solid var(--page-line)',
                    }}
                  >
                    <span className="mono">
                      {missingDefinitions > 0 ? `还差 ${missingDefinitions} 个定义` : '5 个定义都已填好'}
                    </span>
                    <button
                      type="button"
                      className={`btn ${missingDefinitions === 0 ? 'btn-p' : 'btn-x'} btn-sm`}
                      disabled={missingDefinitions > 0 || busy}
                      onClick={() =>
                        onValuesAction({
                          kind: 'confirm_top5',
                          rankingId: latestRanking.id,
                          top5: top5List,
                        })
                      }
                    >
                      确认这个顺序
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'completed' && latestRanking && (
            <div className="inl" style={{ maxWidth: 600 }}>
              <div className="card">
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>你的价值观 Top 5</h4>
                <ul style={{ listStyle: 'none', margin: '12px 0', padding: 0 }}>
                  {(latestRanking.top5 || []).map((it: any) => (
                    <li
                      key={it.rank}
                      style={{
                        display: 'flex',
                        gap: 12,
                        padding: '8px 0',
                        borderBottom: '1px solid var(--page-line)',
                        fontSize: 14,
                      }}
                    >
                      <span className="mono" style={{ width: 18 }}>{it.rank}</span>
                      <b style={{ fontWeight: 500, width: 64 }}>{it.value}</b>
                      <span className="c2">{it.user_definition}</span>
                    </li>
                  ))}
                </ul>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 16,
                  }}
                >
                  <span className="c2" style={{ fontSize: 13 }}>
                    建议下一步：上传一份测评报告，或回首页看线索升级进度
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-p btn-sm" onClick={onOpenUploadModal}>
                      上传测评
                    </button>
                    <button type="button" className="btn btn-s btn-sm" onClick={onGoHome}>
                      回首页
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 价值观底部输入框（选词阶段添加自定义词 / 两难题输入理由） */}
        {(step === 'shortlist' || (step === 'tradeoffs' && activeDilemma)) && (
          <div className="dock">
            <div className="in">
              <div className="comp">
                <textarea
                  rows={1}
                  value={step === 'shortlist' ? customWord : reasonText}
                  onChange={(e) =>
                    step === 'shortlist'
                      ? setCustomWord(e.target.value)
                      : setReasonText(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (step === 'shortlist') addCustomWord();
                      else if (pendingChoice) submitDilemmaAnswer({});
                    }
                  }}
                  placeholder={
                    step === 'shortlist'
                      ? '也可以输入不在列表里的词，按回车加入'
                      : pendingChoice
                        ? '用一句话说说为什么选它（若说不上来也可直接点右侧发送）'
                        : '请先在上方点击选择 A 或 B'
                  }
                />
                <div className="tools">
                  <VoiceMicButton
                    onTranscript={(t) =>
                      step === 'shortlist'
                        ? setCustomWord((p) => `${p}${t}`)
                        : setReasonText((p) => `${p}${t}`)
                    }
                  />
                  <button
                    type="button"
                    className={`ibtn${
                      step === 'shortlist' ? (!customWord.trim() ? ' off' : '') : !pendingChoice ? ' off' : ''
                    }`}
                    disabled={step === 'shortlist' ? !customWord.trim() : !pendingChoice || busy}
                    onClick={() =>
                      step === 'shortlist' ? addCustomWord() : submitDilemmaAnswer({})
                    }
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="disc desktop-only">
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>本次发现</h3>
        <div>
          <span className="mono" style={{ display: 'block', marginBottom: 8 }}>进度</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            <li style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 13 }}>
              <span>选词</span>
              <span className="mono">{selectedWords.length} / 10</span>
            </li>
            <li style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 13 }}>
              <span>两难取舍</span>
              <span className="mono">{completedDilemmas.length} / {tradeoffs.length || 6}</span>
            </li>
            <li style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--page-line)', fontSize: 13 }}>
              <span>排序与定义</span>
              <span className="mono">{step === 'completed' ? '5 / 5' : `${5 - missingDefinitions} / 5`}</span>
            </li>
          </ul>
        </div>
        <span className="mono">中途离开会保留已选的词和取舍记录</span>
      </aside>
    </div>
  );
}

// ==================== P2.4 测评解读工作区 ====================
function AssessmentInteractiveStream({
  assessment,
  state,
  onRespondComparison,
  onDisposeFile,
  onOpenUploadModal,
  onStartExampleStory,
  onOpenClue,
  onGoHome,
}: {
  assessment: any;
  state: any;
  onRespondComparison: (comparisonId: string, action: string, userText?: string) => Promise<any>;
  onDisposeFile: (deleteFile: boolean) => Promise<void>;
  onOpenUploadModal: () => void;
  onStartExampleStory: (prompt: string) => void;
  onOpenClue: (clueId: string) => void;
  onGoHome: () => void;
}) {
  const [explainText, setExplainText] = useState('');
  const [explainingId, setExplainingId] = useState<string | null>(null);
  const [upgradedBanner, setUpgradedBanner] = useState<any>(null);
  const [askDeleteFile, setAskDeleteFile] = useState(false);
  const [fileDisposedMsg, setFileDisposedMsg] = useState('');

  if (!assessment) {
    return (
      <div className="home-wrap">
        <div className="card" style={{ maxWidth: 520 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 500 }}>还没有上传测评报告</h3>
          <p className="c2" style={{ margin: '0 0 16px' }}>
            支持大五人格、VIA 性格优势、盖洛普优势识别，也可以粘贴 MBTI 结果启发对话
          </p>
          <button type="button" className="btn btn-p" onClick={onOpenUploadModal}>
            上传测评报告
          </button>
        </div>
      </div>
    );
  }

  if (assessment.parse_status === 'failed') {
    return (
      <div className="home-wrap">
        <div className="card" style={{ maxWidth: 560, borderColor: 'var(--page-ink-2)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <FileText size={20} color="var(--page-ink-2)" />
            <div>
              <div style={{ fontWeight: 500 }}>{assessment.file_name || '测评报告'}</div>
              <div className="mono" style={{ marginTop: 4, color: 'var(--page-ink-2)' }}>
                {assessment.parse_error || '没读到分数，图片可能太模糊'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button type="button" className="btn btn-p btn-sm" onClick={onOpenUploadModal}>
              重新上传或改为粘贴文字
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isMbti = assessment.instrument === 'MBTI' || !assessment.counts_as_evidence;
  const comparisons = assessment.comparisons || [];
  const firstPendingIdx = comparisons.findIndex((c: any) => c.status === 'pending');
  const allCompleted = comparisons.length > 0 && firstPendingIdx === -1;

  const handleAction = async (cmpId: string, act: string, text?: string) => {
    const res = await onRespondComparison(cmpId, act, text);
    if (res?.upgradedClue) {
      setUpgradedBanner(res.upgradedClue);
    }
    if (res?.askRawFileDisposal) {
      setAskDeleteFile(true);
    }
    setExplainingId(null);
    setExplainText('');
  };

  return (
    <div className="cv-body">
      <div className="cv-col">
        <div className="stream">
          {/* 顶部上传文件状态卡 */}
          <div
            className="inl"
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr auto',
              gap: 12,
              alignItems: 'center',
              padding: '12px 14px',
              border: '1px solid var(--page-line-2)',
              borderRadius: 12,
              background: 'var(--page-surface)',
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--page-raised)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <FileText size={16} color="var(--page-ink-3)" />
            </span>
            <div>
              <div>
                {assessment.instrument} · {assessment.scores?.length || 0} 个维度
              </div>
              <div className="mono" style={{ marginTop: 2 }}>
                {isMbti ? '用来启发聊天，不算证据' : `已识别 · ${assessment.taken_at || ''}`}
              </div>
            </div>
            <span className={`tag${isMbti ? '' : ' ok'}`}>
              {isMbti ? '不计入' : '可计入'}
            </span>
          </div>

          {isMbti ? (
            <>
              <div className="coach">
                <CoachMark />
                <p>
                  谢谢分享。MBTI 可以作为一个很好的聊天起点，不过它的重测稳定性有一些争议，所以我不会把它计入证据权重。
                  我更好奇的是：{assessment.scores?.[0]?.dimension || '这个类型'} 的描述里，哪一点你觉得最像自己？能举个具体的例子吗？
                </p>
              </div>
              <div className="inl" style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-p btn-sm"
                  onClick={() => onStartExampleStory(`在 MBTI 描述里，我觉得最像自己的一次具体经历是：`)}
                >
                  讲一个具体的例子
                </button>
                <button type="button" className="btn btn-s btn-sm" onClick={onGoHome}>
                  回首页
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="coach">
                <CoachMark />
                <p>我先用大白话翻译一下你的测评结果</p>
              </div>

              {/* 百分位刻度摘要卡 */}
              <div className="inl" style={{ maxWidth: 600 }}>
                <div className="xcard">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingBottom: 10,
                      borderBottom: '1px solid var(--page-line)',
                    }}
                  >
                    <b style={{ fontWeight: 500 }}>
                      {assessment.instrument} · {assessment.scores?.length || 0} 个维度
                    </b>
                    <span className="mono">百分位 / 排名</span>
                  </div>
                  {(assessment.scores || []).map((sc: any, i: number) => {
                    const num = typeof sc.score === 'number' ? sc.score : Number(sc.score);
                    const hasPct = !isNaN(num) && num >= 0 && num <= 100;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: hasPct ? '80px 1fr 112px 44px' : '110px 1fr auto',
                          gap: 12,
                          alignItems: 'center',
                          padding: '10px 0',
                          borderBottom:
                            i === assessment.scores.length - 1 ? '0' : '1px solid var(--page-line)',
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{sc.dimension}</span>
                        <span className="c2" style={{ fontSize: 13 }}>{sc.explanation}</span>
                        {hasPct && (
                          <span
                            style={{
                              height: 4,
                              borderRadius: 2,
                              background: 'var(--page-raised)',
                              position: 'relative',
                              display: 'block',
                            }}
                          >
                            <i
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: -2,
                                width: 1,
                                height: 8,
                                background: 'var(--page-line-2)',
                              }}
                            />
                            <b
                              style={{
                                position: 'absolute',
                                left: `${num}%`,
                                top: -3,
                                width: 2,
                                height: 10,
                                background: 'var(--page-accent)',
                                borderRadius: 1,
                              }}
                            />
                          </span>
                        )}
                        <span className="mono" style={{ textAlign: 'right' }}>{sc.score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="coach">
                <CoachMark />
                <p>
                  接下来逐条和你讲过的故事对一下，一共 {comparisons.length} 条，每条都请你说说准不准（也可以先跳过）
                </p>
              </div>

              {/* 逐条解锁展示对照卡片 */}
              {comparisons.map((cmp: any, idx: number) => {
                if (firstPendingIdx !== -1 && idx > firstPendingIdx) {
                  if (idx === firstPendingIdx + 1) {
                    return (
                      <div
                        key={cmp.id}
                        className="inl"
                        style={{
                          padding: '10px 16px',
                          border: '1px dashed var(--page-line-2)',
                          borderRadius: 12,
                          color: 'var(--page-ink-3)',
                          fontSize: 13,
                        }}
                      >
                        还有 {comparisons.length - firstPendingIdx - 1} 条，回应上面这条后出现
                      </div>
                    );
                  }
                  return null;
                }

                if (cmp.status !== 'pending') {
                  return (
                    <div key={cmp.id} className="inl xcard done">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                        <span className="tag">{cmp.kind}</span>
                        <span className="c3">{cmp.title}</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 14 }}>{cmp.description}</div>
                      <div className="mono" style={{ marginTop: 6 }}>{cmp.outcome_note}</div>
                    </div>
                  );
                }

                return (
                  <div key={cmp.id} className="inl xcard">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                      <span
                        className="tag"
                        style={
                          cmp.kind === '值得聊聊'
                            ? { background: 'none', boxShadow: 'inset 0 0 0 1px var(--page-ink-2)', color: 'var(--page-ink)' }
                            : undefined
                        }
                      >
                        {cmp.kind}
                      </span>
                      <span className="c3">{cmp.title}</span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 15, lineHeight: '24px' }}>
                      {cmp.description}
                    </div>

                    {explainingId === cmp.id ? (
                      <div style={{ marginTop: 12 }}>
                        <input
                          type="text"
                          value={explainText}
                          onChange={(e) => setExplainText(e.target.value)}
                          placeholder="比如：我能做，但做完很累，需要一个人待两天"
                          style={{
                            width: '100%',
                            height: 38,
                            border: '1px solid var(--page-accent)',
                            borderRadius: 8,
                            padding: '0 12px',
                            fontSize: 14,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn btn-p btn-sm"
                            onClick={() => handleAction(cmp.id, 'both_explain', explainText)}
                          >
                            发送看法
                          </button>
                          <button
                            type="button"
                            className="btn btn-t btn-sm"
                            onClick={() => setExplainingId(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        {cmp.kind === '吻合' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'agree')}
                            >
                              准
                            </button>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'disagree')}
                            >
                              不太像我
                            </button>
                          </>
                        )}
                        {cmp.kind === '值得聊聊' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'agree', '测评更准')}
                            >
                              测评更准
                            </button>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'disagree', '故事更准')}
                            >
                              故事更准
                            </button>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => setExplainingId(cmp.id)}
                            >
                              两个都对，我解释一下
                            </button>
                          </>
                        )}
                        {cmp.kind === '新发现' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'note_new')}
                            >
                              符合，先记下
                            </button>
                            <button
                              type="button"
                              className="btn btn-s btn-sm"
                              onClick={() => handleAction(cmp.id, 'disagree')}
                            >
                              不像我
                            </button>
                          </>
                        )}
                        {/* R2：每条对照都可以「先跳过」，不产生证据 */}
                        <button
                          type="button"
                          className="btn btn-t btn-sm"
                          onClick={() => handleAction(cmp.id, 'skip')}
                        >
                          先跳过
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {upgradedBanner && (
                <div
                  className="inl"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 16,
                    alignItems: 'center',
                    padding: 16,
                    borderRadius: 12,
                    border: '1px solid var(--page-accent)',
                    background: 'var(--page-accent-50)',
                  }}
                >
                  <Tally strokes={upgradedBanner.confidence?.tallyStrokes || []} large />
                  <div>
                    <b style={{ display: 'block', fontWeight: 500, fontSize: 15 }}>
                      「{upgradedBanner.user_statement || upgradedBanner.statement}」可以写进画像了
                    </b>
                    <span className="c2" style={{ fontSize: 13 }}>
                      3 条以上独立证据，已升级为「高」
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={() => onOpenClue(upgradedBanner.id)}
                  >
                    查看线索
                  </button>
                </div>
              )}

              {allCompleted && (
                <div className="inl card">
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
                    {assessment.instrument}对照完了
                  </h4>
                  {(assessment.skipped_items || []).length > 0 && (
                    <p className="mono" style={{ margin: '8px 0 0' }}>
                      未回应（已先跳过）：{assessment.skipped_items.join('、')}
                    </p>
                  )}

                  {/* R7：本次小结后询问是否删除测评原文件，且记住偏好 */}
                  {(askDeleteFile || assessment.raw_file_ref) && !fileDisposedMsg && (
                    <div
                      style={{
                        marginTop: 16,
                        paddingTop: 14,
                        borderTop: '1px solid var(--page-line)',
                      }}
                    >
                      <div style={{ fontSize: 14 }}>分数已经记下了。上传的原文件要保留吗？（选择会被记住，下次不再询问）</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn btn-s btn-sm"
                          onClick={async () => {
                            await onDisposeFile(true);
                            setAskDeleteFile(false);
                            setFileDisposedMsg('原文件已永久删除，只保留分数与对照结论');
                          }}
                        >
                          删除原文件
                        </button>
                        <button
                          type="button"
                          className="btn btn-t btn-sm"
                          onClick={async () => {
                            await onDisposeFile(false);
                            setAskDeleteFile(false);
                            setFileDisposedMsg('已按你的选择保留原文件');
                          }}
                        >
                          保留
                        </button>
                      </div>
                    </div>
                  )}

                  {fileDisposedMsg && (
                    <p className="mono" style={{ margin: '12px 0 0' }}>{fileDisposedMsg}</p>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="button" className="btn btn-p btn-sm" onClick={onGoHome}>
                      回首页看最新线索
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <aside className="disc desktop-only">
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>本次发现</h3>
        <div>
          <span className="mono" style={{ display: 'block', marginBottom: 8 }}>对照进度</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {comparisons.map((c: any) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--page-line)',
                  fontSize: 13,
                }}
              >
                <span>{c.kind} · {c.dimension}</span>
                <span className="mono">
                  {c.status === 'responded' ? '已回应' : c.status === 'skipped' ? '已跳过' : '待回应'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span className="mono">测评证据权重 0.5，是真实经历的一半</span>
      </aside>
    </div>
  );
}

// ==================== P2 主对话流视图（含全部内联卡片、流式思考、中断与抽屉） ====================
export function ConversationView({
  conversation,
  messages,
  streamingText,
  isStreaming,
  sendError,
  isOffline,
  state,
  valuesPool,
  activeAssessment,
  onSendMessage,
  onRetryFailed,
  onSwitchMode,
  onFinishSession,
  onCardAction,
  onValuesAction,
  onAssessmentRespond,
  onAssessmentDisposeFile,
  onOpenUploadModal,
  onOpenClue,
  onOpenStory,
  onOpenPortrait,
  onOpenHelpSettings,
  onBack,
}: {
  conversation: any;
  messages: any[];
  streamingText: string;
  isStreaming: boolean;
  sendError: { text: string; message: string } | null;
  isOffline: boolean;
  state: any;
  valuesPool: string[];
  activeAssessment: any;
  onSendMessage: (text: string, opts?: { skipLowTopic?: boolean }) => void;
  onRetryFailed: () => void;
  onSwitchMode: (mode: '高光' | '低谷' | '日常') => void;
  onFinishSession: () => void;
  onCardAction: (messageId: string, cardIndex: number, cardAction: string, payload?: any) => Promise<void>;
  onValuesAction: (payload: any) => Promise<any>;
  onAssessmentRespond: (comparisonId: string, action: string, userText?: string) => Promise<any>;
  onAssessmentDisposeFile: (deleteFile: boolean) => Promise<void>;
  onOpenUploadModal: () => void;
  onOpenClue: (clueId: string) => void;
  onOpenStory: (storyId: string) => void;
  onOpenPortrait: () => void;
  onOpenHelpSettings: () => void;
  onBack: () => void;
}) {
  const [draftText, setDraftText] = useState('');
  const [editingCardKey, setEditingCardKey] = useState<string | null>(null);
  const [editingCardValue, setEditingCardValue] = useState('');
  const [editingGoalFields, setEditingGoalFields] = useState<Record<string, any> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [foldExpanded, setFoldExpanded] = useState(false);
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, isStreaming]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const skill = conversation?.skill || '经历挖掘';
  const mode = conversation?.mode || '高光';
  const isSafetyPaused = Boolean(state.progress?.paused_by_safety);
  const isHighRisk = state.progress?.safety_level === 'high';

  const handleSend = () => {
    const text = draftText.trim();
    if (!text) return;
    setDraftText('');
    onSendMessage(text);
  };

  // 若当前技能是价值观澄清或测评解读，渲染专用交互流
  if (skill === '价值观澄清' && !isSafetyPaused) {
    return (
      <>
        <header className="hdr">
          <div className="l">
            <button type="button" className="tb mid-only" onClick={onBack} aria-label="返回">
              <ChevronLeft size={20} />
            </button>
            <h2>价值观澄清</h2>
            <span className="mono">选词 — 两难取舍 — 排序与定义</span>
          </div>
          <div className="l">
            <button type="button" className="btn btn-s btn-sm" onClick={onBack}>
              返回首页
            </button>
          </div>
        </header>
        <ValuesInteractiveStream
          state={state}
          valuesPool={valuesPool}
          onValuesAction={onValuesAction}
          onOpenUploadModal={onOpenUploadModal}
          onGoHome={onBack}
        />
      </>
    );
  }

  if (skill === '测评解读' && !isSafetyPaused) {
    const cmps = activeAssessment?.comparisons || [];
    const doneCnt = cmps.filter((c: any) => c.status !== 'pending').length;
    return (
      <>
        <header className="hdr">
          <div className="l">
            <button type="button" className="tb mid-only" onClick={onBack} aria-label="返回">
              <ChevronLeft size={20} />
            </button>
            <h2>测评解读</h2>
            {activeAssessment && <span className="mono">{activeAssessment.instrument}</span>}
          </div>
          <div className="l">
            {cmps.length > 0 && (
              <span className="mono">
                已回应 {doneCnt} / {cmps.length}
              </span>
            )}
            <button type="button" className="btn btn-s btn-sm" onClick={onBack}>
              结束本次
            </button>
          </div>
        </header>
        <AssessmentInteractiveStream
          assessment={activeAssessment}
          state={state}
          onRespondComparison={onAssessmentRespond}
          onDisposeFile={onAssessmentDisposeFile}
          onOpenUploadModal={onOpenUploadModal}
          onStartExampleStory={(p) => {
            onSwitchMode('日常');
            onSendMessage(p);
          }}
          onOpenClue={onOpenClue}
          onGoHome={onBack}
        />
      </>
    );
  }

  const discoveries = conversation?.discoveries || [];
  const starMap = conversation?.context?.star || {};
  const visibleMessages =
    !foldExpanded && messages.length > 10 ? messages.slice(messages.length - 8) : messages;
  const hiddenCount = messages.length - visibleMessages.length;

  const renderDiscoveryContent = () => {
    if (isSafetyPaused) {
      return (
        <>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>本次发现</h3>
          <p className="c2" style={{ margin: 0, fontSize: 13 }}>
            先不整理线索了。这段对话里的内容不会变成证据
          </p>
          <div className="safe-card mid" style={{ padding: '12px 14px' }}>
            <LifeBuoy size={16} />
            <div style={{ fontSize: 13 }}>
              求助资源
              <br />
              <button
                type="button"
                className="btn btn-t btn-sm"
                style={{ padding: 0 }}
                onClick={onOpenHelpSettings}
              >
                设置 · 求助资源
              </button>
            </div>
          </div>
        </>
      );
    }

    if (skill === '目标设定') {
      const stepNum = Number(conversation?.context?.step || 1);
      const labels = ['来意', '现在的处境', '期待的结果', '沟通偏好', '确认总结'];
      return (
        <>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>本次发现</h3>
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 8 }}>目标设定</span>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {labels.map((lab, idx) => {
                const done = stepNum > idx + 1;
                const cur = stepNum === idx + 1;
                return (
                  <li
                    key={lab}
                    style={{
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      borderBottom: '1px solid var(--page-line)',
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `1.5px solid ${done || cur ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                        background: done ? 'var(--page-accent)' : 'transparent',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {done && <Check size={10} color="#fff" strokeWidth={3} />}
                    </span>
                    <span>{lab}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <span className="mono">这一步只听和记录，不分析</span>
        </>
      );
    }

    return (
      <>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>本次发现</h3>
        {skill === '经历挖掘' && (
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 6 }}>这个故事</span>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
              {conversation?.title || `${mode}故事`}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {[
                ['situation', '情境'],
                ['task', '任务'],
                ['action', '行动'],
                ['result', '结果'],
                ['key_moment', mode === '低谷' ? '最难受的点' : '最投入的环节'],
              ].map(([k, lab]) => {
                const on = Boolean(starMap[k]);
                return (
                  <li
                    key={k}
                    style={{
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      borderBottom: '1px solid var(--page-line)',
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `1.5px solid ${on ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                        background: on ? 'var(--page-accent)' : 'transparent',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {on && <Check size={10} color="#fff" strokeWidth={3} />}
                    </span>
                    <span>{lab}</span>
                  </li>
                );
              })}
            </ul>
            {conversation?.story_id && (
              <button
                type="button"
                className="btn btn-t btn-sm"
                style={{ padding: 0, marginTop: 8 }}
                onClick={() => onOpenStory(conversation.story_id)}
              >
                打开故事详情
              </button>
            )}
          </div>
        )}

        <div>
          <span className="mono" style={{ display: 'block', marginBottom: 6 }}>线索变化</span>
          {discoveries.length === 0 ? (
            <div className="c3" style={{ fontSize: 13 }}>讲完关键细节后会自动提炼线索</div>
          ) : (
            discoveries.map((d: any, idx: number) => {
              const liveClue = (state.clues || []).find((c: any) => c.id === d.clue_id);
              return (
                <div
                  key={idx}
                  onClick={() => d.clue_id && onOpenClue(d.clue_id)}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--page-line)',
                    cursor: d.clue_id ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontSize: 13 }}>
                    {liveClue ? liveClue.user_statement || liveClue.statement : d.statement}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    {liveClue && <Tally strokes={liveClue.confidence.tallyStrokes} />}
                    {d.pending && (!liveClue || liveClue.user_stance === '未回应') ? (
                      <span className="tag dash">等你回应</span>
                    ) : (
                      <span className="mono">
                        {liveClue ? liveClue.confidence.level : d.delta_label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <span className="mono">随时可以离开，回来从这里继续</span>
      </>
    );
  };

  return (
    <>
      <header className="hdr">
        <div className="l">
          <button type="button" className="tb mid-only" onClick={onBack} aria-label="返回">
            <ChevronLeft size={20} />
          </button>
          <h2>{isHighRisk ? '对话' : skill}</h2>
          {isSafetyPaused && !isHighRisk && <span className="tag">已暂停</span>}
          {skill === '经历挖掘' && !isSafetyPaused && (
            <span
              style={{
                display: 'inline-flex',
                background: 'var(--page-raised)',
                borderRadius: 8,
                padding: 2,
                gap: 2,
              }}
            >
              {(['高光', '低谷', '日常'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSwitchMode(m)}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    border: 0,
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                    background: mode === m ? 'var(--page-surface)' : 'transparent',
                    color: mode === m ? 'var(--page-ink)' : 'var(--page-ink-2)',
                    boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,.05)' : 'none',
                  }}
                >
                  {m}
                </button>
              ))}
            </span>
          )}
        </div>

        <div className="l">
          {!isHighRisk && (
            <button
              type="button"
              className="btn btn-s btn-sm mid-only"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelRight size={15} />
              <span>本次发现</span>
              <span className="mono">{discoveries.length}</span>
            </button>
          )}
          {conversation?.status !== '已结束' && !isHighRisk && skill === '经历挖掘' && (
            <button type="button" className="btn btn-s btn-sm" onClick={onFinishSession}>
              结束本次
            </button>
          )}
        </div>
      </header>

      {isOffline && (
        <div className="offline-bar">
          <WifiOff size={15} />
          <span>网络断开了，正在重新连接 · 你输入的内容会保留</span>
        </div>
      )}

      <div
        className="cv-body"
        style={isHighRisk ? { gridTemplateColumns: '1fr' } : undefined}
      >
        <div className="cv-col" style={isHighRisk ? { borderRight: 0 } : undefined}>
          <div className="stream">
            {hiddenCount > 0 && (
              <button
                type="button"
                className="btn-t"
                style={{ alignSelf: 'flex-start', fontSize: 13 }}
                onClick={() => setFoldExpanded(true)}
              >
                前面 {hiddenCount} 条消息 · 展开
              </button>
            )}

            {visibleMessages.map((msg: any, mIdx: number) => {
              const showResumeRule =
                mIdx === visibleMessages.length - 2 &&
                visibleMessages.length >= 4 &&
                conversation?.status === '进行中' &&
                hiddenCount > 0;

              return (
                <React.Fragment key={msg.id}>
                  {showResumeRule && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="mono">上次聊到这里</span>
                      <i style={{ flex: 1, height: 1, background: 'var(--page-line)' }} />
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <div className="mine">{msg.content}</div>
                  ) : (
                    <>
                      {msg.content && (
                        <div className="coach">
                          <CoachMark />
                          <p>{msg.content}</p>
                        </div>
                      )}

                      {/* 渲染全部内联组件状态 */}
                      {(msg.inline_cards || []).map((card: any, cIdx: number) => {
                        const cardKey = `${msg.id}_${cIdx}`;

                        // 1) 线索提炼卡（5 个状态：待回应 / 已认同 / 改写中 / 已改写 / 已否认）
                        if (card.type === 'clue_card') {
                          if (editingCardKey === cardKey) {
                            return (
                              <div key={cardKey} className="inl xcard">
                                <div className="mono">改成你觉得准的说法</div>
                                <input
                                  type="text"
                                  value={editingCardValue}
                                  onChange={(e) => setEditingCardValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && editingCardValue.trim()) {
                                      onCardAction(msg.id, cIdx, 'rewrite', {
                                        statement: editingCardValue.trim(),
                                      });
                                      setEditingCardKey(null);
                                    }
                                  }}
                                  style={{
                                    width: '100%',
                                    border: '1px solid var(--page-accent)',
                                    borderRadius: 8,
                                    padding: '8px 12px',
                                    fontSize: 15,
                                    marginTop: 8,
                                    boxShadow: '0 0 0 3px var(--page-accent-50)',
                                  }}
                                />
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button
                                    type="button"
                                    className="btn btn-p btn-sm"
                                    onClick={() => {
                                      if (!editingCardValue.trim()) return;
                                      onCardAction(msg.id, cIdx, 'rewrite', {
                                        statement: editingCardValue.trim(),
                                      });
                                      setEditingCardKey(null);
                                    }}
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-t btn-sm"
                                    onClick={() => setEditingCardKey(null)}
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          if (card.status === 'agreed' || card.status === 'rewritten') {
                            return (
                              <div
                                key={cardKey}
                                className="inl xcard done"
                                style={{ cursor: 'pointer' }}
                                onClick={() => onOpenClue(card.clueId)}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--page-ink-3)' }}>
                                  <Tally strokes={card.tally || [{ kind: 'strong' }]} />
                                  <span>
                                    已记下 ·{' '}
                                    {card.status === 'rewritten' ? (
                                      <span className="tag" style={{ height: 18 }}>你修改过</span>
                                    ) : (
                                      '你认同'
                                    )}
                                  </span>
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
                                  {card.statement}
                                </div>
                              </div>
                            );
                          }

                          if (card.status === 'denied') {
                            return (
                              <div key={cardKey} className="inl xcard done">
                                <div className="mono">
                                  {card.archived ? '这条我不再提了（已归档）' : '先不记这条'}
                                </div>
                                <div className="c3" style={{ fontSize: 14, marginTop: 4 }}>
                                  {card.statement}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={cardKey} className="inl xcard">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--page-ink-3)' }}>
                                <Tally strokes={card.tally || [{ kind: 'strong' }]} />
                                <span>
                                  新线索 · {card.clueType} · {card.dimension}
                                </span>
                              </div>
                              <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500, margin: '8px 0 4px' }}>
                                {card.statement}
                              </div>
                              <div className="c2" style={{ fontSize: 13 }}>
                                依据：{card.rationale}
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button
                                  type="button"
                                  className="btn btn-s btn-sm"
                                  onClick={() => onCardAction(msg.id, cIdx, 'agree')}
                                >
                                  准
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-s btn-sm"
                                  onClick={() => {
                                    setEditingCardKey(cardKey);
                                    setEditingCardValue(card.statement);
                                  }}
                                >
                                  部分准，我改一下
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-t btn-sm"
                                  onClick={() => onCardAction(msg.id, cIdx, 'deny')}
                                >
                                  不准
                                </button>
                              </div>
                            </div>
                          );
                        }

                        // 2) 合并提示卡（自动合并 vs 询问合并）
                        if (card.type === 'merge_notice') {
                          if (card.mode === 'ask' && card.status === 'pending') {
                            return (
                              <div key={cardKey} className="inl xcard">
                                <div className="c2" style={{ fontSize: 13 }}>
                                  这次说的「{card.candidateStatement}」，和
                                  <b style={{ color: 'var(--page-ink)', fontWeight: 500 }}>
                                    「{card.targetStatement}」
                                  </b>
                                  很像，要并在一起吗
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                  <button
                                    type="button"
                                    className="btn btn-s btn-sm"
                                    onClick={() => onCardAction(msg.id, cIdx, 'merge')}
                                  >
                                    并在一起
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-s btn-sm"
                                    onClick={() => onCardAction(msg.id, cIdx, 'separate')}
                                  >
                                    分开记
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={cardKey}
                              className="inl"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '12px 16px',
                                borderRadius: 12,
                                background: 'var(--page-surface)',
                                border: '1px solid var(--page-line)',
                              }}
                            >
                              <Tally strokes={card.tally || [{ kind: 'strong' }, { kind: 'medium', isNew: true }]} />
                              <div style={{ flex: 1, fontSize: 13, color: 'var(--page-ink-2)' }}>
                                <b style={{ color: 'var(--page-ink)', fontWeight: 500 }}>
                                  {card.statement || card.targetStatement}
                                </b>
                                <br />
                                {card.status === 'separated'
                                  ? '已分开单独记录并标记相关'
                                  : `这已经是第 ${card.count || 2} 次出现了，记为新证据`}
                              </div>
                              {card.clueId && (
                                <button
                                  type="button"
                                  className="btn btn-t btn-sm"
                                  onClick={() => onOpenClue(card.clueId)}
                                >
                                  查看线索
                                </button>
                              )}
                            </div>
                          );
                        }

                        // 3) 等级变化卡（升级 / 降级）
                        if (card.type === 'level_change') {
                          const isUp = card.direction === 'up';
                          return (
                            <div
                              key={cardKey}
                              className="inl"
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr auto',
                                gap: 16,
                                alignItems: 'center',
                                padding: 16,
                                borderRadius: 12,
                                border: `1px solid ${isUp ? 'var(--page-accent)' : 'var(--page-line)'}`,
                                background: isUp ? 'var(--page-accent-50)' : 'var(--page-surface)',
                              }}
                            >
                              <Tally strokes={card.tally || []} large />
                              <div>
                                <b style={{ display: 'block', fontWeight: 500, fontSize: 15 }}>
                                  「{card.statement}」{isUp ? '可以写进画像了' : '先往后放'}
                                </b>
                                <span className="c2" style={{ fontSize: 13 }}>{card.detail}</span>
                              </div>
                              {card.clueId && (
                                <button
                                  type="button"
                                  className="btn btn-s btn-sm"
                                  onClick={() => onOpenClue(card.clueId)}
                                >
                                  查看线索
                                </button>
                              )}
                            </div>
                          );
                        }

                        // 4) 目标设定：4 个期待结果选项卡
                        if (card.type === 'goal_options') {
                          return (
                            <div key={cardKey} className="inl">
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {(card.options || []).map((opt: string) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => onSendMessage(opt)}
                                    style={{
                                      textAlign: 'left',
                                      padding: '12px 14px',
                                      borderRadius: 12,
                                      border: '1px solid var(--page-line-2)',
                                      background: 'var(--page-surface)',
                                      fontSize: 14,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                              <span className="mono" style={{ display: 'block', marginTop: 8 }}>
                                点击选择，也可以在下方直接输入你自己的想法
                              </span>
                            </div>
                          );
                        }

                        // 5) 目标设定：可逐行原地编辑的确认总结卡
                        if (card.type === 'goal_summary') {
                          const fields = editingGoalFields || card.fields || {};
                          const isConfirmed = card.status === 'confirmed';

                          return (
                            <div key={cardKey} className="inl xcard">
                              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 28px', gap: '10px 12px', alignItems: 'center' }}>
                                {[
                                  ['reason', '现在'],
                                  ['current_puzzle', '眼前的选择'],
                                  ['goal', '想得到'],
                                  ['comm_label', '沟通方式'],
                                ].map(([fieldKey, label]) => (
                                  <React.Fragment key={fieldKey}>
                                    <span className="mono">{label}</span>
                                    {editingGoalFields && !isConfirmed ? (
                                      <input
                                        type="text"
                                        value={fields[fieldKey] || ''}
                                        onChange={(e) =>
                                          setEditingGoalFields({
                                            ...fields,
                                            [fieldKey]: e.target.value,
                                          })
                                        }
                                        style={{
                                          height: 32,
                                          border: '1px solid var(--page-line-2)',
                                          borderRadius: 6,
                                          padding: '0 8px',
                                          fontSize: 14,
                                        }}
                                      />
                                    ) : (
                                      <span style={{ fontSize: 14 }}>{fields[fieldKey]}</span>
                                    )}
                                    {!isConfirmed ? (
                                      <button
                                        type="button"
                                        className="tb"
                                        onClick={() => setEditingGoalFields({ ...fields })}
                                        aria-label="编辑"
                                      >
                                        <Pencil size={14} />
                                      </button>
                                    ) : (
                                      <span />
                                    )}
                                  </React.Fragment>
                                ))}
                              </div>

                              {!isConfirmed ? (
                                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                  <button
                                    type="button"
                                    className="btn btn-p btn-sm"
                                    onClick={async () => {
                                      await onCardAction(msg.id, cIdx, 'confirm', { fields });
                                      setEditingGoalFields(null);
                                      onBack();
                                    }}
                                  >
                                    对，开始
                                  </button>
                                  {!editingGoalFields && (
                                    <button
                                      type="button"
                                      className="btn btn-s btn-sm"
                                      onClick={() => setEditingGoalFields({ ...fields })}
                                    >
                                      有一条要改
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="mono" style={{ marginTop: 10 }}>已确认并建立探索档案</div>
                              )}
                            </div>
                          );
                        }

                        // 6) 快捷回复组（最多 3 个）
                        if (card.type === 'quick_replies') {
                          return (
                            <div key={cardKey} className="inl" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {(card.options || []).slice(0, 3).map((opt: string) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => {
                                    if (opt === '今天先到这里') onBack();
                                    else if (opt === '结束本次并看小结') onFinishSession();
                                    else onSendMessage(opt);
                                  }}
                                  style={{
                                    height: 32,
                                    padding: '0 12px',
                                    borderRadius: 8,
                                    border: '1px solid var(--page-line-2)',
                                    background: 'var(--page-surface)',
                                    fontSize: 13,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          );
                        }

                        // 7) 能量打卡内联选分条与完成小结
                        if (card.type === 'energy_score_picker') {
                          return (
                            <div key={cardKey} className="inl">
                              <div className="seg10">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => onSendMessage(String(n))}
                                  >
                                    {n}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        if (card.type === 'checkin_summary') {
                          return (
                            <div key={cardKey} className="inl xcard">
                              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                                第 {card.totalDays} 天
                              </h4>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr',
                                  margin: '12px 0',
                                  padding: '10px 0',
                                  borderTop: '1px solid var(--page-line)',
                                  borderBottom: '1px solid var(--page-line)',
                                }}
                              >
                                <div>
                                  <b className="mono" style={{ fontSize: 22, color: 'var(--page-ink)' }}>
                                    {card.todayScore}
                                  </b>
                                  <span className="mono" style={{ display: 'block' }}>今天</span>
                                </div>
                                <div>
                                  <b className="mono" style={{ fontSize: 22, color: 'var(--page-ink)' }}>
                                    {card.totalDays} / {card.targetDays}
                                  </b>
                                  <span className="mono" style={{ display: 'block' }}>已记录</span>
                                </div>
                              </div>
                              <div className="mono">满 14 天后会生成第一份能量周报（V1）</div>
                              <button
                                type="button"
                                className="btn btn-s btn-sm"
                                style={{ marginTop: 12 }}
                                onClick={onBack}
                              >
                                回首页
                              </button>
                            </div>
                          );
                        }

                        // 8) 安全守护中/高风险卡片
                        if (card.type === 'safety_card') {
                          const hi = card.level === 'high';
                          return (
                            <div key={cardKey} className={`inl safe-card ${hi ? 'hi' : 'mid'}`}>
                              {hi ? <Phone size={18} color="var(--page-neg)" /> : <Pause size={18} />}
                              <div>
                                <div className="h">{card.headline}</div>
                                <div>{card.body}</div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                                  {hi ? (
                                    <>
                                      <a
                                        href={`tel:${card.hotlineNumber}`}
                                        className="btn btn-neg btn-sm"
                                      >
                                        拨打危机干预热线（{card.hotlineNumber}）
                                      </a>
                                      {!card.acknowledgedSafe && (
                                        <button
                                          type="button"
                                          className="btn btn-s btn-sm"
                                          onClick={() => onCardAction(msg.id, cIdx, 'ack_safe')}
                                        >
                                          我现在是安全的
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-s btn-sm"
                                      onClick={onOpenHelpSettings}
                                    >
                                      帮我找咨询渠道
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // 9) 本次小结卡（P2.2 本次结束画板）
                        if (card.type === 'session_summary') {
                          return (
                            <div key={cardKey} className="inl card" style={{ maxWidth: 600 }}>
                              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>这次聊出来的</h4>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(3, 1fr)',
                                  margin: '16px 0',
                                  borderTop: '1px solid var(--page-line)',
                                  borderBottom: '1px solid var(--page-line)',
                                }}
                              >
                                <div style={{ padding: '12px 0' }}>
                                  <b className="mono" style={{ fontSize: 22, color: 'var(--page-ink)', display: 'block' }}>
                                    {card.newStories}
                                  </b>
                                  <span className="mono">新故事</span>
                                </div>
                                <div style={{ padding: '12px 0' }}>
                                  <b className="mono" style={{ fontSize: 22, color: 'var(--page-ink)', display: 'block' }}>
                                    {card.newClues}
                                  </b>
                                  <span className="mono">涉及线索</span>
                                </div>
                                <div style={{ padding: '12px 0' }}>
                                  <b className="mono" style={{ fontSize: 22, color: 'var(--page-ink)', display: 'block' }}>
                                    {card.newEvidence}
                                  </b>
                                  <span className="mono">新证据</span>
                                </div>
                              </div>

                              {(card.items || []).map((it: any, idx: number) => (
                                <div
                                  key={idx}
                                  onClick={() => it.clueId && onOpenClue(it.clueId)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '8px 0',
                                    fontSize: 14,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <Tally strokes={it.tally || []} />
                                  <span style={{ flex: 1 }}>{it.statement}</span>
                                  <span className="mono">{it.level}</span>
                                </div>
                              ))}

                              <div
                                style={{
                                  marginTop: 12,
                                  paddingTop: 16,
                                  borderTop: '1px solid var(--page-line)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 16,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <div>
                                  <b style={{ display: 'block', fontWeight: 500, fontSize: 14 }}>
                                    建议下一步：{card.nextTitle}
                                  </b>
                                  <span className="c2" style={{ fontSize: 13 }}>{card.nextReason}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button
                                    type="button"
                                    className="btn btn-p btn-sm"
                                    onClick={() => {
                                      if (card.nextAction === 'story_low') onSwitchMode('低谷');
                                      else if (card.nextAction === 'portrait') onOpenPortrait();
                                      else if (card.nextAction === 'assessment') onOpenUploadModal();
                                      else onSwitchMode('高光');
                                    }}
                                  >
                                    继续下一步
                                  </button>
                                  <button type="button" className="btn btn-s btn-sm" onClick={onBack}>
                                    回首页
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })}
                    </>
                  )}
                </React.Fragment>
              );
            })}

            {/* 流式输出或三道刻痕思考态（绝不显示“正在输入…”文字） */}
            {isStreaming && (
              <div className={`coach${streamingText ? '' : ' thinking'}`}>
                <CoachMark />
                <p>{streamingText || '\u3000'}</p>
              </div>
            )}

            {/* 发送失败 / 生成失败重试状态（保留用户原文不清空） */}
            {sendError && (
              <div>
                <div className="mine" style={{ marginLeft: 'auto' }}>{sendError.text}</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    justifyContent: 'flex-end',
                    marginTop: 6,
                    fontSize: 12,
                    color: 'var(--page-ink-2)',
                  }}
                >
                  <CircleAlert size={14} />
                  <span>{sendError.message || '我刚才没想好，再试一次'}</span>
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={onRetryFailed}
                  >
                    <RotateCw size={13} /> 重试
                  </button>
                </div>
              </div>
            )}

            <div ref={streamEndRef} />
          </div>

          {/* 底部输入区（含高风险常驻热线条、中风险暂停条、低谷常驻跳过按钮） */}
          <div className="dock">
            <div className="in">
              {isHighRisk && (
                <div className="pinbar">
                  <Phone size={15} color="var(--page-neg)" />
                  <span style={{ flex: 1 }}>心理危机干预热线 · 12356（24 小时）</span>
                  <a href="tel:12356" className="btn btn-neg btn-sm">
                    拨打
                  </a>
                </div>
              )}

              {isSafetyPaused && !isHighRisk && (
                <div className="pausebar">
                  <Pause size={15} />
                  <span>探索已暂停。你可以继续和我说话，我会陪着你，但不会再问故事</span>
                </div>
              )}

              {skill === '经历挖掘' && mode === '低谷' && !isSafetyPaused && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-t btn-sm"
                    style={{ padding: 0 }}
                    onClick={() => onSendMessage('跳过这个话题', { skipLowTopic: true })}
                  >
                    <CornerUpRight size={14} /> 跳过这个话题
                  </button>
                  <span className="mono">低谷模式</span>
                </div>
              )}

              <div className="comp">
                <textarea
                  rows={1}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    isSafetyPaused
                      ? '想说什么都可以'
                      : conversation?.status === '已结束'
                        ? '这次已经结束。想补充什么，可以接着说'
                        : '回答，或者直接点上面的按钮'
                  }
                />
                <div className="tools">
                  <button
                    type="button"
                    className="tb"
                    onClick={onOpenUploadModal}
                    title="上传测评报告"
                  >
                    <Paperclip size={16} />
                  </button>
                  <VoiceMicButton onTranscript={(t) => setDraftText((prev) => `${prev}${t}`)} />
                  <button
                    type="button"
                    className={`ibtn${!draftText.trim() ? ' off' : ''}`}
                    disabled={!draftText.trim()}
                    onClick={handleSend}
                    aria-label="发送"
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span className="mono">Enter 发送 · Shift + Enter 换行</span>
                <span className="mono">自动保存</span>
              </div>
            </div>
          </div>
        </div>

        {!isHighRisk && (
          <aside className="disc desktop-only">{renderDiscoveryContent()}</aside>
        )}
      </div>

      {/* 中屏右侧抽屉 / 移动底部抽屉（本次发现） */}
      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          {window.innerWidth < 768 ? (
            <div className="bottom-sheet">
              <div className="grab" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {renderDiscoveryContent()}
              </div>
            </div>
          ) : (
            <div className="right-drawer">
              <div className="disc" style={{ background: 'var(--page-surface)', minHeight: '100%' }}>
                {renderDiscoveryContent()}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
