# Stack Research: Infrastructure Management Features

**Research Date:** 2026-03-04
**Researcher:** Claude (Opus 4.6)
**Scope:** File browser, code editor, and GitHub integration for existing FastAPI + React (Vite/TypeScript/TailwindCSS) application
**Confidence Caveat:** Version numbers are based on knowledge up to May 2025. Tool access for live NPM/PyPI verification was unavailable during this research session. Versions should be verified before adoption.

---

## 1. Existing Stack Context

From the project's CLAUDE.md and codebase:
- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS
- **Backend:** FastAPI + Python
- **Database/Auth/Storage:** Supabase (PostgreSQL, Auth, Storage)
- **State:** React Context (AuthContext, ExecutionBackendContext)
- **Navigation:** Single-page with conditional rendering in App.tsx (no React Router)
- **Package Manager:** npm

All recommendations below are chosen to integrate naturally with this existing stack.

---

## 2. Code Editor

### Recommendation: `@monaco-editor/react`

| Attribute | Detail |
|-----------|--------|
| **Package** | `@monaco-editor/react` |
| **Version (verify)** | ~4.6.x (as of early 2025; check npm for latest) |
| **Underlying engine** | Monaco Editor (same engine as VS Code) |
| **Confidence** | HIGH |

**Why Monaco:**
- Industry standard for web-based code editing (powers VS Code, GitHub Codespaces, Gitpod, StackBlitz)
- First-class TypeScript/JSX/Python/JSON syntax highlighting and IntelliSense out of the box
- Rich API for themes, keybindings, diff view, minimap, find/replace
- The `@monaco-editor/react` wrapper provides clean React integration with hooks-based API, lazy loading, and proper lifecycle management
- Massive community: 3M+ weekly npm downloads, actively maintained
- Supports multi-model editing (multiple files open simultaneously via separate model URIs)

