const alertList = document.getElementById('alert-list');

function formatAlertDate(date) {
  return date
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown date';
}

let endedTitles = [];

function showPlaceholder() {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = pins.length
    ? 'Click a pin on the map to see its alert.'
    : 'No incidents are currently reported. All clear.';
  alertList.replaceChildren(hint);
  endedTitles.forEach(title => {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Ended: ${title}`;
    alertList.append(note);
  });
}

function showAlert(alert) {
  const card = document.createElement('article');
  card.className = 'alert-card';

  const title = document.createElement('h2');
  title.textContent = alert.title;

  const date = document.createElement('time');
  date.textContent = formatAlertDate(alert.date);

  const content = document.createElement('p');
  content.textContent = alert.content;

  card.append(title, date, content);
  if (alert.approximate) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Exact location unknown (showing campus center).';
    card.append(note);
  }
  alertList.replaceChildren(card);
}

const alertMarkers = [];

function renderAlerts(alerts) {
  clearPins();
  alertMarkers.length = 0;
  const located = alerts.filter(a => a.lat != null && a.lng != null);
  located.forEach(alert => {
    const options = alert.approximate
      ? { icon: new L.Icon.Default({ className: 'pin-missing' }) }
      : {};
    const marker = addPin(alert.lat, alert.lng, '', options);
    marker.bindTooltip(alert.title);
    marker.on('click', () => showAlert(alert));
    alertMarkers.push({ alert, marker });
  });
  showPlaceholder();
  if (located.length) {
    const avg = key => located.reduce((sum, a) => sum + a[key], 0) / located.length;
    map.setView([avg('lat'), avg('lng')], map.getZoom());
  }
}

// Simulates the unknown-location event ending: its pin is removed so it can no longer be viewed
function endUnknownLocationEvents() {
  const ended = alertMarkers.filter(({ alert }) => alert.approximate);
  ended.forEach(({ alert, marker }) => {
    removePin(marker);
    alertMarkers.splice(alertMarkers.findIndex(m => m.marker === marker), 1);
    endedTitles.push(alert.title);
  });
  showPlaceholder();
}

function addEndEventButton() {
  const button = document.createElement('button');
  button.id = 'end-event';
  button.textContent = 'End unknown-location event';
  button.addEventListener('click', () => {
    endUnknownLocationEvents();
    button.disabled = true;
  });
  alertList.before(button);
}

map.on('click', showPlaceholder);

async function loadAlerts() {
  if (document.body.hasAttribute('data-simulate-empty')) {
    renderAlerts([]);
    return;
  }
  try {
    const res = await fetch('/api/alerts');
    if (!res.ok) throw new Error(res.status);
    const alerts = (await res.json()).map(a => ({ ...a, date: a.date ? new Date(a.date) : null }));
    renderAlerts(alerts);
    if (document.body.hasAttribute('data-simulate-resolved')) addEndEventButton();
  } catch (err) {
    alertList.textContent = 'Could not load alerts.';
    console.error(err);
  }
}

loadAlerts();
