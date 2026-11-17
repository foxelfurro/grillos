(function () {
  'use strict';

  var INTERVALO_MS = 10000;
  var LOCALE = 'es-MX';

  var el = {
    conexion: document.getElementById('conexion'),
    alerta: document.getElementById('alerta'),
    temperatura: document.getElementById('temperatura'),
    humedad: document.getElementById('humedad'),
    espera: document.getElementById('espera'),
    dispositivo: document.getElementById('dispositivo'),
    fecha: document.getElementById('fecha'),
    historial: document.getElementById('historial'),
    historialVacio: document.getElementById('historial-vacio')
  };

  var formatoNumero = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
  var formatoFecha = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'medium' });

  function formatearFecha(iso) {
    var fecha = new Date(iso);
    return Number.isNaN(fecha.getTime()) ? String(iso) : formatoFecha.format(fecha);
  }

  function numeroOGuion(valor) {
    return typeof valor === 'number' && Number.isFinite(valor) ? formatoNumero.format(valor) : '—';
  }

  function consultarJSON(url) {
    return fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }).then(
      function (respuesta) {
        if (!respuesta.ok) {
          throw new Error('HTTP ' + respuesta.status + ' en ' + url);
        }
        return respuesta.json();
      }
    );
  }

  function mostrarError(mensaje) {
    el.alerta.textContent = mensaje;
    el.alerta.hidden = false;
    el.conexion.textContent = 'Sin conexión con el servidor';
  }

  function ocultarError() {
    el.alerta.hidden = true;
    el.alerta.textContent = '';
  }

  function pintarUltima(ultima) {
    if (!ultima) {
      el.temperatura.textContent = '—';
      el.humedad.textContent = '—';
      el.dispositivo.textContent = '—';
      el.fecha.textContent = '—';
      el.espera.hidden = false;
      return;
    }

    el.temperatura.textContent = numeroOGuion(ultima.temperatura) + ' °C';
    el.humedad.textContent = numeroOGuion(ultima.humedad) + ' %';
    el.dispositivo.textContent = ultima.dispositivo || '—';
    el.fecha.textContent = formatearFecha(ultima.capturado_en);
    el.espera.hidden = true;
  }

  function pintarHistorial(lecturas) {
    // textContent evita inyectar HTML desde los datos del servidor.
    el.historial.textContent = '';

    lecturas.forEach(function (lectura) {
      var fila = document.createElement('tr');
      [
        formatearFecha(lectura.capturado_en),
        lectura.dispositivo,
        numeroOGuion(lectura.temperatura),
        numeroOGuion(lectura.humedad)
      ].forEach(function (texto) {
        var celda = document.createElement('td');
        celda.textContent = texto;
        fila.appendChild(celda);
      });
      el.historial.appendChild(fila);
    });

    el.historialVacio.hidden = lecturas.length > 0;
  }

  function actualizar() {
    return Promise.all([
      consultarJSON('/api/lecturas/ultima'),
      consultarJSON('/api/lecturas')
    ])
      .then(function (resultados) {
        var ultima = resultados[0];
        var historial = Array.isArray(resultados[1]) ? resultados[1] : [];

        pintarUltima(ultima);
        pintarHistorial(historial);
        ocultarError();
        el.conexion.textContent = 'Actualizado ' + new Date().toLocaleTimeString(LOCALE);
      })
      .catch(function (err) {
        mostrarError('No se pudo consultar el servidor: ' + err.message + '. Reintentando…');
      });
  }

  // Encadenado con setTimeout: una consulta nueva empieza solo cuando termina la anterior.
  function ciclo() {
    actualizar().then(function () {
      window.setTimeout(ciclo, INTERVALO_MS);
    });
  }

  ciclo();
})();
