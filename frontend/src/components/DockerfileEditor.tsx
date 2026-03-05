import { lazy, Suspense, useEffect, useState } from "react";
import { apiClient } from "../lib/apiClient";

const MonacoEditor = lazy(() => import("@monaco-editor/react").then(m => ({ default: m.default })));

export function DockerfileEditor() {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [sha, setSha] = useState<string>("");
  const [filePath, setFilePath] = useState<string>("");
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>("");

  // Load Dockerfile on mount
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const result = await apiClient.getDockerfile();
        setContent(result.content);
        setOriginalContent(result.content);
        setSha(result.sha);
        setFilePath(result.path);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load Dockerfile from GitHub";
        setLoadError(message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Track dirty state on editor change (DOCKER-06)
  const handleEditorChange = (value: string | undefined) => {
    const newVal = value ?? "";
    setContent(newVal);
    setIsDirty(newVal !== originalContent);
    setSaveStatus(""); // clear previous save status on edit
  };

  // Save and commit (DOCKER-07)
  const handleSave = async () => {
    if (!isDirty || !commitMessage.trim() || isSaving) return;
    setIsSaving(true);
    setSaveStatus("");
    try {
      const result = await apiClient.saveDockerfile(content, sha, commitMessage.trim());
      // Update SHA from response so next save uses the new HEAD SHA
      setSha(result.commit_sha);
      setOriginalContent(content);
      setIsDirty(false);
      setSaveStatus("Committed successfully (" + result.commit_sha.slice(0, 7) + ")");
      setCommitMessage("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("409")) {
        setSaveStatus("File was modified externally — please reload before saving");
        // isDirty intentionally NOT reset — user's edits are preserved
      } else {
        setSaveStatus("Save failed: " + message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Section wrapper follows existing Infrastructure.tsx card style
  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-indigo-500 to-blue-600 rounded-full"></div>
        Dockerfile Editor
        {filePath && (
          <span className="text-sm font-normal text-gray-500 ml-2">{filePath}</span>
        )}
        {isDirty && (
          <span className="text-sm font-semibold text-amber-600 ml-auto">Unsaved changes</span>
        )}
      </h2>

      {isLoading && (
        <div className="h-64 rounded-2xl bg-gray-100 animate-pulse flex items-center justify-center text-gray-400">
          Loading Dockerfile from GitHub...
        </div>
      )}

      {loadError && !isLoading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {loadError}
        </div>
      )}

      {!isLoading && !loadError && (
        <>
          {/* Monaco Editor — code-split inside this component via lazy(), only loaded when this section renders */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 mb-4">
            <Suspense fallback={
              <div className="h-96 bg-gray-900 flex items-center justify-center text-gray-400">
                Loading editor...
              </div>
            }>
              <MonacoEditor
                key={filePath}
                height="500px"
                defaultLanguage="dockerfile"
                defaultValue={content}
                onChange={handleEditorChange}
                theme="vs-dark"
                options={{
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  fontSize: 13,
                  tabSize: 4,
                  insertSpaces: true,
                }}
              />
            </Suspense>
          </div>

          {/* Commit message and save */}
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Commit message (required to save)..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all duration-200 bg-white/80"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleSave}
                disabled={!isDirty || !commitMessage.trim() || isSaving}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold shadow-lg hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Saving...
                  </>
                ) : (
                  "Save & Commit"
                )}
              </button>
              {saveStatus && (
                <span className={`text-sm ${saveStatus.startsWith("Committed") ? "text-green-600" : "text-red-600"}`}>
                  {saveStatus}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
