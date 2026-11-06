// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';

/**
 * A document's own markup for a slot box of a print page (`{ t: 'slot', slot: '<name>' }` in the page plan):
 * `<ng-template lfxMktgPrintPageSlot="<name>">…</ng-template>` inside `<lfx-mktg-print-page>`, drawn in the slot's box.
 */
@Directive({ selector: 'ng-template[lfxMktgPrintPageSlot]' })
export class MktgPrintPageSlotDirective {
  public readonly name = input.required<string>({ alias: 'lfxMktgPrintPageSlot' });
  public readonly template = inject(TemplateRef<unknown>);
}
