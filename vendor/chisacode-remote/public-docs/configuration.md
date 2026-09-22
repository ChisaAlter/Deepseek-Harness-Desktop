---
title: Configuration
description: Configure ChisaCode via config.json, environment variables, and CLI overrides.
nav: Configuration
order: 10
---

# Configuration

ChisaCode loads configuration from a single JSON file in your ChisaCode home directory, with optional environment variable and CLI overrides.

## Where config lives

By default, ChisaCode uses `~/.chisacode` as its home directory. The configuration file is:

```bash
~/.chisacode/config.json
```

You can change the home directory by setting `CHISACODE_HOME` or passing `--home` to `chisacode daemon start`.

## Precedence

ChisaCode merges configuration in this order:

1. Defaults
2. `config.json`
3. Environment variables
4. CLI flags

Lists append across sources (for example, `hostnames` and `cors.allowedOrigins`).

## Example

Minimal example that configures listening address, hostnames, and MCP:

```json
{
  "$schema": "https://chisacode.sh/schemas/chisacode.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6767",
    "hostnames": ["localhost", ".localhost"],
    "mcp": { "enabled": true }
  }
}
```

`daemon.hostnames` is the primary field. The old `daemon.allowedHosts` name still works as a deprecated alias for backward compatibility.

## Agent providers

Agent providers, both the first-class ones ChisaCode ships with and custom entries you add under `agents.providers`, are documented on their own page.

See [Providers](/docs/providers) for the mental model and [Supported providers](/docs/supported-providers) for the full list of agents ChisaCode can launch. For pointing Claude at Anthropic-compatible endpoints (Z.AI, Alibaba/Qwen), multiple profiles, custom binaries, ACP agents, and the `additionalModels` merge behavior, see [Custom providers](/docs/custom-providers). The full field reference lives on GitHub at [docs/custom-providers.md](https://github.com/ChisaAlter/ChisaCode/blob/main/docs/custom-providers.md).

## Voice

Voice is configured through `features.dictation` and `features.voiceMode`, with provider credentials under `providers`.

For voice philosophy, architecture, and complete local/OpenAI setup examples, see [Voice docs](/docs/voice).

## Logging

Daemon logging uses separate console and file sinks by default:

- Console: `info` and above
- File (`$CHISACODE_HOME/daemon.log`): `trace` and above
- File rotation: `10m` max file size, `2` retained files total (active + 1 rotated)

```json
{
  "log": {
    "console": {
      "level": "info",
      "format": "pretty"
    },
    "file": {
      "level": "trace",
      "path": "daemon.log",
      "rotate": {
        "maxSize": "10m",
        "maxFiles": 2
      }
    }
  }
}
```

Legacy fields `log.level` and `log.format` are still supported and map to the new destination settings.

## Password authentication

You can require a password to connect to the daemon. When set, all HTTP and WebSocket clients must authenticate. Only the `/api/health` liveness endpoint is exempt, so that process supervisors and load balancers can probe without credentials.

The easiest way to set a password is with the CLI:

```bash
chisacode daemon set-password
```

This prompts for a password, writes the bcrypt hash to `config.json`, and tells you to restart the daemon.

Alternatively, set the `CHISACODE_PASSWORD` environment variable (plaintext, hashed automatically at startup):

```bash
CHISACODE_PASSWORD=my-secret chisacode daemon start
```

Or write the hash directly in `config.json`:

```json
{
  "daemon": {
    "auth": {
      "password": "$2b$12$..."
    }
  }
}
```

After setting a password, restart the daemon for the change to take effect.

### Connecting with a password

The CLI picks up a password from, in order:

1. The `password` query parameter on a `tcp://` host URI:

   ```bash
   chisacode --host "tcp://192.168.1.10:6767?password=my-secret" ls
   ```

2. The `CHISACODE_PASSWORD` environment variable, used as a fallback when the host carries no embedded password (works for `localhost:6767`, bare `host:port`, or `tcp://` hosts without a `password=` query):

   ```bash
   CHISACODE_PASSWORD=my-secret chisacode ls
   CHISACODE_PASSWORD=my-secret chisacode --host 192.168.1.10:6767 ls
   ```

A `password=` in the URI always wins over the env var, so you can keep `CHISACODE_PASSWORD` set globally and still target a different daemon by spelling its password into the URI.

In the mobile app, enter the password in the direct connection setup screen.

## Common env vars

- `CHISACODE_HOME`, set ChisaCode home directory
- `CHISACODE_PASSWORD`, on the daemon, the password to require (plaintext, hashed at startup); on the CLI, the password used to connect when the host URI doesn't include one
- `CHISACODE_LISTEN`, override `daemon.listen`
- `CHISACODE_HOSTNAMES`, override/extend `daemon.hostnames`
- `CHISACODE_ALLOWED_HOSTS`, deprecated alias for `CHISACODE_HOSTNAMES`
- `CHISACODE_LOG_CONSOLE_LEVEL`, override `log.console.level`
- `CHISACODE_LOG_FILE_LEVEL`, override `log.file.level`
- `CHISACODE_LOG_FILE_PATH`, override `log.file.path`
- `CHISACODE_LOG_FILE_ROTATE_SIZE`, override `log.file.rotate.maxSize`
- `CHISACODE_LOG_FILE_ROTATE_COUNT`, override `log.file.rotate.maxFiles`
- `CHISACODE_LOG`, `CHISACODE_LOG_FORMAT`, legacy log overrides (still supported)
- `OPENAI_API_KEY`, override OpenAI provider key
- `CHISACODE_VOICE_LLM_PROVIDER`, override voice LLM provider (`claude`, `codex`, `opencode`)
- `CHISACODE_DICTATION_STT_PROVIDER`, `CHISACODE_VOICE_STT_PROVIDER`, `CHISACODE_VOICE_TTS_PROVIDER`, override voice provider selection (`local` or `openai`)
- `CHISACODE_LOCAL_MODELS_DIR`, control local model directory
- `CHISACODE_DICTATION_LOCAL_STT_MODEL`, override local dictation STT model
- `CHISACODE_VOICE_LOCAL_STT_MODEL`, `CHISACODE_VOICE_LOCAL_TTS_MODEL`, override local voice STT/TTS models
- `CHISACODE_DICTATION_LANGUAGE`, `CHISACODE_VOICE_LANGUAGE`, override dictation and voice STT language
- `CHISACODE_VOICE_LOCAL_TTS_SPEAKER_ID`, `CHISACODE_VOICE_LOCAL_TTS_SPEED`, optional local voice TTS tuning

## Schema

For editor autocomplete/validation, set `$schema` to:

```
https://chisacode.sh/schemas/chisacode.config.v1.json
```
