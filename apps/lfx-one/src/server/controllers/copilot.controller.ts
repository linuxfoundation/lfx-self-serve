// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CopilotChatRequest, CopilotSSEEventType, FlushableResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { CopilotService } from '../services/copilot.service';
import { logger } from '../services/logger.service';

export class CopilotController {
  private readonly copilotService = new CopilotService();

  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { message, sessionId, context } = req.body as CopilotChatRequest;

    if (!message || typeof message !== 'string' || !message.trim()) {
      const validationError = ServiceValidationError.forField('message', 'message is required and must be a non-empty string', {
        operation: 'copilot_chat',
        service: 'copilot_controller',
        path: req.path,
      });
      next(validationError);
      return;
    }

    // Sanitize optional fields — only forward valid types to upstream
    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    const validContext = context && typeof context === 'object' && !Array.isArray(context) ? context : undefined;

    const userId = (req.oidc?.user?.['sub'] as string) || 'anonymous';

    const startTime = logger.startOperation(req, 'copilot_chat', {
      has_session: !!validSessionId,
      has_context: !!validContext,
    });

    // SSE headers — Content-Encoding: identity bypasses compression middleware
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Disable Nagle's algorithm — send each SSE event immediately instead of
    // batching small writes into larger TCP packets
    res.socket?.setNoDelay(true);

    const abortController = new AbortController();
    let clientDisconnected = false;

    res.on('close', () => {
      clientDisconnected = true;
      abortController.abort();
    });

    const sendEvent = (type: CopilotSSEEventType, data: unknown): void => {
      if (clientDisconnected) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      sendEvent('status', 'Understanding your question...');

      let blockCount = 0;
      let resolvedSessionId: string | undefined;

      for await (const event of this.copilotService.streamQuery(
        req,
        { message, userId, sessionId: validSessionId, context: validContext },
        abortController.signal
      )) {
        if (clientDisconnected) return;

        if (event.type === 'session_id') {
          resolvedSessionId = event.data as string;
        }
        if (event.type === 'block' || event.type === 'content') {
          blockCount++;
        }

        sendEvent(event.type, event.data);
      }

      logger.success(req, 'copilot_chat', startTime, {
        session_id: resolvedSessionId,
        block_count: blockCount,
      });
    } catch (error) {
      if (clientDisconnected) return;
      logger.error(req, 'copilot_chat', startTime, error, { user_id: userId });
      sendEvent('error', 'Something went wrong. Please try again.');
    } finally {
      if (!clientDisconnected) {
        res.end();
      }
    }
  }
}
