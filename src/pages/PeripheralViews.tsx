import React, { useState } from 'react';
import {
  Bell,
  Check,
  ChevronLeft,
  Copy,
  Download,
  Lock,
  LogOut,
  Phone,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react';

function downloadFileText(content: string, fileName: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== P6 能量打卡记录页 ====================
export function EnergyRecordsView({
  state,
  onStartCheckinChat,
  onQuickSaveEnergy,
  onOpenReminderSettings,
}: {
  state: any;
  onStartCheckinChat: () => void;
  onQuickSaveEnergy: (payload: {
    score: number;
    chargeEvent?: string;
    drainEvent?: string;
  }) => Promise<void>;
  onOpenReminderSettings: () => void;
}) {
  const [quickScore, setQuickScore] = useState<number | null>(null);
  const [chargeText, setChargeText] = useState('');
  const [drainText, setDrainText] = useState('');
  const [saving, setSaving] = useState(false);

  const logs: any[] = state.energyLogs || [];
  const logByDate = new Map(
    logs.map((l) => [String(l.log_date || '').slice(0, 10), l]),
  );
  const totalDays = logs.length;
  const remaining = Math.max(0, 14 - totalDays);

  // 过去 14 天两周日历格（按时间从旧到新）
  const days14: Array<{ date: string; short: string; score: number | null }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().slice(0, 10);
    const found = logByDate.get(iso);
    days14.push({
      date: iso,
      short: iso.slice(5),
      score: found ? Number(found.score) : null,
    });
  }

  const shadeForScore = (score: number | null) => {
    if (score === null) return 'transparent';
    if (score <= 3) return '#F7F9FC';
    if (score <= 5) return '#E8EEF6';
    if (score <= 7) return '#CFDBEA';
    return '#A9BDD7';
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayLogged = logByDate.has(todayIso);

  return (
    <>
      <header className="hdr">
        <h2>能量打卡</h2>
        <div className="l">
          <button type="button" className="btn btn-s btn-sm" onClick={onOpenReminderSettings}>
            <Bell size={14} /> 提醒设置
          </button>
          <button type="button" className="btn btn-p btn-sm" onClick={onStartCheckinChat}>
            <Plus size={14} /> 对话式打卡
          </button>
        </div>
      </header>

      <div className="home-wrap" style={{ maxWidth: 960, gap: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: '36px', fontWeight: 500 }}>
            {remaining > 0
              ? `已经记录 ${totalDays} 天，再记 ${remaining} 天就能看到第一份能量周报`
              : `已经累计记录 ${totalDays} 天能量轨迹`}
          </h1>
          <p className="c2" style={{ margin: '8px 0 0', fontSize: 14 }}>
            打卡用来捕捉日常精力起伏，在画像第 5 节会标注为「打卡 · 不计入」，不会干扰真实故事证据权重
          </p>
        </div>

        {/* 14 天四档墨水蓝浅色日历格 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono">最近 14 天精力分布</span>
            <span className="mono">浅 → 深对应 1–10 分 · 虚线为未记录</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 8,
              marginTop: 16,
            }}
          >
            {days14.map((cell) => {
              const empty = cell.score === null;
              return (
                <div
                  key={cell.date}
                  style={{
                    height: 64,
                    borderRadius: 10,
                    border: empty
                      ? '1px dashed var(--page-line-2)'
                      : '1px solid rgba(35, 64, 110, 0.18)',
                    background: shadeForScore(cell.score),
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11 }}>{cell.short}</span>
                  <b className="mono" style={{ fontSize: 15, color: empty ? 'var(--page-ink-3)' : 'var(--page-ink)' }}>
                    {empty ? '—' : cell.score}
                  </b>
                </div>
              );
            })}
          </div>
        </div>

        {/* 今日快捷记录卡 */}
        {!todayLogged && (
          <div className="card">
            <span className="mono">今天（{todayIso}）还没记</span>
            <h3 style={{ margin: '6px 0 12px', fontSize: 18, fontWeight: 500 }}>
              今天整体精力怎么样？
            </h3>
            <div className="seg10">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={quickScore === n ? 'on' : ''}
                  onClick={() => setQuickScore(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            {quickScore !== null && (
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <input
                  type="text"
                  value={chargeText}
                  onChange={(e) => setChargeText(e.target.value)}
                  placeholder="今天让你觉得充电的事（选填）"
                  style={{
                    height: 38,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                  }}
                />
                <input
                  type="text"
                  value={drainText}
                  onChange={(e) => setDrainText(e.target.value)}
                  placeholder="今天让你觉得消耗的事（选填）"
                  style={{
                    height: 38,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-p btn-sm"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await onQuickSaveEnergy({
                          score: quickScore,
                          chargeEvent: chargeText.trim() || undefined,
                          drainEvent: drainText.trim() || undefined,
                        });
                        setQuickScore(null);
                        setChargeText('');
                        setDrainText('');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? '保存中…' : '记下今天'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 历史打卡表格 */}
        {logs.length > 0 && (
          <div>
            <span className="mono" style={{ display: 'block', marginBottom: 10 }}>最近记录</span>
            <table className="cl">
              <thead>
                <tr>
                  <th style={{ width: 112 }}>日期</th>
                  <th style={{ width: 80 }}>精力分</th>
                  <th>充电时刻</th>
                  <th>消耗时刻</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ cursor: 'default' }}>
                    <td>
                      <span className="mono">{String(l.log_date || '').slice(0, 10)}</span>
                    </td>
                    <td>
                      <b className="mono" style={{ color: 'var(--page-ink)' }}>{l.score} / 10</b>
                    </td>
                    <td>{l.charge_event || <span className="c3">—</span>}</td>
                    <td>{l.drain_event || <span className="c3">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ==================== P7.1 准备问卷 & P7.2 导入回复 ====================
const FEEDBACK_QUESTIONS_5 = [
  '1. 回想我们合作或相处过的事，哪一次你觉得我做得特别顺手、让人放心？',
  '2. 你观察到我做什么类型的事情时，整个人最有精神？',
  '3. 有没有哪件事或习惯，我自己可能没太在意，但你觉得容易让我吃亏？',
  '4. 如果你身边遇到难题，哪一类问题你会第一个想到来找我商量？',
  '5. 如果送我一句实实在在的提醒，你会说什么？',
];

const RELATIONS = ['同事', '朋友', '上级', '下属', '家人'] as const;

export function FeedbackCollectionView({
  state,
  onBack,
  onFeedbackAction,
  onShowToast,
}: {
  state: any;
  onBack: () => void;
  onFeedbackAction: (payload: Record<string, any>) => Promise<void>;
  onShowToast: (text: string) => void;
}) {
  const [tab, setTab] = useState<'prepare' | 'import'>('prepare');
  const [mode, setMode] = useState<'匿名' | '实名'>('匿名');
  const [planned, setPlanned] = useState<Record<string, number>>({ 同事: 2, 朋友: 1 });
  const [importRelation, setImportRelation] = useState<string>('同事');
  const [importContent, setImportContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const responses: any[] = state.feedbackResponses || [];

  const inviteText = `嗨，我最近在用「照见」梳理自己的优势和盲点，很想听听你眼里的我是什么样的（${
    mode === '匿名' ? '不用留名字，直说就好' : '可以说个具体的事，哪怕很小的细节也很有帮助'
  }）。挑两三个你有印象的问题回我就行：\n\n${FEEDBACK_QUESTIONS_5.join('\n')}`;

  const copySurvey = async () => {
    await navigator.clipboard?.writeText(inviteText);
    await onFeedbackAction({
      subAction: 'save_request',
      mode,
      questions: FEEDBACK_QUESTIONS_5,
      plannedRelations: planned,
    });
    onShowToast('已复制邀请话术与 5 个问题');
  };

  const submitImportedReply = async () => {
    if (!importContent.trim()) return;
    setSubmitting(true);
    try {
      await onFeedbackAction({
        subAction: 'import_response',
        relation: importRelation,
        content: importContent.trim(),
      });
      setImportContent('');
      onShowToast('已加密保存这份反馈回复');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="hdr">
        <div className="l">
          <button type="button" className="btn btn-t btn-sm" onClick={onBack} style={{ paddingLeft: 0 }}>
            <ChevronLeft size={16} /> 返回
          </button>
          <h2>收集他人反馈</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`btn ${tab === 'prepare' ? 'btn-p' : 'btn-s'} btn-sm`}
            onClick={() => setTab('prepare')}
          >
            准备问卷
          </button>
          <button
            type="button"
            className={`btn ${tab === 'import' ? 'btn-p' : 'btn-s'} btn-sm`}
            onClick={() => setTab('import')}
          >
            导入回复（{responses.length}）
          </button>
        </div>
      </header>

      <div className="home-wrap" style={{ maxWidth: 820, gap: 28 }}>
        {tab === 'prepare' ? (
          <>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>
                问问真正和你共事或相处过的人
              </h1>
              <p className="c2" style={{ margin: '8px 0 0' }}>
                别人记得的具体小事，往往能照见你自己习以为常的优势。复制下面这段话发给微信好友或同事，收到回复后粘回「导入回复」即可保存
              </p>
            </div>

            <div className="card">
              <span className="mono">打算邀请谁（可点选计数）</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {RELATIONS.map((rel) => {
                  const cnt = planned[rel] || 0;
                  return (
                    <button
                      key={rel}
                      type="button"
                      onClick={() =>
                        setPlanned({
                          ...planned,
                          [rel]: (cnt + 1) % 4,
                        })
                      }
                      style={{
                        height: 34,
                        padding: '0 12px',
                        borderRadius: 8,
                        border: `1px solid ${cnt > 0 ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                        background: cnt > 0 ? 'var(--page-accent-50)' : 'var(--page-surface)',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {rel} {cnt > 0 ? `×${cnt}` : ''}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                {(['匿名', '实名'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn ${mode === m ? 'btn-s' : 'btn-t'} btn-sm`}
                    onClick={() => setMode(m)}
                  >
                    {m === '匿名' ? '匿名口径（对方更放松）' : '实名口径（方便追问例子）'}
                  </button>
                ))}
              </div>

              <pre
                style={{
                  marginTop: 16,
                  padding: 16,
                  borderRadius: 10,
                  background: 'var(--page-bg)',
                  border: '1px solid var(--page-line)',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--page-sans)',
                  fontSize: 14,
                  lineHeight: '22px',
                }}
              >
                {inviteText}
              </pre>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <span className="mono">复制后可直接粘贴到微信或邮件发送</span>
                <button type="button" className="btn btn-p" onClick={copySurvey}>
                  <Copy size={15} /> 复制邀请话术与问题
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>导入收到的回复</h1>
              <p className="c2" style={{ margin: '8px 0 0' }}>
                V0.5 会将你收到的反馈加密妥善存档（当前不直接计入线索置信度，满 3 份将在后续版本开启交叉对照解读）
              </p>
            </div>

            <div className="card">
              <span className="mono">对方和你的关系</span>
              <div style={{ display: 'flex', gap: 8, margin: '10px 0 16px', flexWrap: 'wrap' }}>
                {RELATIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setImportRelation(r)}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: `1px solid ${importRelation === r ? 'var(--page-ink)' : 'var(--page-line-2)'}`,
                      background: importRelation === r ? 'var(--page-ink)' : 'var(--page-surface)',
                      color: importRelation === r ? '#fff' : 'var(--page-ink-2)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <textarea
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                placeholder="把朋友或同事回复给你的文字粘贴在这里…"
                style={{
                  width: '100%',
                  height: 140,
                  border: '1px solid var(--page-line-2)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: 14,
                  lineHeight: '22px',
                  resize: 'none',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-p"
                  disabled={!importContent.trim() || submitting}
                  onClick={submitImportedReply}
                >
                  {submitting ? '正在保存…' : '保存这份回复'}
                </button>
              </div>
            </div>

            {responses.length > 0 && (
              <div>
                <span className="mono" style={{ display: 'block', marginBottom: 10 }}>
                  已保存的回复（{responses.length}）
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {responses.map((resp) => (
                    <div key={resp.id} className="card" style={{ padding: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span className="tag">{resp.relation}</span>
                        <span className="mono">
                          {String(resp.received_at || resp.created_at || '').slice(0, 10)} · 不计入置信度
                        </span>
                      </div>
                      <div style={{ fontSize: 14, lineHeight: '22px', whiteSpace: 'pre-wrap' }}>
                        {resp.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ==================== P8 设置页（我的档案 / 提醒 / 隐私与数据 / 求助资源） ====================
export function SettingsView({
  state,
  userEmail,
  hotlines,
  activeTab,
  onChangeTab,
  onUpdateProfile,
  onExportAllData,
  onEraseAllData,
  onSignOut,
  onShowToast,
}: {
  state: any;
  userEmail: string;
  hotlines: Record<string, any>;
  activeTab: 'profile' | 'reminder' | 'privacy' | 'help';
  onChangeTab: (tab: 'profile' | 'reminder' | 'privacy' | 'help') => void;
  onUpdateProfile: (patch: Record<string, any>, restartGoalSetup?: boolean) => Promise<void>;
  onExportAllData: () => Promise<{ json: any; markdown: string }>;
  onEraseAllData: (confirmation: string) => Promise<void>;
  onSignOut: () => void;
  onShowToast: (text: string) => void;
}) {
  const prof = state.profile || {};
  const [nickname, setNickname] = useState(prof.nickname || '');
  const [goal, setGoal] = useState(prof.goal || '');
  const [puzzle, setPuzzle] = useState(prof.current_puzzle || '');
  const [directness, setDirectness] = useState<'直接' | '温和'>(
    prof.comm_style?.directness || '直接',
  );
  const [examples, setExamples] = useState<'要' | '不要'>(prof.comm_style?.examples || '要');
  const [goalChangedModal, setGoalChangedModal] = useState(false);

  const [reminderOn, setReminderOn] = useState(Boolean(prof.reminder_enabled));
  const [reminderTime, setReminderTime] = useState(prof.reminder_time || '21:00');
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  const [eraseModalOpen, setEraseModalOpen] = useState(false);
  const [eraseInput, setEraseInput] = useState('');
  const [erasing, setErasing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [region, setRegion] = useState<'CN' | 'HK' | 'TW' | 'INTL'>(
    prof.region || 'CN',
  );
  const [guideOpen, setGuideOpen] = useState(false);

  const handleSaveProfileClick = async () => {
    if (goal.trim() !== (prof.goal || '').trim() && prof.goal) {
      setGoalChangedModal(true);
      return;
    }
    await onUpdateProfile({
      nickname: nickname.trim(),
      goal: goal.trim(),
      current_puzzle: puzzle.trim(),
      comm_style: { directness, examples },
    });
    onShowToast('已更新个人档案');
  };

  const handleSaveReminder = async () => {
    if (reminderOn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
    }
    await onUpdateProfile({
      reminder_enabled: reminderOn,
      reminder_time: reminderTime,
    });
    onShowToast('已保存提醒设置');
  };

  const handleRunExport = async () => {
    setExporting(true);
    try {
      const data = await onExportAllData();
      const dateTag = new Date().toISOString().slice(0, 10);
      downloadFileText(
        JSON.stringify(data.json, null, 2),
        `照见_完整数据导出_${dateTag}.json`,
        'application/json;charset=utf-8',
      );
      downloadFileText(
        data.markdown,
        `照见_可读探索档案_${dateTag}.md`,
        'text/markdown;charset=utf-8',
      );
      onShowToast('已导出 JSON 与可读 Markdown 两份档案');
    } finally {
      setExporting(false);
    }
  };

  const regionBundle = hotlines?.[region] || hotlines?.CN || {
    regionName: '中国大陆',
    crisisName: '全国统一心理援助热线',
    crisisNumber: '12356',
    emergencyName: '急救电话 / 报警求助',
    emergencyNumber: '120 / 110',
    backupLines: [],
  };

  const displayHotlines = [
    ...(regionBundle.crisisNumber
      ? [
          {
            name: regionBundle.crisisName || '心理援助热线',
            number: regionBundle.crisisNumber,
            hours: '24 小时 · 首选心理危机干预热线',
          },
        ]
      : []),
    ...(regionBundle.emergencyNumber
      ? [
          {
            name: regionBundle.emergencyName || '紧急救援',
            number: regionBundle.emergencyNumber,
            hours: '24 小时紧急求助',
          },
        ]
      : []),
    ...(regionBundle.backupLines || regionBundle.lines || []),
  ];

  const storedFilesCount = (state.assessments || []).filter(
    (a: any) => a.raw_file_ref && !a.raw_file_deleted_at,
  ).length;
  const rawFilePrefValue =
    prof.privacy?.keep_raw_assessment === true
      ? 'keep'
      : prof.privacy?.keep_raw_assessment === false
        ? 'delete'
        : 'ask';

  return (
    <>
      <header className="hdr">
        <h2>设置</h2>
        <button type="button" className="btn btn-t btn-sm" onClick={onSignOut}>
          <LogOut size={14} /> 退出登录
        </button>
      </header>

      <div
        className="home-wrap"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 36,
          alignItems: 'start',
        }}
      >
        {/* 左侧子导航 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 220 }}>
          {(
            [
              ['profile', '我的档案'],
              ['reminder', '提醒'],
              ['privacy', '隐私与数据'],
              ['help', '求助资源'],
            ] as const
          ).map(([id, lab]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTab(id)}
              style={{
                height: 38,
                padding: '0 12px',
                borderRadius: 8,
                border: 0,
                textAlign: 'left',
                fontSize: 14,
                cursor: 'pointer',
                background: activeTab === id ? 'var(--page-raised)' : 'transparent',
                color: activeTab === id ? 'var(--page-ink)' : 'var(--page-ink-2)',
                fontWeight: activeTab === id ? 500 : 400,
              }}
            >
              {lab}
            </button>
          ))}
        </div>

        {/* 右侧详情区 */}
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          {activeTab === 'profile' && (
            <div className="card" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>我的档案</h3>
                <span className="mono">{userEmail}</span>
              </div>

              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>称呼</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  style={{
                    width: '100%',
                    height: 38,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                  }}
                />
              </div>

              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>探索目标</label>
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  style={{
                    width: '100%',
                    height: 38,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                  }}
                />
              </div>

              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>眼前的处境或困惑</label>
                <textarea
                  rows={2}
                  value={puzzle}
                  onChange={(e) => setPuzzle(e.target.value)}
                  style={{
                    width: '100%',
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    resize: 'none',
                  }}
                />
              </div>

              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>教练沟通偏好</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(['直接', '温和'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`btn ${directness === d ? 'btn-p' : 'btn-s'} btn-sm`}
                      onClick={() => setDirectness(d)}
                    >
                      说话{d}
                    </button>
                  ))}
                  {(['要', '不要'] as const).map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      className={`btn ${examples === ex ? 'btn-p' : 'btn-s'} btn-sm`}
                      onClick={() => setExamples(ex)}
                    >
                      {ex === '要' ? '多举例子' : '只说重点'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-p" onClick={handleSaveProfileClick}>
                  保存档案修改
                </button>
              </div>
            </div>
          )}

          {activeTab === 'reminder' && (
            <div className="card" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>每日能量打卡提醒</h3>
                <p className="c2" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  打开页面且到达设定时间时，通过浏览器桌面通知轻声提醒你记录当天精力分
                </p>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span>开启每日打卡提醒</span>
                <input
                  type="checkbox"
                  checked={reminderOn}
                  onChange={(e) => setReminderOn(e.target.checked)}
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>提醒时间</span>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  style={{
                    height: 36,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 10px',
                    fontFamily: 'var(--page-mono)',
                  }}
                />
              </div>

              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--page-raised)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                }}
              >
                <span>
                  浏览器通知权限：
                  <span className="mono" style={{ marginLeft: 6 }}>
                    {notifPerm === 'granted'
                      ? '已授权'
                      : notifPerm === 'denied'
                        ? '已被系统拦截（可在浏览器地址栏左侧开启）'
                        : notifPerm === 'default'
                          ? '待授权'
                          : '当前环境不支持'}
                  </span>
                </span>
                {notifPerm === 'default' && typeof Notification !== 'undefined' && (
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={async () => {
                      const p = await Notification.requestPermission();
                      setNotifPerm(p);
                    }}
                  >
                    授权通知
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-p" onClick={handleSaveReminder}>
                  保存提醒设置
                </button>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>隐私保护与数据主权</h3>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--page-line)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>允许用我的对话训练 AI 模型</div>
                    <div className="c2" style={{ fontSize: 13 }}>产品级硬性关闭，不可开启</div>
                  </div>
                  <span className="tag">
                    <Lock size={12} style={{ marginRight: 4 }} /> 已永久关闭
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--page-line)',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>上传测评原文件保留策略</div>
                    <div className="c2" style={{ fontSize: 13 }}>
                      当前保留原件数：{storedFilesCount} 份
                    </div>
                  </div>
                  <select
                    value={rawFilePrefValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateProfile({
                        keep_raw_assessment: val === 'keep' ? true : val === 'delete' ? false : null,
                      });
                      onShowToast('已更新测评原件处理偏好');
                    }}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      border: '1px solid var(--page-line-2)',
                      padding: '0 10px',
                      background: 'var(--page-surface)',
                    }}
                  >
                    <option value="ask">每次解读完询问我</option>
                    <option value="delete">解析完成后自动删除原件</option>
                    <option value="keep">默认加密保留原件</option>
                  </select>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 4,
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>导出全部数据</div>
                    <div className="mono" style={{ marginTop: 2 }}>
                      含 {(state.stories || []).length} 个故事 · {(state.clues || []).length} 条线索 ·{' '}
                      {(state.portraits || []).length} 份画像（JSON + Markdown）
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-s"
                    disabled={exporting}
                    onClick={handleRunExport}
                  >
                    <Download size={15} /> {exporting ? '正在打包…' : '导出全部数据'}
                  </button>
                </div>
              </div>

              <div className="card" style={{ borderColor: 'var(--page-line-2)' }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>清空并永久删除全部数据</h3>
                <p className="c2" style={{ margin: '6px 0 16px', fontSize: 13 }}>
                  立即清空全部 18 张数据表及上传的测评文件原件，操作不可撤销（底层滚动备份将在 30 天内自动轮转覆盖）
                </p>
                <button
                  type="button"
                  className="btn btn-s"
                  onClick={() => {
                    setEraseInput('');
                    setEraseModalOpen(true);
                  }}
                >
                  <Trash2 size={15} /> 删除全部数据
                </button>
              </div>
            </div>
          )}

          {activeTab === 'help' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>专业心理支持与危机干预热线</h3>
                    <p className="c2" style={{ margin: '4px 0 0', fontSize: 13 }}>
                      照见是自我探索教练，无法替代心理咨询或医疗诊断。如果你正经历强烈痛苦，请随时联系专业人员
                    </p>
                  </div>
                  <select
                    value={region}
                    onChange={(e) => {
                      const next = e.target.value as 'CN' | 'HK' | 'TW' | 'INTL';
                      setRegion(next);
                      onUpdateProfile({ region: next });
                    }}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      border: '1px solid var(--page-line-2)',
                      padding: '0 10px',
                      background: 'var(--page-surface)',
                    }}
                  >
                    <option value="CN">中国大陆</option>
                    <option value="HK">中国香港</option>
                    <option value="TW">中国台湾</option>
                    <option value="INTL">国际通用</option>
                  </select>
                </div>

                <div style={{ marginTop: 16 }}>
                  {displayHotlines.map((line: any) => (
                    <div
                      key={`${line.name}-${line.number}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderTop: '1px solid var(--page-line)',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{line.name}</div>
                        <span className="mono">{line.hours}</span>
                      </div>
                      <a href={`tel:${line.number.replace(/\s+/g, '')}`} className="btn btn-s btn-sm">
                        <Phone size={13} /> {line.number}
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>怎么找一位靠谱的心理咨询师？</h4>
                    <span className="c2" style={{ fontSize: 13 }}>筛选资质、伦理边界与首次访谈参考清单</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={() => setGuideOpen((v) => !v)}
                  >
                    <Shield size={14} /> {guideOpen ? '收起说明' : '查看指南'}
                  </button>
                </div>

                {guideOpen && (
                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: '1px solid var(--page-line)',
                      fontSize: 14,
                      lineHeight: '22px',
                      color: 'var(--page-ink-2)',
                    }}
                  >
                    <p style={{ margin: '0 0 8px' }}>
                      1. <b>看受训背景与督导</b>：优先选择高校心理中心、三甲医院心理科，或具备系统长程受训并持续接受专业督导的注册咨询师（如中国心理学会临床心理学注册系统 CPS）。
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                      2. <b>看边界与设置</b>：正规咨询会明确告知保密原则及保密例外、固定时长（通常 50 分钟/次）与收费规则，不会在咨询外发展私人关系或替你做人生决定。
                    </p>
                    <p style={{ margin: 0 }}>
                      3. <b>相信你的体感</b>：前 1–3 次通常是初始评估与双向匹配。如果感到被评判或不安全，你完全有权利更换咨询师。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 修改探索目标确认弹层 */}
      {goalChangedModal && (
        <div className="overlay" onClick={() => setGoalChangedModal(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>要重新做一次目标设定对话吗？</h3>
            <p>
              你修改了探索目标。可以直接保存文字修改，也可以让教练陪你重新走一遍 5 分钟目标设定，对齐接下来的提问方向（已有的故事和线索都会完整保留）
            </p>
            <div className="ft">
              <button
                type="button"
                className="btn btn-s"
                onClick={async () => {
                  setGoalChangedModal(false);
                  await onUpdateProfile(
                    {
                      nickname: nickname.trim(),
                      goal: goal.trim(),
                      current_puzzle: puzzle.trim(),
                      comm_style: { directness, examples },
                    },
                    false,
                  );
                  onShowToast('已更新探索目标');
                }}
              >
                只保存文字修改
              </button>
              <button
                type="button"
                className="btn btn-p"
                onClick={async () => {
                  setGoalChangedModal(false);
                  await onUpdateProfile(
                    {
                      nickname: nickname.trim(),
                      goal: goal.trim(),
                      current_puzzle: puzzle.trim(),
                      comm_style: { directness, examples },
                    },
                    true,
                  );
                }}
              >
                <Check size={14} /> 保存并重新对话设定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 两步永久删除全部数据确认弹层（确认按钮用 .btn-k 主文字色实底） */}
      {eraseModalOpen && (
        <div className="overlay" onClick={() => setEraseModalOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h3>确认永久删除全部探索数据？</h3>
            <p>
              删除后，你讲述的所有故事、提炼的线索、价值观取舍、测评记录、能量打卡和全部版本画像都会立即从数据库和存储桶中抹除，无法找回。建议删除前先导出一份备份
            </p>

            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-s btn-sm"
                disabled={exporting}
                onClick={handleRunExport}
              >
                <Download size={13} /> 先导出一份完整备份
              </button>
            </div>

            <div style={{ marginTop: 18 }}>
              <label className="mono" style={{ display: 'block', marginBottom: 6 }}>
                请在下方输入「删除」两个字确认操作
              </label>
              <input
                type="text"
                value={eraseInput}
                onChange={(e) => setEraseInput(e.target.value)}
                placeholder="输入：删除"
                style={{
                  width: '100%',
                  height: 40,
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
                disabled={erasing}
                onClick={() => setEraseModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className={`btn ${eraseInput.trim() === '删除' ? 'btn-k' : 'btn-x'}`}
                disabled={eraseInput.trim() !== '删除' || erasing}
                onClick={async () => {
                  setErasing(true);
                  try {
                    await onEraseAllData(eraseInput.trim());
                    setEraseModalOpen(false);
                  } finally {
                    setErasing(false);
                  }
                }}
              >
                {erasing ? '正在彻底删除…' : '永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
