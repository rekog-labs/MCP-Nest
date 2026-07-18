import { z, ZodType } from 'zod';
import {
  fromJsonSchema,
  type JsonSchemaType,
  type StandardSchemaV1,
} from '@modelcontextprotocol/server';
import type { ToolInputSchema } from '../decorators/tool.decorator';

/**
 * A tool schema resolved to the two things the MCP transport needs from it:
 * its JSON Schema (for `tools/list`) and a validate function (for `tools/call`).
 */
export interface ResolvedToolSchema {
  /**
   * The JSON Schema to advertise. `io` selects the input vs output projection
   * for schemas that distinguish them (Zod pipes, Standard Schema converters).
   * Returns `undefined` when the schema does not describe an object shape and so
   * should not be advertised (preserves the historical Zod behavior where a
   * non-object schema produced no `inputSchema`).
   */
  toJsonSchema(io: 'input' | 'output'): Record<string, unknown> | undefined;
  /** Validate a value, mirroring Zod's `safeParse` result shape. */
  validate(
    value: unknown,
  ): Promise<
    { success: true; data: unknown } | { success: false; message: string }
  >;
}

// -----------------------------------------------------------------------------
// Zod (case 1) — preserved byte-for-byte from the previous implementation.
// -----------------------------------------------------------------------------

/**
 * Zod schema → JSON Schema for the manually built `tools/list` result.
 * Replaces the v1 SDK's `toJsonSchemaCompat` (removed in SDK v2), keeping its
 * defaults (draft-7 target, input side of pipes).
 */
function zodToJsonSchema(
  schema: ZodType,
  io: 'input' | 'output',
): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io }) as Record<
    string,
    unknown
  >;
}

/**
 * Accept a Zod object schema or a raw shape and return an object schema, or
 * undefined when the input is missing / not an object schema. Replaces the v1
 * SDK's `normalizeObjectSchema` (removed in SDK v2), minus the Zod 3 support.
 */
function normalizeObjectSchema(
  schema?: ZodType | Record<string, ZodType>,
): ZodType | undefined {
  if (!schema) return undefined;
  if (schema instanceof z.ZodObject) return schema;
  if (schema instanceof z.ZodType) return undefined;
  const values = Object.values(schema);
  if (values.length > 0 && values.every((v) => v instanceof z.ZodType)) {
    return z.object(schema as z.ZodRawShape);
  }
  return undefined;
}

function resolveZod(schema: ZodType): ResolvedToolSchema {
  return {
    toJsonSchema(io) {
      const normalized = normalizeObjectSchema(schema);
      if (!normalized) return undefined;
      return zodToJsonSchema(normalized, io);
    },
    async validate(value) {
      const result = schema.safeParse(value);
      if (result.success) {
        return { success: true, data: result.data };
      }
      const message = result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : '';
          return `${path ? `[${path}]: ` : ''}${issue.message}`;
        })
        .join('; ');
      return { success: false, message };
    },
  };
}

// -----------------------------------------------------------------------------
// Standard Schema (case 2) — any validator carrying `~standard`.
// -----------------------------------------------------------------------------

interface StandardSchemaLike {
  '~standard': StandardSchemaV1['~standard'] & {
    jsonSchema?: {
      input: (opts: { target: string }) => Record<string, unknown>;
      output: (opts: { target: string }) => Record<string, unknown>;
    };
  };
}

function hasStandard(schema: unknown): schema is StandardSchemaLike {
  // ArkType schemas are callable functions, so accept 'function' too.
  return (
    (typeof schema === 'object' || typeof schema === 'function') &&
    schema !== null &&
    '~standard' in (schema as object) &&
    typeof (schema as Record<string, unknown>)['~standard'] === 'object'
  );
}

/** Standard Schema issue paths mix bare keys and `{ key }` segments. */
function issuePathToString(
  path: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined,
): string {
  if (!path || path.length === 0) return '';
  return path
    .map((seg) =>
      typeof seg === 'object' ? String(seg.key) : String(seg),
    )
    .join('.');
}

function resolveStandard(schema: StandardSchemaLike): ResolvedToolSchema {
  const std = schema['~standard'];
  return {
    toJsonSchema(io) {
      const converter = std.jsonSchema;
      if (!converter) {
        throw new Error(
          `Tool schema from validator "${std.vendor}" does not implement ` +
            `StandardJSONSchemaV1 (~standard.jsonSchema), so MCP cannot advertise ` +
            `its JSON Schema. Upgrade the validator (zod>=4.2, arktype>=2.1, or wrap ` +
            `valibot with @valibot/to-json-schema's toStandardJsonSchema) or pass a ` +
            `raw JSON Schema object.`,
        );
      }
      return io === 'input'
        ? converter.input({ target: 'draft-07' })
        : converter.output({ target: 'draft-07' });
    },
    async validate(value) {
      const result = await std.validate(value);
      if (!result.issues) {
        return { success: true, data: result.value };
      }
      const message = result.issues
        .map((issue) => {
          const path = issuePathToString(issue.path);
          return `${path ? `[${path}]: ` : ''}${issue.message}`;
        })
        .join('; ');
      return { success: false, message };
    },
  };
}

// -----------------------------------------------------------------------------
// Raw JSON Schema (case 3) — a plain object, wrapped via `fromJsonSchema`.
// -----------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function resolveRawJsonSchema(schema: Record<string, unknown>): ResolvedToolSchema {
  // Wrap the raw JSON Schema so we get Standard-Schema validation (AJV on Node),
  // but advertise the object itself verbatim as its JSON Schema.
  const wrapped = fromJsonSchema(schema as JsonSchemaType) as StandardSchemaLike;
  const std = resolveStandard(wrapped);
  return {
    toJsonSchema() {
      return schema;
    },
    validate: std.validate,
  };
}

/**
 * Classify a tool schema and return the JSON-Schema/validate pair the transport
 * needs. Classification order: Zod, then any Standard Schema (`~standard`), then
 * a plain JSON Schema object.
 */
export function resolveToolSchema(schema: ToolInputSchema): ResolvedToolSchema {
  if (schema instanceof z.ZodType) {
    return resolveZod(schema);
  }
  if (hasStandard(schema)) {
    return resolveStandard(schema);
  }
  if (isPlainObject(schema)) {
    return resolveRawJsonSchema(schema);
  }
  throw new Error(
    'Unsupported tool schema: expected a Zod schema, a Standard Schema ' +
      'validator (with ~standard), or a raw JSON Schema object.',
  );
}
