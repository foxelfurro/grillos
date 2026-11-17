'use strict';

const crypto = require('node:crypto');

const { crearPool } = require('../src/db');
const { migrar } = require('../src/migrate');
const { crearApp } = require('../src/app');

/**
 * Levanta la aplicación contra TEST_DATABASE_URL en un puerto libre.
 * Las pruebas vacían la tabla lecturas, por eso exigimos una base dedicada.
 */
async function prepararEntorno() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Define TEST_DATABASE_URL apuntando a una base de datos de pruebas. ' +
        'Las pruebas vacían la tabla lecturas, no uses la base de producción.'
    );
  }

  const pool = crearPool({ connectionString, ssl: process.env.DATABASE_SSL, max: 3 });
  await migrar(pool);
  await pool.query('TRUNCATE lecturas');

  const token = crypto.randomBytes(32).toString('hex');
  const app = crearApp({ db: pool, ingestToken: token });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  return {
    pool,
    token,
    baseUrl: `http://127.0.0.1:${port}`,
    async cerrar() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

/** Lectura que cumple el contrato del puente. */
function lecturaValida(sobrescribir = {}) {
  return {
    id: crypto.randomUUID(),
    dispositivo: 'esp8266-rancho-01',
    capturado_en: '2026-11-17T21:30:00.000Z',
    temperatura: 28.5,
    humedad: 65,
    ...sobrescribir,
  };
}

module.exports = { prepararEntorno, lecturaValida };
