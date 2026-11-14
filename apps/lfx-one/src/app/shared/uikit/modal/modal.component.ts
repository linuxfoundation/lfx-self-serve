// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  Signal,
  viewChild,
} from '@angular/core';

import { UiButtonComponent } from '../button/button.component';

/**
 * The layout of a modal: a title and optional subtitle, a body, an optional inset band and an actions footer. Make it the root of
 * the content you open with `UiModalService`; the title labels the dialog and the service handles focus, Escape and the backdrop.
 *
 * Give projected `<p>`/`<label>` a type role; the app base layer otherwise sets 14/21.
 *
 * Project the body as plain content, an inset band with `modalInset` and the default-size buttons with `modalActions`:
 *
 * ```html
 * <lfx-ui-modal heading="Create Committee" subtitle="Committees get their own meetings.">
 *   <input ... />
 *   <div modalInset>Create a mailing list for this committee</div>
 *   <ng-container modalActions><lfx-ui-button variant="secondary">Cancel</lfx-ui-button> ...</ng-container>
 * </lfx-ui-modal>
 * ```
 *
 * For a tall reading dialog, fix its size, keep the header in place and fade the scrolling body. Project a badge after the title with
 * `modalTitleSuffix`, icon buttons left of the close button with `modalHeaderActions`, and full-bleed tabs or a context block under the
 * title with `modalHeaderExtra`:
 *
 * ```html
 * <lfx-ui-modal heading="AI Summary" [width]="720" [height]="800" sticky closable scrollFade>
 *   <lfx-ui-badge modalTitleSuffix ...>Approved</lfx-ui-badge>
 *   <lfx-ui-button modalHeaderActions variant="tertiary" [iconOnly]="true" icon="fa-light fa-copy" ariaLabel="Copy summary" />
 *   <div modalHeaderExtra>...</div>
 *   <p>...</p>
 * </lfx-ui-modal>
 * ```
 */
@Component({
  selector: 'lfx-ui-modal',
  imports: [NgTemplateOutlet, CdkScrollable, UiButtonComponent],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[style.--modal-w.px]': 'width()',
    '[style.--modal-h.px]': 'height()',
    'data-testid': 'ui-modal',
  },
})
export class UiModalComponent {
  private readonly dialogRef = inject(DialogRef, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  /** Title, such as "Delete Project". Title Case, naming the action. */
  public readonly heading = input.required<string>();
  /** One sentence under the title that states the consequence. */
  public readonly subtitle = input<string>('');
  /** `md` is 540px wide, `sm` is 420px for short confirmations. Both shrink to fit the window. */
  public readonly size = input<'sm' | 'md'>('md');
  /** Width in px in place of `size`, such as 720 for a reading dialog. Shrinks to fit the window less 16px on each side. */
  public readonly width = input<number | undefined>(undefined);
  /** Fixed height in px; the body fills it and scrolls. Shrinks to fit the window less 16px above and below. */
  public readonly height = input<number | undefined>(undefined);
  /** Keeps the title in place while a long body scrolls under it. The actions footer always stays in place. */
  public readonly sticky = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Shows a close button at the right of the title that closes the dialog. Header controls take first focus; point a form's `autoFocus` at its first field. */
  public readonly closable = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Fades the body's top edge (32px) once scrolled and its bottom edge while more follows. Read on the first render only. */
  public readonly scrollFade = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Stretches the one button in the actions footer to the full width. */
  public readonly singleAction = input<boolean, unknown>(false, { transform: booleanAttribute });

  /** Id of the title; `UiModalService` points `aria-labelledby` at it. Inside a service-opened modal it derives from the dialog id. */
  protected readonly titleId: string = this.dialogRef ? `${this.dialogRef.id}-title` : inject(_IdGenerator).getId('lfx-ui-modal-title-');
  /** Id of the subtitle; `UiModalConfig.describedBy` points the dialog at it. */
  protected readonly subtitleId: string = this.dialogRef ? `${this.dialogRef.id}-subtitle` : inject(_IdGenerator).getId('lfx-ui-modal-subtitle-');
  protected readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  protected readonly canScrollUp = signal(false);
  protected readonly canScrollDown = signal(false);
  protected readonly fadeTop: Signal<number> = computed(() => (this.scrollFade() && this.canScrollUp() ? 32 : 0));
  protected readonly fadeBottom: Signal<number> = computed(() => (this.scrollFade() && this.canScrollDown() ? 32 : 0));
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly bodyClasses: Signal<string> = this.initBodyClasses();
  protected readonly actionsClasses: Signal<string> = this.initActionsClasses();

  public constructor() {
    // Layout is only readable in the browser, so the fades start measuring after the first render there.
    afterNextRender(() => {
      if (!this.scrollFade()) return;
      const el = this.body().nativeElement;
      const resize = new ResizeObserver(() => this.measure());
      // The body keeps its size when content grows, so its children are observed too, as in the scroller.
      const sync = (): void => {
        resize.disconnect();
        resize.observe(el);
        Array.from(el.children).forEach((child) => resize.observe(child));
        this.measure();
      };
      const mutation = new MutationObserver((records) => {
        if (records.some((record) => record.target === el)) sync();
        else this.measure();
      });
      // Bound here, not in the template, so bodies without fades don't schedule a render on every scroll.
      const onScroll = (): void => this.measure();
      el.addEventListener('scroll', onScroll, { passive: true });
      mutation.observe(el, { childList: true, subtree: true, characterData: true });
      sync();
      this.destroyRef.onDestroy(() => {
        el.removeEventListener('scroll', onScroll);
        resize.disconnect();
        mutation.disconnect();
      });
    });
  }

  protected close(): void {
    this.dialogRef?.close();
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. Max height leaves 32px above and below, as in the library; a fixed height leaves 16px.
      const base =
        'flex max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-ui-lg bg-ui-background-100 shadow-modal forced-colors:border forced-colors:border-[color:CanvasText]';
      const sizeWidth = this.size() === 'sm' ? 'w-[420px]' : 'w-[540px]';
      const width = this.width() ? 'w-[min(var(--modal-w),calc(100vw-32px))]' : sizeWidth;
      const height = this.height() ? 'h-[min(var(--modal-h),calc(100vh-32px))]' : 'max-h-[calc(100vh-64px)]';
      return `${base} ${width} ${height}`;
    });
  }

  private initBodyClasses(): Signal<string> {
    return computed(() => {
      // Starts 20px below a sticky header that holds a header extra.
      const base =
        '[[data-testid=ui-modal-header]:has(>[data-testid=ui-modal-header-extra]:not(:empty))+&]:pt-[20px] flex min-h-0 flex-1 flex-col gap-[16px] overflow-auto px-[24px] copy-14 text-ui-neutral-900';
      const fade = this.scrollFade() ? ' modal-fade' : '';
      return `${base} ${this.sticky() ? 'pb-[24px]' : 'py-[24px]'}${fade}`;
    });
  }

  private initActionsClasses(): Signal<string> {
    return computed(() => {
      const base =
        'flex items-center justify-end gap-[12px] bg-ui-background-200 px-[24px] py-[16px] shadow-[inset_0_1px_0_0] shadow-ui-neutral-alpha-200 empty:hidden';
      // The button component's inner button is content-width unless told otherwise, so stretch it too.
      return this.singleAction() ? `${base} [&>*]:flex-1 [&_a]:w-full [&_button]:w-full` : base;
    });
  }

  private measure(): void {
    const el = this.body().nativeElement;
    // 2px tolerance for fractional scroll positions.
    this.canScrollUp.set(el.scrollTop > 2);
    this.canScrollDown.set(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }
}