**Why NOT CodeMirror 6:**
- CodeMirror 6 is excellent and more lightweight, but requires assembling many separate packages (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-*`, etc.) -- higher integration complexity
- Monaco provides a more "batteries included" experience that better matches the project's pattern of using high-level component libraries
- CodeMirror 6 would be the right choice if bundle size were the primary constraint; for this project (already loading heavy AI media), Monaco's ~2MB is acceptable

**Why NOT Ace Editor:**
- Legacy architecture, declining community investment
- Monaco surpassed it in features and ecosystem support years ago
- No compelling reason to choose Ace for new projects

**Integration pattern:**
```tsx
import Editor from '@monaco-editor/react';

<Editor
  height="70vh"
  language="python"
  theme="vs-dark"
  value={fileContent}
  onChange={(value) => setFileContent(value || '')}
  options={{
    minimap: { enabled: true },
    fontSize: 14,
    wordWrap: 'on',
    automaticLayout: true,
  }}
/>
```

**Diff view** (for GitHub PR review):
```tsx
import { DiffEditor } from '@monaco-editor/react';

<DiffEditor
  original={originalContent}
  modified={modifiedContent}
  language="python"
/>
```

---

## 3. File Browser / Tree View

### Recommendation: `react-arborist`

| Attribute | Detail |
|-----------|--------|
| **Package** | `react-arborist` |
| **Version (verify)** | ~3.4.x (as of early 2025; check npm for latest) |
| **Confidence** | HIGH |

**Why react-arborist:**
- Purpose-built for file tree UIs in React
- Supports drag-and-drop, rename inline, create/delete operations, virtualized rendering
- Headless-friendly design: provides the logic and data management, you control the rendering (integrates naturally with TailwindCSS)
- Keyboard navigation built in (accessibility)
- Tree data structure maps directly to file system hierarchy
- ~50KB gzipped, small footprint
- Used by notable projects; actively maintained

**Why NOT custom implementation with raw `<ul>/<li>`:**
- File tree interactions (expand/collapse, drag-drop reorder, inline rename, keyboard nav, virtualization for large trees) are deceptively complex
- react-arborist handles all edge cases that would take weeks to implement correctly

**Why NOT `rc-tree` (Ant Design):**
- Brings Ant Design styling assumptions that conflict with TailwindCSS approach
- Heavier dependency chain
- Less customizable rendering

**Why NOT `react-complex-tree`:**
- Also a good option (more flexible data model), but react-arborist has better out-of-box file-browser semantics
- react-complex-tree would be the fallback if react-arborist doesn't meet a specific requirement

**Integration pattern:**
```tsx
import { Tree } from 'react-arborist';

const fileTreeData = [
  { id: '1', name: 'src', children: [
    { id: '2', name: 'App.tsx' },
    { id: '3', name: 'main.tsx' },
  ]},
  { id: '4', name: 'package.json' },
];

<Tree
  data={fileTreeData}
  width={300}
  height={600}
  indent={24}
  rowHeight={32}
  onSelect={(nodes) => handleFileSelect(nodes)}
  onRename={({ id, name }) => handleRename(id, name)}
  onDelete={({ ids }) => handleDelete(ids)}
>
  {({ node, style, dragHandle }) => (
    <div style={style} ref={dragHandle} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-100 rounded cursor-pointer">
      <span>{node.isLeaf ? '📄' : node.isOpen ? '📂' : '📁'}</span>
      <span className="text-sm truncate">{node.data.name}</span>
    </div>
  )}
</Tree>
```

### Supplementary: File icons

| Package | Purpose |
|---------|---------|
| `react-icons` | General icon library (likely already in project or easily added) |
| `file-icons-js` or `material-icon-theme` mappings | Map file extensions to appropriate icons (VS Code-style) |

**Confidence:** MEDIUM (icon package choice is cosmetic and flexible)

---

## 4. GitHub Integration

### 4a. Frontend: `octokit` (REST) + `@octokit/webhooks-types` (types)

| Attribute | Detail |
|-----------|--------|
| **Package** | `octokit` (unified SDK) |
| **Version (verify)** | ~4.x or ~3.x (check npm for latest) |
| **Confidence** | HIGH |

**Why Octokit:**
- Official GitHub SDK, maintained by GitHub themselves
- Covers REST API, GraphQL, webhooks, OAuth, and App authentication
- Full TypeScript types included
- Pagination helpers, rate limit handling, retry logic built in
- The unified `octokit` package bundles `@octokit/rest`, `@octokit/graphql`, and `@octokit/auth-*`

**Why NOT raw `fetch` to GitHub API:**
- GitHub's API has complex pagination (Link headers), rate limiting, and authentication flows
- Octokit handles all of this transparently
- Type safety for API responses saves significant development time

### 4b. Backend: `PyGithub` or `githubkit`

| Attribute | Detail |
|-----------|--------|
| **Package** | `PyGithub` |
| **Version (verify)** | ~2.x (check PyPI for latest) |
| **Alternative** | `githubkit` (async-first, newer) |
| **Confidence** | HIGH for PyGithub, MEDIUM for githubkit |

**Why PyGithub (primary recommendation):**
- Most established Python GitHub library (10K+ GitHub stars)
- Comprehensive API coverage
- Well-documented, large community
- Stable API

**Why githubkit (alternative):**
- Async-first design that pairs naturally with FastAPI's async endpoints
- Auto-generated from GitHub's OpenAPI spec, so always up to date
- If the team prefers async patterns, this is the better choice
- Newer, smaller community

**Recommended approach -- Backend-proxied GitHub access:**

GitHub tokens should NEVER be exposed to the frontend. The architecture should be:

```
Frontend (React) --> Backend (FastAPI) --> GitHub API (via PyGithub/githubkit)
```

The backend stores GitHub OAuth tokens (in Supabase, encrypted) and proxies all GitHub operations. This is critical for security.

### 4c. GitHub OAuth Flow

| Component | Recommendation |
|-----------|---------------|
| **OAuth App type** | GitHub App (not OAuth App) -- more granular permissions, installation-based access |
| **Backend flow** | FastAPI endpoint initiates OAuth, GitHub redirects back, backend exchanges code for token, stores in Supabase |
| **Token storage** | Encrypted in Supabase `user_metadata` or dedicated `github_connections` table |

**Why GitHub App over OAuth App:**
- Fine-grained permissions (repo-level, not account-level)
- Installation tokens auto-expire (better security)
- Can act on behalf of the app or the user
- Supports webhooks natively
- GitHub's recommended approach for new integrations

---

## 5. File System Backend (for browsing project files)

### Recommendation: FastAPI endpoints + `aiofiles`

| Attribute | Detail |
|-----------|--------|
| **Package** | `aiofiles` |
| **Version (verify)** | ~23.x or ~24.x (check PyPI) |
| **Confidence** | HIGH |

**Why custom FastAPI endpoints (not a generic file server):**
- Need to enforce access control (users should only see their own projects)
- Need to filter dangerous files (.env, credentials, node_modules)
- Need to integrate with Supabase auth
- Need to support virtual file systems (GitHub repos, Supabase Storage, local)

**Required endpoints:**
```
GET    /api/files/tree?path=...        -- List directory tree
GET    /api/files/content?path=...     -- Read file content
PUT    /api/files/content?path=...     -- Write file content
POST   /api/files/create               -- Create file/directory
DELETE /api/files/delete?path=...      -- Delete file/directory
POST   /api/files/rename               -- Rename/move file
```

**Why `aiofiles`:**
- Async file I/O that doesn't block FastAPI's event loop
- Drop-in replacement for Python's `open()` with `async/await`
- Essential for a FastAPI backend that handles file operations alongside other async work

**Security considerations:**
- Path traversal prevention (normalize paths, reject `..`)
- Allowlist of file extensions for editing
- File size limits
- Rate limiting on file operations
- Sandboxing to project directories only

---

## 6. Supplementary Libraries

### 6a. Syntax Highlighting for Previews (non-editor contexts)

| Package | Purpose | Confidence |
|---------|---------|------------|
| `shiki` | Syntax highlighting for read-only code blocks (same engine as VS Code) | HIGH |

**Why shiki over Prism.js or highlight.js:**
- Uses VS Code's TextMate grammars -- identical highlighting to the editor
- Better accuracy for edge cases
- Supports all VS Code themes

### 6b. Diff Visualization

| Package | Purpose | Confidence |
|---------|---------|------------|
| Monaco DiffEditor (built-in) | Side-by-side and inline diff for code review | HIGH |
| `diff` (npm package) | Compute text diffs programmatically when needed outside editor | MEDIUM |

### 6c. Terminal Emulator (optional, future)

| Package | Purpose | Confidence |
|---------|---------|------------|
| `@xterm/xterm` | Web-based terminal emulator | HIGH (if needed) |

**Note:** Only relevant if the project needs an in-browser terminal. Not needed for initial file browser + editor + GitHub scope.

### 6d. Split Panes / Resizable Panels

| Package | Purpose | Confidence |
|---------|---------|------------|
| `react-resizable-panels` | Resizable panel layout (file tree | editor | preview) | HIGH |

**Why react-resizable-panels:**
- Lightweight, well-maintained
- Handles the classic IDE layout (sidebar + editor + panel) perfectly
- Works with TailwindCSS
- Keyboard accessible
- ~5KB gzipped

---

## 7. Architecture Decision: Where Code Runs

### Recommendation: Backend-centric file operations, Frontend-only editor

| Layer | Responsibility |
|-------|---------------|
| **Frontend** | Monaco editor, file tree UI, GitHub UI (PR list, diff view) |
| **Backend** | All file I/O, all GitHub API calls, auth, path validation |

**Why NOT frontend-direct GitHub API calls:**
- Exposes tokens to browser (security risk)
- CORS issues with GitHub API
- Can't enforce server-side access control
- Can't audit/log operations

**Why NOT WebContainers/StackBlitz SDK:**
- Overkill for file editing -- those are full in-browser Node.js runtimes
- Adds massive complexity and bundle size
- The project needs file browsing and editing, not code execution

---

## 8. What NOT to Use

| Technology | Why NOT |
|------------|---------|
| **Ace Editor** | Legacy, declining community, Monaco is strictly better for this use case |
| **CodeMirror 5** | Superseded by CodeMirror 6; do not use the old version |
| **Prism.js** | Adequate for blog posts, but shiki provides VS Code-quality highlighting |
| **`fs` (Node.js)** | Backend is Python/FastAPI, not Node.js |
| **GitHub REST API via raw fetch** | Octokit handles pagination, rate limits, auth, types automatically |
| **WebContainers** | Way too heavy; we need editing, not in-browser code execution |
| **Ant Design tree components** | Styling conflicts with TailwindCSS; brings unwanted CSS dependencies |
| **electron/tauri** | This is a web app, not a desktop app |
| **`simple-git` (npm)** | Git operations should happen on backend (Python), not frontend |
| **`isomorphic-git`** | Interesting but adds massive complexity for in-browser git; use GitHub API via backend instead |

---

## 9. Summary: Recommended Stack Addition

### Frontend (npm install)

```bash
npm install @monaco-editor/react react-arborist react-resizable-panels
# Types included in packages above
# Optional:
npm install shiki
```

### Backend (pip install)

```bash
pip install aiofiles PyGithub
# Or for async-first GitHub:
pip install aiofiles githubkit
```

### New Backend Files Needed

```
backend/
├── api/
│   ├── files.py              # File browser endpoints
│   └── github.py             # GitHub integration endpoints
├── services/
│   ├── file_service.py       # File I/O with path security
│   └── github_service.py     # GitHub API wrapper
├── models/
│   ├── file_models.py        # Pydantic models for file operations
│   └── github_models.py      # Pydantic models for GitHub data
└── migrations/
    └── 005_github_connections.sql  # GitHub OAuth token storage
```

### New Frontend Files Needed

```
frontend/src/
├── components/
│   ├── FileBrowser/
│   │   ├── FileTree.tsx       # react-arborist wrapper
│   │   ├── FileIcons.tsx      # Extension-to-icon mapping
│   │   └── FileBrowser.tsx    # Combined tree + actions
│   ├── CodeEditor/
│   │   ├── MonacoEditor.tsx   # Monaco wrapper with project config
│   │   ├── EditorTabs.tsx     # Multi-file tab bar
│   │   └── DiffViewer.tsx     # Monaco diff editor wrapper
│   └── GitHub/
│       ├── GitHubConnect.tsx  # OAuth connection flow
│       ├── RepoList.tsx       # Repository browser
│       ├── PRList.tsx         # Pull request list
│       └── PRReview.tsx       # PR diff review with Monaco
├── contexts/
│   └── GitHubContext.tsx      # GitHub connection state
├── pages/
│   └── IDE.tsx                # Main IDE layout (panels + tree + editor)
└── lib/
    └── githubClient.ts        # API client methods for GitHub endpoints
```

---

## 10. Confidence Summary

| Component | Library | Confidence | Risk |
|-----------|---------|------------|------|
| Code Editor | `@monaco-editor/react` | HIGH | Low -- industry standard |
| File Tree | `react-arborist` | HIGH | Low -- well-maintained, good API |
| Panel Layout | `react-resizable-panels` | HIGH | Very low -- simple, focused library |
| GitHub (Frontend types) | `octokit` (types only, calls go through backend) | HIGH | Low -- official SDK |
| GitHub (Backend) | `PyGithub` | HIGH | Low -- mature library |
| GitHub (Backend alt) | `githubkit` | MEDIUM | Medium -- newer, smaller community |
| Async File I/O | `aiofiles` | HIGH | Very low -- simple, proven |
| Syntax Highlighting | `shiki` | HIGH | Low -- VS Code engine |
| Terminal (future) | `@xterm/xterm` | HIGH (if needed) | N/A -- not in initial scope |

**Version verification note:** All version numbers listed are approximate based on knowledge through May 2025. Before adding any dependency, run `npm info <package> version` or check PyPI to confirm the latest stable release. This is especially important for `octokit` which has had major version changes.

---

## 11. Open Questions for Roadmap

1. **File storage model:** Will projects live on the server filesystem, in Supabase Storage, or in GitHub repos (cloned on demand)? This affects the file service architecture significantly.
2. **Multi-user editing:** Is real-time collaboration (Google Docs-style) needed? If so, consider `y-monaco` (Yjs + Monaco) -- adds significant complexity.
3. **GitHub scope:** Is the goal full GitHub integration (issues, PRs, actions) or just repo browsing + file editing? This affects the GitHub service size.
4. **Git operations:** Does the user need to commit/push/pull from the UI? If so, the backend needs `gitpython` or subprocess calls to `git`.
