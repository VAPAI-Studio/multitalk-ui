# Phase 6: Dockerfile Editor - Research

**Researched:** 2026-03-04
**Domain:** Monaco Editor (React), GitHub REST API, FastAPI integration
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOCKER-01 | Admin can view list of Dockerfiles from GitHub repository | GitHub Contents API GET /repos/{owner}/{repo}/contents — lists files at a path; filter for files named "Dockerfile" or matching a pattern |
| DOCKER-02 | Admin can open Dockerfile in in-browser code editor | @monaco-editor/react v4.7.0 — `Editor` component with `language="dockerfile"` prop |
| DOCKER-03 | Code editor displays Dockerfile syntax highlighting (FROM, RUN, COPY, ENV, etc.) | Monaco Editor has built-in "dockerfile" as a basic-language; confirmed in monaco-editor source |
| DOCKER-04 | Code editor shows line numbers | Monaco Editor shows line numbers by default; controlled via `options={{ lineNumbers: "on" }}` |
| DOCKER-05 | Code editor supports undo/redo operations | Monaco Editor has native undo/redo via Ctrl+Z/Ctrl+Y built-in — no custom code needed |
| DOCKER-06 | Editor indicates when file has unsaved changes | Track `isDirty` state: compare editor value vs. originally loaded content on `onChange` |
| DOCKER-07 | Admin can save Dockerfile changes with custom commit message | GitHub Contents API PUT /repos/{owner}/{repo}/contents/{path} with message, base64-encoded content, SHA, and branch |
</phase_requirements>

---

## Summary

Phase 6 delivers an in-browser Dockerfile editor backed by GitHub as the source of truth. The implementation has two independent concerns: (1) listing and reading Dockerfile content from GitHub via the REST API, and (2) rendering that content in a Monaco editor with Dockerfile syntax highlighting in the React frontend. Saving writes back to GitHub via a PUT request with a custom commit message, obtaining the required file SHA from the prior GET. Phase 7 handles the git push/deploy side; Phase 6 only covers read + edit + commit-to-GitHub.

