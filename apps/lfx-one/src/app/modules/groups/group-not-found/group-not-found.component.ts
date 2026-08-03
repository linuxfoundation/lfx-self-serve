// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { map } from 'rxjs';

@Component({
  selector: 'lfx-group-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent, OpenIntercomDirective],
  templateUrl: './group-not-found.component.html',
})
export class GroupNotFoundComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly isPrivate = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('reason') === 'private')), { initialValue: false });

  protected readonly icon = computed(() => (this.isPrivate() ? 'fa-light fa-lock' : 'fa-light fa-users-slash'));
  protected readonly title = computed(() => (this.isPrivate() ? 'Private Group' : 'Group Not Found'));
  protected readonly description = computed(() =>
    this.isPrivate()
      ? 'This group is private and can only be accessed by its members. If you believe you should have access, please contact the group administrator or sign in.'
      : "We couldn't find the group you're looking for. It may have been removed or the link may be incorrect."
  );
}
