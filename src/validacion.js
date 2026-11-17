'use strict';

// UUID canónico (8-4-4-4-12), versión 1 a 8 y variante RFC 4122/9562.
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATRON_DISPOSITIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Fecha ISO 8601 en UTC con sufijo Z, por ejemplo 2026-11-17T21:30:00.000Z.
const PATRON_FECHA_UTC = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const ANIO_MINIMO = 2020;
const ANIO_MAXIMO = 2100;

const CAMPOS_PERMITIDOS = ['id', 'dispositivo', 'capturado_en', 'temperatura', 'humedad'];

function esFechaUtcValida(texto) {
  const m = PATRON_FECHA_UTC.exec(texto);
  if (!m) return false;
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return false;
  // Un reloj sin sincronizar produce fechas absurdas (1970, año 0000) que además
  // PostgreSQL puede no aceptar. Se limita a un rango razonable.
  const anio = Number(m[1]);
  if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) return false;
  // Rechaza fechas que el motor reajusta, como 2026-02-30.
  return fecha.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Valida el cuerpo del POST /api/lecturas según el contrato del puente.
 * Devuelve { ok: true, valor } o { ok: false, errores }.
 */
function validarLectura(cuerpo) {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return { ok: false, errores: ['El cuerpo debe ser un objeto JSON.'] };
  }

  const errores = [];

  const extra = Object.keys(cuerpo).filter((campo) => !CAMPOS_PERMITIDOS.includes(campo));
  if (extra.length > 0) {
    errores.push(`Campos no permitidos: ${extra.join(', ')}.`);
  }

  const { id, dispositivo, capturado_en: capturadoEn, temperatura, humedad } = cuerpo;

  if (typeof id !== 'string' || !PATRON_UUID.test(id)) {
    errores.push('id debe ser un UUID válido.');
  }

  if (typeof dispositivo !== 'string' || !PATRON_DISPOSITIVO.test(dispositivo)) {
    errores.push('dispositivo debe tener de 1 a 64 caracteres: letras, números, punto, guion o guion bajo.');
  }

  if (typeof capturadoEn !== 'string' || !esFechaUtcValida(capturadoEn)) {
    errores.push('capturado_en debe ser una fecha UTC ISO 8601 terminada en Z, entre 2020 y 2100.');
  }

  if (typeof temperatura !== 'number' || !Number.isFinite(temperatura)) {
    errores.push('temperatura debe ser un número finito.');
  }

  if (typeof humedad !== 'number' || !Number.isFinite(humedad) || humedad < 0 || humedad > 100) {
    errores.push('humedad debe ser un número entre 0 y 100.');
  }

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  return {
    ok: true,
    valor: { id, dispositivo, capturado_en: capturadoEn, temperatura, humedad },
  };
}

module.exports = { validarLectura };
