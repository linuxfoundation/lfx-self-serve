// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COPILOT_CONFIG } from '@lfx-one/shared/constants';
import { CopilotBlock, CopilotQueryParams, CopilotSSEEvent, LfxCopilotApiResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

export class CopilotService {
  private get apiUrl(): string {
    return process.env['LENS_API_URL'] || COPILOT_CONFIG.DEFAULT_API_URL;
  }

  private get apiKey(): string {
    return process.env['LENS_API_KEY'] || '';
  }

  /**
   * Stream query — tries stream=true first. If the upstream returns a non-streaming
   * JSON response (e.g. when they don't support streaming yet), falls back to
   * parsing the full response and yielding blocks.
   */
  public async *streamQuery(req: Request, params: CopilotQueryParams, abortSignal?: AbortSignal): AsyncGenerator<CopilotSSEEvent> {
    logger.debug(req, 'copilot_stream_query', 'Calling LFX Copilot API (stream=true)', {
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
    const timeoutId = setTimeout(() => controller.abort(), COPILOT_CONFIG.REQUEST_TIMEOUT_MS);

    // Link caller's abort signal
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const url = `${this.apiUrl}${COPILOT_CONFIG.WORKFLOW_PATH}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LFX Copilot API error: ${response.status} ${response.statusText} - ${errorText}`);
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
   * Read upstream SSE stream from LFX Copilot API and re-emit as our normalized events.
   * The upstream sends workflow events (WorkflowStarted, StepStarted, RunContent, etc.)
   * which are translated to our status/content/block/session_id/done/error types.
   */
  private async *readUpstreamSSE(req: Request, response: globalThis.Response): AsyncGenerator<CopilotSSEEvent> {
    // Per-stream counter — local to avoid concurrency issues across parallel requests
    const streamState = { runContentCount: 0 };

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

          for (const event of this.parseUpstreamSSEBlock(block, streamState)) {
            yield event;
          }
        }
      }

      // Flush any remaining multibyte characters from the decoder
      buffer += decoder.decode();

      // Handle remaining buffer
      if (buffer.trim()) {
        for (const event of this.parseUpstreamSSEBlock(buffer, streamState)) {
          yield event;
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }

    logger.debug(req, 'copilot_stream_query', 'Upstream SSE stream completed');
  }

  /**
   * Fallback: parse a synchronous JSON response and yield blocks individually.
   */
  private async *handleSyncResponse(req: Request, fetchResponse: globalThis.Response): AsyncGenerator<CopilotSSEEvent> {
    const result = (await fetchResponse.json()) as LfxCopilotApiResponse;

    if (result.status === 'ERROR') {
      throw new Error(`LFX Copilot workflow error: ${JSON.stringify(result.content)}`);
    }

    logger.debug(req, 'copilot_stream_query', 'LFX Copilot API sync response received', {
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
   * Parse a raw SSE text block into zero or more normalized CopilotSSEEvents.
   *
   * The upstream Copilot API sends workflow-level events (WorkflowStarted, StepStarted,
   * RunContent, WorkflowCompleted, etc.) — NOT the simple status/content/block/done
   * events our client expects. This method translates between the two.
   */
  private parseUpstreamSSEBlock(block: string, streamState: { runContentCount: number }): CopilotSSEEvent[] {
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

    return this.mapUpstreamEvent(eventType, parsed, streamState);
  }

  /**
   * Translate a single upstream workflow event into our normalized SSE events.
   *
   * Stage mapping (from API guide):
   *   WorkflowStarted                          -> session_id + "starting"
   *   StepStarted (lens agent)                  -> "analyzing"
   *   RunContent (1st, string)                  -> "analyzing"
   *   ToolCallStarted (tool != run_query)       -> "analyzing"
   *   RunContent (2nd, string)                  -> "querying"
   *   ToolCallStarted (tool == run_query)       -> "querying"
   *   StepStarted (assemble)                    -> "preparing"
   *   WorkflowCompleted                         -> emit blocks + done
   *   WorkflowError                             -> error
   */
  private mapUpstreamEvent(eventType: string, data: Record<string, unknown>, streamState: { runContentCount: number }): CopilotSSEEvent[] {
    switch (eventType) {
      case 'WorkflowStarted': {
        const sessionId = data['session_id'] as string | undefined;
        // Only emit session_id — the controller already sends an initial
        // "Analyzing your question..." status before streaming begins.
        // Emitting another status here would regress the frontend stage.
        return sessionId ? [{ type: 'session_id', data: sessionId }] : [];
      }

      case 'StepStarted': {
        const stepName = ((data['step_name'] as string) || '').toLowerCase();
        if (stepName.includes('lens agent')) {
          return [{ type: 'status', data: 'Analyzing your question...' }];
        }
        if (stepName.includes('assemble')) {
          return [{ type: 'status', data: 'Preparing results...' }];
        }
        return [];
      }

      case 'RunContent': {
        const content = data['content'];
        if (!content) return [];

        // String narrations -> stage-based status updates
        if (typeof content === 'string') {
          streamState.runContentCount++;
          const status = streamState.runContentCount <= 1 ? 'Analyzing your question...' : 'Running queries...';
          return [{ type: 'status', data: status }];
        }

        // Object content (structured LFXLensAgentOutput) -> ignore, blocks come from WorkflowCompleted
        return [];
      }

      case 'ToolCallStarted': {
        const tool = data['tool'] as Record<string, unknown> | undefined;
        const toolName = (tool?.['tool_name'] as string) || '';
        if (toolName === 'run_query') {
          return [{ type: 'status', data: 'Running queries...' }];
        }
        return [{ type: 'status', data: 'Analyzing your question...' }];
      }

      case 'ToolCallCompleted':
        return [];

      case 'WorkflowCompleted': {
        const content = data['content'] as Record<string, unknown> | undefined;
        const blocks = (content?.['blocks'] as CopilotBlock[]) || [];
        const events: CopilotSSEEvent[] = [];

        for (const block of blocks) {
          if (block.type === 'message') {
            events.push({ type: 'content', data: block.content });
          } else {
            events.push({ type: 'block', data: block });
          }
        }

        events.push({ type: 'done', data: '' });
        return events;
      }

      case 'WorkflowError': {
        const error = (data['error'] as string) || 'Something went wrong. Please try again.';
        return [{ type: 'error', data: error }];
      }

      default:
        return [];
    }
  }
}
