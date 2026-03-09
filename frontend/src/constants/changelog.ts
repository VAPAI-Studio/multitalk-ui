export interface Announcement {
  id: string;
  message: string;
  type: "feature" | "fix" | "info";
}

// Latest announcement at index 0. Only the first entry is shown in the banner.
// When committing user-facing changes, add a new entry at the top.
export const announcements: Announcement[] = [
  {
    id: "2026-03-09-video-upscale",
    message:
      "New: Video Upscale in Video Studio - enhance your videos to higher resolutions with SeedVR2 AI.",
    type: "feature",
  },
  {
    id: "2026-03-09-major-update",
    message:
      "New: RunPod Cloud execution, Virtual Set, Runpod integration.",
    type: "feature",
  },
];
