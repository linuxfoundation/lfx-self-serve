// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_WRITE_ARTIFACT_TYPES } from '@lfx-one/shared/constants';
import {
  Committee,
  CreatableArtifactType,
  CreatePickerCommitteeNode,
  CreatePickerProjectNode,
  CreatePickerResultSet,
  Project,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { CommitteeService } from './committee.service';
import { ProjectService } from './project.service';

/**
 * Thin composition layer behind the create picker's three endpoints (tree, lazy children,
 * search). Every method here delegates to `ProjectService`/`CommitteeService` methods that are
 * each individually scoped (`filter_grants=direct`, `parent=`, `tags=`, or `name=`) — this class
 * never issues its own unscoped query-service call. It only: (1) decides which relation set
 * applies for a given `artifactType`, (2) partitions direct-grant committees into
 * already-nested-under-a-listed-project vs. orphan top-level rows, and (3) shapes results into
 * the flat `CreatePickerResultSet` the client renders.
 */
export class CreatePickerService {
  private readonly projectService: ProjectService;
  private readonly committeeService: CommitteeService;

  public constructor() {
    this.projectService = new ProjectService();
    this.committeeService = new CommitteeService();
  }

  /**
   * Top-level nodes for the picker's default tree: the user's direct-grant projects, plus any
   * direct-grant committees whose associated project is NOT itself in that project set (those
   * nest under their project client-side instead, once the client expands it).
   */
  public async getTree(req: Request, artifactType: CreatableArtifactType): Promise<CreatePickerResultSet> {
    const includeMeetingCoordinator = artifactType === 'meeting';
    const includeCommittees = COMMITTEE_WRITE_ARTIFACT_TYPES.includes(artifactType);

    const [directProjects, directCommittees] = await Promise.all([
      this.projectService.getDirectGrantProjects(req, includeMeetingCoordinator),
      includeCommittees ? this.committeeService.getDirectGrantCommittees(req) : Promise.resolve([]),
    ]);

    const projectUids = new Set(directProjects.map((p) => p.uid));
    const orphanCommittees = directCommittees.filter((c) => !projectUids.has(c.project_uid));

    return {
      projects: directProjects.map((p) => this.toProjectNode(p)),
      committees: await this.toCommitteeNodes(req, orphanCommittees),
    };
  }

  /**
   * Lazy fan-out for one tree node: a project's child projects + its committees, or a
   * committee's child committees. Reuses `CommitteeService.getCommittees`'s existing
   * `tags=project_uid:` / `parent=committee:` scoped-listing support — only the writer-filter
   * post-processing (this method's own concern, not that method's broader "public || writer ||
   * member" semantics for its other callers) is new here.
   */
  public async getChildren(
    req: Request,
    parentType: 'project' | 'committee',
    parentUid: string,
    artifactType: CreatableArtifactType
  ): Promise<CreatePickerResultSet> {
    const includeMeetingCoordinator = artifactType === 'meeting';
    const includeCommittees = COMMITTEE_WRITE_ARTIFACT_TYPES.includes(artifactType);

    if (parentType === 'project') {
      const [childProjects, projectCommittees] = await Promise.all([
        this.projectService.getChildProjects(req, parentUid, includeMeetingCoordinator),
        includeCommittees ? this.committeeService.getCommittees(req, { tags: `project_uid:${parentUid}` }) : Promise.resolve([]),
      ]);

      return {
        projects: childProjects.map((p) => this.toProjectNode(p)),
        committees: await this.toCommitteeNodes(
          req,
          projectCommittees.filter((c) => c.writer === true)
        ),
      };
    }

    if (!includeCommittees) {
      return { projects: [], committees: [] };
    }

    const childCommittees = await this.committeeService.getCommittees(req, { parent: `committee:${parentUid}` });
    return {
      projects: [],
      committees: await this.toCommitteeNodes(
        req,
        childCommittees.filter((c) => c.writer === true)
      ),
    };
  }

  /**
   * Type-ahead search across both resource types. Every row here passed a batch access-check
   * that evaluates inherited access (not just direct grants) — this is how an inherited-writer
   * reaches a target that the direct-grant tree under-shows.
   */
  public async search(req: Request, term: string, artifactType: CreatableArtifactType): Promise<CreatePickerResultSet> {
    const includeMeetingCoordinator = artifactType === 'meeting';
    const includeCommittees = COMMITTEE_WRITE_ARTIFACT_TYPES.includes(artifactType);

    const [projects, committees] = await Promise.all([
      this.projectService.searchCreatableProjects(req, term, includeMeetingCoordinator),
      includeCommittees ? this.committeeService.searchCreatableCommittees(req, term) : Promise.resolve([]),
    ]);

    return {
      projects: projects.map((p) => this.toProjectNode(p)),
      committees: await this.toCommitteeNodes(req, committees),
    };
  }

  private toProjectNode(project: Project): CreatePickerProjectNode {
    return {
      kind: 'project',
      uid: project.uid,
      name: project.name,
      slug: project.slug,
      isFoundation: computeIsFoundation(project),
    };
  }

  /**
   * Reuses `ProjectService.enrichWithProjectData` (already used elsewhere to enrich items keyed
   * by `project_uid`) to resolve each committee's `is_foundation`/`project_slug`/`project_name`
   * in one deduplicated batch, rather than a bespoke lookup.
   */
  private async toCommitteeNodes(req: Request, committees: Committee[]): Promise<CreatePickerCommitteeNode[]> {
    if (committees.length === 0) {
      return [];
    }

    const enriched = await this.projectService.enrichWithProjectData(req, committees);
    return enriched.map((c) => ({
      kind: 'committee',
      uid: c.uid,
      name: c.name,
      projectUid: c.project_uid,
      projectSlug: c.project_slug,
      projectName: c.project_name,
      isFoundation: c.is_foundation,
    }));
  }
}
