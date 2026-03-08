import { useState, useEffect, useRef } from "react";
import { apiClient } from "../lib/apiClient";
import { FileTreeNode } from "./FileTreeNode";
import { Breadcrumb } from "./Breadcrumb";

interface FileSystemItem {
  type: "file" | "folder";
  name: string;
  path: string;
  size: number | null;
  sizeHuman: string | null;
  lastModified: string | null;
  childCount: number | null;
}

interface FileTreeProps {
  currentPath?: string;                    // controlled from Infrastructure.tsx
  onNavigate?: (path: string) => void;     // called when user navigates
  onRefreshRequest?: () => void;           // kept for backward compat; handleRefresh no longer calls it
  refreshId?: number;                      // increment to request an internal reload without remounting
}

export function FileTree({ currentPath: externalPath, onNavigate, onRefreshRequest: _onRefreshRequest, refreshId }: FileTreeProps = {}) {
  const [rootItems, setRootItems] = useState<FileSystemItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [currentPath, setCurrentPath] = useState<string>(externalPath ?? "");

  // Pagination state
  const [hasMore, setHasMore] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Load root directory on mount
  useEffect(() => {
    loadDirectory(externalPath ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when parent navigates to a different path
  useEffect(() => {
    if (externalPath !== undefined && externalPath !== currentPath) {
      loadDirectory(externalPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPath]);

  // Reload when refreshId changes (without remounting)
  const prevRefreshId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (refreshId !== undefined && refreshId > 0) {
      prevRefreshId.current = refreshId;
      loadDirectory(currentPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshId]);

  const loadDirectory = async (path: string = "") => {
    setIsLoading(true);
    setError("");
    setHasMore(false);
    setContinuationToken(null);
    try {
      const response = await apiClient.listFiles(path, 200);
      setRootItems(response.items);
      setHasMore(response.hasMore);
      setContinuationToken(response.continuationToken);
      setCurrentPath(path);
      onNavigate?.(path);
    } catch (err: any) {
      setError(err.message || "Failed to load directory contents");
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!continuationToken || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await apiClient.listFiles(currentPath, 200, continuationToken);
      setRootItems(prev => [...prev, ...response.items]);
      setHasMore(response.hasMore);
      setContinuationToken(response.continuationToken);
    } catch (err: any) {
      setError(err.message || "Failed to load more items");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleRefresh = () => {
    loadDirectory(currentPath);
  };

  return (
    <div className="rounded-3xl border border-gray-200/80 shadow-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
              <span>💾</span>
              Network Volume Browser
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Browse files and folders on your RunPod network volume
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-4 py-2 bg-white border-2 border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Refresh current directory"
          >
            <span className={isLoading ? "animate-spin" : ""}>🔄</span>
            Refresh
          </button>
        </div>

        {/* Breadcrumb navigation */}
        <Breadcrumb
          currentPath={currentPath}
          onNavigate={(path) => loadDirectory(path)}
        />
      </div>

      {/* Content */}
      <div className="max-h-[600px] overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="ml-3 text-gray-600">Loading network volume...</span>
          </div>
        )}

        {error && (
          <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 mb-1">Error Loading Volume</h3>
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !error && rootItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <span className="text-4xl mb-3">📂</span>
            <p>Network volume is empty</p>
          </div>
        )}

        {!isLoading && !error && rootItems.length > 0 && (
          <div className="py-2">
            {rootItems.map((item) => (
              <FileTreeNode key={item.path} item={item} depth={0} onOperationComplete={handleRefresh} />
            ))}
          </div>
        )}

        {!isLoading && !error && hasMore && (
          <div className="px-6 py-3 border-t border-gray-100">
            <button
              onClick={loadMore}
              disabled={isLoadingMore}
              className="w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Loading more...
                </>
              ) : (
                "Load more"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
