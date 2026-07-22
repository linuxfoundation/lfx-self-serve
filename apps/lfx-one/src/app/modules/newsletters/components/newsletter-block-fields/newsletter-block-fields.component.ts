// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, input, OnDestroy, output, Signal, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { NEWSLETTER_SPACING_DEFAULT, NEWSLETTER_SPACING_MARGIN_KEY, NEWSLETTER_SPACING_PADDING_KEY } from '@lfx-one/shared/constants';
import { NewsletterComposerBlock, NewsletterFieldDefinition, NewsletterFieldEntry, NewsletterFieldSchema } from '@lfx-one/shared/interfaces';
import { humanizeFieldKey } from '@lfx-one/shared/utils';

/**
 * Fields panel for the newsletter block-composer (LFXV2-2382).
 *
 * Given the currently selected canvas block and its manifest `schema`, renders
 * one form control per field bound to `block.content[field]`. Field types map to
 * the existing LFX form wrappers:
 *   - text     → lfx-input-text
 *   - textarea → lfx-textarea
 *   - richtext → lfx-rich-editor (Tiptap)
 *   - number   → lfx-input-number
 *   - select   → lfx-select (options from the field's schema `options`)
 *   - array    → a repeatable list of nested field groups (add / remove item)
 *   - image    → lfx-input-text (URL string; no upload widget yet)
 *
 * The panel drives a single reactive `FormGroup` keyed by field name (array
 * fields use a `FormArray` of per-item `FormGroup`s). It rebuilds the form when
 * the selected block changes (keyed by block `id`) and re-emits the assembled
 * `content` object on every value change so the composer can update the block
 * immutably and re-emit its layout.
 *
 * When no block is selected, an empty placeholder is shown.
 */
@Component({
  selector: 'lfx-newsletter-block-fields',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, TextareaComponent, RichEditorComponent, InputNumberComponent, SelectComponent],
  templateUrl: './newsletter-block-fields.component.html',
})
export class NewsletterBlockFieldsComponent implements OnDestroy {
  // === Inputs ===
  /** The selected canvas block (null when nothing is selected). */
  public readonly block = input<NewsletterComposerBlock | null>(null);
  // Whether to show the per-block outer-spacing controls. Off for container
  // children: the upstream render applies spacing only to top-level blocks, so
  // exposing it for children would show canvas spacing the sent email drops.
  public readonly showSpacing = input<boolean>(true);
  /** The selected block's manifest field schema (null when unknown). */
  public readonly schema = input<NewsletterFieldSchema | null>(null);

  // === Outputs ===
  /** Emits the block's assembled content object whenever a field changes. */
  public readonly contentChange = output<Record<string, unknown>>();

  // === Writable Signals ===
  // The reactive form backing the rendered controls. Rebuilt per selected block.
  protected readonly form = signal<FormGroup | null>(null);

  // === Computed Signals ===
  // The non-slot fields to render, flattened with their key (ordered by schema).
  protected readonly fieldEntries: Signal<NewsletterFieldEntry[]> = this.initFieldEntries();

  // Reserved keys for the universal Spacing controls, surfaced to the template.
  protected readonly paddingKey = NEWSLETTER_SPACING_PADDING_KEY;
  protected readonly marginKey = NEWSLETTER_SPACING_MARGIN_KEY;

  // The block id the current form was built for, to detect selection changes.
  private builtForBlockId: string | null = null;
  // A signature of the field SET the form was built for. Switching libraries can
  // keep the same block id while swapping the block's manifest schema (a
  // different field set), so the form rebuilds when this changes even if the id
  // does not — otherwise the FormGroup keeps the previous library's controls.
  private builtForFieldsKey: string | null = null;
  // The `content` reference the form currently reflects — set when the form is
  // (re)built and whenever the panel emits its own edit. An incoming block whose
  // `content` is a DIFFERENT reference (e.g. an inline canvas edit) means the
  // panel is stale and must rebuild; the panel's own edits keep this reference,
  // so they don't trigger a rebuild loop.
  private syncedContent: Record<string, unknown> | null = null;
  private valueSub: Subscription | null = null;
  // Suppress the value-change emit while we (re)build the form from inputs.
  private suppressEmit = false;

