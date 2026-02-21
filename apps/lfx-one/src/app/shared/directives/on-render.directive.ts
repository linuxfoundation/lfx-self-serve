// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Directive, output } from '@angular/core';

@Directive({
  selector: '[lfxOnRender]',
})
export class OnRenderDirective {
  public readonly rendered = output<void>();

  public constructor() {
    afterNextRender(() => this.rendered.emit());
  }
}
