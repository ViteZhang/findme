import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Compass,
  Home,
  Settings,
  UserCheck,
  WifiOff,
} from 'lucide-react';
import {
  BrandMark,
  ToastNotification,
  UploadAssessmentModal,
} from './components/Primitives.tsx';
import {
  callAppAction,
  clearStoredAuthSession,
  fetchBootstrap,
  resolveClientToken,
  streamCoachTurn,
} from './lib/api.ts';
import { LoginScreen, WelcomeConsentScreen } from './pages/AuthAndWelcome.tsx';
import {
  ClueDetailView,
  ClueLibraryView,
  StoryDetailView,
  StoryListView,
} from './pages/CluesAndStoriesView.tsx';
import { ConversationView } from './pages/ConversationView.tsx';
import { HomeView } from './pages/HomeView.tsx';
import {
  EnergyRecordsView,
  FeedbackCollectionView,
  SettingsView,
} from './pages/PeripheralViews.tsx';
import { PortraitView } from './pages/PortraitView.tsx';

type RouteState =
  | { name: 'home' }
  | { name: 'conversation'; conversationId?: string }
  | { name: 'clues' }
  | { name: 'clue_detail'; clueId: string }
  | { name: 'stories' }
  | { name: 'story_detail'; storyId: string }
  | { name: 'portrait'; autoStart?: boolean }
  | { name: 'energy' }
  | { name: 'feedback' }
  | { name: 'settings'; tab: 'profile' | 'reminder' | 'privacy' | 'help' };

