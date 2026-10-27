// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { EmailBodyPreviewComponent } from '@components/email-body-preview/email-body-preview.component';
import { ProjectSettings, RenderedSurveyEmail, SurveySentEmailDialogData } from '@lfx-one/shared/interfaces';
import { renderSurveyEmailForRecipient } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, of } from 'rxjs';

/**
 * Shows a survey's sent email as one recipient received it: their name, organization,
 * project and personal link filled in. Ported from PCC's `viewSentEmail` (lfx-pcc#3630).
 */
@Component({
  selector: 'lfx-survey-sent-email-dialog',
  imports: [ButtonComponent, EmailBodyPreviewComponent],
  templateUrl: './survey-sent-email-dialog.component.html',
})
export class SurveySentEmailDialogComponent {
  // === Services ===
  private readonly config = inject<DynamicDialogConfig<SurveySentEmailDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // === Derived Signals ===
  /** ED and PM names come from project settings; a failed read leaves those placeholders blank. */
  private readonly settings: Signal<ProjectSettings | null> = this.initSettings();

  // === Computed Signals ===
  protected readonly recipientName: string = this.initRecipientName();
  protected readonly email: Signal<RenderedSurveyEmail | null> = this.initEmail();

  // === Protected Methods ===
  protected close(): void {
    this.dialogRef.close();
  }

  // === Private Initializers ===
  private initSettings(): Signal<ProjectSettings | null> {
    const projectUid = this.projectContextService.activeContext()?.uid;
    const settings$ = projectUid ? this.permissionsService.getProjectSettings(projectUid).pipe(catchError(() => of(null))) : of(null);
    return toSignal(settings$, { initialValue: null });
  }

  private initRecipientName(): string {
    const response = this.config.data?.response;
    return `${response?.first_name ?? ''} ${response?.last_name ?? ''}`.trim() || response?.email || '';
  }

  private initEmail(): Signal<RenderedSurveyEmail | null> {
    return computed(() => {
      const data = this.config.data;
      if (!data?.survey?.email_body) {
        return null;
      }
      const settings = this.settings();
      const project = this.projectContextService.activeProject();
      const rendered = renderSurveyEmailForRecipient(data.survey, data.response, {
        projectName: project?.name,
        projectLogo: project?.logo_url,
        executiveDirectorName: settings?.executive_director?.name,
        programManagerName: settings?.program_manager?.name,
      });
      return { ...rendered, html: this.linkifyBareUrls(rendered.html) };
    });
  }

  // === Private Helpers ===
  /** Mail clients turn bare URLs and addresses into links; do the same so the preview matches. Browser-only. */
  private linkifyBareUrls(html: string): string {
    if (!this.isBrowser || typeof DOMParser === 'undefined') {
      return html;
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    for (const node of textNodes) {
      if (node.parentElement?.closest('a')) {
        continue;
      }
      const text = node.textContent ?? '';
      const fragment = doc.createDocumentFragment();
      let lastIndex = 0;

      for (const match of text.matchAll(/(https?:\/\/[^\s<"']+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
        const [fullMatch, url, address] = match;
        const index = match.index ?? 0;
        if (index > lastIndex) {
          fragment.append(doc.createTextNode(text.slice(lastIndex, index)));
        }
        const anchor = doc.createElement('a');
        anchor.href = url ?? `mailto:${address}`;
        anchor.textContent = fullMatch;
        if (url) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
        }
        fragment.append(anchor);
        lastIndex = index + fullMatch.length;
      }

      if (lastIndex > 0) {
        fragment.append(doc.createTextNode(text.slice(lastIndex)));
        node.replaceWith(fragment);
      }
    }

    return doc.documentElement.outerHTML;
  }
}
