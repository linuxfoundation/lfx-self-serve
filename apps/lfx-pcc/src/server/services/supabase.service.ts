// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Committee,
  CommitteeMember,
  CreateCommitteeMemberRequest,
  CreateMeetingRequest,
  Meeting,
  MeetingParticipant,
  ObjectPermission,
  ProjectSearchResult,
  RecentActivity,
  UpdateMeetingRequest,
  UserPermissions,
} from '@lfx-pcc/shared/interfaces';
import dotenv from 'dotenv';

dotenv.config();

export class SupabaseService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number = 30000;

  public constructor() {
    const supabaseUrl = process.env['SUPABASE_URL'];
    const apiKey = process.env['POSTGRES_API_KEY'];

    this.baseUrl = `${supabaseUrl}/rest/v1`;
    this.apiKey = apiKey || '';
  }

  public async getProjects(params?: Record<string, any>) {
    const queryString = params ? new URLSearchParams(params).toString() : '';
    const url = queryString ? `${this.baseUrl}/projects?${queryString}` : `${this.baseUrl}/projects`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
    }

    const projects = await response.json();

    // Get committee and meeting counts for each project and add them to the project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project: any) => {
        const [committeeCount, meetingCount] = await Promise.all([
          this.getCommitteeCountByProjectId(project.id).catch(() => 0),
          this.getMeetingCountByProjectId(project.id).catch(() => 0),
        ]);
        return {
          ...project,
          committees_count: committeeCount,
          meetings_count: meetingCount,
        };
      })
    );

    return projectsWithCounts;
  }

  public async getProjectBySlug(slug: string) {
    const params = {
      slug: `eq.${slug}`,
      limit: '1',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/projects?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch project: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const project = data?.[0] || null;

    if (project) {
      // Get committee and meeting counts for this specific project and add them to the project
      const [committeeCount, meetingCount] = await Promise.all([this.getCommitteeCountByProjectId(project.id), this.getMeetingCountByProjectId(project.id)]);
      project.committees_count = committeeCount;
      project.meetings_count = meetingCount;
    }

    return project;
  }

  public async getCommittees(params?: Record<string, any>) {
    const queryString = params ? new URLSearchParams(params).toString() : '';
    const url = queryString ? `${this.baseUrl}/committees?${queryString}` : `${this.baseUrl}/committees`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch committees: ${response.status} ${response.statusText}`);
    }

    const committees = await response.json();

    // Calculate member counts for each committee
    const committeesWithCounts = await Promise.all(
      committees.map(async (committee: Committee) => {
        const [totalMembers, totalVotingReps] = await Promise.all([
          this.getCommitteeMemberCountByCommitteeId(committee.id),
          this.getCommitteeVotingRepsCount(committee.id),
        ]);

        return {
          ...committee,
          total_members: totalMembers,
          total_voting_reps: totalVotingReps,
        };
      })
    );

    return committeesWithCounts;
  }

  public async getCommitteeById(id: string) {
    const params = {
      id: `eq.${id}`,
      limit: '1',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/committees?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch committee: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const committee = data?.[0] || null;

    if (committee) {
      // Calculate total members and voting reps
      const [totalMembers, totalVotingReps] = await Promise.all([this.getCommitteeMemberCountByCommitteeId(id), this.getCommitteeVotingRepsCount(id)]);

      committee.total_members = totalMembers;
      committee.total_voting_reps = totalVotingReps;
    }

    return committee;
  }

  public async getCommitteeCountByProjectId(projectId: string): Promise<number> {
    const params = new URLSearchParams({
      project_id: `eq.${projectId}`,
      select: 'count',
    });
    const url = `${this.baseUrl}/committees?${params.toString()}`;
    const headers = {
      ...this.getHeaders(),
      Prefer: 'count=exact',
    };

    const response = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch committee count for project ${projectId}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async deleteCommittee(id: string): Promise<void> {
    const params = new URLSearchParams({
      id: `eq.${id}`,
    });
    const url = `${this.baseUrl}/committees?${params.toString()}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete committee: ${response.status} ${response.statusText}`);
    }
  }

  public async createCommittee(committee: Committee): Promise<Committee> {
    const url = `${this.baseUrl}/committees`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(committee),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create committee: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async updateCommittee(id: string, committee: any): Promise<any> {
    const params = new URLSearchParams({
      id: `eq.${id}`,
    });
    const url = `${this.baseUrl}/committees?${params.toString()}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(committee),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update committee: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  // Committee Members methods
  public async getCommitteeMembers(committeeId: string, params?: Record<string, any>): Promise<CommitteeMember[]> {
    const queryParams = {
      committee_id: `eq.${committeeId}`,
      ...params,
    };
    const queryString = new URLSearchParams(queryParams).toString();
    const url = `${this.baseUrl}/committee_members?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch committee members: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  public async getCommitteeMemberById(committeeId: string, memberId: string): Promise<CommitteeMember | null> {
    const params = {
      id: `eq.${memberId}`,
      committee_id: `eq.${committeeId}`,
      limit: '1',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/committee_members?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch committee member: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || null;
  }

  public async addCommitteeMember(committeeId: string, memberData: CreateCommitteeMemberRequest): Promise<CommitteeMember> {
    const url = `${this.baseUrl}/committee_members`;
    const payload = {
      ...memberData,
      committee_id: committeeId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to add committee member: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async updateCommitteeMember(committeeId: string, memberId: string, memberData: Partial<CreateCommitteeMemberRequest>): Promise<CommitteeMember> {
    const params = new URLSearchParams({
      id: `eq.${memberId}`,
      committee_id: `eq.${committeeId}`,
    });
    const url = `${this.baseUrl}/committee_members?${params.toString()}`;

    const payload = {
      ...memberData,
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update committee member: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async removeCommitteeMember(committeeId: string, memberId: string): Promise<void> {
    const params = new URLSearchParams({
      id: `eq.${memberId}`,
      committee_id: `eq.${committeeId}`,
    });
    const url = `${this.baseUrl}/committee_members?${params.toString()}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to remove committee member: ${response.status} ${response.statusText}`);
    }
  }

  public async getCommitteeMemberCountByCommitteeId(committeeId: string): Promise<number> {
    const params = new URLSearchParams({
      committee_id: `eq.${committeeId}`,
      select: 'count',
    });
    const url = `${this.baseUrl}/committee_members?${params.toString()}`;
    const headers = {
      ...this.getHeaders(),
      Prefer: 'count=exact',
    };

    const response = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch member count for committee ${committeeId}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async getCommitteeVotingRepsCount(committeeId: string): Promise<number> {
    const params = new URLSearchParams({
      committee_id: `eq.${committeeId}`,
      voting_status: `in.(Voting Rep,Alternate Voting Rep)`,
      select: 'count',
    });
    const url = `${this.baseUrl}/committee_members?${params.toString()}`;
    const headers = {
      ...this.getHeaders(),
      Prefer: 'count=exact',
    };

    const response = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voting reps count for committee ${committeeId}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async getProjectPermissions(projectId: string): Promise<UserPermissions[]> {
    // Single query to get all effective permissions from the view
    const params = new URLSearchParams({
      select: `
        user_id,
        first_name,
        last_name,
        email,
        username,
        role_name,
        object_type,
        object_id
      `,
      order: 'user_id,object_type,object_id',
    });

    const response = await fetch(`${this.baseUrl}/effective_user_permissions?project_id=eq.${projectId}&${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch user permissions: ${response.status} ${response.statusText}: ${errorText}`);
    }

    const data = await response.json();

    // Group data by user
    const userPermissionsMap = new Map<string, UserPermissions>();

    data.forEach((user: any) => {
      // Initialize user if not already in map
      if (!userPermissionsMap.has(user.user_id)) {
        userPermissionsMap.set(user.user_id, {
          user: {
            sid: user.user_id,
            ['https://sso.linuxfoundation.org/claims/username']: user.username || user.email,
            given_name: user.first_name || '',
            family_name: user.last_name || '',
            nickname: user.username || user.email,
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
            picture: 'https://via.placeholder.com/40',
            updated_at: user.updated_at || new Date().toISOString(),
            email: user.email,
            email_verified: false,
            sub: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
            id: user.id,
            created_at: user.created_at,
          },
          projectRoles: [],
          permissions: {
            meetings: { manageAll: false, specific: [] },
            committees: { manageAll: false, specific: [] },
            mailingLists: { manageAll: false, specific: [] },
          },
        });
      }

      const userPerms = userPermissionsMap.get(user.user_id)!;
      const row = user;
      // Process permissions based on whether it's project-wide or object-specific
      if (row.object_type === null && row.object_id === null) {
        // Project-wide permission
        if (row.role_name === 'manage_committees') {
          userPerms.permissions.committees.manageAll = true;
        }
        if (row.role_name === 'manage_meetings') {
          userPerms.permissions.meetings.manageAll = true;
        }
        if (row.role_name === 'manage_mailing_lists') {
          userPerms.permissions.mailingLists.manageAll = true;
        }

        // Add to project roles (for display purposes)
        if (!userPerms.projectRoles.some((pr) => pr.role_id === row.role_name)) {
          userPerms.projectRoles.push({
            id: 0,
            user_id: user.user_id,
            project_id: projectId,
            role_id: 0,
            roles: {
              id: 0,
              name: row.role_name,
              description: `Manage ${row.role_name.replace('manage_', '')}`,
            },
          });
        }
      } else {
        // Object-specific permission
        const permissionObj: ObjectPermission = {
          id: 0,
          user_id: user.user_id,
          object_type: row.object_type,
          object_id: row.object_id,
          permission: row.role_name,
          committee_name: row.committee_name,
        };

        // Add specific object permissions only if user doesn't have manage all
        if (row.object_type === 'meeting' && !userPerms.permissions.meetings.manageAll) {
          userPerms.permissions.meetings.specific.push(permissionObj);
        } else if (row.object_type === 'committee' && !userPerms.permissions.committees.manageAll) {
          userPerms.permissions.committees.specific.push(permissionObj);
        } else if (row.object_type === 'mailing_list' && !userPerms.permissions.mailingLists.manageAll) {
          userPerms.permissions.mailingLists.specific.push(permissionObj);
        }
      }
    });

    return Array.from(userPermissionsMap.values());
  }

  public async getMeetings(params?: Record<string, any>): Promise<Meeting[]> {
    const queryString = params ? new URLSearchParams(params).toString() : '';
    const url = queryString ? `${this.baseUrl}/meetings_with_committees?${queryString}` : `${this.baseUrl}/meetings_with_committees`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch meetings: ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const meetings = await response.json();
    return meetings;
  }

  public async getMeetingsByProjectId(projectId: string, params?: Record<string, any>): Promise<Meeting[]> {
    const queryParams = {
      project_id: `eq.${projectId}`,
      ...params,
    };

    return this.getMeetings(queryParams);
  }

  public async getMeetingCountByProjectId(projectId: string): Promise<number> {
    const params = new URLSearchParams({
      project_id: `eq.${projectId}`,
      select: 'count',
    });
    const url = `${this.baseUrl}/meetings?${params.toString()}`;
    const headers = {
      ...this.getHeaders(),
      Prefer: 'count=exact',
    };

    const response = await fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch meeting count for project ${projectId}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async getMeetingParticipants(meetingId: string): Promise<MeetingParticipant[]> {
    const params = {
      meeting_id: `eq.${meetingId}`,
      order: 'first_name.asc,last_name.asc',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/meeting_participants?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch meeting participants: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  public async searchProjects(query: string): Promise<ProjectSearchResult[]> {
    let url: string;

    // If query is provided, search across all content: projects, committees, and meetings
    if (query && query.trim()) {
      const trimmedQuery = query.trim();
      const searchParam = encodeURIComponent(trimmedQuery);

      // Search across project fields AND committee names AND meeting topics
      // For arrays in PostgREST, use the 'contains' operator (@>) or overlap operator (&&)
      url =
        `${this.baseUrl}/project_search?or=(project_name.ilike.*${searchParam}*,project_slug.ilike.*${searchParam}*,` +
        `project_description.ilike.*${searchParam}*,committee_names.ov.{"${trimmedQuery}"},meeting_topics.ov.{"${trimmedQuery}"})` +
        `&order=project_name&limit=20`;
    } else {
      // No search query, just return all from the view
      url = `${this.baseUrl}/project_search?limit=20&order=project_name`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      // If the view doesn't exist, fallback to regular projects search
      if (response.status === 404) {
        return this.fallbackProjectSearch(query);
      }

      throw new Error(`Failed to search projects: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  public async getRecentActivityByProject(projectId: number, params?: Record<string, any>): Promise<RecentActivity[]> {
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('project_id', `eq.${projectId}`);
    queryParams.set('order', 'date.desc');

    // Add limit parameter if provided, default to 10
    const limit = params?.['limit'] ? parseInt(params['limit'], 10) : 10;
    queryParams.set('limit', limit.toString());

    const url = `${this.baseUrl}/recent_activity?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch recent activity: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  public async createMeeting(meeting: CreateMeetingRequest): Promise<Meeting> {
    const url = `${this.baseUrl}/meetings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(meeting),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create meeting: ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async updateMeeting(id: string, meeting: UpdateMeetingRequest): Promise<Meeting> {
    const params = new URLSearchParams({
      id: `eq.${id}`,
    });
    const url = `${this.baseUrl}/meetings?${params.toString()}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(meeting),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update meeting: ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async getMeetingById(id: string): Promise<Meeting> {
    const params = new URLSearchParams({
      id: `eq.${id}`,
    });
    const url = `${this.baseUrl}/meetings_with_committees?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch meeting: ${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const meetings = await response.json();
    if (!meetings || meetings.length === 0) {
      throw new Error(`Meeting with ID ${id} not found`);
    }

    return meetings[0];
  }

  public async deleteMeeting(id: string, deleteType?: 'single' | 'series' | 'future'): Promise<void> {
    // Note: deleteType parameter is reserved for future recurrence handling implementation
    // Currently, all deletes remove the entire meeting record regardless of deleteType
    // 'future' type will delete this occurrence and all future occurrences in the series
    const actualDeleteType = deleteType || 'single';

    const params = new URLSearchParams({
      id: `eq.${id}`,
    });
    const url = `${this.baseUrl}/meetings?${params.toString()}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorMessage = `Failed to delete meeting (${actualDeleteType}): ${response.status} ${response.statusText}: ${await response.text()}`;
      throw new Error(errorMessage);
    }
  }

  private async fallbackProjectSearch(query: string): Promise<ProjectSearchResult[]> {
    let url = `${this.baseUrl}/projects?limit=10&order=name`;

    if (query && query.trim()) {
      const trimmedQuery = query.trim();
      url = `${this.baseUrl}/projects?name=ilike.*${encodeURIComponent(trimmedQuery)}*&limit=10&order=name`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to search projects (fallback): ${response.status} ${response.statusText}`);
    }

    const projects = await response.json();

    // Transform regular projects to search result format
    return projects.map((project: any) => ({
      project_id: project.id,
      project_name: project.name,
      project_slug: project.slug,
      project_description: project.description,
      status: project.status,
      logo: project.logo,
      meetings_count: project.meetings_count || 0,
      mailing_list_count: project.mailing_list_count || 0,
    }));
  }

  private getHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      ['Content-Type']: 'application/json',
      Prefer: 'return=representation',
    };
  }
}
