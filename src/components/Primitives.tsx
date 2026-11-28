import React, { useRef, useState } from 'react';
import { Lock, Mic, MicOff, Upload, X } from 'lucide-react';

export function BrandMark() {
  return (
    <span className="mk" aria-hidden="true">
      <i style={{ height: 16 }} />
      <i style={{ height: 11 }} />
      <i style={{ height: 6 }} />
    </span>
  );
}

export function CoachMark({ muted = false }: { muted?: boolean }) {
  const color = muted ? 'var(--page-ink-3)' : 'var(--page-accent)';
  return (
    <span className="mk2" aria-hidden="true">
      <i style={{ height: 14, background: color }} />
      <i style={{ height: 9, background: color }} />
      <i style={{ height: 5, background: color }} />
    </span>
  );
}

export interface TallyStrokeItem {
  kind: 'strong' | 'medium' | 'weak' | 'self' | 'slot';
  isNew?: boolean;
}

export function Tally({
  strokes,
  large = false,
}: {
  strokes: TallyStrokeItem[];
  large?: boolean;
}) {
  const list =
    strokes && strokes.length > 0
      ? strokes
      : [{ kind: 'slot' as const }, { kind: 'slot' as const }, { kind: 'slot' as const }];

  return (
    <span className={`tally${large ? ' lg' : ''}`} aria-label="证据刻痕">
      {list.map((s, idx) => {
        const cls =
          s.kind === 'strong'
            ? 's'
            : s.kind === 'medium'
              ? 'm'
              : s.kind === 'weak'
                ? 'w'
                : s.kind === 'self'
                  ? 'self'
                  : 'slot';
        return <i key={idx} className={`${cls}${s.isNew ? ' new' : ''}`} />;
      })}
    </span>
  );
}

export function GateBars({
  confidence,
  onlyUnmet = false,
}: {
  confidence: any;
  onlyUnmet?: boolean;
}) {
  if (!confidence?.gates) return null;
  const g = confidence.gates;

  const items: Array<{
    key: string;
    label: string;
    pct: number;
    met: boolean;
    valueText: string;
  }> = [
    {
      key: 'n',
      label: '证据数',
      pct: Math.min(100, (g.evidence_count.value / g.evidence_count.target) * 100),
      met: g.evidence_count.met,
      valueText: `${g.evidence_count.value} / ${g.evidence_count.target}`,
    },
    {
      key: 's',
      label: '来源种类',
      pct: Math.min(100, (g.source_kinds.value / g.source_kinds.target) * 100),
      met: g.source_kinds.met,
      valueText: `${g.source_kinds.value} / ${g.source_kinds.target}`,
    },
    {
      key: 'w',
      label: '加权分',
      pct: Math.min(100, (g.weighted_score.value / g.weighted_score.target) * 100),
      met: g.weighted_score.met,
      valueText: `${Number(g.weighted_score.value).toFixed(1)} / ${Number(g.weighted_score.target).toFixed(1)}`,
    },
  ];

  // 05 补充规则 2：只对「优势候选」显示第 4 条门槛「本人经历」
  if (g.own_experience?.applies) {
    items.push({
      key: 'own',
      label: '本人经历',
      pct: g.own_experience.value ? 100 : 0,
      met: g.own_experience.met,
      valueText: g.own_experience.value ? '有' : '无',
    });
  }

  const visible = onlyUnmet ? items.filter((i) => !i.met) : items;
  const toRender = visible.length > 0 ? visible : items;

  return (
    <div>
      {toRender.map((item) => (
        <div className="gate" key={item.key}>
          <span className="lab">{item.label}</span>
          <span className={`bar${item.met ? ' done' : ''}`}>
            <b style={{ width: `${item.pct}%` }} />
          </span>
          <span className="v">{item.valueText}</span>
        </div>
      ))}
    </div>
  );
}

export function ToastNotification({
  toast,
  onUndo,
  onClose,
}: {
  toast: { text: string; undoId?: string | null } | null;
  onUndo: (undoId: string) => void;
  onClose: () => void;
}) {
  if (!toast) return null;
  return (
    <div className="toast-bar" role="status">
      <span>{toast.text}</span>
      {toast.undoId ? (
        <button type="button" onClick={() => onUndo(toast.undoId!)}>
          撤销
        </button>
      ) : (
        <button type="button" onClick={onClose} aria-label="关闭提示">
          知道了
        </button>
      )}
    </div>
  );
}

