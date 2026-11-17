'use strict';

// Columnas que se devuelven al panel y a los consumidores de la API.
const COLUMNAS = 'id, dispositivo, capturado_en, recibido_en, temperatura, humedad';
const LIMITE_HISTORIAL = 20;

/**
 * Inserta una lectura. Si el UUID ya existe no cambia nada y devuelve
 * creada=false. ON CONFLICT lo resuelve en la base, así que es seguro
 * aunque lleguen dos envíos del mismo UUID al mismo tiempo.
 */
async function insertarLectura(db, lectura) {
  const { rowCount } = await db.query(
    `INSERT INTO lecturas (id, dispositivo, capturado_en, temperatura, humedad)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [lectura.id, lectura.dispositivo, lectura.capturado_en, lectura.temperatura, lectura.humedad]
  );
  return { creada: rowCount === 1 };
}

/** Última lectura por fecha de captura, o null si no hay datos. */
async function ultimaLectura(db) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS}
       FROM lecturas
      ORDER BY capturado_en DESC, id DESC
      LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Las 20 lecturas más recientes; [] si no hay datos. */
async function listarHistorial(db) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS}
       FROM lecturas
      ORDER BY capturado_en DESC, id DESC
      LIMIT $1`,
    [LIMITE_HISTORIAL]
  );
  return rows;
}

module.exports = { insertarLectura, ultimaLectura, listarHistorial, LIMITE_HISTORIAL };
