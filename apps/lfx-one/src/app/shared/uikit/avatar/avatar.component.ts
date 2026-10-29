// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, signal, Signal, viewChild } from '@angular/core';
import { UiAvatarTone } from '@lfx-one/shared/interfaces';

/**
 * A person, organization or bot as a photo or initials in a circle with a hairline ring. Falls back from the photo to the icon or
 * initials when the image is missing or fails to load. Match the size to the text beside it: 20 to 24 next to 14px text, 32 next to 16px,
 * 48 to 64 in headers. Use `lfx-ui-avatar-group` to stack several.
 */
@Component({
  selector: 'lfx-ui-avatar',
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'fontSize()',
    '[attr.role]': 'decorative() || placeholder() || !name() ? null : "img"',
    '[attr.aria-label]': 'decorative() || placeholder() || !name() ? null : name()',
    '[attr.title]': 'decorative() || placeholder() || !name() ? null : name()',
    '[attr.aria-hidden]': 'decorative() || placeholder() ? "true" : null',
    'data-testid': 'ui-avatar',
  },
})
export class UiAvatarComponent {
  /** The literal name of the person, organization or bot. It is the accessible name and the source of the initials. */
  public readonly name = input<string>('');
  /** Photo URL. When it is empty or fails to load, the icon or the initials show instead. */
  public readonly src = input<string>('');
  /** Overrides the initials derived from the name, such as `+4` for the overflow tile of a group. */
  public readonly initials = input<string>('');
  /** Font Awesome class string for an entity glyph, such as `fa-light fa-cube`. Shown instead of the initials when there is no photo. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for the git provider mark pinned to the bottom right, such as `fa-brands fa-github`. */
  public readonly badgeIcon = input<string>('');
  /** Width and height in px. The library uses 16, 24, 32, 48 and 64. */
  public readonly size = input<number>(32);
  /** `neutral` is the quiet default. Any other role tints the circle with its 600 fill and white text, to tell people apart in dense lists. */
  public readonly tone = input<UiAvatarTone>('neutral');
  /** `circle` is for people; `rounded` has 8px corners, for organizations and other entities. */
  public readonly shape = input<'circle' | 'rounded'>('circle');
  /** Shows a shimmering shell while the real avatar loads. Never use it as a permanent fallback. */
  public readonly placeholder = input<boolean>(false);
  /** Hides the avatar from assistive technology. Set it when a visible name sits next to the avatar. */
  public readonly decorative = input<boolean>(false);
  /** Swaps the hairline ring for a 2px ring of the page background, so avatars overlap cleanly. Set by `lfx-ui-avatar-group`. */
  public readonly stacked = input<boolean>(false);

  private readonly failedSrc = signal<string>('');
  private readonly photoEl = viewChild<ElementRef<HTMLImageElement>>('photo');
  // Non-reactive: only read in the error handler.
  private srcSeen = false;
  private srcChangedAt = 0;

  protected readonly photoSrc: Signal<string> = this.initPhotoSrc();
  protected readonly text: Signal<string> = this.initText();
  protected readonly fontSize: Signal<number> = this.initFontSize();
  protected readonly classes: Signal<string> = this.initClasses();

  public constructor() {
    // Stamp src swaps, not the first value, so a late error from the previous URL can be ignored.
    effect(() => {
      this.src();
      if (this.srcSeen) {
        this.srcChangedAt = performance.now();
      }
      this.srcSeen = true;
    });
    // An image that failed before hydration never fires `error`; decode it once after the first render. Never runs on the server.
    afterNextRender(() => {
      const img = this.photoEl()?.nativeElement;
      const src = this.src();
      if (img?.complete) {
        img.decode().catch(() => this.failedSrc.set(src));
      }
    });
  }

  protected onPhotoError(event: Event, src: string): void {
    // A replayed error, or one from a URL swapped away mid-load, must not hide the new photo.
    const img = event.target as HTMLImageElement | null;
    if ((img?.complete && img.naturalWidth > 0) || event.timeStamp < this.srcChangedAt) {
      return;
    }
    this.failedSrc.set(src);
  }

  private initPhotoSrc(): Signal<string> {
    return computed(() => {
      const src = this.src();
      return src && src !== this.failedSrc() ? src : '';
    });
  }

  private initText(): Signal<string> {
    return computed(() => {
      const override = this.initials();
      if (override) {
        return override;
      }
      const words = this.name().trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        return '';
      }
      // Split by code point so an emoji or other astral character is not cut in half.
      const chars = (word: string) => Array.from(word);
      const letters = words.length > 1 ? chars(words[0])[0] + chars(words[1])[0] : chars(words[0]).slice(0, 2).join('');
      return letters.toUpperCase();
    });
  }

  private initFontSize(): Signal<number> {
    // Three-character text such as `+14` needs a smaller scale than one or two initials.
    return computed(() => this.size() * (Array.from(this.text()).length > 2 ? 0.32 : 0.38));
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      const base = 'relative inline-grid shrink-0 select-none place-items-center font-medium leading-none';
      // Exact px, not rem: the app root font is 14px.
      const shapes = { circle: 'rounded-ui-full', rounded: 'rounded-[8px]' };
      // text-white matches the library's --white on tints; no on-fill token exists yet.
      const tints = {
        neutral: 'bg-ui-neutral-50 text-ui-neutral-600',
        accent: 'bg-ui-accent-600 text-white',
        feature: 'bg-ui-feature-600 text-white',
        success: 'bg-ui-success-600 text-white',
        warning: 'bg-ui-warning-600 text-white',
        danger: 'bg-ui-danger-600 text-white',
      };
      const shimmer =
        'avatar-shimmer bg-gradient-to-r from-ui-neutral-50 from-25% via-ui-neutral-100 via-[37%] to-ui-neutral-50 to-[63%] bg-[length:400%_100%] bg-[position:100%_50%]';
      const fill = this.placeholder() ? shimmer : tints[this.tone()];
      // Tinted avatars have no hairline ring; stacked ones always get the background ring.
      const hairline = this.tone() === 'neutral' || this.placeholder() ? 'edge' : '';
      const ring = this.stacked() ? 'ring-2 ring-ui-background-100' : hairline;
      return `${base} ${shapes[this.shape()]} ${fill} ${ring}`;
    });
  }
}
