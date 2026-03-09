# Phase 7: GitHub Integration - Research

**Researched:** 2026-03-08
**Domain:** GitHub REST API (Contents + Releases), RunPod GitHub Integration, credential security
**Confidence:** HIGH

## Summary

Phase 7 delivers the final link in the Dockerfile deployment pipeline: after the admin edits and saves a Dockerfile in the editor (Phase 6), the system commits the change to GitHub (already working), pushes it (already working -- GitHub Contents API PUT is an atomic commit+push), and then triggers a RunPod rebuild. The critical discovery is that **RunPod rebuilds are triggered by GitHub releases, not by branch pushes**. This means Phase 7 must add a "create GitHub release" step after the successful commit to trigger the RunPod build pipeline.

The existing Phase 6 implementation already satisfies several Phase 7 requirements. The `GitHubService.update_file()` method commits AND pushes to the configured branch in a single GitHub API call (GIT-01, GIT-02 partially). The 409 SHA conflict detection already handles merge conflict detection (GIT-04). The frontend already shows success/error feedback (GIT-05, GIT-06 partially). What remains is: (a) adding a `create_release()` method to GitHubService to trigger RunPod rebuilds, (b) addressing the "encrypted credentials" requirement (GIT-03), and (c) enhancing the frontend feedback to distinguish between commit success and deployment trigger success.

**Primary recommendation:** Extend the existing `save_dockerfile` endpoint to optionally create a GitHub release after a successful commit, add a `create_release()` method to `GitHubService`, and validate that the GITHUB_TOKEN PAT has Contents: Read and Write permission (which covers both file updates and release creation). For credential encryption, use environment variables stored server-side only (industry standard) -- the token is already never exposed to the frontend.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GIT-01 | System commits Dockerfile changes to GitHub repository | ALREADY IMPLEMENTED: `GitHubService.update_file()` commits via PUT /repos/{owner}/{repo}/contents/{path} -- atomic commit+push in one API call |
| GIT-02 | System pushes commit to correct branch (triggers RunPod rebuild) | PARTIALLY IMPLEMENTED: Push happens automatically via Contents API PUT. RunPod rebuild requires an ADDITIONAL step: creating a GitHub release (POST /repos/{owner}/{repo}/releases). RunPod monitors releases, not branch pushes. |
| GIT-03 | GitHub credentials stored securely (encrypted, server-side only) | PARTIALLY IMPLEMENTED: Token stored in env var, never sent to frontend. Need to verify this satisfies "encrypted" requirement -- env vars are the industry standard for secrets on Heroku/server deployments. Optional: add Fernet encryption at rest if the requirement mandates encryption beyond env var storage. |
| GIT-04 | System detects merge conflicts and aborts with error message | ALREADY IMPLEMENTED: GitHub API returns 409 when SHA doesn't match HEAD. Backend catches this and returns actionable error: "SHA conflict: the file was modified since you opened it." Frontend preserves dirty state on 409. |
| GIT-05 | Admin receives confirmation when push succeeds | PARTIALLY IMPLEMENTED: Frontend shows "Committed successfully (abc1234)" on save. Need to add release creation confirmation (e.g., "Committed and deployment triggered"). |
| GIT-06 | System provides meaningful error message if push fails | PARTIALLY IMPLEMENTED: Backend returns specific error messages for 409, 401, 404, and generic errors. Need to add release-creation error handling as a separate failure mode. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | already installed | Async HTTP client for GitHub API calls (Contents + Releases) | Already in use for GitHubService; async-first; FastAPI-aligned |
| GitHub REST API | v2022-11-28 | Contents API (commit+push) + Releases API (trigger RunPod) | Official, well-documented, stateless -- no git binary needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cryptography (Fernet) | pip install cryptography | Symmetric encryption for credential at-rest encryption | ONLY if "encrypted credentials" requirement mandates encryption beyond environment variables |
| base64 (stdlib) | Python stdlib | Encode file content for GitHub PUT | Already in use in GitHubService |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| GitHub Releases API for triggering RunPod | GitHub Actions workflow_dispatch | Releases API is simpler and matches RunPod's native integration; workflow_dispatch adds CI/CD complexity |
| Environment variable storage for GITHUB_TOKEN | Fernet encryption at rest | Env vars are the industry standard on Heroku and in 12-factor apps; Fernet adds complexity but provides encryption-at-rest for the token value |
| GitHub Contents API for commit+push | Git binary (clone, commit, push) | Contents API is stateless, works on Heroku (no git binary guarantee), and already implemented |

