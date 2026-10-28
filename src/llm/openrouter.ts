import {
  ErrorLLM,
  type AdaptadorLLM,
  type DefinicionHerramienta,
  type Mensaje,
  type RespuestaLLM,
  type ToolCall,
} from "./adapter.ts";

/** Configuración del adaptador, leída de variables de entorno. */
export interface ConfigOpenRouter {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

/** Lee la configuración desde el entorno. Lanza ErrorLLM si falta la clave. */
export function configDesdeEnv(): ConfigOpenRouter {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new ErrorLLM(
      "falta OPENROUTER_API_KEY en el entorno del backend",
      "config",
    );
  }
  return {
    apiKey,
    baseUrl: (
      process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
    ).replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? "openai/gpt-4o",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
    maxTokens: Number(process.env.LLM_MAX_TOKENS_RESPUESTA ?? 2048),
  };
}

// --- Tipos mínimos de la respuesta OpenAI/OpenRouter (no `any`). -----------

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChoiceMessage {
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIResponse {
  choices?: Array<{ message?: OpenAIChoiceMessage }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

/** Convierte nuestros mensajes al formato de la API de chat de OpenAI. */
function aMensajesOpenAI(mensajes: Mensaje[]): Record<string, unknown>[] {
  return mensajes.map((m) => {
    if (m.rol === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.contenido || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.nombre,
            arguments: JSON.stringify(tc.argumentos),
          },
        })),
      };
    }
    if (m.rol === "tool") {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.contenido,
      };
    }
    return { role: m.rol, content: m.contenido };
  });
}

function aHerramientasOpenAI(
  herramientas: DefinicionHerramienta[],
): Record<string, unknown>[] {
  return herramientas.map((h) => ({
    type: "function",
    function: {
      name: h.nombre,
      description: h.descripcion,
      parameters: h.parametros,
    },
  }));
}

function parseArgumentos(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Adaptador para OpenRouter (API compatible con OpenAI). */
export class OpenRouterAdapter implements AdaptadorLLM {
  readonly provider = "openrouter";
  readonly model: string;
  private readonly cfg: ConfigOpenRouter;

  constructor(cfg: ConfigOpenRouter) {
    this.cfg = cfg;
    this.model = cfg.model;
  }

  async enviar(
    mensajes: Mensaje[],
    herramientas: DefinicionHerramienta[],
  ): Promise<RespuestaLLM> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
          // Cabeceras recomendadas por OpenRouter (opcionales).
          "HTTP-Referer": "https://reto-01-registro-proveedor.local",
          "X-Title": "Agente Registro Proveedor",
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: this.cfg.maxTokens,
          temperature: 0,
          messages: aMensajesOpenAI(mensajes),
          tools: aHerramientasOpenAI(herramientas),
          tool_choice: "auto",
        }),
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof Error && e.name === "AbortError") {
        throw new ErrorLLM(
          `el modelo no respondió en ${this.cfg.timeoutMs} ms`,
          "timeout",
        );
      }
      throw new ErrorLLM(
        `no se pudo contactar al proveedor LLM: ${
          e instanceof Error ? e.message : "error de red"
        }`,
        "red",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ErrorLLM("clave del modelo inválida o sin permisos", "auth");
    }
    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      throw new ErrorLLM(
        `el proveedor LLM respondió ${res.status}: ${texto.slice(0, 200)}`,
        "respuesta",
      );
    }

    const data = (await res.json()) as OpenAIResponse;
    if (data.error) {
      throw new ErrorLLM(
        `el proveedor LLM devolvió un error: ${data.error.message ?? "desconocido"}`,
        "respuesta",
      );
    }

    const msg = data.choices?.[0]?.message;
    const tool_calls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      nombre: tc.function.name,
      argumentos: parseArgumentos(tc.function.arguments),
    }));

    return {
      contenido: msg?.content ?? "",
      tool_calls,
      tokens_usados: data.usage?.total_tokens ?? 0,
    };
  }
}
