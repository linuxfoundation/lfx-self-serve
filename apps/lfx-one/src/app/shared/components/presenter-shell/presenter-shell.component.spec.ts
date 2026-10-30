// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VotePresenterPhase } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PresenterShellComponent } from './presenter-shell.component';

const HOST_TEMPLATE = `
  <lfx-presenter-shell [phase]="phase()" [statusPill]="pill()" [context]="context()" [updatedAgoSeconds]="updated()" (exit)="onExit()" (retry)="onRetry()">
    <ng-container ngProjectAs="[presenterEmpty]"><h1 data-testid="t-empty">Nothing here</h1></ng-container>
    <ng-container ngProjectAs="[footerActions]"><button data-testid="t-footer-action">Close</button></ng-container>
    <ng-container ngProjectAs="[presenterEnded]"><div data-testid="t-ended">Result</div></ng-container>
    <ng-container ngProjectAs="[presenterOpen]"><div data-testid="t-open">Live</div></ng-container>
  </lfx-presenter-shell>
`;

@Component({ selector: 'lfx-test-host', template: '' })
class HostComponent {
  public readonly phase = signal<VotePresenterPhase>('active');
  public readonly pill = signal('Vote open · closes Dec 1');
  public readonly context = signal<string | null>('Governing Board');
  public readonly updated = signal<number | null>(3);
  public readonly onExit = vi.fn();
  public readonly onRetry = vi.fn();
}

describe('PresenterShellComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => (el(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const render = (phase: VotePresenterPhase): void => {
    host.phase.set(phase);
    fixture.detectChanges();
  };
  const click = (testId: string): void => (el(testId)?.querySelector('button') as HTMLButtonElement).click();

  beforeEach(() => {
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(HostComponent, { set: { imports: [PresenterShellComponent], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders only the loading skeleton while loading', () => {
    render('loading');
    expect(el('vote-presenter-loading')?.getAttribute('aria-busy')).toBe('true');
    expect(el('vote-presenter-open')).toBeNull();
    expect(el('t-open')).toBeNull();
  });

  it('emits retry and exit from the error screen', () => {
    render('error');
    expect(el('vote-presenter-error')?.getAttribute('role')).toBe('alert');
    click('vote-presenter-retry');
    click('vote-presenter-exit');
    expect(host.onRetry).toHaveBeenCalledTimes(1);
    expect(host.onExit).toHaveBeenCalledTimes(1);
  });

  it('projects the empty content and emits exit', () => {
    render('empty');
    expect(el('vote-presenter-empty')?.contains(el('t-empty'))).toBe(true);
    click('vote-presenter-exit');
    expect(host.onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the header with the context line and status pill in the open phase', () => {
    expect(text('vote-presenter-context')).toBe('LFX');
    expect(el('vote-presenter-open')?.textContent).toContain('Governing Board');
    expect(text('vote-presenter-status')).toBe('Vote open · closes Dec 1');
  });

  it('omits the context line when there is none', () => {
    host.context.set(null);
    fixture.detectChanges();
    expect(el('vote-presenter-open')?.textContent).not.toContain('Governing Board');
  });

  it('puts the footer before the open content in the DOM and projects the footer actions beside Exit', () => {
    const footer = el('vote-presenter-footer') as HTMLElement;
    expect(footer.classList.contains('order-last')).toBe(true);
    expect(footer.contains(el('vote-presenter-exit'))).toBe(true);
    expect(footer.contains(el('t-footer-action'))).toBe(true);
    expect(footer.compareDocumentPosition(el('t-open') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.parentElement).toBe(el('vote-presenter-open'));
  });

  it('keeps the open "updated" line non-live and empty until the first snapshot', () => {
    expect(el('vote-presenter-updated')?.getAttribute('aria-live')).toBe('off');
    expect(text('vote-presenter-updated')).toBe('Updated 3 seconds ago');
    host.updated.set(1);
    fixture.detectChanges();
    expect(text('vote-presenter-updated')).toBe('Updated 1 second ago');
    host.updated.set(null);
    fixture.detectChanges();
    expect(text('vote-presenter-updated')).toBe('');
  });

  it('treats reconnecting like the open phase', () => {
    render('reconnecting');
    expect(el('t-open')).not.toBeNull();
  });

  it('projects the ended content between the header and the footer and emits exit', () => {
    render('ended');
    const result = el('vote-presenter-result') as HTMLElement;
    expect(result.contains(el('t-ended'))).toBe(true);
    expect(el('t-open')).toBeNull();
    expect(el('t-footer-action')).toBeNull();
    expect(result.textContent).toContain('Updated 3 seconds ago');
    host.updated.set(null);
    fixture.detectChanges();
    expect(result.textContent).toContain('Updated 0 seconds ago');
    click('vote-presenter-exit');
    expect(host.onExit).toHaveBeenCalledTimes(1);
  });
});
