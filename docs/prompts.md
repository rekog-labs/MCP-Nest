# Prompts

Prompts are reusable instruction templates that AI agents can use to guide conversations or tasks. They provide structured ways to format requests and context. In mcp-nest, prompts are defined using the `@Prompt()` decorator.

## Basic Prompt

```typescript
import { McpController, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingPrompt {
  @Prompt({
    name: 'multilingual-greeting-guide',
    description: 'Simple instruction for greeting users in their native languages',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('The language to use for the greeting'),
    }),
  })
  getGreetingInstructions(@Payload() { name, language }: { name: string; language: string }) {
    return {
      description: 'Greet users in their native languages!',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Greet ${name} in their preferred language: ${language}`,
          },
        },
      ],
    };
  }
}
```

Register the class in a module's `controllers` array (not `providers`) so NestJS scans it when the strategy is connected. See [Server Examples](server-examples.md) for the full bootstrap. The validated arguments arrive as the `@Payload()`; add `@Ctx() ctx: McpContext` if you need the execution context.

## Prompt Structure

A prompt returns an object with:

- **description**: Brief explanation of what this prompt does
- **messages**: Array of conversation messages

## Message Roles

Messages can have two roles either `'user'` or `'assistant'`

```typescript
import { McpController, Prompt, PromptResult } from '@rekog/mcp-nest';

@Prompt({
  name: 'code-review-guide',
  description: 'Instructions for reviewing code',
  parameters: z.object({
    codeLanguage: z.string(),
    focusArea: z.string(),
  }),
})
getCodeReviewPrompt(@Payload() { codeLanguage, focusArea }: { codeLanguage: string; focusArea: string }): PromptResult {
  return {
    description: 'Guide for conducting thorough code reviews',
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `You are an expert ${codeLanguage} code reviewer.`,
        },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Please review this code focusing on: ${focusArea}`,
        },
      },
    ],
  };
}
```

`PromptResult` is the SDK's `GetPromptResult`; use `Promise<PromptResult>` for `async` handlers.

## Multi-turn Conversation Prompts

Create complex conversation flows:

```typescript
@Prompt({
  name: 'interview-guide',
  description: 'Structured interview questions',
  parameters: z.object({
    role: z.string().describe('Job role being interviewed for'),
    experience: z.string().describe('Years of experience'),
  }),
})
getInterviewGuide(@Payload() { role, experience }: { role: string; experience: string }) {
  return {
    description: `Interview guide for ${role} position`,
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: 'You are conducting a technical interview. Be thorough but encouraging.',
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `Hello! I understand you're applying for a ${role} position with ${experience} years of experience.`,
        },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text: "Yes, that's correct. I'm excited to discuss the role.",
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: "Great! Let's start with some technical questions relevant to your experience level.",
        },
      },
    ],
  };
}
```

## Content Types

Prompts support different content types:

### Text Content

```typescript
{
  role: 'user',
  content: {
    type: 'text',
    text: 'Your message here',
  },
}
```

### Image Content

```typescript
{
  role: 'user',
  content: {
    type: 'image',
    data: 'base64-encoded-image-data',
    mimeType: 'image/png',
  },
}
```

## Dynamic Prompts

Build prompts based on business logic:

```typescript
@Prompt({
  name: 'task-planner',
  description: 'Creates task planning prompts based on complexity',
  parameters: z.object({
    task: z.string(),
    complexity: z.enum(['simple', 'medium', 'complex']),
  }),
})
getTaskPlannerPrompt(@Payload() { task, complexity }: { task: string; complexity: 'simple' | 'medium' | 'complex' }) {
  const baseMessage = `Plan the following task: ${task}`;

  const complexityInstructions = {
    simple: 'Keep it straightforward with 2-3 steps.',
    medium: 'Break it down into clear phases with dependencies.',
    complex: 'Create a detailed plan with milestones, risks, and alternatives.',
  };

  return {
    description: `Task planning for ${complexity} task`,
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: 'You are a project planning expert.',
        },
      },
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${baseMessage}\n\n${complexityInstructions[complexity]}`,
        },
      },
    ],
  };
}
```

## Testing Your Prompts

### 1. Start the Server

Run the example server:

```bash
cd examples/prompts && npm install && npm start
```

This serves the MCP endpoint at `http://localhost:3000/mcp`.

### 2. List Available Prompts

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method prompts/list
```

Expected output:

```json
{
  "prompts": [
    {
      "name": "multilingual-greeting-guide",
      "description": "Simple instruction for greeting users in their native languages",
      "arguments": [
        {
          "name": "name",
          "description": "The name of the person to greet",
          "required": true
        },
        {
          "name": "language",
          "description": "The language to use for the greeting",
          "required": true
        }
      ]
    }
  ]
}
```

### 3. Get a Prompt Template

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method prompts/get --prompt-name multilingual-greeting-guide --prompt-args name=Alice --prompt-args language=es
```

Expected output:

```json
{
  "description": "Greet users in their native languages!",
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Greet Alice in their preferred language: es"
      }
    }
  ]
}
```

### 4. Interactive Testing

For interactive testing, use the MCP Inspector UI:

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to `http://localhost:3000/mcp` and browse the prompts to test with different parameters.

## Example Location

See the complete example at: `examples/prompts/src/greeting.prompt.ts`
