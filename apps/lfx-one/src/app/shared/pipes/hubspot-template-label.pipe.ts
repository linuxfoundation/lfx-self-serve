// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { HubSpotMarketingEmail } from '@lfx-one/shared/interfaces';
import { formatHubSpotUpdatedAt } from '@lfx-one/shared/utils';

/**
 * The accessible name for a HubSpot template row.
 *
 * `aria-label` REPLACES descendant text in the accessible name, so a name-only label leaves a
 * screen-reader user with no way to tell two same-named templates apart — which is the whole
 * reason the row renders a subject, state and date at all.
 *
 * A pipe taking the entire template, rather than a component method: `frontend-checklist.md`
 * §4 allows only signal reads, computed values and pipes in templates, and the picker renders
 * up to 500 rows per change-detection pass. Taking the object also sidesteps the Angular
 * parse error that makes a piped value unusable inside a template ternary.
 */
@Pipe({
  name: 'hubspotTemplateLabel',
})
export class HubSpotTemplateLabelPipe implements PipeTransform {
  public transform(template: HubSpotMarketingEmail): string {
    const parts = [`Use template ${template.name || template.subject || template.id}`];
    if (template.subject && template.name) parts.push(`subject ${template.subject}`);
    if (template.state) parts.push(template.state);
    const updated = formatHubSpotUpdatedAt(template.updatedAt);
    if (updated) parts.push(`updated ${updated}`);
    return parts.join(', ');
  }
}
