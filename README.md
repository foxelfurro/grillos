# Telemetría del rancho (MVP)

Un solo Web Service de Node.js (Express) en Render, con PostgreSQL en Neon. Recibe lecturas de temperatura y humedad y muestra en `/` que llegan y se guardan.

```
ESP8266 --MQTT (rancho/sensores, cada 10 s)--> Raspberry Pi (puente) --HTTPS POST--> Render
                                                                                 |
                                               Express --link--> PostgreSQL (Neon)
                                                                |
                                                  Panel en / (consulta cada 10 s)
```

## Estructura

```
migrations/001_crear_lecturas.sql   Esquema de la tabla lecturas
src/server.js                       Arranque: migra, escucha en 0.0.0.0:PORT
src/app.js                          Rutas Express
src/validacion.js                   Validación del contrato del puente
src/auth.js                         Comparación del token Bearer
src/lecturas.js                     Consultas SQL parametrizadas
src/db.js                           Conexión por link (DATABASE_URL), TLS automático
src/migrate.js                      Migraciones (npm run migrate)
public/                             Panel: index.html, styles.css, app.js
tests/                              Pruebas con node:test (API y panel en jsdom)
render.yaml                         Blueprint opcional para Render
```

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Link de conexión de Neon (o de un PostgreSQL local). |
| `INGEST_TOKEN` | Sí | Token Bearer para `POST /api/lecturas`. Mínimo 32 caracteres. Genera uno con `openssl rand -hex 32`. |
| `DATABASE_SSL` | No | Normalmente no se define: TLS se activa solo con el link de Neon y se desactiva en `localhost`. `true`/`false` lo fuerzan. |
| `PORT` | No | Puerto HTTP. Render lo asigna solo. Por defecto `3000`. |
| `TEST_DATABASE_URL` | Solo pruebas | Base o rama dedicada para `npm test`. Las pruebas vacían la tabla `lecturas`. |

## Contrato de ingesta

```http
POST /api/lecturas
Content-Type: application/json
Authorization: Bearer <valor de INGEST_TOKEN>
```

```json
{
  "id": "b7c592e0-a602-431d-b50e-3012f7f9ad87",
  "dispositivo": "esp8266-rancho-01",
  "capturado_en": "2026-11-17T21:30:00.000Z",
  "temperatura": 28.5,
  "humedad": 65
}
```

| Respuesta | Cuándo |
|---|---|
| `201 {"id", "estado":"guardada"}` | La lectura se insertó. |
| `200 {"id", "estado":"duplicada"}` | El `id` ya existía. No se modifica nada. |
| `400` | Cuerpo inválido: JSON mal formado, campos faltantes, tipos incorrectos, valores fuera de rango o campos no permitidos. |
| `401` | Falta el token o no coincide. |
| `413` | El cuerpo supera 1 KB. |

Reglas de validación: `id` es un UUID; `dispositivo` tiene de 1 a 64 caracteres (letras, números, `.`, `-`, `_`); `capturado_en` es una fecha ISO 8601 en UTC terminada en `Z`; `temperatura` es un número finito; `humedad` es un número entre 0 y 100.

Otros endpoints (públicos, para la demo):

- `GET /api/lecturas/ultima`: la lectura más reciente, o `null` si no hay datos.
- `GET /api/lecturas`: las 20 más recientes, ordenadas por `capturado_en` descendente y luego por `id`. Devuelve `[]` si no hay datos.
- `GET /health`: `200` si la base responde; `503` si no.

## Base de datos en Neon

