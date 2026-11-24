// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import { META_DEVICE_PLATFORM_OPTIONS, META_OS_FAMILY_OPTIONS } from '@lfx-one/shared/constants';
import type { MetaDeviceOsDraft, MetaDeviceOsOptionView } from '@lfx-one/shared/interfaces';
import { metaDeviceOsOptionViews, metaDeviceOsWithValue } from '@lfx-one/shared/utils';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';

/**
 * The Meta devices and operating systems on the Implement tab (#5904 row 6). Each group shows only on its own explicit
 * yes; the parent decides both, owns the draft, sends it, and holds Create. The rules, including what desktop only
 * cannot be combined with, live in `campaign-meta-device-os.utils.ts`; the parent shows their message.
 */
@Component({
  selector: 'lfx-meta-device-os-options',
  imports: [UiCheckboxComponent],
  templateUrl: './meta-device-os-options.component.html',
})
export class MetaDeviceOsOptionsComponent {
  public readonly deviceShown = input<boolean>(false);
  public readonly osShown = input<boolean>(false);

  public readonly deviceOs = model.required<MetaDeviceOsDraft>();

  protected readonly devices = computed<MetaDeviceOsOptionView[]>(() => metaDeviceOsOptionViews(META_DEVICE_PLATFORM_OPTIONS, this.deviceOs().devicePlatforms));
  protected readonly systems = computed<MetaDeviceOsOptionView[]>(() => metaDeviceOsOptionViews(META_OS_FAMILY_OPTIONS, this.deviceOs().userOs));

  protected onDeviceToggle(value: string, on: boolean): void {
    this.deviceOs.update((d) => ({ ...d, devicePlatforms: metaDeviceOsWithValue(d.devicePlatforms, value, on, META_DEVICE_PLATFORM_OPTIONS) }));
  }

  protected onOsToggle(value: string, on: boolean): void {
    this.deviceOs.update((d) => ({ ...d, userOs: metaDeviceOsWithValue(d.userOs, value, on, META_OS_FAMILY_OPTIONS) }));
  }
}
