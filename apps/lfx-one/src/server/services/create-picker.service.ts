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
import { logger } from './logger.service';
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
   *
   * Also excludes any project/committee whose immediate parent is itself in the direct-grant set
   * — that node already surfaces once its parent is expanded (`getChildren` re-checks it
   * independently), so keeping it at the root too would render it twice.
   */
  public async getTree(req: Request, artifactType: CreatableArtifactType): Promise<CreatePickerResultSet> {
    const includeMeetingCoordinator = artifactType === 'meeting';
    const includeCommittees = COMMITTEE_WRITE_ARTIFACT_TYPES.includes(artifactType);

    logger.debug(req, 'get_create_picker_tree', 'Fetching direct-grant tree', { artifact_type: artifactType, include_committees: includeCommittees });

    const [directProjects, directCommittees] = await Promise.all([
      this.projectService.getDirectGrantProjects(req, includeMeetingCoordinator),
      includeCommittees ? this.committeeService.getDirectGrantCommittees(req) : Promise.resolve([]),
    ]);

    const projectUids = new Set(directProjects.map((p) => p.uid));
    const committeeUids = new Set(directCommittees.map((c) => c.uid));
    const rootProjects = directProjects.filter((p) => !projectUids.has(p.parent_uid));
    const orphanCommittees = directCommittees.filter((c) => !projectUids.has(c.project_uid) && !(c.parent_uid && committeeUids.has(c.parent_uid)));

    logger.debug(req, 'get_create_picker_tree', 'Partitioned direct grants into root nodes', {
      direct_project_count: directProjects.length,
      direct_committee_count: directCommittees.length,
      root_project_count: rootProjects.length,
      orphan_committee_count: orphanCommittees.length,
    });

    return {
      projects: rootProjects.map((p) => this.toProjectNode(p)),
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

    logger.debug(req, 'get_create_picker_children', 'Fetching lazy tree fan-out', {
      parent_type: parentType,
      parent_uid: parentUid,
      artifact_type: artifactType,
    });

    if (parentType === 'project') {
      const [childProjects, projectCommittees] = await Promise.all([
        this.projectService.getChildProjects(req, parentUid, includeMeetingCoordinator),
        includeCommittees
          ? this.committeeService.getCommittees(req, { tags: `project_uid:${parentUid}` }, { skipMailingListEnrichment: true })
          : Promise.resolve([]),
      ]);

      const writableCommittees = projectCommittees.filter((c) => c.writer === true);
      const writableUids = new Set(writableCommittees.map((c) => c.uid));
      // tags=project_uid: returns every committee under the project, top-level AND nested — nest a
      // committee under its actual parent (exclude it here) only when that parent is ALSO writable
      // and will therefore render as an expandable row under this project. If the parent isn't
      // writable (or isn't under this project at all), it's invisible in the tree, so surface the
      // committee directly here instead of making it unreachable.
      const directChildCommittees = writableCommittees.filter((c) => !c.parent_uid || !writableUids.has(c.parent_uid));

      return {
        projects: childProjects.map((p) => this.toProjectNode(p)),
        committees: await this.toCommitteeNodes(req, directChildCommittees),
      };
    }

    if (!includeCommittees) {
      return { projects: [], committees: [] };
    }

    const childCommittees = await this.committeeService.getCommittees(req, { parent: `committee:${parentUid}` }, { skipMailingListEnrichment: true });
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

    logger.debug(req, 'search_create_picker', 'Searching creatable projects/committees', { term_length: term.length, artifact_type: artifactType });

    const [projects, committees] = await Promise.all([
      this.projectService.searchCreatableProjects(req, term, includeMeetingCoordinator),
      includeCommittees ? this.committeeService.searchCreatableCommittees(req, term) : Promise.resolve([]),
    ]);

    logger.debug(req, 'search_create_picker', 'Search results resolved', {
      permitted_project_count: projects.length,
      permitted_committee_count: committees.length,
    });

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
   * Resolves each committee's parent project via `ProjectService.getProjectsByIds` — a true
   * single-request-per-chunk batch (`filters_or=uid:X`), not `enrichWithProjectData`'s N
   * individual per-project lookups. Committees whose project can't be resolved are omitted
   * entirely rather than emitted with blank `projectSlug`/`projectName`: a picked row with an
   * empty project slug would navigate with `?project=` empty, which `writerGuard` cannot resolve —
   * exactly the post-selection dead end this picker is supposed to make impossible.
   */
  private async toCommitteeNodes(req: Request, committees: Committee[]): Promise<CreatePickerCommitteeNode[]> {
    if (committees.length === 0) {
      return [];
    }

    const projectUids = [...new Set(committees.map((c) => c.project_uid).filter(Boolean))];
    const projectsByUid = await this.projectService.getProjectsByIds(req, projectUids);

    return committees.flatMap((c): CreatePickerCommitteeNode[] => {
      const project = projectsByUid.get(c.project_uid);
      if (!project) {
        return [];
      }
      return [
        {
          kind: 'committee',
          uid: c.uid,
          name: c.name,
          projectUid: c.project_uid,
          projectSlug: project.slug,
          projectName: project.name,
          isFoundation: computeIsFoundation(project),
        },
      ];
    });
  }
}
