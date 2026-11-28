import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  VALUES_POOL_30,
  disposeAssessmentRawFileTool,
  parseAndCreateAssessmentTool,
  respondAssessmentComparisonTool,
  startOrUpdateValuesTool,
} from './assessment-values.ts';
import {
  finishConversationSession,
  processUserTurn,
  startOrResumeConversation,
} from './coach-orchestrator.ts';
import { encryptText } from './crypto.ts';
import { buildPortraitDocxBase64 } from './docx-export.ts';
import {
  confirmPortraitSectionTool,
  renderPortraitMarkdown,
  runPortraitGenerationStep,
  startOrGetPortraitDraft,
} from './portrait-builder.ts';
import { getRuntimeDb } from './runtime-db.ts';
import { REGIONAL_HOTLINES } from './safety.ts';
import { createServiceSupabase, decodeMessageRow } from './store.ts';
import {
  addEvidenceTool,
  createClueTool,
  deleteStoryTool,
  eraseAllDataTool,
  exportAllDataTool,
  getFullWorkspaceState,
  recordMergeTool,
  respondToClueTool,
  restoreArchivedClueTool,
  reviewMergeTool,
  saveEnergyLogTool,
  saveFeedbackResponseTool,
  saveStoryTool,
  setEvidenceActiveTool,
  undoChangeTool,
  updateProfileTool,
} from './tools.ts';

interface AuthenticatedIdentity {
  userId: string;
  email: string;
  isRecentAuth: boolean;
}

function deterministicUuidFromEmail(email: string): string {
  const hex = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isEmailWhitelisted(email: string): boolean {
  const raw = (process.env.ALLOWED_USER_EMAILS || '').trim();
  if (!raw) return true;
  const allowed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(email.trim().toLowerCase());
}

async function resolveAuth(req: IncomingMessage): Promise<AuthenticatedIdentity> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw Object.assign(new Error('请先登录'), { statusCode: 401 });
  }

  // 本地开发专用快速会话（仅非 Vercel 生产环境且仅限白名单邮箱）
  if (!process.env.VERCEL && token.startsWith('localdev:')) {
    const email = Buffer.from(token.slice('localdev:'.length), 'base64url').toString('utf8');
    if (!email || !isEmailWhitelisted(email)) {
      throw Object.assign(new Error('该邮箱不在允许访问的白名单中'), { statusCode: 403 });
    }
    return {
      userId: deterministicUuidFromEmail(email),
      email,
      isRecentAuth: true,
    };
  }

  const sb = createServiceSupabase();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    throw Object.assign(new Error('登录状态已过期，请重新验证邮箱'), { statusCode: 401 });
  }

  const email = data.user.email || '';
  if (!isEmailWhitelisted(email)) {
    throw Object.assign(new Error('该账号不在受邀白名单中'), { statusCode: 403 });
  }

  let isRecentAuth = true;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (Array.isArray(claims.amr)) {
        isRecentAuth = claims.amr.some(
          (a: any) => typeof a.timestamp === 'number' && a.timestamp * 1000 >= Date.now() - 30 * 60 * 1000,
        );
      }
    }
  } catch {
    isRecentAuth = true;
  }

  return {
    userId: data.user.id,
    email,
    isRecentAuth,
  };
}

