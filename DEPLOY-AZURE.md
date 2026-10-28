# Despliegue en Azure Container Apps

Guía para desplegar el agente en **Azure Container Apps (ACA)** leyendo la clave
del modelo desde **Azure Key Vault** con **managed identity** (sin claves en la
imagen, el repo, el front ni los logs).

> Requisitos: `az` CLI (sesión iniciada con `az login`) y una suscripción con
> permisos para crear grupos de recursos, ACA, ACR y Key Vault.

## 0. Variables de trabajo

```bash
RG=rg-reto01
LOC=eastus
ACR=acrreto01$RANDOM          # debe ser único y en minúsculas
ENV=env-reto01
APP=reto01-proveedor
KV=kv-reto01-$RANDOM          # debe ser único
MODEL="openai/gpt-4o-mini"
```

## 1. Grupo de recursos

```bash
az group create -n $RG -l $LOC
```

## 2. Key Vault + secreto con la clave de OpenRouter

```bash
az keyvault create -n $KV -g $RG -l $LOC --enable-rbac-authorization true

# Date permiso para escribir el secreto (rol sobre tu propio usuario).
ME=$(az ad signed-in-user show --query id -o tsv)
az role assignment create \
  --assignee "$ME" \
  --role "Key Vault Secrets Officer" \
  --scope $(az keyvault show -n $KV -g $RG --query id -o tsv)

# Guarda la clave (pégala cuando lo pida; NO queda en el historial del repo).
read -s OPENROUTER_KEY && az keyvault secret set \
  --vault-name $KV --name openrouter-api-key --value "$OPENROUTER_KEY"
unset OPENROUTER_KEY
```

## 3. Container Registry y build de la imagen

ACR construye la imagen en la nube (no necesitas Docker local):

```bash
az acr create -n $ACR -g $RG --sku Basic --admin-enabled false
az acr build -r $ACR -t $APP:latest .
```

## 4. Entorno de Container Apps

```bash
az extension add --name containerapp --upgrade
az containerapp env create -n $ENV -g $RG -l $LOC
```

## 5. Crear la Container App con managed identity

```bash
KV_URI=$(az keyvault show -n $KV -g $RG --query properties.vaultUri -o tsv)

az containerapp create \
  -n $APP -g $RG --environment $ENV \
  --image $ACR.azurecr.io/$APP:latest \
  --registry-server $ACR.azurecr.io \
  --system-assigned \
  --target-port 8787 \
  --ingress external \
  --min-replicas 1 --max-replicas 2 \
  --env-vars \
      KEY_VAULT_URI=$KV_URI \
      OPENROUTER_SECRET_NAME=openrouter-api-key \
      LLM_MODEL="$MODEL" \
      MAX_ITERACIONES=25 \
      MAX_TOKENS_SESION=120000 \
      LLM_MAX_TOKENS_RESPUESTA=1024
```

## 6. Dar a la app acceso de lectura al Key Vault

```bash
APP_PID=$(az containerapp show -n $APP -g $RG \
  --query identity.principalId -o tsv)

az role assignment create \
  --assignee "$APP_PID" \
  --role "Key Vault Secrets User" \
  --scope $(az keyvault show -n $KV -g $RG --query id -o tsv)
```

Reinicia una revisión para que tome el rol si fuera necesario:

```bash
az containerapp revision restart -n $APP -g $RG \
  --revision $(az containerapp revision list -n $APP -g $RG --query "[0].name" -o tsv)
```

## 7. Obtener la URL pública

```bash
az containerapp show -n $APP -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv
```

Abre `https://<fqdn>` para el chat y `https://<fqdn>/api/health` para el estado.

## Notas de seguridad

- La clave vive **solo** en Key Vault. El contenedor la lee en memoria al
  arrancar vía managed identity; nunca se escribe en la imagen ni en logs.
- `--registry-server` con managed identity evita credenciales de ACR en claro
  (ACA usa la identidad para `acr pull` si asignas el rol `AcrPull`; con
  `az acr build` y `--system-assigned` basta asignar ese rol si el pull falla):

  ```bash
  az role assignment create --assignee "$APP_PID" --role AcrPull \
    --scope $(az acr show -n $ACR -g $RG --query id -o tsv)
  ```

## Limpieza

```bash
az group delete -n $RG --yes --no-wait
```
