'use strict';

const crypto = require('node:crypto');

const PATRON_BEARER = /^Bearer\s+(\S+)\s*$/i;

function sha256(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest();
}

/**
 * Devuelve una función que compara la cabecera Authorization con el token
 * esperado. Compara hashes de longitud fija con timingSafeEqual para no
 * filtrar información por tiempo de respuesta.
 */
function crearVerificadorToken(tokenEsperado) {
  const hashEsperado = sha256(tokenEsperado);

  return function verificarCabecera(cabecera) {
    if (typeof cabecera !== 'string') return false;
    const coincidencia = PATRON_BEARER.exec(cabecera);
    if (!coincidencia) return false;
    return crypto.timingSafeEqual(sha256(coincidencia[1]), hashEsperado);
  };
}

/** Middleware de Express que responde 401 si el Bearer no coincide. */
function requerirToken(verificarCabecera) {
  return function middlewareAutenticacion(req, res, next) {
    if (!verificarCabecera(req.get('authorization'))) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Token ausente o inválido.' });
    }
    return next();
  };
}

module.exports = { crearVerificadorToken, requerirToken };
