# Automation, retained scripts and setting documents

Automation produces reviewable catalog changes. It never renames or overwrites original files, source aliases or historical version names. Offline metadata rules, structured script extraction and metadata-based documents work without accounts or network access.

## Providers and configuration

The built-in **Metadata rules** provider reads the existing filename and declared generation prompt/model/source. It uses a fixed vocabulary and a normalized name stem. It does not inspect image pixels and is explicitly labelled rules.

A real OpenAI-compatible chat-completions adapter is available through server environment variables:

| Variable                                                | Meaning                                            |
| ------------------------------------------------------- | -------------------------------------------------- |
| `CURA_VISION_URL`                                       | Full HTTP(S) chat-completions endpoint             |
| `CURA_VISION_MODEL`                                     | Provider model identifier                          |
| `CURA_VISION_API_KEY`                                   | Optional bearer credential, server only            |
| `CURA_VISION_MODE`                                      | `json` (default) or explicit `caption`             |
| `CURA_TEXT_URL`, `CURA_TEXT_MODEL`, `CURA_TEXT_API_KEY` | Optional text model endpoint for script extraction |

Provider readiness and mode are public. Endpoint URLs and credentials are not returned by the API, written to proposal history, or included in neutral/cloud exports. Successful provenance retains the model identifier and actual response text. Configuring an endpoint does not itself send images; users select it when starting analysis.

JSON mode requires actual JSON containing `tags` (at most 20 strings), `name` (a filename stem), and optional `caption`. Malformed, empty, oversized or truncated output fails explicitly. Caption mode requests a short image description and retains it verbatim. `caption-vocabulary-v1` derives conservative object/color/style tags from known words, and a deterministic word filter derives the display-name stem. These fields are labelled derivations; they are not presented as JSON emitted by the model. There is no fallback from failed JSON to caption mode.

The text provider accepts numbered retained source lines and returns strict character/prop/scene entries with ranges. Source ranges are checked, excerpts are derived locally, and an edited script revision cannot be overwritten by a late analysis result.

## Bounds and lifecycle

- At most two analysis/archive/script-analysis jobs run at once. Each image analysis accepts at most 100 asset IDs. Additional jobs return `AUTOMATION_BUSY`; they are not silently dropped.
- Image preparation runs in cancellable workers. The exact immutable raster or retained version preview is rechecked for data/cache containment at execution. Bounded descriptor reads reject unstable files, and original raster/script hashes must match the retained version. Source input is at most 64 MiB and 16,777,216 pixels; the transmitted PNG is at most 512 × 512 and 1 MiB. Rich documents/models/SVG use an existing raster preview; unavailable previews produce per-asset errors.
- HTTP calls have a 30-second deadline, no redirects, a 64 KiB response cap and at most 16,000 characters of model text. Caption requests allow 96 output tokens; JSON/text requests request 512. Upstream failure bodies and credentials do not become public errors.
- Jobs preserve individual successes and safe error codes. Cancellation aborts local work and HTTP, and prevents late proposals from being stored. Closing waits for settlement. Persisted queued/running work becomes `INTERRUPTED` after restart; it is not silently retried against a remote provider.
- Retained script import/edit operations have a separate limit of two. Script parsing/image work has a 15-second worker deadline. The file byte/pixel limits protect resource use; they do not guarantee every valid file decodes.

## Review, apply and undo

Each proposal pins one source version and gives each changed field a stable ID. Users choose tags, display name, or archive changes individually. Apply and undo compare the expected source version and exact expected changed-field values inside the write transaction. A replaced version, later field edit, missing tag dependency or final-owner conflict leaves that field untouched and returns an explicit conflict.

Tags are not created during analysis. Approval reuses or creates NFC-normalized library tags and records the actual resulting tag IDs and labels. Undo changes membership only; it does not delete shared tags. An unrelated later note edit survives tag undo; a later tag membership edit conflicts. Display-name collisions receive a deterministic numeric suffix. Current display names never determine a historical file's extension.

