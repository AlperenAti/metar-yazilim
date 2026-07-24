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

let globalWindData = null;
let isFetchingWind = false;

async function updateGlobalWindCache() {
    if (isFetchingWind) return;
    isFetchingWind = true;
    console.log("Fetching global wind grid from Open-Meteo...");
    
    try {
        const gridWidth = 30;
        const gridHeight = 30;
        const n = 80; 
        const s = -80;
        const w = -180;
        const e = 180;
        
        const dy = (n - s) / (gridHeight - 1);
        const dx = (e - w) / (gridWidth - 1);
        
        const points = [];
        for (let y = 0; y < gridHeight; y++) {
            const lat = n - (y * dy);
            for (let x = 0; x < gridWidth; x++) {
                const lon = w + (x * dx);
                points.push({ lat, lon });
            }
        }
        
        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < points.length; i += chunkSize) {
            chunks.push(points.slice(i, i + chunkSize));
        }
        
        const chunkResults = [];
        for (const chunk of chunks) {
            const lats = chunk.map(p => p.lat.toFixed(2)).join(',');
            const lons = chunk.map(p => p.lon.toFixed(2)).join(',');
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
            
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Open-Meteo responded with ${res.status}`);
            chunkResults.push(await res.json());
            
            // Sleep 300ms to avoid burst rate limits on the backend IP
            await new Promise(r => setTimeout(r, 300));
        }
        
        const allResults = [];
        chunkResults.forEach(data => {
            const arr = Array.isArray(data) ? data : [data];
            arr.forEach(r => allResults.push(r));
        });
        
        const uData = [];
        const vData = [];
        
        for (let i = 0; i < allResults.length; i++) {
            const point = allResults[i];
            if (point && point.current && typeof point.current.wind_direction_10m === 'number') {
                const speed = point.current.wind_speed_10m; 
                const dir = point.current.wind_direction_10m; 
                
                const rad = dir * Math.PI / 180;
                const u = -speed * Math.sin(rad);
                const v = -speed * Math.cos(rad);
                
                uData.push(Number(u.toFixed(2)));
                vData.push(Number(v.toFixed(2)));
            } else {
                uData.push(0);
                vData.push(0);
            }
        }
        
        const velocityData = [
            {
                header: { parameterCategory: 2, parameterNumber: 2, dx, dy, la1: n, la2: s, lo1: w, lo2: e, nx: gridWidth, ny: gridHeight },
                data: uData
            },
            {
                header: { parameterCategory: 2, parameterNumber: 3, dx, dy, la1: n, la2: s, lo1: w, lo2: e, nx: gridWidth, ny: gridHeight },
                data: vData
            }
        ];
        
        globalWindData = JSON.stringify(velocityData);
        console.log("Global wind cache updated successfully.");
    } catch (e) {
        console.error("Failed to update global wind cache:", e.message);
    } finally {
        isFetchingWind = false;
    }
}

// Initial fetch and interval
updateGlobalWindCache();
setInterval(updateGlobalWindCache, 15 * 60 * 1000);

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
    if (requestUrl.pathname === '/api/wind') {
        if (!globalWindData) {
            send(response, 503, JSON.stringify({ error: 'Wind data is initializing, please try again soon.' }), { 'Content-Type': 'application/json; charset=utf-8' });
        } else {
            send(response, 200, globalWindData, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
        }
        return;
    }
    handleStatic(requestUrl, response);
}).listen(PORT, () => {
    console.log(`METAR Airspace is ready at http://localhost:${PORT}`);
});
