// Vercel Serverless Function
// Handles: /api/weather/metar, /api/weather/taf, /api/weather/isigmet, /api/weather/notam

const WEATHER_ORIGIN = 'https://aviationweather.gov/api/data';

function validIcao(value) {
    return /^[A-Z]{4}(,[A-Z]{4})*$/.test(value || '');
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Only GET is supported.' });
    }

    const resource = req.query.resource;
    const validResources = ['metar', 'taf', 'isigmet', 'notam'];
    if (!validResources.includes(resource)) {
        return res.status(400).json({ error: 'Invalid weather endpoint.' });
    }

    // --- NOTAM ---
    if (resource === 'notam') {
        const icao = (req.query.icao || '').trim().toUpperCase();
        if (!validIcao(icao)) {
            return res.status(400).json({ error: 'A valid ICAO code is required.' });
        }
        try {
            const params = new URLSearchParams();
            params.append('searchType', '0');
            params.append('locators', icao);

            const upstream = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
                method: 'POST',
                body: params,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0'
                },
                signal: AbortSignal.timeout(10000)
            });

            if (!upstream.ok) throw new Error(`FAA responded with ${upstream.status}`);
            const body = await upstream.text();

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
            return res.status(200).send(body);
        } catch (error) {
            return res.status(502).json({ error: 'FAA NOTAM source unreachable.', detail: error.message });
        }
    }

    // --- ISIGMET ---
    if (resource === 'isigmet') {
        try {
            const upstream = await fetch(`${WEATHER_ORIGIN}/isigmet?format=geojson`, {
                headers: { 'User-Agent': 'METAR-Airspace/1.0 (real-world aviation dashboard)' },
                signal: AbortSignal.timeout(8000)
            });
            if (!upstream.ok) throw new Error(`Aviation Weather Center responded with ${upstream.status}.`);
            const body = await upstream.text();

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
            return res.status(200).send(body);
        } catch (error) {
            return res.status(502).json({ error: 'Official weather source unreachable.', detail: error.message });
        }
    }

    // --- METAR / TAF ---
    const icao = (req.query.ids || '').trim().toUpperCase();
    if (!validIcao(icao)) {
        return res.status(400).json({ error: 'A valid, four-letter ICAO code is required.' });
    }

    let upstreamUrl = `${WEATHER_ORIGIN}/${resource}?ids=${encodeURIComponent(icao)}`;
    const hours = req.query.hours;
    if (hours) upstreamUrl += `&hours=${encodeURIComponent(hours)}`;

    try {
        const upstream = await fetch(upstreamUrl, {
            headers: { 'User-Agent': 'METAR-Airspace/1.0 (real-world aviation dashboard)' },
            signal: AbortSignal.timeout(8000)
        });

        if (!upstream.ok) throw new Error(`Aviation Weather Center responded with ${upstream.status}.`);

        const body = await upstream.text();
        if (!body || body.trim() === '') throw new Error(`No data found for ${resource}.`);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.setHeader('X-Data-Source', 'Aviation Weather Center');
        return res.status(200).send(body);
    } catch (error) {
        return res.status(502).json({ error: 'Official weather source unreachable.', detail: error.message });
    }
}