Monaco Editor (via `@monaco-editor/react`) has built-in support for `dockerfile` as a basic language — no custom tokenizer required. The library is confirmed compatible with React 19 and Vite 7 (the project's current stack). The GitHub REST API is the correct interface for listing files in a repo, reading raw file content, and updating (committing) file changes — all without running `git` locally on the server.

The backend role is a thin proxy: it holds GitHub credentials securely (GITHUB_TOKEN in settings), exposes admin-only endpoints, and calls the GitHub API using `httpx.AsyncClient` (already available in the project's dependencies). The frontend calls these backend endpoints, never the GitHub API directly, so credentials never touch the browser.

**Primary recommendation:** Use `@monaco-editor/react` with `language="dockerfile"` for the editor, and `httpx.AsyncClient` in the FastAPI backend for GitHub API calls. Keep the GitHub Personal Access Token server-side only.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @monaco-editor/react | 4.7.0 | React wrapper for Monaco Editor | Official React wrapper; works without webpack plugins; Vite-compatible; no config files needed |
| monaco-editor | 0.55.1 | Core Monaco engine (peer dep) | Powers VS Code; has built-in "dockerfile" basic language |
| httpx | already in requirements.txt | Async HTTP client for GitHub API calls | Already installed; async-first; FastAPI-aligned |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| base64 (stdlib) | Python stdlib | Encode file content for GitHub PUT | Required by GitHub Contents API — content must be base64-encoded |
| PyGithub | (NOT recommended) | Python GitHub wrapper | NOT used — adds a dependency when httpx already handles this cleanly |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @monaco-editor/react | react-monaco-editor | react-monaco-editor requires webpack configuration; @monaco-editor/react works out-of-box with Vite |
| @monaco-editor/react | CodeMirror 6 | CodeMirror 6 has Dockerfile support via lezer but Monaco is already specified by requirements |
| httpx for GitHub API | PyGithub | PyGithub is a heavier abstraction; httpx keeps the code explicit and async-native; project already uses httpx |
| httpx for GitHub API | gitpython | gitpython requires git binary and clones repos; REST API is stateless and simpler for read+commit use case |

**Installation:**
```bash
# Frontend only — backend already has httpx
npm install @monaco-editor/react
```

---

## Architecture Patterns

### Recommended Project Structure

```
frontend/src/
├── components/
│   └── DockerfileEditor.tsx     # Monaco editor wrapper: load, edit, save
├── pages/
│   └── Infrastructure.tsx       # Add DockerfileEditor section (existing file)
└── lib/
    └── apiClient.ts              # Add: listDockerfiles(), getDockerfile(), saveDockerfile()

backend/
├── api/
│   └── infrastructure.py        # Add: GET /dockerfiles, GET /dockerfiles/{path}, PUT /dockerfiles/{path}
├── models/
│   └── infrastructure.py        # Add: DockerfileListItem, DockerfileContent, DockerfileSaveRequest
├── services/
│   └── github_service.py        # New: GitHubService wrapping httpx calls to GitHub API
└── config/
    └── settings.py               # Add: GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_DOCKERFILES_PATH
```

### Pattern 1: Monaco Editor with Dockerfile Language

**What:** Render file content in Monaco with Dockerfile syntax highlighting, track dirty state, expose save callback.
**When to use:** Any time content loaded from GitHub is displayed and edited in-browser.

```typescript
// Source: @monaco-editor/react README (https://github.com/suren-atoyan/monaco-react)
import Editor from '@monaco-editor/react';
import { useState, useRef } from 'react';

interface DockerfileEditorProps {
  initialContent: string;
  onSave: (content: string, commitMessage: string) => Promise<void>;
}

export function DockerfileEditor({ initialContent, onSave }: DockerfileEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (value: string | undefined) => {
    const newContent = value ?? '';
    setContent(newContent);
    setIsDirty(newContent !== initialContent);
  };

  const handleSave = async () => {
    if (!commitMessage.trim()) return;
    setIsSaving(true);
    try {
      await onSave(content, commitMessage);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      {isDirty && <span className="text-amber-600 text-sm">Unsaved changes</span>}
      <Editor
        height="60vh"
        defaultLanguage="dockerfile"
        value={content}
        onChange={handleChange}
        options={{
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 14,
        }}
        theme="vs-dark"
      />
      <input
        type="text"
        placeholder="Commit message..."
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <button onClick={handleSave} disabled={!isDirty || !commitMessage.trim() || isSaving}>
        {isSaving ? 'Saving...' : 'Save & Commit'}
      </button>
    </div>
  );
}
```

### Pattern 2: GitHub Service — List, Read, Save

**What:** Backend service using `httpx.AsyncClient` to call GitHub REST API.
**When to use:** All GitHub API operations go through this service — never direct from frontend.

```python
# Source: GitHub REST API docs (https://docs.github.com/en/rest/repos/contents)
import httpx
import base64
from typing import Optional

class GitHubService:
    BASE_URL = "https://api.github.com"

    def __init__(self, token: str, repo: str, branch: str = "main"):
        self.token = token
        self.repo = repo          # "owner/repo"
        self.branch = branch
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def list_dockerfiles(self, search_path: str = "") -> list[dict]:
        """List all files named 'Dockerfile' or matching Dockerfile.* pattern at search_path."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/repos/{self.repo}/contents/{search_path}",
                headers=self.headers,
                params={"ref": self.branch},
            )
            response.raise_for_status()
            items = response.json()
            # Filter for Dockerfiles
            return [
                item for item in items
                if isinstance(item, dict) and item.get("type") == "file"
                and (item["name"] == "Dockerfile" or item["name"].startswith("Dockerfile."))
            ]

    async def get_file(self, path: str) -> dict:
        """Get file content and SHA. Returns {'content': str, 'sha': str}."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/repos/{self.repo}/contents/{path}",
                headers=self.headers,
                params={"ref": self.branch},
            )
            response.raise_for_status()
            data = response.json()
            # GitHub returns base64-encoded content
            raw = base64.b64decode(data["content"]).decode("utf-8")
            return {"content": raw, "sha": data["sha"], "path": path}

    async def update_file(self, path: str, content: str, sha: str, message: str) -> dict:
        """Commit updated file content. SHA from prior get_file() call is required."""
        encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{self.BASE_URL}/repos/{self.repo}/contents/{path}",
                headers=self.headers,
                json={
                    "message": message,
                    "content": encoded,
                    "sha": sha,
                    "branch": self.branch,
                },
            )
            response.raise_for_status()
            return response.json()
```

### Pattern 3: Admin-Only API Endpoints (follows existing pattern)

**What:** Infrastructure router endpoints — same pattern as all existing infrastructure endpoints.
**When to use:** Adding Dockerfile CRUD to the existing `/api/infrastructure` router.

```python
# Source: backend/api/infrastructure.py (existing pattern)
@router.get("/dockerfiles")
async def list_dockerfiles(
    search_path: str = Query(default="", description="Repo path to search for Dockerfiles"),
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """List Dockerfiles in the GitHub repository. Admin-only."""
    if not settings.GITHUB_TOKEN or not settings.GITHUB_REPO:
        raise HTTPException(status_code=400, detail="GitHub credentials not configured")
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        files = await service.list_dockerfiles(search_path)
        return {"success": True, "files": files}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"GitHub API error: {e.response.text}")

@router.get("/dockerfiles/content")
async def get_dockerfile(
    path: str = Query(..., description="Path to Dockerfile in repo"),
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """Get Dockerfile content and SHA. Admin-only."""
    if not settings.GITHUB_TOKEN or not settings.GITHUB_REPO:
        raise HTTPException(status_code=400, detail="GitHub credentials not configured")
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        result = await service.get_file(path)
        return {"success": True, **result}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"GitHub API error: {e.response.text}")

@router.put("/dockerfiles/content")
async def save_dockerfile(
    payload: DockerfileSaveRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """Save Dockerfile changes and commit to GitHub. Admin-only."""
    if not settings.GITHUB_TOKEN or not settings.GITHUB_REPO:
        raise HTTPException(status_code=400, detail="GitHub credentials not configured")
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        result = await service.update_file(payload.path, payload.content, payload.sha, payload.commit_message)
        return {"success": True, "commit_sha": result["commit"]["sha"]}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"GitHub API error: {e.response.text}")
```

### Pattern 4: Settings Extension

**What:** Add GitHub configuration to existing `config/settings.py`.
**When to use:** Any GitHub API call requires these settings.

```python
# Add to backend/config/settings.py Settings class
# GitHub Integration (for Dockerfile editor)
GITHUB_TOKEN: str = ""          # Fine-grained PAT with Contents: read+write
GITHUB_REPO: str = ""           # "owner/repo" — the repo containing Dockerfiles
GITHUB_BRANCH: str = "main"     # Branch to read/write Dockerfiles from
GITHUB_DOCKERFILES_PATH: str = ""  # Optional: root path to search for Dockerfiles
```

### Anti-Patterns to Avoid

- **Exposing GITHUB_TOKEN to frontend:** Never pass the token to the browser. The backend service is the sole caller of the GitHub API. Frontend calls `/api/infrastructure/dockerfiles`, not `api.github.com` directly.
- **Storing SHA in state only from list:** The `list_dockerfiles` endpoint does NOT return SHA. SHA must come from `get_dockerfile` at file-open time. Do not cache SHA from a stale list response.
- **Using `git` binary on the backend server:** Heroku dynos do not guarantee git is available, and cloning repos consumes memory. The GitHub REST API is stateless and does not require git.
- **Loading Monaco on initial page render:** Monaco is large (~3MB gzipped). Use React `lazy()` + `Suspense` to code-split the editor. Only load when admin opens the Dockerfile editor panel.
- **Re-using SHA for multiple saves:** After a successful PUT, the SHA changes. Always refetch the current SHA before each save attempt. Using a stale SHA returns 409 Conflict from GitHub.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Syntax highlighting for Dockerfiles | Custom tokenizer/regex highlighter | Monaco Editor built-in `language="dockerfile"` | Monaco's Monarch tokenizer covers all Dockerfile instructions (FROM, RUN, COPY, ENV, ARG, EXPOSE, ENTRYPOINT, CMD, LABEL, USER, WORKDIR, STOPSIGNAL, HEALTHCHECK, SHELL, VOLUME, ONBUILD) — confirmed in microsoft/monaco-editor source |
| Undo/redo stack | Custom history implementation | Monaco's built-in undo/redo (Ctrl+Z/Ctrl+Y) | Monaco maintains its own edit history per model — no code needed |
| Dirty-state tracking | Complex diffing | Simple string comparison: `editorValue !== originalValue` | Sufficient for single-file editing; no tree diffing needed |
| File reading from GitHub | Git clone + file read | GitHub Contents API GET /repos/{owner}/{repo}/contents/{path} | No disk space required; no git binary needed; works on Heroku |
| GitHub authentication | OAuth flow | Personal Access Token (fine-grained, repo Contents: read+write) | Admin-only internal tool; OAuth flow adds unnecessary complexity |

**Key insight:** Monaco provides undo/redo, line numbers, syntax highlighting, and keyboard shortcuts as built-in capabilities. The implementation is almost entirely wiring — connecting GitHub data to Monaco's existing features.

---

## Common Pitfalls

### Pitfall 1: Stale SHA on Save

**What goes wrong:** GitHub PUT returns `409 Conflict: SHA does not match` when the admin saves.
**Why it happens:** Another commit (CI, another admin session) updated the file between when the admin opened it and when they saved. The SHA from when the file was loaded is no longer the HEAD SHA.
**How to avoid:** Always fetch the file's current SHA immediately before submitting the PUT. Alternatively, store the SHA received from `get_file()` at open time and warn the admin if a 409 occurs, prompting them to reload.
**Warning signs:** Intermittent 409 errors on save, especially in repos with active CI pipelines.

### Pitfall 2: Monaco Vite Worker Import Error

**What goes wrong:** Vite builds fail or Monaco shows no syntax highlighting due to web worker resolution issues.
**Why it happens:** Monaco uses web workers for language services. Some bundler configurations fail to resolve these worker files correctly.
**How to avoid:** `@monaco-editor/react` explicitly handles this by loading Monaco via CDN by default, avoiding the webpack/Vite worker issue entirely. No additional Vite configuration is needed for the React wrapper. If you do switch to `monaco-editor` directly (not via the React wrapper), you need `@monaco-editor/vite-plugin`.
**Warning signs:** Console errors about `monaco-editor/esm/vs/editor/editor.worker.js` not found.

### Pitfall 3: Monaco Bundle Size on Initial Load

**What goes wrong:** Infrastructure page loads slowly because Monaco (~3MB) is loaded eagerly.
**Why it happens:** Importing `Editor` from `@monaco-editor/react` at the top of Infrastructure.tsx pulls the entire Monaco bundle into the initial chunk.
**How to avoid:** Use React `lazy()` to code-split DockerfileEditor: `const DockerfileEditor = lazy(() => import('./DockerfileEditor'))`. Wrap usage in `<Suspense fallback={...}>`. The split only occurs if the import is dynamic.
**Warning signs:** Initial page TTI is very slow; bundle analyzer shows Monaco in the main chunk.

### Pitfall 4: GITHUB_TOKEN Scope Too Broad

**What goes wrong:** Accidental deletion of arbitrary repository content, or security exposure if the token leaks.
**Why it happens:** Using a classic PAT with `repo` scope grants read/write to all repositories in the account.
**How to avoid:** Use a fine-grained Personal Access Token scoped to exactly one repository with only `Contents: Read and Write` permission. This is the minimum needed for Phase 6 (read Dockerfiles, commit changes).
**Warning signs:** Token has more permissions than Contents read/write on a single repo.

### Pitfall 5: GitHub API Rate Limits

**What goes wrong:** 403/429 from GitHub API when the admin loads the Dockerfile list or fetches file content repeatedly.
**Why it happens:** Unauthenticated: 60 req/hr. Authenticated with token: 5,000 req/hr. With only one admin user and rare edits, rate limits are not a concern in practice. However, if list_dockerfiles recursively traverses a large repo tree, API calls multiply quickly.
**How to avoid:** Scope `GITHUB_DOCKERFILES_PATH` to the specific directory containing Dockerfiles (e.g., `"backend/runpod_handlers"`). Do not recursively list the entire repo. One API call per directory listing + one per file open is well within 5,000 req/hr.
**Warning signs:** HTTP 403 with "API rate limit exceeded" in the response body.

### Pitfall 6: Monaco `value` vs `defaultValue` Re-render Loop

**What goes wrong:** Editor content flickers or is reset to original when the parent component re-renders.
**Why it happens:** Using `value` (controlled) causes Monaco to reset content on every re-render if state is lifted to the parent. Using `defaultValue` (uncontrolled) means external updates (e.g., loading a different file) don't propagate to the editor.
**How to avoid:** Use `defaultValue` for initial content, plus a `key` prop tied to the filename. When the admin switches to a different Dockerfile, change the `key` — this forces a full Monaco remount with the new file's content. Use `onChange` to track dirty state without controlling the editor value.

```typescript
// Correct: use defaultValue + key for file switching
<Editor
  key={selectedFilePath}          // forces remount when file changes
  defaultLanguage="dockerfile"
  defaultValue={loadedContent}    // uncontrolled — Monaco owns the state
  onChange={handleChange}
/>
```

---

## Code Examples

Verified patterns from official sources:

### Monaco Editor Installation and Basic Setup

```bash
# Install @monaco-editor/react (React wrapper; no Vite plugin needed)
npm install @monaco-editor/react
```

```typescript
// Source: https://github.com/suren-atoyan/monaco-react (official README)
import Editor from '@monaco-editor/react';

function DockerfileEditor({ content, onChange }) {
  return (
    <Editor
      height="400px"
      defaultLanguage="dockerfile"   // Built-in Monaco language — no custom tokenizer
      defaultValue={content}
      onChange={onChange}
      options={{
        lineNumbers: 'on',           // DOCKER-04
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        fontSize: 13,
        tabSize: 4,
        insertSpaces: true,
      }}
      theme="vs-dark"
    />
  );
}
```

### GitHub Contents API — List Files at Path

```python
# Source: https://docs.github.com/en/rest/repos/contents
# GET /repos/{owner}/{repo}/contents/{path}
# Returns array of items with: name, path, sha, type (file/dir), size, url

async def list_files_at_path(path: str) -> list:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://api.github.com/repos/{repo}/contents/{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            params={"ref": branch},
        )
        r.raise_for_status()
        return r.json()
```

### GitHub Contents API — Get File (with SHA and Content)

```python
# Source: https://docs.github.com/en/rest/repos/contents
# Response: {"sha": "abc123...", "content": "<base64>", "encoding": "base64", ...}

async def get_file_content(path: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://api.github.com/repos/{repo}/contents/{path}",
            headers=headers,
            params={"ref": branch},
        )
        r.raise_for_status()
        data = r.json()
        return {
            "sha": data["sha"],
            "content": base64.b64decode(data["content"]).decode("utf-8"),
            "path": path,
        }
```

### GitHub Contents API — Update (Commit) File

```python
# Source: https://docs.github.com/en/rest/repos/contents
# PUT /repos/{owner}/{repo}/contents/{path}
# REQUIRES: sha (from prior GET) — 409 Conflict if SHA doesn't match HEAD

async def update_file(path: str, content: str, sha: str, message: str) -> dict:
    encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
    async with httpx.AsyncClient() as client:
        r = await client.put(
            f"https://api.github.com/repos/{repo}/contents/{path}",
            headers=headers,
            json={
                "message": message,     # Commit message (user-provided)
                "content": encoded,     # Base64-encoded file content
                "sha": sha,             # SHA from prior GET — required for updates
                "branch": branch,       # Target branch
            },
        )
        r.raise_for_status()
        return r.json()
        # Response includes: {"commit": {"sha": "..."}, "content": {...}}
```

### Dirty State Tracking (Frontend)

```typescript
// Source: Pattern derived from requirements DOCKER-06
// isDirty = editor content differs from the last-saved (or initially loaded) content

const [originalContent, setOriginalContent] = useState('');
const [isDirty, setIsDirty] = useState(false);

// When file is loaded:
const loadFile = async (path: string) => {
  const { content, sha } = await apiClient.getDockerfile(path);
  setOriginalContent(content);
  setCurrentSha(sha);
  setIsDirty(false);
};

// On editor change:
const handleChange = (value: string | undefined) => {
  setIsDirty((value ?? '') !== originalContent);
};

// On successful save:
const handleSaveSuccess = (newContent: string) => {
  setOriginalContent(newContent);
  setIsDirty(false);
  // Also update SHA from server response for next save
};
```

### apiClient Methods (Frontend)

```typescript
// Add to frontend/src/lib/apiClient.ts

async listDockerfiles(searchPath: string = ''): Promise<{success: boolean; files: DockerfileListItem[]}> {
  return this.request(`/infrastructure/dockerfiles?search_path=${encodeURIComponent(searchPath)}`);
}

async getDockerfile(path: string): Promise<{success: boolean; content: string; sha: string; path: string}> {
  return this.request(`/infrastructure/dockerfiles/content?path=${encodeURIComponent(path)}`);
}

async saveDockerfile(path: string, content: string, sha: string, commitMessage: string): Promise<{success: boolean; commit_sha: string}> {
  return this.request('/infrastructure/dockerfiles/content', {
    method: 'PUT',
    body: JSON.stringify({ path, content, sha, commit_message: commitMessage }),
  });
}
```

### Pydantic Models (Backend)

```python
# Add to backend/models/infrastructure.py

class DockerfileListItem(BaseModel):
    """A Dockerfile found in the GitHub repository."""
    name: str         # "Dockerfile" or "Dockerfile.prod"
    path: str         # "backend/runpod_handlers/Dockerfile"
    sha: str          # Current blob SHA — do NOT use this for update; refetch at open time

class DockerfileContent(BaseModel):
    """Full content of a Dockerfile with its current SHA."""
    path: str
    content: str      # Decoded UTF-8 content
    sha: str          # Current blob SHA — pass back unmodified for update

class DockerfileSaveRequest(BaseModel):
    """Request to commit updated Dockerfile content."""
    path: str
    content: str      # Full updated content (UTF-8)
    sha: str          # SHA from most recent getDockerfile() call
    commit_message: str  # User-provided commit message (required, non-empty)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-monaco-editor (webpack-dependent) | @monaco-editor/react v4 (Vite-compatible) | 2020 | No Vite/webpack config needed — just npm install |
| Classic GitHub PAT (full repo scope) | Fine-grained PAT (Contents: read+write, single repo) | 2022 | Principle of least privilege; limits blast radius if token leaks |
| Fetch entire repo tree recursively | Target specific directory via Contents API path param | Always supported | Avoids traversing large repos; stay within rate limits |
| Monaco `value` controlled prop | Monaco `defaultValue` + `key` for file switching | Always available | Avoids infinite re-render loops with controlled editors |

**Deprecated/outdated:**
- `react-monaco-editor`: Requires webpack loader configuration — incompatible with the project's Vite setup. Use `@monaco-editor/react` instead.
- Classic GitHub PATs with `repo` scope: Overly broad. Fine-grained tokens are available and preferred since 2022.

---

## Open Questions

1. **Where are the Dockerfiles located in the GitHub repo?**
   - What we know: The project's RunPod handler is at `backend/runpod_handlers/`. Dockerfiles could be there or at repo root.
   - What's unclear: Exact repo structure, owner/repo slug, target branch.
   - Recommendation: Make `GITHUB_DOCKERFILES_PATH` a configurable setting (default: `""`). Plan the UI to accept a path input or show a full listing. Confirm with the team during implementation.

2. **Should the list show Dockerfiles in subdirectories recursively?**
   - What we know: GitHub Contents API at a path returns only immediate children (not recursive). Recursive listing requires the Git Trees API (GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1).
   - What's unclear: How deep the Dockerfile nesting is.
   - Recommendation: Start with non-recursive listing at `GITHUB_DOCKERFILES_PATH`. If subdirectory support is needed, add a toggle for recursive search using the Git Trees API in a follow-up.

3. **What happens if the GitHub repo is private?**
   - What we know: Fine-grained PAT with Contents: read+write on a private repo works identically to public. Token must have access to the specific private repository.
   - What's unclear: Nothing — the API behavior is the same.
   - Recommendation: No special handling needed. The PAT scope handles private repos transparently.

---

## Sources

### Primary (HIGH confidence)
- `@monaco-editor/react` GitHub README (https://github.com/suren-atoyan/monaco-react) — version, props, Vite compatibility
- monaco-editor v0.55.1 source — `dockerfile` confirmed as built-in basic language in `src/basic-languages/monaco.contribution.ts` (search result evidence: "dockerfile" appeared in enumerated language list)
- GitHub REST API docs (https://docs.github.com/en/rest/repos/contents) — GET file, PUT update with SHA and base64 encoding
- Existing project code: `backend/api/infrastructure.py`, `backend/core/auth.py`, `backend/config/settings.py`, `frontend/src/pages/Infrastructure.tsx`, `frontend/src/lib/apiClient.ts`

### Secondary (MEDIUM confidence)
- npm search results: `@monaco-editor/react` latest stable is 4.7.0; `@monaco-editor/react@next` for React 19 rc
- GitHub Changelog (2025-05-08): Rate limits for unauthenticated requests — authenticated with PAT remains 5,000/hr
- WebSearch multiple sources confirming: fine-grained PAT requires `Contents: read+write` for file updates

### Tertiary (LOW confidence)
- `@monaco-editor/react@next` (v4.7.0-rc.0) for React 19 compatibility: mentioned in npm search results but not verified against official changelog. The project uses React 19.1.1 — may need `@next` tag if `4.7.0` stable has peer dep issues. **Validate during task execution.**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Monaco built-in dockerfile language confirmed; httpx already in project; @monaco-editor/react Vite compatibility confirmed
- Architecture: HIGH — follows established infrastructure.py patterns exactly; GitHub API endpoints are well-documented
- Pitfalls: HIGH — SHA requirement, stale SHA 409 conflict, and Monaco bundle size are well-documented issues across multiple sources

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (Monaco and GitHub API are stable; 30-day window appropriate)
