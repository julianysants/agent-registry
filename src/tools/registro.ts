import { z } from "zod";
import type { DefinicionHerramienta } from "../llm/adapter.ts";
import { herramientas, type Ctx, type Herramienta } from "./proveedor.ts";

/**
 * Conversión mínima de un esquema zod a JSON Schema, suficiente para los tipos
 * usados por las herramientas de este reto (string, boolean, array, object,
 * unknown, optional). Evita una dependencia extra.
 */
function zodAJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) {
    return zodAJsonSchema(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodString) {
    const desc = schema.description;
    return desc ? { type: "string", description: desc } : { type: "string" };
  }
  if (schema instanceof z.ZodBoolean) {
    const desc = schema.description;
    return desc ? { type: "boolean", description: desc } : { type: "boolean" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodArray) {
    const desc = schema.description;
    const base: Record<string, unknown> = {
      type: "array",
      items: zodAJsonSchema(schema.element as z.ZodTypeAny),
    };
    if (desc) base.description = desc;
    return base;
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [clave, valor] of Object.entries(shape)) {
      properties[clave] = zodAJsonSchema(valor);
      if (!(valor instanceof z.ZodOptional)) required.push(clave);
    }
    return { type: "object", properties, required };
  }
  // ZodUnknown u otros: objeto libre.
  return {};
}

/** Construye el JSON Schema de parámetros a partir del args (ZodRawShape). */
function parametrosDeHerramienta(
  args: z.ZodRawShape,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [clave, valor] of Object.entries(args)) {
    const schema = valor as z.ZodTypeAny;
    properties[clave] = zodAJsonSchema(schema);
    if (!(schema instanceof z.ZodOptional)) required.push(clave);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** Lista de definiciones de herramientas para enviar al modelo. */
export function definicionesHerramientas(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([nombre, h]) => ({
    nombre,
    descripcion: (h as Herramienta<z.ZodRawShape>).description,
    parametros: parametrosDeHerramienta(
      (h as Herramienta<z.ZodRawShape>).args,
    ),
  }));
}

/**
 * Ejecuta una herramienta por nombre, validando los argumentos con su esquema
 * zod. Nunca lanza: devuelve siempre un string JSON (ok/false).
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx: Ctx,
): Promise<string> {
  const h = (herramientas as Record<string, Herramienta<z.ZodRawShape>>)[
    nombre
  ];
  if (!h) {
    return JSON.stringify({
      ok: false,
      error: `herramienta desconocida: ${nombre}`,
    });
  }
  const schema = z.object(h.args);
  const parsed = schema.safeParse(argumentos);
  if (!parsed.success) {
    return JSON.stringify({
      ok: false,
      error: `argumentos inválidos para ${nombre}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    });
  }
  try {
    return await h.execute(parsed.data, ctx);
  } catch (e) {
    // Defensa extra: ninguna herramienta debería lanzar.
    return JSON.stringify({
      ok: false,
      error: `error inesperado en ${nombre}: ${
        e instanceof Error ? e.message : "desconocido"
      }`,
    });
  }
}

export { herramientas };