Portable history includes terminal jobs, their complete proposal/change graph, exact before/after values, rules, retained scripts, documents and exact version dependencies. Active jobs, server settings, credentials and private storage/cache paths are excluded. Historical rule IDs and deleted tag IDs remain audit identities, not commands to recreate deleted objects.

## Archive rules

Rules can match minimum age in days, one exact folder, all selected tags, and maximum rating. Age is the current retained version's creation time; rebuilding a preview does not make old content new. Rules skip trash, already archived assets, and assets with any active final owner—even if only a historical version is selected.

Preview and run require the expected rule revision. Execution rechecks the rule, eligibility, source version and final-owner protection in the archive transaction. Reports retain protected/skipped entries and actual archive changes. New final assignment restores archived assets through the catalog guard. The rule's name, filters and revision are copied into job history before execution, so later edits/deletion do not erase its rationale.

Enabled rules run at startup and every 60 seconds while Cura is open. A scheduler tick with no eligible assets creates no job. Each run supports at most 10,000 candidates. Manual catalog batch archive is atomic; automated rules skip protected assets and report them. Archive is metadata only and can be restored or undone.

## Scripts and setting documents

Import accepts strict UTF-8 `.txt`, `.md`, and `.fountain` files up to 512 KiB. The original bytes are retained as an immutable asset version. The offline `structured-script-v1` parser recognizes English/Fountain scene headings and uppercase/`@` character cues, plus explicit `CHARACTER:`, `PROP:`, `SCENE:`, `人物：`, `角色：`, `道具：`, and `场景：` markers. It does not pretend to infer entities from arbitrary prose; an empty result is valid. Extracted/manual entities have stable IDs, editable names/notes and checked line ranges. Excerpts preserve the source's line endings, UTF-8 BOM and combining characters. At most 1,000 entities, 100 ranges per entity and 1 MiB of aggregate excerpts are retained.

Setting documents copy exact version hashes, generation metadata, generation-time catalog notes/tags and selected script references into an editable Markdown document. Missing values are labelled “Not provided” / “未提供”. Deterministic generation makes no model call. Manual Markdown edits use a revision check; stale edits return 409. Exports provide Markdown or complete structured JSON. Later metadata edits or replacements do not rewrite the document's saved provenance.

## Genuine model verification and limits

A real CPU `HuggingFaceTB/SmolVLM-256M-Instruct` at Apache-2.0 revision `7e3e67edbbed1bf9888184d9df282b700a323964` ran against an original synthetic house image. No user files, hosted credentials or mock inference were used. Weights were pinned and checksummed; `trust_remote_code=False` and offline local model loading were used. The Python model environment and weights remain outside Cura's runtime dependencies.

The production service sent normalized image bytes, retained the actual caption, created proposals, selectively applied/undid catalog values and verified that the retained PNG hash was unchanged. Raw output was:

> The main object is a red house with a dark brown door. The sun is in the upper right.

The caption response produced derived tags `brown`, `door`, `house`, `red`, `sun`. Genuine strict JSON mode returned prose with contradictory roof colors and an invented chimney. The adapter correctly returned `PROVIDER_INVALID_OUTPUT`; that response was not rescued or represented as successful JSON. Earlier compact tag/name prompt failures are retained too. This verifies actual transport/inference and review semantics, not general model accuracy, Chinese-language quality, OCR or reliable structured generation.

Evidence: [caption service roundtrip](evidence/v0.3.0/vision/caption-service.json), [actual JSON rejection](evidence/v0.3.0/vision/strict-json-rejection.json), [model hashes](evidence/v0.3.0/vision/model-inventory.json), [tooling licenses](evidence/v0.3.0/vision/tooling-licenses.json), and the [reproduction harness](../scripts/dev/vision-model/README.md). The endpoint was stopped after verification.
