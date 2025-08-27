// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';

@Component({
  selector: 'lfx-route-loading',
  standalone: true,
  imports: [CommonModule, SkeletonModule],
  templateUrl: './route-loading.component.html',
})
export class RouteLoadingComponent {
  public readonly skeletonItems = [1, 2, 3, 4, 5, 6];
}
