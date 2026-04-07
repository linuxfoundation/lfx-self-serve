// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, inject, signal } from '@angular/core';
import { COPILOT_STAGE_CONFIGS, COPILOT_STAGE_ORDER, COPILOT_STATUS_TO_STAGE } from '@lfx-one/shared/constants';
import {
  CopilotBlock,
  CopilotChatRequest,
  CopilotContext,
  CopilotMessage,
  CopilotSSEEventType,
  CopilotStageStatus,
  CopilotStreamStage,
} from '@lfx-one/shared/interfaces';
import { Subscription } from 'rxjs';

import { SseService } from './sse.service';

@Injectable({ providedIn: 'root' })
export class CopilotService {
  private readonly sseService = inject(SseService);

  public readonly messages = signal<CopilotMessage[]>([]);
  public readonly streaming = signal(false);
  public readonly sessionId = signal<string | null>(null);
  public readonly error = signal('');
  public readonly currentStatus = signal('');
  public readonly currentStage = signal<CopilotStreamStage | null>(null);
  public readonly stageHistory = signal<CopilotStageStatus[]>([]);

  private subscription: Subscription | null = null;
  private charBuffer = '';
  private animFrameId: number | null = null;

  public sendMessage(message: string, context?: CopilotContext): void {
    if (!message.trim() || this.streaming()) return;

    // Tear down any lingering subscription from a previous stream
    this.subscription?.unsubscribe();
    this.subscription = null;

    this.error.set('');
    this.currentStatus.set('');
    this.currentStage.set(null);
    this.stageHistory.set([]);

    // Add user message
    this.messages.update((msgs) => [...msgs, { role: 'user', content: message, blocks: [], loading: false }]);

    // Add empty assistant message that will be filled by streaming content/blocks
    this.messages.update((msgs) => [...msgs, { role: 'assistant', content: '', blocks: [], loading: true }]);

    this.streaming.set(true);

    const body: CopilotChatRequest = {
      message,
      sessionId: this.sessionId() || undefined,
      context,
    };

    this.subscription = this.sseService.connect<CopilotSSEEventType>('/api/copilot/chat', { method: 'POST', body }).subscribe({
      next: (event) => this.handleSSEEvent(event as { type: CopilotSSEEventType; data: unknown }),
      error: (err) => {
        this.flushCharBuffer();
        console.error('Copilot SSE error:', err);
        this.error.set('Connection failed. Please try again.');
        this.streaming.set(false);
        this.currentStatus.set('');
        this.resetStages();
        this.clearEmptyAssistantPlaceholder();
        this.markLastAssistantDone();
      },
      complete: () => {
        this.flushCharBuffer();
        this.streaming.set(false);
        this.currentStatus.set('');
        this.resetStages();
        this.clearEmptyAssistantPlaceholder();
        this.markLastAssistantDone();
      },
    });
  }

  public abort(): void {
    this.flushCharBuffer();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.streaming.set(false);
    this.currentStatus.set('');
    this.resetStages();
    this.clearEmptyAssistantPlaceholder();
    this.markLastAssistantDone();
  }

  public reset(): void {
    this.abort();
    this.messages.set([]);
    this.sessionId.set(null);
    this.error.set('');
    this.currentStatus.set('');
    this.resetStages();
  }

  private handleSSEEvent(event: { type: CopilotSSEEventType; data: unknown }): void {
    switch (event.type) {
      case 'status': {
        const statusText = event.data as string;
        this.currentStatus.set(statusText);
        const stage = COPILOT_STATUS_TO_STAGE[statusText] as CopilotStreamStage | undefined;
        if (stage) {
          this.advanceToStage(stage);
        }
        break;
      }
      case 'session_id':
        this.sessionId.set(event.data as string);
        break;
      case 'content':
        // Character-stream message text (same pattern as lfx-changelog)
        this.charBuffer += event.data as string;
        this.startDraining();
        break;
      case 'block':
        // Non-text blocks (sql, suggestions) arrive complete
        this.appendBlock(event.data as CopilotBlock);
        break;
      case 'done':
        this.flushCharBuffer();
        this.streaming.set(false);
        this.currentStatus.set('');
        this.resetStages();
        this.markLastAssistantDone();
        break;
      case 'error':
        this.flushCharBuffer();
        this.error.set(event.data as string);
        this.streaming.set(false);
        this.currentStatus.set('');
        this.resetStages();
        // Remove empty assistant message on error
        this.messages.update((msgs) => {
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant' && !last.content && last.blocks.length === 0) {
            return msgs.slice(0, -1);
          }
          return msgs;
        });
        break;
    }
  }

  // --- Character draining (adaptive rate, matches lfx-changelog pattern) ---

  private startDraining(): void {
    if (this.animFrameId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.animFrameId = requestAnimationFrame(() => this.drainStep());
  }

  private drainStep(): void {
    this.animFrameId = null;

    if (this.charBuffer.length === 0) return;

    // Adaptive rate: drain faster when buffer is large to prevent lag
    let charsPerFrame = 2;
    if (this.charBuffer.length > 150) {
      charsPerFrame = 8;
    } else if (this.charBuffer.length > 50) {
      charsPerFrame = 4;
    }

    const chunk = this.charBuffer.slice(0, charsPerFrame);
    this.charBuffer = this.charBuffer.slice(charsPerFrame);
    this.appendToAssistantContent(chunk);

    if (this.charBuffer.length > 0) {
      this.animFrameId = requestAnimationFrame(() => this.drainStep());
    }
  }

  private flushCharBuffer(): void {
    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.charBuffer.length > 0) {
      this.appendToAssistantContent(this.charBuffer);
      this.charBuffer = '';
    }
  }

  private appendToAssistantContent(text: string): void {
    this.messages.update((msgs) => {
      const updated = [...msgs];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant') {
        updated[updated.length - 1] = { ...last, content: last.content + text };
      }
      return updated;
    });
  }

  // --- Block handling ---

  private appendBlock(block: CopilotBlock): void {
    this.messages.update((msgs) => {
      const updated = [...msgs];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg?.role === 'assistant') {
        updated[updated.length - 1] = {
          ...lastMsg,
          blocks: [...lastMsg.blocks, block],
        };
      }
      return updated;
    });
  }

  private clearEmptyAssistantPlaceholder(): void {
    this.messages.update((msgs) => {
      const last = msgs[msgs.length - 1];
      return last && last.role === 'assistant' && !last.content && last.blocks.length === 0 ? msgs.slice(0, -1) : msgs;
    });
  }

  private advanceToStage(stage: CopilotStreamStage): void {
    this.currentStage.set(stage);
    const stageIndex = COPILOT_STAGE_ORDER.indexOf(stage);
    this.stageHistory.set(
      COPILOT_STAGE_ORDER.map((s, i) => {
        const key = s as Exclude<CopilotStreamStage, 'complete'>;
        const config = COPILOT_STAGE_CONFIGS[key];
        let status: 'pending' | 'active' | 'completed';
        if (i < stageIndex) {
          status = 'completed';
        } else if (i === stageIndex) {
          status = 'active';
        } else {
          status = 'pending';
        }
        return { stage: s, label: config.label, dotColor: config.dotColor, status };
      })
    );
  }

  private resetStages(): void {
    this.currentStage.set(null);
    this.stageHistory.set([]);
  }

  private markLastAssistantDone(): void {
    this.messages.update((msgs) => {
      const updated = [...msgs];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg.loading) {
        updated[updated.length - 1] = { ...lastMsg, loading: false };
      }
      return updated;
    });
  }
}
