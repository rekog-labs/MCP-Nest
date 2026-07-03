/**
 * SOURCE OF TRUTH for the benchmark tool set.
 *
 * All benchmark servers (v2 stateless/stateful, raw SDK, v1 baseline) must
 * expose exactly this tool set so results are comparable:
 *   - `echo` (decorator-based in the Nest servers — measures the real pipeline)
 *   - `synthetic-tool-1 .. synthetic-tool-(N-1)` with moderately complex schemas
 *
 * v1-baseline/src/shared-tools.ts is a byte-identical COPY of this file
 * (v1 lives in its own npm project and cannot import across package roots).
 * The smoke-check asserts the two files are identical to prevent drift.
 */
import { z } from 'zod';

export const ECHO_TOOL_NAME = 'echo';
export const ECHO_TOOL_DESCRIPTION = 'Echoes the provided text back.';

export const echoParameters = z.object({ text: z.string() });

export function makeSyntheticToolSchema(i: number) {
  return z.object({
    id: z.string(),
    count: z.number().int().min(0).max(1000),
    tags: z.array(z.string()).max(10),
    metadata: z
      .object({
        source: z.string(),
        priority: z.enum(['low', 'medium', 'high']),
      })
      .optional(),
    filters: z
      .array(
        z.object({
          field: z.string(),
          op: z.enum(['eq', 'gt', 'lt']),
          value: z.union([z.string(), z.number()]),
        }),
      )
      .optional(),
  });
}

export interface SyntheticToolDef {
  name: string;
  description: string;
  parameters: ReturnType<typeof makeSyntheticToolSchema>;
}

/** Returns the (toolCount - 1) synthetic tools that accompany `echo`. */
export function generateSyntheticTools(toolCount: number): SyntheticToolDef[] {
  const n = Math.max(0, toolCount - 1);
  return Array.from({ length: n }, (_, i) => ({
    name: `synthetic-tool-${i + 1}`,
    description: `Synthetic benchmark tool #${i + 1}`,
    parameters: makeSyntheticToolSchema(i + 1),
  }));
}

export function getToolCount(): number {
  const raw = process.env.TOOL_COUNT;
  const n = raw ? Number(raw) : 50;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid TOOL_COUNT: ${raw}`);
  }
  return n;
}

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
