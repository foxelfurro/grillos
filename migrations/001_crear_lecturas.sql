-- Tabla de lecturas del sensor.
-- id: UUID que llega desde el puente; es la clave primaria y evita duplicados.
-- capturado_en: instante UTC en que el ESP8266 tomó la lectura.
-- recibido_en: fecha de recepción asignada por la base de datos.

CREATE TABLE IF NOT EXISTS lecturas (
  id            UUID PRIMARY KEY,
  dispositivo   TEXT             NOT NULL,
  capturado_en  TIMESTAMPTZ      NOT NULL,
  temperatura   DOUBLE PRECISION NOT NULL,
  humedad       DOUBLE PRECISION NOT NULL CHECK (humedad >= 0 AND humedad <= 100),
  recibido_en   TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- Soporta las consultas "última lectura" e "historial" con orden estable.
CREATE INDEX IF NOT EXISTS lecturas_capturado_en_id_idx
  ON lecturas (capturado_en DESC, id DESC);
