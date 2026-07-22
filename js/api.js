/*
 * Real-world data adapters.
 *
 * This application deliberately does not use VATSIM or a public CORS proxy.
 * Aircraft positions come from public ADS-B broadcasts. The small same-origin
 * proxy in server.mjs relays only official Aviation Weather METAR/TAF requests,
 * because the official endpoint does not grant browsers CORS access directly.
 */
(function () {
    const WEATHER_API = '/api/weather';
    const AIRCRAFT_API = 'https://api.airplanes.live/v2';

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) {
                throw new Error(`Kaynak ${response.status} yanıtı verdi.`);
            }
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Veri kaynağı zaman aşımına uğradı.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function normalizeFlightCategory(category, metar) {
        if (category && ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(category)) return category;
        if (/\b(VV|OVC00|BKN00|OVC0[0-4]|BKN0[0-4])/.test(metar || '')) return 'IFR';
        return 'VFR';
    }

    function normalizeMetar(report) {
        if (!report) return null;
        const raw = report.rawOb || report.raw_text || report.raw || '';
        const windDirection = report.wdir === 'VRB' || report.wdir === 0 || report.wdir === null
            ? 'VRB'
            : (Number.isFinite(Number(report.wdir)) ? String(report.wdir).padStart(3, '0') + '°' : '—');
        const windSpeed = Number.isFinite(Number(report.wspd)) ? `${report.wspd} kt` : '—';
        const gust = Number.isFinite(Number(report.wgst)) ? ` G${report.wgst}` : '';
        const rawVisibility = String(report.visib ?? '').trim();
        const visibility = !rawVisibility
            ? '—'
            : `${rawVisibility} ${Number(rawVisibility) < 20 || rawVisibility.includes('+') ? 'SM' : 'm'}`;

        return {
            raw,
            issued: report.reportTime || report.obsTime || report.obs_time || null,
            category: normalizeFlightCategory(report.fltCat, raw),
            temperature: Number.isFinite(Number(report.temp)) ? Math.round(Number(report.temp)) : null,
            dewpoint: Number.isFinite(Number(report.dewp)) ? Math.round(Number(report.dewp)) : null,
            altimeter: Number.isFinite(Number(report.altim)) ? Math.round(Number(report.altim)) : null,
            visibility,
            wind: `${windDirection} / ${windSpeed}${gust}`,
            windDirection: Number.isFinite(Number(report.wdir)) ? Number(report.wdir) : null,
            windSpeed: Number.isFinite(Number(report.wspd)) ? Number(report.wspd) : null,
            weather: report.wxString || report.wx_string || report.cover || 'Belirgin hadise yok'
        };
    }

    async function fetchAirportWeather(icao) {
        const id = encodeURIComponent(icao.trim().toUpperCase());
        const [metarResult, tafResult] = await Promise.allSettled([
            fetchWithTimeout(`${WEATHER_API}/metar?ids=${id}&format=json`).then(response => response.json()),
            fetchWithTimeout(`${WEATHER_API}/taf?ids=${id}&format=json`).then(response => response.json())
        ]);

        const metarList = metarResult.status === 'fulfilled' ? metarResult.value : [];
        const tafList = tafResult.status === 'fulfilled' ? tafResult.value : [];
        const metar = Array.isArray(metarList) ? metarList[0] : null;
        const taf = Array.isArray(tafList) ? tafList[0] : null;

        if (!metar && metarResult.status === 'rejected') throw metarResult.reason;

        return {
            metar: normalizeMetar(metar),
            taf: taf?.rawTAF || taf?.raw_text || taf?.raw || null,
            tafUnavailable: tafResult.status === 'rejected'
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

    window.API = { fetchAirportWeather, fetchAircraftNear };
}());
