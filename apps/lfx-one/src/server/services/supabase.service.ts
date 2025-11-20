// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EmailManagementData, EmailPreferences, UpdateEmailPreferencesRequest, UserEmail, UserProfile } from '@lfx-one/shared/interfaces';
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
   * Get all emails for a user
   */
  public async getUserEmails(userId: string): Promise<UserEmail[]> {
    const params = {
      user_id: `eq.${userId}`,
      order: 'is_primary.desc,created_at.asc',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/user_emails?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user emails: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Add a new email for a user
   */
  public async addUserEmail(userId: string, email: string): Promise<UserEmail> {
    const url = `${this.baseUrl}/user_emails`;
    const emailData = {
      user_id: userId,
      email: email.toLowerCase().trim(),
      is_primary: false,
      is_verified: false,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(emailData),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorData = await response.text();
      if (response.status === 409 || errorData.includes('unique')) {
        throw new Error('Email address is already in use by another user');
      }
      throw new Error(`Failed to add email: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result[0];
  }

  /**
   * Delete a user email
   */
  public async deleteUserEmail(emailId: string, userId: string): Promise<void> {
    // First check if this is the primary email and if user has other emails
    const userEmails = await this.getUserEmails(userId);
    const emailToDelete = userEmails.find((e) => e.id === emailId);

    if (!emailToDelete) {
      throw new Error('Email not found');
    }

    if (userEmails.length === 1) {
      throw new Error('Cannot delete the last email address');
    }

    if (emailToDelete.is_primary) {
      throw new Error('Cannot delete primary email. Please set another email as primary first.');
    }

    const url = `${this.baseUrl}/user_emails?id=eq.${emailId}&user_id=eq.${userId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete email: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Set an email as primary for a user
   */
  public async setPrimaryEmail(userId: string, emailId: string): Promise<void> {
    // First, check if the email exists and is verified
    const emailParams = {
      id: `eq.${emailId}`,
      user_id: `eq.${userId}`,
    };
    const emailQueryString = new URLSearchParams(emailParams).toString();
    const emailUrl = `${this.baseUrl}/user_emails?${emailQueryString}`;

    const emailResponse = await fetch(emailUrl, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!emailResponse.ok) {
      throw new Error(`Failed to fetch email: ${emailResponse.status} ${emailResponse.statusText}`);
    }

    const emails = await emailResponse.json();
    if (!emails || emails.length === 0) {
      throw new Error('Email not found');
    }

    const email = emails[0];
    if (!email.is_verified) {
      throw new Error('Only verified emails can be set as primary');
    }

    // First, unset current primary email
    const updateCurrentPrimary = {
      is_primary: false,
    };

    let url = `${this.baseUrl}/user_emails?user_id=eq.${userId}&is_primary=eq.true`;
    let response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updateCurrentPrimary),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to unset current primary email: ${response.status} ${response.statusText}`);
    }

    // Then set the new primary email
    const updateNewPrimary = {
      is_primary: true,
    };

    url = `${this.baseUrl}/user_emails?id=eq.${emailId}&user_id=eq.${userId}`;
    response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updateNewPrimary),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to set primary email: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Get email preferences for a user
   */
  public async getEmailPreferences(userId: string): Promise<EmailPreferences | null> {
    const params = {
      user_id: `eq.${userId}`,
      limit: '1',
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/email_preferences?${queryString}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch email preferences: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data?.[0] || null;
  }

  /**
   * Update email preferences for a user
   */
  public async updateEmailPreferences(userId: string, preferences: UpdateEmailPreferencesRequest): Promise<EmailPreferences> {
    // Check if preferences exist, if not create them
    const existingPreferences = await this.getEmailPreferences(userId);

    if (!existingPreferences) {
      // Create new preferences
      const url = `${this.baseUrl}/email_preferences`;
      const newPreferences = {
        user_id: userId,
        ...preferences,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(newPreferences),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Failed to create email preferences: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result[0];
    }
    // Update existing preferences
    const url = `${this.baseUrl}/email_preferences?user_id=eq.${userId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(preferences),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update email preferences: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result[0];
  }

  /**
   * Get combined email management data for a user
   */
  public async getEmailManagementData(userId: string): Promise<EmailManagementData> {
    const [emails, preferences] = await Promise.all([this.getUserEmails(userId), this.getEmailPreferences(userId)]);

    return {
      emails,
      preferences,
    };
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
