// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AudienceSummaryBarComponent } from './audience-summary-bar.component';

describe('AudienceSummaryBarComponent', () => {
  let fixture: ComponentFixture<AudienceSummaryBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceSummaryBarComponent] }).compileComponents();
  });

  function render(inputs: { attached?: boolean; reachLabel?: string } = {}): HTMLElement {
    fixture = TestBed.createComponent(AudienceSummaryBarComponent);
    fixture.componentRef.setInput('included', 3);
    fixture.componentRef.setInput('excluded', 2);
    fixture.componentRef.setInput('reachText', '≤ 1,200');
    fixture.componentRef.setInput('reachLabel', inputs.reachLabel ?? 'Reach (at most)');
    fixture.componentRef.setInput('attached', inputs.attached ?? false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the selection and takes the operator to the review step', () => {
    const host = render();
    let reviewed = 0;
    fixture.componentInstance.review.subscribe(() => reviewed++);

    expect(host.querySelector('[data-testid="campaigns-audience-summary-bar-included"]')?.textContent?.trim()).toBe('3');
    expect(host.querySelector('[data-testid="campaigns-audience-summary-bar-excluded"]')?.textContent?.trim()).toBe('2');
    expect(host.querySelector('[data-testid="campaigns-audience-summary-bar-reach-label"]')?.textContent?.trim()).toBe('Reach (at most)');
    host.querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-summary-bar-review"]')?.click();

    expect(reviewed).toBe(1);
  });

  it('shows the label the container chose for the figure', () => {
    expect(render({ reachLabel: 'Reach before exclusions' }).textContent).toContain('Reach before exclusions');
  });

  it('shows a dash, not 0, for an excluded count that is still loading', () => {
    fixture = TestBed.createComponent(AudienceSummaryBarComponent);
    fixture.componentRef.setInput('included', 1);
    fixture.componentRef.setInput('excluded', null);
    fixture.componentRef.setInput('reachText', '—');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-audience-summary-bar-excluded"]')?.textContent?.trim()).toBe('—');
  });

  it('says the audience is attached instead of offering review', () => {
    const host = render({ attached: true });

    expect(host.textContent).toContain('Attached to this email');
    expect(host.querySelector('[data-testid="campaigns-audience-summary-bar-review"]')).toBeNull();
  });
});
