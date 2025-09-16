// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Committee,
  CommitteePermission,
  CreateMeetingAttachmentRequest,
  CreateUserPermissionRequest,
  MeetingAttachment,
  PermissionLevel,
  ProfileDetails,
  ProjectPermission,
  ProjectSearchResult,
  RecentActivity,
  UpdateProfileDetailsRequest,
  UpdateUserPermissionRequest,
  UpdateUserProfileRequest,
  UploadFileResponse,
  User,
  UserPermissionSummary,
  UserProfile,
} from '@lfx-one/shared/interfaces';
import dotenv from 'dotenv';

dotenv.config();

export class SupabaseService {
  private readonly baseUrl: string;
  private readonly storageUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number = 30000;
  private readonly defaultBucket: string;

  public constructor() {
    const supabaseUrl = process.env['SUPABASE_URL'];
    const apiKey = process.env['POSTGRES_API_KEY'];
    const storageBucket = process.env['SUPABASE_STORAGE_BUCKET'] || 'meeting-attachments';

    this.baseUrl = `${supabaseUrl}/rest/v1`;
    this.storageUrl = `${supabaseUrl}/storage/v1`;
    this.apiKey = apiKey || '';
    this.defaultBucket = storageBucket;
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

  public async getCommitteeMemberCountByCommitteeId(committeeUid: string): Promise<number> {
    const params = new URLSearchParams({
      committee_uid: `eq.${committeeUid}`,
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
      throw new Error(`Failed to fetch member count for committee ${committeeUid}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async getCommitteeVotingRepsCount(committeeUid: string): Promise<number> {
    const params = new URLSearchParams({
      committee_uid: `eq.${committeeUid}`,
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
      throw new Error(`Failed to fetch voting reps count for committee ${committeeUid}: ${response.status} ${response.statusText}`);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    return 0;
  }

  public async getProjectPermissions(projectUid: string): Promise<UserPermissionSummary[]> {
    // Get project permissions
    const projectPermissionsParams = new URLSearchParams({
      select: `user_id,permission_level,users(id,first_name,last_name,email,username,created_at)`,
      project_uid: `eq.${projectUid}`,
    });

    const projectPermissionsResponse = await fetch(`${this.baseUrl}/user_project_permissions?${projectPermissionsParams.toString()}`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    // Get committee permissions
    const committeePermissionsParams = new URLSearchParams({
      select: `user_id,committee_id,permission_level,users(id,first_name,last_name,email,username,created_at),committees(id,name,description,project_uid)`,
      project_uid: `eq.${projectUid}`,
    });

    const committeePermissionsResponse = await fetch(`${this.baseUrl}/user_committee_permissions?${committeePermissionsParams.toString()}`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!projectPermissionsResponse.ok) {
      const errorText = await projectPermissionsResponse.text();
      throw new Error(`Failed to fetch project permissions: ${errorText}`);
    }

    if (!committeePermissionsResponse.ok) {
      const errorText = await committeePermissionsResponse.text();
      throw new Error(`Failed to fetch committee permissions: ${errorText}`);
    }

    const projectPermissions = await projectPermissionsResponse.json();
    const committeePermissions = await committeePermissionsResponse.json();

    // Combine and group by user
    const userPermissionsMap = new Map<string, UserPermissionSummary>();

    projectPermissions.forEach((perm: { user_id: string; users: User; project_uid: string; permission_level: PermissionLevel }) => {
      userPermissionsMap.set(perm.user_id, {
        user: perm.users,
        projectPermission: { level: perm.permission_level, scope: 'project' },
        committeePermissions: [],
      });
    });

    committeePermissions.forEach((perm: { user_id: string; users: User; committee_id: string; permission_level: PermissionLevel; committees: Committee }) => {
      const user = userPermissionsMap.get(perm.user_id);
      if (user) {
        userPermissionsMap.set(perm.user_id, {
          user: perm.users,
          projectPermission: user.projectPermission,
          committeePermissions: [...user.committeePermissions, { committee: perm.committees, level: perm.permission_level, scope: 'committee' }],
        });
      } else {
        userPermissionsMap.set(perm.user_id, {
          user: perm.users,
          committeePermissions: [{ committee: perm.committees, level: perm.permission_level, scope: 'committee' }],
        });
      }
    });

    return Array.from(userPermissionsMap.values());
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

  public async getRecentActivityByProject(projectUid: string, params?: Record<string, any>): Promise<RecentActivity[]> {
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('project_uid', `eq.${projectUid}`);
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

  public async removeUserFromProject(userId: string, projectUid: string): Promise<void> {
    // Remove project-level permissions
    const projectPermissionsParams = new URLSearchParams({
      user_id: `eq.${userId}`,
      project_uid: `eq.${projectUid}`,
    });
    const projectPermissionsUrl = `${this.baseUrl}/user_project_permissions?${projectPermissionsParams.toString()}`;

    const projectPermissionsResponse = await fetch(projectPermissionsUrl, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    // 404 is acceptable - it means there were no project permissions to delete
    if (!projectPermissionsResponse.ok && projectPermissionsResponse.status !== 404) {
      throw new Error(`Failed to remove project permissions: ${projectPermissionsResponse.status} ${projectPermissionsResponse.statusText}`);
    }

    // Remove committee-level permissions for this project
    const committeePermissionsParams = new URLSearchParams({
      user_id: `eq.${userId}`,
      project_uid: `eq.${projectUid}`,
    });
    const committeePermissionsUrl = `${this.baseUrl}/user_committee_permissions?${committeePermissionsParams.toString()}`;

    const committeePermissionsResponse = await fetch(committeePermissionsUrl, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    // 404 is acceptable - it means there were no committee permissions to delete
    if (!committeePermissionsResponse.ok && committeePermissionsResponse.status !== 404) {
      throw new Error(`Failed to remove committee permissions: ${committeePermissionsResponse.status} ${committeePermissionsResponse.statusText}`);
    }
  }

  // New permission system methods
  public async createUserWithPermissions(userData: CreateUserPermissionRequest): Promise<any> {
    // Check if user with email already exists
    const emailCheckUrl = `${this.baseUrl}/users?email=eq.${encodeURIComponent(userData.email)}&select=id`;
    const emailCheckResponse = await fetch(emailCheckUrl, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!emailCheckResponse.ok) {
      throw new Error(`Failed to check email existence: ${emailCheckResponse.status} ${emailCheckResponse.statusText}`);
    }

    const existingEmailUsers = await emailCheckResponse.json();
    let userId: string;

    if (existingEmailUsers && existingEmailUsers.length > 0) {
      // User exists, use existing user ID
      userId = existingEmailUsers[0].id;
    } else {
      // Create new user
      const userCreateUrl = `${this.baseUrl}/users`;
      const newUser = {
        first_name: userData.first_name,
        last_name: userData.last_name,
        email: userData.email,
        username: userData.username || userData.email,
      };

      const userCreateResponse = await fetch(userCreateUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(newUser),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!userCreateResponse.ok) {
        throw new Error(`Failed to create user: ${userCreateResponse.status} ${userCreateResponse.statusText}`);
      }

      const createdUsers = await userCreateResponse.json();
      userId = createdUsers[0].id;
    }

    // Add permissions based on scope
    if (userData.permission_scope === 'project') {
      await this.createProjectPermission({
        user_id: userId,
        project_uid: userData.project_uid,
        permission_level: userData.permission_level,
      });
    } else if (userData.permission_scope === 'committee' && userData.committee_ids) {
      await Promise.all(
        userData.committee_ids.map((committeeId) =>
          this.createCommitteePermission({
            user_id: userId,
            project_uid: userData.project_uid,
            committee_id: committeeId,
            permission_level: userData.permission_level,
          })
        )
      );
    }

    return { id: userId };
  }

  public async updateUserPermissions(updateData: UpdateUserPermissionRequest): Promise<void> {
    // Remove existing permissions
    await this.removeUserFromProject(updateData.user_id, updateData.project_uid);

    // Add new permissions based on scope
    if (updateData.permission_scope === 'project') {
      await this.createProjectPermission({
        user_id: updateData.user_id,
        project_uid: updateData.project_uid,
        permission_level: updateData.permission_level,
      });
    } else if (updateData.permission_scope === 'committee' && updateData.committee_ids) {
      await Promise.all(
        updateData.committee_ids.map((committeeId) =>
          this.createCommitteePermission({
            user_id: updateData.user_id,
            project_uid: updateData.project_uid,
            committee_id: committeeId,
            permission_level: updateData.permission_level,
          })
        )
      );
    }
  }

  // Storage methods
  public async uploadFile(
    filePath: string,
    fileBuffer: Buffer,
    options?: {
      bucket?: string;
      contentType?: string;
      upsert?: boolean;
      cacheControl?: string;
    }
  ): Promise<UploadFileResponse> {
    const bucket = options?.bucket || this.defaultBucket;
    const url = `${this.storageUrl}/object/${bucket}/${filePath}`;

    const headers: Record<string, string> = {
      ...this.getStorageHeaders(),
      ['Content-Type']: options?.contentType || 'application/octet-stream',
    };

    if (options?.upsert) {
      headers['x-upsert'] = 'true';
    }

    if (options?.cacheControl) {
      headers['Cache-Control'] = options.cacheControl;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: fileBuffer,
      signal: AbortSignal.timeout(this.timeout * 2), // Double timeout for uploads
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload file: ${response.status} ${response.statusText}: ${errorText}`);
    }

    // Get the public URL for the uploaded file
    const publicUrl = this.getPublicUrl(bucket, filePath);

    return {
      url: publicUrl,
      path: filePath,
      size: fileBuffer.length,
      mimeType: options?.contentType || 'application/octet-stream',
    };
  }

  public getPublicUrl(bucket: string, filePath: string): string {
    return `${this.storageUrl}/object/public/${bucket}/${filePath}`;
  }

  public async deleteFile(filePaths: string[], bucket?: string): Promise<void> {
    const bucketName = bucket || this.defaultBucket;
    const url = `${this.storageUrl}/object/${bucketName}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...this.getStorageHeaders(),
        ['Content-Type']: 'application/json',
      },
      body: JSON.stringify({ prefixes: filePaths }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete file: ${response.status} ${response.statusText}: ${errorText}`);
    }
  }

