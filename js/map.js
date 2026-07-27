(function () {
    const map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 17 }).setView([39.0, 35.2], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>', subdomains: 'abcd', maxZoom: 20
    });
    const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>', subdomains: 'abcd', maxZoom: 20
    });
    darkLayer.addTo(map);

    // --- Measurement Tools ---
    let measureTool = null; // 'distance' or 'area' or null
    let measurePoints = [];
    let measureLine = null;
    let measureTempLine = null;
    let measureTooltip = null;
    let measureMarkers = [];
    
    let btnDistance = null;
    let btnArea = null;

    const MeasureControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '8px';
            container.style.boxShadow = 'none';
            container.style.border = 'none';
            container.style.backgroundColor = 'transparent';

            function createBtn(title, svg) {
                const btn = L.DomUtil.create('div', '');
                btn.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
                btn.style.color = '#fff';
                btn.style.cursor = 'pointer';
                btn.style.width = '34px';
                btn.style.height = '34px';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'center';
                btn.style.borderRadius = '8px';
                btn.style.border = '1px solid rgba(255,255,255,0.1)';
                btn.style.backdropFilter = 'blur(10px)';
                btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
                btn.title = title;
                btn.innerHTML = svg;
                container.appendChild(btn);
                return btn;
            }

            btnDistance = createBtn('Measure Distance', `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21L3 3M21 3L3 21"/></svg>`);
            btnArea = createBtn('Measure Area', `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20L12 4l9 16H3z"/></svg>`);

            btnDistance.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                toggleTool('distance');
            };
            btnArea.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                toggleTool('area');
            };
            return container;
        }
    });
    map.addControl(new MeasureControl());

    function clearMeasure() {
        if (measureLine) map.removeLayer(measureLine);
        if (measureTempLine) map.removeLayer(measureTempLine);
        if (measureTooltip) map.removeLayer(measureTooltip);
        measureMarkers.forEach(m => map.removeLayer(m));
        measureLine = null;
        measureTempLine = null;
        measureTooltip = null;
        measureMarkers = [];
        measurePoints = [];
    }

    function toggleTool(tool) {
        if (measureTool === tool) {
            measureTool = null;
        } else {
            measureTool = tool;
        }
        
        btnDistance.style.backgroundColor = (measureTool === 'distance') ? '#0ea5e9' : 'rgba(15, 23, 42, 0.9)';
        btnArea.style.backgroundColor = (measureTool === 'area') ? '#0ea5e9' : 'rgba(15, 23, 42, 0.9)';
        
        if (measureTool) {
            document.getElementById('map').style.cursor = 'crosshair';
        } else {
            document.getElementById('map').style.cursor = '';
        }
        clearMeasure();
    }

    function getSphericalArea(latlngs) {
        let area = 0;
        const radius = 6378137;
        const rad = Math.PI / 180;
        if (latlngs.length > 2) {
            for (let i = 0; i < latlngs.length; i++) {
                let p1 = latlngs[i];
                let p2 = latlngs[(i + 1) % latlngs.length];
                area += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
            }
            area = area * radius * radius / 2.0;
        }
        return Math.abs(area);
    }

    map.on('click', async (e) => {
        if (measureTool) {
            measurePoints.push(e.latlng);
            
            const circle = L.circleMarker(e.latlng, {
                radius: 4, color: '#fff', fillColor: '#0ea5e9', fillOpacity: 1, weight: 2
            }).addTo(map);
            measureMarkers.push(circle);

            if (measurePoints.length > 1) {
                if (measureLine) map.removeLayer(measureLine);
                
                if (measureTool === 'distance') {
                    measureLine = L.polyline(measurePoints, { color: '#0ea5e9', weight: 3, dashArray: '5, 8' }).addTo(map);
                } else if (measureTool === 'area') {
                    measureLine = L.polygon(measurePoints, { color: '#0ea5e9', weight: 3, dashArray: '5, 8', fillColor: '#0ea5e9', fillOpacity: 0.2 }).addTo(map);
                }
            }
            return;
        }

        // Weather Layer Click Logic
        const activeRadio = document.querySelector('input[name="weather_layer"]:checked');
        const activeLayer = activeRadio ? activeRadio.value : 'none';
        
        if (activeLayer === 'none' || activeLayer === 'satellite' || activeLayer === 'wind_grid') return;
        
        const { lat, lng } = e.latlng;
        
        const popup = L.popup({ className: 'custom-map-popup' })
            .setLatLng(e.latlng)
            .setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                <div style="color:#1e293b;font-weight:500;">Fetching data...</div>
            </div>`)
            .openOn(map);

        let varName = '';
        if (activeLayer === 'temperature') varName = 'temperature_2m';
        else if (activeLayer === 'pressure') varName = 'pressure_msl';
        else if (activeLayer === 'wind') varName = 'wind_speed_10m';
        else if (activeLayer === 'clouds') varName = 'cloud_cover';
        else if (activeLayer === 'radar') varName = 'precipitation';

        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=${varName}`);
            const data = await res.json();
            
            if (data && data.current && typeof data.current[varName] !== 'undefined') {
                const val = data.current[varName];
                const unit = data.current_units[varName];
                let label = '';
                if (activeLayer === 'temperature') label = 'Temperature';
                else if (activeLayer === 'pressure') label = 'Pressure';
                else if (activeLayer === 'wind') label = 'Wind Speed';
                else if (activeLayer === 'clouds') label = 'Cloud Cover';
                else if (activeLayer === 'radar') label = 'Precipitation';

                popup.setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                    <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
                    <div style="color:#0ea5e9;margin-top:4px;font-size:14px;font-weight:700;">${label}: ${val} ${unit}</div>
                </div>`);
            } else {
                throw new Error("No data");
            }
        } catch (err) {
            popup.setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
                <div style="color:#dc2626;margin-top:4px;font-weight:600;">Data unavailable</div>
            </div>`);
        }
    });

    function updateTooltip(latlng, html) {
        if (!measureTooltip) {
            measureTooltip = L.tooltip({ permanent: true, className: 'measure-tooltip', direction: 'right', offset: [15, 0] })
                .setLatLng(latlng)
                .setContent(html)
                .addTo(map);
        } else {
            measureTooltip.setLatLng(latlng).setContent(html);
        }
    }

    map.on('mousemove', (e) => {
        if (!measureTool || measurePoints.length === 0) return;
        
        const lastPt = measurePoints[measurePoints.length - 1];
        const ptsWithCurrent = [...measurePoints, e.latlng];
        
        if (measureTempLine) map.removeLayer(measureTempLine);

        if (measureTool === 'distance') {
            measureTempLine = L.polyline([lastPt, e.latlng], { color: '#0ea5e9', weight: 3, dashArray: '5, 8', opacity: 0.6 }).addTo(map);
            
            let totalDist = 0;
            for (let i = 0; i < ptsWithCurrent.length - 1; i++) {
                totalDist += map.distance(ptsWithCurrent[i], ptsWithCurrent[i+1]);
            }
            
            const nm = (totalDist / 1852).toFixed(1);
            const km = (totalDist / 1000).toFixed(1);
            updateTooltip(e.latlng, `<b>${nm} NM</b><br><small>${km} km</small>`);
            
        } else if (measureTool === 'area') {
            measureTempLine = L.polygon(ptsWithCurrent, { color: '#0ea5e9', weight: 3, dashArray: '5, 8', opacity: 0.6, fillColor: '#0ea5e9', fillOpacity: 0.2 }).addTo(map);
            
            if (ptsWithCurrent.length > 2) {
                const sqMeters = getSphericalArea(ptsWithCurrent);
                const sqKm = (sqMeters / 1000000).toFixed(2);
                const sqNm = (sqMeters / 3429904).toFixed(2);
                // Formatting with commas for readability
                const sqKmStr = parseFloat(sqKm).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                const sqNmStr = parseFloat(sqNm).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                updateTooltip(e.latlng, `<b>${sqKmStr} km²</b><br><small>${sqNmStr} NM²</small>`);
            } else {
                updateTooltip(e.latlng, `<b>Click to add points</b>`);
            }
        }
    });

    map.on('contextmenu', (e) => {
        if (measureTool) toggleTool(measureTool);
    });
    // -----------------------------

    const OWM_API_KEY = '4d37c40d3254d49e9304bbaf1b88b296';
    let currentWeatherLayer = null;

    const airportLayer = L.layerGroup().addTo(map);
    const aircraftLayer = L.layerGroup().addTo(map);
    const sigmetLayer = new window.SigmetLayer();
    let runwayLayer = null;
    if (window.RunwayLayer) {
        runwayLayer = new window.RunwayLayer().addTo(map);
    } else {
        console.warn('RunwayLayer not loaded, possibly due to cache.');
    }
    
    let airports = [];
    const activeAirportMarkers = new Map();

    function airportIcon(icao) {
        return L.divIcon({ className: '', html: `<div class="airport-marker"><span>${icao}</span></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    }

    function refreshVisibleAirports() {
        if (!map.hasLayer(airportLayer)) return;
        
        const bounds = map.getBounds().pad(0.2); // slight padding to load just outside view
        const zoom = map.getZoom();
        
        let maxType = 3;
        let minRunwayFt = 0;
        
        if (zoom < 5) { maxType = 1; minRunwayFt = 10000; }
        else if (zoom < 6) { maxType = 1; minRunwayFt = 8000; }
        else if (zoom < 7) { maxType = 1; }
        else if (zoom < 9) { maxType = 2; }

        const visibleIcaos = new Set();
        
        for (let i = 0; i < airports.length; i++) {
            const apt = airports[i];
            if (apt.t > maxType) continue;
            
            if (minRunwayFt > 0) {
                let maxRwy = 0;
                if (apt.runways) {
                    for (let r = 0; r < apt.runways.length; r++) {
                        if (apt.runways[r][2] > maxRwy) maxRwy = apt.runways[r][2];
                    }
                }
                if (maxRwy < minRunwayFt) continue;
            }
            
            if (bounds.contains([apt.lat, apt.lon])) {
                visibleIcaos.add(apt.icao);
                if (!activeAirportMarkers.has(apt.icao)) {
                    const marker = L.marker([apt.lat, apt.lon], { 
                        icon: airportIcon(apt.icao), 
                        keyboard: true, 
                        title: `${apt.icao} — ${apt.name}` 
                    });
                    marker.on('click', () => {
                        window.UI.openAirport(apt, true);
                    });
                    marker.addTo(airportLayer);
                    activeAirportMarkers.set(apt.icao, marker);
                }
            }
        }
        
        for (const [icao, marker] of activeAirportMarkers.entries()) {
            if (!visibleIcaos.has(icao)) {
                airportLayer.removeLayer(marker);
                activeAirportMarkers.delete(icao);
            }
        }
        
        const center = map.getCenter();
        const mainRegion = document.getElementById('main-region');
        
        if (mainRegion && airports.length > 0) {
            let closest = null;
            let minDistSq = Infinity;
            
            // Find closest airport to crosshair to determine local airspace
            for (let i = 0; i < airports.length; i++) {
                const a = airports[i];
                const dLat = a.lat - center.lat;
                const dLon = a.lon - center.lng;
                const distSq = dLat * dLat + dLon * dLon;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closest = a;
                }
            }
            
            let regionName = 'GLOBAL';
            if (closest && closest.country) {
                try {
                    regionName = new Intl.DisplayNames(['en'], { type: 'region' }).of(closest.country).toUpperCase();
                } catch (e) {
                    regionName = closest.country;
                }
            }
            
            // Only update if it changed to prevent unnecessary DOM writes
            const newText = `${regionName} AIRSPACE`;
            if (mainRegion.textContent !== newText) {
                mainRegion.textContent = newText;
            }
        }
    }

    map.on('moveend zoomend', refreshVisibleAirports);

    map.on('contextmenu', async (e) => {
        const { lat, lng } = e.latlng;
        
        // Show a loading popup immediately
        const popup = L.popup({ className: 'custom-map-popup' })
            .setLatLng(e.latlng)
            .setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                <div style="color:#1e293b;font-weight:500;">Loading location...</div>
            </div>`)
            .openOn(map);

        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`);
            const data = await res.json();
            
            let locationText = 'Unknown Location';
            if (data && data.address) {
                const city = data.address.city || data.address.town || data.address.village || data.address.county || data.address.state || '';
                const country = data.address.country || '';
                if (city && country) {
                    locationText = `${city}, <strong style="color:#0f172a;font-weight:700;">${country}</strong>`;
                } else if (country) {
                    locationText = `<strong style="color:#0f172a;font-weight:700;">${country}</strong>`;
                }
            } else if (data && data.error) {
                locationText = 'International Waters / No Data';
            }

            popup.setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
                <div style="color:#0369a1;margin-top:4px;font-size:14px;font-weight:600;">${locationText}</div>
            </div>`);
        } catch (err) {
            popup.setContent(`<div style="text-align:center;font-family:'Inter',sans-serif;font-size:13px;padding:4px;">
                <div style="color:#64748b;font-size:11px;margin-bottom:6px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
                <div style="color:#dc2626;margin-top:4px;font-weight:600;">Location check failed</div>
            </div>`);
        }
    });

    fetch('data/airports.json')
        .then(res => res.json())
        .then(data => {
            airports = data.map(a => ({
                icao: a.i,
                name: a.n,
                lat: a.lat,
                lon: a.lon,
                runwayHeading: a.h,
                t: a.t,
                country: a.c,
                elevation: a.e,
                runways: a.r,
                frequencies: a.f
            }));
            if (window.MapManager) window.MapManager.airports = airports;
            refreshVisibleAirports();
            if (window.UI && window.UI.updateAirportCount) window.UI.updateAirportCount();
            
            // Handle URL-based airport selection now that data is loaded
            const urlIcao = new URLSearchParams(window.location.search).get('icao');
            if (urlIcao && window.MapManager && window.UI) {
                const airport = window.MapManager.findAirport(urlIcao);
                if (airport) window.setTimeout(() => window.UI.openAirport(airport, true), 150);
            }
        })
        .catch(err => console.error('Failed to load global airports:', err));

    fetch('data/runway_coords.json')
        .then(res => res.json())
        .then(data => {
            if (window.MapManager) window.MapManager.runwayCoords = data;
        })
        .catch(err => console.error('Failed to load runway coordinates:', err));

    function dmsToDecimal(value) {
        const isLatitude = value.length === 7;
        const degreesLength = isLatitude ? 2 : 3;
        const degrees = Number(value.slice(0, degreesLength));
        const minutes = Number(value.slice(degreesLength, degreesLength + 2));
        const seconds = Number(value.slice(degreesLength + 2, degreesLength + 4));
        const hemisphere = value.slice(-1);
        const decimal = degrees + minutes / 60 + seconds / 3600;
        return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal;
    }

    // WindGridLayer is now implemented externally in wind-grid.js as window.WindGridLayer

    // Radar Playback State
    let radarLayers = [];
    let radarFrames = [];
    let radarCurrentFrame = 0;
    let radarPlayInterval = null;
    let isRadarPlaying = false;

    const radarPlayBtn = document.getElementById('playback-play-btn');
    const radarSlider = document.getElementById('playback-slider');
    const radarTimeLabel = document.getElementById('playback-time-label');
    const playbackContainer = document.getElementById('weather-playback-container');
    const iconPlay = radarPlayBtn ? radarPlayBtn.querySelector('.icon-play') : null;
    const iconPause = radarPlayBtn ? radarPlayBtn.querySelector('.icon-pause') : null;

    function showRadarFrame(idx) {
        if (!radarFrames.length) return;
        radarLayers.forEach((layer, i) => {
            layer.setOpacity(i === idx ? 0.65 : 0);
        });
        const d = new Date(radarFrames[idx].time * 1000);
        if (radarTimeLabel) {
            radarTimeLabel.textContent = `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} Z`;
        }
        if (radarSlider) radarSlider.value = idx;
        radarCurrentFrame = idx;
    }

    function startRadarPlayback() {
        if (!radarFrames.length) return;
        isRadarPlaying = true;
        if (iconPlay) iconPlay.classList.add('hidden');
        if (iconPause) iconPause.classList.remove('hidden');
        if (radarCurrentFrame === radarFrames.length - 1) {
            radarCurrentFrame = 0;
        }
        radarPlayInterval = setInterval(() => {
            radarCurrentFrame++;
            if (radarCurrentFrame >= radarFrames.length) {
                radarCurrentFrame = 0;
            }
            showRadarFrame(radarCurrentFrame);
        }, 800); // Fast animation loop
    }

    function stopRadarPlayback() {
        isRadarPlaying = false;
        if (iconPlay) iconPlay.classList.remove('hidden');
        if (iconPause) iconPause.classList.add('hidden');
        if (radarPlayInterval) clearInterval(radarPlayInterval);
    }

    if (radarPlayBtn && radarSlider) {
        radarPlayBtn.addEventListener('click', () => {
            if (isRadarPlaying) stopRadarPlayback();
            else startRadarPlayback();
        });

        radarSlider.addEventListener('input', (e) => {
            stopRadarPlayback();
            showRadarFrame(parseInt(e.target.value, 10));
        });
    }

    async function setWeatherOverlay(type) {
        if (currentWeatherLayer) {
            map.removeLayer(currentWeatherLayer);
            currentWeatherLayer = null;
            stopRadarPlayback();
            if (playbackContainer) playbackContainer.classList.add('hidden');
            radarLayers = [];
        }
        
        const timestampEl = document.getElementById('weather-timestamp');
        
        if (type === 'clouds') {
            currentWeatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`, {
                opacity: 0.6, maxZoom: 18, attribution: '© OpenWeatherMap', className: 'weather-clouds-layer'
            }).addTo(map);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Clouds updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
            
        } else if (type === 'temperature') {
            currentWeatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`, {
                opacity: 0.65, maxZoom: 18, attribution: '© OpenWeatherMap', className: 'weather-temp-layer'
            }).addTo(map);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Temperature updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
            
        } else if (type === 'wind') {
            currentWeatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`, {
                opacity: 0.65, maxZoom: 18, attribution: '© OpenWeatherMap', className: 'weather-wind-layer'
            }).addTo(map);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Wind Speed Heatmap updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
            
        } else if (type === 'pressure') {
            currentWeatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`, {
                opacity: 0.65, maxZoom: 18, attribution: '© OpenWeatherMap', className: 'weather-pressure-layer'
            }).addTo(map);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Sea Level Pressure updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
            
        } else if (type === 'satellite') {
            currentWeatherLayer = L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/goes/global_ir.cgi', {
                layers: 'global_ir',
                format: 'image/png',
                transparent: true,
                opacity: 0.6,
                attribution: '© IEM Satellite',
                className: 'weather-satellite-layer'
            }).addTo(map);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Satellite updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
            
        } else if (type === 'radar') {
            try {
                const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
                const data = await res.json();
                radarFrames = data.radar.past;
                
                currentWeatherLayer = L.layerGroup().addTo(map);
                radarLayers = [];
                
                radarFrames.forEach((frame) => {
                    const layer = L.tileLayer(`${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                        opacity: 0, maxZoom: 18, maxNativeZoom: 7, attribution: '© RainViewer', className: 'weather-radar-layer'
                    });
                    currentWeatherLayer.addLayer(layer);
                    radarLayers.push(layer);
                });
                
                if (radarSlider) {
                    radarSlider.max = radarFrames.length - 1;
                    radarCurrentFrame = radarFrames.length - 1;
                    showRadarFrame(radarCurrentFrame);
                }
                
                if (playbackContainer) playbackContainer.classList.remove('hidden');
                timestampEl.classList.add('hidden');
                
            } catch (e) {
                console.error('Failed to load RainViewer radar', e);
            }
        } else if (type === 'wind_grid') {
            currentWeatherLayer = new window.WindParticlesLayer();
            map.addLayer(currentWeatherLayer);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Wind Grid updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
        } else {
            timestampEl.classList.add('hidden');
        }
        
        updateWeatherLegend(type);
    }

    function updateWeatherLegend(type) {
        const legendContainer = document.getElementById('weather-legend-container');
        const titleEl = document.getElementById('legend-title');
        const gradientEl = document.getElementById('legend-gradient');
        const labelsEl = document.getElementById('legend-labels');
        
        if (!legendContainer || !titleEl || !gradientEl || !labelsEl) return;
        
        if (type === 'none' || type === 'clouds' || type === 'satellite') {
            legendContainer.classList.add('hidden');
            return;
        }
        
        let title = '';
        let gradient = '';
        let labels = [];
        
        if (type === 'temperature') {
            title = 'Temperature (°C)';
            gradient = 'linear-gradient(to right, #821692, #208cec, #23dddd, #c2ff28, #fff028, #fc8014, #ff0000)';
            labels = ['-40', '-20', '0', '10', '20', '30', '40+'];
        } else if (type === 'wind' || type === 'wind_grid') {
            title = 'Wind Speed (kt)';
            gradient = 'linear-gradient(to right, #8b98a5, #4da6ff, #4ddb85, #f5c542, #f57c42, #f54263)';
            labels = ['0', '10', '20', '30', '40', '50+'];
        } else if (type === 'pressure') {
            title = 'Sea Level Pressure (hPa)';
            gradient = 'linear-gradient(to right, #0073ff, #00aafe, #4bcf00, #c9fb00, #ffcc00, #ff6600, #ff0000)';
            labels = ['940', '960', '980', '1000', '1020', '1040+'];
        } else if (type === 'radar') {
            title = 'Precipitation Intensity';
            gradient = 'linear-gradient(to right, #8BE1FA, #0036FF, #00FF00, #FFFF00, #FF0000, #FF00FF)';
            labels = ['Light', 'Moderate', 'Heavy', 'Extreme'];
        }
        
        titleEl.textContent = title;
        gradientEl.style.background = gradient;
        labelsEl.innerHTML = labels.map(l => `<span>${l}</span>`).join('');
        legendContainer.classList.remove('hidden');
    }

    function getAircraftScale(type) {
        if (!type) return 0.7;
        type = type.toUpperCase();
        
        // Heavy / Wide-body
        if (type.match(/^(B74|B76|B77|B78|A30|A310|A33|A34|A35|A38|C17|IL9|AN1|MD11|DC10)/)) return 1.45;
        
        // Medium / Narrow-body Airliners
        if (type.match(/^(B73|B38|B39|B75|A31[89]|A32|A20|A21|E17|E19|E29|MD8|MD9|CRJ|BCS|CS1|CS3|F70|F100)/)) return 1.0;
        
        // Small / Light / Props / Bizjets
        return 0.65;
    }

    function aircraftIcon(aircraft) {
        const turn = Number.isFinite(aircraft.track) ? aircraft.track : (Number.isFinite(aircraft.heading) ? aircraft.heading : 0);
        const scale = getAircraftScale(aircraft.t);
        const selected = '';
        const svg = `<svg viewBox="0 0 24 24" width="24" height="24" class="aircraft-svg" style="transform: rotate(${turn}deg) scale(${scale});"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
        return L.divIcon({
            className: 'aircraft-marker' + selected,
            html: svg,
            iconSize: [24, 24], iconAnchor: [12, 12]
        });
    }

    function updateAircraftMarkers(aircraft) {
        aircraftLayer.clearLayers();
        aircraft.forEach(plane => {
            const marker = L.marker([plane.lat, plane.lon], { icon: aircraftIcon(plane), keyboard: false, interactive: true });
            marker.bindTooltip(`${plane.callsign || plane.registration || plane.hex || 'Bilinmeyen'} · ${plane.altitude ?? '—'} ft · ${plane.speed ?? '—'} kt`, { direction: 'top', offset: [0, -12], opacity: .92 });
            marker.on('click', () => window.UI.showFlight(plane));
            marker.addTo(aircraftLayer);
        });
    }

    function getViewportSearch() {
        const center = map.getCenter();
        const bounds = map.getBounds();
        const corner = bounds.getNorthEast();
        const radiusNm = Math.min(250, Math.max(30, Math.ceil(map.distance(center, corner) / 1852)));
        return { lat: center.lat, lon: center.lng, radiusNm };
    }

    function focusFlight(aircraft) {
        const zoom = Math.min(11, Math.max(9, map.getZoom() + 2));
        map.flyTo([aircraft.lat, aircraft.lon], zoom, { animate: true, duration: .75, easeLinearity: .25 });
    }

    function distanceNm(first, second) {
        return map.distance([first.lat, first.lon], [second.lat, second.lon]) / 1852;
    }

    let mapMoveTimer = null;
    map.on('moveend', () => {
        window.clearTimeout(mapMoveTimer);
        mapMoveTimer = window.setTimeout(() => window.App?.refreshAirspace({ quiet: true }), 800);
    });

    window.MapManager = {
        map,
        airports,
        updateAircraftMarkers,
        getViewportSearch,
        distanceNm,
        findAirport(query) {
            const value = query.trim().toLocaleUpperCase('tr-TR');
            return airports.find(airport => airport.icao === value) || airports.find(airport => airport.name.toLocaleUpperCase('tr-TR').includes(value));
        },
        setTheme(theme) {
            if (theme === 'light') {
                if (map.hasLayer(darkLayer)) map.removeLayer(darkLayer);
                if (!map.hasLayer(lightLayer)) lightLayer.addTo(map);
            } else {
                if (map.hasLayer(lightLayer)) map.removeLayer(lightLayer);
                if (!map.hasLayer(darkLayer)) darkLayer.addTo(map);
            }
        },
        focusAirport(airport, zoom = 12) {
            map.flyTo([airport.lat, airport.lon], zoom, { duration: .7 });
        },
        focusFlight,
        setLayerVisibility({ aircrafts, airports: airportsVisible, sigmets }) {
            const layers = [
                [aircraftLayer, aircrafts],
                [airportLayer, airportsVisible],
                [sigmetLayer, sigmets]
            ];
            layers.forEach(([layer, visible]) => {
                if (visible && !map.hasLayer(layer)) {
                    map.addLayer(layer);
                    if (layer === airportLayer) refreshVisibleAirports();
                }
                if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
            });
        },
        setWeatherOverlay
    };
}());