  public constructor() {
    // SANCTIONED EXCEPTION to the frontend-checklist "no effect()" rule (§5):
    // this orchestrates a reactive FormGroup imperatively — rebuilding on
    // block-id change and patching controls in place on external content change —
    // which needs direct, ordered control of `FormGroup`/`FormArray` mutation
    // (and the Tiptap binding) that a derived toObservable→toSignal pipe can't
    // express. Rebuild the form when the selected block changes (by id); patch in
    // place when only its content changed.
    effect(() => {
      const block = this.block();
      const entries = this.fieldEntries();
      if (!block) {
        this.teardownForm();
        this.builtForBlockId = null;
        this.builtForFieldsKey = null;
        this.form.set(null);
        return;
      }
      const fieldsKey = this.fieldsKey(entries);
      if (block.id === this.builtForBlockId && fieldsKey === this.builtForFieldsKey) {
        // Same block AND same schema: its content may have changed underneath the
        // panel via inline canvas editing (a different `content` reference than
        // the form last reflected). Patch the EXISTING controls in place so the
        // sidebar mirrors the new values — crucially without rebuilding the form,
        // which would swap controls the rich-editor never re-binds to. Panel-
        // originated edits keep the same reference, so they no-op.
        if (block.content !== this.syncedContent) {
          this.syncFormValues(block, entries);
        }
        return;
      }
      // New block, OR the same block whose schema changed (a library switch
      // swapped its field set) — rebuild so the controls match the current schema.
      this.buildForm(block, entries);
    });
  }

  public ngOnDestroy(): void {
    this.teardownForm();
  }

  // === Protected Methods (template) ===

  /** A field's display label — explicit `label` or a humanized key. */
  protected fieldLabel(entry: NewsletterFieldEntry): string {
    return entry.label ?? humanizeFieldKey(entry.key);
  }

  /** The FormArray backing an `array` field. */
  protected arrayControl(key: string): FormArray | null {
    const ctrl = this.form()?.get(key);
    return ctrl instanceof FormArray ? ctrl : null;
  }

  /** The per-item FormGroups of an `array` field, for template iteration. */
  protected arrayItems(key: string): FormGroup[] {
    return (this.arrayControl(key)?.controls ?? []) as FormGroup[];
  }

  /** The nested field definitions of an `array` field, flattened with key. */
  protected nestedEntries(entry: NewsletterFieldEntry): NewsletterFieldEntry[] {
    return Object.entries(entry.fields ?? {}).map(([key, def]) => ({ key, ...def }));
  }

  /** Append an empty item group to an `array` field. */
  protected addItem(entry: NewsletterFieldEntry): void {
    const array = this.arrayControl(entry.key);
    if (!array) return;
    array.push(this.buildItemGroup(entry, {}));
  }

  /** Remove an item group from an `array` field. */
  protected removeItem(key: string, index: number): void {
    this.arrayControl(key)?.removeAt(index);
  }

  protected trackByKey(_index: number, entry: NewsletterFieldEntry): string {
    return entry.key;
  }

  // === Private Initializers ===
  private initFieldEntries(): Signal<NewsletterFieldEntry[]> {
    return computed(() => {
      const schema = this.schema();
      if (!schema) return [];
      return Object.entries(schema)
        .filter(([, def]) => def.type !== 'slot')
        .map(([key, def]) => ({ key, ...def }));
    });
  }

  // === Private Helpers ===

  /**
   * Sync an EXTERNAL content change (an inline canvas edit) into the existing
   * form without rebuilding it. `patchValue` updates each control in place and
   * emits per-control change events, so value-accessor wrappers that subscribe to
   * their control — notably the Tiptap rich-editor — pick up the new value (a
   * rebuild would swap in controls the editor never re-binds to). `suppressEmit`
   * blocks the group-level re-emit so this doesn't echo back as a fresh edit.
   *
   * If an array field's item COUNT changed (never from inline editing, which only
   * mutates values), the control structure is stale and we fall back to a rebuild.
   */
  private syncFormValues(block: NewsletterComposerBlock, entries: NewsletterFieldEntry[]): void {
    const group = this.form();
    if (!group) {
      this.buildForm(block, entries);
      return;
    }
    for (const entry of entries) {
      if (entry.type !== 'array') continue;
      const incoming = block.content[entry.key];
      const incomingLength = Array.isArray(incoming) ? incoming.length : 0;
      if ((this.arrayControl(entry.key)?.length ?? 0) !== incomingLength) {
        this.buildForm(block, entries);
        return;
      }
    }

    this.suppressEmit = true;
    group.patchValue(block.content, { emitEvent: true });
    this.suppressEmit = false;
    this.syncedContent = block.content;
  }

