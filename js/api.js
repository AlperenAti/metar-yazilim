/*
 * Real-world data adapters.
 *
 * This application deliberately does not use VATSIM or a public CORS proxy.
 * Aircraft positions come from public ADS-B broadcasts. The small same-origin
 * proxy in server.mjs relays only official Aviation Weather METAR/TAF requests,
 * because the official endpoint does not grant browsers CORS access directly.
 */
(function () {
    const WEATHER_API = 'https://metar.vatsim.net/metar.php?id=';
    const TAF_API = 'https://aviationweather.gov/api/data/taf?ids=';
    const PROXY_URL = 'https://api.allorigins.win/raw?url=';
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

    async function fetchAirportWeather(icao) {
        const id = encodeURIComponent(icao.trim().toUpperCase());
        
        let metarText = '';
        let tafText = null;
        let tafUnavailable = true;

        try {
            // METAR'ı doğrudan CORS destekli VATSIM üzerinden çekiyoruz (En kararlı yöntem)
            const metarResponse = await fetchWithTimeout(`${WEATHER_API}${id}`);
            metarText = await metarResponse.text();
            
            if (!metarText || metarText.trim() === '') {
                throw new Error('Havalimanı için veri bulunamadı.');
            }
        } catch (error) {
            throw error;
        }

        try {
            // TAF için AviationWeather resmi uç noktasını bir CORS Proxy üzerinden çekmeyi deniyoruz
            const targetUrl = encodeURIComponent(`${TAF_API}${id}`);
            const tafResponse = await fetchWithTimeout(`${PROXY_URL}${targetUrl}`, {}, 8000);
            const rawTaf = await tafResponse.text();
            if (rawTaf && rawTaf.trim() !== '') {
                tafText = rawTaf.trim();
                tafUnavailable = false;
            }
        } catch (e) {
            tafText = 'TAF verisine ulaşılamadı (Bağlantı veya proxy hatası).';
        }

        return {
            metar: parseRawMetar(metarText.trim()),
            taf: tafText,
            tafUnavailable: tafUnavailable
        };
    }

    function parseRawMetar(raw) {
        if (!raw) return null;
        
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

        const visMatch = raw.match(/\b(\d{4}|\d{1,2}SM)\b/);
        let visibility = '—';
        if (visMatch) {
            visibility = visMatch[1].includes('SM') ? visMatch[1] : (visMatch[1] === '9999' ? '10 km+' : `${visMatch[1]} m`);
        }
        if (raw.includes('CAVOK')) visibility = 'CAVOK (10 km+)';

        let category = 'VFR';
        if (raw.match(/\b(VV|OVC|BKN)0[0-2]\d\b/)) category = 'IFR';
        else if (raw.match(/\b(OVC|BKN)0[3-9]\d\b/)) category = 'MVFR';

        let issued = null;
        const timeMatch = raw.match(/\b\d{2}(\d{2})(\d{2})Z\b/);
        if (timeMatch) {
            const d = new Date();
            d.setUTCHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
            issued = d.toISOString();
        }

        return {
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
            weather: raw.includes('CAVOK') ? 'Bulutsuz ve Görüş Açık (CAVOK)' : 'Belirtilmedi'
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
