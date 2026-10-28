export interface ToolCall {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado: unknown;
  ok: boolean;
}

export interface MensajeUI {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  needsConfirmation?: boolean;
}

export interface RespuestaChat {
  ok: boolean;
  sessionId: string;
  reply?: string;
  toolCalls?: ToolCall[];
  needsConfirmation?: boolean;
  error?: string;
}

export interface Health {
  ok: boolean;
  provider: string;
  model: string;
  configurado: boolean;
}

export async function getHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  return (await res.json()) as Health;
}

export async function enviarMensaje(
  sessionId: string | null,
  message: string,
): Promise<RespuestaChat> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  return (await res.json()) as RespuestaChat;
}
