// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MetaDeviceOsDraft } from '@lfx-one/shared/interfaces';
import { emptyMetaDeviceOsDraft } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { MetaDeviceOsOptionsComponent } from './meta-device-os-options.component';

// The rules (what each list may hold, what desktop only cannot be combined with) are tested in
// campaign-meta-device-os.utils.spec.ts; this spec only checks the wiring: each group shows on its own input, and a
// box's tick reaches the model.
describe('MetaDeviceOsOptionsComponent', () => {
  let fixture: ComponentFixture<MetaDeviceOsOptionsComponent>;
  let model: MetaDeviceOsDraft;

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  // The boxes are uikit wrappers, so their handlers are called directly.
  const call = (name: string, ...args: unknown[]): void => {
    (fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetaDeviceOsOptionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(MetaDeviceOsOptionsComponent);
    fixture.componentRef.setInput('deviceShown', true);
    fixture.componentRef.setInput('osShown', false);
    fixture.componentRef.setInput('deviceOs', emptyMetaDeviceOsDraft());
    fixture.componentInstance.deviceOs.subscribe((value) => (model = value));
    fixture.detectChanges();
  });

  it('shows each group only on its own input, with a restored value the boxes do not offer as a box to untick', () => {
    expect(el('meta-device-os-device-mobile')).not.toBeNull();
    expect(el('meta-device-os-systems')).toBeNull();

    fixture.componentRef.setInput('osShown', true);
    fixture.componentRef.setInput('deviceOs', { devicePlatforms: [], userOs: ['iOS_ver_9.0_and_above'] });
    fixture.detectChanges();
    expect(el('meta-device-os-os-iOS')).not.toBeNull();
    expect(el('meta-device-os-os-iOS_ver_9.0_and_above')).not.toBeNull();

    call('onOsToggle', 'iOS_ver_9.0_and_above', false);
    expect(model.userOs).toEqual([]);
  });

  it('ticks devices and systems into the model, in the boxes order', () => {
    call('onDeviceToggle', 'desktop', true);
    call('onDeviceToggle', 'mobile', true);
    call('onOsToggle', 'Android', true);
    expect(model).toEqual({ devicePlatforms: ['mobile', 'desktop'], userOs: ['Android'] });

    call('onDeviceToggle', 'desktop', false);
    expect(model.devicePlatforms).toEqual(['mobile']);
  });
});
