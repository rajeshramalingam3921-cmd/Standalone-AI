import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ChatSendSchema,
  ConversationCreateSchema,
  type AiStatus,
  type ApiError,
  type ChatMessage,
  type ChatStreamEvent,
} from '@thiran/shared';
import { z } from 'zod';
import { buildHistory, buildSystemPrompt, titleFrom } from '../ai/context.js';
import { modelInfo } from '../ai/provider.js';
import { AiAbortedError, AiProviderError, type AiProvider } from '../ai/types.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';

const Uuid = z.uuid();

const err = (reply: FastifyReply, status: number, body: ApiError) =>
  reply.status(status).send(body);

export function registerChatRoutes(
  app: FastifyInstance,
  store: Store,
  config: AppConfig,
  provider: AiProvider,
  now: () => Date = () => new Date(),
): void {
  const allowedModels = new Set(config.AI_MODELS);
  /** Conversations with a reply in progress — prevents duplicate/overlapping generation. */
  const busy = new Set<string>();

  app.get('/api/ai/status', async (): Promise<AiStatus> => ({
    provider: provider.id,
    configured: provider.configured,
    models: modelInfo(config),
    defaultModel: config.AI_DEFAULT_MODEL,
  }));

  async function loadProject(projectId: string) {
    return Uuid.safeParse(projectId).success ? store.getProject(projectId) : undefined;
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/conversations',
    async (req, reply) => {
      if (!(await loadProject(req.params.projectId))) {
        return err(reply, 404, { error: 'not_found', message: 'Project not found.' });
      }
      return store.listConversations(req.params.projectId);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/conversations',
    async (req, reply) => {
      if (!(await loadProject(req.params.projectId))) {
        return err(reply, 404, { error: 'not_found', message: 'Project not found.' });
      }
      const parsed = ConversationCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success || (parsed.data.model && !allowedModels.has(parsed.data.model))) {
        return err(reply, 400, { error: 'validation_error', message: 'Invalid conversation.' });
      }
      const conversation = await store.createConversation(req.params.projectId, {
        title: parsed.data.title,
        model: parsed.data.model ?? config.AI_DEFAULT_MODEL,
      });
      return reply.status(201).send(conversation);
    },
  );

  app.get<{ Params: { projectId: string; conversationId: string } }>(
    '/api/projects/:projectId/conversations/:conversationId/messages',
    async (req, reply) => {
      const { projectId, conversationId } = req.params;
      const ok =
        Uuid.safeParse(conversationId).success &&
        (await loadProject(projectId)) &&
        (await store.getConversation(projectId, conversationId));
      if (!ok) return err(reply, 404, { error: 'not_found', message: 'Conversation not found.' });
      return store.listMessages(conversationId);
    },
  );

  app.post<{ Params: { projectId: string; conversationId: string } }>(
    '/api/projects/:projectId/conversations/:conversationId/messages',
    { config: { rateLimit: { max: config.AI_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { projectId, conversationId } = req.params;
      const project = await loadProject(projectId);
      const conversation =
        project && Uuid.safeParse(conversationId).success
          ? await store.getConversation(projectId, conversationId)
          : undefined;
      if (!project || !conversation) {
        return err(reply, 404, { error: 'not_found', message: 'Conversation not found.' });
      }

      const parsed = ChatSendSchema.safeParse(req.body);
      if (!parsed.success) {
        return err(reply, 400, {
          error: 'validation_error',
          message: 'Some fields are invalid.',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const model = parsed.data.model ?? conversation.model;
      if (!allowedModels.has(model)) {
        return err(reply, 400, { error: 'validation_error', message: 'Model is not allowed.' });
      }
      if (!provider.configured) {
        return err(reply, 503, {
          error: 'ai_not_configured',
          message: 'No AI provider key is configured on the server.',
        });
      }
      if (busy.has(conversationId)) {
        return err(reply, 409, {
          error: 'busy',
          message: 'A reply is already being generated in this conversation.',
        });
      }

      busy.add(conversationId);
      try {
        const history = await store.listMessages(conversationId);
        const userMessage = await store.addMessage({
          id: randomUUID(),
          conversationId,
          role: 'user',
          content: parsed.data.content,
          status: 'complete',
          model: null,
          error: null,
          usage: null,
        });
        const isFirst = history.length === 0;
        await store.touchConversation(
          projectId,
          conversationId,
          isFirst && !conversation.title ? titleFrom(parsed.data.content) : undefined,
        );

        // From here on the response is a Server-Sent Events stream.
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-accel-buffering': 'no',
          connection: 'keep-alive',
        });
        const send = (event: ChatStreamEvent) => {
          if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        const abort = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) abort.abort(); // client stopped or disconnected
        });

        try {
          const assistantId = randomUUID();
          send({ type: 'start', userMessage, assistantMessageId: assistantId, model });

          let text = '';
          let final: ChatMessage;
          try {
            const result = await provider.streamChat({
              model,
              system: buildSystemPrompt(project),
              messages: buildHistory([...history, userMessage], config.AI_HISTORY_MESSAGES),
              signal: abort.signal,
              onText: (t) => {
                text += t;
                send({ type: 'delta', text: t });
              },
            });
            final = await store.addMessage({
              id: assistantId,
              conversationId,
              role: 'assistant',
              content: text,
              status: result.stop,
              model: result.servedModel,
              error: null,
              usage: result.usage,
              createdAt: now().toISOString(),
            });
            send({ type: 'done', message: final });
          } catch (e) {
            const stopped = e instanceof AiAbortedError;
            const code = e instanceof AiProviderError ? e.code : 'unknown';
            if (!stopped && !(e instanceof AiProviderError))
              req.log.error({ err: e }, 'Chat failed');
            if (e instanceof AiProviderError) req.log.warn({ code }, 'AI provider error');
            final = await store.addMessage({
              id: assistantId,
              conversationId,
              role: 'assistant',
              content: text,
              status: stopped ? 'stopped' : 'error',
              model,
              error: stopped ? null : code,
              usage: null,
              createdAt: now().toISOString(),
            });
            if (stopped) send({ type: 'done', message: final });
            else send({ type: 'error', code, message: final });
          }
          await store.touchConversation(projectId, conversationId);
        } catch (e) {
          // Storage failed mid-stream: tell the client instead of leaving it hanging.
          req.log.error({ err: e }, 'Chat persistence failed');
          send({ type: 'error', code: 'unknown', message: null });
        } finally {
          res.end();
        }
      } finally {
        busy.delete(conversationId);
      }
    },
  );
}
