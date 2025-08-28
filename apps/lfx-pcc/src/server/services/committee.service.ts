// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getValidCommitteeCategories } from '@lfx-pcc/shared/constants';
import {
  Committee,
  CommitteeCreateData,
  CommitteeSettingsData,
  CommitteeUpdateData,
  CommitteeValidationError,
  CommitteeValidationResult,
  ETagError,
  QueryServiceResponse,
  ValidationApiError,
} from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

import { createApiError } from '../utils/api-error';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling committee business logic
 */
export class CommitteeService {
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService(this.microserviceProxy);
  }

  /**
   * Fetches all committees based on query parameters
   */
  public async getCommittees(req: Request, query: Record<string, any> = {}): Promise<Committee[]> {
    const params = {
      ...query,
      type: 'committee',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches a single committee by ID
   */
  public async getCommitteeById(req: Request, committeeId: string): Promise<Committee> {
    const params = {
      type: 'committee',
      parent: `committee:${committeeId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      const error: ETagError = {
        code: 'NOT_FOUND',
        message: 'Committee not found',
        statusCode: 404,
      };
      throw error;
    }

    return resources[0].data;
  }

  /**
   * Creates a new committee with optional settings
   */
  public async createCommittee(req: Request, data: CommitteeCreateData): Promise<Committee> {
    // Validate input data
    const validation = this.validateCommitteeData(data);
    if (!validation.isValid) {
      const validationError: ValidationApiError = createApiError({
        message: `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      }) as ValidationApiError;
      validationError.validationErrors = validation.errors;
      throw validationError;
    }

    // Extract settings fields
    const { business_email_required, is_audit_enabled, ...committeeData } = data;

    // Step 1: Create committee
    const newCommittee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', '/committees', 'POST', {}, committeeData);

    req.log.info(
      {
        operation: 'create_committee',
        committee_id: newCommittee.uid,
        committee_category: newCommittee.category,
      },
      'Committee created successfully'
    );

    // Step 2: Update settings if provided
    if (business_email_required !== undefined || is_audit_enabled !== undefined) {
      try {
        await this.updateCommitteeSettings(req, newCommittee.uid, { business_email_required, is_audit_enabled });
      } catch (error) {
        req.log.warn(
          {
            operation: 'create_committee',
            committee_id: newCommittee.uid,
            error: error instanceof Error ? error.message : error,
          },
          'Failed to update committee settings, but committee was created successfully'
        );
      }
    }

    return {
      ...newCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
    };
  }

  /**
   * Updates an existing committee using ETag for concurrency control
   */
  public async updateCommittee(req: Request, committeeId: string, data: CommitteeUpdateData): Promise<Committee> {
    // Validate input data
    const validation = this.validateCommitteeData(data, true);
    if (!validation.isValid) {
      const validationError: ValidationApiError = createApiError({
        message: `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      }) as ValidationApiError;
      validationError.validationErrors = validation.errors;
      throw validationError;
    }

    // Extract settings fields
    const { business_email_required, is_audit_enabled, ...committeeData } = data;

    // Step 1: Fetch committee with ETag
    const { etag } = await this.etagService.fetchWithETag<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'update_committee');

    // Step 2: Update committee with ETag
    const updatedCommittee = await this.etagService.updateWithETag<Committee>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}`,
      etag,
      committeeData,
      'update_committee'
    );

    req.log.info(
      {
        operation: 'update_committee',
        committee_id: committeeId,
      },
      'Committee updated successfully'
    );

    // Step 3: Update settings if provided
    if (business_email_required !== undefined || is_audit_enabled !== undefined) {
      try {
        await this.updateCommitteeSettings(req, committeeId, { business_email_required, is_audit_enabled });
      } catch (error) {
        req.log.warn(
          {
            operation: 'update_committee',
            committee_id: committeeId,
            error: error instanceof Error ? error.message : error,
          },
          'Failed to update committee settings, but committee was updated successfully'
        );
      }
    }

    return {
      ...updatedCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
    };
  }

  /**
   * Deletes a committee using ETag for concurrency control
   */
  public async deleteCommittee(req: Request, committeeId: string): Promise<void> {
    // Step 1: Fetch committee with ETag
    const { etag } = await this.etagService.fetchWithETag<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'delete_committee');

    // Step 2: Delete committee with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, etag, 'delete_committee');

    req.log.info(
      {
        operation: 'delete_committee',
        committee_id: committeeId,
      },
      'Committee deleted successfully'
    );
  }

  /**
   * Updates committee settings (business_email_required, is_audit_enabled)
   */
  private async updateCommitteeSettings(req: Request, committeeId: string, settings: CommitteeSettingsData): Promise<void> {
    const settingsData = {
      ...(settings.business_email_required !== undefined && {
        business_email_required: settings.business_email_required,
      }),
      ...(settings.is_audit_enabled !== undefined && {
        is_audit_enabled: settings.is_audit_enabled,
      }),
    };

    await this.microserviceProxy.proxyRequest(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, 'PUT', {}, settingsData);

    req.log.info(
      {
        operation: 'update_committee_settings',
        committee_id: committeeId,
        settings_data: settingsData,
      },
      'Committee settings updated successfully'
    );
  }

  /**
   * Validates committee data for create or update operations
   */
  private validateCommitteeData(data: CommitteeCreateData | CommitteeUpdateData, isUpdate = false): CommitteeValidationResult {
    const errors: CommitteeValidationError[] = [];

    // Required field validation for create operations
    if (!isUpdate) {
      if (!data.name || data.name.trim().length === 0) {
        errors.push({
          field: 'name',
          message: 'Committee name is required',
          code: 'REQUIRED_FIELD_MISSING',
        });
      }

      if (!data.category || data.category.trim().length === 0) {
        errors.push({
          field: 'category',
          message: 'Committee category is required',
          code: 'REQUIRED_FIELD_MISSING',
        });
      }
    }

    // Name validation
    if (data.name !== null && data.name !== undefined) {
      if (typeof data.name !== 'string') {
        errors.push({
          field: 'name',
          message: 'Committee name must be a string',
          code: 'INVALID_TYPE',
        });
      } else if (data.name.trim().length === 0) {
        errors.push({
          field: 'name',
          message: 'Committee name cannot be empty',
          code: 'INVALID_VALUE',
        });
      } else if (data.name.length > 255) {
        errors.push({
          field: 'name',
          message: 'Committee name cannot exceed 255 characters',
          code: 'VALUE_TOO_LONG',
        });
      }
    }

    // Category validation
    if (data.category !== null && data.category !== undefined) {
      const validCategories = getValidCommitteeCategories();
      if (typeof data.category !== 'string') {
        errors.push({
          field: 'category',
          message: 'Committee category must be a string',
          code: 'INVALID_TYPE',
        });
      } else if (!validCategories.includes(data.category)) {
        errors.push({
          field: 'category',
          message: `Committee category must be one of: ${validCategories.join(', ')}`,
          code: 'INVALID_VALUE',
        });
      }
    }

    // Description validation
    if (data.description !== null) {
      if (typeof data.description !== 'string') {
        errors.push({
          field: 'description',
          message: 'Committee description must be a string',
          code: 'INVALID_TYPE',
        });
      } else if (data.description.length > 2000) {
        errors.push({
          field: 'description',
          message: 'Committee description cannot exceed 2000 characters',
          code: 'VALUE_TOO_LONG',
        });
      }
    }

    // Display name validation
    if (data.display_name !== null) {
      if (typeof data.display_name !== 'string') {
        errors.push({
          field: 'display_name',
          message: 'Display name must be a string',
          code: 'INVALID_TYPE',
        });
      } else if (data.display_name.length > 255) {
        errors.push({
          field: 'display_name',
          message: 'Display name cannot exceed 255 characters',
          code: 'VALUE_TOO_LONG',
        });
      }
    }

    // Website validation
    if (data.website !== null) {
      if (typeof data.website !== 'string') {
        errors.push({
          field: 'website',
          message: 'Website must be a string',
          code: 'INVALID_TYPE',
        });
      } else if (data.website.trim().length > 0 && !this.isValidUrl(data.website)) {
        errors.push({
          field: 'website',
          message: 'Website must be a valid URL',
          code: 'INVALID_FORMAT',
        });
      }
    }

    // SSO group validation
    if (data.sso_group_enabled === true && (!data.sso_group_name || data.sso_group_name.trim().length === 0)) {
      errors.push({
        field: 'sso_group_name',
        message: 'SSO group name is required when SSO group is enabled',
        code: 'CONDITIONAL_FIELD_MISSING',
      });
    }

    // Boolean field validation
    const booleanFields: (keyof CommitteeCreateData)[] = [
      'enable_voting',
      'public',
      'sso_group_enabled',
      'business_email_required',
      'is_audit_enabled',
      'joinable',
    ];
    booleanFields.forEach((field) => {
      if (data[field] !== undefined && typeof data[field] !== 'boolean') {
        errors.push({
          field,
          message: `${field} must be a boolean value`,
          code: 'INVALID_TYPE',
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates if a string is a valid URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
