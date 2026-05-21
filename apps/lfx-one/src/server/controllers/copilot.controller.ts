// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CopilotChatRequest, CopilotSSEEventType, FlushableResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { CopilotService } from '../services/copilot.service';
import { logger } from '../services/logger.service';
import { addShutdownHook, isShuttingDown } from '../utils/shutdown';
import { getEffectiveSub } from '../utils/auth-helper';

export class CopilotController {
  private readonly copilotService = new CopilotService();
  private readonly activeStreams = new Set<Response>();

  public constructor() {
    addShutdownHook(() => this.closeAllStreams());
  }

  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

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

    const userId = getEffectiveSub(req) || 'anonymous';

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

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
      abortController.abort();
    });

    const sendEvent = (type: CopilotSSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
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
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  private async closeAllStreams(): Promise<void> {
    const streams = [...this.activeStreams];
    this.activeStreams.clear();
    // 2s per-stream timeout guards against backpressure: if the client's TCP receive
    // buffer is full, res.write()'s flush callback stalls until the buffer drains.
    const STREAM_CLOSE_TIMEOUT_MS = 2_000;
    await Promise.all(
      streams.map(
        (res) =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            const timer = setTimeout(finish, STREAM_CLOSE_TIMEOUT_MS);
            try {
              if (!res.writableEnded) {
                res.write('event: shutdown\ndata: {"reason":"server_shutdown"}\n\n', () => {
                  clearTimeout(timer);
                  res.end(finish);
                });
              } else {
                clearTimeout(timer);
                finish();
              }
            } catch (error) {
              clearTimeout(timer);
              const isExpected = error instanceof Error && (error.message.includes('write after end') || error.message.includes('Cannot call end'));
              if (isExpected) {
                logger.debug(undefined, 'sse_stream_shutdown_close', 'Stream already closed during shutdown', {
                  err: error,
                });
              } else {
                logger.warning(undefined, 'sse_stream_shutdown_close', 'Unexpected error closing SSE stream', {
                  err: error,
                });
              }
              finish();
            }
          })
      )
    );
  }
}
