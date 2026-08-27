// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterEveryRender, Component, computed, DestroyRef, ElementRef, inject, input, output, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  MENTION_FORWARD_EMAIL_BODY_MAX_CHARS,
  MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS,
  MENTION_PLATFORM_CONFIG,
  MENTION_RELEVANCE_CONFIG,
  MENTION_SENTIMENT_CONFIG,
} from '@lfx-one/shared/constants';
import { capitalizeFirst, normalizeToUrl, stripMarkdown, timeAgo } from '@lfx-one/shared/utils';
import { FormatTagPipe } from '@pipes/format-tag.pipe';
import { ValidExternalUrlPipe } from '@pipes/valid-external-url.pipe';
import { TooltipModule } from 'primeng/tooltip';

import type { Mention, MentionPlatformConfigEntry, MentionRelevanceConfigEntry, MentionSentimentConfigEntry } from '@lfx-one/shared/interfaces';

/** How long the copy-link button shows its transient "Copied!" state. */
const COPIED_STATE_MS = 1000;
/** Collapsed analysis block: ~2 lines of text-xs before the "Show more" toggle. */
const ANALYSIS_COLLAPSED_MAX_HEIGHT_PX = 40;

/**
 * A single mention in the Social Listening feed (LFXV2-3016): a stretched link to `originalUrl` with
 * interactive elements above it via `.card-interactive`; read state (LFXV2-3002 Block 2) dims read cards.
 */
