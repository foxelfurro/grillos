'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { opcionesConexion } = require('../src/db');

const NEON =
  'postgresql://usuario:clave@ep-ejemplo-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('Conexión por link (Neon)', () => {
  it('el link de Neon activa TLS con verificación de certificado', () => {
    const o = opcionesConexion(NEON, undefined);
    assert.deepEqual(o.ssl, { rejectUnauthorized: true });
    assert.ok(!o.connectionString.includes('sslmode'));
    assert.match(o.connectionString, /ep-ejemplo-123456-pooler\.us-east-2\.aws\.neon\.tech\/neondb/);
    assert.match(o.connectionString, /channel_binding=require/);
    assert.match(o.connectionString, /usuario:clave@/);
  });

  it('un host remoto sin sslmode también usa TLS', () => {
    const o = opcionesConexion('postgresql://u:c@ep-x.neon.tech/neondb', undefined);
    assert.deepEqual(o.ssl, { rejectUnauthorized: true });
  });

  it('localhost no usa TLS por defecto', () => {
    assert.equal(opcionesConexion('postgres://u:c@localhost:5432/db', undefined).ssl, false);
    assert.equal(opcionesConexion('postgres://u:c@127.0.0.1:5432/db', undefined).ssl, false);
  });

  it('sslmode=disable y DATABASE_SSL mandan sobre el valor automático', () => {
    assert.equal(opcionesConexion('postgres://u:c@db.ejemplo.com/db?sslmode=disable', undefined).ssl, false);
    assert.equal(opcionesConexion(NEON, 'false').ssl, false);
    assert.deepEqual(opcionesConexion('postgres://u:c@localhost/db', 'true').ssl, { rejectUnauthorized: true });
  });

  it('rechaza un link que no es de PostgreSQL', () => {
    assert.throws(() => opcionesConexion('no es una url', undefined), /DATABASE_URL/);
    assert.throws(() => opcionesConexion('https://neon.tech/db', undefined), /postgresql:\/\//);
  });
});
