'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DIR_MIGRACIONES = path.join(__dirname, '..', 'migrations');
// Bloqueo consultivo para que dos procesos no migren a la vez.
const CLAVE_BLOQUEO = 842001;

/**
 * Aplica las migraciones SQL pendientes en orden alfabético.
 * Todo ocurre en una sola transacción: o se aplican todas las pendientes o
 * ninguna. El bloqueo es de transacción (pg_advisory_xact_lock) para que
 * funcione también con el link "pooled" de Neon (PgBouncer).
 * Devuelve la lista de archivos aplicados en esta ejecución.
 */
async function migrar(pool) {
  const client = await pool.connect();
  const aplicadasAhora = [];
  let archivoActual = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [CLAVE_BLOQUEO]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre      TEXT PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT nombre FROM schema_migrations');
    const yaAplicadas = new Set(rows.map((r) => r.nombre));

    const archivos = (await fs.readdir(DIR_MIGRACIONES))
      .filter((nombre) => nombre.endsWith('.sql'))
      .sort();

    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) continue;
      archivoActual = archivo;
      const sql = await fs.readFile(path.join(DIR_MIGRACIONES, archivo), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
      aplicadasAhora.push(archivo);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(
      archivoActual ? `La migración ${archivoActual} falló: ${err.message}` : `No se pudo migrar: ${err.message}`
    );
  } finally {
    client.release();
  }
  return aplicadasAhora;
}

module.exports = { migrar };

// Uso manual: npm run migrate (solo necesita DATABASE_URL)
if (require.main === module) {
  const { crearPool } = require('./db');

  (async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('Falta la variable de entorno DATABASE_URL.');
    }
    const pool = crearPool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL,
    });
    try {
      const aplicadas = await migrar(pool);
      console.log(
        aplicadas.length
          ? `Migraciones aplicadas: ${aplicadas.join(', ')}`
          : 'La base de datos ya estaba al día.'
      );
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