**Installation:**
```bash
# Only if Fernet encryption is needed:
pip install cryptography
```

---

## Architecture Patterns

### Recommended Project Structure

No new files needed -- extend existing:

```
backend/
├── services/
│   └── github_service.py        # ADD: create_release() method
├── api/
│   └── infrastructure.py        # MODIFY: save_dockerfile() to optionally trigger release
├── config/
│   └── settings.py              # No changes needed (GITHUB_TOKEN already exists)
└── models/
    └── infrastructure.py        # ADD: DockerfileSaveResponse model (optional)

frontend/src/
├── components/
│   └── DockerfileEditor.tsx     # MODIFY: add "deploy" toggle/button, show release status
└── lib/
    └── apiClient.ts             # MODIFY: update saveDockerfile() response handling
```

### Pattern 1: GitHub Release Creation (Trigger RunPod Rebuild)

**What:** After a successful Dockerfile commit, create a GitHub release to trigger RunPod's automated build pipeline.
**When to use:** Every time the admin saves and wants to deploy the Dockerfile change.

```python
# Source: GitHub REST API docs (https://docs.github.com/en/rest/releases/releases)
import httpx
from datetime import datetime

class GitHubService:
    # ... existing __init__, get_file, update_file ...

    async def create_release(
        self,
        tag_name: str,
        target_commitish: str,
        name: str,
        body: str = "",
    ) -> dict:
        """
        Create a GitHub release to trigger RunPod rebuild.

        RunPod monitors GitHub releases (not branch pushes) to trigger
        automated Docker image builds.

        Args:
            tag_name: Unique tag for this release (e.g., "deploy-20260308-143022")
            target_commitish: Branch or commit SHA to tag
            name: Human-readable release name
            body: Release description (optional)

        Returns:
            Full GitHub API response JSON (contains id, tag_name, html_url, ...)

        Raises:
            httpx.HTTPStatusError: If GitHub returns 4xx/5xx (e.g., 422 if tag exists)
        """
        url = f"https://api.github.com/repos/{self.repo}/releases"
        payload = {
            "tag_name": tag_name,
            "target_commitish": target_commitish,
            "name": name,
            "body": body,
            "draft": False,
            "prerelease": False,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=payload,
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()
```

### Pattern 2: Save + Deploy Endpoint Flow

**What:** Extend the existing save_dockerfile endpoint to optionally trigger a release after commit.
**When to use:** When admin wants to both commit AND deploy (trigger RunPod rebuild).

