// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';

@Component({
  selector: 'lfx-textarea',
  imports: [TextareaModule, ReactiveFormsModule],
  templateUrl: './textarea.component.html',
  styleUrl: './textarea.component.scss',
})
export class TextareaComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();
  public size: Signal<'small' | 'large'> = input<'large' | 'small'>('small');
  public rows = input<number>(3);
  public cols = input<number>();
  public placeholder = input<string>();
  public id = input<string>();
  /** Id applied to the focusable textarea — pair with an external `<label for>`. Prefer this over `id` so the host does not get a duplicate id. */
  public inputId = input<string>();
  public readonly = input<boolean>(false);
  public styleClass = input<string>();
  public autoResize = input<boolean>(false);
  /**
   * Native character cap on the `<textarea>`. Bound as `[attr.maxlength]`, not `[maxlength]`:
   * Angular's `MaxLengthValidator` has selector `[maxlength][formControlName]` and ships in the
   * `ReactiveFormsModule` this component imports, so a property binding here would silently attach
   * a validator to the caller's control and make the whole `FormGroup` invalid — invisible to a
   * caller that only wanted the browser to stop typing at the cap. Callers that want the value
   * gated declare `Validators.maxLength` on the control themselves — the composer's agenda, the
   * crowdfunding initiative settings description and the newsletter drawer's raw content and system
   * prompt among them. The rest rely on the native cap alone, which holds for typing and pasting but
   * not for a value written programmatically with `setValue`.
   */
  public maxlength = input<number>();
  /**
   * Id of the element that describes this field, wired through as `aria-describedby`.
   * @description A hint rendered next to the textarea is invisible to a screen reader unless the
   * field points at it, and the hint lives in the caller's template — only the caller knows which
   * one applies and when. Bound as an attribute so an unset value emits nothing rather than an
   * `aria-describedby` pointing at `""`.
   */
  public ariaDescribedBy = input<string>();
  public dataTest = input<string>();
  /** id of the element describing a validation error (wired to aria-describedby). */
  public describedBy = input<string>();
  /** Marks the control invalid for assistive tech (wired to aria-invalid). */
  public invalid = input<boolean>(false);
  /** Marks the control mandatory for assistive tech (wired to aria-required). */
  public required = input<boolean>(false);

  /**
   * The two description hooks joined, because they share one attribute.
   * @description A field can carry a standing hint (`ariaDescribedBy`) and a transient validation
   * error (`describedBy`) at the same time; letting either win would silently drop the other for a
   * screen reader. Null rather than `''` so an unset pair emits no attribute at all.
   */
  protected readonly describedByIds: Signal<string | null> = this.initDescribedByIds();

  private initDescribedByIds(): Signal<string | null> {
    return computed(() => [this.ariaDescribedBy(), this.describedBy()].filter((id): id is string => !!id).join(' ') || null);
  }
}
