# @chisacode/cli

ChisaCode CLI — control your AI coding agents from the command line.

## Usage

```bash
# List all agents
chisacode ls -a -g

# Check daemon status
chisacode daemon status

# Run an agent
chisacode run --provider claude --cwd /path/to/project

# View agent logs
chisacode logs <agent-id>

# Wait for agent to finish
chisacode wait <agent-id>
```

## Build

```bash
npm run build
```

## Typecheck

```bash
npm run typecheck
```

## Test

```bash
npm run test
```
