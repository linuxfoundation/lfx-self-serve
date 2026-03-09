// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LENS_CONFIG } from '@lfx-one/shared/constants';
import { LensBlock, LensQueryParams, LensSSEEvent, LfxLensApiResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

export class LensService {
  private get apiUrl(): string {
    return process.env['LENS_API_URL'] || LENS_CONFIG.DEFAULT_API_URL;
  }

  private get apiKey(): string {
    return process.env['LENS_API_KEY'] || '';
  }

  /**
   * Stream query — tries stream=true first. If the upstream returns a non-streaming
   * JSON response (e.g. when they don't support streaming yet), falls back to
   * parsing the full response and yielding blocks.
   */
  public async *streamQuery(req: Request, params: LensQueryParams, abortSignal?: AbortSignal): AsyncGenerator<LensSSEEvent> {
    logger.debug(req, 'lens_stream_query', 'Calling LFX Lens API (stream=true)', {
      user_id: params.userId,
      has_session: !!params.sessionId,
      has_context: !!params.context,
    });

    const formData = new FormData();
    formData.append('message', params.message);
    formData.append('stream', 'true');
    formData.append('user_id', params.userId);

    if (params.sessionId) {
      formData.append('session_id', params.sessionId);
    }

    if (params.context) {
      formData.append('additional_data', JSON.stringify(params.context));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LENS_CONFIG.REQUEST_TIMEOUT_MS);

    // Link caller's abort signal
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const url = `${this.apiUrl}${LENS_CONFIG.WORKFLOW_PATH}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LFX Lens API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const contentType = response.headers.get('content-type') || '';

      // If upstream returns SSE stream, read it chunk by chunk
      if (contentType.includes('text/event-stream') && response.body) {
        yield* this.readUpstreamSSE(req, response);
      } else {
        // Fallback: upstream returned JSON (stream=false behavior)
        yield* this.handleSyncResponse(req, response);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Read upstream SSE stream from LFX Lens API and re-emit as our normalized events.
   * The upstream sends workflow events (WorkflowStarted, StepStarted, RunContent, etc.)
   * which are translated to our status/content/block/session_id/done/error types.
   */
  private async *readUpstreamSSE(req: Request, response: globalThis.Response): AsyncGenerator<LensSSEEvent> {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;

          for (const event of this.parseUpstreamSSEBlock(block)) {
            yield event;
          }
        }
      }

      // Flush any remaining multibyte characters from the decoder
      buffer += decoder.decode();

      // Handle remaining buffer
      if (buffer.trim()) {
        for (const event of this.parseUpstreamSSEBlock(buffer)) {
          yield event;
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }

    logger.debug(req, 'lens_stream_query', 'Upstream SSE stream completed');
  }

  /**
   * Fallback: parse a synchronous JSON response and yield blocks individually.
   */
  private async *handleSyncResponse(req: Request, fetchResponse: globalThis.Response): AsyncGenerator<LensSSEEvent> {
    const result = (await fetchResponse.json()) as LfxLensApiResponse;

    if (result.status === 'ERROR') {
      throw new Error(`LFX Lens workflow error: ${JSON.stringify(result.content)}`);
    }

    logger.debug(req, 'lens_stream_query', 'LFX Lens API sync response received', {
      session_id: result.session_id,
      run_id: result.run_id,
      block_count: result.content?.blocks?.length ?? 0,
    });

    yield { type: 'session_id', data: result.session_id };

    const blocks = result.content?.blocks ?? [];
    for (const block of blocks) {
      // For message blocks, emit as content events (character-streamable on the client)
      if (block.type === 'message') {
        yield { type: 'content', data: block.content };
      } else {
        yield { type: 'block', data: block };
      }
    }

    yield { type: 'done', data: '' };
  }

  /**
   * Parse a raw SSE text block into zero or more normalized LensSSEEvents.
   *
   * The upstream Lens API sends workflow-level events (WorkflowStarted, StepStarted,
   * RunContent, WorkflowCompleted, etc.) — NOT the simple status/content/block/done
   * events our client expects. This method translates between the two.
   */
  private parseUpstreamSSEBlock(block: string): LensSSEEvent[] {
    let eventType = '';
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5));
      }
    }

    if (!eventType && dataLines.length === 0) return [];

    const data = dataLines.join('\n');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return [];
    }

    return this.mapUpstreamEvent(eventType, parsed);
  }

  /**
   * Translate a single upstream workflow event into our normalized SSE events.
   *
   * Upstream event flow:
   *   WorkflowStarted → session_id
   *   StepStarted     → status (humanized step name)
   *   RunContent       → content (string) or block[] (object with blocks)
   *   WorkflowCompleted → done
   */
  private mapUpstreamEvent(eventType: string, data: Record<string, unknown>): LensSSEEvent[] {
    switch (eventType) {
      case 'WorkflowStarted': {
        const sessionId = data['session_id'] as string | undefined;
        return sessionId ? [{ type: 'session_id', data: sessionId }] : [];
      }

      case 'StepStarted': {
        const stepName = data['step_name'] as string | undefined;
        if (stepName) {
          return [{ type: 'status', data: this.humanizeStepName(stepName) }];
        }
        return [];
      }

      case 'RunContent': {
        const content = data['content'];
        if (!content) return [];

        // String content → intermediate status or text content
        if (typeof content === 'string') {
          return [{ type: 'content', data: content }];
        }

        // Object content with blocks → extract and emit each block
        if (typeof content === 'object' && !Array.isArray(content)) {
          const blocks = (content as Record<string, unknown>)['blocks'] as LensBlock[] | undefined;
          if (!blocks || !Array.isArray(blocks)) return [];

          const events: LensSSEEvent[] = [];
          for (const block of blocks) {
            if (block.type === 'message') {
              events.push({ type: 'content', data: block.content });
            } else {
              events.push({ type: 'block', data: block });
            }
          }
          return events;
        }

        return [];
      }

      case 'WorkflowCompleted':
        return [{ type: 'done', data: '' }];

      default:
        return [];
    }
  }

  private humanizeStepName(stepName: string): string {
    switch (stepName) {
      case 'resolve_context':
        return 'Resolving context...';
      case 'Check Query Cache':
        return 'Checking cache...';
      case 'Prepare LFX Lens Input':
        return 'Preparing query...';
      case 'LFX Lens Agent':
        return 'Analyzing your question...';
      default:
        return `Processing: ${stepName}...`;
    }
  }
}
