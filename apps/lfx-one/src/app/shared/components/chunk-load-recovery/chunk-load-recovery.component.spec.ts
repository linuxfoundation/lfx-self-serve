// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { InteractivityChecker } from '@angular/cdk/a11y';
import { Component, signal, viewChild, TemplateRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChunkLoadRecoveryService } from '../../services/chunk-load-recovery.service';
import { IntercomService } from '../../services/intercom.service';
import { UiDrawerComponent } from '../../uikit/drawer/drawer.component';
import { UiDrawerService } from '../../uikit/drawer/drawer.service';
import { ChunkLoadRecoveryComponent } from './chunk-load-recovery.component';

@Component({
  selector: 'lfx-recovery-overlay-content',
  templateUrl: './chunk-load-recovery-overlay.test-host.html',
})
class RecoveryOverlayContentComponent {}

@Component({
  selector: 'lfx-recovery-test-host',
  imports: [ChunkLoadRecoveryComponent, RecoveryOverlayContentComponent, UiDrawerComponent, DrawerModule, DialogModule, DynamicDialogModule],
  templateUrl: './chunk-load-recovery.test-host.html',
})
class RecoveryTestHostComponent {
  public readonly drawerVisible = signal(false);
  public readonly dialogVisible = signal(false);
  public readonly cdkDrawer = viewChild<TemplateRef<unknown>>('cdkDrawer');
}

describe('ChunkLoadRecoveryComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('coalesces mutation batches into one frame and cancels pending work on destruction', async () => {
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload: signal(true), reloading: signal(false), reload: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => {
      callback = next;
      return 123;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const scan = vi.spyOn(document, 'querySelectorAll');
    const unrelated = document.createElement('div');
    document.body.append(unrelated);
    await Promise.resolve();
    unrelated.classList.add('hover-state');
    await Promise.resolve();
    unrelated.style.opacity = '0.5';
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls.filter(([selector]) => selector.includes('.p-drawer'))).toHaveLength(0);
    callback?.(0);
    expect(scan.mock.calls.filter(([selector]) => selector.includes('.p-drawer'))).toHaveLength(1);
    unrelated.classList.add('another-state');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    fixture.destroy();
    expect(cancel).toHaveBeenCalledWith(123);
    unrelated.remove();
    expect(document.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();
  });

  it('hosts recovery within the CDK drawer flex layout and trap, preserving its draft through teardown', async () => {
    const needsReload = signal(false);
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload: vi.fn() } },
      ],
    });
    // jsdom has no layout. Only replace CDK's visibility predicate, not its trap.
    vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const ref = TestBed.inject(UiDrawerService).open(fixture.componentInstance.cdkDrawer()!);
    await fixture.whenStable();
    const overlay = document.querySelector<HTMLElement>('.cdk-dialog-container')!;
    const drawer = overlay.querySelector<HTMLElement>('lfx-ui-drawer')!;
    const draft = drawer.querySelector<HTMLInputElement>('[data-testid="overlay-draft"]')!;
    draft.value = 'CDK drawer unsaved draft';
    draft.focus();
    needsReload.set(true);
    await fixture.whenStable();
    const panel = drawer.querySelector<HTMLElement>('[data-testid="chunk-load-recovery"]')!;
    expect(panel.parentElement).toBe(drawer);
    expect(panel.classList.contains('shrink-0')).toBe(true);
    expect(panel.classList.contains('fixed')).toBe(false);
    expect(drawer.classList.contains('h-full')).toBe(true);
    expect(drawer.classList.contains('flex-col')).toBe(true);
    expect(drawer.querySelector('[data-testid="ui-drawer-body"]')?.classList.contains('min-h-0')).toBe(true);
    expect(drawer.querySelector('[data-testid="overlay-draft"]')).toBe(draft);
    expect(draft.value).toBe('CDK drawer unsaved draft');
    expect(document.activeElement).toBe(draft);
    const support = panel.querySelector<HTMLButtonElement>('[data-testid="chunk-load-recovery-support"] button')!;
    const anchors = overlay.parentElement!.querySelectorAll<HTMLElement>('.cdk-focus-trap-anchor');
    expect(anchors).toHaveLength(2);
    anchors[0]!.focus();
    expect(document.activeElement).toBe(support);
    anchors[1]!.focus();
    expect(overlay.contains(document.activeElement)).toBe(true);
    fixture.destroy();
    expect(document.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();
    ref.overlayRef.dispose();
  });

  it.each(['drawer', 'dialog', 'dynamic'] as const)('keeps recovery inside the real %s trap without losing draft focus or state', async (kind) => {
    const needsReload = signal(false);
    const reloading = signal(false);
    const reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        DialogService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading, reload } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const dynamic = kind === 'dynamic' ? TestBed.inject(DialogService).open(RecoveryOverlayContentComponent, { header: 'Edit draft', modal: true }) : null;
    if (kind === 'drawer') fixture.componentInstance.drawerVisible.set(true);
    if (kind === 'dialog') fixture.componentInstance.dialogVisible.set(true);
    await fixture.whenStable();
    const overlay = document.querySelector<HTMLElement>(kind === 'drawer' ? '.p-drawer' : '.p-dialog')!;
    const draft = overlay.querySelector<HTMLInputElement>('[data-testid="overlay-draft"]')!;
    draft.value = 'Keep this unsaved draft';
    draft.focus();

    needsReload.set(true);
    await fixture.whenStable();
    const panel = overlay.querySelector<HTMLElement>('[data-testid="chunk-load-recovery"]')!;
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(overlay);
    expect(panel.classList.contains('fixed')).toBe(false);
    expect(document.activeElement).toBe(draft);
    expect(overlay.querySelector('[data-testid="overlay-draft"]')).toBe(draft);
    expect(draft.value).toBe('Keep this unsaved draft');
    const first = overlay.querySelector<HTMLElement>(':scope > [data-pc-section="firstfocusableelement"]')!;
    const last = overlay.querySelector<HTMLElement>(':scope > [data-pc-section="lastfocusableelement"]')!;
    expect(panel.nextElementSibling).toBe(last);
    const support = panel.querySelector<HTMLButtonElement>('[data-testid="chunk-load-recovery-support"] button')!;
    // Exercise PrimeNG's actual sentinel handlers (jsdom has no native Tab movement).
    // Shift-Tab through the leading sentinel reaches the final recovery action;
    // forward Tab through the trailing one wraps back into the same modal.
    draft.focus();
    first.focus();
    expect(document.activeElement).toBe(support);
    last.focus();
    expect(overlay.contains(document.activeElement)).toBe(true);
    const reloadButton = panel.querySelector<HTMLButtonElement>('[data-testid="chunk-load-recovery-reload"] button')!;
    reloadButton.click();
    expect(reload).toHaveBeenCalledTimes(1);
    reloading.set(true);
    await fixture.whenStable();
    expect(reloadButton.getAttribute('aria-busy')).toBe('true');
    reloadButton.click();
    expect(reload).toHaveBeenCalledTimes(1);
    reloading.set(false);
    await fixture.whenStable();
    expect(reloadButton.hasAttribute('aria-busy')).toBe(false);

    if (dynamic) dynamic.close();
    fixture.componentInstance.drawerVisible.set(false);
    fixture.componentInstance.dialogVisible.set(false);
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('[data-testid="chunk-load-recovery"]')).toBe(panel));
    await fixture.whenStable();
    expect(panel.classList.contains('fixed')).toBe(true);
    fixture.destroy();
    expect(document.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();
  });

  it('follows the highest overlay opened during recovery and returns to the underlying drawer without replacing forms', async () => {
    const needsReload = signal(true);
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    fixture.componentInstance.drawerVisible.set(true);
    await fixture.whenStable();
    const drawer = document.querySelector<HTMLElement>('.p-drawer')!;
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="chunk-load-recovery"]')).not.toBeNull());
    const draft = drawer.querySelector<HTMLInputElement>('[data-testid="overlay-draft"]')!;
    draft.value = 'Underlying drawer draft';
    const panel = drawer.querySelector('[data-testid="chunk-load-recovery"]')!;
    fixture.componentInstance.dialogVisible.set(true);
    await fixture.whenStable();
    const dialog = document.querySelector<HTMLElement>('.p-dialog')!;
    await vi.waitFor(() => expect(panel.parentElement).toBe(dialog));
    expect(drawer.querySelector('[data-testid="overlay-draft"]')).toBe(draft);
    expect(draft.value).toBe('Underlying drawer draft');
    fixture.componentInstance.dialogVisible.set(false);
    await fixture.whenStable();
    await vi.waitFor(() => expect(panel.parentElement).toBe(drawer));
    needsReload.set(false);
    await fixture.whenStable();
    expect(document.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();
    expect(drawer.querySelector('[data-testid="overlay-draft"]')).toBe(draft);
    expect(draft.value).toBe('Underlying drawer draft');
    fixture.destroy();
  });

  it.each(['input', 'textarea', 'select', 'richtext', 'action'] as const)('announces recovery without stealing %s focus or replacing drafts', async (kind) => {
    const needsReload = signal(false);
    const reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const draft = fixture.nativeElement.querySelector('[data-testid="unsaved-form"]') as HTMLInputElement;
    draft.value = 'Unsaved draft';
    const targets = { input: 'unsaved-form', textarea: 'unsaved-textarea', select: 'unsaved-select', richtext: 'unsaved-richtext', action: 'existing-action' };
    const active = fixture.nativeElement.querySelector(`[data-testid="${targets[kind]}"]`) as HTMLElement;
    active.focus();
    expect(fixture.nativeElement.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();

    needsReload.set(true);
    await fixture.whenStable();
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Part of this page couldn't load.");
    expect(alert.textContent).toContain('unsaved changes');
    expect(alert.getAttribute('aria-labelledby')).toBe('chunk-load-recovery-heading');
    expect(alert.querySelector('[data-testid="chunk-load-recovery-support"]')?.textContent).toContain('Contact support');
    const reloadButton = alert.querySelector('[data-testid="chunk-load-recovery-reload"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(active);
    active.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(reload).not.toHaveBeenCalled();
    reloadButton.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="unsaved-form"]')).toBe(draft);
    expect(draft.value).toBe('Unsaved draft');
  });

  it.each(['lost', 'document-root', 'inert'])('recovers %s focus to the banner, never directly to Reload page', async (reason) => {
    const needsReload = signal(false);
    const reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const region = document.createElement('div');
    const field = document.createElement('input');
    region.append(field);
    document.body.append(region);
    field.focus();
    if (reason === 'inert') region.setAttribute('inert', '');
    else region.remove();
    const activeElement = vi.spyOn(document, 'activeElement', 'get');
    if (reason === 'document-root') activeElement.mockReturnValue(document.documentElement);
    try {
      needsReload.set(true);
      await fixture.whenStable();
      const panel = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
      activeElement.mockRestore();
      expect(document.activeElement).toBe(panel);
      expect(panel.getAttribute('tabindex')).toBe('-1');
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      panel.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      activeElement.mockRestore();
      region.remove();
    }
  });
});
