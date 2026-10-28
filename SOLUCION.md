# SOLUCIÓN — Agente conversacional "Registro como Proveedor"

## 1. Problema en una frase

El área administrativa de CLIENTE transcribe a mano 8–12 formularios de registro
como proveedor al mes (Excel, PDF o portales), con riesgo de error en datos
sensibles y dependencia de una sola persona; **le duele a la analista
administrativa**, que pierde horas en retrabajo y retrasa la facturación.

## 2. Arquitectura

```
┌───────────────────┐   HTTP/JSON   ┌──────────────────────────────────────┐
│ Front React/Vite  │ ────────────▶ │ Backend Express (src/server.ts)        │
│  - historial      │ ◀──────────── │  - ciclo del agente (agente/ciclo.ts)  │
│  - tool calls     │               │  - adaptador LLM (llm/*)               │
│  - confirmación   │               │  - herramientas tipadas (tools/*)      │
└───────────────────┘               └───────┬───────────────────┬───────────┘
                                            │                   │
                                   fixtures/ (solo lectura)   out/ (escritura)
```

Separación de responsabilidades (lo que el reto evalúa):

| Capa | Dónde vive | Cambiar esto NO toca… |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | el servidor ni las herramientas |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` | el código |
| **Ejecución** | `src/tools/*.ts` | el prompt ni el front |
| **Proveedor LLM** | `src/llm/adapter.ts` + `openrouter.ts` | el ciclo del agente |

Las **herramientas** son la única fuente de valores que el agente puede afirmar.
El ciclo del agente depende solo de la interfaz `AdaptadorLLM`, no de OpenRouter.

## 3. Ciclo del agente

Implementado en `src/agente/ciclo.ts` (`ejecutarTurno`):

1. Se envía el historial + las definiciones de herramientas al modelo.
2. Si el modelo pide herramientas, se **validan los argumentos con zod**, se
   ejecutan (cada una devuelve `{ ok, data }` o `{ ok:false, error }`, nunca
   lanza) y el resultado se añade al contexto como mensaje `tool`.
3. Se repite hasta que el modelo responde sin pedir herramientas, o hasta el
   **tope de iteraciones** (`MAX_ITERACIONES`, default 25 — CA1). Al tope, el
   agente responde con lo que tiene.
4. **Tope de tokens por sesión** (`MAX_TOKENS_SESION`): si se supera, corta el
   turno con un aviso (control de costo).
5. **Confirmación humana** (CA3/RN4): el agente termina su turno con una pregunta
   explícita antes de cualquier envío. El backend marca `needsConfirmation` y el
   front resalta ese estado con botones Confirmar/Cancelar. `proveedor_simular_envio`
   solo escribe el archivo si recibe `confirmado: true`.
6. Toda tool call queda en el historial visible del chat y en `out/<caso>/log.jsonl`
   (CA4/RN5). Un error del proveedor LLM se traduce a lenguaje claro y la sesión
   no muere (CA5).

## 4. Elección del modelo

- **Proveedor:** OpenRouter (API compatible con OpenAI). Permite cambiar de modelo
  con una sola variable de entorno sin tocar código, y centraliza facturación.
- **Modelo:** `openai/gpt-4o`. Buen soporte de *tool calling*, respuestas en
  español correctas y latencia razonable.
- **Costo estimado por caso procesado:** un caso completo encadena ~5 llamadas a
  herramientas, es decir ~6 invocaciones al modelo. El contexto (system prompt +
  conocimiento + resultados de herramientas) ronda **8–15k tokens de entrada** y
  **1–2k de salida** acumulados. Con las tarifas públicas de gpt-4o vía OpenRouter
  (~US$2.50 / 1M entrada, ~US$10 / 1M salida), sale **≈ US$0.03–0.06 por caso**.
  Con `openai/gpt-4o-mini` bajaría a < US$0.005 por caso. La `temperature` es 0
  para maximizar determinismo.

## 5. Diseño del portal web (formato "portal")

El formato `portal` (caso `pa-logistica-istmo`) **no se automatiza**; se diseña:

- **Estrategia:** un navegador controlado por el agente (Playwright) sería la vía
  técnica, pero con límites serios: **CAPTCHA**, **MFA**, y **cambios de layout**
  rompen la automatización y son frágiles de mantener. Alternativas: RPA (misma
  fragilidad) o una extensión de navegador que rellena campos con el humano
  presente (más robusta frente a MFA/CAPTCHA porque el humano resuelve el reto).
- **Credenciales:** viven en un gestor de secretos (p. ej. Azure Key Vault),
  **nunca** en el repo, el prompt ni los logs. Las ingresa el humano en su sesión;
  el agente jamás las ve.
- **Reparto humano/agente:** el agente prepara todos los valores en un archivo
  copiable (`out/<caso>/valores-portal.md`) y da instrucciones. **El humano** abre
  el portal, inicia sesión (credenciales + MFA), pega los valores y hace clic en
  "Enviar". El ingreso de credenciales y el envío final son **siempre humanos**.

En este reto, la herramienta `proveedor_generar_formulario` detecta `portal`,
responde "formato no soportado para llenado automático" y genera el `.md` copiable.

## 6. Decisiones y trade-offs

1. **`tsx` en runtime en vez de compilar a JS.**
   - *Elegido:* ejecutar TypeScript directo con `tsx` (dev y prod).
   - *Descartado:* `tsc` → `dist/*.js`. Añade un paso de build del backend y
     complica los imports con extensión `.ts`.
   - *Por qué:* menos fricción, un solo flujo; el costo es incluir `tsx` y las
     deps en la imagen (aceptable para este tamaño).

2. **Recalcular el mapeo en cada herramienta en vez de confiar en el que pase el
   modelo.**
   - *Elegido:* `generar_formulario` y `armar_paquete` recalculan el mapeo desde
     los fixtures.
   - *Descartado:* usar el `mapeo` que el modelo reenvía como argumento.
   - *Por qué:* las herramientas son la fuente de verdad; así el modelo no puede
     "colar" un valor inventado (RN mitigada por diseño, no solo por el prompt).

3. **Renderizador de Markdown propio en el front (sin librería).**
   - *Elegido:* un parser mínimo (`web/Markdown.tsx`) que soporta tablas,
     encabezados y listas, con colores por estado de celda.
   - *Descartado:* `react-markdown` + `remark-gfm`.
   - *Por qué:* evita ~10 dependencias y el riesgo de `dangerouslySetInnerHTML`;
     el subconjunto que el agente produce es acotado. El costo es menos cobertura
     de Markdown (suficiente aquí).

4. *(Extra)* **Carga opcional de la clave desde Azure Key Vault.**
   - El backend lee la clave de Key Vault si `KEY_VAULT_URI` está presente
     (managed identity), y del `.env` en local. Un solo código, dos entornos.

## 7. Supuestos

- Los fixtures representan la variabilidad real; en producción habrá plantillas
  peores (celdas combinadas, etiquetas con typos).
- El repositorio maestro está actualizado; en producción necesita un dueño del dato.
- "Identificación tributaria/NIT/RUC/RTN" mapean todas al `nit` del maestro
  (glosario), y para países ≠ CO se marca `requiere_confirmacion` (RN1).
- Un campo de plantilla xlsx se considera obligatorio (las plantillas Excel del
  reto no traen la bandera `obligatorio`).
- "Enviar" es solo simulación local (`ENVIO-SIMULADO.md`); no hay integración real.

## 8. Cobertura de historias de usuario

| HU | Estado | Nota / qué falta para producción |
|---|---|---|
| HU-1 Leer la solicitud | ✅ Hecho | Detecta país, formato, campos, soportes; marca identificador ambiguo. |
| HU-2 Mapear campos | ✅ Hecho | Estados lleno/faltante/requiere_confirmacion; glosario; nunca inventa. |
| HU-3 Generar formulario | ✅ Hecho | xlsx (P0) y pdf (P1) reales; portal (P2) genera valores copiables. |
| HU-4 Armar paquete | ✅ Hecho | checklist + borrador-correo + copia de soportes; `listo_para_firma`. |
| HU-5 Manejo de errores | ✅ Hecho | Herramientas `{ok:false,error}`, nunca lanzan; LLM con timeout y mensaje claro. |

Para producción faltaría: AcroForm real en PDF, soporte de celdas combinadas en
Excel, persistencia de sesiones, y la automatización/asistencia del portal.

## 9. Uso de IA

- **Asistente usado:** Kiro (agente de IA sobre el modelo actual) para construir
  el proyecto de principio a fin: estructura, herramientas, ciclo del agente,
  adaptador LLM, front, Dockerfile, documentación y verificación.
- **Para qué:** diseño de la arquitectura por capas, implementación de las 5
  herramientas tipadas, el bucle del agente, el front React y la integración con
  Key Vault; además de ejecutar y verificar `npm run demo`, `typecheck`, el build
  del front y el health check.
- **Qué se descartó de lo propuesto y por qué:**
  - Un `overrides` de npm para una dependencia transitiva rota: se descartó al
    ver que la causa real era una versión antigua de `tsx`; se **actualizó tsx**
    (arreglo de raíz, no parche).
  - `react-markdown`/`remark-gfm`: se descartó por peso y por preferir un parser
    propio acotado y sin HTML crudo.
- **Responsabilidad:** cada línea entregada es explicable y fue revisada; la IA
  aceleró la escritura, no sustituyó las decisiones de diseño.

## 10. Riesgos en producción y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" un campo faltante con un valor plausible. | Las herramientas son la única fuente de valores y recalculan el mapeo; el prompt prohíbe valores fuera del mapeo. |
| Fuga de la clave del modelo. | Clave solo en env/Key Vault; nunca en front, repo ni logs; `/api/health` no la expone. |
| Costo descontrolado por un usuario. | Tope de iteraciones por turno y tope de tokens por sesión, configurables. |
| Datos bancarios expuestos en el correo. | RN2: nunca se incluyen en `borrador-correo.md` (verificado). |
| Soporte vencido/ausente pasa a firma. | RN3: bloquea `listo_para_firma` y se lista en el checklist (verificado). |
| Portales con CAPTCHA/MFA. | El humano opera el portal; el agente solo prepara los valores. |
| Plantillas reales más sucias que los fixtures. | Validación con zod + estados explícitos; en producción, pruebas con plantillas reales y un dueño del dato. |
