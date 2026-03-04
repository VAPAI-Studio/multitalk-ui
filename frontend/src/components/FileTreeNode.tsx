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
  onOperationComplete?: () => void;
}

export function FileTreeNode({ item, depth, onOperationComplete }: Props) {
  // Expand/collapse state
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileSystemItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>("");

  // Operation state (shared across delete/rename/move)
  const [isOperating, setIsOperating] = useState(false);
  const [operationError, setOperationError] = useState<string>("");

  // Modal visibility
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Rename input: pre-filled with current name
  const [newName, setNewName] = useState(item.name);
  // Move input: pre-filled with current path
  const parentPath = item.path.includes("/")
    ? item.path.substring(0, item.path.lastIndexOf("/"))
    : "";
  const [destPath, setDestPath] = useState(item.path);

  const handleToggle = async () => {
    if (item.type === "file") return;
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
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
    e.stopPropagation();
    setIsDownloading(true);
    setDownloadError("");
    try {
      await apiClient.downloadFile(item.path, item.name);
    } catch (err: any) {
      setDownloadError(err.message || "Download failed");
      setTimeout(() => setDownloadError(""), 5000);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    setIsOperating(true);
    setOperationError("");
    try {
      if (item.type === "folder") {
        await apiClient.deleteFolder(item.path);
      } else {
        await apiClient.deleteFile(item.path);
      }
      setShowDeleteConfirm(false);
      onOperationComplete?.();
    } catch (err: any) {
      const msg = err.message || "Delete failed";
      setOperationError(msg);
      setTimeout(() => setOperationError(""), 5000);
      setShowDeleteConfirm(false);
    } finally {
      setIsOperating(false);
    }
  };

  const handleRename = async () => {
    if (!newName || newName === item.name) {
      setShowRenameModal(false);
      return;
    }
    const newPath = parentPath ? parentPath + "/" + newName : newName;
    setIsOperating(true);
    setOperationError("");
    try {
      if (item.type === "folder") {
        await apiClient.moveFolder(item.path, newPath);
      } else {
        await apiClient.moveFile(item.path, newPath);
      }
      setShowRenameModal(false);
      onOperationComplete?.();
    } catch (err: any) {
      const msg = err.message || "Rename failed";
      setOperationError(msg);
      setTimeout(() => setOperationError(""), 5000);
      setShowRenameModal(false);
    } finally {
      setIsOperating(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const folderPath = item.path ? `${item.path}/${trimmed}` : trimmed;
    setIsOperating(true);
    setOperationError("");
    try {
      await apiClient.createFolder(folderPath);
      setShowCreateFolderModal(false);
      setNewFolderName("");
      // Reload children if expanded so the new folder appears
      if (isExpanded) {
        const response = await apiClient.listFiles(item.path, 200);
        setChildren(response.items);
      }
      onOperationComplete?.();
    } catch (err: any) {
      const msg = err.message || "Create folder failed";
      setOperationError(msg);
      setTimeout(() => setOperationError(""), 5000);
      setShowCreateFolderModal(false);
    } finally {
      setIsOperating(false);
    }
  };

  const handleMove = async () => {
    if (!destPath || destPath === item.path) {
      setShowMoveModal(false);
      return;
    }
    // Frontend path traversal guard
    if (destPath.includes("..")) {
      setOperationError("Destination path cannot contain '..'");
      setTimeout(() => setOperationError(""), 5000);
      setShowMoveModal(false);
      return;
    }
    setIsOperating(true);
    setOperationError("");
    try {
      if (item.type === "folder") {
        await apiClient.moveFolder(item.path, destPath);
      } else {
        await apiClient.moveFile(item.path, destPath);
      }
      setShowMoveModal(false);
      onOperationComplete?.();
    } catch (err: any) {
      const msg = err.message || "Move failed";
      setOperationError(msg);
      setTimeout(() => setOperationError(""), 5000);
      setShowMoveModal(false);
    } finally {
      setIsOperating(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const indentPadding = depth * 20;

  return (
    <div>
      {/* Current item row */}
      <div
        className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer transition-colors border-l-2 ${
          item.type === "folder" ? "border-blue-300" : "border-gray-200"
        }`}
        style={{ paddingLeft: `${indentPadding + 16}px` }}
        onClick={handleToggle}
      >
        {/* Icon */}
        <span className="text-lg flex-shrink-0">
          {item.type === "folder" ? (
            isExpanded ? <span>📂</span> : <span>📁</span>
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
          <span className="text-sm text-gray-500 flex-shrink-0">{item.sizeHuman}</span>
        )}

        {/* Last Modified */}
        {item.lastModified && (
          <span className="text-xs text-gray-400 flex-shrink-0 hidden md:block">
            {formatDate(item.lastModified)}
          </span>
        )}

        {/* Action buttons — all use e.stopPropagation() to prevent folder toggle */}

        {/* Download (files only) */}
        {item.type === "file" && (
          <button
            onClick={handleDownload}
            disabled={isDownloading || isOperating}
            title={`Download ${item.name}`}
            className="flex-shrink-0 px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-slate-200 flex items-center gap-1"
            aria-label={`Download ${item.name}`}
          >
            {isDownloading ? (
              <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>⬇️</span>
            )}
          </button>
        )}

        {/* Rename button */}
        <button
          onClick={(e) => { e.stopPropagation(); setNewName(item.name); setShowRenameModal(true); }}
          disabled={isOperating}
          title={`Rename ${item.name}`}
          className="flex-shrink-0 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-gray-200"
          aria-label={`Rename ${item.name}`}
        >
          ✏️
        </button>

        {/* Move button */}
        <button
          onClick={(e) => { e.stopPropagation(); setDestPath(item.path); setShowMoveModal(true); }}
          disabled={isOperating}
          title={`Move ${item.name}`}
          className="flex-shrink-0 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-blue-200"
          aria-label={`Move ${item.name}`}
        >
          📦
        </button>

        {/* Create subfolder button (folders only) */}
        {item.type === "folder" && (
          <button
            onClick={(e) => { e.stopPropagation(); setNewFolderName(""); setShowCreateFolderModal(true); }}
            disabled={isOperating}
            title="Create subfolder"
            className="flex-shrink-0 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-green-200"
            aria-label="Create subfolder"
          >
            ➕
          </button>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
          disabled={isOperating}
          title={`Delete ${item.name}`}
          className="flex-shrink-0 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-red-200"
          aria-label={`Delete ${item.name}`}
        >
          🗑️
        </button>

        {/* Spinner during operations */}
        {(isLoading || isOperating) && (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
        )}
      </div>

      {/* Inline errors */}
      {error && (
        <div className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded" style={{ paddingLeft: `${indentPadding + 32}px` }}>
          {error}
        </div>
      )}
      {downloadError && item.type === "file" && (
        <div className="px-4 py-1 text-xs text-red-600 bg-red-50" style={{ paddingLeft: `${indentPadding + 16}px` }}>
          Download error: {downloadError}
        </div>
      )}
      {operationError && (
        <div className="px-4 py-1 text-xs text-red-600 bg-red-50" style={{ paddingLeft: `${indentPadding + 16}px` }}>
          {operationError}
        </div>
      )}

      {/* Children */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              onOperationComplete={onOperationComplete}
            />
          ))}
        </div>
      )}
      {isExpanded && children.length === 0 && !isLoading && !error && (
        <div className="px-4 py-2 text-sm text-gray-400 italic" style={{ paddingLeft: `${indentPadding + 32}px` }}>
          Empty folder
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Delete {item.type === "folder" ? "Folder" : "File"}?
            </h3>
            <p className="text-gray-600 mb-1 text-sm">
              <span className="font-mono bg-gray-100 px-1 rounded">{item.name}</span>
            </p>
            {item.type === "folder" && (
              <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                Warning: This will permanently delete all files inside this folder. This cannot be undone.
              </p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isOperating}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {isOperating ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRenameModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Rename {item.type === "folder" ? "Folder" : "File"}
            </h3>
            <label className="block text-sm font-medium text-gray-700 mb-2">New name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setShowRenameModal(false); }}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-xl text-sm focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowRenameModal(false)}
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={isOperating || !newName}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {isOperating ? "Renaming..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateFolderModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Create Subfolder</h3>
            <p className="text-sm text-gray-500 mb-4">
              Inside <span className="font-mono bg-gray-100 px-1 rounded">{item.path}/</span>
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-2">Folder name</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowCreateFolderModal(false); }}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-xl text-sm focus:border-green-500 focus:outline-none"
              placeholder="e.g. my-loras"
              autoFocus
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateFolderModal(false)}
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={isOperating || !newFolderName.trim()}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 font-medium"
              >
                {isOperating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowMoveModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Move {item.type === "folder" ? "Folder" : "File"}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Enter the full destination path (e.g. <span className="font-mono bg-gray-100 px-1 rounded">models/loras/my-model.safetensors</span>)
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-2">Destination path</label>
            <input
              type="text"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleMove(); if (e.key === "Escape") setShowMoveModal(false); }}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-xl text-sm font-mono focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            {item.type === "folder" && (
              <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                Note: Moving a large folder may take time. Heroku has a 30-second request timeout.
              </p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowMoveModal(false)}
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                disabled={isOperating || !destPath}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {isOperating ? "Moving..." : "Move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
