import { useState } from "react";
import { announcements } from "../constants/changelog";

const STORAGE_KEY = "dismissed-announcement";

const typeStyles = {
  feature:
    "bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white",
  fix: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white",
  info: "bg-gradient-to-r from-gray-600 to-gray-700 text-white dark:from-gray-700 dark:to-gray-800",
};

export default function AnnouncementBanner() {
  const latest = announcements[0];
  const [dismissed, setDismissed] = useState(() => {
    if (!latest) return true;
    return localStorage.getItem(STORAGE_KEY) === latest.id;
  });

  if (!latest || dismissed) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, latest.id);
    setDismissed(true);
  }

  return (
    <div
      className={`${typeStyles[latest.type]} px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-3`}
    >
      <span className="truncate">{latest.message}</span>
      <button
        onClick={dismiss}
        className="shrink-0 ml-2 p-0.5 rounded hover:bg-white/20 transition-colors"
        aria-label="Dismiss announcement"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
