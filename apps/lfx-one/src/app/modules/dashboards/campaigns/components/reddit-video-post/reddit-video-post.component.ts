// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output } from '@angular/core';
import { CREATIVE_ASSET_VIDEO_MIME_TYPE } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryState, RedditVideoPostDraft, RedditVideoPostView } from '@lfx-one/shared/interfaces';
import { redditVideoPostView, redditVideoPostWithThumbnail, redditVideoPostWithVideo } from '@lfx-one/shared/utils';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

/**
 * The Reddit video post on the Implement tab (#6108 row 8): an MP4 and its PNG or JPEG thumbnail, picked from the brief's
 * library, with an MP4 upload into that library. The parent shows this only while the deployment sends a video post
 * (`redditVideoEnabled`), owns the draft, the library read and the upload, sends the pair, and holds Create; the rules
 * live in `campaign-reddit-video.utils.ts`.
 */
@Component({
  selector: 'lfx-reddit-video-post',
  imports: [UiOptionComponent, UiSelectComponent],
  templateUrl: './reddit-video-post.component.html',
})
export class RedditVideoPostComponent {
  public readonly videoPost = model.required<RedditVideoPostDraft>();
  /** The brief's stored videos and images the pickers offer, as the parent read them. */
  public readonly library = input<CreativeAssetLibraryState>({ status: 'idle', assets: [] });
  /** The brief the assets are stored for; a pick records it. */
  public readonly briefId = input('');
  /** The stored asset whose delete is running, `''` for none: the video picker does not offer it, and the upload waits for it. */
  public readonly deletingAssetId = input('');
  /** Whether an MP4 may be uploaded into the brief's library from here: the brief is saved. */
  public readonly uploadAvailable = input(false);
  /** An MP4 chosen to upload into the brief's library; the parent queues it, and it is offered once stored. */
  public readonly upload = output<File[]>();

  protected readonly videoAccept = CREATIVE_ASSET_VIDEO_MIME_TYPE;
  protected readonly view = computed<RedditVideoPostView>(() => redditVideoPostView(this.videoPost(), this.library(), this.briefId(), this.deletingAssetId()));

  /** A picked video, recorded with the brief it was picked for; `''` (the "No video" option) clears it. */
  protected onVideoPick(value: string | null): void {
    this.videoPost.update((draft) => redditVideoPostWithVideo(draft, value ?? '', this.briefId()));
  }

  /** A picked thumbnail, on the video's terms. */
  protected onThumbnailPick(value: string | null): void {
    this.videoPost.update((draft) => redditVideoPostWithThumbnail(draft, value ?? '', this.briefId()));
  }

  /** Hand the chosen file to the parent and clear the chooser, so choosing the same file again is a new selection. */
  protected onFiles(event: Event): void {
    const chooser = event.target as HTMLInputElement;
    const files = Array.from(chooser.files ?? []);
    chooser.value = '';
    if (files.length > 0) this.upload.emit(files);
  }
}
