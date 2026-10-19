// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, HostListener, inject, input, output, Renderer2 } from '@angular/core';
import { NAV_TOOLTIP_HIDE_DELAY_MS, NAV_TOOLTIP_OFFSET_PX, NAV_TOOLTIP_SHOW_DELAY_MS } from '@lfx-one/shared/constants';
import { NavTooltipItem, NavTooltipPlacement } from '@lfx-one/shared/interfaces';
import { PrimeNG } from 'primeng/config';
import { ZIndexUtils } from 'primeng/utils';

/**
 * Lightweight tooltip for the navbar — a compact dark chip that fades in after a short hover delay
 * (immediately on keyboard focus) and hides on leave, blur, click or Escape — interactive cards
 * toggle on click instead, so touch users can open them. Deliberately separate
 * from PrimeNG's `pTooltip`: it carries the navbar's own styling (`.lfxn-tooltip`, defined in the
 * navbar stylesheet).
 *
 * Two modes:
 * - **Label only** — visual only (`aria-hidden`): the trigger's `aria-label` already names it.
 * - **Interactive** — when `lfxNavTooltipItems` is non-empty, the items render as chip buttons under
 *   the label. The card stays open while the pointer crosses into it (a short hide delay bridges the
 *   gap), ArrowDown on the trigger moves focus to the first chip, Escape returns focus to the
 *   trigger, and choosing a chip emits `lfxNavTooltipItemSelected`.
 *
 * Everything runs in DOM event handlers, which never fire during SSR, so no platform guard is needed.
 */