  public async createMeetingAttachment(attachment: CreateMeetingAttachmentRequest): Promise<MeetingAttachment> {
    const url = `${this.baseUrl}/meeting_attachments`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(attachment),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create meeting attachment: ${response.status} ${response.statusText}: ${errorText}`);
    }

    const data = await response.json();
    return data?.[0] || data;
  }

  public async getMeetingAttachments(meetingId: string): Promise<MeetingAttachment[]> {
    const params = new URLSearchParams({
      meeting_id: `eq.${meetingId}`,
      order: 'created_at.asc',
    });
    const url = `${this.baseUrl}/meeting_attachments?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch meeting attachments: ${response.status} ${response.statusText}: ${errorText}`);
    }

    return await response.json();
  }

  public async deleteMeetingAttachment(attachmentId: string): Promise<void> {
    const params = new URLSearchParams({
      id: `eq.${attachmentId}`,
    });
    const url = `${this.baseUrl}/meeting_attachments?${params.toString()}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete meeting attachment: ${response.status} ${response.statusText}: ${errorText}`);
    }
  }

  /**
   * Get user profile data from public.users table
   */
  public async getUser(username: string): Promise<UserProfile | null> {
    const params = new URLSearchParams({
      username: `eq.${username}`,
      limit: '1',
    });
    const url = `${this.baseUrl}/users?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || null;
  }