@Component({
  selector: 'lfx-mention-card',
  imports: [ExpandableTextComponent, MarkdownRendererComponent, TagComponent, FormatTagPipe, ValidExternalUrlPipe, TooltipModule],
  templateUrl: './mention-card.component.html',
  styleUrl: './mention-card.component.scss',
})
export class MentionCardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly mention = input.required<Mention>();
  /** Heartbeat from the page (one shared interval) that re-evaluates the relative timestamp. */
  public readonly timeTick = input<number>(0);
  /** Bookmark decoration (LFXV2-3002 Block 1) — the page owns persistence via MentionBookmarkService. */
  public readonly isBookmarked = input<boolean>(false);
  public readonly bookmarkToggled = output<Mention>();
  /** Read decoration (LFXV2-3002 Block 2) — the page owns persistence via MentionReadStateService. */
  public readonly isRead = input<boolean>(false);
  public readonly readToggled = output<Mention>();

  public readonly copied = signal(false);
  /** Keyed by URL, not a boolean: row components are reused across pages, so a flag would hide the next mention's thumbnail. */
  public readonly failedImageUrl = signal<string | null>(null);
  /** Drives the fade + "Read full post" affordance; measured against the clamped body after each render. */
  public readonly truncated = signal(false);
  private copyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly bodyEl = viewChild<ElementRef<HTMLElement>>('bodyEl');

  protected readonly analysisMaxHeight = ANALYSIS_COLLAPSED_MAX_HEIGHT_PX;

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
  /** Subreddit directory link — distinct from the stretched card link, which opens the mention itself. */
  public readonly subredditUrl = computed(() => {
    const subreddit = this.mention().subreddit;
    return subreddit ? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}` : '';
  });
  public readonly hasTitle = computed(() => !!this.mention().title);
  /** Same policy as the card's stretched link (`validExternalUrl`), so affordances never outlive a navigable URL. */
  public readonly hasOriginalUrl = computed(() => !!normalizeToUrl(this.mention().originalUrl));
  public readonly timeAgo: Signal<string> = this.initTimeAgo();
  /** Pre-filled share message (subject `{Keyword} - Worth sharing`) for the forward-by-email anchor. */
  public readonly forwardEmailHref: Signal<string> = this.initForwardEmailHref();

  public constructor() {
    // Browser-only hook: clientHeight/scrollHeight compare tells whether line-clamp actually cut content.
    // Set-only-on-change converges in one extra render pass, so resize/font-swap self-correct without a loop.
    afterEveryRender({
      earlyRead: () => {
        const el = this.bodyEl()?.nativeElement;
        return !!el && el.scrollHeight > el.clientHeight + 1;
      },
      write: (truncated) => {
        if (truncated !== this.truncated()) this.truncated.set(truncated);
      },
    });

    this.destroyRef.onDestroy(() => {
      if (this.copyTimeoutId) {
        clearTimeout(this.copyTimeoutId);
      }
    });
  }

  /** Re-emits the toggle intent — the page decides whether the write proceeds (cap/loading gates live in the service). */
  public onToggleBookmark(): void {
    this.bookmarkToggled.emit(this.mention());
  }

  /** Re-emits the toggle intent — the loading gate lives in the service. */
  public onToggleRead(): void {
    this.readToggled.emit(this.mention());
  }

  /** Clicking an unread card marks it read; re-emitting for an already-read card would churn a no-op write. */
  public onCardClick(): void {
    if (!this.isRead()) {
      this.readToggled.emit(this.mention());
    }
  }

  /** Covers clicks on regions lifted above the stretched link (e.g. the selectable body text); links and buttons handle themselves. */
  public onCardContainerClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button')) return;
    // A non-empty selection means the user was copying quote text, not navigating.
    if (window.getSelection()?.toString()) return;

    const url = normalizeToUrl(this.mention().originalUrl);
    if (!url) return;

    window.open(url, '_blank', 'noopener,noreferrer');
    this.onCardClick();
  }

  /** Copies the mention's canonical URL to the clipboard with a transient "Copied!" state. */
  public onCopyLink(): void {
    // The Clipboard API is absent on insecure origins and in older browsers, so it can't be assumed.
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(this.mention().originalUrl)
      .then(() => {
        this.copied.set(true);
        if (this.copyTimeoutId) clearTimeout(this.copyTimeoutId);
        this.copyTimeoutId = setTimeout(() => this.copied.set(false), COPIED_STATE_MS);
      })
      .catch(() => this.copied.set(false));
  }

  public onImageError(url: string): void {
    this.failedImageUrl.set(url);
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
      const linkSection = mention.originalUrl ? `You can see the original post below:\n${mention.originalUrl}` : '';
      // Intro, title and link keep their room (plus the separator the excerpt adds); the excerpt gets the rest.
      const frame = encodeURIComponent([intro, mention.title, linkSection].filter(Boolean).join('\n\n')) + encodeURIComponent('\n\n');
      const excerpt = this.buildExcerpt(mention.content, MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS - frame.length);
      const body = encodeURIComponent([intro, mention.title, excerpt, linkSection].filter(Boolean).join('\n\n'));
      return `mailto:?subject=${subject}&body=${body}`;
    });
  }

  /** Capped twice: raw chars for readability, encoded chars because CJK/emoji expand ~3–9× in the href. */
  private buildExcerpt(content: string | undefined, encodedBudget: number): string {
    if (!content) {
      return '';
    }

    const plain = stripMarkdown(content);
    // Array.from iterates code points, so a supplementary-plane char (emoji, rare CJK) is never split mid-surrogate.
    const raw = Array.from(plain).slice(0, MENTION_FORWARD_EMAIL_BODY_MAX_CHARS).join('');
    const capped = this.capEncodedLength(raw, encodedBudget - encodeURIComponent('…').length);
    if (!capped) {
      return '';
    }

    return capped.length < plain.length ? `${capped}…` : capped;
  }

  // Walks code points, not UTF-16 units — slicing mid-surrogate would make `encodeURIComponent` throw.
  private capEncodedLength(value: string, maxEncoded: number): string {
    if (maxEncoded <= 0) {
      return '';
    }

    if (encodeURIComponent(value).length <= maxEncoded) {
      return value;
    }

    let encoded = 0;
    const kept: string[] = [];
    for (const char of value) {
      encoded += encodeURIComponent(char).length;
      if (encoded > maxEncoded) {
        break;
      }
      kept.push(char);
    }

    return kept.join('');
  }
}