  /** Build the reactive form for a block and wire its value-change emit. */
  /**
   * A stable signature of a schema's field set (each field's key + type), used
   * to detect when a library switch swapped a block's fields so the form must be
   * rebuilt rather than patched in place.
   */
  private fieldsKey(entries: NewsletterFieldEntry[]): string {
    return entries.map((entry) => `${entry.key}:${entry.type}`).join('|');
  }

  private buildForm(block: NewsletterComposerBlock, entries: NewsletterFieldEntry[]): void {
    this.teardownForm();

    const group = new FormGroup({});
    for (const entry of entries) {
      group.addControl(entry.key, this.buildControl(entry, block.content[entry.key]));
    }

    // Universal Spacing controls (Padding / Margin), auto-injected at the bottom
    // of every block — mirrors gatewaze's auto-injected `_spacing_*` props.
    group.addControl(this.paddingKey, new FormControl(this.seedSpacing(block.content[this.paddingKey])));
    group.addControl(this.marginKey, new FormControl(this.seedSpacing(block.content[this.marginKey])));

    this.builtForBlockId = block.id;
    this.builtForFieldsKey = this.fieldsKey(entries);
    this.syncedContent = block.content;
    this.form.set(group);

    this.valueSub = group.valueChanges.subscribe(() => {
      if (this.suppressEmit) return;
      const content = this.collect(group, entries);
      // Record the emitted reference so the echo back through `block` doesn't
      // look like an external change and rebuild the form mid-edit.
      this.syncedContent = content;
      this.contentChange.emit(content);
    });
  }

  /** Build a control for a single field, seeded from existing content / default. */
  private buildControl(entry: NewsletterFieldEntry, existing: unknown): FormControl | FormArray {
    if (entry.type === 'array') {
      const items = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : [];
      return new FormArray(items.map((item) => this.buildItemGroup(entry, item)));
    }

    const seeded = existing ?? entry.default ?? this.emptyFor(entry.type);
    return new FormControl(seeded);
  }

  /** Build one FormGroup for an `array` item from its nested field definitions. */
  private buildItemGroup(entry: NewsletterFieldEntry, item: Record<string, unknown>): FormGroup {
    const group = new FormGroup({});
    for (const [key, def] of Object.entries(entry.fields ?? {})) {
      const seeded = item[key] ?? def.default ?? this.emptyFor(def.type);
      group.addControl(key, new FormControl(seeded));
    }
    return group;
  }

  /** Assemble the block content object from the current form value. */
  private collect(group: FormGroup, entries: NewsletterFieldEntry[]): Record<string, unknown> {
    const content: Record<string, unknown> = {};
    for (const entry of entries) {
      const ctrl = group.get(entry.key);
      if (!ctrl) continue;
      content[entry.key] = ctrl.value;
    }
    // Persist the reserved spacing keys alongside the schema fields. Only carry
    // a value when it's a non-default override, so default-spaced blocks keep a
    // clean `content` (matches gatewaze, which skips the wrapper at `0px`).
    for (const key of [this.paddingKey, this.marginKey]) {
      const value = group.get(key)?.value;
      if (typeof value === 'string' && value.trim() && value.trim() !== NEWSLETTER_SPACING_DEFAULT) {
        content[key] = value.trim();
      }
    }
    return content;
  }

  /** Seed a spacing control from existing content, defaulting to `0px`. */
  private seedSpacing(existing: unknown): string {
    return typeof existing === 'string' && existing.trim() ? existing : NEWSLETTER_SPACING_DEFAULT;
  }

  /** Empty seed value for a scalar field type. */
  private emptyFor(type: NewsletterFieldDefinition['type']): unknown {
    return type === 'number' ? null : '';
  }

  private teardownForm(): void {
    this.valueSub?.unsubscribe();
    this.valueSub = null;
  }
}
