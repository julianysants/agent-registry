# Agente conversacional — Registro como Proveedor

Agente que automatiza el llenado de formularios de registro como proveedor:
lee la solicitud de un cliente, llena el formulario desde el repositorio maestro,
arma el paquete de soportes y deja todo listo para la firma humana. **Nunca firma
ni envía por su cuenta.**

Stack: **TypeScript + Node 20** (ejecutado con `tsx`), **Express** en el backend,
**React + Vite** en el front, **zod** para las herramientas y **OpenRouter**
(API compatible con OpenAI) como proveedor LLM.

---

## Requisitos

- Node 20+ (probado con v20.20) y npm.
- Una clave de [OpenRouter](https://openrouter.ai/keys) (solo para el chat; la
  demo funciona sin clave).

## Puesta en marcha (un comando)

```bash
npm install
cp .env.example .env     # edita .env y pon tu OPENROUTER_API_KEY
npm run dev
```

`npm run dev` levanta **backend** (http://localhost:8787) y **front**
(http://localhost:5173) a la vez. Abre http://localhost:5173.

### Alternativa: un solo proceso (producción local)

```bash
npm run build     # compila el front a dist/
npm start         # backend en :8787 sirviendo el front estático
```

Abre http://localhost:8787.

## Variables de entorno

Todas en `.env` (ver `.env.example`). La clave del modelo **solo** vive aquí o en
Azure Key Vault; nunca en el front, el repo ni los logs.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `OPENROUTER_API_KEY` | Sí (para el chat) | Clave de OpenRouter. |
| `OPENROUTER_BASE_URL` | No | Default `https://openrouter.ai/api/v1`. |
| `LLM_MODEL` | No | Default `openai/gpt-4o`. |
| `MAX_ITERACIONES` | No | Tope de iteraciones herramienta↔modelo por turno (25). |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (120000). |
| `LLM_TIMEOUT_MS` | No | Timeout del proveedor LLM (60000). |
| `PORT` | No | Puerto del backend (8787). |
| `FECHA_EJECUCION` | No | Fecha `YYYY-MM-DD` para calcular vigencias (default: hoy). |
| `KEY_VAULT_URI` | No | Solo Azure: URI del Key Vault para leer la clave. |
| `OPENROUTER_SECRET_NAME` | No | Nombre del secreto en Key Vault (`openrouter-api-key`). |

## Demo sin modelo (verificación de las herramientas)

Ejecuta las 5 herramientas para los 4 casos **sin clave ni modelo** e imprime un
resumen por caso. Los artefactos quedan en `out/<caso>/`.

```bash
npm run demo
```

Es determinista: fija `FECHA_EJECUCION=2026-10-28` y limpia `out/` al inicio.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run demo` | Corre las herramientas para los 4 casos sin modelo. |
| `npm run dev` | Backend + front en modo desarrollo. |
| `npm run build` | Compila el front a `dist/`. |
| `npm start` | Backend sirviendo el front estático. |
| `npm run typecheck` | Chequeo de tipos (TypeScript estricto). |
| `npm run verify:modulo` | Verifica que `modulo/` usa las mismas piezas que la app. |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ ok, sessionId, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, configurado }` (sin exponer claves) |

## Prueba rápida en el chat

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

Verás las llamadas a herramientas en el chat y el paquete en `out/ec-corp-andina/`.
Un segundo mensaje "sí, envía" produce `ENVIO-SIMULADO.md` solo tras tu confirmación.

## Estructura

```
reto-01/
├── agent/prompt.md                 # comportamiento (system prompt)
├── src/
│   ├── server.ts                   # API HTTP
│   ├── agente/ciclo.ts             # ciclo del agente
│   ├── llm/                        # adaptador LLM (interfaz + OpenRouter)
│   ├── tools/                      # herramientas tipadas (zod)
│   ├── config/secretos.ts          # carga opcional desde Azure Key Vault
│   └── knowledge/                  # conocimiento del proceso
├── web/                            # front React/Vite
├── modulo/                         # agente empaquetado (bonus)
├── fixtures/                       # datos del reto (solo lectura)
├── out/                            # artefactos generados
├── demo.ts
├── Dockerfile
└── DEPLOY-AZURE.md                 # despliegue en Azure Container Apps
```

## Despliegue

Ver [`DEPLOY-AZURE.md`](./DEPLOY-AZURE.md) para desplegar en Azure Container Apps
con la clave en Key Vault (managed identity).

## Link de prueba

> Pendiente de desplegar. Tras seguir `DEPLOY-AZURE.md`, la URL será el FQDN de la
> Container App (`https://reto01-proveedor.redmushroom-926fc8ab.eastus.azurecontainerapps.io`). Mientras tanto, se ejecuta en local con
> `npm run dev`.
