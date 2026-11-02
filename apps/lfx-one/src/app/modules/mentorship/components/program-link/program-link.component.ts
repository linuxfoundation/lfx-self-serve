// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MentorshipPublicUrlPipe } from '@pipes/mentorship-public-url.pipe';

/**
 * A program name that links, in a new tab, to the program's page on the public mentorship site.
 * Without a usable program id it shows the name as plain text. Inherits the surrounding text styles.
 */
@Component({
  selector: 'lfx-mentorship-program-link',
  imports: [MentorshipPublicUrlPipe],
  templateUrl: './program-link.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramLinkComponent {
  public readonly programId = input<string | undefined>(undefined);
  public readonly programName = input.required<string>();
  /** Test id for the link; used only when the name links. */
  public readonly testId = input<string | undefined>(undefined);
}