```python
# Extended save flow in backend/api/infrastructure.py
@router.put("/dockerfiles/content")
async def save_dockerfile(
    payload: DockerfileSaveRequest,
    admin_user: dict = Depends(verify_admin),
) -> dict:
    # ... existing validation and credential checks ...
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        result = await service.update_file(
            settings.GITHUB_DOCKERFILE_PATH,
            payload.content,
            payload.sha,
            payload.commit_message.strip(),
        )
        commit_sha = result["commit"]["sha"]

        # Optionally create release to trigger RunPod rebuild
        release_info = None
        if payload.trigger_deploy:
            timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            tag_name = f"deploy-{timestamp}"
            try:
                release_result = await service.create_release(
                    tag_name=tag_name,
                    target_commitish=commit_sha,
                    name=f"Deploy {timestamp}",
                    body=payload.commit_message.strip(),
                )
                release_info = {
                    "tag_name": release_result["tag_name"],
                    "html_url": release_result.get("html_url", ""),
                }
            except httpx.HTTPStatusError as e:
                # Release creation failed but commit succeeded
                return {
                    "success": True,
                    "commit_sha": commit_sha,
                    "deploy_triggered": False,
                    "deploy_error": f"Commit succeeded but release creation failed: {e.response.text}",
                }

        return {
            "success": True,
            "commit_sha": commit_sha,
            "deploy_triggered": payload.trigger_deploy,
            "release": release_info,
        }
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status == 409:
            raise HTTPException(
                status_code=409,
                detail="SHA conflict: the file was modified since you opened it. Reload and re-apply your changes.",
            )
        raise HTTPException(status_code=status, detail=f"GitHub API error: {e.response.text}")
```

### Pattern 3: Credential Security (Server-Side Only)

**What:** GITHUB_TOKEN is stored as an environment variable, never exposed to the frontend.
**When to use:** Always -- this is the existing pattern and satisfies "server-side only" security.

The current implementation already enforces this:
1. `settings.GITHUB_TOKEN` is read from the `.env` file / environment variable
2. The `GitHubService` is instantiated server-side only in `infrastructure.py` API handlers
3. The frontend calls `/api/infrastructure/dockerfiles/content` -- it never knows the GitHub token
4. The `GITHUB_DOCKERFILE_PATH` is also server-side only -- the frontend cannot inject a different file path

**For "encrypted" storage (if required beyond env vars):**
```python
# Using Fernet symmetric encryption
from cryptography.fernet import Fernet

# Generate key once, store as GITHUB_ENCRYPTION_KEY env var
# key = Fernet.generate_key()  # Run once, store result

class EncryptedSettings:
    """Decrypt GITHUB_TOKEN at runtime from encrypted value."""
    @staticmethod
    def decrypt_token(encrypted_token: str, encryption_key: str) -> str:
        f = Fernet(encryption_key.encode())
        return f.decrypt(encrypted_token.encode()).decode()
```

**Recommendation:** Environment variable storage (current approach) is the industry standard for secrets in server-side applications on platforms like Heroku, AWS, and Railway. Adding Fernet encryption on top adds complexity without meaningful security gain in this context -- the env var is already protected by the OS and deployment platform. The "encrypted, server-side only" requirement is satisfied by: (a) never sending the token to the frontend (server-side only), and (b) relying on the deployment platform's secret management (encrypted at rest on Heroku/AWS). If the user explicitly requires application-level encryption, Fernet is a simple add-on.

### Anti-Patterns to Avoid

- **Creating a release on every save:** Admin may want to save a draft Dockerfile without triggering a RunPod rebuild. Make deployment an explicit action (toggle or separate button), not automatic on every commit.
- **Blocking save on release failure:** If the commit succeeds but the release creation fails, the commit is already pushed. Report the partial success clearly -- do not roll back the commit (impossible with GitHub Contents API).
- **Using `git` binary for push:** The GitHub REST API already handles commit+push atomically. Do not add gitpython or subprocess git calls.
- **Exposing release URL or GitHub details to non-admin users:** All infrastructure endpoints are admin-only via `Depends(verify_admin)`.
- **Reusing release tags:** GitHub release tags must be unique. Use timestamp-based tags like `deploy-20260308-143022` to avoid 422 "Validation Failed" errors.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Commit + push to GitHub | Git binary clone/commit/push | GitHub Contents API PUT (already implemented) | Stateless, no disk needed, works on Heroku, atomic operation |
| Trigger RunPod rebuild | Custom webhook or RunPod API call | GitHub Releases API (POST /repos/{owner}/{repo}/releases) | RunPod natively monitors GitHub releases -- this is their documented integration path |
| Merge conflict detection | Custom file locking or diffing | GitHub's built-in SHA comparison (409 on stale SHA) | Already implemented, covers all concurrent-edit scenarios |
| Credential encryption | Custom AES/RSA implementation | Environment variables (standard) or `cryptography.fernet` (if required) | Env vars are the 12-factor app standard; Fernet is battle-tested symmetric encryption |
| Unique deployment tags | Manual versioning or auto-increment | UTC timestamp tags (`deploy-YYYYMMDD-HHMMSS`) | No database needed, naturally unique, sortable, human-readable |

