import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import express, { type Request, type Response } from "express";
import { ErrorLLM, type Mensaje } from "./llm/adapter.ts";
import { OpenRouterAdapter, configDesdeEnv } from "./llm/openrouter.ts";
import {
  cargarSystemPrompt,
  ejecutarTurno,
  type ConfigCiclo,
  type ToolCallRegistro,
} from "./agente/ciclo.ts";
import type { Ctx } from "./tools/proveedor.ts";
import { cargarSecretosDesdeKeyVault } from "./config/secretos.ts";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8787);

const cfgCiclo: ConfigCiclo = {
  maxIteraciones: Number(process.env.MAX_ITERACIONES ?? 25),
  maxTokensSesion: Number(process.env.MAX_TOKENS_SESION ?? 120000),
};

/** Mensaje tal como lo ve el front (incluye tool calls para render). */
interface MensajeUI {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallRegistro[];
  needsConfirmation?: boolean;
}

/** Estado de una sesión en memoria. */
interface Sesion {
  id: string;
  /** Historial completo para el modelo (incluye system y mensajes tool). */
  historial: Mensaje[];
  /** Vista para el front. */
  ui: MensajeUI[];
  tokensSesion: number;
}

const sesiones = new Map<string, Sesion>();

async function obtenerSesion(id: string): Promise<Sesion> {
  const existente = sesiones.get(id);
  if (existente) return existente;
  const systemPrompt = await cargarSystemPrompt(directory);
  const sesion: Sesion = {
    id,
    historial: [{ rol: "system", contenido: systemPrompt }],
    ui: [],
    tokensSesion: 0,
  };
  sesiones.set(id, sesion);
  return sesion;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// --- Health check (sin exponer claves). ------------------------------------
app.get("/api/health", (_req: Request, res: Response) => {
  const provider = "openrouter";
  const model = process.env.LLM_MODEL ?? "openai/gpt-4o";
  const configurado = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  res.json({ ok: true, provider, model, configurado });
});

// --- Historial de una sesión. ----------------------------------------------
app.get("/api/sessions/:id", (req: Request, res: Response) => {
  const sesion = sesiones.get(req.params.id);
  if (!sesion) {
    res.status(404).json({ ok: false, error: "sesión no encontrada" });
    return;
  }
  res.json({ ok: true, sessionId: sesion.id, messages: sesion.ui });
});

// --- Chat. ------------------------------------------------------------------
app.post("/api/chat", async (req: Request, res: Response) => {
  const body = req.body as { sessionId?: unknown; message?: unknown };
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId
      : `s-${Date.now()}`;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    res.status(400).json({ ok: false, error: "message es obligatorio" });
    return;
  }

  // Adaptador: si falta la clave, respondemos con un error claro (no 500 crudo).
  let adaptador: OpenRouterAdapter;
  try {
    adaptador = new OpenRouterAdapter(configDesdeEnv());
  } catch (e) {
    const msg =
      e instanceof ErrorLLM
        ? e.message
        : "configuración del proveedor LLM inválida";
    res.status(503).json({ ok: false, error: msg, sessionId });
    return;
  }

  const sesion = await obtenerSesion(sessionId);
  const ctx: Ctx = { directory, sessionId };

  // Añade el mensaje del usuario.
  sesion.historial.push({ rol: "user", contenido: message });
  sesion.ui.push({ role: "user", content: message });

  const resultado = await ejecutarTurno(
    adaptador,
    sesion.historial,
    ctx,
    cfgCiclo,
    sesion.tokensSesion,
  );

  // Persiste los mensajes nuevos en el historial del modelo.
  sesion.historial.push(...resultado.nuevosMensajes);
  sesion.tokensSesion = resultado.tokensSesion;

  // Vista para el front.
  sesion.ui.push({
    role: "assistant",
    content: resultado.reply,
    toolCalls: resultado.toolCalls,
    needsConfirmation: resultado.needsConfirmation,
  });

  res.json({
    ok: true,
    sessionId,
    reply: resultado.reply,
    toolCalls: resultado.toolCalls,
    needsConfirmation: resultado.needsConfirmation,
  });
});

// --- Servir el front compilado (dist/) en producción. ----------------------
const distDir = path.join(directory, "dist");
async function montarEstaticos(): Promise<void> {
  try {
    await fs.access(distDir);
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    console.log(`[server] sirviendo front estático desde ${distDir}`);
  } catch {
    console.log("[server] dist/ no existe aún; el front se sirve con Vite en dev");
  }
}

// Carga la clave desde Key Vault si KEY_VAULT_URI está configurada (Azure).
// En local sin esa variable, no hace nada y se usa el .env.
await cargarSecretosDesdeKeyVault();

await montarEstaticos();

app.listen(PORT, () => {
  const model = process.env.LLM_MODEL ?? "openai/gpt-4o";
  console.log(`[server] escuchando en http://localhost:${PORT}`);
  console.log(`[server] proveedor=openrouter modelo=${model}`);
  console.log(
    `[server] clave configurada: ${
      process.env.OPENROUTER_API_KEY?.trim() ? "sí" : "no (define OPENROUTER_API_KEY)"
    }`,
  );
});
