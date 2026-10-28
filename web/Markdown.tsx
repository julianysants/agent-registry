import React from "react";

/**
 * Renderizador de Markdown mínimo y seguro (sin dangerouslySetInnerHTML).
 * Soporta: encabezados (#..###), tablas GFM, listas (-/*), negrita (**),
 * código inline (`), y párrafos. Suficiente para las respuestas del agente.
 */

function renderInline(texto: string, keyBase: string): React.ReactNode[] {
  const nodos: React.ReactNode[] = [];
  // Divide por **negrita** y `código`.
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const partes = texto.split(regex);
  partes.forEach((parte, i) => {
    if (!parte) return;
    if (parte.startsWith("**") && parte.endsWith("**")) {
      nodos.push(<strong key={`${keyBase}-b-${i}`}>{parte.slice(2, -2)}</strong>);
    } else if (parte.startsWith("`") && parte.endsWith("`")) {
      nodos.push(<code key={`${keyBase}-c-${i}`}>{parte.slice(1, -1)}</code>);
    } else {
      nodos.push(<span key={`${keyBase}-t-${i}`}>{parte}</span>);
    }
  });
  return nodos;
}

function parseFilaTabla(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function esSeparadorTabla(linea: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(linea) && linea.includes("-");
}

/** Clase de estilo según el contenido de una celda (estado/vigencia). */
function claseCelda(valor: string): string {
  const v = valor.toLowerCase();
  if (v.includes("vencido") || v.includes("ausente") || v.includes("❌")) {
    return "cell-danger";
  }
  if (v.includes("confirm")) return "cell-warn";
  if (v.includes("lleno") || v.includes("vigente") || v.includes("✅") || v === "sí") {
    return "cell-ok";
  }
  return "";
}

export function Markdown({ texto }: { texto: string }): React.ReactElement {
  const lineas = texto.split("\n");
  const bloques: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    // Tabla GFM: línea con | seguida de separador.
    if (
      linea.includes("|") &&
      i + 1 < lineas.length &&
      esSeparadorTabla(lineas[i + 1])
    ) {
      const encabezados = parseFilaTabla(linea);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && lineas[i].includes("|")) {
        filas.push(parseFilaTabla(lineas[i]));
        i++;
      }
      bloques.push(
        <div className="tabla-wrap" key={`tbl-${key++}`}>
          <table>
            <thead>
              <tr>
                {encabezados.map((h, j) => (
                  <th key={j}>{renderInline(h, `th-${key}-${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, r) => (
                <tr key={r}>
                  {fila.map((celda, c) => (
                    <td key={c} className={claseCelda(celda)}>
                      {renderInline(celda, `td-${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Encabezados.
    const he = /^(#{1,3})\s+(.*)$/.exec(linea);
    if (he) {
      const nivel = he[1].length;
      const contenido = renderInline(he[2], `h-${key}`);
      if (nivel === 1) bloques.push(<h3 key={`h-${key++}`}>{contenido}</h3>);
      else if (nivel === 2) bloques.push(<h4 key={`h-${key++}`}>{contenido}</h4>);
      else bloques.push(<h5 key={`h-${key++}`}>{contenido}</h5>);
      i++;
      continue;
    }

    // Listas.
    if (/^\s*[-*]\s+/.test(linea)) {
      const items: string[] = [];
      while (i < lineas.length && /^\s*[-*]\s+/.test(lineas[i])) {
        items.push(lineas[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      bloques.push(
        <ul key={`ul-${key++}`}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `li-${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Línea vacía.
    if (linea.trim() === "") {
      i++;
      continue;
    }

    // Párrafo.
    bloques.push(<p key={`p-${key++}`}>{renderInline(linea, `p-${key}`)}</p>);
    i++;
  }

  return <div className="md">{bloques}</div>;
}
