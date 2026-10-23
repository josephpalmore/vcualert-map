// Parses VCU Alert .eml text into { date, title, content }.
// Server-side (Node) module. Input is the raw file read as a latin-1 string.

function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// Strings are kept as latin-1 so every char maps to one byte and can be re-decoded later.
function latin1ToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

function decodeQuotedPrintable(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) {
      bytes.push(parseInt(str.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(str.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function splitMessage(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const h = line.match(/^([^:\s]+):\s*(.*)$/);
    if (h && !(h[1].toLowerCase() in headers)) headers[h[1].toLowerCase()] = h[2];
  }
  return { headers, body };
}

function getPlainText(msg) {
  const ct = msg.headers['content-type'] || '';
  const mp = ct.match(/multipart\/.*boundary="?([^";]+)"?/i);
  if (mp) {
    const boundary = mp[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const section of msg.body.split(new RegExp(`^--${boundary}(?:--)?[ \\t]*\\r?$`, 'm'))) {
      if (!section.trim()) continue;
      const text = getPlainText(splitMessage(section.replace(/^[\r\n]+/, '')));
      if (text) return text;
    }
    return null;
  }
  if (ct && !/text\/plain/i.test(ct)) return null;

  const charset = (ct.match(/charset="?([\w-]+)"?/i) || [])[1];
  const encoding = (msg.headers['content-transfer-encoding'] || '').toLowerCase();
  if (encoding.includes('base64')) {
    const bin = atob(msg.body.replace(/\s/g, ''));
    return decodeBytes(latin1ToBytes(bin), charset);
  }
  if (encoding.includes('quoted-printable')) {
    return decodeBytes(decodeQuotedPrintable(msg.body.replace(/=\r?\n/g, '')), charset);
  }
  return decodeBytes(latin1ToBytes(msg.body), charset);
}

function decodeHeader(value) {
  value = decodeBytes(latin1ToBytes(value), 'utf-8');
  return value.replace(/=\?([\w-]+)\?([BbQq])\?(.*?)\?=/g, (_, charset, enc, text) => {
    if (enc.toUpperCase() === 'B') return decodeBytes(latin1ToBytes(atob(text)), charset);
    return decodeBytes(decodeQuotedPrintable(text.replace(/_/g, ' ')), charset);
  });
}

function cleanContent(text, title) {
  // Everything from the standard footer onward is boilerplate
  text = text.split(/^\s*Why am I receiving this email\?/im)[0];
  // Tracking links like "(<https://...>)"
  text = text.replace(/\s*\(?<https?:\/\/[^>\s]*>\)?/g, '');
  const noise = [/^=+$/, /^#+$/, /^To view this email in a browser/i, /^VCU Alert Logo/i];
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#\s+/, '');
    if (noise.some(re => re.test(line))) continue;
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }
  while (lines.length && (lines[0] === '' || lines[0] === title)) lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function parseEml(raw) {
  const msg = splitMessage(raw);
  const title = decodeHeader(msg.headers.subject || '').trim();
  const dateText = (msg.headers.date || '').replace(/\s*\(.*\)$/, '');
  const parsed = new Date(dateText);
  return {
    date: isNaN(parsed) ? null : parsed,
    title,
    content: cleanContent(getPlainText(msg) || '', title),
  };
}

module.exports = { parseEml };
