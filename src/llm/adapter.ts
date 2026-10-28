// Interfaz propia del proveedor LLM. El ciclo del agente depende solo de esta
// interfaz, no de un proveedor concreto. Cambiar de proveedor no toca el ciclo.

/** Rol de un mensaje en la conversación. */
export type Rol = "system" | "user" | "assistant" | "tool";

/** Llamada a herramienta solicitada por el modelo. */
export interface ToolCall {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
}

/** Mensaje del historial que se envía al modelo. */
export interface Mensaje {
  rol: Rol;
  contenido: string;
  /** Presentes solo cuando rol === "assistant" y el modelo pide herramientas. */
  tool_calls?: ToolCall[];
  /** Presente solo cuando rol === "tool": id de la tool_call que responde. */
  tool_call_id?: string;
  /** Nombre de la herramienta, para mensajes de rol "tool". */
  nombre?: string;
}

/** Definición de una herramienta expuesta al modelo (JSON Schema). */
export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
}

/** Respuesta del modelo tras una invocación. */
export interface RespuestaLLM {
  /** Texto de respuesta (puede ir vacío si solo pide herramientas). */
  contenido: string;
  /** Herramientas que el modelo quiere ejecutar. */
  tool_calls: ToolCall[];
  /** Tokens aproximados consumidos en esta llamada, si el proveedor los reporta. */
  tokens_usados: number;
}

/** Contrato del adaptador. */
export interface AdaptadorLLM {
  readonly provider: string;
  readonly model: string;
  enviar(
    mensajes: Mensaje[],
    herramientas: DefinicionHerramienta[],
  ): Promise<RespuestaLLM>;
}

/** Error tipado del proveedor LLM (timeout, auth, etc.). */
export class ErrorLLM extends Error {
  constructor(
    message: string,
    public readonly tipo: "timeout" | "auth" | "red" | "respuesta" | "config",
  ) {
    super(message);
    this.name = "ErrorLLM";
  }
}
