import React, { useEffect, useRef, useState } from "react";
import { enviarMensaje, getHealth, type Health, type MensajeUI } from "./api.ts";
import { Markdown } from "./Markdown.tsx";
import { ToolCalls } from "./ToolCalls.tsx";

const CASOS = [
  "co-industrias-delta",
  "ec-corp-andina",
  "hn-agroexport-sula",
  "pa-logistica-istmo",
];

export function App(): React.ReactElement {
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [entrada, setEntrada] = useState("");
  const [pensando, setPensando] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, pensando]);

  const ultimoAsistente = [...mensajes].reverse().find((m) => m.role === "assistant");
  const requiereConfirmacion = Boolean(
    ultimoAsistente?.needsConfirmation && !pensando,
  );

  async function enviar(texto: string): Promise<void> {
    const msg = texto.trim();
    if (!msg || pensando) return;
    setEntrada("");
    setMensajes((m) => [...m, { role: "user", content: msg }]);
    setPensando(true);
    try {
      const r = await enviarMensaje(sessionId, msg);
      if (r.sessionId) setSessionId(r.sessionId);
      if (!r.ok) {
        setMensajes((m) => [
          ...m,
          {
            role: "assistant",
            content: `⚠️ ${r.error ?? "ocurrió un error en el servidor"}`,
          },
        ]);
      } else {
        setMensajes((m) => [
          ...m,
          {
            role: "assistant",
            content: r.reply ?? "",
            toolCalls: r.toolCalls,
            needsConfirmation: r.needsConfirmation,
          },
        ]);
      }
    } catch {
      setMensajes((m) => [
        ...m,
        { role: "assistant", content: "⚠️ No se pudo contactar al servidor." },
      ]);
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">📋</span>
          <div>
            <h1>Registro como Proveedor</h1>
            <p className="sub">Asistente de Periferia IT Group S.A.S.</p>
          </div>
        </div>
        <div className="status">
          {health ? (
            <>
              <span className={`dot ${health.configurado ? "on" : "off"}`} />
              <span className="status-text">
                {health.provider} · {health.model}
                {!health.configurado && " · sin clave"}
              </span>
            </>
          ) : (
            <span className="status-text">conectando…</span>
          )}
        </div>
      </header>

      {health && !health.configurado && (
        <div className="banner-warn">
          El backend no tiene <code>OPENROUTER_API_KEY</code> configurada. Define
          la clave en <code>.env</code> para chatear con el agente.
        </div>
      )}

      <main className="chat">
        {mensajes.length === 0 && (
          <div className="welcome">
            <h2>¿Qué caso quieres procesar?</h2>
            <p>
              Pídeme procesar una solicitud de registro. Leeré el correo, llenaré
              el formulario desde el repositorio maestro y armaré el paquete para
              firma. No envío nada sin tu confirmación.
            </p>
            <div className="ejemplos">
              {CASOS.map((c) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() =>
                    enviar(
                      `Procesa el caso "${c}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`,
                    )
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="avatar">{m.role === "user" ? "🧑" : "🤖"}</div>
            <div className="bubble">
              {m.role === "assistant" ? (
                <Markdown texto={m.content} />
              ) : (
                <p>{m.content}</p>
              )}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <ToolCalls items={m.toolCalls} />
              )}
            </div>
          </div>
        ))}

        {pensando && (
          <div className="msg assistant">
            <div className="avatar">🤖</div>
            <div className="bubble">
              <div className="pensando">
                <span />
                <span />
                <span />
                <em>pensando…</em>
              </div>
            </div>
          </div>
        )}

        <div ref={finRef} />
      </main>

      {requiereConfirmacion && (
        <div className="confirm-bar">
          <span className="confirm-label">⚠️ El agente espera tu confirmación</span>
          <div className="confirm-actions">
            <button className="btn btn-confirm" onClick={() => enviar("Sí, confirmo. Procede.")}>
              ✓ Confirmar
            </button>
            <button className="btn btn-cancel" onClick={() => enviar("No, todavía no.")}>
              ✗ Cancelar
            </button>
          </div>
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(entrada);
        }}
      >
        <input
          type="text"
          placeholder='Ej: Procesa el caso "ec-corp-andina"'
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          disabled={pensando}
          aria-label="Mensaje"
        />
        <button type="submit" className="btn btn-send" disabled={pensando || !entrada.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
