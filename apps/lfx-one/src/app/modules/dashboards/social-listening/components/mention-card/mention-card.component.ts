// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { TagComponent } from '@components/tag/tag.component';
import { MENTION_FORWARD_EMAIL_BODY_MAX_CHARS, MENTION_PLATFORM_CONFIG, MENTION_RELEVANCE_CONFIG, MENTION_SENTIMENT_CONFIG } from '@lfx-one/shared/constants';
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
 * A single mention in the Social Listening feed (LFXV2-3016): a stretched link to `originalUrl` with
 * interactive elements above it via `.card-interactive`. Bookmark/read state is deferred (todo §6).
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
  /** Keyed by URL, not a boolean: row components are reused across pages, so a flag would hide the next mention's thumbnail. */
  public readonly failedImageUrl = signal<string | null>(null);
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
  public readonly isImageVisible = computed(() => this.hasImage() && this.failedImageUrl() !== this.mention().imageUrl);
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
    this.failedImageUrl.set(this.mention().imageUrl);
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
      // Truncated so the href stays under the ~2000-char URL limit mail clients enforce.
      const plainContent = mention.content ? stripMarkdown(mention.content).slice(0, MENTION_FORWARD_EMAIL_BODY_MAX_CHARS) : '';
      const truncated = plainContent.length === MENTION_FORWARD_EMAIL_BODY_MAX_CHARS ? `${plainContent}…` : plainContent;
      const linkSection = mention.originalUrl ? `You can see the original post below:\n${mention.originalUrl}` : '';
      const body = encodeURIComponent([intro, mention.title, truncated, linkSection].filter(Boolean).join('\n\n'));
      return `mailto:?subject=${subject}&body=${body}`;
    });
  }
}
