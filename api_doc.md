Awesome—here’s a tight, developer-ready reference to the HTTP + WebSocket API exposed by `server.py` in ComfyUI. I’m basing this on the current docs that describe the routes implemented in `server.py` and the standard client behavior, plus working examples from community posts that call these endpoints exactly as implemented. ([ComfyUI Documentation][1], [9elements][2])

---

# ComfyUI `server.py` – API Endpoint Reference

**Base URL (default):** `http://127.0.0.1:8188`
**Auth:** None by default (you should place ComfyUI behind a reverse proxy/VPN if exposed). ([Reddit][3], [Snyk Labs][4])

## WebSocket

### `GET /ws?clientId=<uuid>`

Real-time status and progress events for executions tied to your `clientId`. Messages include: `status`, `execution_start`, `executing`, `execution_cached`, `progress`, `executed`, `execution_success`, `execution_error`, `execution_interrupted`.
**Example (Python):**

```py
# ws://127.0.0.1:8188/ws?clientId=<uuid4>
```

Events and their semantics are defined by the server’s executor loop. ([ComfyUI Documentation][5])

---

## Core REST Endpoints

### `GET /`

Serves the ComfyUI web app. (Useful sanity check that the server is up.) ([ComfyUI Documentation][1])

### `GET /features`

Returns server capabilities/feature flags (used by the UI). ([ComfyUI Documentation][1])

### `GET /system_stats`

High-level system info (Python/torch versions, devices/VRAM, etc.). ([ComfyUI Documentation][1])

### `GET /embeddings`

Array of available embedding names. ([ComfyUI Documentation][1])

### `GET /extensions`

List of installed extensions that expose a `WEB_DIRECTORY`. ([ComfyUI Documentation][1])

### `GET /models`

Lists model *types* supported by the server.

### `GET /models/{folder}`

Lists models available under a specific folder/category (e.g., checkpoints, VAE, etc.). ([ComfyUI Documentation][1])

### `GET /workflow_templates`

Map of custom-node modules → template workflow JSONs. ([ComfyUI Documentation][1])

---

## Queue & Execution

### `POST /prompt`

**Purpose:** Validate a workflow JSON and enqueue it for execution.
**Body:** JSON with at least:

* `prompt`: the entire workflow graph (node dict)
* `client_id`: your UUID (to route WS updates)

**Success 200:**

```json
{
  "prompt_id": "86c6...f9a",
  "number": 3,                 // position in queue
  "node_errors": {}            // validation issues per node (if any)
}
```

**Failure 400/422:**

```json
{"error":"<reason>","node_errors":{ /* per-node validation */}}
```

(Exact shapes above reflect how `server.py` validates and enqueues prompts and what clients consume.) ([ComfyUI Documentation][1], [Medium][6])

**Minimal cURL:**

```bash
curl -X POST http://127.0.0.1:8188/prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": { /* workflow JSON */ }, "client_id": "c1a8c8b0-..." }'
```

### `GET /prompt`

Returns *current* queue + execution summary (handy for health checks/dashboards). ([ComfyUI Documentation][1])

### `GET /queue`

Returns:

```json
{
  "queue_running": [ /* currently executing prompt(s) */ ],
  "queue_pending": [ /* waiting prompt(s) */ ]
}
```

Useful to implement your own concurrency/traffic shaping. ([ComfyUI Documentation][1])

### `POST /queue`

Queue housekeeping (e.g., clear pending/running). (Use with care.) ([ComfyUI Documentation][1])

### `POST /interrupt`

Stop the currently running workflow. ([ComfyUI Documentation][1])

### `POST /free`

Ask the server to free memory by unloading specified models. ([ComfyUI Documentation][1])

---

## History & Outputs

### `GET /history`

Entire recent history of queued/executed prompts.

### `GET /history/{prompt_id}`

History for one prompt (use this to discover produced files).
Typical structure includes node outputs with file metadata such as `filename`, `subfolder`, and `type`. ([ComfyUI Documentation][1])

**Example (Python):**

```py
# GET http://127.0.0.1:8188/history/<prompt_id>
# -> parse images: history[prompt_id]["outputs"][node_id]["images"][...]
```

### `GET /view?filename=<name>&subfolder=<path>&type=<input|output|temp>`

Returns the **raw image bytes** for a file previously produced or uploaded.

* `filename`: e.g., `"00001.png"`
* `subfolder`: relative subdirectory (may be empty)
* `type`: one of `input`, `output`, or `temp`

**Example (Python):**

```py
params = {"filename": fn, "subfolder": sub, "type": "output"}
r = requests.get("http://127.0.0.1:8188/view", params=params)
open("image.png","wb").write(r.content)
```

([9elements][2], [GitHub][7])

> Tip: Call `/history/{prompt_id}` first to get each image’s `filename`, `subfolder`, and `type`. ([ComfyUI Documentation][8])

---

## Uploads & User Data

### `POST /upload/image`

