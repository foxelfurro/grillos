'use strict';

const path = require('node:path');
const express = require('express');

const { crearVerificadorToken, requerirToken } = require('./auth');
const { validarLectura } = require('./validacion');
const { insertarLectura, ultimaLectura, listarHistorial } = require('./lecturas');

// Una lectura válida ocupa unos 200 bytes; 1 KB deja margen de sobra.
const TAMANO_MAX_CUERPO = '1kb';

/**
 * Construye la aplicación Express.
 * @param {object} opciones
 * @param {import('pg').Pool} opciones.db  Pool de PostgreSQL (o algo con .query()).
 * @param {string} opciones.ingestToken    Token Bearer que solo conocen el puente y el servidor.
 */
function crearApp({ db, ingestToken }) {
  const app = express();
  app.disable('x-powered-by');

  const verificarToken = crearVerificadorToken(ingestToken);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ estado: 'ok' });
    } catch (err) {
      console.error('Health check: la base de datos no responde:', err.message);
      res.status(503).json({ estado: 'error', base_de_datos: 'no disponible' });
    }
  });

  // Escritura: primero se valida el token (401) y después el cuerpo (400/413).
  app.post(
    '/api/lecturas',
    requerirToken(verificarToken),
    express.json({ limit: TAMANO_MAX_CUERPO, strict: true }),
    async (req, res) => {
      const resultado = validarLectura(req.body);
      if (!resultado.ok) {
        return res.status(400).json({ error: 'Cuerpo inválido.', detalles: resultado.errores });
      }

      const { creada } = await insertarLectura(db, resultado.valor);
      console.log(`Lectura ${resultado.valor.id} ${creada ? 'guardada' : 'duplicada (ignorada)'}`);

      return res.status(creada ? 201 : 200).json({
        id: resultado.valor.id,
        estado: creada ? 'guardada' : 'duplicada',
      });
    }
  );

  // Lectura: públicas para la demo.
  app.get('/api/lecturas/ultima', async (req, res) => {
    res.json(await ultimaLectura(db));
  });

  app.get('/api/lecturas', async (req, res) => {
    res.json(await listarHistorial(db));
  });

  // Panel estático: index.html, app.js y styles.css.
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada.' });
  });

  // Manejo de errores: cuerpos mal formados o demasiado grandes, y fallos internos.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'El cuerpo excede el tamaño permitido.' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Cuerpo inválido: el JSON no se puede leer.' });
    }
    console.error('Error no controlado:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}

module.exports = { crearApp, TAMANO_MAX_CUERPO };
