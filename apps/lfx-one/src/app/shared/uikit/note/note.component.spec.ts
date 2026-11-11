// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiNoteComponent } from './note.component';

@Component({
  selector: 'lfx-ui-note-test-host',
  imports: [UiNoteComponent],
  template: `<lfx-ui-note variant="warning" fill label="Heads up:"
    >Membership renews in 14 days.<button note-action type="button" data-testid="host-action">Review</button></lfx-ui-note
  >`,
})
class HostComponent {}

describe('UiNoteComponent', () => {
  let fixture: ComponentFixture<UiNoteComponent>;
  let host: HTMLElement;

  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  const icon = (): string => (host.querySelector('[data-testid="ui-note-icon"] i') as HTMLElement).className;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiNoteComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiNoteComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a note by default and an alert when announced', async () => {
    expect(host.getAttribute('role')).toBe('note');

    await set('announce', true);

    expect(host.getAttribute('role')).toBe('alert');
  });

  it('is the info variant by default: outline only, accent text, decorative icon', () => {
    expect(host.className).toContain('ring-ui-accent-200');
    expect(host.className).toContain('text-ui-accent-700');
    expect(host.className).not.toContain('bg-ui-accent-50');
    expect(icon()).toContain('fa-circle-info');
    expect(host.querySelector('[data-testid="ui-note-icon"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('colours every variant with its text step and its own icon', async () => {
    const cases: [string, string, string][] = [
      ['secondary', 'text-ui-neutral-600', 'fa-circle-info'],
      ['success', 'text-ui-success-700', 'fa-circle-check'],
      ['warning', 'text-ui-warning-700', 'fa-triangle-exclamation'],
      ['error', 'text-ui-danger-700', 'fa-circle-exclamation'],
      ['violet', 'text-ui-feature-700', 'fa-wand-magic-sparkles'],
    ];
    for (const [variant, text, iconClass] of cases) {
      await set('variant', variant);
      expect(host.className).toContain(text);
      expect(icon()).toContain(iconClass);
    }
  });

  it('adds the tinted background with fill', async () => {
    await set('variant', 'success');
    await set('fill', true);

    expect(host.className).toContain('bg-ui-success-50');
  });

  it('is 40px tall by default and 32px when small', async () => {
    expect(host.className).toContain('min-h-[40px]');

    await set('size', 'small');

    expect(host.className).toContain('min-h-[32px]');
    expect(host.className).toContain('copy-13');
    expect((host.querySelector('[data-testid="ui-note-icon"]') as HTMLElement).className).toContain('text-[14px]');
  });

  it('is 24px tall with 12px text and a centred 12px icon when tiny', async () => {
    await set('size', 'tiny');

    expect(host.className).toContain('min-h-[24px]');
    expect(host.className).toContain('px-[8px]');
    expect(host.className).toContain('label-12');
    expect(host.className).toContain('rounded-[8px]');
    const wrapper = (host.querySelector('[data-testid="ui-note-icon"]') as HTMLElement).className;
    expect(wrapper).toContain('text-[12px]');
    expect(wrapper).toContain('h-[16px]');
    expect(wrapper).not.toContain('pt-[2px]');
  });

  it('drops the edge, fill and padding when plain and keeps the colour and size', async () => {
    await set('variant', 'error');
    await set('fill', true);
    await set('size', 'small');
    await set('plain', true);

    expect(host.className).toContain('text-ui-danger-700');
    expect(host.className).toContain('copy-13');
    expect(host.className).toContain('gap-[6px]');
    for (const boxed of ['ring-1', 'bg-ui-danger-50', 'px-[10px]', 'min-h-[32px]', 'rounded-ui-sm']) {
      expect(host.className).not.toContain(boxed);
    }
    const wrapper = (host.querySelector('[data-testid="ui-note-icon"]') as HTMLElement).className;
    expect(wrapper).toContain('h-[18px]');
    expect(wrapper).toContain('items-center');
  });

  it('prefixes a medium-weight label only when given', async () => {
    expect(host.querySelector('[data-testid="ui-note-label"]')).toBeNull();

    await set('label', 'Beta:');

    expect(host.querySelector('[data-testid="ui-note-label"]')?.textContent).toBe('Beta:');
  });

  it('swaps the icon for a custom one', async () => {
    await set('icon', 'fa-light fa-bell');

    expect(icon()).toBe('ui-icon fa-light fa-bell');
  });

  it('projects the message and one action', async () => {
    const hostFixture = TestBed.createComponent(HostComponent);
    await hostFixture.whenStable();
    const el = hostFixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-note-content"]')?.textContent).toContain('Membership renews in 14 days.');
    expect(el.querySelector('[data-testid="ui-note-label"]')?.textContent).toBe('Heads up:');
    expect(el.querySelector('lfx-ui-note > [data-testid="host-action"]')).not.toBeNull();
  });
});
