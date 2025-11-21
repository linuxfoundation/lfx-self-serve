// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { AccountContextService } from '@app/shared/services/account-context.service';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-data-copilot',
  standalone: true,
  imports: [DrawerModule, ButtonComponent],
  templateUrl: './data-copilot.component.html',
  styleUrl: './data-copilot.component.scss',
})
export class DataCopilotComponent {
  public readonly iframeContainer = viewChild<ElementRef<HTMLDivElement>>('iframeContainer');

  // Optional inputs to control which fields are included in the iframe URL
  public readonly includeOrganizationId = input<boolean>(true);
  public readonly includeOrganizationName = input<boolean>(true);
  public readonly includeProjectSlug = input<boolean>(true);
  public readonly includeProjectName = input<boolean>(true);

  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Feature flag for LFX Lens visibility
  protected readonly isLfxLensEnabled = this.featureFlagService.getBooleanFlag('lfx-lens', false);

  // Computed values from context services with null safety
  private readonly organizationId = computed(() => this.accountContextService.selectedAccount()?.accountId ?? '');
  private readonly organizationName = computed(() => this.accountContextService.selectedAccount()?.accountName ?? '');
  private readonly projectContext = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly projectSlug = computed(() => this.projectContext()?.slug ?? '');
  private readonly projectName = computed(() => this.projectContext()?.name ?? '');

  // Drawer visibility control
  public readonly visible = signal<boolean>(false);

  private iframeCreated = false;

  /**
   * Open the drawer
   */
  protected openDrawer(): void {
    this.visible.set(true);
  }

  /**
   * Handle drawer show event (after animation completes)
   */
  protected onShow(): void {
    this.visible.set(true);

    // Create iframe when drawer is fully visible
    if (!this.iframeCreated) {
      this.createIframe();
    }
  }

  /**
   * Handle drawer hide event
   */
  protected onHide(): void {
    this.visible.set(false);

    // Destroy iframe when drawer is closed
    this.destroyIframe();
  }

  /**
   * Destroy the iframe and cleanup resources
   */
  private destroyIframe(): void {
    const container = this.iframeContainer();
    if (container?.nativeElement) {
      // Remove all child nodes (iframe)
      while (container.nativeElement.firstChild) {
        container.nativeElement.removeChild(container.nativeElement.firstChild);
      }
    }
    this.iframeCreated = false;
  }

  /**
   * Create and append the iframe to the container
   */
  private createIframe(): void {
    const container = this.iframeContainer();
    if (this.iframeCreated || !container?.nativeElement) {
      return;
    }

    const iframe = document.createElement('iframe');

    // Construct the iframe src with query parameters conditionally
    const params = new URLSearchParams();

    if (this.includeOrganizationId()) {
      params.append('organization_id', this.organizationId());
    }

    if (this.includeOrganizationName()) {
      params.append('organization_name', this.organizationName());
    }

    if (this.includeProjectSlug()) {
      params.append('project_slug', this.projectSlug());
    }

    if (this.includeProjectName()) {
      params.append('project_name', this.projectName());
    }

    iframe.src = `https://lfx-data-copilot.onrender.com/embed?${params.toString()}`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.style.border = 'none';
    iframe.title = 'LFX Data Copilot';

    // Append the iframe to the container
    container.nativeElement.appendChild(iframe);
    this.iframeCreated = true;
  }
}
