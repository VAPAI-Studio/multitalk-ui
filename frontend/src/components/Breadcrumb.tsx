import React from "react";

interface BreadcrumbSegment {
  name: string;
  path: string;
}

interface Props {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ currentPath, onNavigate }: Props) {
  // Build breadcrumb segments from current path
  const segments: BreadcrumbSegment[] = [
    { name: "Root", path: "" }
  ];

  if (currentPath) {
    const parts = currentPath.split("/").filter(Boolean);
    parts.forEach((part, index) => {
      const segmentPath = parts.slice(0, index + 1).join("/");
      segments.push({
        name: part,
        path: segmentPath
      });
    });
  }

  return (
    <nav className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 overflow-x-auto">
      <span className="text-sm text-gray-500 flex-shrink-0">Location:</span>

      {segments.map((segment, index) => (
        <React.Fragment key={segment.path}>
          {/* Segment button */}
          <button
            onClick={() => onNavigate(segment.path)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
              index === segments.length - 1
                ? "bg-blue-100 text-blue-700 cursor-default"
                : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
            }`}
            disabled={index === segments.length - 1}
          >
            {segment.name === "Root" ? "🏠 Root" : segment.name}
          </button>

          {/* Separator (not after last segment) */}
          {index < segments.length - 1 && (
            <span className="text-gray-400 flex-shrink-0">/</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
