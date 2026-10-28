import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/**
 * Carga secretos desde Azure Key Vault y los coloca en process.env, SOLO si
 * está configurada la variable KEY_VAULT_URI. En desarrollo local (sin esa
 * variable) no hace nada y se usa el .env como de costumbre.
 *
 * Patrón:
 *  - En Azure Container Apps, DefaultAzureCredential usa la managed identity
 *    del contenedor (sin claves en la imagen ni en el repo).
 *  - En local, DefaultAzureCredential usa las credenciales de `az login`.
 *
 * La clave del modelo nunca se imprime ni se expone; solo se inyecta en memoria.
 */
export async function cargarSecretosDesdeKeyVault(): Promise<void> {
  const vaultUrl = process.env.KEY_VAULT_URI?.trim();
  if (!vaultUrl) {
    // Sin Key Vault configurado: se usa el entorno/.env tal cual.
    return;
  }

  const secretName =
    process.env.OPENROUTER_SECRET_NAME?.trim() || "openrouter-api-key";

  try {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(vaultUrl, credential);
    const secret = await client.getSecret(secretName);
    if (secret.value) {
      process.env.OPENROUTER_API_KEY = secret.value;
      console.log(
        `[secretos] OPENROUTER_API_KEY cargada desde Key Vault (secreto "${secretName}")`,
      );
    } else {
      console.warn(
        `[secretos] el secreto "${secretName}" existe pero está vacío en Key Vault`,
      );
    }
  } catch (e) {
    // No imprimimos el valor; solo el motivo del fallo.
    const msg = e instanceof Error ? e.message : "error desconocido";
    console.error(
      `[secretos] no se pudo leer el secreto desde Key Vault (${vaultUrl}): ${msg}`,
    );
  }
}
