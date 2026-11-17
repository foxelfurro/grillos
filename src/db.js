'use strict';

const { Pool } = require('pg');

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Convierte DATABASE_URL en opciones para pg.
 *
 * TLS se decide así:
 *  - DATABASE_SSL=true / false manda si está definido.
 *  - Si la URL trae sslmode (Neon lo incluye: ?sslmode=require), se respeta.
 *  - Sin nada de lo anterior: TLS para cualquier host que no sea local.
 *
 * Cuando hay TLS se verifica el certificado del servidor. Neon usa
 * certificados de una CA pública, así que no hace falta configurar nada más.
 * El parámetro sslmode se quita de la URL para que el driver use solo
 * estas opciones.
 */
function opcionesConexion(databaseUrl, sslEnv) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida. Copia el "connection string" completo de Neon.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe empezar con postgresql:// o postgres://');
  }

  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');

  let usarTls;
  if (sslEnv === 'true') usarTls = true;
  else if (sslEnv === 'false') usarTls = false;
  else if (sslmode) usarTls = sslmode !== 'disable';
  else usarTls = !HOSTS_LOCALES.has(url.hostname);

  return {
    connectionString: url.toString(),
    ssl: usarTls ? { rejectUnauthorized: true } : false,
  };
}

/**
 * Crea el pool de conexiones a PostgreSQL a partir del link de conexión.
 */
function crearPool({ connectionString, ssl: sslEnv, max = 5 }) {
  const pool = new Pool({
    ...opcionesConexion(connectionString, sslEnv),
    max,
    // Neon suspende el cómputo cuando no hay actividad; despertarlo tarda un poco.
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  // Neon cierra conexiones inactivas. Sin este manejador, ese cierre
  // tumbaría el proceso; el pool abre una conexión nueva en la siguiente consulta.
  pool.on('error', (err) => {
    console.error('Conexión inactiva cerrada por la base de datos:', err.message);
  });

  return pool;
}

module.exports = { crearPool, opcionesConexion };
