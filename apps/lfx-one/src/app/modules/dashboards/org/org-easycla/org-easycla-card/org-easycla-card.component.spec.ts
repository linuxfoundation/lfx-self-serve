// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaGroup } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { OrgEasyclaCardComponent } from './org-easycla-card.component';

describe('OrgEasyclaCardComponent', () => {
  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      claGroupId: 'cla-group-uuid-1',
      foundationName: 'Nimbus Foundation',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      ...overrides,
    };
  }

  async function render(group: OrgClaGroup): Promise<ComponentFixture<OrgEasyclaCardComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaCardComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaCardComponent);
    fixture.componentRef.setInput('claGroup', group);
    fixture.detectChanges();
    return fixture;
  }

  function textOf(fixture: ComponentFixture<OrgEasyclaCardComponent>, id: string): string | undefined {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
  }

  function allText(fixture: ComponentFixture<OrgEasyclaCardComponent>, id: string): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`)).map((el) => (el as HTMLElement).textContent?.trim() ?? '');
  }

  describe('identity', () => {
    it('names the CLA Group', async () => {
      const fixture = await render(claGroup());

      expect(textOf(fixture, 'org-easycla-card-title')).toBe('Nimbus Foundation CLA');
    });

    it('shows the signing entity when the server sent one', async () => {
      const fixture = await render(claGroup({ signingEntityName: 'Vertex Robotics GmbH', status: 'signed' }));

      expect(textOf(fixture, 'org-easycla-card-signing-entity')).toBe('Signed by Vertex Robotics GmbH');
    });

    // The subline is a claim of its own, sitting under the status pill. Saying "Signed by" beneath
    // a pill reading "Not started" makes the card deny and affirm the same agreement at once.
    it('does not say the entity signed when the agreement is not signed', async () => {
      const fixture = await render(claGroup({ signingEntityName: 'Vertex Robotics GmbH', status: 'not-started' }));

      expect(textOf(fixture, 'org-easycla-card-signing-entity')).toBe('Signing entity: Vertex Robotics GmbH');
      expect(textOf(fixture, 'org-easycla-card-signing-entity')).not.toContain('Signed by');
    });

    // Sanctioned is what the status collapses to when an agreement is both signed and sanctioned,
    // so it carries no signedness of its own and the subline must not supply one.
    it('stays non-committal about signing on a sanctioned agreement', async () => {
      const fixture = await render(claGroup({ signingEntityName: 'Vertex Robotics GmbH', status: 'sanctioned' }));

      expect(textOf(fixture, 'org-easycla-card-signing-entity')).not.toContain('Signed by');
    });

    // The server suppresses it when it matches the organization's own name, which is the common
    // case — repeating the page title under every heading is noise.
    it('shows no signing-entity subline when the server omitted it', async () => {
      const fixture = await render(claGroup({ signingEntityName: undefined }));

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-card-signing-entity"]')).toBeNull();
    });
  });

  describe('coverage', () => {
    it('names the project directly when the CLA Group covers exactly one', async () => {
      const fixture = await render(claGroup({ projects: [{ projectName: 'Cascade' }] }));

      expect(allText(fixture, 'org-easycla-card-coverage')).toEqual(['Cascade']);
    });

    it('names the foundation and counts the projects when it covers several', async () => {
      const fixture = await render(claGroup());

      expect(allText(fixture, 'org-easycla-card-coverage')).toEqual(['Nimbus Foundation', 'Covers 2 projects']);
    });

    it('falls back to the count alone when the foundation is unknown', async () => {
      const fixture = await render(claGroup({ foundationName: undefined }));

      expect(allText(fixture, 'org-easycla-card-coverage')).toEqual(['Covers 2 projects']);
    });

    it('renders no coverage element when nothing is covered', async () => {
      const fixture = await render(claGroup({ projects: [] }));

      expect(allText(fixture, 'org-easycla-card-coverage')).toEqual([]);
    });

    // The coverage dialog ships with the agreement detail view; until then a chip that looks
    // actionable and does nothing reads as a defect.
    it('renders coverage as static text, not as a link or a button', async () => {
      const fixture = await render(claGroup());
      const chips = fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-card-coverage"]');

      for (const chip of chips) {
        expect((chip as HTMLElement).tagName).toBe('SPAN');
        expect((chip as HTMLElement).querySelector('a, button')).toBeNull();
      }
    });
  });

  describe('status', () => {
    it('reads as signed for an ordinary agreement', async () => {
      const fixture = await render(claGroup({ status: 'signed' }));

      expect(textOf(fixture, 'org-easycla-card-status')).toContain('Signed');
    });

    it('reads as sanctioned when the signing entity is flagged', async () => {
      const fixture = await render(claGroup({ status: 'sanctioned' }));

      expect(textOf(fixture, 'org-easycla-card-status')).toContain('Sanctioned');
      expect(textOf(fixture, 'org-easycla-card-status')).not.toContain('Signed');
    });

    // The word matters more than the styling here: an unsigned agreement described as signed
    // is a false statement about the organization's legal position.
    it('reads as not started for an unsigned agreement, never as signed', async () => {
      const fixture = await render(claGroup({ status: 'not-started' }));

      expect(textOf(fixture, 'org-easycla-card-status')).toContain('Not started');
      expect(textOf(fixture, 'org-easycla-card-status')).not.toContain('Signed');
    });
  });

  describe('needs a CLA manager', () => {
    it('flags an agreement with no CLA manager', async () => {
      const fixture = await render(claGroup({ needsClaManager: true, claManagersCount: 0 }));

      expect(textOf(fixture, 'org-easycla-card-needs-manager')).toContain('Needs a CLA Manager');
    });

    it('does not flag a managed agreement', async () => {
      const fixture = await render(claGroup({ needsClaManager: false }));

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-card-needs-manager"]')).toBeNull();
    });

    // Rendered from the flag alone. Re-deriving it from the count here would be a second
    // definition of the same condition, free to drift from the producer's.
    it('follows the flag rather than the manager count', async () => {
      const fixture = await render(claGroup({ needsClaManager: false, claManagersCount: 0 }));

      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-card-needs-manager"]')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('shows the manager count', async () => {
      const fixture = await render(claGroup({ claManagersCount: 3 }));

      expect(textOf(fixture, 'org-easycla-card-manager-count')).toBe('3');
    });

    it('agrees in number with a single manager', async () => {
      const fixture = await render(claGroup({ claManagersCount: 1 }));

      expect(fixture.nativeElement.textContent).toContain('CLA Manager');
      expect(fixture.nativeElement.textContent).not.toContain('CLA Managers');
    });

    it('agrees in number with no managers', async () => {
      const fixture = await render(claGroup({ claManagersCount: 0 }));

      expect(fixture.nativeElement.textContent).toContain('CLA Managers');
    });

    // A CLA service deployment predating the count sends nothing. A zero here would assert the
    // agreement approves nobody — a claim about a company's legal configuration that an absent
    // field cannot support.
    it('shows the approval-entries stat as unavailable rather than as zero', async () => {
      const fixture = await render(claGroup());

      expect(textOf(fixture, 'org-easycla-card-approval-count')).toBe('—');
      expect(textOf(fixture, 'org-easycla-card-approval-count')).not.toBe('0');
      expect(fixture.nativeElement.textContent).toContain('approval entries');
    });

    it('renders a real approval-criteria count when one is supplied', async () => {
      const fixture = await render(claGroup({ approvalCriteriaCount: 7 }));

      expect(textOf(fixture, 'org-easycla-card-approval-count')).toBe('7');
    });

    it('renders a supplied count of zero as zero, not as unavailable', async () => {
      const fixture = await render(claGroup({ approvalCriteriaCount: 0 }));

      expect(textOf(fixture, 'org-easycla-card-approval-count')).toBe('0');
    });

    // Agreement in number, as the manager label beside it already does. Invisible while every
    // value was a placeholder; a populated count of one exposed it.
    it('says "approval entry" for exactly one', async () => {
      const fixture = await render(claGroup({ approvalCriteriaCount: 1 }));

      expect(textOf(fixture, 'org-easycla-card-approval-label')).toBe('approval entry');
    });

    it('says "approval entries" for a count that is not one', async () => {
      const fixture = await render(claGroup({ approvalCriteriaCount: 4 }));

      expect(textOf(fixture, 'org-easycla-card-approval-label')).toBe('approval entries');
    });

    it('keeps the plural when no count is available, since none has been stated', async () => {
      const fixture = await render(claGroup());

      expect(textOf(fixture, 'org-easycla-card-approval-label')).toBe('approval entries');
    });
  });
});
