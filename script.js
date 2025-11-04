// --- Carte de base (Canvas + worldCopyJump pour pan fluide) ---
const map = L.map('map', {
  center:[0,0], zoom:2, minZoom:1, maxZoom:18,
  preferCanvas: true,
  worldCopyJump: true
});

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
});
const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});
const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});
const noBase = L.layerGroup();
cartoLight.addTo(map);

const baseMaps = { 'Aucun fond': noBase, 'OSM Standard': osm, 'Carto Light': cartoLight, 'Carto Dark': cartoDark };
const overlays = {};
const layersCtrl = L.control.layers(baseMaps, overlays, { collapsed:false }).addTo(map);
L.control.scale({ metric:true, imperial:false }).addTo(map);

// --- Normalisation du GeoJSON (convertit EPSG:3857 → EPSG:4326 si besoin) ---
const R = 6378137;
function mercatorMetersToLonLat(x, y){
  const lon = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI/2) * 180 / Math.PI;
  return [lon, lat];
}
function dropZ(c){ return Array.isArray(c) && c.length >= 2 ? [c[0], c[1]] : c; }
function looksLikeMeters(c){ return Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90; }

function convertGeometryTo4326(geom){
  const type = geom.type, coords = geom.coordinates;
  const convPoint = (c) => { const [x,y] = dropZ(c); return mercatorMetersToLonLat(x,y); };
  const convLine = (arr) => arr.map(convPoint);
  const convMultiLine = (arr) => arr.map(convLine);
  const convPoly = (arr) => arr.map(convLine);
  const convMultiPoly = (arr) => arr.map(convPoly);
  if (type==='Point') return {type, coordinates:convPoint(coords)};
  if (type==='MultiPoint') return {type, coordinates:coords.map(convPoint)};
  if (type==='LineString') return {type, coordinates:convLine(coords)};
  if (type==='MultiLineString') return {type, coordinates:convMultiLine(coords)};
  if (type==='Polygon') return {type, coordinates:convPoly(coords)};
  if (type==='MultiPolygon') return {type, coordinates:convMultiPoly(coords)};
  return geom;
}

function normalizeTo4326(geojson){
  try{
    let sample = geojson?.features?.[0]?.geometry?.coordinates;
    if (!sample) return geojson;
    while (Array.isArray(sample) && Array.isArray(sample[0])) sample = sample[0];
    if (Array.isArray(sample) && Array.isArray(sample[0])) sample = sample[0];
    const test = dropZ(sample);
    if (!looksLikeMeters(test)) return geojson; // déjà en degrés
    const out = { ...geojson, features: geojson.features.map(f => ({ ...f, geometry: convertGeometryTo4326(f.geometry) })) };
    return out;
  } catch(_e){ return geojson; }
}

// --- Duplication pour répétition horizontale (-360°, 0°, +360°) ---
function shiftLonCoord(c, dx){ return [c[0] + dx, c[1]]; }
function shiftGeom(geom, dx){
  const type = geom.type, coords = geom.coordinates;
  const shPoint = (c) => shiftLonCoord(dropZ(c), dx);
  const shLine = (arr) => arr.map(shPoint);
  const shMultiLine = (arr) => arr.map(shLine);
  const shPoly = (arr) => arr.map(shLine);
  const shMultiPoly = (arr) => arr.map(shPoly);
  if (type==='Point') return {type, coordinates: shPoint(coords)};
  if (type==='MultiPoint') return {type, coordinates: coords.map(shPoint)};
  if (type==='LineString') return {type, coordinates: shLine(coords)};
  if (type==='MultiLineString') return {type, coordinates: shMultiLine(coords)};
  if (type==='Polygon') return {type, coordinates: shPoly(coords)};
  if (type==='MultiPolygon') return {type, coordinates: shMultiPoly(coords)};
  return geom;
}
function cloneWithShift(fc, dxDeg){
  return {
    type: 'FeatureCollection',
    features: fc.features.map(f => ({ ...f, geometry: shiftGeom(f.geometry, dxDeg) }))
  };
}

// --- Chargement de la trame ---
let trameGroup = L.layerGroup().addTo(map);
overlays['Trame'] = trameGroup;
layersCtrl.addOverlay(trameGroup, 'Trame');

fetch('data/trame.json')
  .then(r => {
    if(!r.ok) throw new Error('HTTP '+r.status+' sur data/trame.json');
    return r.json();
  })
  .then(raw => {
    const fc = normalizeTo4326(raw);

    const fcM = cloneWithShift(fc, -360);
    const fc0 = fc;
    const fcP = cloneWithShift(fc, +360);

    const style = { color:'#111', weight:0.9, opacity:0.95 };

    const layerM = L.geoJSON(fcM, { style });
    const layer0 = L.geoJSON(fc0, { style });
    const layerP = L.geoJSON(fcP, { style });

    trameGroup.addLayer(layerM);
    trameGroup.addLayer(layer0);
    trameGroup.addLayer(layerP);

    // Ajuste la vue sur la copie centrale
    const b = layer0.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding:[20,20] });

    // Contrôle d’opacité et affichage
    const toggle = document.getElementById('toggle-trame');
    const slider = document.getElementById('opacity-trame');
    if (toggle) toggle.checked = true;
    if (toggle) toggle.addEventListener('change', e => {
      if (e.target.checked) trameGroup.addTo(map); else map.removeLayer(trameGroup);
    });
    if (slider) slider.addEventListener('input', e => {
      const o = Number(e.target.value);
      [layerM, layer0, layerP].forEach(l => l.setStyle({ ...style, opacity:o }));
      if (o > 0 && !map.hasLayer(trameGroup)) trameGroup.addTo(map);
    });

    // Met chaque couche au-dessus du fond
    [layerM, layer0, layerP].forEach(l => l.bringToFront());
  })
  .catch(err => {
    console.error('Chargement trame :', err);
    alert('La trame ne s’affiche pas : ' + err.message);
  });

