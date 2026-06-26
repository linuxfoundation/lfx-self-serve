// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgChatMessage } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';

/** Default Guild API base URL when GUILD_API_URL is not set. */
const GUILD_DEFAULT_API_URL = 'https://app.guild.ai';

/** Outbound request timeout for Guild API calls. */
const GUILD_REQUEST_TIMEOUT_MS = 30_000;

/** Session event types we request and map into chat messages. */
const GUILD_EVENT_TYPES = 'trigger_message,agent_notification_message,user_message';

// Max events fetched per history request. MVP cap — sessions with more than this
// many events are truncated to the most recent page. History pagination is a
// future enhancement tracked under the Mktg OS epic (LFXAI-95), separate from the
// per-viewer timestamp localization deferred to LFXAI-99.
const GUILD_HISTORY_LIMIT = 100;

/** Minimal shape of a Guild session event (only the fields we consume). */
interface GuildSessionEvent {
  id: string;
  type: string;
  created_at: string;
  content?:
    | {
        type?: string;
        data?: string;
      }
    | string;
}

/**
 * Server-side proxy for the Guild AI API (https://docs.guild.ai/platform/triggers).
 *
 * Auth is `Basic base64(GUILD_API_KEY)` — a server-side credential that must
 * never reach the browser. All methods fail with a clear 500 when the Guild
 * credentials/workspace are not configured.
 */
export class GuildService {
  private get apiUrl(): string {
    return process.env['GUILD_API_URL'] || GUILD_DEFAULT_API_URL;
  }

  private get apiKey(): string {
    return process.env['GUILD_API_KEY'] || '';
  }

  private get owner(): string {
    return process.env['GUILD_WORKSPACE_OWNER'] || '';
  }

  private get workspace(): string {
    return process.env['GUILD_WORKSPACE_NAME'] || '';
  }

  /**
   * Create a new Guild session seeded with the first message.
   * Returns the new session id.
   */
  public async createSession(req: Request, params: { message: string; handle?: string }): Promise<string> {
    this.assertConfigured('guild_create_session', { requireWorkspace: true });

    const apiMessage = this.applyRouting(params.message, params.handle);
    const path = `/api/workspaces/${this.owner}/${this.workspace}/sessions`;

    logger.debug(req, 'guild_create_session', 'Creating Guild session', { has_handle: !!params.handle });

    const response = await this.fetchGuild(
      path,
      {
        method: 'POST',
        body: JSON.stringify({
          session_type: 'api_trigger',
          agent_input: { type: 'text', text: apiMessage },
        }),
      },
      'guild_create_session'
    );

    await this.assertOk(response, 'guild_create_session', path);

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      throw new MicroserviceError('Guild session response did not include a session id.', 502, 'guild_invalid_response', {
        service: 'guild',
        path,
        operation: 'guild_create_session',
      });
    }

