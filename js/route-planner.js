/**
 * WindRose — Route Weather Briefing
 * Draws a great-circle route on the map and fetches met data for each
 * critical point: DEP, TOC, en-route waypoints, TOD, ARR.
 */
(function () {
    'use strict';

    /* ── Constants ─────────────────────────────────────────── */
    const NM_TO_KM  = 1.852;
    const R_KM      = 6371;          // Earth radius km
    const TOC_NM    = 80;            // Distance from DEP to TOC
    const TOD_NM    = 80;            // Distance from ARR to TOD
    const WP_INTERVAL_NM = 250;      // Auto-waypoint spacing
    const DEFAULT_FL = 350;

    /* ── Airport lookup (lazy-loaded) ─────────────────────── */
    let airportDB = null;
    async function getAirportDB() {
        if (airportDB) return airportDB;
        const r = await fetch('/data/airports.json');
        const arr = await r.json();
        airportDB = {};
        arr.forEach(a => { airportDB[a.i] = a; });
        return airportDB;
    }

    async function lookupAirport(icao) {
        const db = await getAirportDB();
        const a = db[icao.toUpperCase()];
        if (!a) throw new Error(`Airport not found: ${icao.toUpperCase()}`);
        return { icao: a.i, name: a.n, lat: a.lat, lon: a.lon };
    }

    /* ── Great-circle math ─────────────────────────────────── */
    function toRad(d) { return d * Math.PI / 180; }
    function toDeg(r) { return r * 180 / Math.PI; }

    function gcDistance(a, b) {
        const dLat = toRad(b.lat - a.lat);
        const dLon = toRad(b.lon - a.lon);
        const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
        return 2 * R_KM * Math.asin(Math.sqrt(s));
    }

    function gcInterpolate(a, b, frac) {
        const lat1 = toRad(a.lat), lon1 = toRad(a.lon);
        const lat2 = toRad(b.lat), lon2 = toRad(b.lon);
        const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((lon2-lon1)/2)**2));
        if (d < 1e-9) return { lat: a.lat, lon: a.lon };
        const A = Math.sin((1-frac)*d)/Math.sin(d);
        const B = Math.sin(frac*d)/Math.sin(d);
        const x = A*Math.cos(lat1)*Math.cos(lon1) + B*Math.cos(lat2)*Math.cos(lon2);
        const y = A*Math.cos(lat1)*Math.sin(lon1) + B*Math.cos(lat2)*Math.sin(lon2);
        const z = A*Math.sin(lat1) + B*Math.sin(lat2);
        return { lat: toDeg(Math.atan2(z, Math.sqrt(x*x+y*y))), lon: toDeg(Math.atan2(y, x)) };
    }

    /** Generate N evenly-spaced points along great circle (including endpoints) */
    function gcPoints(dep, arr, n) {
        const pts = [];
        for (let i = 0; i <= n; i++) pts.push(gcInterpolate(dep, arr, i/n));
        return pts;
    }

    /** Build list of critical route points */
    function buildRoutePoints(dep, arr, flightLevel, manualWps) {
        const totalKm  = gcDistance(dep, arr);
        const totalNm  = totalKm / NM_TO_KM;

        const points = [];

        // DEP
        points.push({ label: 'DEP', type: 'dep', nmFromDep: 0, ...dep });

        // TOC (only if flight long enough)
        const tocNm = Math.min(TOC_NM, totalNm * 0.15);
        if (totalNm > 120) {
            const f = tocNm / totalNm;
            const pos = gcInterpolate(dep, arr, f);
            points.push({ label: 'TOC (Top of Climb)', type: 'toc', nmFromDep: Math.round(tocNm), ...pos });
        }

        // Manual waypoints
        manualWps.forEach((wp, idx) => {
            const nmFromDep = (gcDistance(dep, wp) / NM_TO_KM);
            points.push({ label: `WP${idx+1}`, type: 'waypoint', nmFromDep: Math.round(nmFromDep), ...wp });
        });

        // Auto en-route waypoints (if no manual ones and route is long)
        if (manualWps.length === 0 && totalNm > WP_INTERVAL_NM * 1.5) {
            const numAuto = Math.floor(totalNm / WP_INTERVAL_NM) - 1;
            for (let i = 1; i <= numAuto; i++) {
                const nm = WP_INTERVAL_NM * i;
                const f  = nm / totalNm;
                const pos = gcInterpolate(dep, arr, f);
                points.push({ label: `EN${i}`, type: 'enroute', nmFromDep: Math.round(nm), ...pos });
            }
        }

        // TOD
        const todNm = Math.min(TOD_NM, totalNm * 0.15);
        if (totalNm > 120) {
            const f = (totalNm - todNm) / totalNm;
            const pos = gcInterpolate(dep, arr, f);
            points.push({ label: 'TOD (Top of Descent)', type: 'tod', nmFromDep: Math.round(totalNm - todNm), ...pos });
        }

        // ARR
        points.push({ label: 'ARR', type: 'arr', nmFromDep: Math.round(totalNm), ...arr });

        // Sort by distance from dep
        points.sort((a, b) => a.nmFromDep - b.nmFromDep);
        return { points, totalNm: Math.round(totalNm) };
    }

    /* ── Weather fetching ──────────────────────────────────── */
    // FL to approx pressure level (hPa)
    function flToPressure(fl) {
        if (fl >= 390) return 200;
        if (fl >= 340) return 250;
        if (fl >= 300) return 300;
        if (fl >= 260) return 350;
        if (fl >= 220) return 400;
        if (fl >= 180) return 500;
        return 600;
    }

    async function fetchSurfaceWx(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&wind_speed_unit=kn&timezone=UTC`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        return (await r.json()).current || null;
    }

    async function fetchUpperAirWx(lat, lon, fl) {
        const pressure = flToPressure(fl);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=temperature_${pressure}hPa,wind_speed_${pressure}hPa,wind_direction_${pressure}hPa&wind_speed_unit=kn&timezone=UTC&forecast_days=1`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const data = await r.json();
        if (!data.hourly) return null;
        // Take the current hour index
        const hi = new Date().getUTCHours();
        return {
            temp:    data.hourly[`temperature_${pressure}hPa`]?.[hi] ?? null,
            windSpd: data.hourly[`wind_speed_${pressure}hPa`]?.[hi] ?? null,
            windDir: data.hourly[`wind_direction_${pressure}hPa`]?.[hi] ?? null,
        };
    }

    async function fetchMetarTaf(icao) {
        const [mr, tr] = await Promise.allSettled([
            fetch(`/api/weather/metar?ids=${icao}`).then(r => r.ok ? r.text() : null),
            fetch(`/api/weather/taf?ids=${icao}`).then(r => r.ok ? r.text() : null),
        ]);
        return {
            metar: mr.status === 'fulfilled' ? mr.value?.trim() : null,
            taf:   tr.status === 'fulfilled' ? tr.value?.trim() : null,
        };
    }

    async function fetchSigmets() {
        try {
            const r = await fetch('/api/weather/isigmet');
            if (!r.ok) return [];
            const d = await r.json();
            return Array.isArray(d.features) ? d.features : [];
        } catch { return []; }
    }

    /** Simple METAR category parser */
    function metarCategory(raw) {
        if (!raw) return 'UNKN';
        const ceil = [...raw.matchAll(/\b(?:VV|OVC|BKN)(\d{3})\b/g)]
            .map(m => parseInt(m[1]) * 100);
        const minCeil = ceil.length ? Math.min(...ceil) : 99999;
        const visM = raw.match(/\b(VV|OVC|BKN|SKC|FEW|SCT|CAVOK)/) ? null : null;
        let vis = 99;
        const vm = raw.match(/\b(\d{1,2})SM\b/);
        if (vm) vis = parseFloat(vm[1]);
        if (raw.includes('CAVOK') || raw.includes('9999')) { vis = 99; }

        if (minCeil < 500 || vis < 1)  return 'LIFR';
        if (minCeil < 1000 || vis < 3) return 'IFR';
        if (minCeil <= 3000 || vis <= 5) return 'MVFR';
        return 'VFR';
    }

    /** Point-in-polygon (ray casting) for SIGMET intersection */
    function pointInPolygon(pt, coords) {
        let inside = false;
        for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
            const xi = coords[i][0], yi = coords[i][1];
            const xj = coords[j][0], yj = coords[j][1];
            if (((yi > pt.lon) !== (yj > pt.lon)) && pt.lat < (xj-xi)*(pt.lon-yi)/(yj-yi)+xi)
                inside = !inside;
        }
        return inside;
    }

    function checkSigmetIntersection(points, sigmets) {
        const active = [];
        sigmets.forEach(feat => {
            if (!feat.geometry?.coordinates) return;
            let coords = feat.geometry.type === 'Polygon'
                ? feat.geometry.coordinates[0]
                : feat.geometry.type === 'Point' ? null : null;
            if (!coords) return;
            // Check if any route point is inside the SIGMET polygon
            for (const pt of points) {
                if (pointInPolygon({ lat: pt.lat, lon: pt.lon }, coords)) {
                    active.push(feat.properties);
                    return;
                }
            }
        });
        return active;
    }

    /* ── Map layer management ──────────────────────────────── */
    let routeLayer = null;
    let tempWpLayer = null;

    function clearRouteLayer() {
        const map = window.MapManager?.map;
        if (routeLayer && map) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
        if (tempWpLayer) {
            tempWpLayer.clearLayers();
        }
    }

    function drawRoute(dep, arr, intermediatePoints, map) {
        clearRouteLayer();
        // Build smooth great-circle polyline
        const allPts = gcPoints(dep, arr, 100);
        const latlngs = allPts.map(p => [p.lat, p.lon]);

        routeLayer = L.layerGroup();

        // Main route line
        L.polyline(latlngs, {
            color: '#44ddbd', weight: 2.5, opacity: 0.85,
            dashArray: '6,4', className: 'route-polyline'
        }).addTo(routeLayer);

        // Waypoint markers
        intermediatePoints.forEach(pt => {
            const icons = {
                dep:      { emoji: '🛫', cls: 'route-marker-dep' },
                toc:      { emoji: '📈', cls: 'route-marker-toc' },
                enroute:  { emoji: '🔹', cls: 'route-marker-en'  },
                waypoint: { emoji: '📍', cls: 'route-marker-wp'  },
                tod:      { emoji: '📉', cls: 'route-marker-tod' },
                arr:      { emoji: '🛬', cls: 'route-marker-arr' },
            };
            const ico = icons[pt.type] || icons.enroute;
            const divIcon = L.divIcon({
                className: `route-marker ${ico.cls}`,
                html: `<span class="route-marker-inner">${ico.emoji}<span class="route-marker-label">${pt.label}</span></span>`,
                iconSize: [48, 28], iconAnchor: [24, 14]
            });
            L.marker([pt.lat, pt.lon], { icon: divIcon }).addTo(routeLayer);
        });

        routeLayer.addTo(map);

        // Fit map
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [60, 60] });
    }

    /* ── UI ────────────────────────────────────────────────── */
    function renderCategoryBadge(cat) {
        const colors = { VFR: '#44ddbd', MVFR: '#60adff', IFR: '#f54263', LIFR: '#a855f7', UNKN: '#8da0b5' };
        const color = colors[cat] || colors.UNKN;
        return `<span class="rp-cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${cat}</span>`;
    }

    function renderWindDir(dir) {
        if (dir == null) return '—';
        const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
        return arrows[Math.round(((dir % 360) + 360) % 360 / 45) % 8] + ' ' + Math.round(dir) + '°';
    }

    function renderPointCard(pt, wx) {
        const isApt = pt.type === 'dep' || pt.type === 'arr';
        const typeLabels = {
            dep: '🛫 Departure', toc: '📈 Top of Climb', enroute: '🔹 En Route',
            waypoint: '📍 Waypoint', tod: '📉 Top of Descent', arr: '🛬 Arrival'
        };
        const header = `${typeLabels[pt.type] || '🔹 Waypoint'} — <b>${pt.label}</b>`;
        const dist   = `<span class="rp-dist">${pt.nmFromDep.toLocaleString()} NM from DEP</span>`;

        let body = '';

        if (isApt && wx.metar) {
            const cat = metarCategory(wx.metar);
            body += `
            <div class="rp-metar-row">
                ${renderCategoryBadge(cat)}
                <code class="rp-metar-raw">${wx.metar}</code>
            </div>`;
            if (wx.taf) {
                body += `<details class="rp-taf-block"><summary>TAF</summary><code>${wx.taf}</code></details>`;
            }
        }

        if (wx.surface) {
            const s = wx.surface;
            body += `<div class="rp-wx-grid">
                <div class="rp-wx-item"><span>Surface Wind</span><strong>${renderWindDir(s.wind_direction_10m)} / ${Math.round(s.wind_speed_10m ?? 0)} kt</strong></div>
                <div class="rp-wx-item"><span>Surface Temp</span><strong>${s.temperature_2m != null ? s.temperature_2m.toFixed(1)+'°C' : '—'}</strong></div>
                <div class="rp-wx-item"><span>Cloud Cover</span><strong>${s.cloud_cover != null ? s.cloud_cover+'%' : '—'}</strong></div>
                <div class="rp-wx-item"><span>Precipitation</span><strong>${s.precipitation != null ? s.precipitation+' mm' : '—'}</strong></div>
            </div>`;
        }

        if (wx.upper) {
            const u = wx.upper;
            body += `<div class="rp-wx-grid rp-upper-grid">
                <div class="rp-wx-item rp-upper"><span>Cruise Wind</span><strong>${renderWindDir(u.windDir)} / ${Math.round(u.windSpd ?? 0)} kt</strong></div>
                <div class="rp-wx-item rp-upper"><span>Cruise Temp</span><strong>${u.temp != null ? u.temp.toFixed(0)+'°C' : '—'}</strong></div>
            </div>`;
        }

        if (!wx.metar && !wx.surface && !wx.upper) {
            body = `<p class="rp-no-data">Weather data unavailable for this point.</p>`;
        }

        return `<div class="rp-card rp-card--${pt.type}">
            <div class="rp-card-header">
                <span>${header}</span>${dist}
            </div>
            ${body}
        </div>`;
    }

    function showBriefingPanel(dep, arr, routeData, wxData, sigmetAlerts) {
        const existing = document.getElementById('route-briefing-panel');
        if (existing) existing.remove();

        const totalNm = routeData.totalNm;
        const sigmetHtml = sigmetAlerts.length > 0
            ? `<div class="rp-sigmet-alert">⚠️ <b>${sigmetAlerts.length} SIGMET${sigmetAlerts.length > 1 ? 's' : ''}</b> active along route — check SIGMET layer for details.</div>`
            : `<div class="rp-sigmet-ok">✅ No active SIGMETs detected along route.</div>`;

        const cardsHtml = wxData.map(({ pt, wx }) => renderPointCard(pt, wx)).join('');

        const panel = document.createElement('div');
        panel.id = 'route-briefing-panel';
        panel.className = 'route-briefing-panel glass-panel';
        panel.innerHTML = `
        <div class="rp-header">
            <div class="rp-header-main">
                <span class="rp-title">Route Weather Briefing</span>
                <span class="rp-route-label">${dep.icao} → ${arr.icao} &nbsp;·&nbsp; ${totalNm.toLocaleString()} NM</span>
            </div>
            <button id="rp-detailed-btn" class="rp-calc-btn" type="button" style="font-size:10px; padding:6px 10px; margin-right:8px; margin-top:0;">Detailed View</button>
            <button id="rp-close-btn" class="close-button" type="button" aria-label="Close briefing">×</button>
        </div>
        ${sigmetHtml}
        <div class="rp-cards-scroll">
            ${cardsHtml}
        </div>`;

        document.querySelector('main').appendChild(panel);

        document.getElementById('rp-close-btn').addEventListener('click', () => {
            panel.remove();
            clearRouteLayer();
        });
        
        document.getElementById('rp-detailed-btn').addEventListener('click', () => {
            const btn = document.getElementById('view-list-btn');
            if (btn) btn.click();
            const dashRouteTab = document.getElementById('dash-tab-route');
            if (dashRouteTab) dashRouteTab.click();
            
            // Auto fill the dashboard form and calculate
            document.getElementById('rp-dash-dep').value = dep.icao;
            document.getElementById('rp-dash-arr').value = arr.icao;
            document.getElementById('rp-dash-fl').value = document.getElementById('rp-fl')?.value || `FL${DEFAULT_FL}`;
            document.getElementById('rp-dash-waypoints').value = document.getElementById('rp-waypoints')?.value || '';
            document.getElementById('rp-dash-calc-btn').click();
            
            panel.remove();
            if(document.getElementById('route-planner-modal')) {
                document.getElementById('route-planner-modal').style.display = 'none';
            }
        });
    }

    function renderDashboardCards(dep, arr, routeData, wxData, sigmetAlerts) {
        document.getElementById('route-dash-empty-state').classList.add('hidden');
        document.getElementById('route-dash-content').classList.remove('hidden');
        
        document.getElementById('route-dash-title-val').textContent = `${dep.icao} → ${arr.icao}`;
        document.getElementById('route-dash-dist-val').textContent = `${routeData.totalNm.toLocaleString()} NM`;
        
        const grid = document.getElementById('route-dash-cards-grid');
        grid.innerHTML = wxData.map(({ pt, wx }) => renderPointCard(pt, wx)).join('');
        
        // Render sigmets alert as a card if any
        if (sigmetAlerts.length > 0) {
            const sigHtml = `<div class="rp-card" style="border-color:#e67e22; background:rgba(230,126,34,0.1);">
                <div class="rp-card-header" style="color:#e67e22;">⚠️ SIGMET Alert</div>
                <div style="padding:12px;font-size:13px;color:#fff;">
                    <p style="margin-bottom:8px;"><b>${sigmetAlerts.length} SIGMET${sigmetAlerts.length > 1 ? 's' : ''}</b> active along this route.</p>
                    <ul style="margin:0; padding-left:16px; opacity:0.9; line-height:1.4;">
                        ${sigmetAlerts.map(s => `<li style="margin-bottom:4px;"><b>${s.firName || s.firId || 'Unknown FIR'}</b>: ${s.hazard || 'Hazard'} (${s.qualifier || 'Active'})</li>`).join('')}
                    </ul>
                </div>
            </div>`;
            grid.insertAdjacentHTML('afterbegin', sigHtml);
        }
    }

    function showModal() {
        const existing = document.getElementById('route-planner-modal');
        if (existing) { existing.classList.toggle('hidden'); return; }

        const modal = document.createElement('div');
        modal.id = 'route-planner-modal';
        modal.className = 'route-planner-modal glass-panel';
        modal.innerHTML = `
        <div class="rp-modal-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M3 17l6-6 4 4 8-8"/><circle cx="3" cy="17" r="2"/><circle cx="9" cy="11" r="2"/><circle cx="13" cy="15" r="2"/><circle cx="21" cy="7" r="2"/></svg>
            <span>Route Weather Briefing</span>
            <button id="rp-modal-close" class="close-button" type="button">×</button>
        </div>
        <div class="rp-form">
            <div class="rp-field">
                <label for="rp-dep">Departure (ICAO)</label>
                <input id="rp-dep" type="text" maxlength="4" placeholder="e.g. LTFM" autocomplete="off" spellcheck="false">
            </div>
            <div class="rp-field">
                <label for="rp-arr">Arrival (ICAO)</label>
                <input id="rp-arr" type="text" maxlength="4" placeholder="e.g. EGLL" autocomplete="off" spellcheck="false">
            </div>
            <div class="rp-field">
                <label for="rp-fl">Cruise Flight Level</label>
                <input id="rp-fl" type="text" value="FL${DEFAULT_FL}" placeholder="Ex: FL320">
            </div>
            <div class="rp-field rp-wp-field">
                <label style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Waypoints <span class="rp-muted">(optional)</span></span>
                    <button id="rp-pick-map-btn" type="button" style="background:none;border:none;color:var(--brand);font-size:10px;cursor:pointer;text-decoration:underline;">Select on Map</button>
                </label>
                <input id="rp-waypoints" type="text" placeholder="e.g. LYBE, LOWW" autocomplete="off" spellcheck="false">
            </div>
            <button id="rp-calc-btn" class="rp-calc-btn" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 17l6-6 4 4 8-8"/></svg>
                Calculate Route
            </button>
            <div id="rp-status" class="rp-status"></div>
        </div>`;

        document.querySelector('main').appendChild(modal);

        document.getElementById('rp-modal-close').addEventListener('click', () => modal.remove());

        // Auto-uppercase inputs
        ['rp-dep','rp-arr','rp-waypoints'].forEach(id => {
            document.getElementById(id).addEventListener('input', e => {
                const s = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase();
                e.target.setSelectionRange(s, s);
            });
        });
        
        const flInput = document.getElementById('rp-fl');
        flInput.addEventListener('input', e => {
            let val = parseInt(e.target.value.replace(/\D/g, ''));
            if (!isNaN(val)) {
                if (val > 550) val = 550;
                e.target.value = 'FL' + val;
            } else {
                e.target.value = '';
            }
        });
        flInput.addEventListener('focus', e => {
            if(!e.target.value) e.target.value = 'FL';
        });

        document.getElementById('rp-pick-map-btn').addEventListener('click', () => {
            modal.style.display = 'none';
            const map = window.MapManager?.map;
            if(!map) return;
            map.getContainer().style.cursor = 'crosshair';
            const hint = document.createElement('div');
            hint.className = 'measure-hint';
            hint.textContent = 'Click anywhere on map to add waypoint coordinate';
            document.body.appendChild(hint);
            
            map.once('click', (e) => {
                map.getContainer().style.cursor = '';
                hint.remove();
                
                if (!tempWpLayer) tempWpLayer = L.layerGroup().addTo(map);
                L.circleMarker(e.latlng, { radius: 5, color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.5 }).addTo(tempWpLayer);
                
                modal.style.display = 'block';
                const wpInput = document.getElementById('rp-waypoints');
                const val = wpInput.value.trim();
                const coordStr = `${e.latlng.lat.toFixed(4)}/${e.latlng.lng.toFixed(4)}`;
                wpInput.value = val ? val + ', ' + coordStr : coordStr;
            });
        });

        document.getElementById('rp-calc-btn').addEventListener('click', () => {
            const dep = document.getElementById('rp-dep').value.trim().toUpperCase();
            const arr = document.getElementById('rp-arr').value.trim().toUpperCase();
            let fl = parseInt(document.getElementById('rp-fl').value.replace(/\D/g, '')) || DEFAULT_FL;
            if (fl > 550) fl = 550;
            const wp = document.getElementById('rp-waypoints').value.trim();
            runCalculation(dep, arr, fl, wp, 'modal', modal);
        });
    }

    async function runCalculation(depRaw, arrRaw, fl, wpRaw, mode, modal = null) {
        const isDash = mode === 'dashboard';
        const btnId  = isDash ? 'rp-dash-calc-btn' : 'rp-calc-btn';
        const statId = isDash ? 'rp-dash-status' : 'rp-status';
        const btn    = document.getElementById(btnId);
        const status = document.getElementById(statId);

        if (!depRaw || depRaw.length !== 4) { status.textContent = '⚠ Enter a valid 4-letter departure ICAO.'; return; }
        if (!arrRaw || arrRaw.length !== 4) { status.textContent = '⚠ Enter a valid 4-letter arrival ICAO.'; return; }

        btn.disabled = true;
        btn.textContent = 'Fetching data…';
        status.textContent = '';

        if (tempWpLayer) tempWpLayer.clearLayers();

        try {
            // 1. Resolve airports
            status.textContent = '📡 Resolving airports…';
            const [dep, arr] = await Promise.all([lookupAirport(depRaw), lookupAirport(arrRaw)]);

            // 2. Resolve manual waypoints
            const manualWps = [];
            if (wpRaw) {
                const wpCodes = wpRaw.split(',').map(s => s.trim()).filter(Boolean);
                for (const code of wpCodes) {
                    const coords = code.match(/^(-?\d+(\.\d+)?)\/(-?\d+(\.\d+)?)$/);
                    if (coords) {
                        manualWps.push({ icao: 'MAP', name: 'Map Point', lat: parseFloat(coords[1]), lon: parseFloat(coords[3]) });
                    } else {
                        try { manualWps.push(await lookupAirport(code)); }
                        catch { status.textContent = `⚠ Waypoint not found: ${code}`; return; }
                    }
                }
            }

            // 3. Build route points
            const { points, totalNm } = buildRoutePoints(dep, arr, fl, manualWps);

            // 4. Fetch SIGMETs
            status.textContent = `🌍 Fetching weather for ${points.length} route points…`;
            const [sigmets, ...wxResults] = await Promise.all([
                fetchSigmets(),
                ...points.map(pt => fetchRoutePointWx(pt, dep, arr, fl))
            ]);

            const wxData = points.map((pt, i) => ({ pt, wx: wxResults[i] }));

            // 5. Check SIGMET intersections
            const sigmetAlerts = checkSigmetIntersection(points, sigmets);

            // 6. Draw on map
            const map = window.MapManager?.map;
            if (map) drawRoute(dep, arr, points, map);

            // 7. Render UI based on mode
            if (isDash) {
                renderDashboardCards(dep, arr, { totalNm }, wxData, sigmetAlerts);
            } else {
                showBriefingPanel(dep, arr, { totalNm }, wxData, sigmetAlerts);
                if (modal) modal.remove();
            }

        } catch (err) {
            status.textContent = `❌ Error: ${err.message}`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = isDash ? 'Calculate Route' : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 17l6-6 4 4 8-8"/></svg> Calculate Route`;
        }
    }

    async function fetchRoutePointWx(pt, dep, arr, fl) {
        const isApt = pt.type === 'dep' || pt.type === 'arr';
        const wx = {};
        const icaoForApt = pt.type === 'dep' ? dep.icao : arr.icao;

        const tasks = [];

        if (isApt) tasks.push(fetchMetarTaf(icaoForApt).then(d => { wx.metar = d.metar; wx.taf = d.taf; }));
        tasks.push(fetchSurfaceWx(pt.lat, pt.lon).then(d => { wx.surface = d; }));
        if (pt.type !== 'dep' && pt.type !== 'arr') {
            tasks.push(fetchUpperAirWx(pt.lat, pt.lon, fl).then(d => { wx.upper = d; }));
        }

        await Promise.allSettled(tasks);
        return wx;
    }

    /* ── Init: inject button + CSS ─────────────────────────── */
    function init() {
        // Right-side tool panel
        const toolPanel = document.createElement('div');
        toolPanel.id = 'map-tool-panel';
        toolPanel.className = 'map-tool-panel';
        toolPanel.innerHTML = `
        <button id="route-planner-btn" class="map-tool-btn" title="Route Weather Briefing" aria-label="Route Weather Briefing">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <path d="M3 17l6-6 4 4 8-8"/><circle cx="3" cy="17" r="2"/><circle cx="9" cy="11" r="2"/><circle cx="13" cy="15" r="2"/><circle cx="21" cy="7" r="2"/>
            </svg>
        </button>`;

        document.querySelector('main').appendChild(toolPanel);

        document.getElementById('route-planner-btn').addEventListener('click', showModal);

        // Dashboard Bindings
        const dashBtn = document.getElementById('rp-dash-calc-btn');
        if (dashBtn) {
            dashBtn.addEventListener('click', () => {
                const dep = document.getElementById('rp-dash-dep').value.trim().toUpperCase();
                const arr = document.getElementById('rp-dash-arr').value.trim().toUpperCase();
                const flStr = document.getElementById('rp-dash-fl').value;
                let fl = parseInt(flStr.replace(/\D/g, '')) || DEFAULT_FL;
                if (fl > 550) fl = 550;
                const wp = document.getElementById('rp-dash-waypoints').value.trim();
                runCalculation(dep, arr, fl, wp, 'dashboard');
            });
            
            document.getElementById('route-dash-close-btn').addEventListener('click', () => {
                document.getElementById('route-dash-content').classList.add('hidden');
                document.getElementById('route-dash-empty-state').classList.remove('hidden');
                clearRouteLayer();
            });

            document.getElementById('route-dash-show-map-btn').addEventListener('click', () => {
                const mapBtn = document.getElementById('view-map-btn');
                if (mapBtn) mapBtn.click();
            });
            
            ['rp-dash-dep','rp-dash-arr','rp-dash-waypoints'].forEach(id => {
                document.getElementById(id).addEventListener('input', e => {
                    const s = e.target.selectionStart;
                    e.target.value = e.target.value.toUpperCase();
                    e.target.setSelectionRange(s, s);
                });
            });
            
            const flDashInput = document.getElementById('rp-dash-fl');
            flDashInput.addEventListener('input', e => {
                let val = parseInt(e.target.value.replace(/\D/g, ''));
                if (!isNaN(val)) {
                    if (val > 550) val = 550;
                    e.target.value = 'FL' + val;
                } else {
                    e.target.value = '';
                }
            });
            flDashInput.addEventListener('focus', e => {
                if(!e.target.value) e.target.value = 'FL';
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.RoutePlanner = { showModal, clearRouteLayer };
})();
