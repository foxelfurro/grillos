'use strict';

const UNA_HORA = 60 * 60 * 1000;

function iniciarLimpieza(db) {
  let detenida = false;
  let temporizador;

  async function limpiar() {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM lecturas WHERE recibido_en < now() - interval '168 hours'"
      );
      console.log(`Limpieza de lecturas: ${rowCount} eliminadas.`);
    } catch (err) {
      console.error('Falló la limpieza de lecturas:', err.message);
    }
    if (!detenida) temporizador = setTimeout(limpiar, UNA_HORA);
  }

  void limpiar();
  return () => {
    detenida = true;
    clearTimeout(temporizador);
  };
}

module.exports = { iniciarLimpieza };
