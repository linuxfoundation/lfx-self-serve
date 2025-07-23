// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Committee, CommitteeMember, CreateCommitteeMemberRequest, ObjectPermission, UserPermissions } from '@lfx-pcc/shared/interfaces';
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

    // Get committee count for each project and add it to the project
    const projectsWithCommitteeCount = await Promise.all(
      projects.map(async (project: any) => {
        const committeeCount = await this.getCommitteeCountByProjectId(project.id);
        return {
          ...project,
          committees_count: committeeCount,
        };
      })
    );

    return projectsWithCommitteeCount;
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
      // Get committee count for this specific project and add it to the project
      const committeeCount = await this.getCommitteeCountByProjectId(project.id);
      project.committees_count = committeeCount;
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

  private getHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      ['Content-Type']: 'application/json',
      Prefer: 'return=representation',
    };
  }
}
