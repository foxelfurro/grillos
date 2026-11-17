'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { prepararEntorno, lecturaValida } = require('./helpers');

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

/**
 * POST /api/lecturas. Por defecto envía el token correcto y JSON.
 * Usa token: null para no enviar Authorization, o authorization para una cabecera exacta.
 */
function postLectura({ body, token = env.token, authorization, contentType = 'application/json' } = {}) {
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;

  const cabecera = authorization !== undefined ? authorization : token === null ? null : `Bearer ${token}`;
  if (cabecera !== null) headers.Authorization = cabecera;

  let cuerpo;
  if (typeof body === 'string') cuerpo = body;
  else if (body !== undefined) cuerpo = JSON.stringify(body);

  return fetch(`${env.baseUrl}/api/lecturas`, { method: 'POST', headers, body: cuerpo });
}

async function contarFilas() {
  const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM lecturas');
  return rows[0].n;
}

describe('GET /health', () => {
  it('responde 200 cuando la base de datos responde', async () => {
    const res = await fetch(`${env.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { estado: 'ok' });
  });
});

describe('POST /api/lecturas: escritura válida', () => {
  it('guarda la lectura y responde 201', async () => {
    const lectura = lecturaValida();
    const res = await postLectura({ body: lectura });

    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: lectura.id, estado: 'guardada' });
    assert.equal(await contarFilas(), 1);

    const { rows } = await env.pool.query('SELECT * FROM lecturas WHERE id = $1', [lectura.id]);
    assert.equal(rows[0].dispositivo, 'esp8266-rancho-01');
    assert.equal(rows[0].temperatura, 28.5);
    assert.equal(rows[0].humedad, 65);
    assert.equal(rows[0].capturado_en.toISOString(), '2026-11-17T21:30:00.000Z');
    assert.ok(rows[0].recibido_en instanceof Date, 'recibido_en lo genera la base de datos');
  });

  it('reintentar el mismo UUID responde 200, no duplica la fila y conserva la recepción original', async () => {
    const lectura = lecturaValida();

    const primera = await postLectura({ body: lectura });
    assert.equal(primera.status, 201);
    const { rows: antes } = await env.pool.query('SELECT recibido_en FROM lecturas WHERE id = $1', [lectura.id]);

    await new Promise((r) => setTimeout(r, 20));

    const reintento = await postLectura({ body: lectura });
    assert.equal(reintento.status, 200);
    assert.deepEqual(await reintento.json(), { id: lectura.id, estado: 'duplicada' });

    assert.equal(await contarFilas(), 1);
    const { rows: despues } = await env.pool.query('SELECT recibido_en FROM lecturas WHERE id = $1', [lectura.id]);
    assert.equal(despues[0].recibido_en.getTime(), antes[0].recibido_en.getTime());
  });

  it('envíos simultáneos del mismo UUID: solo uno crea la fila', async () => {
    const lectura = lecturaValida();
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => postLectura({ body: lectura })));

    const codigos = respuestas.map((r) => r.status).sort();
    assert.deepEqual(codigos, [200, 200, 200, 200, 201]);
    assert.equal(await contarFilas(), 1);
  });
});

describe('POST /api/lecturas: autenticación', () => {
  it('rechaza un token inválido con 401 y no guarda nada', async () => {
    const res = await postLectura({ body: lecturaValida(), token: 'token-equivocado' });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    assert.equal(await contarFilas(), 0);
  });

  it('rechaza una petición sin Authorization con 401', async () => {
    const res = await postLectura({ body: lecturaValida(), token: null });
    assert.equal(res.status, 401);
    assert.equal(await contarFilas(), 0);
  });

  it('rechaza esquemas distintos de Bearer y Bearer sin valor', async () => {
    const casos = [`Basic ${env.token}`, 'Bearer', `Token ${env.token}`, env.token];
    for (const authorization of casos) {
      const res = await postLectura({ body: lecturaValida(), authorization });
      assert.equal(res.status, 401, `Debe rechazar Authorization: "${authorization}"`);
    }
    assert.equal(await contarFilas(), 0);
  });

  it('acepta el esquema Bearer sin distinguir mayúsculas', async () => {
    const res = await postLectura({ body: lecturaValida(), authorization: `bearer ${env.token}` });
    assert.equal(res.status, 201);
  });

  it('autentica antes de validar el cuerpo', async () => {
    const res = await postLectura({ body: { basura: true }, token: 'equivocado' });
    assert.equal(res.status, 401);
  });
});

describe('POST /api/lecturas: cuerpo inválido', () => {
  const sinCampo = (campo) => {
    const l = lecturaValida();
    delete l[campo];
    return l;
  };

  const casos = [
    ['falta id', sinCampo('id')],
    ['falta dispositivo', sinCampo('dispositivo')],
    ['falta capturado_en', sinCampo('capturado_en')],
    ['falta temperatura', sinCampo('temperatura')],
    ['falta humedad', sinCampo('humedad')],
    ['id no es UUID', lecturaValida({ id: 'no-es-un-uuid' })],
    ['id numérico', lecturaValida({ id: 12345 })],
    ['dispositivo vacío', lecturaValida({ dispositivo: '' })],
    ['dispositivo con espacios', lecturaValida({ dispositivo: 'esp 8266' })],
    ['dispositivo demasiado largo', lecturaValida({ dispositivo: 'a'.repeat(65) })],
    ['fecha sin zona UTC', lecturaValida({ capturado_en: '2026-11-17T21:30:00.000' })],
    ['fecha con desfase en vez de Z', lecturaValida({ capturado_en: '2026-11-17T15:30:00-06:00' })],
    ['fecha imposible', lecturaValida({ capturado_en: '2026-02-30T10:00:00Z' })],
    ['fecha como número', lecturaValida({ capturado_en: 1789675400000 })],
    ['fecha del año 0000', lecturaValida({ capturado_en: '0000-01-01T00:00:00Z' })],
    ['fecha de 1970 (reloj sin sincronizar)', lecturaValida({ capturado_en: '1970-01-01T00:00:10Z' })],
    ['fecha con hora 24', lecturaValida({ capturado_en: '2026-11-17T24:00:00Z' })],
    ['temperatura como texto', lecturaValida({ temperatura: '28.5' })],
    ['temperatura nula', lecturaValida({ temperatura: null })],
    ['humedad mayor que 100', lecturaValida({ humedad: 101 })],
    ['humedad negativa', lecturaValida({ humedad: -0.1 })],
    ['humedad como texto', lecturaValida({ humedad: '65' })],
    ['campo no permitido', lecturaValida({ rssi: -60 })],
    ['cuerpo es un arreglo', []],
    ['cuerpo es null', null],
  ];

  for (const [descripcion, cuerpo] of casos) {
    it(`responde 400: ${descripcion}`, async () => {
      const res = await postLectura({ body: cuerpo });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error);
      assert.equal(await contarFilas(), 0);
    });
  }

  it('responde 400 con números fuera de rango de JSON (1e400)', async () => {
    const crudo = JSON.stringify(lecturaValida()).replace('28.5', '1e400');
    const res = await postLectura({ body: crudo });
    assert.equal(res.status, 400);
    assert.equal(await contarFilas(), 0);
  });

  it('responde 400 si el JSON no se puede leer', async () => {
    const res = await postLectura({ body: '{"id": ' });
    assert.equal(res.status, 400);
    assert.equal(await contarFilas(), 0);
  });

  it('responde 400 si el Content-Type no es JSON', async () => {
    const res = await postLectura({ body: JSON.stringify(lecturaValida()), contentType: 'text/plain' });
    assert.equal(res.status, 400);
    assert.equal(await contarFilas(), 0);
  });

  it('responde 413 si el cuerpo supera el límite', async () => {
    const res = await postLectura({ body: lecturaValida({ dispositivo: 'a'.repeat(5000) }) });
    assert.equal(res.status, 413);
    assert.equal(await contarFilas(), 0);
  });
});

describe('GET /api/lecturas/ultima y /api/lecturas', () => {
  it('responde null y [] cuando todavía no hay datos', async () => {
    const ultima = await fetch(`${env.baseUrl}/api/lecturas/ultima`);
    assert.equal(ultima.status, 200);
    assert.equal(await ultima.text(), 'null');

    const historial = await fetch(`${env.baseUrl}/api/lecturas`);
    assert.equal(historial.status, 200);
    assert.deepEqual(await historial.json(), []);
  });

  it('devuelve la lectura guardada con los campos del contrato', async () => {
    const lectura = lecturaValida();
    await postLectura({ body: lectura });

    const res = await fetch(`${env.baseUrl}/api/lecturas/ultima`);
    const ultima = await res.json();

    assert.equal(ultima.id, lectura.id);
    assert.equal(ultima.dispositivo, 'esp8266-rancho-01');
    assert.equal(ultima.capturado_en, '2026-11-17T21:30:00.000Z');
    assert.equal(ultima.temperatura, 28.5);
    assert.equal(ultima.humedad, 65);
    assert.match(ultima.recibido_en, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('devuelve como máximo 20 lecturas, ordenadas por captura descendente', async () => {
    const valores = [];
    for (let i = 0; i < 25; i++) {
      const minuto = String(i).padStart(2, '0');
      valores.push([crypto.randomUUID(), `2026-11-17T10:${minuto}:00.000Z`, i]);
    }
    await env.pool.query(
      `INSERT INTO lecturas (id, dispositivo, capturado_en, temperatura, humedad)
       SELECT id, 'esp8266-rancho-01', capturado_en::timestamptz, t, 50
         FROM unnest($1::uuid[], $2::text[], $3::float8[]) AS x(id, capturado_en, t)`,
      [valores.map((v) => v[0]), valores.map((v) => v[1]), valores.map((v) => v[2])]
    );

    const historial = await (await fetch(`${env.baseUrl}/api/lecturas`)).json();
    assert.equal(historial.length, 20);
    assert.equal(historial[0].capturado_en, '2026-11-17T10:24:00.000Z');
    assert.equal(historial[19].capturado_en, '2026-11-17T10:05:00.000Z');

    for (let i = 1; i < historial.length; i++) {
      assert.ok(historial[i - 1].capturado_en >= historial[i].capturado_en, 'orden descendente');
    }

    const ultima = await (await fetch(`${env.baseUrl}/api/lecturas/ultima`)).json();
    assert.equal(ultima.id, historial[0].id);
  });

  it('desempata con el id cuando dos lecturas tienen la misma fecha de captura', async () => {
    const mismaFecha = '2026-11-17T12:00:00.000Z';
    const a = lecturaValida({ capturado_en: mismaFecha, temperatura: 20, humedad: 40 });
    const b = lecturaValida({ capturado_en: mismaFecha, temperatura: 21, humedad: 41 });
    await postLectura({ body: a });
    await postLectura({ body: b });

    const historial = await (await fetch(`${env.baseUrl}/api/lecturas`)).json();
    const ids = [a.id, b.id].sort().reverse();
    assert.deepEqual(
      historial.map((l) => l.id),
      ids,
      'con la misma captura, el orden es estable (id descendente)'
    );
  });

  it('responde 404 JSON para rutas /api desconocidas', async () => {
    const res = await fetch(`${env.baseUrl}/api/no-existe`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type').split(';')[0], 'application/json');
  });
});

describe('Página principal', () => {
  it('sirve el panel con los elementos que muestran la lectura', async () => {
    const res = await fetch(`${env.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);

    const html = await res.text();
    for (const id of ['temperatura', 'humedad', 'dispositivo', 'fecha', 'historial', 'espera', 'alerta']) {
      assert.match(html, new RegExp(`id="${id}"`), `falta el elemento #${id}`);
    }
    assert.match(html, /src="\/app\.js"/);

    const js = await (await fetch(`${env.baseUrl}/app.js`)).text();
    assert.match(js, /INTERVALO_MS = 10000/);
  });
});

describe('Fallos de la base de datos', () => {
  const { crearApp } = require('../src/app');
  let server;
  let url;
  const token = 'x'.repeat(40);

  before(async () => {
    const dbCaida = { query: async () => { throw new Error('conexión rechazada'); } };
    const app = crearApp({ db: dbCaida, ingestToken: token });
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  it('el POST no confirma con 2xx si no se pudo guardar', async () => {
    const res = await fetch(`${url}/api/lecturas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(lecturaValida()),
    });
    assert.equal(res.status, 500);
    const texto = await res.text();
    assert.ok(!texto.includes('conexión rechazada'), 'no filtra detalles internos');
  });

  it('/health responde 503 y las lecturas 500', async () => {
    assert.equal((await fetch(`${url}/health`)).status, 503);
    assert.equal((await fetch(`${url}/api/lecturas/ultima`)).status, 500);
    assert.equal((await fetch(`${url}/api/lecturas`)).status, 500);
  });
});
