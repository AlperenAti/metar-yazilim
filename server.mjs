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
    response.writeHead(status, { 
        'X-Content-Type-Options': 'nosniff', 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        ...headers 
    });
    response.end(body);
}

function validIcao(value) {
    return /^[A-Z]{4}(,[A-Z]{4})*$/.test(value || '');
}

async function handleWeather(requestUrl, response) {
    const match = requestUrl.pathname.match(/^\/api\/weather\/(metar|taf|isigmet)$/);
    if (!match) {
        send(response, 400, JSON.stringify({ error: 'Invalid weather endpoint.' }), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
    }
    
    const resource = match[1];
    let upstreamUrl = `${WEATHER_ORIGIN}/${resource}`;
    
    if (resource === 'isigmet') {
        upstreamUrl += '?format=geojson';
    } else {
        const icao = requestUrl.searchParams.get('ids')?.trim().toUpperCase();
        if (!validIcao(icao)) {
            send(response, 400, JSON.stringify({ error: 'A valid, four-letter ICAO code is required.' }), { 'Content-Type': 'application/json; charset=utf-8' });
            return;
        }
        upstreamUrl += `?ids=${encodeURIComponent(icao)}`;
    }
    const cacheKey = resource === 'isigmet' ? 'isigmet' : `${resource}:${requestUrl.searchParams.get('ids')?.trim().toUpperCase()}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.at < WEATHER_CACHE_MS) {
        const contentType = resource === 'isigmet' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
        send(response, 200, cached.body, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=30', 'X-Data-Source': 'Aviation Weather Center' });
        return;
    }

    try {
        const upstream = await fetch(upstreamUrl, {
            headers: { 'User-Agent': 'METAR-Airspace/1.0 (real-world aviation dashboard)' },
            signal: AbortSignal.timeout(8_000)
        });
        
        if (!upstream.ok) {
            throw new Error(`Aviation Weather Center responded with ${upstream.status}.`);
        }
        
        const body = await upstream.text();
        if (!body || body.trim() === '') {
             throw new Error(`No data found for ${resource}.`);
        }

        weatherCache.set(cacheKey, { at: Date.now(), body });
        const contentType = resource === 'isigmet' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
        send(response, 200, body, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=30', 'X-Data-Source': 'Aviation Weather Center' });
    } catch (error) {
        send(response, 502, JSON.stringify({ error: 'Official weather source unreachable.', detail: error.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
}

function handleStatic(requestUrl, response) {
    const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const filePath = resolve(ROOT, `.${normalize(requestedPath)}`);
    if (relative(ROOT, filePath).startsWith('..') || !existsSync(filePath) || !statSync(filePath).isFile()) {
        send(response, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }
    response.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(filePath).pipe(response);
}

createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'OPTIONS') {
        send(response, 204, '');
        return;
    }
    if (request.method !== 'GET') {
        send(response, 405, 'Only GET is supported.', { Allow: 'GET, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }
    if (requestUrl.pathname.startsWith('/api/weather/')) {
        handleWeather(requestUrl, response);
        return;
    }
    handleStatic(requestUrl, response);
}).listen(PORT, () => {
    console.log(`METAR Airspace is ready at http://localhost:${PORT}`);
});
