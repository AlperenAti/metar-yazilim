import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const WEATHER_ORIGIN = 'https://aviationweather.gov/api/data';
const WEATHER_CACHE_MS = 60_000;
const weatherCache = new Map();
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function send(response, status, body, headers = {}) {
    response.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
    response.end(body);
}

function validIcao(value) {
    return /^[A-Z]{4}$/.test(value || '');
}

async function handleWeather(requestUrl, response) {
    const match = requestUrl.pathname.match(/^\/api\/weather\/(metar|taf)$/);
    const icao = requestUrl.searchParams.get('ids')?.trim().toUpperCase();
    if (!match || !validIcao(icao)) {
        send(response, 400, JSON.stringify({ error: 'Geçerli, dört harfli bir ICAO kodu gerekli.' }), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
    }

    const resource = match[1];
    const cacheKey = `${resource}:${icao}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.at < WEATHER_CACHE_MS) {
        send(response, 200, cached.body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=30', 'X-Data-Source': 'Aviation Weather Center' });
        return;
    }

    try {
        const upstream = await fetch(`${WEATHER_ORIGIN}/${resource}?ids=${encodeURIComponent(icao)}&format=json`, {
            headers: { 'User-Agent': 'METAR-Airspace/1.0 (real-world aviation dashboard)' },
            signal: AbortSignal.timeout(12_000)
        });
        if (!upstream.ok) throw new Error(`Aviation Weather Center ${upstream.status} yanıtı verdi.`);
        const body = await upstream.text();
        weatherCache.set(cacheKey, { at: Date.now(), body });
        send(response, 200, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=30', 'X-Data-Source': 'Aviation Weather Center' });
    } catch (error) {
        send(response, 502, JSON.stringify({ error: 'Resmî hava kaynağına ulaşılamadı.', detail: error.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
}

function handleStatic(requestUrl, response) {
    const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const filePath = resolve(ROOT, `.${normalize(requestedPath)}`);
    if (relative(ROOT, filePath).startsWith('..') || !existsSync(filePath) || !statSync(filePath).isFile()) {
        send(response, 404, 'Bulunamadı', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }
    response.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(filePath).pipe(response);
}

createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method !== 'GET') {
        send(response, 405, 'Yalnızca GET desteklenir.', { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }
    if (requestUrl.pathname.startsWith('/api/weather/')) {
        handleWeather(requestUrl, response);
        return;
    }
    handleStatic(requestUrl, response);
}).listen(PORT, () => {
    console.log(`METAR Airspace hazır: http://localhost:${PORT}`);
});