Multipart-form upload; stored under ComfyUI’s `input` area so workflows can reference by filename.
**Body:** form field `image` (file).
**Response:** JSON with server-side path/filename. ([ComfyUI Documentation][1])

### `POST /upload/mask`

Multipart-form upload for masks; same semantics as images. ([ComfyUI Documentation][1])

### `GET /userdata?dir=<path>`

List user data files in a directory.

### `GET /v2/userdata?dir=<path>`

Structured listing (files + directories).

### `GET /userdata/{file}`

Fetch a specific file.

### `POST /userdata/{file}`

Create/update a file (body = file content).

### `DELETE /userdata/{file}`

Delete a specific file.

### `POST /userdata/{file}/move/{dest}`

Move/rename a user data file. ([ComfyUI Documentation][1])

---

## Introspection

### `GET /object_info`

Returns **all** node classes with their inputs/outputs/defaults/metadata—super useful to build tooling, editors, or validate programmatically.

### `GET /object_info/{node_class}`

Details for a single node class. (Used heavily by script/tooling libraries.) ([ComfyUI Documentation][1])

---

## Users (multi-user mode)

### `GET /users`

Information on current users.

### `POST /users`

Create a user (only when multi-user is enabled). ([ComfyUI Documentation][1])

---

## Practical call flow (happy path)

1. **Open WS**: `ws://…/ws?clientId=<uuid4>` to receive progress. ([ComfyUI Documentation][5])
2. **POST /prompt** with your workflow + `client_id`. Get `prompt_id`. ([Medium][6])
3. (Optional) **Poll /queue** or just rely on WS messages. ([ComfyUI Documentation][1])
4. **GET /history/{prompt\_id}** to learn produced files. ([ComfyUI Documentation][8])
5. **GET /view** with `filename`, `subfolder`, `type` to download bytes. ([9elements][2])

---

## Notes, limits & security

* **No auth by default.** If you expose ComfyUI on the internet, put it behind a VPN or a reverse proxy with authentication, and lock down the port; unauthenticated write endpoints exist. ([Reddit][3], [Snyk Labs][4])
* **Queue semantics.** Server validates, enqueues, and sends executor events over WS as it runs nodes (and uses caching where possible). ([ComfyUI Documentation][1])
* **`/view` returns raw bytes.** Expect image data; don’t parse as JSON. Use history to discover the correct path params. ([9elements][2])
* **Object catalog.** Use `/object_info` to generate forms/clients dynamically for any installed node set. ([ComfyUI Documentation][1])

---

## Quick cURL recipes

**Queue a prompt**

```bash
curl -sS -X POST http://127.0.0.1:8188/prompt \
  -H "Content-Type: application/json" \
  -d @workflow.json
```

**Get results metadata**

```bash
curl -sS "http://127.0.0.1:8188/history/<prompt_id>" | jq .
```

**Download an output image**

```bash
curl -L "http://127.0.0.1:8188/view?filename=00001.png&subfolder=&type=output" \
  --output out.png
```

([ComfyUI Documentation][8], [9elements][2])

---

### Sources

* Official ComfyUI route list describing what `server.py` exposes. ([ComfyUI Documentation][1])
* Overview of server/WS message flow used by the UI and clients. ([ComfyUI Documentation][9])
* Concrete `/view`, `/history`, and `/prompt` usage patterns (code snippets mirror `server.py` expectations). ([9elements][2], [ComfyUI Documentation][8], [Medium][6])

If you want, I can also generate a Postman collection or an OpenAPI (YAML) spec for these routes—ready to import into tooling.

[1]: https://docs.comfy.org/development/comfyui-server/comms_routes "Routes - ComfyUI"
[2]: https://9elements.com/blog/hosting-a-comfyui-workflow-via-api/?utm_source=chatgpt.com "Hosting a ComfyUI Workflow via API"
[3]: https://www.reddit.com/r/comfyui/comments/1fssnm4/psa_do_as_the_tshirt_says_if_you_run_comfyui_with/?utm_source=chatgpt.com "PSA: do as the t-shirt says. If you run ComfyUI with --listen ..."
[4]: https://labs.snyk.io/resources/hacking-comfyui-through-custom-nodes/?utm_source=chatgpt.com "Hacking ComfyUI Through Custom Nodes"
[5]: https://docs.comfy.org/development/comfyui-server/comms_messages "Messages - ComfyUI"
[6]: https://medium.com/%40next.trail.tech/how-to-use-comfyui-api-with-python-a-complete-guide-f786da157d37?utm_source=chatgpt.com "How to Use ComfyUI API with Python: A Complete Guide"
[7]: https://github.com/comfyanonymous/ComfyUI/discussions/2768?utm_source=chatgpt.com "view API endpoint takes 8 seconds and is slow? #2768"
[8]: https://docs.comfy.org/installation/desktop/windows?utm_source=chatgpt.com "Windows Desktop Version"
[9]: https://docs.comfy.org/development/comfyui-server/comms_overview "Server Overview - ComfyUI"