async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function handleAppApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const urlObj = new URL(req.url || '/api/app', 'http://localhost');

    // 登录前白名单预检接口（不泄露白名单本身，仅返回该邮箱是否受邀及是否允许本地开发快捷验证码）
    if (req.method === 'POST' && urlObj.searchParams.get('public') === 'check-email') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return sendJson(res, 400, { error: '请输入有效的邮箱地址' });
      }
      if (!isEmailWhitelisted(email)) {
        return sendJson(res, 403, { error: 'V0.5 仅供产品负责人自用，该邮箱不在受邀名单内' });
      }
      const allowLocalDirect = !process.env.VERCEL;
      return sendJson(res, 200, {
        allowed: true,
        allowLocalDirect,
        localToken: allowLocalDirect
          ? `localdev:${Buffer.from(email, 'utf8').toString('base64url')}`
          : undefined,
      });
    }

    const identity = await resolveAuth(req);
    const { db, mode: dbMode } = await getRuntimeDb(identity.userId);

    if (req.method === 'GET') {
      const state = await getFullWorkspaceState(db, identity.userId);
      const convId = urlObj.searchParams.get('conversationId');
      let activeMessages: any[] = [];
      if (convId) {
        const { data: rows } = await db
          .from('messages')
          .select('*')
          .eq('user_id', identity.userId)
          .eq('conversation_id', convId)
          .order('seq', { ascending: true });
        activeMessages = (rows || []).map(decodeMessageRow);
      }

      return sendJson(res, 200, {
        user: { id: identity.userId, email: identity.email },
        dbMode,
        state,
        activeMessages,
        hotlines: REGIONAL_HOTLINES,
        valuesPool: VALUES_POOL_30,
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: '不支持的请求方法' });
    }

    const body = await readJsonBody(req);
    const action = String(body.action || '');

    switch (action) {
      case 'consent_and_start': {
        const defaultNick = identity.email.split('@')[0] || '探索者';
        await updateProfileTool(
          db,
          identity.userId,
          {
            consented: true,
            ...(body.nickname ? { nickname: String(body.nickname) } : { nickname: defaultNick }),
          },
          body.requestId,
        );
        const started = await startOrResumeConversation(db, identity.userId, {
          skill: '目标设定',
        });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...started, state });
      }

      case 'update_profile': {
        await updateProfileTool(db, identity.userId, body.patch || {}, body.requestId);
        let restartedConv = null;
        if (body.restartGoalSetup) {
          restartedConv = await startOrResumeConversation(db, identity.userId, {
            skill: '目标设定',
            forceNew: true,
          });
        }
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { state, restartedConv });
      }

      case 'start_conversation': {
        const result = await startOrResumeConversation(db, identity.userId, {
          skill: body.skill,
          mode: body.mode,
          focusClueId: body.focusClueId,
          starterPrompt: body.starterPrompt,
          forceNew: Boolean(body.forceNew),
          conversationId: body.conversationId,
        });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...result, state });
      }

      case 'finish_conversation': {
        const result = await finishConversationSession(db, identity.userId, body.conversationId);
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...result, state });
      }

      case 'respond_inline_card': {
        const { messageId, cardIndex, cardAction, payload } = body;
        const { data: msgRow, error } = await db
          .from('messages')
          .select('*')
          .eq('user_id', identity.userId)
          .eq('id', messageId)
          .single();
        if (error || !msgRow) throw new Error('未找到对应消息卡片');

        const cards = [...(msgRow.inline_cards || [])];
        const card = { ...(cards[cardIndex] || {}) };
        const followUpCards: any[] = [];
        let followUpText = '';

        if (card.type === 'clue_card') {
          if (cardAction === 'agree') {
            const r = await respondToClueTool(db, identity.userId, {
              clueId: card.clueId,
              stance: '认同',
            });
            card.status = 'agreed';
            card.tally = r.confidence.tallyStrokes;
            if (r.previousLevel !== '高' && r.confidence.level === '高') {
              followUpCards.push({
                type: 'level_change',
                direction: 'up',
                clueId: r.clue.id,
                statement: r.clue.user_statement || r.clue.statement,
                detail: `${r.confidence.N} 条证据，加权分 ${r.confidence.W_plus.toFixed(1)}`,
                tally: r.confidence.tallyStrokes,
              });
            }
          } else if (cardAction === 'rewrite') {
            const r = await respondToClueTool(db, identity.userId, {
              clueId: card.clueId,
              stance: '部分认同',
              userStatement: payload?.statement,
            });
            await respondToClueTool(db, identity.userId, {
              clueId: card.clueId,
              stance: '认同',
              userStatement: payload?.statement,
            });
            card.status = 'rewritten';
            card.statement = r.clue.user_statement || card.statement;
          } else if (cardAction === 'deny') {
            const r = await respondToClueTool(db, identity.userId, {
              clueId: card.clueId,
              stance: '否认',
            });
            card.status = 'denied';
            card.archived = r.confidence.level === '已归档';
            if (r.confidence.level === '已归档') {
              followUpText = '明白，这条我不再提了。';
            } else {
              followUpText = '那你觉得更准确的说法是什么？';
              const { data: conv } = await db
                .from('conversations')
                .select('context')
                .eq('user_id', identity.userId)
                .eq('id', msgRow.conversation_id)
                .single();
              await db
                .from('conversations')
                .update({
                  context: { ...(conv?.context || {}), awaitingAlternativeAfterDeny: true },
                })
                .eq('user_id', identity.userId)
                .eq('id', msgRow.conversation_id);
            }
          }
        } else if (card.type === 'merge_notice' && card.mode === 'ask') {
          if (cardAction === 'merge') {
            const evRes = await addEvidenceTool(db, identity.userId, {
              clueId: card.targetClueId,
              sourceType: '经历',
              sourceRef: card.storyId,
              sourceTitle: card.storyTitle,
              storyId: card.storyId,
              excerpt: card.excerpt,
              interpretation: `用户同意将「${card.candidateStatement}」并入`,
              strength: card.strength || '中',
              userConfirmed: true,
              createdBy: '经历挖掘',
            });
            await recordMergeTool(db, identity.userId, {
              targetClueId: card.targetClueId,
              mergedStatement: card.candidateStatement,
              mergedType: card.candidateType || '行为模式',
              mergedDimension: card.candidateDimension || '能力',
              sourceStoryTitle: card.storyTitle,
              evidenceId: evRes.evidence.id,
              autoMerged: false,
            });
            card.status = 'merged';
          } else {
            const sep = await createClueTool(db, identity.userId, {
              statement: card.candidateStatement,
              type: card.candidateType || '行为模式',
              dimension: card.candidateDimension || '能力',
              createdBy: '经历挖掘',
              userStance: '认同',
              relatedClues: [{ clue_id: card.targetClueId, relation: '相关' }],
            });
            await addEvidenceTool(db, identity.userId, {
              clueId: sep.id,
              sourceType: '经历',
              sourceRef: card.storyId,
              sourceTitle: card.storyTitle,
              storyId: card.storyId,
              excerpt: card.excerpt,
              interpretation: '用户选择分开单独记录',
              strength: card.strength || '中',
              userConfirmed: true,
              createdBy: '经历挖掘',
            });
            card.status = 'separated';
          }
        } else if (card.type === 'goal_summary') {
          const fields = payload?.fields || card.fields || {};
          await updateProfileTool(
            db,
            identity.userId,
            {
              reason: fields.reason || '',
              current_puzzle: fields.current_puzzle || '',
              goal: fields.goal || '职业方向的参考',
              comm_style: {
                directness: fields.directness || '直接',
                examples: fields.examples || '要',
              },
              consented: true,
              completeGoalSetup: true,
            },
            `goal_card_${messageId}`,
          );
          card.status = 'confirmed';
          card.fields = fields;
          await db
            .from('conversations')
            .update({ status: '已结束', ended_at: new Date().toISOString() })
            .eq('user_id', identity.userId)
            .eq('id', msgRow.conversation_id);
        } else if (card.type === 'safety_card' && cardAction === 'ack_safe') {
          card.acknowledgedSafe = true;
          followUpText = '好，谢谢你告诉我。热线一直在上面，需要的时候随时可以打。你想说说今天发生了什么吗？';
        }

        cards[cardIndex] = card;
        await db
          .from('messages')
          .update({ inline_cards: cards })
          .eq('user_id', identity.userId)
          .eq('id', messageId);

        if (followUpText || followUpCards.length > 0) {
          const { count } = await db
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', identity.userId)
            .eq('conversation_id', msgRow.conversation_id);
          await db.from('messages').insert({
            user_id: identity.userId,
            conversation_id: msgRow.conversation_id,
            seq: (count || 0) + 1,
            role: 'coach',
            content_encrypted: encryptText(followUpText),
            inline_cards: followUpCards,
          });
        }

        const { data: msgRows } = await db
          .from('messages')
          .select('*')
          .eq('user_id', identity.userId)
          .eq('conversation_id', msgRow.conversation_id)
          .order('seq', { ascending: true });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, {
          messages: (msgRows || []).map(decodeMessageRow),
          state,
        });
      }

      case 'clue_action': {
        let toastUndoId: string | null = null;
        if (body.subAction === 'respond') {
          const r = await respondToClueTool(
            db,
            identity.userId,
            {
              clueId: body.clueId,
              stance: body.stance,
              userStatement: body.userStatement,
              denyNote: body.denyNote,
            },
            body.requestId,
          );
          toastUndoId = r.changeLog.id;
        } else if (body.subAction === 'restore') {
          await restoreArchivedClueTool(db, identity.userId, body.clueId, body.requestId);
        } else if (body.subAction === 'evidence_active') {
          const r = await setEvidenceActiveTool(
            db,
            identity.userId,
            body.evidenceId,
            Boolean(body.isActive),
            body.requestId,
          );
          toastUndoId = r.changeLog.id;
        } else if (body.subAction === 'review_merge') {
          await reviewMergeTool(
            db,
            identity.userId,
            { mergeId: body.mergeId, decision: body.decision },
            body.requestId,
          );
        } else if (body.subAction === 'undo') {
          await undoChangeTool(db, identity.userId, body.changeLogId);
        }

        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { state, toastUndoId });
      }

      case 'story_action': {
        if (body.subAction === 'update_title') {
          const stateBefore = await getFullWorkspaceState(db, identity.userId);
          const target = stateBefore.stories.find((s) => s.id === body.storyId);
          if (!target) throw new Error('未找到该故事');
          await saveStoryTool(db, identity.userId, {
            storyId: target.id,
            mode: target.mode,
            title: String(body.title || target.title),
            period: target.period,
            domain: target.domain,
            star: target.star,
            keyMoment: target.key_moment,
            emotionIntensity: target.emotion_intensity,
            completeness: target.completeness,
          });
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { state });
        }

        if (body.subAction === 'delete_preview') {
          const preview = await deleteStoryTool(db, identity.userId, body.storyId, {
            preview: true,
          });
          return sendJson(res, 200, { preview });
        }

        if (body.subAction === 'delete_confirm') {
          const result = await deleteStoryTool(db, identity.userId, body.storyId, {
            preview: false,
            requestId: body.requestId,
          });
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { result, state });
        }

        throw new Error('未知的故事操作');
      }

      case 'values_action': {
        const result = await startOrUpdateValuesTool(db, identity.userId, body.payload);
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...result, state });
      }

      case 'assessment_upload': {
        const assessment = await parseAndCreateAssessmentTool(db, identity.userId, {
          fileName: body.fileName,
          mimeType: body.mimeType,
          base64Data: body.base64Data,
          pastedText: body.pastedText,
        });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { assessment, state });
      }

      case 'assessment_respond': {
        const result = await respondAssessmentComparisonTool(db, identity.userId, {
          assessmentId: body.assessmentId,
          comparisonId: body.comparisonId,
          action: body.responseAction,
          userText: body.userText,
        });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...result, state });
      }

      case 'assessment_dispose_file': {
        const result = await disposeAssessmentRawFileTool(db, identity.userId, {
          assessmentId: body.assessmentId,
          deleteFile: Boolean(body.deleteFile),
          rememberChoice: body.rememberChoice !== false,
        });
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { ...result, state });
      }

      case 'portrait_action': {
        if (body.subAction === 'start_draft') {
          const draft = await startOrGetPortraitDraft(
            db,
            identity.userId,
            body.triggerReason || '用户要求',
          );
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { portrait: draft, state });
        }

        if (body.subAction === 'set_step') {
          const { data } = await db
            .from('portraits')
            .update({ flow_step: body.step, updated_at: new Date().toISOString() })
            .eq('user_id', identity.userId)
            .eq('version', body.version)
            .select('*')
            .single();
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { portrait: data, state });
        }

        if (body.subAction === 'generate') {
          const portrait = await runPortraitGenerationStep(
            db,
            identity.userId,
            Number(body.version),
          );
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { portrait, state });
        }

        if (body.subAction === 'confirm_section') {
          const portrait = await confirmPortraitSectionTool(db, identity.userId, {
            version: Number(body.version),
            section: Number(body.section),
            editedClaimId: body.editedClaimId,
            editedText: body.editedText,
            editedBestState: body.editedBestState,
          });
          const state = await getFullWorkspaceState(db, identity.userId);
          return sendJson(res, 200, { portrait, state });
        }

        if (body.subAction === 'export') {
          const state = await getFullWorkspaceState(db, identity.userId);
          const target =
            state.portraits.find((p) => p.version === Number(body.version)) || state.portraits[0];
          if (!target) throw new Error('还没有可导出的画像');
          const includeExcerpts = Boolean(body.includeExcerpts);
          const md = renderPortraitMarkdown(target, includeExcerpts);
          if (body.format === 'docx') {
            const docxBase64 = await buildPortraitDocxBase64(target, includeExcerpts);
            return sendJson(res, 200, { format: 'docx', base64: docxBase64, fileName: `照见_个人画像_v${target.version}.docx` });
          }
          return sendJson(res, 200, {
            format: body.format || 'markdown',
            text: md,
            fileName: `照见_个人画像_v${target.version}.md`,
          });
        }

        throw new Error('未知的画像操作');
      }

      case 'energy_save': {
        if (body.dismissNudge) {
          const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await db
            .from('progress')
            .update({ dismissed_reminder_nudge_until: until })
            .eq('user_id', identity.userId);
        } else {
          await saveEnergyLogTool(db, identity.userId, {
            logDate: body.logDate,
            score: Number(body.score),
            chargeEvent: body.chargeEvent,
            drainEvent: body.drainEvent,
            note: body.note,
          });
        }
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { state });
      }

      case 'feedback_action': {
        if (body.subAction === 'save_request') {
          await db.from('feedback_requests').insert({
            user_id: identity.userId,
            mode: body.mode || '匿名',
            questions: body.questions || [],
            planned_relations: body.plannedRelations || {},
            sent_at: new Date().toISOString(),
          });
        } else if (body.subAction === 'import_response') {
          await saveFeedbackResponseTool(db, identity.userId, {
            relation: body.relation || '同事',
            content: String(body.content || ''),
            summary: body.summary,
          });
        }
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { state });
      }

      case 'privacy_export': {
        if (!identity.isRecentAuth && !body.reverified) {
          return sendJson(res, 401, { error: '为保护隐私，导出全部数据前请先重新验证登录状态', requireReauth: true });
        }
        const exported = await exportAllDataTool(db, identity.userId);
        return sendJson(res, 200, exported);
      }

      case 'privacy_erase': {
        if (!identity.isRecentAuth && !body.reverified) {
          return sendJson(res, 401, { error: '为保护安全，删除全部数据前请先重新验证登录状态', requireReauth: true });
        }
        if (body.confirmation !== '删除') {
          return sendJson(res, 400, { error: '请输入「删除」两个字以确认永久清空' });
        }
        await eraseAllDataTool(db, identity.userId);
        const state = await getFullWorkspaceState(db, identity.userId);
        return sendJson(res, 200, { erased: true, state });
      }

      default:
        return sendJson(res, 400, { error: `未知请求动作: ${action}` });
    }
  } catch (err: any) {
    const status = err?.statusCode || 400;
    return sendJson(res, status, { error: err?.message || '请求处理失败，请稍后重试' });
  }
}

export async function handleStreamApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const identity = await resolveAuth(req);
    const { db } = await getRuntimeDb(identity.userId);
    const body = await readJsonBody(req);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const turnResult = await processUserTurn(
      db,
      identity.userId,
      {
        conversationId: String(body.conversationId || ''),
        text: String(body.text || ''),
        skipLowTopic: Boolean(body.skipLowTopic),
      },
      (chunk) => {
        writeEvent('chunk', { text: chunk });
      },
    );

    const { data: msgRows } = await db
      .from('messages')
      .select('*')
      .eq('user_id', identity.userId)
      .eq('conversation_id', turnResult.conversation.id)
      .order('seq', { ascending: true });

    const state = await getFullWorkspaceState(db, identity.userId);

    writeEvent('complete', {
      conversation: turnResult.conversation,
      messages: (msgRows || []).map(decodeMessageRow),
      safetyTriggered: turnResult.safetyTriggered || 'none',
      completedGoalSetup: Boolean(turnResult.completedGoalSetup),
      state,
    });
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      return sendJson(res, err?.statusCode || 400, { error: err?.message || '对话生成失败' });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message || '我刚才没想好，再试一次' })}\n\n`);
    res.end();
  }
}
