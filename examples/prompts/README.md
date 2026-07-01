# try-docs / prompts

Greenfield project verifying every feature in [`docs/prompts.md`](../../docs/prompts.md)
against the published `@rekog/mcp-nest@2.0.0-alpha.1`.

## Run

```bash
npm install
PORT=3003 npm start   # stateful Streamable HTTP server on http://localhost:3003/mcp
```

## Test (MCP Inspector CLI)

```bash
URL=http://localhost:3003/mcp

# List prompts (arguments[] derived from Zod parameters)
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method prompts/list

# Basic prompt
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method prompts/get --prompt-name multilingual-greeting-guide \
  --prompt-args name=Alice --prompt-args language=es

# Message roles (assistant + user), PromptResult return type
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method prompts/get --prompt-name code-review-guide \
  --prompt-args codeLanguage=Python --prompt-args focusArea=security

# Multi-turn conversation
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method prompts/get --prompt-name interview-guide \
  --prompt-args role=Engineer --prompt-args experience=5

# Dynamic prompt (business logic branches on complexity)
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method prompts/get --prompt-name task-planner \
  --prompt-args task="Write docs" --prompt-args complexity=medium

# Image content type
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method prompts/get --prompt-name image-content-demo
```

## Features covered (all ✅ on alpha.1)

| docs/prompts.md section | Prompt | Result |
| --- | --- | --- |
| Basic Prompt | `multilingual-greeting-guide` | ✅ matches doc exactly |
| Message Roles / `PromptResult` | `code-review-guide` | ✅ `assistant` + `user` roles both work |
| Multi-turn Conversation | `interview-guide` | ✅ (doc's literal code has an escaped-quote syntax bug, see report) |
| Dynamic Prompts | `task-planner` | ✅ |
| Content Types (image) | `image-content-demo` | ✅ `type: 'image'` content accepted over the wire |
| `prompts/list` `arguments[]` | all above | ✅ includes `description`/`required` derived from Zod `.describe()` |

See [`.rinorism/doc-report.md`](../../.rinorism/doc-report.md) for the doc mismatch found (unescaped quotes in the `interview-guide` code sample).
