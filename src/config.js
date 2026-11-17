'use strict';

/**
 * Lee y valida la configuración desde variables de entorno.
 * Falla al arrancar si falta algo obligatorio, para no desplegar a medias.
 */
function leerConfig(env = process.env) {
  const faltantes = [];
  if (!env.DATABASE_URL) faltantes.push('DATABASE_URL');
  if (!env.INGEST_TOKEN) faltantes.push('INGEST_TOKEN');
  if (faltantes.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
  }

  if (/\s/.test(env.INGEST_TOKEN)) {
    throw new Error('INGEST_TOKEN no puede contener espacios ni saltos de línea. Revisa que se haya pegado completo y limpio.');
  }

  if (env.INGEST_TOKEN.length < 32) {
    throw new Error(
      'INGEST_TOKEN debe tener al menos 32 caracteres. Genera uno con: openssl rand -hex 32'
    );
  }

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT no es válido: ${env.PORT}`);
  }

  return {
    port,
    databaseUrl: env.DATABASE_URL,
    // 'true', 'false' o sin definir (automático según el link).
    databaseSsl: env.DATABASE_SSL,
    ingestToken: env.INGEST_TOKEN,
  };
}

module.exports = { leerConfig };
