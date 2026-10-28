import { promises as fs } from "node:fs";
import path from "node:path";
import { ErrorLLM, type AdaptadorLLM, type Mensaje } from "../llm/adapter.ts";
import {
  definicionesHerramientas,
  ejecutarHerramienta,
} from "../tools/registro.ts";
import type { Ctx } from "../tools/proveedor.ts";

/** Una llamada a herramienta registrada para mostrar en el chat. */
export interface ToolCallRegistro {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado: unknown;
  ok: boolean;
}

export interface ResultadoTurno {
  reply: string;
  toolCalls: ToolCallRegistro[];
  needsConfirmation: boolean;
  /** Mensajes nuevos a anexar al historial de la sesión. */
  nuevosMensajes: Mensaje[];
}

export interface ConfigCiclo {
  maxIteraciones: number;
  maxTokensSesion: number;
}

/**
 * Carga el system prompt desde agent/prompt.md (ubicación canónica según el PRD).
 * El cuerpo es idéntico al de modulo/agent.md (verificado por scripts/verificar-modulo.ts).
 */
export async function cargarSystemPrompt(directory: string): Promise<string> {
  const ruta = path.join(directory, "agent", "prompt.md");
  return (await fs.readFile(ruta, "utf8")).trim();
}

/** Marcador que el modelo escribe cuando propone simular el envío (ver prompt). */
const MARCADOR_CONFIRMACION = "[[CONFIRMAR_ENVIO]]";

/**
 * Detecta si el agente pide confirmación de envío mediante un marcador explícito
 * emitido por el modelo. Devuelve si se pide confirmación y el texto ya limpio
 * (sin el marcador), para no depender de heurísticas frágiles de palabras clave.
 */
function procesarConfirmacion(texto: string): {
  needsConfirmation: boolean;
  limpio: string;
} {
  if (!texto.includes(MARCADOR_CONFIRMACION)) {
    return { needsConfirmation: false, limpio: texto };
  }
  const limpio = texto.split(MARCADOR_CONFIRMACION).join("").trimEnd();
  return { needsConfirmation: true, limpio };
}

/**
 * Ejecuta un turno del agente: alterna modelo <-> herramientas hasta que el
 * modelo deje de pedir herramientas o se alcance el tope de iteraciones (CA1).
 */
export async function ejecutarTurno(
  adaptador: AdaptadorLLM,
  historial: Mensaje[],
  ctx: Ctx,
  cfg: ConfigCiclo,
  tokensPrevios: number,
): Promise<ResultadoTurno & { tokensSesion: number }> {
  const definiciones = definicionesHerramientas();
  const toolCalls: ToolCallRegistro[] = [];
  const nuevosMensajes: Mensaje[] = [];
  // Historial de trabajo para esta ejecución (no muta el original hasta el final).
  const mensajes: Mensaje[] = [...historial];
  let tokensSesion = tokensPrevios;

  for (let i = 0; i < cfg.maxIteraciones; i++) {
    if (tokensSesion >= cfg.maxTokensSesion) {
      const aviso =
        "Alcancé el tope de tokens de la sesión. Resumo lo que tengo hasta ahora; " +
        "inicia una sesión nueva para continuar.";
      nuevosMensajes.push({ rol: "assistant", contenido: aviso });
      return {
        reply: aviso,
        toolCalls,
        needsConfirmation: false,
        nuevosMensajes,
        tokensSesion,
      };
    }

    let respuesta;
    try {
      respuesta = await adaptador.enviar(mensajes, definiciones);
    } catch (e) {
      const msg =
        e instanceof ErrorLLM
          ? `No pude contactar al modelo (${e.tipo}): ${e.message}`
          : `Error inesperado al contactar al modelo: ${
              e instanceof Error ? e.message : "desconocido"
            }`;
      nuevosMensajes.push({ rol: "assistant", contenido: msg });
      return {
        reply: msg,
        toolCalls,
        needsConfirmation: false,
        nuevosMensajes,
        tokensSesion,
      };
    }

    tokensSesion += respuesta.tokens_usados;

    // Detecta el marcador de confirmación y limpia el texto visible.
    const { needsConfirmation, limpio } = procesarConfirmacion(
      respuesta.contenido,
    );

    // Mensaje del asistente (con o sin tool_calls) se añade al contexto.
    const mensajeAsistente: Mensaje = {
      rol: "assistant",
      contenido: limpio,
      ...(respuesta.tool_calls.length > 0
        ? { tool_calls: respuesta.tool_calls }
        : {}),
    };
    mensajes.push(mensajeAsistente);
    nuevosMensajes.push(mensajeAsistente);

    // Sin tool_calls: fin del turno.
    if (respuesta.tool_calls.length === 0) {
      return {
        reply: limpio,
        toolCalls,
        needsConfirmation,
        nuevosMensajes,
        tokensSesion,
      };
    }

    // Ejecuta cada herramienta pedida y añade su resultado como mensaje "tool".
    for (const tc of respuesta.tool_calls) {
      const resultadoStr = await ejecutarHerramienta(
        tc.nombre,
        tc.argumentos,
        ctx,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(resultadoStr);
      } catch {
        parsed = { ok: false, error: "resultado no es JSON válido" };
      }
      const ok =
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { ok?: boolean }).ok === true;
      toolCalls.push({
        nombre: tc.nombre,
        argumentos: tc.argumentos,
        resultado: parsed,
        ok,
      });
      const mensajeTool: Mensaje = {
        rol: "tool",
        contenido: resultadoStr,
        tool_call_id: tc.id,
        nombre: tc.nombre,
      };
      mensajes.push(mensajeTool);
      nuevosMensajes.push(mensajeTool);
    }
  }

  // Se alcanzó el tope de iteraciones (CA1).
  const aviso =
    "Alcancé el tope de iteraciones de herramientas para este turno. " +
    "Te comparto lo que logré hasta ahora; pídeme continuar si falta algo.";
  nuevosMensajes.push({ rol: "assistant", contenido: aviso });
  return {
    reply: aviso,
    toolCalls,
    needsConfirmation: false,
    nuevosMensajes,
    tokensSesion,
  };
}