1. En [Neon](https://neon.tech), crea un proyecto. Elige una región cercana a la del Web Service de Render.
2. En el panel del proyecto pulsa **Connect** y copia el **connection string** con *Connection pooling* activado. Tiene esta forma:

   ```
   postgresql://USUARIO:CLAVE@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```
3. Ese link completo es el valor de `DATABASE_URL`. No hace falta nada más: la aplicación activa TLS, verifica el certificado y crea la tabla al arrancar.

El link contiene la contraseña. Va solo en `.env` (local) y en las variables de entorno de Render, nunca en el repositorio.

**Plan gratuito:** el sensor envía una lectura cada 10 s, así que la base nunca llega a suspenderse. Con el cómputo mínimo (0.25 CU) encendido todo el mes se usan unas 180 CU-horas, y el plan gratuito incluye 100 por proyecto al mes; al agotarse, Neon suspende el cómputo hasta el siguiente ciclo. Para una demo de días alcanza; para operar todo el mes hace falta el plan de pago o enviar lecturas con menos frecuencia. Revisa los límites vigentes en la página de precios de Neon.

Neon suspende el cómputo cuando no hay actividad. La primera consulta después de una pausa tarda un poco más; la aplicación espera hasta 15 s y se reconecta sola.

## Ejecutar en local

Requisitos: Node.js 20 o superior.

```bash
npm ci
cp .env.example .env
# Edita .env: DATABASE_URL (link de Neon) e INGEST_TOKEN (openssl rand -hex 32)

npm run migrate    # opcional; el servidor también migra al arrancar
npm run dev        # http://localhost:3000
```

Ejecutar las pruebas. Necesitan una base aparte porque vacían la tabla `lecturas`: una rama de Neon (*Branches > Create branch*) o un PostgreSQL local.

```bash
export TEST_DATABASE_URL='postgresql://...link de la rama de pruebas...'
npm test
```

Verificación manual con `curl` (en otra terminal, con el token del `.env`):

```bash
TOKEN=valor_de_INGEST_TOKEN
URL=http://localhost:3000

# POST válido -> 201
curl -i -X POST "$URL/api/lecturas" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id":"b7c592e0-a602-431d-b50e-3012f7f9ad87","dispositivo":"esp8266-rancho-01","capturado_en":"2026-11-17T21:30:00.000Z","temperatura":28.5,"humedad":65}'

# Reenvío del mismo UUID -> 200, sin fila nueva
curl -i -X POST "$URL/api/lecturas" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id":"b7c592e0-a602-431d-b50e-3012f7f9ad87","dispositivo":"esp8266-rancho-01","capturado_en":"2026-11-17T21:30:00.000Z","temperatura":28.5,"humedad":65}'

# Token inválido -> 401
curl -i -X POST "$URL/api/lecturas" -H "Content-Type: application/json" \
  -H "Authorization: Bearer incorrecto" -d '{}'

# Cuerpo inválido -> 400
curl -i -X POST "$URL/api/lecturas" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"id":"x","humedad":120}'

# Lecturas
curl -s "$URL/api/lecturas/ultima"
curl -s "$URL/api/lecturas"
```

Después abre `http://localhost:3000/` en el navegador: debe mostrar 28.5 °C, 65 % y la lectura en la tabla.

## Despliegue en Render

1. **Base de datos:** crea el proyecto en Neon y copia el link (sección anterior).
2. **Web Service:** en Render, *New > Web Service*, conectando el repositorio de GitHub, con esta configuración:
   - Runtime: `Node`
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/health`
   - Environment:
     - `DATABASE_URL`: el link de conexión de Neon.
     - `INGEST_TOKEN`: pulsa *Generate* o usa un valor de `openssl rand -hex 32`.

   Alternativa: *New > Blueprint* con el archivo `render.yaml`, que crea el servicio, genera el token y te pide el link de Neon.
3. **Comprobar:** cuando termine el despliegue, prueba `https://<servicio>.onrender.com/health` y `https://<servicio>.onrender.com/api/lecturas/ultima` (debe responder `null`). Las migraciones se aplican al arrancar.

## Entrega al operador del puente

Para configurar el puente de la Raspberry Pi, entrega:

- **URL completa del POST:** `https://<servicio>.onrender.com/api/lecturas` (sustituye `<servicio>` por el nombre real del Web Service).
- **Método y cabeceras:** `POST`, `Content-Type: application/json` y `Authorization: Bearer <token>`.
- **Nombre de la variable del token:** `INGEST_TOKEN`. El valor se copia desde Render (*Environment* del Web Service). Se entrega por un canal privado y nunca se publica en el repositorio ni en el panel.

El puente puede reintentar el mismo envío sin riesgo: cada lectura lleva su UUID, así que un reenvío devuelve `200` y no duplica datos.

## Decisiones de diseño

- **Campos extra:** el cuerpo que envía el puente debe tener exactamente los cinco campos del contrato. Un campo adicional devuelve `400`, para detectar pronto una configuración equivocada del puente.
- **Duplicados con contenido distinto:** si llega un UUID que ya existe con otros valores, se responde `200` y se conserva la primera versión, tal como pide el contrato.
- **Tamaño del cuerpo:** un cuerpo demasiado grande devuelve `413` y no `400`, que es el código HTTP estándar para ese caso.
- **Migraciones:** se ejecutan al arrancar el servidor, en una transacción y con un bloqueo de transacción, compatible con el link *pooled* de Neon.
- **TLS:** con el link de Neon la conexión va cifrada y se verifica el certificado del servidor.
