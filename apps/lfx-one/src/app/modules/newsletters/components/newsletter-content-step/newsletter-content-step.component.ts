// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { NewsletterLayout } from '@lfx-one/shared/interfaces';

import { NewsletterBlockComposerComponent } from '../newsletter-block-composer/newsletter-block-composer.component';

@Component({
  selector: 'lfx-newsletter-content-step',
  imports: [ReactiveFormsModule, InputTextComponent, NewsletterBlockComposerComponent],
  templateUrl: './newsletter-content-step.component.html',
})
export class NewsletterContentStepComponent {
  // === Inputs ===
  public readonly form = input.required<FormGroup>();

  // === Derived ===
  // Seed the composer from the form's current body_layout so drafts and step
  // revisits rehydrate the canvas. body_layout is the authored source of truth;
  // the server derives body_html from it on save (render-on-write).
  protected readonly initialLayout: Signal<NewsletterLayout | null> = computed(() => (this.form().get('bodyLayout')?.value as NewsletterLayout | null) ?? null);

  protected onLayoutChange(layout: NewsletterLayout): void {
    this.form().get('bodyLayout')?.setValue(layout);
  }
}
