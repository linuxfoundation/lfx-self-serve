// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator, InteractivityChecker } from '@angular/cdk/a11y';
import { hasModifierKey } from '@angular/cdk/keycodes';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ComponentRef,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  PLATFORM_ID,
  Signal,
  TemplateRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { UiPopoverContext } from '@lfx-one/shared/interfaces';
import { take } from 'rxjs';

import { UiPopoverPanelComponent } from './popover-panel.component';

/**
 * Opens a panel of your own content beside the host: a non-modal dialog for a few related controls, such as a filters form. Put it on a native
 * button and pass an `<ng-template>`; on `lfx-ui-button` use its `popover` input, which forwards to the inner `<button>`, where `aria-expanded`
 * and focus belong:
 *
 * ```html
 * <button type="button" [lfxUiPopover]="filters" lfxUiPopoverLabel="Filters">Filters</button>
 * <ng-template #filters let-close="close"><div class="p-[16px]">...<button (click)="close()">Done</button></div></ng-template>
 * ```
 *
 * The panel uses the Menu material (16px radius, `shadow-menu`) with no padding, so the template spaces its own content. It is as wide as its content,
 * or `lfxUiPopoverWidth` px. The host gets `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`; the panel is a `role="dialog"` named by
 * `lfxUiPopoverLabel`, or by the host when none is given. It opens below the host, start-aligned, then above it, then end-aligned, and follows
 * its host inside scrollable containers that carry `cdkScrollable`.
 *
 * Focus moves to the first tabbable element in the panel, or to the panel itself. Escape or a click outside closes it. Escape always returns focus
 * to the host; an outside click does too, unless the click already focused something else. Tab past the last field closes it and continues from the
 * host, and Shift+Tab before the first field closes it onto the host. Selects and menus opened from inside the panel keep it open. It is not a focus
 * trap: for a choice that must be answered first, use a modal.
 *
 * Two-way `[(lfxUiPopoverOpen)]` reads or sets whether it is open. The template receives `close`, and `#pop="lfxUiPopover"` exposes `close()` and `toggle()`.
 * On `lfx-ui-button` the directive never attaches to the button element itself, so use the button's `popover`, `popoverLabel` and `popoverWidth` inputs.
 */
@Directive({
  selector: '[lfxUiPopover]:not(lfx-ui-button)',
  exportAs: 'lfxUiPopover',
  host: {
    '[attr.aria-haspopup]': 'template() ? "dialog" : null',
    '[attr.aria-expanded]': 'template() ? expanded() : null',
    '[attr.aria-controls]': 'expanded() ? panelId : null',
    '(click)': 'toggle()',
  },
})
export class UiPopoverDirective {
  /* eslint-disable @angular-eslint/no-input-rename -- the aliases are the public attribute names; the `:not()` in the selector hides them from the rule's selector match. */
  /** The content, an `<ng-template>`. With no template the host is a plain element and gets no ARIA attributes. */
  public readonly template = input<TemplateRef<UiPopoverContext> | null | undefined>(null, { alias: 'lfxUiPopover' });
  /** Accessible name of the dialog. Without one, the host names it, so a short button label such as "Filters" is enough. */
  public readonly label = input<string>('', { alias: 'lfxUiPopoverLabel' });
  /** Fixed width in px. Without it the panel is as wide as its content. */
  public readonly width = input<number | null>(null, { alias: 'lfxUiPopoverWidth' });
  /** Whether the panel is open. Supports two-way binding with `[(lfxUiPopoverOpen)]`. */
  public readonly open = model<boolean>(false, { alias: 'lfxUiPopoverOpen' });
  /* eslint-enable @angular-eslint/no-input-rename */

  protected readonly panelId = inject(_IdGenerator).getId('lfx-ui-popover-');
  protected readonly expanded: Signal<boolean> = computed(() => this.open() && !!this.template());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly overlay = inject(Overlay);
  private readonly checker = inject(InteractivityChecker);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly context: UiPopoverContext = { close: () => this.close() };
  private readonly config = computed(() => ({ template: this.template(), label: this.label(), width: this.width() }));

  private overlayRef: OverlayRef | null = null;
  private panel: ComponentRef<UiPopoverPanelComponent> | null = null;

