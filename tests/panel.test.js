'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { prepararEntorno, lecturaValida } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');

let env;

before(async () => {
  env = await prepararEntorno();
});

after(async () => {
  if (env) await env.cerrar();
});

beforeEach(async () => {
  await env.pool.query('TRUNCATE lecturas');
});

const INTERVALO_PANEL_MS = 10000;

/**
 * Abre el panel en jsdom, ejecuta app.js y apunta fetch al servidor real.
 * Registra los retrasos de setTimeout para comprobar el intervalo de 10 s.
 * Con acelerar=true, el siguiente ciclo de 10 s se ejecuta a los 50 ms.
 */
function abrirPanel(baseUrl, { acelerar = false } = {}) {
  const dom = new JSDOM(HTML, { url: `${baseUrl}/`, runScripts: 'outside-only' });
  const ventana = dom.window;

  const retrasos = [];
  const setTimeoutReal = ventana.setTimeout.bind(ventana);
  ventana.setTimeout = (fn, ms, ...resto) => {
    retrasos.push(ms);
    const retraso = acelerar && ms === INTERVALO_PANEL_MS ? 50 : ms;
    return setTimeoutReal(fn, retraso, ...resto);
  };
  ventana.fetch = (ruta, opciones) => fetch(new URL(ruta, baseUrl), opciones);

  ventana.eval(APP_JS);

  const $ = (id) => ventana.document.getElementById(id);
  return { ventana, $, retrasos, cerrar: () => ventana.close() };
}

async function esperarHasta(condicion, { tiempo = 4000, descripcion = 'condición' } = {}) {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > tiempo) {
      throw new Error(`Tiempo agotado esperando: ${descripcion}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function enviarLectura(lectura) {
  const res = await fetch(`${env.baseUrl}/api/lecturas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.token}` },
    body: JSON.stringify(lectura),
  });
  assert.equal(res.status, 201);
}

describe('Panel: visualización de lecturas', () => {
  it('muestra la lectura de ejemplo, el dispositivo, la fecha y el historial', async () => {
    await enviarLectura(lecturaValida());

    const panel = abrirPanel(env.baseUrl);
    try {
      await esperarHasta(() => panel.$('temperatura').textContent !== '—', {
        descripcion: 'la temperatura se muestra',
      });

      assert.equal(panel.$('temperatura').textContent, '28.5 °C');
      assert.equal(panel.$('humedad').textContent, '65 %');
      assert.equal(panel.$('dispositivo').textContent, 'esp8266-rancho-01');
      assert.match(panel.$('fecha').textContent, /2026/);
      assert.equal(panel.$('espera').hidden, true);
      assert.equal(panel.$('alerta').hidden, true);
      assert.match(panel.$('conexion').textContent, /^Actualizado/);

      const filas = panel.ventana.document.querySelectorAll('#historial tr');
      assert.equal(filas.length, 1);
      const celdas = [...filas[0].querySelectorAll('td')].map((td) => td.textContent);
      assert.equal(celdas[1], 'esp8266-rancho-01');
      assert.equal(celdas[2], '28.5');
      assert.equal(celdas[3], '65');
      assert.equal(panel.$('historial-vacio').hidden, true);
    } finally {
      panel.cerrar();
    }
  });

  it('consulta de nuevo cada 10 segundos', async () => {
    const panel = abrirPanel(env.baseUrl);
    try {
      await esperarHasta(() => panel.retrasos.includes(10000), {
        descripcion: 'se programa la siguiente consulta a 10 s',
      });
      assert.ok(panel.retrasos.every((ms) => ms === 10000));
    } finally {
      panel.cerrar();
    }
  });

  it('muestra una lectura nueva en una consulta posterior', async () => {
    const panel = abrirPanel(env.baseUrl, { acelerar: true });
    try {
      await esperarHasta(() => panel.$('espera').hidden === false, { descripcion: 'carga inicial sin datos' });

      await enviarLectura(lecturaValida({ temperatura: 31.2, humedad: 58 }));

      await esperarHasta(() => panel.$('temperatura').textContent === '31.2 °C', {
        descripcion: 'aparece la lectura nueva en un ciclo de actualización',
      });
      assert.equal(panel.$('humedad').textContent, '58 %');
      assert.equal(panel.$('espera').hidden, true);
    } finally {
      panel.cerrar();
    }
  });
});

describe('Panel: estados', () => {
  it('muestra estado de espera cuando todavía no hay datos', async () => {
    const panel = abrirPanel(env.baseUrl);
    try {
      await esperarHasta(() => panel.$('espera').hidden === false, { descripcion: 'mensaje de espera' });

      assert.equal(panel.$('temperatura').textContent, '—');
      assert.equal(panel.$('humedad').textContent, '—');
      assert.equal(panel.$('dispositivo').textContent, '—');
      assert.equal(panel.$('fecha').textContent, '—');
      assert.equal(panel.$('historial-vacio').hidden, false);
      assert.equal(panel.ventana.document.querySelectorAll('#historial tr').length, 0);
      assert.equal(panel.$('alerta').hidden, true);
    } finally {
      panel.cerrar();
    }
  });

  it('muestra un error visible si la consulta falla', async () => {
    // Puerto libre sin servidor: la consulta falla de verdad.
    const cerrado = net.createServer();
    await new Promise((r) => cerrado.listen(0, '127.0.0.1', r));
    const { port } = cerrado.address();
    await new Promise((r) => cerrado.close(r));

    const panel = abrirPanel(`http://127.0.0.1:${port}`);
    try {
      await esperarHasta(() => panel.$('alerta').hidden === false, { descripcion: 'aparece el error' });

      assert.match(panel.$('alerta').textContent, /No se pudo consultar el servidor/);
      assert.equal(panel.$('alerta').getAttribute('role'), 'alert');
      assert.equal(panel.$('conexion').textContent, 'Sin conexión con el servidor');
    } finally {
      panel.cerrar();
    }
  });
});