  /**
   * Get profile details data from public.profiles table
   */
  public async getProfile(userUid: string): Promise<ProfileDetails | null> {
    const params = new URLSearchParams({
      user_id: `eq.${userUid}`,
      limit: '1',
    });
    const url = `${this.baseUrl}/profiles?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch profile details: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || null;
  }

  public async updateUser(username: string, data: UpdateUserProfileRequest): Promise<UserProfile> {
    const url = `${this.baseUrl}/users`;
    const params = new URLSearchParams({
      username: `eq.${username}`,
    });

    const updateData = {
      ...data,
      username: username,
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(`${url}?${params.toString()}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updateData),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update user: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result?.[0];
  }

  /**
   * Update profile details data in public.profiles table
   */
  public async updateProfileDetails(username: string, data: UpdateProfileDetailsRequest): Promise<ProfileDetails> {
    const user = await this.getUser(username);

    if (!user) {
      throw new Error(`User not found: ${username}`);
    }

    const params = new URLSearchParams({
      user_id: `eq.${user.id}`,
    });
    const url = `${this.baseUrl}/profiles?${params.toString()}`;

    const updateData = {
      ...data,
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updateData),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update profile details: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result?.[0];
  }

  /**
   * Create profile record if it doesn't exist
   */
  public async createProfileIfNotExists(userUid: string): Promise<ProfileDetails> {
    // First check if profile exists
    const existing = await this.getProfile(userUid);
    if (existing) {
      return existing;
    }

    // Create new profile record
    const url = `${this.baseUrl}/profiles`;
    const newProfile = {
      user_id: userUid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(newProfile),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create profile: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result?.[0];
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
      project_uid: project.uid,
      project_name: project.name,
      project_slug: project.slug,
      project_description: project.description,
      status: project.status,
      logo_url: project.logo_url,
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

  private getStorageHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async createProjectPermission(permission: Omit<ProjectPermission, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const url = `${this.baseUrl}/user_project_permissions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(permission),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create project permission: ${response.status} ${response.statusText}`);
    }
  }

  private async createCommitteePermission(permission: Omit<CommitteePermission, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const url = `${this.baseUrl}/user_committee_permissions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(permission),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create committee permission: ${response.status} ${response.statusText}`);
    }
  }
}