@Directive({
  selector: '[lfxNavTooltip]',
})
export class NavTooltipDirective {
  /** The tooltip currently on screen — at most one navbar tooltip is open at a time. */
  private static active: NavTooltipDirective | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);
  private readonly primeng = inject(PrimeNG);

  public readonly text = input.required<string>({ alias: 'lfxNavTooltip' });
  public readonly placement = input<NavTooltipPlacement>('top', { alias: 'lfxNavTooltipPlacement' });
  /** Optional Font Awesome icon shown before the label, in `lfxNavTooltipIconColor` when given. */
  public readonly icon = input<string>('', { alias: 'lfxNavTooltipIcon' });
  public readonly iconColor = input<string>('', { alias: 'lfxNavTooltipIconColor' });
  /** Chips listed under the label; when non-empty the tooltip becomes interactive. */
  public readonly items = input<readonly NavTooltipItem[]>([], { alias: 'lfxNavTooltipItems' });
  /** Show only when the host's text is cut off — for names that are already fully visible otherwise. */
  public readonly onlyIfTruncated = input<boolean>(false, { alias: 'lfxNavTooltipOnlyIfTruncated' });

  public readonly itemSelected = output<NavTooltipItem>({ alias: 'lfxNavTooltipItemSelected' });

  private tooltip: HTMLElement | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unlisten: (() => void)[] = [];

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  @HostListener('mouseenter')
  protected onMouseEnter(): void {
    this.cancelHide();
    this.scheduleShow(NAV_TOOLTIP_SHOW_DELAY_MS);
  }

  @HostListener('focusin')
  protected onFocusIn(): void {
    // Only keyboard focus: a mouse click also focuses the button and would re-open the chip.
    if (this.host.nativeElement.matches(':focus-visible')) {
      this.cancelHide();
      this.scheduleShow(0);
    }
  }

  @HostListener('mouseleave')
  protected onMouseLeave(): void {
    this.dismiss();
  }

  @HostListener('focusout', ['$event'])
  protected onFocusOut(event: FocusEvent): void {
    // Focus moving into the interactive card (ArrowDown) keeps it open.
    if (this.tooltip?.contains(event.relatedTarget as Node | null)) return;
    this.dismiss();
  }

  @HostListener('click')
  protected onClick(): void {
    // Interactive cards toggle on click so a tap (no hover) can open the chips; label-only ones just dismiss.
    if (!this.isInteractive() || this.tooltip) {
      this.hide();
      return;
    }
    this.cancelHide();
    this.clearShowTimer();
    this.show();
  }

  @HostListener('keydown', ['$event'])
  protected onHostKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && this.isInteractive()) {
      const firstChip = this.tooltip?.querySelector<HTMLElement>('.lfxn-tooltip__chip');
      if (firstChip) {
        event.preventDefault();
        firstChip.focus();
      }
    }
  }

  private onEscape(): void {
    const focusInside = !!this.tooltip?.contains(this.document.activeElement);
    // Refocus before hiding: the trigger's focusin schedules a reopen that hide() then clears.
    if (focusInside) this.host.nativeElement.focus();
    this.hide();
  }

  private isInteractive(): boolean {
    return this.items().length > 0;
  }

  /** Label-only tooltips hide at once; interactive ones wait so the pointer can reach the card. */
  private dismiss(): void {
    this.clearShowTimer();
    if (!this.isInteractive()) {
      this.hide();
      return;
    }
    this.cancelHide();
    // Keyboard users who moved into the chips keep the card while focus is inside it; the pointer
    // wandering off must not pull a focused chip out from under them (focusout / Escape close it).
    if (this.tooltip?.contains(this.document.activeElement)) return;
    this.hideTimer = setTimeout(() => this.hide(), NAV_TOOLTIP_HIDE_DELAY_MS);
  }

  private scheduleShow(delay: number): void {
    this.clearShowTimer();
    this.showTimer = setTimeout(() => this.show(), delay);
  }

  private show(): void {
    this.showTimer = null;
    const label = this.text();
    const host = this.host.nativeElement;
    if (!label || this.tooltip) return;
    if (this.onlyIfTruncated() && host.scrollWidth <= host.clientWidth) return;
    // A card holding keyboard focus (a chip reached with ArrowDown) wins: hovering another trigger
    // must not pull it away, so this one stays closed.
    const other = NavTooltipDirective.active;
    if (other && other !== this && other.tooltip?.contains(this.document.activeElement)) return;

    const tooltip = this.renderer.createElement('div') as HTMLElement;
    this.renderer.addClass(tooltip, 'lfxn-tooltip');
    this.renderer.addClass(tooltip, `lfxn-tooltip--${this.placement()}`);
    this.renderer.setAttribute(tooltip, 'data-testid', 'nav-tooltip');

    if (this.isInteractive()) {
      this.renderer.addClass(tooltip, 'lfxn-tooltip--rich');
      this.renderer.addClass(tooltip, 'lfxn-tooltip--interactive');
      this.renderer.setAttribute(tooltip, 'role', 'group');
      this.renderer.setAttribute(tooltip, 'aria-label', label);
      this.renderer.appendChild(tooltip, this.buildTitle(label));
      this.renderer.appendChild(tooltip, this.buildChips());
      this.unlisten.push(
        // A tap elsewhere closes a tap-opened card: on touch it never sees mouseleave or focusout.
        this.renderer.listen(this.document, 'pointerdown', (event: PointerEvent) => {
          const target = event.target as Node | null;
          if (!tooltip.contains(target) && !host.contains(target)) this.hide();
        }),
        this.renderer.listen(tooltip, 'mouseenter', () => this.cancelHide()),
        this.renderer.listen(tooltip, 'mouseleave', () => this.dismiss()),
        this.renderer.listen(tooltip, 'focusout', (event: FocusEvent) => {
          const next = event.relatedTarget as Node | null;
          if (!tooltip.contains(next) && next !== host) this.dismiss();
        })
      );
    } else {
      this.renderer.setAttribute(tooltip, 'aria-hidden', 'true');
      this.renderer.appendChild(tooltip, this.buildTitle(label));
    }

    // Escape closes the card; listening only while it is open keeps idle triggers off the document.
    this.unlisten.push(
      this.renderer.listen(this.document, 'keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') this.onEscape();
      })
    );

    // Close whichever other navbar tooltip is still open (e.g. one lingering in its hide delay).
    if (NavTooltipDirective.active && NavTooltipDirective.active !== this) NavTooltipDirective.active.hide();
    NavTooltipDirective.active = this;

    this.renderer.appendChild(this.document.body, tooltip);
    // Layer above whatever overlay is open (the mobile navbar sits in a modal drawer), as pTooltip does.
    ZIndexUtils.set('tooltip', tooltip, this.primeng.zIndex.tooltip);
    this.tooltip = tooltip;

    this.position(tooltip);
    // Next frame, so the entry transition runs from the hidden state.
    requestAnimationFrame(() => tooltip.classList.add('is-visible'));
  }

  /** The label, preceded by the optional icon. */
  private buildTitle(label: string): HTMLElement {
    const title = this.renderer.createElement('div') as HTMLElement;
    this.renderer.addClass(title, 'lfxn-tooltip__title');
    const iconClass = this.icon();
    if (iconClass) {
      const icon = this.renderer.createElement('i') as HTMLElement;
      for (const cls of iconClass.split(' ')) this.renderer.addClass(icon, cls);
      this.renderer.addClass(icon, 'lfxn-tooltip__icon');
      this.renderer.setAttribute(icon, 'aria-hidden', 'true');
      if (this.iconColor()) this.renderer.setStyle(icon, 'color', this.iconColor());
      this.renderer.appendChild(title, icon);
    }
    // The text sits in its own span so heading styles (bold) never change the icon's Font Awesome style.
    const text = this.renderer.createElement('span') as HTMLElement;
    this.renderer.addClass(text, 'lfxn-tooltip__label');
    this.renderer.appendChild(text, this.renderer.createText(label));
    this.renderer.appendChild(title, text);
    return title;
  }

  private buildChips(): HTMLElement {
    const list = this.renderer.createElement('div') as HTMLElement;
    this.renderer.addClass(list, 'lfxn-tooltip__chips');
    for (const item of this.items()) {
      const chip = this.renderer.createElement('button') as HTMLElement;
      this.renderer.setAttribute(chip, 'type', 'button');
      this.renderer.addClass(chip, 'lfxn-tooltip__chip');
      this.renderer.setAttribute(chip, 'data-testid', `nav-tooltip-chip-${item.key}`);
      this.renderer.appendChild(chip, this.renderer.createText(item.label));
      this.unlisten.push(
        this.renderer.listen(chip, 'click', () => {
          this.hide();
          this.itemSelected.emit(item);
        })
      );
      this.renderer.appendChild(list, chip);
    }
    return list;
  }

  /**
   * Centre the card on the trigger on its preferred side, flipping to the other side when it would
   * cross the viewport edge (e.g. a long chip list above an icon near the top), clamped horizontally.
   * When neither side has room, it takes the roomier side and scrolls within that height.
   */
  private position(tooltip: HTMLElement): void {
    const trigger = this.host.nativeElement.getBoundingClientRect();
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = this.document.documentElement;
    const room: Record<NavTooltipPlacement, number> = {
      top: trigger.top - 2 * NAV_TOOLTIP_OFFSET_PX,
      bottom: viewportHeight - trigger.bottom - 2 * NAV_TOOLTIP_OFFSET_PX,
    };

    const natural = tooltip.getBoundingClientRect();
    const placement = this.resolvePlacement(room, natural.height);
    if (natural.height > room[placement]) {
      this.renderer.setStyle(tooltip, 'max-height', `${Math.max(Math.floor(room[placement]), 0)}px`);
      this.renderer.setStyle(tooltip, 'overflow-y', 'auto');
    }
    const { width, height } = tooltip.getBoundingClientRect();
    if (placement !== this.placement()) {
      this.renderer.removeClass(tooltip, `lfxn-tooltip--${this.placement()}`);
      this.renderer.addClass(tooltip, `lfxn-tooltip--${placement}`);
    }

    const centred = trigger.left + trigger.width / 2 - width / 2;
    const left = Math.min(Math.max(centred, NAV_TOOLTIP_OFFSET_PX), viewportWidth - width - NAV_TOOLTIP_OFFSET_PX);
    const top = placement === 'bottom' ? trigger.bottom + NAV_TOOLTIP_OFFSET_PX : trigger.top - height - NAV_TOOLTIP_OFFSET_PX;

    this.renderer.setStyle(tooltip, 'left', `${Math.round(left)}px`);
    this.renderer.setStyle(tooltip, 'top', `${Math.round(top)}px`);
  }

  /** The preferred side if the card fits there, else the opposite side if it fits, else the roomier side. */
  private resolvePlacement(room: Record<NavTooltipPlacement, number>, height: number): NavTooltipPlacement {
    const preferred = this.placement();
    const opposite: NavTooltipPlacement = preferred === 'top' ? 'bottom' : 'top';
    if (height <= room[preferred]) return preferred;
    if (height <= room[opposite]) return opposite;
    return room[opposite] > room[preferred] ? opposite : preferred;
  }

  private hide(): void {
    this.clearShowTimer();
    this.cancelHide();
    this.unlisten.splice(0).forEach((stop) => stop());
    if (this.tooltip) {
      ZIndexUtils.clear(this.tooltip);
      // Detach directly: the animation-aware renderer defers removal to the next change-detection
      // pass, which a timer-driven hide in this zoneless app never triggers — the card would linger.
      this.tooltip.remove();
      this.tooltip = null;
    }
    if (NavTooltipDirective.active === this) NavTooltipDirective.active = null;
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
