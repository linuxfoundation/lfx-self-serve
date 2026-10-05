// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HostKeyPanelComponent } from './host-key-panel.component';

describe('HostKeyPanelComponent', () => {
  const HOST_KEY = '123456';

  let copy: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;

  const createComponent = (hostKey: string = HOST_KEY): ComponentFixture<HostKeyPanelComponent> => {
    const fixture = TestBed.createComponent(HostKeyPanelComponent);
    fixture.componentRef.setInput('hostKey', hostKey);
    fixture.detectChanges();
    return fixture;
  };

  const clickElement = (root: ParentNode, testid: string): void => {
    const host = root.querySelector(`[data-testid="${testid}"]`);
    const button = host?.querySelector('button') ?? host;
    (button as HTMLElement).click();
  };

  const reveal = (fixture: ComponentFixture<HostKeyPanelComponent>): void => {
    clickElement(fixture.nativeElement, 'host-key-toggle');
    fixture.detectChanges();
  };

  beforeEach(() => {
    copy = vi.fn();
    add = vi.fn();

    TestBed.configureTestingModule({
      providers: [provideNoopAnimations(), { provide: Clipboard, useValue: { copy } }, { provide: MessageService, useValue: { add } }],
    });
  });

  it('masks the key until reveal, then shows it with the copy button', () => {
    const fixture = createComponent();

    const toggle = fixture.nativeElement.querySelector('[data-testid="host-key-toggle"]') as HTMLElement;
    expect(toggle.textContent).not.toContain(HOST_KEY);
    expect(fixture.nativeElement.querySelector('[data-testid="host-key-copy"]')).toBeNull();

    reveal(fixture);

    expect(toggle.textContent).toContain(HOST_KEY);
    expect(fixture.nativeElement.querySelector('[data-testid="host-key-copy"]')).not.toBeNull();
  });

  it('shows a success toast when the copy succeeds', () => {
    copy.mockReturnValue(true);
    const fixture = createComponent();
    reveal(fixture);

    clickElement(fixture.nativeElement, 'host-key-copy');

    expect(copy).toHaveBeenCalledWith(HOST_KEY);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Host Key Copied' }));
  });

  it('shows an error toast when the copy fails', () => {
    copy.mockReturnValue(false);
    const fixture = createComponent();
    reveal(fixture);

    clickElement(fixture.nativeElement, 'host-key-copy');

    expect(copy).toHaveBeenCalledWith(HOST_KEY);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Copy Failed' }));
  });

  it('re-masks when a different meeting key arrives on the same instance', () => {
    const fixture = createComponent();
    reveal(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="host-key-toggle"]')!.textContent).toContain(HOST_KEY);

    fixture.componentRef.setInput('hostKey', '999999');
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('[data-testid="host-key-toggle"]') as HTMLElement;
    expect(toggle.textContent).not.toContain('999999');
    expect(fixture.nativeElement.querySelector('[data-testid="host-key-copy"]')).toBeNull();
  });
});
