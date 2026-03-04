import React, { useState } from "react";
import { apiClient } from "../lib/apiClient";

interface FileSystemItem {
  type: "file" | "folder";
  name: string;
  path: string;
  size: number | null;
  sizeHuman: string | null;
  lastModified: string | null;
  childCount: number | null;
}

interface Props {
  item: FileSystemItem;
  depth: number;
}

export function FileTreeNode({ item, depth }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileSystemItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>("");

  const handleToggle = async () => {
    if (item.type === "file") return;

    // Collapse if already expanded
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    // Expand and fetch children if not already loaded
    if (children.length === 0) {
      setIsLoading(true);
      setError("");
      try {
        const response = await apiClient.listFiles(item.path, 200);
        setChildren(response.items);
        setIsExpanded(true);
      } catch (err: any) {
        setError(err.message || "Failed to load folder contents");
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsExpanded(true);
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent row click from toggling folder expand
    setIsDownloading(true);
    setDownloadError("");
    try {
      await apiClient.downloadFile(item.path, item.name);
    } catch (err: any) {
      setDownloadError(err.message || "Download failed");
      // Clear error after 5 seconds
      setTimeout(() => setDownloadError(""), 5000);
    } finally {
      setIsDownloading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const indentPadding = depth * 20; // 20px per level

  return (
    <div>
      {/* Current item */}
      <div
        className={`flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer transition-colors border-l-2 ${
          item.type === "folder" ? "border-blue-300" : "border-gray-200"
        }`}
        style={{ paddingLeft: `${indentPadding + 16}px` }}
        onClick={handleToggle}
      >
        {/* Icon */}
        <span className="text-lg flex-shrink-0">
          {item.type === "folder" ? (
            isExpanded ? (
              <span>📂</span>
            ) : (
              <span>📁</span>
            )
          ) : (
            <span>📄</span>
          )}
        </span>

        {/* Name */}
        <span className="font-medium text-gray-800 flex-1 truncate">
          {item.name}
        </span>

        {/* Size (files only) */}
        {item.type === "file" && item.sizeHuman && (
          <span className="text-sm text-gray-500 flex-shrink-0">
            {item.sizeHuman}
          </span>
        )}

        {/* Last Modified */}
        {item.lastModified && (
          <span className="text-xs text-gray-400 flex-shrink-0 hidden md:block">
            {formatDate(item.lastModified)}
          </span>
        )}

        {/* Download button — files only */}
        {item.type === "file" && (
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            title={`Download ${item.name}`}
            className="flex-shrink-0 px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-slate-200 flex items-center gap-1"
            aria-label={`Download ${item.name}`}
          >
            {isDownloading ? (
              <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>⬇️</span>
            )}
            {isDownloading ? "..." : ""}
          </button>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="ml-8 px-4 py-2 text-sm text-red-600 bg-red-50 rounded" style={{ marginLeft: `${indentPadding + 32}px` }}>
          {error}
        </div>
      )}

      {/* Download error (auto-clears after 5s) */}
      {downloadError && item.type === "file" && (
        <div
          className="px-4 py-1 text-xs text-red-600 bg-red-50"
          style={{ paddingLeft: `${indentPadding + 16}px` }}
        >
          Download error: {downloadError}
        </div>
      )}

      {/* Recursively render children */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Empty folder message */}
      {isExpanded && children.length === 0 && !isLoading && !error && (
        <div className="ml-8 px-4 py-2 text-sm text-gray-400 italic" style={{ marginLeft: `${indentPadding + 32}px` }}>
          Empty folder
        </div>
      )}
    </div>
  );
}
