import "server-only";

import {
  InvalidToolInputError,
  type JSONSchema7,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

/**
 * Repairs a chat tool call whose input left out required-nullable keys. The
 * tool schemas are strict-safe (every key required, null for "not given"),
 * but tools are not sent with `strict`, so a provider may drop keys whose
 * value would be null. Each drop would otherwise go back to the model as an
 * invalid call and burn one of its steps. Only omitted keys whose schema
 * allows null are filled; any other problem still fails validation.
 */

type SchemaNode = JSONSchema7 | boolean;

/** The schema itself, or each branch of an anyOf/oneOf (zod's nullable). */
function variants(schema: SchemaNode | undefined): JSONSchema7[] {
  if (!schema || typeof schema === "boolean") return [];
  const union = schema.anyOf ?? schema.oneOf;
  return union ? union.flatMap(variants) : [schema];
}

function hasType(schema: JSONSchema7, type: "null" | "object" | "array") {
  return Array.isArray(schema.type)
    ? schema.type.includes(type)
    : schema.type === type;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sets omitted required keys whose schema allows null to null, at any depth.
 * Returns the same reference when nothing was filled.
 */
export function fillOmittedNullableKeys(
  value: unknown,
  schema: SchemaNode | undefined,
): unknown {
  if (Array.isArray(value)) {
    const items = variants(schema).find((v) => hasType(v, "array"))?.items;
    if (!items || Array.isArray(items)) return value;
    let changed = false;
    const next = value.map((item) => {
      const filled = fillOmittedNullableKeys(item, items);
      if (filled !== item) changed = true;
      return filled;
    });
    return changed ? next : value;
  }
  if (!isPlainObject(value)) return value;
  const objectSchema = variants(schema).find(
    (v) => hasType(v, "object") || v.properties !== undefined,
  );
  if (!objectSchema?.properties) return value;
  const required = new Set(objectSchema.required ?? []);
  let next: Record<string, unknown> | null = null;
  for (const [key, keySchema] of Object.entries(objectSchema.properties)) {
    if (Object.hasOwn(value, key)) {
      const filled = fillOmittedNullableKeys(value[key], keySchema);
      if (filled !== value[key]) {
        next ??= { ...value };
        next[key] = filled;
      }
    } else if (
      required.has(key) &&
      variants(keySchema).some((v) => hasType(v, "null"))
    ) {
      next ??= { ...value };
      next[key] = null;
    }
  }
  return next ?? value;
}

/**
 * The chat loop's `experimental_repairToolCall`. Unknown tools and inputs
 * that are not JSON are left alone (the SDK reports them as before).
 * `onRepaired` counts calls whose input was filled, for the route log.
 */
export function createStudioChatToolRepair(
  onRepaired: () => void,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, inputSchema, error }) => {
    if (!InvalidToolInputError.isInstance(error)) return null;
    let input: unknown;
    try {
      const text = toolCall.input.trim();
      input = text ? JSON.parse(text) : {};
    } catch {
      return null;
    }
    const filled = fillOmittedNullableKeys(
      input,
      await inputSchema({ toolName: toolCall.toolName }),
    );
    if (filled === input) return null;
    onRepaired();
    return { ...toolCall, input: JSON.stringify(filled) };
  };
}
