// Vercel Serverless Function
// Handles: /api/wind
// Fetches a global wind grid from Open-Meteo and returns velocity vectors.
// Note: In Vercel serverless, there is no persistent in-memory cache between
// invocations, so we fetch fresh data on each cold call. Vercel Edge Cache
// (Cache-Control: s-maxage) will cache the response at the CDN layer for 15
// minutes, meaning real users rarely trigger a full fetch.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();

    const gridWidth = 30;
    const gridHeight = 30;
    const n = 80, s = -80, w = -180, e = 180;
    const dy = (n - s) / (gridHeight - 1);
    const dx = (e - w) / (gridWidth - 1);

    const points = [];
    for (let y = 0; y < gridHeight; y++) {
        const lat = n - y * dy;
        for (let x = 0; x < gridWidth; x++) {
            points.push({ lat, lon: w + x * dx });
        }
    }

    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < points.length; i += chunkSize) {
        chunks.push(points.slice(i, i + chunkSize));
    }

    try {
        const chunkResults = [];
        for (const chunk of chunks) {
            const lats = chunk.map(p => p.lat.toFixed(2)).join(',');
            const lons = chunk.map(p => p.lon.toFixed(2)).join(',');
            const url = `https://api.open-meteo.com/v1/gfs?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
            const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
            if (!r.ok) throw new Error(`Open-Meteo responded with ${r.status}`);
            chunkResults.push(await r.json());
        }

        const allResults = chunkResults.flatMap(d => Array.isArray(d) ? d : [d]);

        const uData = [], vData = [];
        for (const point of allResults) {
            if (point?.current && typeof point.current.wind_direction_10m === 'number') {
                const speed = point.current.wind_speed_10m;
                const rad = point.current.wind_direction_10m * Math.PI / 180;
                uData.push(Number((-speed * Math.sin(rad)).toFixed(2)));
                vData.push(Number((-speed * Math.cos(rad)).toFixed(2)));
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

        // Cache at Vercel edge CDN for 15 minutes, stale-while-revalidate for extra 5 min
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900, stale-while-revalidate=300');
        return res.status(200).json(velocityData);
    } catch (err) {
        return res.status(502).json({ error: 'Wind data fetch failed.', detail: err.message });
    }
}
