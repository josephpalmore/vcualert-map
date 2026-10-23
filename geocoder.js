const fs = require('fs/promises');
const path = require('path');

const USER_AGENT = 'vcualert-map-class-project/1.0 (CMSC355 student project)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_FILE = path.join(__dirname, 'geocache.json');
const CITY_BBOX = [37.45, -77.6, 37.65, -77.35]; // south, west, north, east
const CAMPUS = { lat: 37.5485, lng: -77.4528 };

const DIRECTIONS = { n: 'North', s: 'South', e: 'East', w: 'West' };
const SUFFIXES = {
  st: 'Street', ave: 'Avenue', blvd: 'Boulevard', rd: 'Road', dr: 'Drive',
  ln: 'Lane', ct: 'Court', pl: 'Place', pkwy: 'Parkway', hwy: 'Highway', cir: 'Circle',
};
const SUFFIX_WORDS = Object.values(SUFFIXES);

let cache = null;
let lastRequest = 0;
const inFlight = new Map();

// Nominatim and Overpass ask for at most ~1 request per second
let queue = Promise.resolve();

function politeFetch(url, options = {}) {
  const run = async () => {
    const wait = lastRequest + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
    return res.json();
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

// Pulls the place description out of an alert's message body.
function extractLocation(content) {
  // Only short one-line alerts have a parseable location; long notices are treated as location-less
  if (content.length > 300) return null;
  let text = content.replace(/\s+/g, ' ').split(/\s*(?:Police on scene|Avoid area)/i)[0];
  text = text.split(',')[0].replace(/\.$/, '').trim();
  if (!text) return null;

  let m = text.match(/^(?:on\s+)?(.+?)\s+between\s+(.+?)\s+and\s+(.+)$/i);
  if (m) return { type: 'between', street: m[1].trim(), from: m[2].trim(), to: m[3].trim() };

  m = text.match(/^(.+?)\s+(?:(?:is|are)\s+)?(?:blocked|closed)?\s*(?:at|and|&)\s+(.+)$/i);
  if (m) return { type: 'intersection', a: m[1].trim(), b: m[2].trim() };

  return { type: 'place', query: text.replace(/^(?:last seen|near|at|in)\s+/i, '').trim() };
}

function streetRegex(name) {
  const words = name.replace(/\./g, '').split(/\s+/).filter(Boolean);
  let dir = null;
  let suffix = null;
  if (words.length > 1 && DIRECTIONS[words[0].toLowerCase()]) dir = DIRECTIONS[words.shift().toLowerCase()];
  else if (words.length > 1 && /^(north|south|east|west)$/i.test(words[0])) dir = words.shift();
  const last = words[words.length - 1].toLowerCase();
  if (words.length > 1 && SUFFIXES[last]) suffix = SUFFIXES[words.pop().toLowerCase()];
  else if (words.length > 1 && SUFFIX_WORDS.some(s => s.toLowerCase() === last)) suffix = words.pop();

  const esc = s => s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
  const core = esc(words.join(' '));
  const d = dir ? `${esc(dir)} ` : '(North |South |East |West )?';
  const s = suffix ? ` ${esc(suffix)}` : `( (${SUFFIX_WORDS.join('|')}))?`;
  return `^${d}${core}${s}$`;
}

async function fetchStreetWays(names) {
  const bbox = CITY_BBOX.join(',');
  const parts = names.map(n => `way["highway"]["name"~"${streetRegex(n).replace(/\\/g, '\\\\')}",i](${bbox});`);
  const query = `[out:json][timeout:25];(${parts.join('')});out geom;`;
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  };
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await politeFetch(OVERPASS_URLS[attempt % OVERPASS_URLS.length], options);
      return data.elements.filter(e => e.type === 'way' && e.geometry);
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function matches(way, name) {
  return new RegExp(streetRegex(name), 'i').test(way.tags && way.tags.name ? way.tags.name : '');
}

function distance(p, q) {
  const dx = (p.lng - q.lng) * Math.cos((p.lat * Math.PI) / 180);
  return Math.hypot(dx, p.lat - q.lat);
}

// Shared OSM node between the two streets; closest to campus if several exist.
function findIntersection(ways, a, b) {
  const waysA = ways.filter(w => matches(w, a));
  const waysB = ways.filter(w => matches(w, b));
  const candidates = [];
  for (const wa of waysA) {
    for (const wb of waysB) {
      wa.nodes.forEach((id, i) => {
        const j = wb.nodes.indexOf(id);
        if (j !== -1) candidates.push({ lat: wa.geometry[i].lat, lng: wa.geometry[i].lon });
      });
    }
  }
  if (!candidates.length) return null;
  return candidates.sort((p, q) => distance(p, CAMPUS) - distance(q, CAMPUS))[0];
}

async function geocodeIntersection(a, b) {
  return findIntersection(await fetchStreetWays([a, b]), a, b);
}

async function geocodePlace(query) {
  const [s, w, n, e] = CITY_BBOX;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&viewbox=${w},${n},${e},${s}&bounded=1&q=${encodeURIComponent(query)}`;
  const results = await politeFetch(url);
  return results.length ? { lat: +results[0].lat, lng: +results[0].lon } : null;
}

async function resolve(loc) {
  if (loc.type === 'intersection') return geocodeIntersection(loc.a, loc.b);
  if (loc.type === 'between') {
    const ways = await fetchStreetWays([loc.street, loc.from, loc.to]);
    const p1 = findIntersection(ways, loc.street, loc.from);
    const p2 = findIntersection(ways, loc.street, loc.to);
    if (p1 && p2) return { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 };
    return p1 || p2;
  }
  return geocodePlace(loc.query);
}

// Returns { lat, lng, label } or null. Successful lookups are cached on disk.
async function geocodeContent(content) {
  const loc = extractLocation(content);
  if (!loc) return null;
  const key = JSON.stringify(loc);
  const store = await loadCache();
  if (store[key]) return store[key];
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    try {
      const point = await resolve(loc);
      if (!point) return null;
      store[key] = point;
      await fs.writeFile(CACHE_FILE, JSON.stringify(store, null, 2));
      return point;
    } catch (err) {
      console.error('Geocoding failed:', err.message);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

module.exports = { geocodeContent, extractLocation, streetRegex, CAMPUS };
