/*
 * Real-world data adapters.
 *
 * This application deliberately does not use VATSIM or a public CORS proxy.
 * Aircraft positions come from public ADS-B broadcasts. The small same-origin
 * proxy in server.mjs relays only official Aviation Weather METAR/TAF requests,
 * because the official endpoint does not grant browsers CORS access directly.
 */
(function () {
    // Relative URLs work on Vercel (same origin), localhost, and any future host automatically.
    const WEATHER_API = '/api/weather/metar?ids=';
    const HISTORICAL_WEATHER_API = '/api/weather/metar?hours=24&ids=';
    const TAF_API = '/api/weather/taf?ids=';
    const AIRCRAFT_API = 'https://api.airplanes.live/v2';

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) {
                throw new Error(`Source responded with ${response.status}.`);
            }
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Data source timed out.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    async function fetchAirportWeather(icao) {
        const id = encodeURIComponent(icao.trim().toUpperCase());
        
        let metarText = '';
        let tafText = null;
        let tafUnavailable = true;

        try {
            // METAR'ı kendi yerel sunucumuz üzerinden en hızlı ve güvenilir kaynak olan NOAA'dan çekiyoruz
            const metarResponse = await fetchWithTimeout(`${WEATHER_API}${id}`);
            metarText = await metarResponse.text();
            
            if (!metarText || metarText.trim() === '') {
                throw new Error('No data found for airport.');
            }
        } catch (error) {
            throw error;
        }

        try {
            // TAF'ı da kendi yerel sunucumuz üzerinden NOAA'dan çekiyoruz, CORS sorunu veya 3. parti Proxy gecikmesi yok
            const tafResponse = await fetchWithTimeout(`${TAF_API}${id}`, {}, 8000);
            const rawTaf = await tafResponse.text();
            if (rawTaf && rawTaf.trim() !== '') {
                tafText = rawTaf.trim();
                tafUnavailable = false;
            }
        } catch (e) {
            tafText = 'Failed to fetch TAF data via local server. Check your connection or server.';
        }

        return {
            metar: parseRawMetar(metarText.trim()),
            taf: tafText,
            tafUnavailable: tafUnavailable
        };
    }

    async function fetchBulkMetar(icaoList) {
        if (!icaoList || icaoList.length === 0) return [];
        const ids = icaoList.join(',');
        try {
            const response = await fetchWithTimeout(`${WEATHER_API}${ids}`);
            const text = await response.text();
            if (!text) return [];
            
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
            return lines.map(line => parseRawMetar(line)).filter(Boolean);
        } catch (error) {
            console.error('Failed to fetch bulk METAR:', error);
            return [];
        }
    }

    async function fetchHistoricalMetar(icao) {
        const id = encodeURIComponent(icao.trim().toUpperCase());
        try {
            const response = await fetchWithTimeout(`${HISTORICAL_WEATHER_API}${id}`);
            const text = await response.text();
            if (!text) return [];
            
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
            // AviationWeather returns oldest to newest usually, or newest to oldest. We'll parse them.
            return lines.map(line => parseRawMetar(line)).filter(Boolean);
        } catch (error) {
            console.error('Failed to fetch historical METAR:', error);
            return [];
        }
    }

    function parseRawMetar(raw) {
        if (!raw) return null;
        
        const icaoMatch = raw.match(/\b([A-Z]{4})\b/);
        const icao = icaoMatch ? icaoMatch[1] : null;

        const windMatch = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
        let windDirection = null, windSpeed = null, gust = '';
        if (windMatch) {
            windDirection = windMatch[1] === 'VRB' ? 'VRB' : Number(windMatch[1]);
            windSpeed = Number(windMatch[2]);
            gust = windMatch[3] ? ` G${windMatch[3]}` : '';
        }

        const tempMatch = raw.match(/\b(M?\d{2})\/(M?\d{2})?\b/);
        let temp = null, dewp = null;
        if (tempMatch) {
            temp = parseInt(tempMatch[1].replace('M', '-'), 10);
            if (tempMatch[2]) dewp = parseInt(tempMatch[2].replace('M', '-'), 10);
        }

        const altMatch = raw.match(/\b([QA])(\d{4})\b/);
        let altim = null;
        if (altMatch) {
            altim = altMatch[1] === 'Q' ? Number(altMatch[2]) : Math.round(Number(altMatch[2]) * 0.338639);
        }

        const visMatch = raw.match(/\b(\d{4}|\d{1,2}(?:\/\d)?SM)\b/);
        let visibility = '—';
        let visMiles = 99;
        
        if (raw.includes('CAVOK')) {
            visibility = 'CAVOK (10 km+)';
            visMiles = 10;
        } else if (visMatch) {
            const v = visMatch[1];
            if (v.includes('SM')) {
                visibility = v;
                if (v.includes('/')) {
                    const parts = v.replace('SM', '').split('/');
                    visMiles = Number(parts[0]) / Number(parts[1]);
                } else {
                    visMiles = parseFloat(v);
                }
            } else {
                const meters = parseInt(v, 10);
                visibility = meters === 9999 ? '10 km+' : `${meters} m`;
                visMiles = meters / 1609.34;
            }
        }

        let ceilingFt = 99999;
        if (!raw.includes('CAVOK')) {
            const ceilingMatches = [...raw.matchAll(/\b(?:VV|OVC|BKN)(\d{3})\b/g)];
            if (ceilingMatches.length > 0) {
                ceilingFt = Math.min(...ceilingMatches.map(m => parseInt(m[1], 10) * 100));
            }
        }

        let category = 'VFR';
        if (ceilingFt < 500 || visMiles < 1) category = 'LIFR';
        else if (ceilingFt < 1000 || visMiles < 3) category = 'IFR';
        else if (ceilingFt <= 3000 || visMiles <= 5) category = 'MVFR';

        let issued = null;
        const timeMatch = raw.match(/\b\d{2}(\d{2})(\d{2})Z\b/);
        if (timeMatch) {
            const d = new Date();
            d.setUTCHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
            issued = d.toISOString();
        }

        return {
            icao: icao,
            raw: raw,
            issued: issued,
            category: category,
            temperature: temp,
            dewpoint: dewp,
            altimeter: altim,
            visibility: visibility,
            wind: windDirection !== null && windSpeed !== null ? `${windDirection === 'VRB' ? 'VRB' : String(windDirection).padStart(3, '0') + '°'} / ${windSpeed} kt${gust}` : '—',
            windDirection: windDirection === 'VRB' ? null : windDirection,
            windSpeed: windSpeed,
            weather: raw.includes('CAVOK') ? 'Ceiling and Visibility OK (CAVOK)' : 'Unspecified'
        };
    }

    function normalizeAircraft(aircraft) {
        const altitudeValue = aircraft.alt_baro === 'ground' ? 0 : Number(aircraft.alt_baro);
        const headingValue = Number(aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading);
        const latitude = Number(aircraft.lat);
        const longitude = Number(aircraft.lon);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        return {
            hex: String(aircraft.hex || aircraft.icao || ''),
            callsign: String(aircraft.flight || aircraft.r || '').trim(),
            registration: String(aircraft.r || '').trim(),
            type: String(aircraft.t || aircraft.type || '').trim(),
            lat: latitude,
            lon: longitude,
            altitude: Number.isFinite(altitudeValue) ? Math.round(altitudeValue) : null,
            speed: Number.isFinite(Number(aircraft.gs)) ? Math.round(Number(aircraft.gs)) : null,
            heading: Number.isFinite(headingValue) ? Math.round(headingValue) : 0,
            verticalRate: Number.isFinite(Number(aircraft.baro_rate)) ? Math.round(Number(aircraft.baro_rate)) : null,
            squawk: String(aircraft.squawk || ''),
            emergency: String(aircraft.squawk || '') === '7700'
        };
    }

    async function fetchAircraftNear(lat, lon, radiusNm = 100) {
        const safeRadius = Math.max(1, Math.min(250, Math.round(radiusNm)));
        const response = await fetchWithTimeout(`${AIRCRAFT_API}/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${safeRadius}`);
        const data = await response.json();
        return Array.isArray(data.ac) ? data.ac.map(normalizeAircraft).filter(Boolean) : [];
    }

    window.API = { fetchAirportWeather, fetchAircraftNear, fetchBulkMetar, fetchHistoricalMetar };
}());
