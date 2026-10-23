const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { parseEml } = require('./emlParser');
const { geocodeContent, CAMPUS } = require('./geocoder');

const PORT = process.env.PORT || 8000;
const EMAIL_DIR = path.join(__dirname, 'emails');

// Only these files are served publicly
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/empty.html': ['empty.html', 'text/html; charset=utf-8'],
  '/resolved.html': ['resolved.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/alerts.js': ['alerts.js', 'text/javascript; charset=utf-8'],
};

async function loadAlerts() {
  const names = (await fs.readdir(EMAIL_DIR)).filter(n => n.toLowerCase().endsWith('.eml'));
  const alerts = await Promise.all(
    names.map(async name => {
      const raw = await fs.readFile(path.join(EMAIL_DIR, name), 'latin1');
      const alert = parseEml(raw);
      const point = await geocodeContent(alert.content);
      // Fall back to the Monroe Park campus center when a location can't be resolved
      return {
        ...alert,
        lat: point ? point.lat : CAMPUS.lat,
        lng: point ? point.lng : CAMPUS.lng,
        approximate: !point,
      };
    })
  );
  return alerts.sort((a, b) => (b.date || 0) - (a.date || 0));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  try {
    if (url === '/api/alerts') {
      const body = JSON.stringify(await loadAlerts());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(body);
    }
    const entry = STATIC[url];
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': entry[1] });
    res.end(await fs.readFile(path.join(__dirname, entry[0])));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`VCU Alert Map running at http://localhost:${PORT}/`);
});