**Key insight:** Phase 7 is primarily about wiring together existing capabilities (Phase 6 commit) with one new API call (GitHub Releases). The majority of the work is already done.

---

## Common Pitfalls

### Pitfall 1: Duplicate Release Tags (422 Error)

**What goes wrong:** GitHub returns 422 "Validation Failed" when creating a release with a tag that already exists.
**Why it happens:** If the admin triggers deploy twice within the same second, or if a previous deploy created the same tag.
**How to avoid:** Include milliseconds or a short random suffix in the tag: `deploy-20260308-143022-abc`. Or catch 422 and retry with a new tag.
**Warning signs:** HTTP 422 with "Validation Failed" in the response body.

### Pitfall 2: Commit Succeeds but Release Fails (Partial Success)

**What goes wrong:** The Dockerfile is committed and pushed to GitHub, but the release creation fails (network error, permission issue, etc.).
**Why it happens:** Commit and release are two separate API calls -- the second can fail independently.
**How to avoid:** Report partial success clearly to the admin: "Dockerfile committed successfully. Deployment trigger failed: [error]. You can manually create a release on GitHub." Do NOT roll back the commit.
**Warning signs:** Admin sees "success" but RunPod never rebuilds.

### Pitfall 3: PAT Missing Release Permission

**What goes wrong:** 403 or 404 from GitHub when creating a release.
**Why it happens:** Fine-grained PAT does not have Contents: Read and Write permission, or the token scope is wrong.
**How to avoid:** Fine-grained PAT with Contents: Read and Write on the specific repo covers BOTH file updates AND release creation. No separate "Releases" permission exists in fine-grained PATs -- Contents: Read and Write is sufficient.
**Warning signs:** HTTP 403 on POST /repos/{owner}/{repo}/releases.

### Pitfall 4: RunPod Does Not Rebuild After Release

**What goes wrong:** Release is created on GitHub but RunPod does not start a build.
**Why it happens:** RunPod GitHub integration may not be connected, or the endpoint is not configured to use the GitHub repo. This is a RunPod-side configuration issue, not a code issue.
**How to avoid:** Document the prerequisite: RunPod endpoint must be connected to the GitHub repo via RunPod's GitHub integration settings. The app cannot verify this programmatically.
**Warning signs:** Release appears on GitHub but RunPod endpoint shows no new build.

### Pitfall 5: Treating Env Vars as "Not Encrypted"

**What goes wrong:** Over-engineering credential storage with Fernet encryption when env vars are already the industry standard.
**Why it happens:** Misinterpreting "encrypted, server-side only" as requiring application-level encryption rather than platform-level security.
**How to avoid:** Clarify the requirement. On Heroku, config vars are encrypted at rest. On AWS, environment variables in ECS/Lambda are encrypted via KMS. The "server-side only" part is already enforced (token never sent to frontend). Application-level Fernet encryption is only needed if credentials are stored in a database or file that could be accessed separately from the running process.
**Warning signs:** Adding unnecessary encryption complexity that doesn't improve security posture.

---

## Code Examples

Verified patterns from official sources:

### GitHub Releases API -- Create Release

