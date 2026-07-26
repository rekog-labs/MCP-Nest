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
 * The JSON Schema dialect MCP tool schemas are advertised in.
 *
 * 2020-12 is what the spec requires (SEP-1613) and what SDK v2 clients enforce:
 * their default validator compiles `outputSchema` as 2020-12 and REJECTS a
 * schema declaring any other `$schema`, so a draft-07 dialect makes every tool
 * with an output schema uncallable by a conforming modern client — it fails
 * client-side, before the request is even sent.
 *
 * This was `draft-7`, inherited from the v1 SDK's `toJsonSchemaCompat`
 * defaults. For ordinary object schemas the only difference is the `$schema`
 * URI, and legacy clients don't validate against it at all.
 */
const JSON_SCHEMA_TARGET = 'draft-2020-12';

/**
 * Zod schema → JSON Schema for the manually built `tools/list` result.
 * Replaces the v1 SDK's `toJsonSchemaCompat` (removed in SDK v2), keeping its
 * input-side-of-pipes default.
 */
function zodToJsonSchema(
  schema: ZodType,
  io: 'input' | 'output',
): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: JSON_SCHEMA_TARGET, io }) as Record<
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
      // Same dialect requirement as Zod above — see JSON_SCHEMA_TARGET.
      return io === 'input'
        ? converter.input({ target: JSON_SCHEMA_TARGET })
        : converter.output({ target: JSON_SCHEMA_TARGET });
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

// -----------------------------------------------------------------------------
// SEP-2243 header mirroring (`x-mcp-header`) — refused, loudly.
// -----------------------------------------------------------------------------

/**
 * The schema property SEP-2243 uses to designate a tool parameter for mirroring
 * into an `Mcp-Param-{Name}` request header.
 */
const MCP_HEADER_ANNOTATION = 'x-mcp-header';

/**
 * First location of an `x-mcp-header` annotation anywhere in a schema, as a
 * JSON-Pointer-ish path, or `undefined` if there is none.
 *
 * Searching the *whole* document rather than only the statically reachable
 * `properties` chain is deliberate: the spec makes an annotation outside that
 * chain a tool-definition error, so a hit anywhere is grounds to refuse.
 */
function findMcpHeaderAnnotation(
  node: unknown,
  path: string,
  seen: WeakSet<object>,
): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  // User-supplied raw JSON Schema objects may be cyclic; converted ones use
  // `$defs` + `$ref` strings and are not.
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) {
      const hit = findMcpHeaderAnnotation(value, `${path}/${index}`, seen);
      if (hit) return hit;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === MCP_HEADER_ANNOTATION) return `${path}/${key}`;
    const hit = findMcpHeaderAnnotation(value, `${path}/${key}`, seen);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Refuse a tool whose input schema declares SEP-2243 header mirroring.
 *
 * The spec makes mirroring a two-sided contract: a client **MUST** copy the
 * annotated parameters into `Mcp-Param-{Name}` headers, and any server that
 * reads the message body **MUST** verify that the mirrored header values match
 * the body and reject a mismatch with `400` / `-32020` (`HeaderMismatch`).
 *
 * mcp-nest cannot hold up the server half. The SDK does implement the check, but
 * only for tools registered through `McpServer.registerTool` (it is gated on the
 * `toolInputSchemaJson` memo that only `registerTool` populates), whereas
 * mcp-nest registers raw `tools/call` handlers so that guards, pipes and
 * interceptors apply. So the validation would silently never run: clients would
 * faithfully mirror headers nobody verifies, which is exactly the spoofing the
 * MUST exists to prevent.
 *
 * A hard error at registration turns that silent spec violation into an obvious
 * one. Nothing else in mcp-nest emits the annotation, so this can only fire on a
 * schema a user authored by hand (a raw JSON Schema object, or Zod `.meta()`).
 *
 * @param schema the tool's declared `parameters`
 * @param toolLabel how to name the offending tool in the error
 */
export function assertNoMcpParamHeaderMirroring(
  schema: ToolInputSchema,
  toolLabel: string,
): void {
  let json: Record<string, unknown> | undefined;
  try {
    json = resolveToolSchema(schema).toJsonSchema('input');
  } catch {
    // A schema we cannot project to JSON Schema cannot be advertised either,
    // and `tools/list` reports that with a far more useful message. Don't
    // pre-empt it from here.
    return;
  }
  const at = json && findMcpHeaderAnnotation(json, '', new WeakSet());
  if (!at) return;

  throw new Error(
    `${toolLabel} declares '${MCP_HEADER_ANNOTATION}' at '${at}'. ` +
      `SEP-2243 header mirroring is a two-sided contract: clients MUST copy the ` +
      `annotated parameters into 'Mcp-Param-*' headers, and the server MUST reject ` +
      `any request whose headers disagree with the body (HTTP 400, JSON-RPC -32020 ` +
      `HeaderMismatch). mcp-nest registers raw request handlers rather than using ` +
      `McpServer.registerTool, which is the only path the SDK's mirroring check runs ` +
      `on — so that validation would silently never happen and clients would mirror ` +
      `header values nothing verifies. Remove '${MCP_HEADER_ANNOTATION}' from the ` +
      `schema: the parameters still travel in the request body, which is the only ` +
      `place mcp-nest reads them from. Full SEP-2243 support is not implemented yet.`,
  );
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
