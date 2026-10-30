// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UiSearchInputComponent } from './search-input.component';

@Component({
  selector: 'lfx-ui-search-input-test-host',
  imports: [UiSearchInputComponent],
  template: `<lfx-ui-search-input placeholder="Search meetings" ariaLabel="Search meetings" [(value)]="query" />`,
})
class HostComponent {
  public readonly query = signal('kube');
}

describe('UiSearchInputComponent', () => {
  let fixture: ComponentFixture<UiSearchInputComponent>;
  let host: HTMLElement;

  const input = (): HTMLInputElement => host.querySelector('[data-testid="ui-input"]') as HTMLInputElement;
  const clear = (): HTMLButtonElement | null => host.querySelector('[data-testid="ui-search-input-clear"]');
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSearchInputComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSearchInputComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a search field with a search icon prefix', () => {
    expect(input().type).toBe('search');
    expect(host.querySelector('[data-testid="ui-input-prefix"] i')?.className).toContain('fa-magnifying-glass');
  });

  it('shows the placeholder and accessible name', async () => {
    await set('placeholder', 'Search meetings');
    await set('ariaLabel', 'Search meetings');

    expect(input().placeholder).toBe('Search meetings');
    expect(input().getAttribute('aria-label')).toBe('Search meetings');
  });

  it('defaults the placeholder and accessible name to Search', () => {
    expect(input().placeholder).toBe('Search');
    expect(input().getAttribute('aria-label')).toBe('Search');
  });

  it('reflects the value model in the field', async () => {
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();

    expect(input().value).toBe('kube');
  });

  it('writes typed text back to the value model', async () => {
    input().value = 'cncf';
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('cncf');
  });

  it('disables the field', async () => {
    await set('disabled', true);

    expect(input().disabled).toBe(true);
  });

  it('is a 32px pill', () => {
    const wrapper = host.querySelector('[data-testid="ui-input-wrapper"]') as HTMLElement;

    expect(wrapper.className).toContain('h-ui-small');
    expect(wrapper.className).toContain('rounded-ui-full');
  });

  it('keeps a 300px minimum width on the host', () => {
    expect(host.className).toContain('min-w-[min(300px,100%)]');
  });

  it('shows the clear button only while there is text', async () => {
    expect(clear()).toBeNull();

    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();

    expect(clear()).not.toBeNull();
    expect(clear()?.getAttribute('aria-label')).toBe('Clear search');
    expect(clear()?.type).toBe('button');
  });

  it('clears the text, hides the button and returns focus to the field', async () => {
    document.body.appendChild(host);
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();

    (clear() as HTMLButtonElement).focus();
    (clear() as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('');
    expect(input().value).toBe('');
    expect(clear()).toBeNull();
    expect(document.activeElement).toBe(input());
    host.remove();
  });

  it('clears the text on Escape and stops the event so an enclosing dialog stays open', async () => {
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();
    const outer = vi.fn();
    host.addEventListener('keydown', outer);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('');
    expect(input().value).toBe('');
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps the text and the dialog on Escape during IME composition', async () => {
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();
    const outer = vi.fn();
    host.addEventListener('keydown', outer);

    const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('kube');
    expect(event.defaultPrevented).toBe(false);
    expect(outer).not.toHaveBeenCalled();
  });

  it('returns focus to the field when Escape is pressed on the clear button', async () => {
    document.body.appendChild(host);
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();

    (clear() as HTMLButtonElement).focus();
    (clear() as HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('');
    expect(clear()).toBeNull();
    expect(document.activeElement).toBe(input());
    host.remove();
  });

  it('lets Escape pass when there is no text', async () => {
    const outer = vi.fn();
    host.addEventListener('keydown', outer);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('hides the clear button while disabled', async () => {
    fixture.componentInstance.value.set('kube');
    await set('disabled', true);

    expect(clear()).toBeNull();
  });

  it('keeps working through a two-way binding', async () => {
    const hostFixture = TestBed.createComponent(HostComponent);
    await hostFixture.whenStable();
    const root = hostFixture.nativeElement as HTMLElement;

    expect((root.querySelector('[data-testid="ui-input"]') as HTMLInputElement).value).toBe('kube');

    (root.querySelector('[data-testid="ui-search-input-clear"]') as HTMLButtonElement).click();
    await hostFixture.whenStable();

    expect(hostFixture.componentInstance.query()).toBe('');
  });
});
