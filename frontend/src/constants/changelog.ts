export interface Announcement {
  id: string;
  message: string;
  type: "feature" | "fix" | "info";
}

// Latest announcement at index 0. Only the first entry is shown in the banner.
// When committing user-facing changes, add a new entry at the top.
export const announcements: Announcement[] = [
  {
    id: "2026-03-11-batch-upscale",
    message: "New: Batch Video Upscale in Video Studio -- upscale multiple videos at once with Freepik AI",
    type: "feature",
  },
  {
    id: "2026-03-09-video-upscale",
    message:
      "New: Video Upscale in Video Studio, Runpod infrastructure integration, API key creation, 3D Virtual Set",
    type: "feature",
  },
];
