# The assistant

`helixos-assistantd` gives HelixOS its assistant. Press **Super+Space**, click the Dynamic
Island, or type a question into Spotlight and pick "Ask Assistant".

## Where the model runs

| Mode | Uses | When |
|---|---|---|
| `auto` (default) | Claude in the cloud, or the on-device model | Claude when online with a key, otherwise on-device. If Claude can't be reached mid-request, the same request continues on the device. |
| `cloud` | Claude only | You always want the most capable model. |
| `local` | Ollama only | Nothing leaves the laptop. |

The cloud model defaults to `claude-opus-5` at `medium` effort with adaptive thinking. If
Claude declines a request, the API's server-side fallback re-runs it on Anthropic's
recommended fallback model.

The on-device model defaults to `qwen2.5:3b`, which fits in 8 GB of RAM and supports tool
calls. Embeddings for search use `nomic-embed-text`.

## Setup

### Cloud (Claude)

Get an API key from the Anthropic Console, then store it in the keyring (recommended):

```bash
secret-tool store --label="HelixOS assistant" service helixos-assistant account anthropic-api-key
# paste the key, press Enter, then Ctrl+D
systemctl --user restart helixos-assistantd
```

Two alternatives work too: set `ANTHROPIC_API_KEY` in the service environment, or point
`cloud.api_key_file` at a file with mode 0600. The key is never written to `assistant.toml`.
From milestone 3, the Settings app handles this.

### On-device (Ollama)

```bash
sudo systemctl enable --now ollama
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```

### Check it

```bash
curl -s --unix-socket $XDG_RUNTIME_DIR/helixos/assistant.sock http://localhost/v1/status | jq
```

`active` shows `cloud`, `local`, or `none`, and `online` shows whether the network check
passed.

## Configuration

`~/.config/helixos/assistant.toml` is optional. See
[`assistant.example.toml`](../services/assistantd/assistant.example.toml) for every setting
and its default. Common changes:

```toml
mode = "local"            # keep everything on the laptop
name = "Nova"             # what the assistant calls itself

[cloud]
effort = "low"            # faster and cheaper; "high" for harder questions

[privacy]
share_window_title = false
store_history = false     # conversations stay in memory only
```

## What it can do

| Area | Tools |
|---|---|
| System | `get_system_status`, `set_volume`, `set_mute`, `set_brightness`, `set_wifi`, `set_bluetooth`, `set_dark_mode`, `set_do_not_disturb`, `lock_screen`, `suspend`* |
| Apps and windows | `open_app`, `list_apps`, `list_windows`, `focus_window`, `open_url` |
| Files | `search_files`, `open_path`, `read_text_file`, `move_to_trash`* |
| Notes (`~/Notes`) | `create_note`, `append_note`, `list_notes`, `read_note` |
| Timers | `set_timer`, `cancel_timer`, `list_timers` |
| Memory | `remember`, `forget` |
| Shell | `run_shell`* (turn off with `tools.allow_shell = false`) |

\* Asks first. The Dynamic Island shows **Allow / Deny** with exactly what will run. With no
answer in 2 minutes, the action is denied.

## Privacy

Each message carries a small context block: the time, the focused app and window title (turn
off with `share_window_title`), battery level, and facts you asked it to remember. Clipboard
contents are never sent. In `local` mode, nothing leaves the laptop.

Conversations, remembered facts, and a log of every tool call live in
`~/.local/share/helixos/assistant.db`. Delete them through the API, or remove the file.

## Local API

The API is HTTP over the unix socket. Streaming endpoints use Server-Sent Events. Field names
are snake_case.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/v1/status` | | mode, active provider, availability |
| POST | `/v1/chat` | `{message, conversation_id?, context?: {app, window_title, selection}}` | SSE: `start`, `text`, `tool_call`, `tool_result`, `confirm`, `fallback`, `done`, `error` |
| POST | `/v1/confirm` | `{request_id, allow}` | `{ok}` |
| POST | `/v1/complete` | `{task, input, options?}` | `{output, provider, model}` |
| POST | `/v1/embed` | `{input: [string]}` | `{embeddings, model}` |
| GET | `/v1/events` | | SSE: `timer_started`, `timer_cancelled`, `notify`, `provider_changed` |
| GET / DELETE | `/v1/conversations[/{id}]` | | history |
| GET / DELETE | `/v1/facts[/{id}]` | | remembered facts |
| GET | `/v1/timers` | | running timers |

`task` for `/v1/complete` is one of:

- `summarize`
- `rewrite` (`options.tone`)
- `classify` (`options.labels`)
- `reply` (`options.intent`)
- `explain`
- `command` (English to a bash command)
- `extract` (`options.fields`, returns JSON)
- `title`
- `continue` (writes the next paragraph or list items)

Apps use these for their intelligent features.

```bash
S=$XDG_RUNTIME_DIR/helixos/assistant.sock
curl -sN --unix-socket $S http://localhost/v1/chat -H 'content-type: application/json' \
  -d '{"message": "remind me to stretch in 20 minutes"}'
curl -s --unix-socket $S http://localhost/v1/complete -H 'content-type: application/json' \
  -d '{"task": "command", "input": "show the 10 biggest files in Downloads"}'
```
