# Phase 5.0 — Tool-Dependency Decision Table

**Date:** 2026-09-22 · **Scope:** the exact BYOK v3 tool whitelist, decided per
`EditorFunctions/index.js` registries (`editorFunctions` :9029-9076,
`editorFunctionsWithoutProject` :9078-9083) and `AIflow.md` §5.

Classification key: **(a)** pure client → admitted; **(b)** hits GDevelop
backend conditionally → admitted with the account caveat; **(c)** pure
server-side stub → excluded (Phase 7/8).

## Admitted (22 in the default set + 1 conditional)

| Tool | Class | Notes |
|---|---|---|
| `describe_instances` | a | already in v2 |
| `inspect_variables` | a | already in v2 |
| `read_scene_events` | a | already in v2 |
| `read_game_project_json` | a | already in v2 |
| `create_scene` | a | already in v2 |
| `create_or_replace_object` | b | already in v2 — see store-search decision below |
| `add_behavior` | a | already in v2 (installs extensions from local extension store) |
| `change_behavior_property` | a | already in v2 |
| `add_or_edit_variable` | a | already in v2 |
| `put_2d_instances` | a | already in v2 |
| `create_or_update_plan` | a* | already in v2 — orchestrator-owned (registry entry is a server stub) |
| `put_3d_instances` | a | new in v3 |
| `inspect_object_properties_effects` | a | new in v3 (canonical name; legacy alias excluded) |
| `change_object_properties_effects` | b | new in v3 — `new_value` naming an audio/font resource can hit `POST /resource-search` only with a logged-in account; failure output explains otherwise |
| `inspect_behavior_properties` | a | new in v3 |
| `inspect_scene_properties_layers_effects` | a | new in v3 |
| `change_scene_properties_layers_effects_groups` | a | new in v3 |
| `inspect_project_properties_resources` | a | new in v3 |
| `change_project_properties_resources` | a | new in v3 |
| `read_events_source` | a | new in v3 — the EventScript source view the v3 prompt teaches |
| `add_scene_events` | a | new in v3 — **intercepted** by `ByokExtraTools` and implemented fully client-side (5.2); the registry implementation (backend job) is never reachable from BYOK |
| `run_script` | a | new in v3 (5.3) — sandboxed `ScriptRunner`, 600-call cap; `add_scene_events`/`generate_events`/`initialize_project` stay non-scriptable (upstream `NonScriptableFunctionNames.js`) |
| `initialize_project` | a | new in v3 (5.4) — **conditional advertisement**: only added to the tools sent to the model while no project is open (with a project open the runner gate refuses it, so advertising it wastes a slot); the name stays dispatchable at all times |

Count check: 22 always-advertised + `initialize_project` (no-project turns
only) = the "default tool count ≤ 22" acceptance criterion holds for the
default set. Step 5.1's "at minimum" list enumerates 12 additions on top of
the v2 eleven = 23 names; the conditional placement of `initialize_project`
is what reconciles the two numbers (recorded in the worklog).

## Excluded (with reasons)

| Tool | Reason |
|---|---|
| `generate_events` | exact upstream alias of `add_scene_events` (index.js:9073). Not advertised (the prompt teaches one name); **still dispatchable** — `ByokExtraTools` maps it to the same local implementation, so a model reusing the hosted name succeeds |
| `create_object` | strictly less capable than the already-admitted `create_or_replace_object` (`replace_existing_object: true` covers it); one fewer billed schema |
| `inspect_object_properties` | legacy alias of `inspect_object_properties_effects` — BYOK has no old requests to honor (canonical names only) |
| `change_object_property` | legacy alias of `change_object_properties_effects` — same |
| `remove_behavior` | deprecated upstream (kept there for old requests only); `change_behavior_property` + `delete_this_behavior` covers it |
| ~~`search_object_asset_store`, `search_resource_store`~~ | **Flipped in Phase 12 (D12-1)**: now locally implemented over the auth-free public catalogs (`ByokCatalogTools`), advertised and dispatched in BYOK; the names reuse the hosted tools' so parity docs stay stable |
| `read_full_docs`, `search_docs` | permanent failure stubs (docs served server-side) → Phase 7 (search_docs/read_doc admitted there; read_full_docs stays excluded) |
| `run_explorer_agent`, `run_edit_agent`, `run_tests` | server-side sub-agent stubs → Phase 8 (run_explorer_agent admitted there; run_edit_agent/run_tests stay excluded) |
| `report_fulfilment_problem` | server telemetry — meaningless against a user endpoint |
| ~~`get_game_starter_summary`~~ | **Flipped in Phase 12 (D12-1)**: locally implemented over the public examples catalog (`ByokCatalogTools`), advertised in the no-project set; the prompt's "plan from your own knowledge" line was removed |
| `run_gameplay_test`, `change_gameplay_tests` | **Phase 6** scope (admitted there, 6.4) |

## Store-search decision (step 5.0 item 3)

`create_or_replace_object` with `description`/`asset_id` (and
`change_object_properties_effects` with an audio/font resource `new_value`)
already call the asset/resource store from a BYOK chat when a GDevelop
account is logged in (`AIflow.md` §5.4). Decision: **keep those paths
available when an account is logged in, no new settings toggle in v3.**
Rationale: the calls are opt-in by the model (only when the user asks for a
described/asset object), they fail with an explanatory message without an
account, and they never touch the generation backend (`/generation`
endpoints stay excluded — the Phase 5 parity requirement is "zero requests
to `api.gdevelop.io/generation`", which the local event-writing pipeline
guarantees). Revisit as a settings toggle if users report surprise
("Allow GDevelop account services" — noted for Phase 7).

*Last updated 2026-09-22.*
