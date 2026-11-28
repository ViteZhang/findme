import React, { useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronRight,
  Clock,
  CornerDownRight,
  Paperclip,
} from 'lucide-react';
import { GateBars, Tally, VoiceMicButton } from '../components/Primitives.tsx';

export type HomeStateKind = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

export function computeHomeStateKind(state: any): HomeStateKind {
  if (state.progress?.paused_by_safety) return 'S6';

  const pendingPortrait = (state.portraits || []).find(
    (p: any) => p.status === '待确认' || (p.status === '草稿' && p.flow_step >= 1),
  );
  if (pendingPortrait && pendingPortrait.status === '待确认') {
    return 'S4';
  }

  const finalizedPortrait = (state.portraits || []).find((p: any) => p.status === '已定稿');
  if (finalizedPortrait) {
    return 'S5';
  }

  if (state.eligibility?.eligible) {
    return 'S3';
  }

  const activeClues = (state.clues || []).filter(
    (c: any) => c.confidence?.level !== '已归档' && c.type !== '不一致',
  );
  if ((state.stories || []).length === 0 && activeClues.length === 0) {
    return 'S1';
  }

  return 'S2';
}

export function HomeView({
  state,
  onStartChat,
  onOpenClue,
  onOpenAllClues,
  onOpenUploadModal,
  onOpenValues,
  onOpenPortrait,
  onQuickEnergyScore,
  onDismissNudge,
  onOpenSettingsTab,
  onOpenAllStories,
}: {
  state: any;
  onStartChat: (opts?: { starterPrompt?: string; mode?: '高光' | '低谷' | '日常'; focusClueId?: string; conversationId?: string }) => void;
  onOpenClue: (clueId: string) => void;
  onOpenAllClues: () => void;
  onOpenUploadModal: () => void;
  onOpenValues: () => void;
  onOpenPortrait: (startGenerate?: boolean) => void;
  onQuickEnergyScore: (score: number) => void;
  onDismissNudge: () => void;
  onOpenSettingsTab: (tab: 'profile' | 'reminder' | 'privacy' | 'help') => void;
  onOpenAllStories: () => void;
}) {
  const [composerText, setComposerText] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const homeKind = computeHomeStateKind(state);
  const todayStr = new Date().toISOString().slice(0, 10);
  const createdAtDate = state.profile?.created_at ? new Date(state.profile.created_at) : new Date();
  const dayNumber = Math.max(
    1,
    Math.floor((Date.now() - createdAtDate.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );

  const activeClues = (state.clues || []).filter(
    (c: any) => c.confidence?.level !== '已归档' && c.type !== '不一致',
  );
  const highClues = state.eligibility?.highClues || [];
  const heroClue =
    (state.eligibility?.closestClues?.[0]
      ? activeClues.find((c: any) => c.id === state.eligibility.closestClues[0].id)
      : null) || activeClues[0];

  const todayEnergy = (state.energyLogs || []).find(
    (l: any) => String(l.log_date || '').slice(0, 10) === todayStr,
  );

  // 检查是否连续 3 天未打卡（有历史打卡但最近 3 天都没有，且未关闭提示）
  const lastLogDate = state.energyLogs?.[0]?.log_date;
  const daysSinceLastLog = lastLogDate
    ? Math.floor((Date.now() - new Date(lastLogDate).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const nudgeDismissed =
    state.progress?.dismissed_reminder_nudge_until &&
    new Date(state.progress.dismissed_reminder_nudge_until).getTime() > Date.now();
  const showReminderNudge =
    (state.energyLogs || []).length > 0 && daysSinceLastLog >= 3 && !nudgeDismissed;

  const submitQuickChat = () => {
    if (!composerText.trim()) return;
    const text = composerText.trim();
    setComposerText('');
    onStartChat({ starterPrompt: text });
  };

  const nicknameInitial = (state.profile?.nickname || 'W').slice(0, 1).toUpperCase();

  // ==================== S6 安全暂停状态（不显示线索、进度、打卡，只留关心 + 求助资源 + 输入框） ====================
  if (homeKind === 'S6') {
    return (
      <>
        <header className="hdr">
          <h2>首页</h2>
          <span className="mono">
            第 {dayNumber} 天 · {todayStr}
          </span>
        </header>
        <div className="home-wrap" style={{ paddingTop: 72 }}>
          <div style={{ maxWidth: 640 }}>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: '42px', fontWeight: 500 }}>
              上次聊得不轻松。今天不用讲故事，想说什么都可以
            </h1>
            <p className="c2" style={{ margin: '16px 0 0', fontSize: 16, lineHeight: '26px' }}>
              探索先暂停着。等你觉得好一些了，告诉我，我们再接着来。线索和故事都还在，不会丢
            </p>

            <div className="comp" style={{ marginTop: 32 }}>
              <textarea
                rows={1}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuickChat();
                  }
                }}
                placeholder="今天感觉怎么样"
              />
              <div className="tools">
                <VoiceMicButton onTranscript={(t) => setComposerText((prev) => `${prev}${t}`)} />
                <button
                  type="button"
                  className={`ibtn${!composerText.trim() ? ' off' : ''}`}
                  disabled={!composerText.trim()}
                  onClick={submitQuickChat}
                  aria-label="发送"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>

            <div style={{ marginTop: 32, borderTop: '1px solid var(--page-line)' }}>
              <button
                type="button"
                onClick={() => onOpenSettingsTab('help')}
                style={{
                  width: '100%',
                  border: 0,
                  background: 'none',
                  borderBottom: '1px solid var(--page-line)',
                  height: 56,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                <span>当地心理危机干预热线</span>
                <ChevronRight size={16} color="var(--page-ink-3)" />
              </button>
              <button
                type="button"
                onClick={() => onOpenSettingsTab('help')}
                style={{
                  width: '100%',
                  border: 0,
                  background: 'none',
                  borderBottom: '1px solid var(--page-line)',
                  height: 56,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                <span>怎么找一位心理咨询师</span>
                <ChevronRight size={16} color="var(--page-ink-3)" />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const pendingPortrait = (state.portraits || []).find((p: any) => p.status === '待确认');
  const finalizedPortrait = (state.portraits || []).find((p: any) => p.status === '已定稿');
  const confirmedSectionCount = pendingPortrait
    ? Object.keys(pendingPortrait.section_confirmations || {}).length
    : 0;
  const remainingSections = 8 - confirmedSectionCount;

  const hStories = state.progress?.counters?.highlight_stories || 0;
  const lStories = state.progress?.counters?.low_stories || 0;
  const valuesDone = state.progress?.modules?.values?.status === 'completed';
  const totalStories = (state.stories || []).length;
  const progressDoneCount =
    (state.progress?.modules?.goal_setup?.status === 'completed' ? 1 : 0) +
    (hStories >= 3 && lStories >= 2 ? 1 : 0) +
    (valuesDone ? 1 : 0) +
    ((state.assessments || []).some((a: any) => a.counts_as_evidence) ? 1 : 0) +
    (finalizedPortrait ? 1 : 0);

  return (
    <>
      <header className="hdr">
        <h2>首页</h2>
        <div className="l">
          <span className="mono">
            第 {dayNumber} 天 · {todayStr}
          </span>
          {/* 移动端右上角头像入口：进入全部故事与设置 */}
          <div style={{ position: 'relative' }} className="mid-only">
            <button
              type="button"
              className="av"
              style={{ border: 0, cursor: 'pointer' }}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="个人菜单"
            >
              {nicknameInitial}
            </button>
            {mobileMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 32,
                  width: 160,
                  background: 'var(--page-surface)',
                  border: '1px solid var(--page-line-2)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,.08)',
                  padding: 6,
                  zIndex: 30,
                }}
              >
                <button
                  type="button"
                  className="btn-t"
                  style={{ width: '100%', justifyContent: 'flex-start', padding: '0 10px' }}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAllStories();
                  }}
                >
                  全部故事（{totalStories}）
                </button>
                <button
                  type="button"
                  className="btn-t"
                  style={{ width: '100%', justifyContent: 'flex-start', padding: '0 10px' }}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenSettingsTab('profile');
                  }}
                >
                  设置与隐私
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="home-wrap">
        {showReminderNudge && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              borderRadius: 12,
              background: 'var(--page-raised)',
              fontSize: 13,
              color: 'var(--page-ink-2)',
            }}
          >
            <Clock size={16} />
            <span style={{ flex: 1 }}>最近 {daysSinceLastLog} 天没打卡，要不要换个提醒时间？</span>
            <button
              type="button"
              className="btn btn-t btn-sm"
              onClick={() => onOpenSettingsTab('reminder')}
            >
              换时间
            </button>
            <button type="button" className="btn btn-t btn-sm" onClick={onDismissNudge}>
              先不用
            </button>
          </div>
        )}

        {/* ==================== 顶部主视觉区（S1 / S2 / S3 / S4 / S5） ==================== */}
        <div className="hero-grid">
          <div>
            {homeKind === 'S1' && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="tag">目标：{state.profile?.goal || '探索优劣势'}</span>
                </div>
                <h1>从一件让你觉得「这才是我」的事开始</h1>
                <p className="lead">
                  不用想得很完整，先说个大概，我会一点点问细节。每个故事 10–15 分钟，讲完你会看到第一条线索。
                </p>
              </>
            )}

            {homeKind === 'S2' && heroClue && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="tag">{heroClue.type}</span>
                  <span className="mono">离写进画像最近的一条</span>
                </div>
                <h1>
                  「
                  {(heroClue.user_statement || heroClue.statement).length > 14
                    ? `${(heroClue.user_statement || heroClue.statement).slice(0, 14)}…`
                    : heroClue.user_statement || heroClue.statement}
                  」这条线索，
                  {heroClue.confidence.S < 2 ? '只差一条别处来的证据' : '再补一步就能写进画像'}
                </h1>
                <p className="lead">{heroClue.confidence.next_needed}。</p>
              </>
            )}

            {homeKind === 'S3' && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="tag ok">画像</span>
                  <span className="mono">第一版的条件都满足了</span>
                </div>
                <h1>{highClues.length} 条线索已经到「高」，可以生成你的第一版画像</h1>
                <p className="lead">
                  最新达标的是「{highClues[highClues.length - 1]?.statement}」。生成前我会先请你过目合并，再逐节确认。
                </p>
              </>
            )}

            {homeKind === 'S4' && pendingPortrait && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="tag">画像 v{pendingPortrait.version}</span>
                </div>
                <h1>
                  你的第 {pendingPortrait.version} 版画像整理好了，还有 {remainingSections} 节等你看
                </h1>
                <p className="lead">每节 1 分钟左右，可以分几次看完，你修改过的地方都会保留标记。</p>
              </>
            )}

            {homeKind === 'S5' && finalizedPortrait && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="tag">画像 v{finalizedPortrait.version}</span>
                  <span className="mono">
                    {String(finalizedPortrait.confirmed_at || finalizedPortrait.generated_at).slice(5, 10)} 定稿
                  </span>
                </div>
                <h1>{finalizedPortrait.headline || `个人优劣势画像 v${finalizedPortrait.version}`}</h1>
                <p className="lead">
                  这是目前证据最充分的样子。你可以随时继续讲新故事，攒够新的变化后更新为下一版。
                </p>
              </>
            )}

            {/* 首页快捷输入框 */}
            <div className="comp" style={{ marginTop: 32 }}>
              <textarea
                rows={2}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuickChat();
                  }
                }}
                placeholder={
                  homeKind === 'S1'
                    ? '比如：大学时组织过一个活动……'
                    : '或者说说今天想聊的'
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
                <VoiceMicButton onTranscript={(t) => setComposerText((prev) => `${prev}${t}`)} />
                <button
                  type="button"
                  className={`ibtn${!composerText.trim() ? ' off' : ''}`}
                  disabled={!composerText.trim()}
                  onClick={submitQuickChat}
                  aria-label="发送"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>

            {state.progress?.last_session?.story_title && homeKind !== 'S1' && (
              <div
                onClick={() =>
                  onStartChat({ conversationId: state.progress.last_session.conversation_id })
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 16,
                  fontSize: 13,
                  color: 'var(--page-ink-2)',
                  cursor: 'pointer',
                }}
              >
                <CornerDownRight size={15} />
                <span>
                  上次聊到{' '}
                  <b style={{ fontWeight: 500, color: 'var(--page-ink)' }}>
                    {state.progress.last_session.story_title}
                  </b>
                </span>
                <span className="mono">
                  {state.progress.last_session.date}
                  {state.progress.last_session.story_mode
                    ? ` · ${state.progress.last_session.story_mode}`
                    : ''}
                </span>
              </div>
            )}
          </div>

          {/* 右侧主卡片区 */}
          <div>
            {homeKind === 'S1' && (
              <div className="card">
                <span className="mono">想不起来的话，可以从这些开始</span>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: '12px 0 0',
                    padding: 0,
                    borderTop: '1px solid var(--page-line)',
                  }}
                >
                  {[
                    [
                      '一次熬夜也不觉得累的经历',
                      '投入到忘了时间的事，往往藏着优势',
                      '我想聊聊一次熬夜也不觉得累的经历：',
                    ],
                    [
                      '别人特意来找你帮忙的一件事',
                      '别人想到你，说明你做这件事让人放心',
                      '有一次别人特意来找我帮忙：',
                    ],
                    [
                      '做完之后很想再来一次的事',
                      '做完还想做，比做得好更说明问题',
                      '有一件事我做完之后很想再来一次：',
                    ],
                  ].map(([title, desc, starter]) => (
                    <li
                      key={title}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 16,
                        alignItems: 'center',
                        padding: '14px 0',
                        borderBottom: '1px solid var(--page-line)',
                      }}
                    >
                      <div>
                        <b style={{ display: 'block', fontWeight: 500, fontSize: 15, lineHeight: '24px' }}>
                          {title}
                        </b>
                        <span className="c2" style={{ fontSize: 13 }}>
                          {desc}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-s btn-sm"
                        onClick={() => setComposerText(starter)}
                      >
                        用这个开头
                      </button>
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, paddingTop: 20 }}>
                  <Tally strokes={[{ kind: 'slot' }, { kind: 'slot' }, { kind: 'slot' }]} large />
                  <p className="c2" style={{ margin: 0, fontSize: 13, lineHeight: '20px' }}>
                    每条证据会在这里画一笔。同一个特点出现在不同的故事和来源里，笔画多起来，它才会写进你的画像
                  </p>
                </div>
              </div>
            )}

            {homeKind === 'S2' && heroClue && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="tag">{heroClue.dimension}</span>
                    <span className="mono">clue_{String(heroClue.seq).padStart(4, '0')}</span>
                  </div>
                  <span className="mono">{heroClue.confidence.level} → 高</span>
                </div>
                <h3
                  onClick={() => onOpenClue(heroClue.id)}
                  style={{
                    margin: '12px 0 20px',
                    fontSize: 22,
                    lineHeight: '30px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {heroClue.user_statement || heroClue.statement}
                </h3>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 16,
                    paddingBottom: 20,
                    borderBottom: '1px solid var(--page-line)',
                  }}
                >
                  <Tally strokes={heroClue.confidence.tallyStrokes} large />
                  <span className="c2" style={{ fontSize: 13, lineHeight: '20px' }}>
                    {heroClue.confidence.N} 条有效证据
                    <br />
                    <span className="c3">空位是升到「高」还差的一笔</span>
                  </span>
                </div>

                {/* 证据原话预览 */}
                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--page-line)' }}>
                  {(state.evidence || [])
                    .filter((e: any) => e.clue_id === heroClue.id && e.is_active)
                    .slice(0, 3)
                    .map((ev: any) => (
                      <div
                        key={ev.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '56px 1fr auto',
                          gap: 12,
                          alignItems: 'baseline',
                          padding: '8px 0',
                          color: ev.source_type === '用户自述' ? 'var(--page-ink-3)' : 'var(--page-ink)',
                        }}
                      >
                        <span className="mono">{ev.source_type === '用户自述' ? '自述' : ev.source_type}</span>
                        <span style={{ fontSize: 14, lineHeight: '22px' }}>
                          {ev.excerpt || ev.interpretation}
                        </span>
                        <span className="mono">
                          {ev.source_type === '用户自述' ? '不计数' : ev.strength}
                        </span>
                      </div>
                    ))}
                </div>

                <div style={{ paddingTop: 16 }}>
                  <GateBars confidence={heroClue.confidence} onlyUnmet />
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    paddingTop: 20,
                    marginTop: 12,
                    borderTop: '1px solid var(--page-line)',
                    flexWrap: 'wrap',
                  }}
                >
                  <p className="c2" style={{ margin: 0, fontSize: 13, maxWidth: '22em' }}>
                    {heroClue.confidence.next_needed}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {heroClue.needs_example ? (
                      <button
                        type="button"
                        className="btn btn-p"
                        onClick={() => onStartChat({ mode: '日常', focusClueId: heroClue.id })}
                      >
                        补一个例子
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn btn-p" onClick={onOpenUploadModal}>
                          上传测评报告
                        </button>
                        <button type="button" className="btn btn-s" onClick={onOpenValues}>
                          价值观澄清
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {homeKind === 'S3' && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="mono">已经到「高」的 {highClues.length} 条</span>
                  <span className="tag ok">可以生成</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  {highClues.slice(0, 3).map((hc: any) => (
                    <div
                      key={hc.id}
                      onClick={() => onOpenClue(hc.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: '1px solid var(--page-line)',
                        cursor: 'pointer',
                      }}
                    >
                      <Tally strokes={hc.confidence.tallyStrokes} />
                      <span style={{ fontSize: 15 }}>{hc.statement}</span>
                      <span className="mono">{hc.confidence.supportingSources.join(' · ')}</span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    paddingTop: 20,
                    marginTop: 12,
                  }}
                >
                  <p className="c2" style={{ margin: 0, fontSize: 13 }}>
                    生成前先过目合并，再逐节确认，一共约 10 分钟
                  </p>
                  <button
                    type="button"
                    className="btn btn-p"
                    onClick={() => onOpenPortrait(true)}
                  >
                    生成第一版画像
                  </button>
                </div>
              </div>
            )}

            {homeKind === 'S4' && pendingPortrait && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="mono">画像 v{pendingPortrait.version} · 待确认</span>
                  <span className="mono">{confirmedSectionCount} / 8 节</span>
                </div>
                <h3 style={{ margin: '12px 0 16px', fontSize: 22, fontWeight: 500 }}>
                  还有 {remainingSections} 节等你看
                </h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                    const isDone = Boolean(pendingPortrait.section_confirmations?.[String(n)]);
                    const isCur = n === confirmedSectionCount + 1;
                    return (
                      <i
                        key={n}
                        style={{
                          width: 24,
                          height: 4,
                          borderRadius: 2,
                          display: 'block',
                          background: isDone
                            ? 'var(--page-ink-3)'
                            : isCur
                              ? 'var(--page-accent)'
                              : 'var(--page-line-2)',
                        }}
                      />
                    );
                  })}
                </div>
                <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
                  {(pendingPortrait.sections || []).slice(0, 4).map((sec: any) => {
                    const conf = pendingPortrait.section_confirmations?.[String(sec.section)];
                    return (
                      <li
                        key={sec.section}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 0',
                          borderBottom: '1px solid var(--page-line)',
                          fontSize: 14,
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 4,
                            border: `1.5px solid ${conf ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                            background: conf ? 'var(--page-accent)' : 'transparent',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          {conf && <Check size={10} color="#fff" strokeWidth={3} />}
                        </span>
                        <span style={{ flex: 1 }}>{sec.title}</span>
                        <span className="mono">
                          {conf?.status === 'edited' ? '你修改过' : conf ? '准' : '待确认'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 16,
                    paddingTop: 16,
                  }}
                >
                  <span className="c2" style={{ fontSize: 13 }}>可以随时停下，下次接着确认</span>
                  <button type="button" className="btn btn-p" onClick={() => onOpenPortrait(false)}>
                    继续确认
                  </button>
                </div>
              </div>
            )}

            {homeKind === 'S5' && finalizedPortrait && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="mono">画像 v{finalizedPortrait.version} 概览</span>
                  <span className="mono">
                    {activeClues.length} 条线索 · {totalStories} 个故事
                  </span>
                </div>
                <h3 style={{ margin: '12px 0 12px', fontSize: 20, fontWeight: 500 }}>
                  {finalizedPortrait.headline}
                </h3>
                <p className="c2" style={{ margin: '0 0 16px', fontSize: 13 }}>
                  {finalizedPortrait.subtitle}
                </p>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 16,
                    borderTop: '1px solid var(--page-line)',
                  }}
                >
                  <span className="c2" style={{ fontSize: 13 }}>
                    继续讲故事会积累下一版的变化
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-p"
                      onClick={() => onOpenPortrait(false)}
                    >
                      查看 v{finalizedPortrait.version}
                    </button>
                    {state.eligibility?.eligible && (
                      <button
                        type="button"
                        className="btn btn-s"
                        onClick={() => onOpenPortrait(true)}
                      >
                        更新画像
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ==================== 第二行：全部线索（前 5）+ 探索进度与今日能量 ==================== */}
        <div className="home-row">
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>全部线索</h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="mono">
                  {activeClues.length} 条 · {highClues.length} 条到「高」
                </span>
                {activeClues.length > 5 && (
                  <button type="button" className="btn btn-t btn-sm" onClick={onOpenAllClues}>
                    查看全部
                  </button>
                )}
              </div>
            </div>

            {activeClues.length === 0 ? (
              <div
                style={{
                  padding: '28px 0',
                  borderBottom: '1px solid var(--page-line)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  color: 'var(--page-ink-2)',
                }}
              >
                <Tally strokes={[{ kind: 'slot' }]} />
                <span>讲完第一个故事，线索会出现在这里</span>
              </div>
            ) : (
              <table className="cl">
                <thead>
                  <tr>
                    <th>线索</th>
                    <th>类型</th>
                    <th>证据</th>
                    <th className="r">等级</th>
                  </tr>
                </thead>
                <tbody>
                  {activeClues.slice(0, 5).map((c: any) => (
                    <tr
                      key={c.id}
                      className={heroClue?.id === c.id ? 'sel' : ''}
                      onClick={() => onOpenClue(c.id)}
                    >
                      <td>
                        {c.user_statement || c.statement}
                        {c.needs_example && (
                          <span className="tag dash" style={{ marginLeft: 8 }}>
                            待补例子
                          </span>
                        )}
                      </td>
                      <td className="c2">{c.type}</td>
                      <td>
                        <Tally strokes={c.confidence.tallyStrokes} />
                      </td>
                      <td className={`r${c.confidence.level === '线索' ? ' c3' : ''}`}>
                        {c.confidence.level}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>探索进度</h3>
              <span className="mono">{progressDoneCount} / 5</span>
            </div>

            <ul className="steps-list">
              <li>
                <span className="dot done" />
                <span>目标设定</span>
                <span className="st mono">
                  {state.profile?.consented_at ? String(state.profile.consented_at).slice(5, 10) : '完成'}
                </span>
              </li>
              <li
                className={hStories < 3 || lStories < 2 ? 'cur' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => onStartChat({ mode: hStories >= 3 ? '低谷' : '高光' })}
              >
                <span className={`dot ${hStories >= 3 && lStories >= 2 ? 'done' : 'cur'}`} />
                <span>经历挖掘</span>
                <span className="st mono">
                  {totalStories === 0 ? '0 个故事' : `高光 ${hStories} · 低谷 ${lStories}`}
                </span>
              </li>
              <li
                className={totalStories < 3 && !valuesDone ? 'lock' : ''}
                style={{ cursor: 'pointer' }}
                onClick={onOpenValues}
              >
                <span className={`dot ${valuesDone ? 'done' : ''}`} />
                <span>价值观澄清</span>
                <span className="st mono">
                  {valuesDone ? '已完成' : totalStories >= 3 ? '可以开始' : '讲 3 个故事后'}
                </span>
              </li>
              <li style={{ cursor: 'pointer' }} onClick={onOpenUploadModal}>
                <span
                  className={`dot ${
                    (state.assessments || []).some((a: any) => a.counts_as_evidence) ? 'done' : ''
                  }`}
                />
                <span>测评解读</span>
                <span className="st mono">
                  {(state.assessments || []).length > 0
                    ? `已传 ${(state.assessments || []).length} 份`
                    : '随时上传'}
                </span>
              </li>
              <li
                className={!state.eligibility?.eligible && !finalizedPortrait ? 'lock' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => onOpenPortrait(false)}
              >
                <span className={`dot ${finalizedPortrait ? 'done' : ''}`} />
                <span>生成画像</span>
                <span className="st mono">
                  {finalizedPortrait
                    ? `v${finalizedPortrait.version}`
                    : state.eligibility?.eligible
                      ? '可以生成'
                      : `还差 ${Math.max(0, 3 - highClues.length)} 条「高」`}
                </span>
              </li>
            </ul>

            <div style={{ marginTop: 32 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>今天的能量</h3>
                <span className="mono">
                  {todayEnergy
                    ? `今天 ${todayEnergy.score} 分 · 已记录`
                    : `已记录 ${(state.energyLogs || []).length} / 14 天`}
                </span>
              </div>
              <div className="seg10">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    className={todayEnergy?.score === num ? 'on' : ''}
                    onClick={() => onQuickEnergyScore(num)}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
