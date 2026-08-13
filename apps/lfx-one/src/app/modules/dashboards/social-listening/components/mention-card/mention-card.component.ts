// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { TagComponent } from '@components/tag/tag.component';
import { MENTION_PLATFORM_CONFIG, MENTION_RELEVANCE_CONFIG, MENTION_SENTIMENT_CONFIG } from '@lfx-one/shared/constants';
import { capitalizeFirst, isValidUrl, stripMarkdown, timeAgo } from '@lfx-one/shared/utils';
import { FormatTagPipe } from '@pipes/format-tag.pipe';
import { TooltipModule } from 'primeng/tooltip';

import type { Mention, MentionPlatformConfigEntry, MentionRelevanceConfigEntry, MentionSentimentConfigEntry } from '@lfx-one/shared/interfaces';

/** Collapsed mention body: ~3 lines of text-sm (PCC used max-h-[4.5rem]). */
const BODY_COLLAPSED_MAX_HEIGHT_PX = 72;
/** Collapsed analysis line: ~2 lines of text-xs. */
const ANALYSIS_COLLAPSED_MAX_HEIGHT_PX = 40;
/** How long the copy-link button shows its transient "Copied!" state. */
const COPIED_STATE_MS = 1000;

/**
 * A single mention in the Social Listening feed (LFXV2-3016). The whole card is a stretched
 * link to the mention's `originalUrl`; interactive elements (author link, copy, forward) sit
 * above it via `.card-interactive`. Bookmark / read-state actions are intentionally omitted —
 * deferred to the follow-up ticket (see lfxv2-3002-todo.md §6).
 */
@Component({
  selector: 'lfx-mention-card',
  imports: [ExpandableTextComponent, MarkdownRendererComponent, TagComponent, FormatTagPipe, TooltipModule],
  templateUrl: './mention-card.component.html',
  styleUrl: './mention-card.component.scss',
})
export class MentionCardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly mention = input.required<Mention>();
  /** Heartbeat from the page (one shared interval) that re-evaluates the relative timestamp. */
  public readonly timeTick = input<number>(0);

  public readonly copied = signal(false);
  public readonly imageLoadError = signal(false);
  private copyTimeoutId: ReturnType<typeof setTimeout> | null = null;

  public readonly platformConfig = computed<MentionPlatformConfigEntry>(
    () => MENTION_PLATFORM_CONFIG[this.mention().platform] ?? MENTION_PLATFORM_CONFIG.other
  );
  public readonly sentimentConfig = computed<MentionSentimentConfigEntry>(
    () => MENTION_SENTIMENT_CONFIG[this.mention().sentiment] ?? MENTION_SENTIMENT_CONFIG.neutral
  );
  public readonly relevanceConfig = computed<MentionRelevanceConfigEntry>(
    () => MENTION_RELEVANCE_CONFIG[this.mention().relevance] ?? MENTION_RELEVANCE_CONFIG.low
  );
  public readonly displayKeyword = computed(() => capitalizeFirst(this.mention().keyword));
  public readonly isReddit = computed(() => this.mention().platform === 'reddit');
  public readonly hasTitle = computed(() => !!this.mention().title);
  public readonly timeAgo: Signal<string> = this.initTimeAgo();
  public readonly hasImage = computed(() => !!this.mention().imageUrl && isValidUrl(this.mention().imageUrl));
  public readonly isImageVisible = computed(() => this.hasImage() && !this.imageLoadError());
  /** Pre-filled share message (subject `{Keyword} - Worth sharing`) for the forward-by-email anchor. */
  public readonly forwardEmailHref: Signal<string> = this.initForwardEmailHref();

  protected readonly bodyMaxHeight = BODY_COLLAPSED_MAX_HEIGHT_PX;
  protected readonly analysisMaxHeight = ANALYSIS_COLLAPSED_MAX_HEIGHT_PX;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyTimeoutId) {
        clearTimeout(this.copyTimeoutId);
      }
    });
  }

  /** Copies the mention's canonical URL to the clipboard with a transient "Copied!" state. */
  public onCopyLink(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    navigator.clipboard
      .writeText(this.mention().originalUrl)
      .then(() => {
        this.copied.set(true);
        if (this.copyTimeoutId) clearTimeout(this.copyTimeoutId);
        this.copyTimeoutId = setTimeout(() => this.copied.set(false), COPIED_STATE_MS);
      })
      .catch(() => {
        // Clipboard write failed (e.g. permissions denied) — nothing actionable for the user.
      });
  }

  public onImageError(): void {
    this.imageLoadError.set(true);
  }

  private initTimeAgo(): Signal<string> {
    return computed(() => {
      this.timeTick();
      return timeAgo(this.mention().timestamp);
    });
  }

  private initForwardEmailHref(): Signal<string> {
    return computed(() => {
      const mention = this.mention();
      const keyword = mention.keyword ? capitalizeFirst(mention.keyword) : 'this project';
      const subject = encodeURIComponent(`${keyword} - Worth sharing`);
      const intro = `I found this post on ${keyword} and thought it was worth sharing.`;
      const plainContent = mention.content ? stripMarkdown(mention.content) : '';
      const linkSection = mention.originalUrl ? `You can see the original post below:\n${mention.originalUrl}` : '';
      const body = encodeURIComponent([intro, mention.title, plainContent, linkSection].filter(Boolean).join('\n\n'));
      return `mailto:?subject=${subject}&body=${body}`;
    });
  }
}
