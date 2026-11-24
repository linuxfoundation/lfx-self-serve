// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';

/**
 * Where an objection to who a post is written as lands: the drafter's profile, never the post's content.
 * The author edits the profile and drafts again; another writer drafts as themselves.
 */
@Component({
  selector: 'lfx-linkedin-post-identity',
  imports: [ButtonComponent],
  templateUrl: './linkedin-post-identity.component.html',
})
export class LinkedinPostIdentityComponent {
  public readonly authorName = input<string | null>(null);
  public readonly isAuthor = input(false);
  public readonly editAndRedraft = output<void>();
  public readonly draftAsMe = output<void>();
  protected readonly open = signal(false);
}
