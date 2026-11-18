'use strict';

const { leerConfig } = require('./config');
const { crearPool } = require('./db');
const { migrar } = require('./migrate');
const { iniciarLimpieza } = require('./limpieza');
const { crearApp } = require('./app');

// Render asigna PORT; 0.0.0.0 es obligatorio para aceptar tráfico externo.
const HOST = '0.0.0.0';

async function main() {
  const config = leerConfig();
  const pool = crearPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });

  const aplicadas = await migrar(pool);
  if (aplicadas.length > 0) {
    console.log(`Migraciones aplicadas: ${aplicadas.join(', ')}`);
  }

  const detenerLimpieza = iniciarLimpieza(pool);
  const app = crearApp({ db: pool, ingestToken: config.ingestToken });
  const server = app.listen(config.port, HOST, () => {
    console.log(`Telemetría escuchando en http://${HOST}:${config.port}`);
  });

  const apagar = (senal) => {
    detenerLimpieza();
    console.log(`Recibido ${senal}; cerrando el servidor.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err.message);
  process.exit(1);
});