    return data.id;
  }

  /**
   * Post a follow-up message to an existing Guild session.
   */
  public async sendFollowUp(req: Request, sessionId: string, params: { message: string; handle?: string }): Promise<void> {
    this.assertConfigured('guild_send_follow_up');

    const apiMessage = this.applyRouting(params.message, params.handle);
    const path = `/api/sessions/${sessionId}/events`;

    logger.debug(req, 'guild_send_follow_up', 'Posting follow-up to Guild session', { has_handle: !!params.handle });

    const response = await this.fetchGuild(path, { method: 'POST', body: JSON.stringify({ mode: 'text', content: apiMessage }) }, 'guild_send_follow_up');

    await this.assertOk(response, 'guild_send_follow_up', path);
  }

  /**
   * Fetch a session's history and map Guild events to chat messages,
   * sorted chronologically (oldest first).
   */
  public async getHistory(req: Request, sessionId: string): Promise<MktgChatMessage[]> {
    this.assertConfigured('guild_get_history');

    const path = `/api/sessions/${sessionId}/events?limit=${GUILD_HISTORY_LIMIT}&types=${GUILD_EVENT_TYPES}`;

    logger.debug(req, 'guild_get_history', 'Fetching Guild session history', {});

    const response = await this.fetchGuild(path, { method: 'GET' }, 'guild_get_history');
    await this.assertOk(response, 'guild_get_history', path);

    const data = (await response.json()) as { items?: GuildSessionEvent[] };
    const items = data.items || [];

    return items
      .map((item) => this.mapEvent(item))
      .filter((entry): entry is { message: MktgChatMessage; createdAt: string } => entry !== null)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((entry) => entry.message);
  }

  /**
   * Map a single Guild session event to a chat message plus its `created_at`
   * (kept separately for sorting), or null if it should be dropped
   * (unsupported type, non-text content, or empty text).
   */
  private mapEvent(item: GuildSessionEvent): { message: MktgChatMessage; createdAt: string } | null {
    const isUser = item.type === 'trigger_message' || item.type === 'user_message';
    const content = typeof item.content === 'string' ? undefined : item.content;

    let text = '';
    if (item.type === 'user_message') {
      text = typeof item.content === 'string' ? item.content : content?.data || '';
    } else if (item.type === 'trigger_message') {
      text = extractTriggerMessageText(content?.data || '');
    } else if (item.type === 'agent_notification_message') {
      // Only render text notifications; ignore tool/structured payloads.
      if (content?.type !== 'text') {
        return null;
      }
      text = content?.data || '';
    } else {
      return null;
    }

    let cleanText = text.trim();
    if (isUser) {
      // Strip the @handle routing prefix so it never shows in the user's bubble.
      cleanText = cleanText.replace(/^@[a-zA-Z0-9_-]+\s+/, '');
    }

    if (!cleanText) {
      return null;
    }

    return {
      message: {
        id: item.id,
        sender: isUser ? 'user' : 'agent',
        text: cleanText,
        timestamp: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      createdAt: item.created_at,
    };
  }

  /** Prepend the `@handle` routing prefix when targeting a specific agent. */
  private applyRouting(message: string, handle?: string): string {
    return handle ? `@${handle} ${message}` : message;
  }

  /**
   * Perform a Guild API request with auth, JSON headers, and a timeout.
   * Transport failures (timeout, DNS, connection refused) are wrapped in a
   * MicroserviceError so they carry `service: 'guild'` context instead of
   * surfacing as a contextless 500. HTTP-status errors are handled by assertOk.
   */
  private async fetchGuild(path: string, init: { method: string; body?: string }, operation: string): Promise<globalThis.Response> {
    try {
      return await fetch(`${this.apiUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Basic ${Buffer.from(this.apiKey).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: init.body,
        signal: AbortSignal.timeout(GUILD_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      throw new MicroserviceError(
        isTimeout ? 'Guild API request timed out.' : 'Failed to reach the Guild API.',
        isTimeout ? 504 : 502,
        isTimeout ? 'guild_timeout' : 'guild_unreachable',
        {
          service: 'guild',
          path,
          operation,
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /** Throw a clear 500 when required Guild configuration is missing. */
  private assertConfigured(operation: string, options: { requireWorkspace?: boolean } = {}): void {
    const missing: string[] = [];
    if (!this.apiKey) {
      missing.push('GUILD_API_KEY');
    }
    if (options.requireWorkspace && !this.owner) {
      missing.push('GUILD_WORKSPACE_OWNER');
    }
    if (options.requireWorkspace && !this.workspace) {
      missing.push('GUILD_WORKSPACE_NAME');
    }

    if (missing.length > 0) {
      throw new MicroserviceError(`Guild API is not configured. Missing environment variables: ${missing.join(', ')}.`, 500, 'guild_not_configured', {
        service: 'guild',
        operation,
      });
    }
  }

  /** Translate a non-2xx Guild response into a MicroserviceError. */
  private async assertOk(response: globalThis.Response, operation: string, path: string): Promise<void> {
    if (response.ok) {
      return;
    }

    const rawBody = await response.text();
    let errorBody: unknown;
    try {
      errorBody = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      errorBody = rawBody ? { message: rawBody } : undefined;
    }

    throw MicroserviceError.fromMicroserviceResponse(response.status, response.statusText, errorBody, 'guild', path, operation);
  }
}

/**
 * Extract the user-visible text from a Guild `trigger_message` content payload.
 *
 * Guild wraps the original trigger input in JSON (sometimes inside a ```json
 * markdown block, sometimes double-serialized). Ported from guild_embed's
 * history route. Falls back to the raw string when nothing parses.
 */
function extractTriggerMessageText(data: string): string {
  if (!data) {
    return '';
  }

  const parseInput = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate) as { text?: string; agent_input?: { text?: string } };
      if (typeof parsed.text === 'string') {
        // Handle double-serialized nested input, e.g. {"text": "{\"text\": \"hi\"}"}.
        try {
          const inner = JSON.parse(parsed.text) as { text?: string };
          if (inner && typeof inner.text === 'string') {
            return inner.text;
          }
        } catch {
          return parsed.text;
        }
      }
      if (parsed.agent_input && typeof parsed.agent_input.text === 'string') {
        return parsed.agent_input.text;
      }
    } catch {
      return null;
    }
    return null;
  };

  // 1. JSON inside a markdown code block.
  const jsonMatch = data.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    const fromBlock = parseInput(jsonMatch[1].trim());
    if (fromBlock !== null) {
      return fromBlock;
    }
  }

  // 2. Raw JSON not wrapped in markdown.
  const fromRaw = parseInput(data);
  if (fromRaw !== null) {
    return fromRaw;
  }

  // 3. Fallback: plain text or webhook summary.
  return data;
}
