export interface Announcement {
  id: string;
  message: string;
  type: "feature" | "fix" | "info";
}

// Latest announcement at index 0. Only the first entry is shown in the banner.
// When committing user-facing changes, add a new entry at the top.
export const announcements: Announcement[] = [
  {
    id: "2026-03-24-ltx-seed",
    message: "LTX 2.3 Video now supports seed control — set a specific seed or randomize for reproducible generations",
    type: "feature",
  },
  {
    id: "2026-03-18-world-jobs",
    message: "Virtual Set now saves 3D worlds to your generation feed so you can revisit and reconstruct them anytime",
    type: "feature",
    },
  {
    id: "2026-03-14-dynamic-workflows-nav",
    message: "Custom workflows built in the Workflow Builder now appear automatically in their studio's navigation and on the homepage.",
    type: "feature" as const,
  },
  {
    id: "2026-03-14-dynamic-workflows",
    message: "Admins can now test and publish custom AI workflows from the Workflow Builder — published features appear as live pages.",
    type: "feature" as const,
  },
  {
    id: "2026-03-14-workflow-builder",
    message: "New: Workflow Builder in Infrastructure -- admins can now build and publish custom AI features without code",
    type: "feature",
  },
  {
    id: "2026-03-11-batch-upscale",
    message: "New: Batch Video Upscale in Video Studio -- upscale multiple videos at once with Freepik AI",
    type: "feature",
  },
];
