import React, { useState } from 'react';
import { Ban, Check, Lock, Trash2 } from 'lucide-react';
import { BrandMark } from '../components/Primitives.tsx';
import {
  checkEmailWhitelist,
  getBrowserSupabase,
  setStoredAuthSession,
} from '../lib/api.ts';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> | void }) {
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [localFallbackToken, setLocalFallbackToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hintMsg, setHintMsg] = useState('');

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setErrorMsg('');
    setHintMsg('');
    setBusy(true);
    try {
      const check = await checkEmailWhitelist(trimmed);
      if (check.localToken) {
        setLocalFallbackToken(check.localToken);
      }
      if (check.allowLocalDirect && check.localToken) {
        setOtpSent(true);
        setHintMsg(`受邀白名单已确认（${trimmed}），本地环境可直接进入或填写邮箱验证码`);
        return;
      }
      const sb = getBrowserSupabase();
      if (sb) {
        const { error } = await sb.auth.signInWithOtp({
          email: trimmed,
          options: { shouldCreateUser: true },
        });
        if (error) {
          throw new Error(error.message);
        }
      }
      setOtpSent(true);
      setHintMsg(`验证码已发送至 ${trimmed}，30 天内免重复登录`);
    } catch (err: any) {
      setErrorMsg(err?.message || '发送验证码失败');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      const sb = getBrowserSupabase();
      if (sb && otpCode.trim()) {
        const { data, error } = await sb.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: otpCode.trim(),
          type: 'email',
        });
        if (!error && data?.session?.access_token) {
          setStoredAuthSession(data.session.access_token, email.trim().toLowerCase());
          await onLoggedIn();
          return;
        }
        if (error && !localFallbackToken) {
          throw new Error('验证码不正确或已过期');
        }
      }
      if (localFallbackToken) {
        setStoredAuthSession(localFallbackToken, email.trim().toLowerCase());
        await onLoggedIn();
        return;
      }
      throw new Error('请输入邮箱收到的 6 位验证码');
    } catch (err: any) {
      setErrorMsg(err?.message || '验证失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--page-bg)' }}>
      <header className="hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark />
          <b style={{ fontSize: 16, fontWeight: 500 }}>照见</b>
        </div>
        <span className="mono">私密探索空间</span>
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 20px',
        }}
      >
        <div className="card" style={{ width: '100%', maxWidth: 420 }}>
          <span className="mono">账号验证</span>
          <h1 style={{ margin: '8px 0 8px', fontSize: 24, lineHeight: '32px', fontWeight: 500 }}>
            登录你的自我探索档案
          </h1>
          <p className="c2" style={{ margin: '0 0 24px', fontSize: 14 }}>
            你讲述的经历和画像高度私密，仅受邀邮箱可访问，数据全程加密存储
          </p>

          {!otpSent ? (
            <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>
                  受邀邮箱
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="输入你的个人邮箱"
                  style={{
                    width: '100%',
                    height: 42,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 14,
                    background: 'var(--page-surface)',
                  }}
                />
              </div>
              {errorMsg && <div style={{ fontSize: 13, color: 'var(--page-ink-2)' }}>{errorMsg}</div>}
              <button
                type="submit"
                className="btn btn-p btn-lg"
                disabled={busy || !email.trim()}
                style={{ width: '100%', marginTop: 4 }}
              >
                {busy ? '正在验证邮箱…' : '发送登录验证码'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {hintMsg && <div className="mono" style={{ lineHeight: '18px' }}>{hintMsg}</div>}
              <div>
                <label className="mono" style={{ display: 'block', marginBottom: 6 }}>
                  邮箱验证码
                </label>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="输入 6 位验证码"
                  style={{
                    width: '100%',
                    height: 42,
                    border: '1px solid var(--page-line-2)',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontFamily: 'var(--page-mono)',
                    fontSize: 15,
                    letterSpacing: '0.12em',
                    background: 'var(--page-surface)',
                  }}
                />
              </div>
              {errorMsg && <div style={{ fontSize: 13, color: 'var(--page-ink-2)' }}>{errorMsg}</div>}
              <button
                type="submit"
                className="btn btn-p btn-lg"
                disabled={busy || (!otpCode.trim() && !localFallbackToken)}
                style={{ width: '100%' }}
              >
                {busy ? '正在进入…' : otpCode.trim() ? '验证并进入' : '本地受邀邮箱直接进入'}
              </button>
              <button
                type="button"
                className="btn btn-t"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode('');
                }}
              >
                更换邮箱或重新发送
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

// P0.1 欢迎与隐私说明（完全对齐第 5 批画板：桌面左右双栏 + 移动单栏，未勾选禁用并注明原因）
export function WelcomeConsentScreen({
  onAgreeAndStart,
}: {
  onAgreeAndStart: () => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [showFullPolicy, setShowFullPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleStart = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    try {
      await onAgreeAndStart();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--page-bg)' }}>
      <header className="hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark />
          <b style={{ fontSize: 16, fontWeight: 500 }}>照见</b>
        </div>
        <span className="mono">第一次使用</span>
      </header>

      <main
        style={{
          flex: 1,
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
          padding: '64px 32px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 64,
          alignItems: 'start',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 38, lineHeight: '48px', fontWeight: 500, letterSpacing: '-0.01em' }}>
            通过你讲的真实经历，一点点整理出你的优势和短板
          </h1>
          <p className="c2" style={{ margin: '20px 0 0', fontSize: 17, lineHeight: '28px', maxWidth: '30em' }}>
            我会像教练一样提问、追问，把你说过的话记成证据。一条结论要在不同的故事和来源里反复出现，才会写进你的画像
          </p>

          <ul style={{ listStyle: 'none', margin: '40px 0 0', padding: 0, borderTop: '1px solid var(--page-line)' }}>
            {[
              ['多久', '大约 2–4 周，每次 10–15 分钟，随时可以停'],
              ['做什么', '讲几个高光和低谷的故事，做一次价值观取舍，可以上传测评'],
              ['得到什么', '一份每条结论都能查到依据的个人画像，你可以修改或推翻其中任何一条'],
              ['不是什么', '不是心理咨询，也不做诊断。遇到很难受的时候，我会建议你找专业的人'],
            ].map(([k, v]) => (
              <li
                key={k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px 1fr',
                  gap: 16,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--page-line)',
                  fontSize: 14,
                }}
              >
                <span className="c3" style={{ fontSize: 13 }}>{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, lineHeight: '26px', fontWeight: 500 }}>
            开始前，先说清楚你的数据
          </h3>
          <span className="mono">隐私</span>

          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            <li
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: 12,
                padding: '14px 0',
                borderBottom: '1px solid var(--page-line)',
              }}
            >
              <Lock size={16} color="var(--page-ink-3)" style={{ marginTop: 3 }} />
              <div>
                <b style={{ display: 'block', fontWeight: 500 }}>只用于帮你分析</b>
                <span className="c2" style={{ fontSize: 13 }}>只有你能看到你讲的故事和画像，敏感原话加密保存</span>
              </div>
            </li>
            <li
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: 12,
                padding: '14px 0',
                borderBottom: '1px solid var(--page-line)',
              }}
            >
              <Ban size={16} color="var(--page-ink-3)" style={{ marginTop: 3 }} />
              <div>
                <b style={{ display: 'block', fontWeight: 500 }}>不会拿去训练模型</b>
                <span className="c2" style={{ fontSize: 13 }}>这一项默认关闭，且不能被打开</span>
              </div>
            </li>
            <li
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: 12,
                padding: '14px 0',
                borderBottom: '1px solid var(--page-line)',
              }}
            >
              <Trash2 size={16} color="var(--page-ink-3)" style={{ marginTop: 3 }} />
              <div>
                <b style={{ display: 'block', fontWeight: 500 }}>随时可以删除</b>
                <span className="c2" style={{ fontSize: 13 }}>可以删掉任何一个故事，也可以一次删除全部数据</span>
              </div>
            </li>
          </ul>

          {showFullPolicy && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--page-raised)',
                fontSize: 13,
                lineHeight: '20px',
                color: 'var(--page-ink-2)',
              }}
            >
              <b>完整隐私与数据安全说明</b>
              <p style={{ margin: '6px 0 0' }}>
                1. 存储加密：你讲述的故事 STAR 内容、证据原话摘录、能量打卡与反馈回复均通过 AES-256-GCM 加密后存入独立隔离的数据库。
                <br />
                2. 模型与日志：采用企业级隔离接口处理对话，不使用你的任何输入训练模型；服务端运行日志不记录任何对话原文，安全守护仅记录风险类别。
                <br />
                3. 导出与销毁：你可随时在「设置 · 隐私与数据」导出完整 JSON 与可读 Markdown；执行「删除全部数据」后将立即硬删除业务表与附件原件，数据库底层滚动备份最长不超过 30 天自动覆盖销毁。
              </p>
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label
              onClick={() => setChecked((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 13,
                lineHeight: '20px',
                color: 'var(--page-ink-2)',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${checked ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
                  background: checked ? 'var(--page-accent)' : 'transparent',
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                  marginTop: 2,
                }}
              >
                {checked && <Check size={11} color="#fff" strokeWidth={3} />}
              </span>
              <span>我知道这不是心理咨询，情绪很难受时会寻求专业帮助</span>
            </label>

            <button
              type="button"
              className={`btn ${checked ? 'btn-p' : 'btn-x'} btn-lg`}
              disabled={!checked || submitting}
              onClick={handleStart}
              style={{ width: '100%' }}
            >
              {submitting ? '正在准备第一次对话…' : '同意并开始'}
            </button>

            {!checked && (
              <span className="mono" style={{ textAlign: 'center' }}>
                先勾选上面一项才可开始
              </span>
            )}

            <button
              type="button"
              className="btn btn-t"
              style={{ alignSelf: 'center' }}
              onClick={() => setShowFullPolicy((v) => !v)}
            >
              {showFullPolicy ? '收起完整隐私说明' : '阅读完整隐私说明'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
