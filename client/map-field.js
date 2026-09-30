// Client widget for the `map` form field (online-only).
//
// Renders a Leaflet map with Swisstopo WMTS tiles, lets the user place a pin by
// clicking/dragging, by geocoding the form's `adresse` field, or by parsing the
// `koordinaten` field (WGS84 "lat, lon" or LV95/LV03 "E, N"). The pin is stored
// in a hidden input as {"lat","lon","zoom"} (empty when no pin).

(function () {
  'use strict';

  var SWISS_CENTER = [46.8, 8.23];
  var SWISS_ZOOM = 8;
  var MARKER_ICON = null;

  function makeIcon() {
    if (MARKER_ICON) return MARKER_ICON;
    MARKER_ICON = L.icon({
      iconUrl: '/vendor/leaflet/images/marker-icon.png',
      iconRetinaUrl: '/vendor/leaflet/images/marker-icon-2x.png',
      shadowUrl: '/vendor/leaflet/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
    });
    return MARKER_ICON;
  }

  function num(v) { var n = Number(String(v).trim().replace(',', '.')); return isFinite(n) ? n : null; }

  // Swiss LV95/LV03 (E, N) → WGS84 (approximation formulas from swisstopo).
  function chToWgs84(E, N) {
    var yOff = E >= 2000000 ? 2600000 : 600000;
    var xOff = N >= 1000000 ? 1200000 : 200000;
    var y = (E - yOff) / 1000000;
    var x = (N - xOff) / 1000000;
    var lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
    var lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x;
    return { lat: (lat * 100) / 36, lon: (lon * 100) / 36 };
  }

  // Parse the koordinaten string: "lat, lon" (WGS84) if both are small enough,
  // otherwise treat as Swiss projected coordinates "E, N".
  function parseCoords(raw) {
    var parts = String(raw || '').split(/[,;\s]+/).map(num).filter(function (n) { return n !== null; });
    if (parts.length < 2) return null;
    var a = parts[0], b = parts[1];
    if (Math.abs(a) < 90 && Math.abs(b) < 180) return { lat: a, lon: b };
    // Swiss coords may come as (E, N) or (N, E); E is the larger of the two.
    var E = Math.max(a, b), N = Math.min(a, b);
    return chToWgs84(E, N);
  }

  function findField(form, name) {
    if (!form || !name) return null;
    return form.querySelector('[name="' + name + '"]');
  }

  function initField(field) {
    var input = field.querySelector('[data-map-input]');
    var canvas = field.querySelector('[data-map-canvas]');
    var offlineNote = field.querySelector('[data-map-offline]');
    if (!input || !canvas) return;

    var offline = navigator.onLine === false || typeof L === 'undefined';
    if (offline) {
      canvas.hidden = true;
      if (offlineNote) offlineNote.hidden = false;
      field.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      return;
    }

    var form = field.closest('form');
    var map = L.map(canvas, { minZoom: 7, maxZoom: 18 });
    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', {
      attribution: '© swisstopo', minZoom: 7, maxZoom: 18,
    }).addTo(map);

    var marker = null;

    function stored() {
      try { return JSON.parse(input.value || 'null'); } catch (e) { return null; }
    }

    function save() {
      if (!marker) { input.value = ''; return; }
      var ll = marker.getLatLng();
      input.value = JSON.stringify({
        lat: Number(ll.lat.toFixed(6)), lon: Number(ll.lng.toFixed(6)), zoom: map.getZoom(),
      });
    }

    function setPin(lat, lon, zoom) {
      if (marker) marker.setLatLng([lat, lon]);
      else {
        marker = L.marker([lat, lon], { draggable: true, icon: makeIcon() }).addTo(map);
        marker.on('dragend', save);
      }
      map.setView([lat, lon], zoom || map.getZoom() || 16);
      save();
    }

    function clearPin() {
      if (marker) { map.removeLayer(marker); marker = null; }
      input.value = '';
    }

    var init = stored();
    if (init && isFinite(init.lat) && isFinite(init.lon)) {
      setPin(init.lat, init.lon, init.zoom || 16);
    } else {
      map.setView(SWISS_CENTER, SWISS_ZOOM);
    }
    // Leaflet needs a size recalc once the container is laid out.
    setTimeout(function () { map.invalidateSize(); }, 100);

    map.on('click', function (e) { setPin(e.latlng.lat, e.latlng.lng); });
    map.on('zoomend', save);

    var addrBtn = field.querySelector('[data-map-address]');
    var coordBtn = field.querySelector('[data-map-coords]');
    var clearBtn = field.querySelector('[data-map-clear]');

    var addrField = findField(form, field.dataset.addressField);
    var coordField = findField(form, field.dataset.coordField);

    if (addrBtn) {
      if (!addrField) addrBtn.disabled = true;
      addrBtn.addEventListener('click', function () {
        var q = addrField ? String(addrField.value || '').trim() : '';
        if (!q) { window.alert('Bitte zuerst eine Adresse eingeben.'); return; }
        addrBtn.disabled = true;
        var url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText='
          + encodeURIComponent(q) + '&type=locations&sr=4326&limit=1';
        fetch(url).then(function (r) { return r.json(); }).then(function (d) {
          var hit = d && d.results && d.results[0] && d.results[0].attrs;
          if (hit && isFinite(hit.lat) && isFinite(hit.lon)) setPin(Number(hit.lat), Number(hit.lon), 16);
          else window.alert('Adresse nicht gefunden.');
        }).catch(function () { window.alert('Adresssuche fehlgeschlagen.'); })
          .then(function () { addrBtn.disabled = false; });
      });
    }

    if (coordBtn) {
      if (!coordField) coordBtn.disabled = true;
      coordBtn.addEventListener('click', function () {
        var c = parseCoords(coordField ? coordField.value : '');
        if (c) setPin(c.lat, c.lon, 16);
        else window.alert('Koordinaten konnten nicht gelesen werden.');
      });
    }

    if (clearBtn) clearBtn.addEventListener('click', clearPin);
  }

  function boot() {
    document.querySelectorAll('[data-map-field]').forEach(initField);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
