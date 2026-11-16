// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgRunActivity } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MktgRunActivityComponent } from './mktg-run-activity.component';

describe('MktgRunActivityComponent form-only runs', () => {
  it('keeps questions by default but omits the phase for an agent that asks none', () => {
    const fixture = TestBed.createComponent(MktgRunActivityComponent);
    fixture.componentRef.setInput('title', 'Working on Member 360');
    fixture.componentRef.setInput('startedAt', Date.now());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-phase-questions"]')).not.toBeNull();
    fixture.componentRef.setInput('showQuestions', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-phase-questions"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-starting"]').textContent).toContain('Getting started');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-elapsed"]').textContent).toContain('this usually takes a few minutes');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-starting-line"]')).not.toBeNull();
    fixture.destroy();
  });

  it('renders only the steps when its run-page owner supplies the heading and status', () => {
    const fixture = TestBed.createComponent(MktgRunActivityComponent);
    fixture.componentRef.setInput('title', 'Working on the asset');
    fixture.componentRef.setInput('startedAt', Date.now());
    fixture.componentRef.setInput('showHeader', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-elapsed"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-steps"]')).not.toBeNull();
    fixture.destroy();
  });

  it('reuses the phase header and expandable step list for a long research feed', () => {
    const fixture = TestBed.createComponent(MktgRunActivityComponent);
    fixture.componentRef.setInput('title', 'Working on Member 360');
    fixture.componentRef.setInput('startedAt', Date.now());
    fixture.componentRef.setInput('showQuestions', false);
    const activity: MktgRunActivity[] = Array.from({ length: 10 }, (_, index) => ({
      id: `step-${index + 1}`,
      kind: 'lfx',
      label: 'Checking LFX',
      status: index === 9 ? 'running' : 'done',
      startedAt: '2026-10-19T10:00:00.000Z',
    }));
    fixture.componentRef.setInput('activity', activity);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="mktg-run-activity-step-"]')).toHaveLength(8);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-phase-research"]').getAttribute('aria-current')).toBe('step');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-toggle-all"]');
    expect(toggle.textContent).toContain('Show all 10 steps');
    toggle.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="mktg-run-activity-step-"]')).toHaveLength(10);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fixture.destroy();
  });
});