export function App() {
  const [authState, setAuthState] = useState<'checking' | 'login' | 'ready'>('checking');
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [userEmail, setUserEmail] = useState('');
  const [workspaceState, setWorkspaceState] = useState<any>(null);
  const [hotlines, setHotlines] = useState<Record<string, any>>({});
  const [valuesPool, setValuesPool] = useState<string[]>([]);

  const [navStack, setNavStack] = useState<RouteState[]>([{ name: 'home' }]);
  const currentRoute = navStack[navStack.length - 1] || { name: 'home' };

  const [activeConv, setActiveConv] = useState<any>(null);
  const [activeMessages, setActiveMessages] = useState<any[]>([]);
  const [activeAssessment, setActiveAssessment] = useState<any>(null);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sendError, setSendError] = useState<{ text: string; message: string } | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undoId?: string | null } | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const toastTimerRef = useRef<number | null>(null);
  const notifiedDateRef = useRef<string>('');

  const showToast = (text: string, undoId?: string | null) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ text, undoId });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 5000);
  };

  const pushRoute = (next: RouteState) => {
    setNavStack((prev) => [...prev.slice(-12), next]);
  };

  const replaceTopTab = (next: RouteState) => {
    setNavStack([next]);
  };

  const popRoute = () => {
    setNavStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : [{ name: 'home' }]));
  };

  const loadWorkspace = async () => {
    setLoadTimedOut(false);
    setLoadError('');

    const skelTimer = window.setTimeout(() => setShowSkeleton(true), 300);
    const slowTimer = window.setTimeout(() => setLoadTimedOut(true), 8000);

    try {
      const token = await resolveClientToken();
      if (!token) {
        setAuthState('login');
        return;
      }

      const data = await fetchBootstrap();
      setUserEmail(data.user?.email || '');
      setWorkspaceState(data.state);
      setHotlines(data.hotlines || {});
      setValuesPool(data.valuesPool || []);
      if (data.state?.assessments?.[0]) {
        setActiveAssessment(data.state.assessments[0]);
      }

      // 若已同意隐私协议但尚未完成目标设定，自动恢复进入目标设定对话
      const goalStatus = data.state?.progress?.modules?.goal_setup?.status;
      if (data.state?.profile?.consented_at && goalStatus !== 'completed') {
        const res = await callAppAction('start_conversation', { skill: '目标设定' });
        setActiveConv(res.conversation);
        setActiveMessages(res.messages || []);
        setWorkspaceState(res.state);
        setNavStack([{ name: 'conversation', conversationId: res.conversation?.id }]);
      }

      setAuthState('ready');
    } catch (err: any) {
      if (err?.unauthorized) {
        clearStoredAuthSession();
        setAuthState('login');
      } else {
        setLoadError(err?.message || '现在连不上，你的内容都还在');
      }
    } finally {
      window.clearTimeout(skelTimer);
      window.clearTimeout(slowTimer);
      setShowSkeleton(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentRoute.name]);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // F-17 浏览器每日打卡通知轮询检查（页面打开且到达设定时间且今日未打卡时触发一次）
  useEffect(() => {
    const timer = window.setInterval(() => {
      const prof = workspaceState?.profile;
      if (!prof?.reminder_enabled || !prof?.reminder_time) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayIso = now.toISOString().slice(0, 10);
      const alreadyLogged = (workspaceState?.energyLogs || []).some(
        (l: any) => l.log_date === todayIso,
      );

      if (hhmm === prof.reminder_time && !alreadyLogged && notifiedDateRef.current !== todayIso) {
        notifiedDateRef.current = todayIso;
        new Notification('照见 · 今日能量打卡', {
          body: '今天整体精力有几分？花 30 秒记一笔吧',
        });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [workspaceState?.profile?.reminder_enabled, workspaceState?.profile?.reminder_time]);

  // 开启或恢复对话
  const openConversation = async (opts?: {
    skill?: string;
    mode?: '高光' | '低谷' | '日常';
    focusClueId?: string;
    starterPrompt?: string;
    conversationId?: string;
    forceNew?: boolean;
  }) => {
    const res = await callAppAction('start_conversation', {
      skill: opts?.skill || '经历挖掘',
      mode: opts?.mode,
      focusClueId: opts?.focusClueId,
      conversationId: opts?.conversationId,
      forceNew: opts?.forceNew,
    });
    setActiveConv(res.conversation);
    setActiveMessages(res.messages || []);
    setWorkspaceState(res.state);
    setSendError(null);
    pushRoute({ name: 'conversation', conversationId: res.conversation?.id });

    if (opts?.starterPrompt) {
      await handleSendChatMessage(opts.starterPrompt, undefined, res.conversation.id);
    }
  };

  const handleSendChatMessage = async (
    text: string,
    opts?: { skipLowTopic?: boolean },
    explicitConvId?: string,
  ) => {
    const convId = explicitConvId || activeConv?.id;
    if (!convId || isStreaming) return;

    const optimisticUserMsg = {
      id: `temp_${Date.now()}`,
      role: 'user',
      content: text,
      inline_cards: [],
    };
    setSendError(null);
    setActiveMessages((prev) => [...prev, optimisticUserMsg]);
    setIsStreaming(true);
    setStreamingText('');

    try {
      const done = await streamCoachTurn({
        conversationId: convId,
        text,
        skipLowTopic: opts?.skipLowTopic,
        onChunk: (chunk) => setStreamingText((prev) => `${prev}${chunk}`),
      });
      setActiveConv(done.conversation);
      setActiveMessages(done.messages || []);
      setWorkspaceState(done.state);
      setStreamingText('');
    } catch (err: any) {
      // 移除临时乐观消息并在底部保留失败重试状态（绝不弄丢用户打的字）
      setActiveMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
      setSendError({
        text,
        message: err?.message || '我刚才没想好，再试一次',
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // ==================== 登录前 & 加载中 & 超时恢复屏 ====================
  if (authState === 'login') {
    return <LoginScreen onLoggedIn={loadWorkspace} />;
  }

  if (authState === 'checking' || !workspaceState) {
    if (loadTimedOut || loadError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
          }}
        >
          <BrandMark />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>
            现在连不上，你的内容都还在
          </h2>
          <p className="c2" style={{ margin: 0 }}>
            {loadError || '网络响应比平时慢一些，点下面重新加载即可'}
          </p>
          <button type="button" className="btn btn-p" onClick={loadWorkspace}>
            重新加载
          </button>
        </div>
      );
    }

    if (!showSkeleton) {
      return <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }} />;
    }

    // 超过 300ms 显示静态研究笔记加载骨架（不含闪烁流光）
    return (
      <div className="app-shell">
        <aside className="side">
          <div className="brand">
            <BrandMark />
            <b>照见</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, padding: '0 8px' }}>
            <span className="skel" style={{ height: 28, width: '80%' }} />
            <span className="skel" style={{ height: 28, width: '65%' }} />
            <span className="skel" style={{ height: 28, width: '72%' }} />
          </div>
        </aside>
        <div className="main-area">
          <header className="hdr">
            <span className="skel" style={{ height: 18, width: 72 }} />
            <span className="skel" style={{ height: 14, width: 120 }} />
          </header>
          <div className="home-wrap">
            <div className="hero-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <span className="skel" style={{ height: 20, width: 110 }} />
                <span className="skel" style={{ height: 40, width: '90%' }} />
                <span className="skel" style={{ height: 40, width: '70%' }} />
                <span className="skel" style={{ height: 68, width: '100%', marginTop: 12 }} />
              </div>
              <div className="card">
                <span className="skel" style={{ height: 18, width: 140, marginBottom: 18 }} />
                <span className="skel" style={{ height: 52, width: '100%', marginBottom: 12 }} />
                <span className="skel" style={{ height: 52, width: '100%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 首次登录未勾选隐私与边界同意书 → P0.1 欢迎页
  if (!workspaceState.profile?.consented_at) {
    return (
      <WelcomeConsentScreen
        onAgreeAndStart={async () => {
          const res = await callAppAction('consent_and_start');
          setWorkspaceState(res.state);
          setActiveConv(res.conversation);
          setActiveMessages(res.messages || []);
          setNavStack([{ name: 'conversation', conversationId: res.conversation?.id }]);
        }}
      />
    );
  }

  const activeClueCount = (workspaceState.clues || []).filter(
    (c: any) => c.confidence?.level !== '已归档' && c.type !== '不一致',
  ).length;
  const recentStories = (workspaceState.stories || []).slice(0, 5);
  const nickname = workspaceState.profile?.nickname || userEmail.split('@')[0] || '探索者';
  const isInConversation = currentRoute.name === 'conversation';

  const handleClueAction = async (payload: Record<string, any>, toastText?: string) => {
    const res = await callAppAction('clue_action', payload);
    setWorkspaceState(res.state);
    if (toastText) {
      showToast(toastText, res.toastUndoId);
    }
  };

  return (
    <>
      <div
        className="app-shell"
        style={isInConversation ? { paddingBottom: 0 } : undefined}
      >
        {/* 桌面 248px 研究笔记侧栏 / 中屏 64px 窄图标栏 */}
        <aside className="side">
          <div className="brand" onClick={() => replaceTopTab({ name: 'home' })}>
            <BrandMark />
            <b>照见</b>
          </div>

          <nav className="nav" aria-label="主导航">
            <button
              type="button"
              className={`nav-link${currentRoute.name === 'home' ? ' on' : ''}`}
              onClick={() => replaceTopTab({ name: 'home' })}
              title="首页"
            >
              <Home size={17} />
              <span className="nav-label">首页</span>
            </button>

            <button
              type="button"
              className={`nav-link${
                currentRoute.name === 'clues' || currentRoute.name === 'clue_detail' ? ' on' : ''
              }`}
              onClick={() => replaceTopTab({ name: 'clues' })}
              title="线索"
            >
              <Compass size={17} />
              <span className="nav-label">线索</span>
              {activeClueCount > 0 && <span className="mono n">{activeClueCount}</span>}
            </button>

            <button
              type="button"
              className={`nav-link${currentRoute.name === 'energy' ? ' on' : ''}`}
              onClick={() => replaceTopTab({ name: 'energy' })}
              title="能量打卡"
            >
              <Activity size={17} />
              <span className="nav-label">打卡</span>
              {(workspaceState.energyLogs || []).length > 0 && (
                <span className="mono n">{workspaceState.energyLogs.length}d</span>
              )}
            </button>

            <button
              type="button"
              className={`nav-link${currentRoute.name === 'portrait' ? ' on' : ''}`}
              onClick={() => replaceTopTab({ name: 'portrait' })}
              title="个人画像"
            >
              <UserCheck size={17} />
              <span className="nav-label">画像</span>
              {workspaceState.portraits?.some((p: any) => p.status === '已定稿') && (
                <span className="mono n">
                  v{workspaceState.portraits.find((p: any) => p.status === '已定稿').version}
                </span>
              )}
            </button>
          </nav>

          <div className="slab">最近故事</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recentStories.map((st: any) => (
              <button
                key={st.id}
                type="button"
                className={`story-nav-item${
                  currentRoute.name === 'story_detail' && currentRoute.storyId === st.id ? ' on' : ''
                }`}
                onClick={() => pushRoute({ name: 'story_detail', storyId: st.id })}
              >
                <span>{st.title}</span>
                <span className="mono">{st.mode}</span>
              </button>
            ))}
            <button
              type="button"
              className={`story-nav-item all${currentRoute.name === 'stories' ? ' on' : ''}`}
              onClick={() => replaceTopTab({ name: 'stories' })}
            >
              <BookOpen size={14} />
              <span>全部故事（{(workspaceState.stories || []).length}）</span>
            </button>
          </div>

          <div className="grow" />

          <div className="me">
            <span className="av">{nickname.slice(0, 1).toUpperCase()}</span>
            <span
              className="me-name"
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              {nickname}
            </span>
            <button
              type="button"
              className="tb"
              title="设置与隐私"
              onClick={() => replaceTopTab({ name: 'settings', tab: 'profile' })}
            >
              <Settings size={16} />
            </button>
          </div>
        </aside>

        {/* 右侧主画布 */}
        <div className="main-area">
          {isOffline && (
            <div className="offline-bar">
              <WifiOff size={14} />
              <span>当前网络已断开，已写下的内容保留在页面上，恢复连接后可继续</span>
            </div>
          )}

          {currentRoute.name === 'home' && (
            <HomeView
              state={workspaceState}
              onStartChat={(opts) => openConversation(opts)}
              onOpenClue={(clueId) => pushRoute({ name: 'clue_detail', clueId })}
              onOpenAllClues={() => replaceTopTab({ name: 'clues' })}
              onOpenUploadModal={() => setUploadModalOpen(true)}
              onOpenValues={() => openConversation({ skill: '价值观澄清' })}
              onOpenPortrait={(startGen) =>
                pushRoute({ name: 'portrait', autoStart: Boolean(startGen) })
              }
              onQuickEnergyScore={async (score) => {
                const res = await callAppAction('energy_save', { score });
                setWorkspaceState(res.state);
                showToast(`已记下今日精力 ${score} 分`);
              }}
              onDismissNudge={async () => {
                const res = await callAppAction('energy_save', { dismissNudge: true });
                setWorkspaceState(res.state);
              }}
              onOpenSettingsTab={(tab) => pushRoute({ name: 'settings', tab })}
              onOpenAllStories={() => pushRoute({ name: 'stories' })}
            />
          )}

          {currentRoute.name === 'conversation' && (
            <ConversationView
              conversation={activeConv}
              messages={activeMessages}
              streamingText={streamingText}
              isStreaming={isStreaming}
              sendError={sendError}
              isOffline={isOffline}
              state={workspaceState}
              valuesPool={valuesPool}
              activeAssessment={activeAssessment}
              onSendMessage={(text, opts) => handleSendChatMessage(text, opts)}
              onRetryFailed={() => {
                if (sendError) {
                  handleSendChatMessage(sendError.text);
                }
              }}
              onSwitchMode={async (mode) => {
                const res = await callAppAction('start_conversation', {
                  skill: '经历挖掘',
                  mode,
                  forceNew: true,
                });
                setActiveConv(res.conversation);
                setActiveMessages(res.messages || []);
                setWorkspaceState(res.state);
              }}
              onFinishSession={async () => {
                if (!activeConv?.id) return;
                const res = await callAppAction('finish_conversation', {
                  conversationId: activeConv.id,
                });
                setActiveConv(res.conversation);
                setActiveMessages(res.messages || []);
                setWorkspaceState(res.state);
              }}
              onCardAction={async (messageId, cardIndex, cardAction, payload) => {
                const res = await callAppAction('respond_inline_card', {
                  messageId,
                  cardIndex,
                  cardAction,
                  payload,
                });
                setActiveMessages(res.messages || []);
                setWorkspaceState(res.state);
              }}
              onValuesAction={async (payload) => {
                const res = await callAppAction('values_action', { payload });
                setWorkspaceState(res.state);
                return res;
              }}
              onAssessmentRespond={async (comparisonId, responseAction, userText) => {
                if (!activeAssessment) return;
                const res = await callAppAction('assessment_respond', {
                  assessmentId: activeAssessment.id,
                  comparisonId,
                  responseAction,
                  userText,
                });
                setActiveAssessment(res.assessment);
                setWorkspaceState(res.state);
                return res;
              }}
              onAssessmentDisposeFile={async (deleteFile) => {
                if (!activeAssessment) return;
                const res = await callAppAction('assessment_dispose_file', {
                  assessmentId: activeAssessment.id,
                  deleteFile,
                  rememberChoice: true,
                });
                setWorkspaceState(res.state);
                showToast(deleteFile ? '已删除上传原文件，仅保留解读结果' : '已加密保留原文件');
              }}
              onOpenUploadModal={() => setUploadModalOpen(true)}
              onOpenClue={(clueId) => pushRoute({ name: 'clue_detail', clueId })}
              onOpenStory={(storyId) => pushRoute({ name: 'story_detail', storyId })}
              onOpenPortrait={() => pushRoute({ name: 'portrait', autoStart: true })}
              onOpenHelpSettings={() => pushRoute({ name: 'settings', tab: 'help' })}
              onBack={popRoute}
            />
          )}

          {currentRoute.name === 'clues' && (
            <ClueLibraryView
              state={workspaceState}
              onOpenClue={(clueId) => pushRoute({ name: 'clue_detail', clueId })}
              onClueAction={handleClueAction}
              onStartStory={(opts) => openConversation({ ...opts, forceNew: true })}
              onOpenFeedback={() => pushRoute({ name: 'feedback' })}
            />
          )}

          {currentRoute.name === 'clue_detail' && (
            <ClueDetailView
              clueId={currentRoute.clueId}
              state={workspaceState}
              onBack={popRoute}
              onClueAction={handleClueAction}
              onOpenStory={(storyId) => pushRoute({ name: 'story_detail', storyId })}
              onOpenClue={(otherId) => pushRoute({ name: 'clue_detail', clueId: otherId })}
              onStartExampleForClue={(clueId) =>
                openConversation({
                  skill: '经历挖掘',
                  mode: '日常',
                  focusClueId: clueId,
                  forceNew: true,
                })
              }
            />
          )}

          {currentRoute.name === 'stories' && (
            <StoryListView
              state={workspaceState}
              onOpenStory={(storyId) => pushRoute({ name: 'story_detail', storyId })}
              onStartStory={(opts) =>
                openConversation({
                  skill: '经历挖掘',
                  mode: opts?.mode || '高光',
                  conversationId: opts?.conversationId,
                  forceNew: !opts?.conversationId,
                })
              }
            />
          )}

          {currentRoute.name === 'story_detail' && (
            <StoryDetailView
              storyId={currentRoute.storyId}
              state={workspaceState}
              onBack={popRoute}
              onOpenClue={(clueId) => pushRoute({ name: 'clue_detail', clueId })}
              onOpenConversation={(opts) => openConversation(opts)}
              onStoryUpdateTitle={async (storyId, title) => {
                const res = await callAppAction('story_action', {
                  subAction: 'update_title',
                  storyId,
                  title,
                });
                setWorkspaceState(res.state);
                showToast('已更新故事标题');
              }}
              onStoryPreviewDelete={async (storyId) => {
                const res = await callAppAction('story_action', {
                  subAction: 'delete_preview',
                  storyId,
                });
                return res.preview;
              }}
              onStoryConfirmDelete={async (storyId) => {
                const res = await callAppAction('story_action', {
                  subAction: 'delete_confirm',
                  storyId,
                });
                setWorkspaceState(res.state);
                showToast('已删除故事并重算关联线索');
              }}
            />
          )}

          {currentRoute.name === 'portrait' && (
            <PortraitView
              state={workspaceState}
              autoStartGenerate={Boolean(currentRoute.autoStart)}
              onClearAutoStart={() => {
                setNavStack((prev) =>
                  prev.map((it, idx) =>
                    idx === prev.length - 1 && it.name === 'portrait'
                      ? { name: 'portrait', autoStart: false }
                      : it,
                  ),
                );
              }}
              onPortraitAction={async (payload) => {
                const res = await callAppAction('portrait_action', payload);
                if (res.state) setWorkspaceState(res.state);
                return res;
              }}
              onClueAction={handleClueAction}
              onOpenClue={(clueId) => pushRoute({ name: 'clue_detail', clueId })}
              onOpenStory={(storyId) => pushRoute({ name: 'story_detail', storyId })}
              onOpenValues={() => openConversation({ skill: '价值观澄清' })}
              onOpenUploadModal={() => setUploadModalOpen(true)}
              onOpenFeedback={() => pushRoute({ name: 'feedback' })}
              onStartStoryForClue={(clueId) =>
                openConversation({
                  skill: '经历挖掘',
                  mode: '高光',
                  focusClueId: clueId,
                  forceNew: true,
                })
              }
              onBackHome={() => replaceTopTab({ name: 'home' })}
              onShowToast={(t) => showToast(t)}
            />
          )}

          {currentRoute.name === 'energy' && (
            <EnergyRecordsView
              state={workspaceState}
              onStartCheckinChat={() =>
                openConversation({ skill: '能量打卡', forceNew: true })
              }
              onQuickSaveEnergy={async (payload) => {
                const res = await callAppAction('energy_save', payload);
                setWorkspaceState(res.state);
                showToast('已保存今日能量打卡');
              }}
              onOpenReminderSettings={() => pushRoute({ name: 'settings', tab: 'reminder' })}
            />
          )}

          {currentRoute.name === 'feedback' && (
            <FeedbackCollectionView
              state={workspaceState}
              onBack={popRoute}
              onFeedbackAction={async (payload) => {
                const res = await callAppAction('feedback_action', payload);
                setWorkspaceState(res.state);
              }}
              onShowToast={(t) => showToast(t)}
            />
          )}

          {currentRoute.name === 'settings' && (
            <SettingsView
              state={workspaceState}
              userEmail={userEmail}
              hotlines={hotlines}
              activeTab={currentRoute.tab}
              onChangeTab={(tab) =>
                setNavStack((prev) => [...prev.slice(0, -1), { name: 'settings', tab }])
              }
              onUpdateProfile={async (patch, restartGoalSetup) => {
                const res = await callAppAction('update_profile', {
                  patch,
                  restartGoalSetup,
                });
                setWorkspaceState(res.state);
                if (res.restartedConv) {
                  setActiveConv(res.restartedConv.conversation);
                  setActiveMessages(res.restartedConv.messages || []);
                  pushRoute({
                    name: 'conversation',
                    conversationId: res.restartedConv.conversation?.id,
                  });
                }
              }}
              onExportAllData={async () => callAppAction('privacy_export', { reverified: true })}
              onEraseAllData={async (confirmation) => {
                const res = await callAppAction('privacy_erase', {
                  confirmation,
                  reverified: true,
                });
                setWorkspaceState(res.state);
                setNavStack([{ name: 'home' }]);
                showToast('已永久清空全部数据');
              }}
              onSignOut={() => {
                clearStoredAuthSession();
                setWorkspaceState(null);
                setAuthState('login');
              }}
              onShowToast={(t) => showToast(t)}
            />
          )}
        </div>

        {/* 移动端底部四栏导航（全屏对话页隐藏） */}
        {!isInConversation && (
          <nav className="mobile-tabs" aria-label="移动端主导航">
            <button
              type="button"
              className={currentRoute.name === 'home' ? 'on' : ''}
              onClick={() => replaceTopTab({ name: 'home' })}
            >
              <Home size={18} />
              <span>首页</span>
            </button>
            <button
              type="button"
              className={
                currentRoute.name === 'clues' || currentRoute.name === 'clue_detail' ? 'on' : ''
              }
              onClick={() => replaceTopTab({ name: 'clues' })}
            >
              <Compass size={18} />
              <span>线索</span>
            </button>
            <button
              type="button"
              className={currentRoute.name === 'energy' ? 'on' : ''}
              onClick={() => replaceTopTab({ name: 'energy' })}
            >
              <Activity size={18} />
              <span>打卡</span>
            </button>
            <button
              type="button"
              className={currentRoute.name === 'portrait' ? 'on' : ''}
              onClick={() => replaceTopTab({ name: 'portrait' })}
            >
              <UserCheck size={18} />
              <span>画像</span>
            </button>
          </nav>
        )}
      </div>

      {/* 全局测评上传弹窗 */}
      <UploadAssessmentModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUpload={async (payload) => {
          const res = await callAppAction('assessment_upload', payload);
          setActiveAssessment(res.assessment);
          setWorkspaceState(res.state);

          const convRes = await callAppAction('start_conversation', {
            skill: '测评解读',
            forceNew: true,
          });
          setActiveConv(convRes.conversation);
          setActiveMessages(convRes.messages || []);
          setWorkspaceState(convRes.state);
          pushRoute({ name: 'conversation', conversationId: convRes.conversation?.id });
        }}
      />

      {/* 5 秒可撤销 Toast */}
      <ToastNotification
        toast={toast}
        onUndo={async (undoId) => {
          const res = await callAppAction('clue_action', {
            subAction: 'undo',
            changeLogId: undoId,
          });
          setWorkspaceState(res.state);
          setToast(null);
        }}
        onClose={() => setToast(null)}
      />
    </>
  );
}
