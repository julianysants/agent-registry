import React, { useState } from "react";
import type { ToolCall } from "./api.ts";

function resumen(tc: ToolCall): string {
  const r = tc.resultado as { data?: unknown; error?: string } | null;
  if (!tc.ok) return r?.error ? `error: ${r.error}` : "error";
  const data = r?.data as Record<string, unknown> | undefined;
  if (!data) return "ok";
  if (typeof data.ruta === "string") return `ruta: ${data.ruta}`;
  if (Array.isArray(data.campos)) return `${data.campos.length} campos`;
  if (typeof data.listo_para_firma === "boolean") {
    return `listo_para_firma: ${data.listo_para_firma ? "sí" : "no"}`;
  }
  if (Array.isArray(data.llenos)) {
    const faltantes = Array.isArray(data.faltantes) ? data.faltantes.length : 0;
    return `${data.llenos.length} llenos, ${faltantes} faltantes`;
  }
  return "ok";
}

function ToolCallItem({ tc }: { tc: ToolCall }): React.ReactElement {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className={`toolcall ${tc.ok ? "tc-ok" : "tc-err"}`}>
      <button
        className="toolcall-head"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span className="tc-icon">{tc.ok ? "🛠️" : "⚠️"}</span>
        <span className="tc-name">{tc.nombre}</span>
        <span className="tc-sum">{resumen(tc)}</span>
        <span className="tc-chevron">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <div className="toolcall-body">
          <div className="tc-block">
            <span className="tc-label">Argumentos</span>
            <pre>{JSON.stringify(tc.argumentos, null, 2)}</pre>
          </div>
          <div className="tc-block">
            <span className="tc-label">Resultado</span>
            <pre>{JSON.stringify(tc.resultado, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolCalls({ items }: { items: ToolCall[] }): React.ReactElement | null {
  if (!items || items.length === 0) return null;
  return (
    <div className="toolcalls">
      {items.map((tc, i) => (
        <ToolCallItem key={i} tc={tc} />
      ))}
    </div>
  );
}