// F-20 语音输入：转成可编辑文字后再由用户发送
export function VoiceMicButton({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<any>(null);

  const toggleVoice = () => {
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('当前浏览器暂不支持直接语音听写，请使用 Chrome / Safari / Edge 浏览器');
      return;
    }

    if (recording && recRef.current) {
      recRef.current.stop();
      setRecording(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recRef.current = recognition;
    setRecording(true);
    recognition.start();
  };

  return (
    <button
      type="button"
      className="tb"
      onClick={toggleVoice}
      title={recording ? '点击结束说话（文字会填入输入框供你修改）' : '语音输入（转文字后可编辑再发）'}
      style={recording ? { background: 'var(--page-accent-50)', color: 'var(--page-accent)' } : undefined}
    >
      {recording ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
}

// P2.4 测评上传面板（拖入文件 PDF/图片 + 粘贴文字双标签）
export function UploadAssessmentModal({
  open,
  onClose,
  onUpload,
}: {
  open: boolean;
  onClose: () => void;
  onUpload: (payload: {
    fileName?: string;
    mimeType?: string;
    base64Data?: string;
    pastedText?: string;
  }) => Promise<void>;
}) {
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [dragOver, setDragOver] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setErrorMsg('');
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('文件超过 10 MB，请压缩后上传或改用「粘贴文字」');
      return;
    }
    setBusy(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const comma = res.indexOf(',');
          resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      await onUpload({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || '解析未成功，可以改用粘贴文字');
    } finally {
      setBusy(false);
    }
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await onUpload({ pastedText: pastedText.trim(), fileName: '粘贴的测评结果' });
      setPastedText('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || '识别失败，请检查内容');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dlg" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>上传测评报告</h3>
          <button type="button" className="tb" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <p>
          测评是一种参考来源，权重是真实经历的一半。上传后我会用大白话翻译，再和你讲过的故事逐条对照
        </p>

        <div
          style={{
            display: 'flex',
            gap: 20,
            borderBottom: '1px solid var(--page-line)',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            className="btn-t"
            style={{
              height: 36,
              borderRadius: 0,
              color: tab === 'file' ? 'var(--page-ink)' : 'var(--page-ink-3)',
              boxShadow: tab === 'file' ? 'inset 0 -2px 0 var(--page-ink)' : 'none',
            }}
            onClick={() => setTab('file')}
          >
            上传文件
          </button>
          <button
            type="button"
            className="btn-t"
            style={{
              height: 36,
              borderRadius: 0,
              color: tab === 'paste' ? 'var(--page-ink)' : 'var(--page-ink-3)',
              boxShadow: tab === 'paste' ? 'inset 0 -2px 0 var(--page-ink)' : 'none',
            }}
            onClick={() => setTab('paste')}
          >
            粘贴文字
          </button>
        </div>

        {tab === 'file' ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => !busy && fileInputRef.current?.click()}
            style={{
              marginTop: 16,
              height: 168,
              border: `1.5px dashed ${dragOver ? 'var(--page-accent)' : 'var(--page-line-2)'}`,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: dragOver ? 'var(--page-accent-50)' : 'var(--page-bg)',
              cursor: busy ? 'wait' : 'pointer',
              color: 'var(--page-ink-2)',
            }}
          >
            <Upload size={20} />
            <span>{busy ? '正在读取分数 · 约 10–20 秒…' : '拖入报告文件，或点击选择'}</span>
            <span className="mono">PDF 或图片截图 · 最大 10 MB</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={'例如：\n开放性 71\n尽责性 82\n外向性 28\n宜人性 55\n情绪稳定性 54\n\n或直接粘贴 VIA / 盖洛普 / MBTI 结果'}
              style={{
                width: '100%',
                height: 160,
                border: '1px solid var(--page-line-2)',
                borderRadius: 12,
                padding: '12px 14px',
                fontFamily: 'var(--page-mono)',
                fontSize: 12,
                lineHeight: '20px',
                resize: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-p btn-sm"
                disabled={busy || !pastedText.trim()}
                onClick={handlePasteSubmit}
              >
                {busy ? '正在识别…' : '识别这段文字'}
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--page-ink-2)' }}>
            {errorMsg} ·{' '}
            <button
              type="button"
              className="btn-t"
              style={{ color: 'var(--page-accent)', padding: 0, height: 'auto' }}
              onClick={() => setTab('paste')}
            >
              改为粘贴文字
            </button>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            marginTop: 18,
            borderTop: '1px solid var(--page-line)',
            paddingTop: 12,
            gap: 8,
            fontSize: 13,
          }}
        >
          <div>
            大五人格
            <span className="mono" style={{ display: 'block' }}>计入证据</span>
          </div>
          <div>
            VIA 性格优势
            <span className="mono" style={{ display: 'block' }}>计入证据</span>
          </div>
          <div>
            盖洛普优势
            <span className="mono" style={{ display: 'block' }}>计入证据</span>
          </div>
          <div>
            MBTI
            <span className="mono" style={{ display: 'block' }}>只用来聊天</span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 20,
          }}
        >
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} /> 解析后可以选择删除原文件
          </span>
          <button type="button" className="btn btn-s btn-sm" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
