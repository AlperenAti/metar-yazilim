/**
 * WindRose — Upper Air Weather Layer
 * Visualizes upper-air wind and temperature across the map at selectable flight levels.
 */
(function () {
    'use strict';

    let map = null;
    let isActive = false;
    let currentFL = 340;
    let layerGroup = null;
    let fetchController = null;

    const LEVELS = {
        50: 850,
        100: 700,
        180: 500,
        240: 400,
        300: 300,
        340: 250,
        390: 200,
        450: 150
    };

    function init() {
        const waitPanel = setInterval(() => {
            const panel = document.getElementById('map-tool-panel');
            if (!panel) return;
            clearInterval(waitPanel);

            // Inject Toggle Button
            const btn = document.createElement('button');
            btn.id = 'upper-wx-btn';
            btn.className = 'map-tool-btn';
            btn.title = 'Upper Air Weather Layer';
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9"/>
                <path d="M8 17l4-4 4 4"/>
            </svg>`;
            btn.addEventListener('click', toggleLayer);
            panel.appendChild(btn);

            // Inject Control Panel
            const ctrl = document.createElement('div');
            ctrl.id = 'upper-wx-control';
            ctrl.className = 'weather-legend glass-panel hidden';
            ctrl.style.top = '140px';
            ctrl.style.right = '70px';
            ctrl.style.padding = '12px 16px';
            ctrl.innerHTML = `
                <div style="font-size:10px; font-weight:700; color:var(--brand); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Upper Air Layer</div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="font-size:11px; color:var(--muted);">Select FL:</label>
                    <select id="upper-wx-fl-select" style="background:var(--surface); color:var(--ink); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="50">FL050 (~5,000 ft)</option>
                        <option value="100">FL100 (~10,000 ft)</option>
                        <option value="180">FL180 (~18,000 ft)</option>
                        <option value="240">FL240 (~24,000 ft)</option>
                        <option value="300">FL300 (~30,000 ft)</option>
                        <option value="340" selected>FL340 (~34,000 ft)</option>
                        <option value="390">FL390 (~39,000 ft)</option>
                        <option value="450">FL450 (~45,000 ft)</option>
                    </select>
                </div>
                <div id="upper-wx-status" style="font-size:9px; color:var(--faint); margin-top:8px; text-align:right;"></div>
            `;
            document.querySelector('main').appendChild(ctrl);

            document.getElementById('upper-wx-fl-select').addEventListener('change', (e) => {
                currentFL = parseInt(e.target.value);
                if (isActive) updateGrid();
            });

        }, 100);
    }

    function toggleLayer() {
        if (!map) map = window.MapManager?.map;
        if (!map) return;

        isActive = !isActive;
        document.getElementById('upper-wx-btn').classList.toggle('active', isActive);
        
        const ctrl = document.getElementById('upper-wx-control');
        if (isActive) {
            ctrl.classList.remove('hidden');
            if (!layerGroup) layerGroup = L.layerGroup().addTo(map);
            updateGrid();
            map.on('moveend', updateGrid);
        } else {
            ctrl.classList.add('hidden');
            if (layerGroup) {
                layerGroup.clearLayers();
                layerGroup.remove();
                layerGroup = null;
            }
            map.off('moveend', updateGrid);
            if (fetchController) fetchController.abort();
        }
    }

    async function updateGrid() {
        if (!isActive || !map || !layerGroup) return;

        const status = document.getElementById('upper-wx-status');
        status.textContent = 'Updating...';

        if (fetchController) fetchController.abort();
        fetchController = new AbortController();

        try {
            const bounds = map.getBounds();
            // Create a 6x6 grid over the current visible map area
            const latSteps = 5;
            const lonSteps = 5;
            
            const latDiff = bounds.getNorth() - bounds.getSouth();
            const lonDiff = bounds.getEast() - bounds.getWest();
            
            const s = bounds.getSouth() + latDiff * 0.1;
            const n = bounds.getNorth() - latDiff * 0.1;
            const w = bounds.getWest() + lonDiff * 0.1;
            const e = bounds.getEast() - lonDiff * 0.1;

            const lats = [];
            const lons = [];

            for (let i = 0; i <= latSteps; i++) {
                for (let j = 0; j <= lonSteps; j++) {
                    const lat = s + (n - s) * (i / latSteps);
                    const lon = w + (e - w) * (j / lonSteps);
                    lats.push(lat.toFixed(3));
                    lons.push(lon.toFixed(3));
                }
            }

            const pressure = LEVELS[currentFL];
            const url = \`https://api.open-meteo.com/v1/forecast?latitude=\${lats.join(',')}&longitude=\${lons.join(',')}&hourly=temperature_\${pressure}hPa,wind_speed_\${pressure}hPa,wind_direction_\${pressure}hPa&wind_speed_unit=kn&timezone=UTC&forecast_days=1\`;

            const res = await fetch(url, { signal: fetchController.signal });
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();

            layerGroup.clearLayers();
            const currentHour = new Date().getUTCHours();
            
            const responses = Array.isArray(data) ? data : [data];

            responses.forEach(loc => {
                if (!loc.hourly) return;
                const temp = loc.hourly[\`temperature_\${pressure}hPa\`][currentHour];
                const spd = loc.hourly[\`wind_speed_\${pressure}hPa\`][currentHour];
                const dir = loc.hourly[\`wind_direction_\${pressure}hPa\`][currentHour];
                
                if (temp == null || spd == null || dir == null) return;
                
                drawMarker(loc.latitude, loc.longitude, temp, spd, dir);
            });

            status.textContent = 'Live data';
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                status.textContent = 'Error fetching data';
            }
        }
    }

    function getTempColor(temp) {
        if (temp < -50) return '#a855f7';
        if (temp < -30) return '#3b82f6';
        if (temp < -10) return '#0ea5e9';
        if (temp < 0)   return '#2dd4bf';
        if (temp < 10)  return '#10b981';
        if (temp < 25)  return '#f59e0b';
        return '#ef4444';
    }

    function drawMarker(lat, lon, temp, spd, dir) {
        const color = getTempColor(temp);
        
        const arrow = \`<svg viewBox="0 0 24 24" style="transform: rotate(\${dir}deg); width:16px; height:16px; color:\${color}; stroke:currentColor; fill:none; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; drop-shadow: 0 1px 2px rgba(0,0,0,0.5);">
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <polyline points="6 10 12 4 18 10"></polyline>
        </svg>\`;

        const html = \`
            <div class="uw-marker">
                <div class="uw-arrow">\${arrow}</div>
                <div class="uw-data">
                    <span class="uw-spd">\${Math.round(spd)}<small style="font-size:7px;opacity:0.7">kt</small></span>
                    <span class="uw-temp" style="color:\${color}">\${Math.round(temp)}°</span>
                </div>
            </div>
        \`;

        const icon = L.divIcon({
            className: 'uw-marker-wrapper',
            html: html,
            iconSize: [46, 46],
            iconAnchor: [23, 23]
        });

        L.marker([lat, lon], { icon, interactive: false }).addTo(layerGroup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
