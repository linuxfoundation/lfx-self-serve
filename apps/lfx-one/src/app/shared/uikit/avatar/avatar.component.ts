// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, booleanAttribute, ChangeDetectionStrategy, Component, computed, ElementRef, input, signal, Signal, viewChild } from '@angular/core';
import { UiAvatarStatus, UiAvatarTone } from '@lfx-one/shared/interfaces';

import { UiSkeletonComponent } from '../skeleton/skeleton.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * A person, organization or bot as a photo or initials in a circle. Falls back from the photo to the icon or
 * initials when the image is missing or fails to load, and to a person glyph when there is no photo, icon or initials (a blank name). Match the size to the text beside it: 20 to 24 next to 14px text, 32 next to 16px,
 * 48 to 64 in headers. Use `lfx-ui-avatar-group` to stack several.
 */
@Component({
  selector: 'lfx-ui-avatar',
  templateUrl: './avatar.component.html',
  imports: [UiSkeletonComponent, UiTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'fontSize()',
    '[attr.role]': 'accessibleName() ? "img" : null',
    '[attr.aria-label]': 'accessibleName() || null',
    '[attr.title]': 'title() || null',
    '[attr.aria-hidden]': 'accessibleName() || !(decorative() || placeholder()) ? null : "true"',
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
  /** A status circle pinned to the top right, such as an RSVP answer. Its label is the tooltip and joins the accessible name, even on a decorative avatar. */
  public readonly status = input<UiAvatarStatus | null>(null);
  /** Width and height in px. The library uses 16, 24, 32, 48 and 64. */
  public readonly size = input<number>(32);
  /** `neutral` is the default: an accent-200 fill with accent-800 text. Any other role tints the circle with its 600 fill and white text, to tell people apart in dense lists. */
  public readonly tone = input<UiAvatarTone>('neutral');
  /** `circle` is for people; `rounded` has 8px corners, for organizations and other entities. */
  public readonly shape = input<'circle' | 'rounded'>('circle');
  /** Shows a shimmering shell while the real avatar loads. Never use it as a permanent fallback. */
  public readonly placeholder = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Hides the avatar from assistive technology. Set it when a visible name sits next to the avatar. */
  public readonly decorative = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Adds a 2px ring of the page background, so avatars overlap cleanly. Set by `lfx-ui-avatar-group`. */
  public readonly stacked = input<boolean, unknown>(false, { transform: booleanAttribute });

  private readonly failedSrc = signal<string>('');
  private readonly photoEl = viewChild<ElementRef<HTMLImageElement>>('photo');

  // Empty for a decorative or loading avatar and for a blank name, so none of them is announced as an unnamed image.
  protected readonly title: Signal<string> = computed(() => (this.decorative() || this.placeholder() ? '' : this.name().trim()));
  // A decorative avatar still announces its status, since the name beside it does not carry it.
  protected readonly accessibleName: Signal<string> = computed(() =>
    this.placeholder() ? '' : [this.title(), this.status()?.label.trim()].filter(Boolean).join(', ')
  );
  protected readonly statusClasses: Signal<string> = this.initStatusClasses();
  protected readonly photoSrc: Signal<string> = this.initPhotoSrc();
  protected readonly text: Signal<string> = this.initText();
  protected readonly fontSize: Signal<number> = this.initFontSize();
  protected readonly classes: Signal<string> = this.initClasses();

  public constructor() {
    // An image that failed before hydration never fires `error`; decode it once after the first render. Never runs on the server.
    afterNextRender(() => {
      const img = this.photoEl()?.nativeElement;
      const src = this.src();
      if (img?.complete) {
        // A src change mid-decode rejects the old decode; only a decode of the current src counts as a failure.
        img.decode().catch(() => {
          if (this.src() === src) {
            this.failedSrc.set(src);
          }
        });
      }
    });
  }

  protected onPhotoError(src: string): void {
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
    // The `+N` overflow tile of a group uses the library's smaller 32% scale; initials use 38%.
    return computed(() => this.size() * (this.initials().startsWith('+') ? 0.32 : 0.38));
  }

  private initStatusClasses(): Signal<string> {
    return computed(() => {
      // Fills and glyph colours keep the glyph at 3:1 or more; white on amber is about 2:1.
      const fills = {
        neutral: 'bg-ui-neutral-500 text-ui-white',
        accent: 'bg-ui-accent-500 text-ui-white',
        feature: 'bg-ui-feature-500 text-ui-white',
        success: 'bg-ui-success-600 text-ui-white',
        warning: 'bg-ui-warning-500 text-ui-neutral-900',
        danger: 'bg-ui-danger-500 text-ui-white',
      };
      // Exact px, not rem: the app root font is 14px.
      const base =
        'absolute -right-[3px] -top-[3px] grid h-[14px] w-[14px] place-items-center rounded-full text-[8px] leading-none ring-2 ring-ui-background-100';
      return `${base} ${fills[this.status()?.tone ?? 'neutral']}`;
    });
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      const base = 'relative inline-grid shrink-0 select-none place-items-center font-medium leading-none';
      // Exact px, not rem: the app root font is 14px.
      const shapes = { circle: 'rounded-ui-full', rounded: 'rounded-[8px]' };
      // text-ui-white matches the library's --white on tints; no on-fill token exists yet.
      const tints = {
        // A photo sits on neutral-100, so a loading or transparent image never shows the accent fill.
        neutral: this.photoSrc() ? 'bg-ui-neutral-100' : 'bg-ui-accent-200 text-ui-accent-800',
        accent: 'bg-ui-accent-600 text-ui-white',
        feature: 'bg-ui-feature-600 text-ui-white',
        success: 'bg-ui-success-600 text-ui-white',
        warning: 'bg-ui-warning-600 text-ui-white',
        danger: 'bg-ui-danger-600 text-ui-white',
      };
      // The placeholder is a skeleton clipped to the avatar shape.
      const fill = this.placeholder() ? 'overflow-hidden' : tints[this.tone()];
      const ring = this.stacked() ? 'ring-2 ring-ui-background-100' : '';
      return `${base} ${shapes[this.shape()]} ${fill} ${ring}`;
    });
  }
}
