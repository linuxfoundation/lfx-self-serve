// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MKTG_AGENT_INTAKES, MKTG_AGENTS, MKTG_RUN_STAGES } from '@lfx-one/shared/constants';
import {
  MktgAgent,
  MktgAgentAccent,
  MktgAgentIntake,
  MktgIntakePrefillSource,
  MktgRunPhase,
  MktgRunVersion,
  MktgStoredAgentRun,
} from '@lfx-one/shared/interfaces';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { map } from 'rxjs';

import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';

// Form-first agent run page (approved Marketing OS design): batch intake form
// → staged running checklist → document result with versions and a
// "Request changes" feedback box that regenerates as v+1 through the existing
// chat/session BFF. The page is driven entirely by the shared intake registry
// (MKTG_AGENT_INTAKES), so additional agent forms slot in without touching the
// shell.
@Component({
  selector: 'lfx-mktg-agent-run',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, InputTextComponent, TextareaComponent, MarkdownRendererComponent, MessageComponent],
  templateUrl: './mktg-agent-run.component.html',
})
export class MktgAgentRunComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectContext = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);

  // === Catalog lookups (route param is stable for the component's lifetime) ===
  protected readonly agent: MktgAgent | null = this.resolveAgent();
  protected readonly intake: MktgAgentIntake | null = this.agent ? (MKTG_AGENT_INTAKES[this.agent.id] ?? null) : null;

  // === Constants ===
  protected readonly stageLabels = MKTG_RUN_STAGES;

  // === Forms ===
  protected readonly intakeForm: FormGroup<Record<string, FormControl<string>>> = this.buildIntakeForm();
  protected readonly feedbackForm = new FormGroup({
    feedback: new FormControl('', { nonNullable: true }),
  });

  // === Signals ===
  protected readonly phase = signal<MktgRunPhase>('form');
  protected readonly stage = signal(0);
  protected readonly errorText = signal('');
  protected readonly run = signal<MktgStoredAgentRun | null>(null);
  protected readonly viewVersion = signal<number | null>(null);
  protected readonly docExpanded = signal(false);
  /** Field keys pre-filled from LFX data this session — drives the "From LFX" chips. */
  protected readonly fromLfx = signal<Record<string, boolean>>({});

  // === Computed ===
  private readonly intakeValid = toSignal(this.intakeForm.statusChanges.pipe(map((status) => status === 'VALID')), { initialValue: this.intakeForm.valid });
  private readonly feedbackValue = toSignal(this.feedbackForm.controls.feedback.valueChanges, { initialValue: '' });

  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name || 'Your Project');
  protected readonly formTitle = computed(() => `${this.intake?.formTitleAction} the ${this.projectName()} ${this.intake?.documentName}`);
  protected readonly docTitle = computed(() => `${this.projectName()} ${this.intake?.documentName}`);
  protected readonly submitLabel = computed(() => `Generate ${this.intake?.documentName}`);
  protected readonly versions = computed(() => this.run()?.versions ?? []);
  protected readonly currentVersion: Signal<MktgRunVersion | null> = this.initCurrentVersion();
  protected readonly nextVersion = computed(() => (this.versions().at(-1)?.version ?? 0) + 1);
  protected readonly showVersionChips = computed(() => this.versions().length > 1 && this.phase() !== 'running');
  protected readonly feedbackNote = computed(() => (this.currentVersion()?.feedback ?? '').slice(0, 120));
  protected readonly submitDisabled = computed(() => !this.intakeValid() || this.phase() === 'running');
  protected readonly regenerateDisabled = computed(() => !this.feedbackValue().trim() || !this.intakeValid() || this.phase() === 'running');
  protected readonly stages: Signal<{ label: string; state: 'done' | 'active' | 'pending' }[]> = this.initStages();
  protected readonly sectionChecklist: Signal<{ label: string; present: boolean }[]> = this.initSectionChecklist();

  // Accent → Tailwind classes, kept as a class field with literal class names so
  // Tailwind's content scan (./src/**/*.ts) generates them.
  private readonly accentIcon: Record<MktgAgentAccent, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  private readonly stageLabelClass: Record<'done' | 'active' | 'pending', string> = {
    done: 'text-gray-400',
    active: 'text-gray-600',
    pending: 'text-gray-300',
  };

  public constructor() {
    // Unknown, coming-soon, or intake-less agents have no run page — back to the grid.
    if (!this.agent || this.agent.status !== 'active' || !this.intake) {
      this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
      return;
    }
    // Stored runs + LFX prefill read browser state (localStorage, HTTP-backed
    // project detail) — apply after hydration so SSR output stays stable.
    afterNextRender(() => this.restoreAndPrefill());
  }

  // === Protected methods ===
  protected iconClass(agent: MktgAgent): string {
    return this.accentIcon[agent.accent ?? 'gray'];
  }

  protected tagline(agent: MktgAgent): string {
    return agent.tags.join(' · ');
  }

  protected onBack(): void {
    this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  protected onSubmit(): void {
    if (this.submitDisabled()) {
      return;
    }
    this.startGeneration();
  }

  protected onRegenerate(): void {
    if (this.regenerateDisabled()) {
      return;
    }
    this.startGeneration(this.feedbackForm.controls.feedback.value.trim());
  }

  protected onEditInputs(): void {
    this.phase.set('form');
  }

  protected onPickVersion(version: number): void {
    this.viewVersion.set(version);
    this.docExpanded.set(false);
    this.phase.set('result');
  }

  protected onToggleDocument(): void {
    this.docExpanded.update((expanded) => !expanded);
  }

  protected stageClass(state: 'done' | 'active' | 'pending'): string {
    return this.stageLabelClass[state];
  }

  protected onDownload(): void {
    const current = this.currentVersion();
    if (!current) {
      return;
    }
    const blob = new Blob([current.document], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.docTitle()} v${current.version}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // === Private initializers ===
  private initCurrentVersion(): Signal<MktgRunVersion | null> {
    return computed(() => {
      const versions = this.versions();
      return versions.find((candidate) => candidate.version === this.viewVersion()) ?? versions.at(-1) ?? null;
    });
  }

  private initStages(): Signal<{ label: string; state: 'done' | 'active' | 'pending' }[]> {
    return computed(() => {
      const current = this.stage();
      return this.stageLabels.map((label, index) => {
        let state: 'done' | 'active' | 'pending' = 'pending';
        if (index < current) {
          state = 'done';
        } else if (index === current) {
          state = 'active';
        }
        return { label, state };
      });
    });
  }

  private initSectionChecklist(): Signal<{ label: string; present: boolean }[]> {
    return computed(() => {
      const document = this.currentVersion()?.document ?? '';
      const lowerDoc = document.toLowerCase();
      return (this.intake?.sections ?? []).map((label) => ({ label, present: this.sectionPresent(lowerDoc, label) }));
    });
  }

  // === Private helpers ===
  private resolveAgent(): MktgAgent | null {
    const agentId = this.route.snapshot.paramMap.get('agentId') ?? '';
    return MKTG_AGENTS.find((candidate) => candidate.id === agentId) ?? null;
  }

  private buildIntakeForm(): FormGroup<Record<string, FormControl<string>>> {
    const controls: Record<string, FormControl<string>> = {};
    for (const field of this.intake?.fields ?? []) {
      controls[field.key] = new FormControl('', { nonNullable: true, validators: [trimmedRequired()] });
    }
    return new FormGroup(controls);
  }

  private restoreAndPrefill(): void {
    const context = this.projectContext.activeContext();
    if (!this.agent || !this.intake || !context) {
      return;
    }

    const stored = this.runService.loadRun(context.uid, this.agent.id);
    if (stored) {
      this.run.set(stored);
      this.intakeForm.patchValue(stored.answers);
      this.viewVersion.set(stored.versions.at(-1)?.version ?? null);
      if (stored.versions.length > 0) {
        this.phase.set('result');
      }
    }

    // LFX prefill — fill only still-empty answers, and mark them "From LFX".
    this.applyPrefill('project-name', context.name);
    this.projectService
      .getProject(context.slug, false)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((project) => {
        if (!project) {
          return;
        }
        this.applyPrefill('repository-url', project.repository_url);
        this.applyPrefill('project-description', project.description);
      });
  }

  private applyPrefill(source: MktgIntakePrefillSource, value: string | null | undefined): void {
    const trimmedValue = value?.trim();
    if (!trimmedValue || !this.intake) {
      return;
    }
    for (const field of this.intake.fields) {
      if (field.prefill !== source) {
        continue;
      }
      const control = this.intakeForm.controls[field.key];
      if (control && !control.value.trim()) {
        control.setValue(trimmedValue);
        this.fromLfx.update((flags) => ({ ...flags, [field.key]: true }));
      }
    }
  }

  private startGeneration(feedback?: string): void {
    const projectUid = this.projectContext.activeContextUid();
    if (!this.agent || !this.intake) {
      return;
    }
    if (!projectUid) {
      this.errorText.set('No active project — select a project before running this agent.');
      return;
    }

    const answers: Record<string, string> = {};
    for (const field of this.intake.fields) {
      answers[field.key] = this.intakeForm.controls[field.key].value.trim();
    }
    const priorVersion = feedback === undefined ? undefined : this.versions().at(-1)?.version;

    this.errorText.set('');
    this.docExpanded.set(false);
    this.phase.set('running');
    this.stage.set(0);

    this.runService
      .generate({ agentId: this.agent.id, projectUid, intake: this.intake, answers, feedback, priorVersion })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (progress) => {
          if (progress.type === 'submitted') {
            this.stage.set(1);
            return;
          }
          this.stage.set(2);
          this.completeRun(progress.run);
        },
        error: () => {
          this.errorText.set('The agent could not complete this run. Your answers are kept — try again.');
          this.phase.set(this.versions().length > 0 ? 'result' : 'form');
        },
      });
  }

  private completeRun(run: MktgStoredAgentRun): void {
    this.run.set(run);
    this.viewVersion.set(run.versions.at(-1)?.version ?? null);
    this.feedbackForm.reset();
    // Let the "Validating required sections" stage register before the result lands.
    setTimeout(() => this.phase.set('result'), 600);
  }

  private sectionPresent(lowerDoc: string, label: string): boolean {
    if (!lowerDoc) {
      return false;
    }
    if (lowerDoc.includes(label.toLowerCase())) {
      return true;
    }
    const core = label.replace(/^\d+\.\s*/, '').replace(/^appendix [a-z]:\s*/i, '');
    return lowerDoc.includes(core.toLowerCase());
  }
}
