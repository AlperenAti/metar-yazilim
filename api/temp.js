// Vercel Serverless Function
// Handles: /api/temp
// Fetches a global temperature grid from Open-Meteo for Upper Air Heatmap.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();

    const fl = req.query.fl || '340';
    const LEVELS = {
        '50': 850, '100': 700, '180': 500, '240': 400,
        '300': 300, '340': 250, '390': 200, '450': 150
    };
    const pressure = LEVELS[fl] || 250;

    const gridWidth = 40;
    const gridHeight = 40;
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
            const url = `https://api.open-meteo.com/v1/gfs?latitude=${lats}&longitude=${lons}&hourly=temperature_${pressure}hPa&timezone=UTC&forecast_days=1`;
            const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
            if (!r.ok) throw new Error(`Open-Meteo responded with ${r.status}`);
            chunkResults.push(await r.json());
        }

        const allResults = chunkResults.flatMap(d => Array.isArray(d) ? d : [d]);
        const currentHour = new Date().getUTCHours();

        const data = [];
        for (let i = 0; i < allResults.length; i++) {
            const point = allResults[i];
            const coords = points[i];
            let temp = null;
            if (point?.hourly && point.hourly[`temperature_${pressure}hPa`]) {
                temp = point.hourly[`temperature_${pressure}hPa`][currentHour];
            }
            if (temp != null) {
                // Normalize temp from -80°C to +40°C to a 0.0 - 1.0 scale
                // Leaflet-heat uses this 'intensity' value.
                let normalized = (temp - (-80)) / (40 - (-80));
                normalized = Math.max(0.01, Math.min(1.0, normalized));
                data.push([coords.lat, coords.lon, normalized]);
            }
        }

        // Vercel Edge Cache (15 mins)
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
        return res.status(200).json(data);
    } catch (err) {
        console.error('Wind API Error:', err);
        return res.status(500).json({ error: 'Failed to fetch upper air temperature' });
    }
}
