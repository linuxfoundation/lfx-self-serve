// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { mktgKitRootCrumb } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgKitHeaderComponent } from '../components/mktg-kit-header/mktg-kit-header.component';
import { MktgKitTabsComponent } from '../components/mktg-kit-tabs/mktg-kit-tabs.component';

@Component({
  selector: 'lfx-mktg-kit-placeholder',
  imports: [MktgKitTabsComponent, MktgKitHeaderComponent, MktgBreadcrumbComponent],
  templateUrl: './mktg-kit-placeholder.component.html',
})
export class MktgKitPlaceholderComponent {
  private readonly context = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  protected readonly title = this.route.snapshot.data['title'] as string;
  protected readonly projectName = computed(() => this.context.activeContext()?.name ?? 'Project');
  protected readonly projectSlug = computed(() => this.context.activeContext()?.slug ?? null);
  protected readonly crumbs = computed(() => [mktgKitRootCrumb(this.projectName(), ['..']), { label: this.title }]);
}