  public constructor() {
    toObservable(this.expanded)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((expanded) => (expanded ? this.attach() : this.detach(false)));
    toObservable(this.config)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => this.apply(config));
    this.destroyRef.onDestroy(() => this.dispose());
  }

  /** Opens the panel when it is closed and closes it when it is open. */
  public toggle(): void {
    if (!this.template()) return;
    if (this.expanded()) this.close();
    else this.open.set(true);
  }

  /** Closes the panel. Focus returns to the host when it was inside the panel or nowhere. */
  public close(): void {
    this.open.set(false);
    this.detach(false);
  }

  private attach(): void {
    if (!this.isBrowser || this.overlayRef || !this.template()) return;
    if (!this.host.id) this.host.id = `${this.panelId}-trigger`;
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.host)
        .withFlexibleDimensions(true)
        .withViewportMargin(8)
        .withPositions(this.positions()),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      // The pane has the panel's radius, so a click on a corner is an outside click, not a hit on the bare pane.
      panelClass: 'rounded-ui-md',
      disposeOnNavigation: true,
    });
    this.overlayRef = overlayRef;
    this.panel = overlayRef.attach(new ComponentPortal(UiPopoverPanelComponent));
    this.panel.setInput('context', this.context);
    this.panel.setInput('panelId', this.panelId);
    this.panel.setInput('labelledBy', this.host.id);
    this.apply(this.config());
    // A click on the host is the host's own toggle, so it is not an outside click. A select's list opened from inside the panel sits on top
    // of it, and the CDK hands a click there to that list only.
    overlayRef.outsidePointerEvents().subscribe((event) => {
      if (!this.host.contains(event.target as Node)) this.close();
    });
    overlayRef.keydownEvents().subscribe((event) => this.onKeydown(event));
    // The CDK can dispose the overlay itself, such as on navigation; follow it.
    overlayRef
      .detachments()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.overlayRef !== overlayRef) return;
        this.overlayRef = null;
        this.panel = null;
        this.open.set(false);
      });
    afterNextRender(() => this.focusInitial(), { injector: this.injector });
  }

  // Focus goes back to the host when it was inside the panel or nowhere, unless `force`. A click that focused another control keeps it there.
  private detach(force: boolean): void {
    const overlayRef = this.overlayRef;
    if (!overlayRef) return;
    const panelElement = this.panelElement();
    const active = this.document.activeElement;
    this.overlayRef = null;
    this.panel = null;
    const lost = !active || active === this.document.body || !!panelElement?.contains(active);
    overlayRef.dispose();
    if (force || lost) this.host.focus();
  }

  private dispose(): void {
    const overlayRef = this.overlayRef;
    this.overlayRef = null;
    this.panel = null;
    overlayRef?.dispose();
  }

  private apply(config: { template: TemplateRef<UiPopoverContext> | null | undefined; label: string; width: number | null }): void {
    if (!this.panel || !config.template) return;
    this.panel.setInput('template', config.template);
    this.panel.setInput('label', config.label);
    this.panel.setInput('width', config.width);
    // The new content or width may change the size, so place the panel again once it has rendered.
    afterNextRender(() => this.overlayRef?.updatePosition(), { injector: this.injector });
  }

  private focusInitial(): void {
    const panelElement = this.panelElement();
    if (!panelElement) return;
    (this.tabbables(panelElement)[0] ?? panelElement).focus();
  }

  private onKeydown(event: KeyboardEvent): void {
    // Composition keys are not ours.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !hasModifierKey(event)) {
      event.preventDefault();
      this.open.set(false);
      this.detach(true);
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.onTab(event);
    }
  }

  // The panel sits at the end of the body, so Tab out of it would land on <body>: hand focus to the host first, then continue from there.
  private onTab(event: KeyboardEvent): void {
    const panelElement = this.panelElement();
    const target = event.target as HTMLElement;
    // A key from the host or a nested list is not ours.
    if (!panelElement?.contains(target)) return;
    const fields = this.tabbables(panelElement);
    const leaves = event.shiftKey
      ? !fields.some((field) => target.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING)
      : !fields.some((field) => target.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!leaves) return;
    this.host.focus();
    // Backward, the host is where focus stops; forward, the browser carries on from it.
    if (event.shiftKey) event.preventDefault();
    this.open.set(false);
    this.detach(false);
  }

  private tabbables(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((element) => this.checker.isTabbable(element));
  }

  private panelElement(): HTMLElement | null {
    return this.panel?.location.nativeElement ?? null;
  }

  private positions(): ConnectedPosition[] {
    // Below the host, start-aligned, then above it, then the same two from the end edge.
    return [
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    ];
  }
}
