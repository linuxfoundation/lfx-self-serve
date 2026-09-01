// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ToastMessageOptions } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { ToastMessageComponent } from './toast-message.component';

// Host for the projection test — the action slot exists so consumers can project
// their own button/anchor, so the spec proves projected content really renders.
@Component({
  selector: 'lfx-toast-message-test-host',
  imports: [ToastMessageComponent],
  template: `
    <lfx-toast-message [message]="message">
      <button type="button" data-testid="toast-action">Undo</button>
    </lfx-toast-message>
  `,
})
class ToastMessageTestHostComponent {
  public readonly message: ToastMessageOptions = { severity: 'info', summary: 'Invite declined' };
}

describe('ToastMessageComponent', () => {
  let fixture: ComponentFixture<ToastMessageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ToastMessageComponent, ToastMessageTestHostComponent] }).compileComponents();
  });

  // Creation and setInput stay paired: a required-input fixture left pending
  // without a value throws NG0950 when the zoneless scheduler flushes.
  async function renderWith(message: ToastMessageOptions): Promise<void> {
    fixture = TestBed.createComponent(ToastMessageComponent);
    fixture.componentRef.setInput('message', message);
    await fixture.whenStable();
  }

  function severityIcon(): Element | null {
    return fixture.nativeElement.querySelector('i[aria-hidden="true"]');
  }

  it('renders the error icon for severity error', async () => {
    await renderWith({ severity: 'error', summary: 'Something failed' });

    expect(severityIcon()?.classList).toContain('fa-circle-xmark');
  });

  it('renders the warn icon for severity warn', async () => {
    await renderWith({ severity: 'warn', summary: 'Heads up' });

    expect(severityIcon()?.classList).toContain('fa-triangle-exclamation');
  });

  it('renders the info icon for severity info', async () => {
    await renderWith({ severity: 'info', summary: 'Invite declined' });

    expect(severityIcon()?.classList).toContain('fa-circle-info');
  });

  it('renders the success icon for any other severity', async () => {
    await renderWith({ severity: 'success', summary: 'Saved' });

    expect(severityIcon()?.classList).toContain('fa-circle-check');
  });

  it('renders the summary', async () => {
    await renderWith({ severity: 'info', summary: 'Invite declined' });

    expect(fixture.nativeElement.textContent).toContain('Invite declined');
  });

  it('hides the detail line when detail is absent', async () => {
    await renderWith({ severity: 'info', summary: 'Invite declined' });

    expect(fixture.nativeElement.querySelector('.break-words')).toBeNull();
  });

  it('shows the detail line when detail is present', async () => {
    await renderWith({ severity: 'error', summary: 'Something failed', detail: 'Missing Salesforce ID' });

    const detail = fixture.nativeElement.querySelector('.break-words');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('Missing Salesforce ID');
  });

  it('renders projected action content', async () => {
    const hostFixture = TestBed.createComponent(ToastMessageTestHostComponent);
    // Explicit initial pass: the host has no inputs, so nothing marks it dirty the way setInput does.
    hostFixture.detectChanges();
    await hostFixture.whenStable();

    const action = hostFixture.nativeElement.querySelector('[data-testid="toast-action"]');
    expect(action).not.toBeNull();
    expect(action.textContent?.trim()).toBe('Undo');
  });
});