```python
# Source: https://docs.github.com/en/rest/releases/releases
# POST /repos/{owner}/{repo}/releases
# Required permission: Contents: Read and Write (fine-grained PAT)

async def create_release(self, tag_name: str, target_commitish: str, name: str, body: str = "") -> dict:
    url = f"https://api.github.com/repos/{self.repo}/releases"
    payload = {
        "tag_name": tag_name,
        "target_commitish": target_commitish,  # branch name or commit SHA
        "name": name,
        "body": body,
        "draft": False,
        "prerelease": False,
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            json=payload,
            headers=self.headers,
        )
        response.raise_for_status()
        return response.json()
        # Response includes: {"id": 123, "tag_name": "...", "html_url": "...", ...}
```

### Extended DockerfileSaveRequest Model

```python
# Add trigger_deploy field to existing model
class DockerfileSaveRequest(BaseModel):
    content: str
    sha: str
    commit_message: str
    trigger_deploy: bool = False  # When True, creates a GitHub release after commit
```

### Frontend Deploy Toggle

```typescript
// Add deploy checkbox to DockerfileEditor save section
const [triggerDeploy, setTriggerDeploy] = useState<boolean>(false);

// In save handler:
const result = await apiClient.saveDockerfile(content, sha, commitMessage.trim(), triggerDeploy);

if (result.deploy_triggered && result.release) {
  setSaveStatus(`Committed (${result.commit_sha.slice(0, 7)}) and deployment triggered (${result.release.tag_name})`);
} else if (result.deploy_triggered && result.deploy_error) {
  setSaveStatus(`Committed (${result.commit_sha.slice(0, 7)}) but deploy failed: ${result.deploy_error}`);
} else {
  setSaveStatus(`Committed successfully (${result.commit_sha.slice(0, 7)})`);
}
```

### Updated apiClient Method

