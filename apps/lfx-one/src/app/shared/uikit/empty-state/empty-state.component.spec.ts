// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiButtonComponent } from '../button/button.component';
import { UiEmptyStateComponent } from './empty-state.component';

@Component({
  selector: 'lfx-ui-empty-state-test-host',
  imports: [UiEmptyStateComponent, UiButtonComponent],
  template:
    '<lfx-ui-empty-state icon="fa-light fa-chart-bar" heading="No metrics yet" description="Connect a GitHub organization." [headingLevel]="level()"><span empty-state-media data-testid="media">art</span><lfx-ui-button empty-state-action>Connect GitHub</lfx-ui-button><a empty-state-action href="#">Learn more</a><div data-testid="guide">cards</div></lfx-ui-empty-state>',
})
class HostComponent {
  public readonly level = signal<1 | 2 | 3 | 4 | 5 | 6>(3);
}

describe('UiEmptyStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;
  const q = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('renders the heading, the description and a decorative icon tile', () => {
    expect(q('ui-empty-state-heading')?.textContent).toBe('No metrics yet');
    expect(q('ui-empty-state-description')?.textContent).toBe('Connect a GitHub organization.');
    expect(q('ui-empty-state-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(q('ui-empty-state-icon')?.querySelector('i')?.classList.contains('fa-chart-bar')).toBe(true);
  });

  it('exposes the heading at level 3 by default and follows headingLevel', async () => {
    const heading = q('ui-empty-state-heading') as HTMLElement;
    expect(heading.getAttribute('role')).toBe('heading');
    expect(heading.getAttribute('aria-level')).toBe('3');

    fixture.componentInstance.level.set(2);
    await fixture.whenStable();

    expect(heading.getAttribute('aria-level')).toBe('2');
  });

  it('projects the actions into the actions row and the rest below it', () => {
    const actions = q('ui-empty-state-actions') as HTMLElement;
    expect(actions.querySelector('lfx-ui-button')).not.toBeNull();
    expect(actions.querySelector('a')?.textContent).toBe('Learn more');
    expect(q('media')?.parentElement).toBe(q('ui-empty-state'));
    expect(q('guide')?.parentElement).toBe(q('ui-empty-state'));
    expect(actions.contains(q('guide'))).toBe(false);
  });

  it('keeps the library geometry: ring, 16px radius, 40px by 24px padding', () => {
    const cls = (q('ui-empty-state') as HTMLElement).className;
    for (const token of ['ring-1', 'ring-inset', 'ring-ui-neutral-alpha-200', 'rounded-ui-md', 'px-[24px]', 'py-[40px]', 'gap-[12px]']) {
      expect(cls).toContain(token);
    }
  });

  it('omits the icon tile, description and actions when not given, and the actions row collapses', async () => {
    const bare = TestBed.createComponent(UiEmptyStateComponent);
    bare.componentRef.setInput('heading', 'No meetings scheduled');
    await bare.whenStable();
    const el = bare.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-empty-state-icon"]')).toBeNull();
    expect(el.querySelector('[data-testid="ui-empty-state-description"]')).toBeNull();
    expect(el.querySelector('[data-testid="ui-empty-state-actions"]')?.childNodes.length).toBe(0);
    expect(el.querySelector('[data-testid="ui-empty-state-actions"]')?.className).toContain('empty:hidden');
  });
});
