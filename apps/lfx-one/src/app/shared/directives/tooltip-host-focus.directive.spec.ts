// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from '@components/button/button.component';
import { TooltipModule } from 'primeng/tooltip';
import { describe, expect, it } from 'vitest';
import { TooltipHostFocusDirective } from './tooltip-host-focus.directive';

@Component({
  selector: 'lfx-tooltip-host-focus-test',
  imports: [ButtonComponent, TooltipModule, TooltipHostFocusDirective],
  template: `<span role="note" tabindex="0" pTooltip="Synthetic blocked reason" tooltipEvent="hover" lfxTooltipHostFocus>
      <lfx-button label="Run" [disabled]="true" /> </span
    ><span lfxTooltipHostFocus data-testid="without-tooltip"></span>`,
})
class HostComponent {}

describe('TooltipHostFocusDirective', () => {
  it('shows the same tooltip on wrapper focus even when its descendant component cannot receive focus', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host: HTMLElement | null = fixture.nativeElement.querySelector('[role="note"]');
    expect(fixture.nativeElement.querySelector('button')?.disabled).toBe(true);
    // The marker without pTooltip must not instantiate a directive that requires Tooltip injection.
    expect(fixture.nativeElement.querySelector('[data-testid="without-tooltip"]')).not.toBeNull();
    host?.focus();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Synthetic blocked reason');
    host?.blur();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    fixture.destroy();
  });

  it('retains the tooltip pointer behaviour on the same wrapper', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host: HTMLElement | null = fixture.nativeElement.querySelector('[role="note"]');
    host?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Synthetic blocked reason');
    host?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    fixture.destroy();
  });
});
