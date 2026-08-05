// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';

@Component({
  selector: 'lfx-public-profile-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent, OpenIntercomDirective],
  templateUrl: './public-profile-not-found.component.html',
})
export class PublicProfileNotFoundComponent {
  // A private profile responds 200 with `{ isPublic: false }`; the page renders this with isPrivate=true.
  public readonly isPrivate = input(false);

  protected readonly icon = computed(() => (this.isPrivate() ? 'fa-light fa-lock' : 'fa-light fa-user-slash'));
  protected readonly title = computed(() => (this.isPrivate() ? 'Private Profile' : 'Profile Not Found'));
  protected readonly description = computed(() =>
    this.isPrivate()
      ? 'This profile is private. This person has chosen not to share a public profile.'
      : "We couldn't find the profile you're looking for. The username may be incorrect, or the profile may not be public."
  );
}