```typescript
// Update saveDockerfile to support trigger_deploy flag
async saveDockerfile(
  content: string,
  sha: string,
  commitMessage: string,
  triggerDeploy: boolean = false
): Promise<{
  success: boolean;
  commit_sha: string;
  deploy_triggered: boolean;
  release?: { tag_name: string; html_url: string };
  deploy_error?: string;
}> {
  return this.request('/infrastructure/dockerfiles/content', {
    method: 'PUT',
    body: JSON.stringify({
      content,
      sha,
      commit_message: commitMessage,
      trigger_deploy: triggerDeploy,
    }),
  })
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Git binary clone+commit+push on server | GitHub Contents API PUT (atomic commit+push) | Always available | No git binary needed; stateless; works on Heroku |
| Manual Docker Hub push + RunPod update | RunPod GitHub Integration (release-triggered builds) | 2024 GA | One-click deployment pipeline; no manual Docker builds |
| Classic PAT with `repo` scope | Fine-grained PAT with Contents: Read+Write | 2022 | Minimal permissions; single-repo scope; covers files + releases |

**Deprecated/outdated:**
- Assumption that branch pushes trigger RunPod rebuilds: **False.** Only GitHub releases trigger RunPod builds. This is explicitly stated in RunPod documentation.
- Separate "Releases" permission for fine-grained PATs: **Does not exist.** Contents: Read and Write covers release creation.

---

## Open Questions

1. **Does the user's RunPod endpoint use GitHub integration?**
   - What we know: RunPod supports connecting a GitHub repo to a serverless endpoint, with releases triggering automated builds.
   - What's unclear: Whether the user has already configured this connection in RunPod's dashboard.
   - Recommendation: Document this as a prerequisite in the plan. The app can create releases, but RunPod-side configuration is out of scope for this phase. Include setup instructions.

2. **Should "encrypted credentials" (GIT-03) require Fernet encryption or are env vars sufficient?**
   - What we know: The GITHUB_TOKEN is stored as an env var in `.env` / Heroku config vars, never exposed to the frontend. Heroku encrypts config vars at rest. This is the industry standard approach.
   - What's unclear: Whether the requirement literally demands application-level encryption (Fernet) or accepts platform-level encryption (env vars).
   - Recommendation: Treat env vars as satisfying the requirement. The token is already (a) server-side only, (b) never in source code, (c) never sent to the frontend. Add a note in the plan that Fernet can be layered on if the requirement is interpreted more strictly. **Do not add Fernet by default** -- it adds complexity without meaningful security improvement for env-var-stored secrets.

3. **Should every save trigger a deploy, or should it be an explicit separate action?**
   - What we know: The admin may want to iterate on Dockerfile changes without triggering a RunPod rebuild every time.
   - What's unclear: User preference.
   - Recommendation: Make deployment an explicit action via a `trigger_deploy` toggle/checkbox. Default to false. This gives the admin control over when to trigger a potentially expensive rebuild.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio |
| Config file | backend/tests/conftest.py |
| Quick run command | `cd backend && pytest tests/test_github_service.py -x` |
| Full suite command | `cd backend && pytest` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GIT-01 | update_file commits to GitHub | unit | `pytest tests/test_github_service.py::TestGitHubServiceUpdateFile -x` | Exists |
| GIT-02 | create_release triggers RunPod rebuild | unit | `pytest tests/test_github_service.py::TestGitHubServiceCreateRelease -x` | Wave 0 |
| GIT-03 | Credentials server-side only, never exposed | unit | `pytest tests/test_github_service.py::TestSettingsGitHubFields -x` | Exists |
| GIT-04 | 409 SHA conflict detected and reported | unit | `pytest tests/test_github_service.py::TestGitHubServiceUpdateFile::test_update_file_calls_raise_for_status -x` | Exists |
| GIT-05 | Success confirmation returned | unit | `pytest tests/test_github_service.py::TestGitHubServiceCreateRelease -x` | Wave 0 |
| GIT-06 | Meaningful error on failure | unit | `pytest tests/test_github_service.py::TestGitHubServiceCreateRelease -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && pytest tests/test_github_service.py -x`
- **Per wave merge:** `cd backend && pytest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_github_service.py::TestGitHubServiceCreateRelease` -- tests for new create_release() method (GIT-02, GIT-05, GIT-06)
- [ ] Test for 422 duplicate tag error handling
- [ ] Test for partial success scenario (commit OK, release fails)

---

## Sources

### Primary (HIGH confidence)
- GitHub REST API -- Releases: https://docs.github.com/en/rest/releases/releases -- POST /repos/{owner}/{repo}/releases endpoint, parameters, permissions
- GitHub REST API -- Contents: https://docs.github.com/en/rest/repos/contents -- PUT is atomic commit+push, 409 on SHA mismatch
- RunPod Documentation -- GitHub Integration: https://docs.runpod.io/serverless/workers/github-integration -- "Create a new release for the GitHub repository" triggers rebuild; pushes do NOT trigger rebuilds
- Existing codebase: `backend/services/github_service.py`, `backend/api/infrastructure.py`, `frontend/src/components/DockerfileEditor.tsx` -- confirmed current implementation

### Secondary (MEDIUM confidence)
- GitHub Docs -- Fine-grained PAT permissions: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens -- Contents: Read and Write covers release creation (no separate Releases permission)
- RunPod CI/CD guide: https://www.runpod.io/articles/guides/integrating-runpod-with-ci-cd-pipelines -- Confirms release-based deployment model
- Cryptography Fernet docs: https://cryptography.io/en/latest/fernet/ -- AES-CBC-128 + HMAC symmetric encryption for at-rest credential protection

### Tertiary (LOW confidence)
- None -- all findings verified against primary or secondary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in use (httpx); GitHub API well-documented; no new dependencies unless Fernet is needed
- Architecture: HIGH -- Extending existing GitHubService with one new method; existing endpoint pattern; existing test patterns
- Pitfalls: HIGH -- All pitfalls verified against GitHub API docs (409, 422) and RunPod docs (release trigger mechanism)
- RunPod trigger mechanism: HIGH -- Explicitly confirmed in RunPod documentation that releases (not pushes) trigger rebuilds

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (GitHub API and RunPod integration are stable; 30-day window appropriate)
