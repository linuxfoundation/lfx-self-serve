// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { RewardCouponGenerationResponse, RewardsSummaryResponse } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class RewardsService {
  private readonly http = inject(HttpClient);

  public getSummary(): Observable<RewardsSummaryResponse> {
    return this.http.get<RewardsSummaryResponse>('/api/rewards/summary');
  }

  public redeemPromotion(promotionId: string): Observable<RewardCouponGenerationResponse> {
    return this.http.post<RewardCouponGenerationResponse>(`/api/rewards/promotions/${encodeURIComponent(promotionId)}/redeem`, {});
  }
}
