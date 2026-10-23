// Centered on VCU Monroe Park campus
const map = L.map('map').setView([37.5485, -77.4528], 15);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  referrerPolicy: 'strict-origin-when-cross-origin',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const pins = [];

// addPin(lat, lng, popupText) returns the marker
function addPin(lat, lng, popupText = '', options = {}) {
  const marker = L.marker([lat, lng], options).addTo(map);
  if (popupText) marker.bindPopup(popupText);
  pins.push(marker);
  return marker;
}

function removePin(marker) {
  map.removeLayer(marker);
  const i = pins.indexOf(marker);
  if (i !== -1) pins.splice(i, 1);
}

function clearPins() {
  pins.forEach(p => map.removeLayer(p));
  pins.length = 0;
}
