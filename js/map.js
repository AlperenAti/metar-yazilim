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

    const OWM_API_KEY = '4d37c40d3254d49e9304bbaf1b88b296';
    let currentWeatherLayer = null;

    const airportLayer = L.layerGroup().addTo(map);
    const aircraftLayer = L.layerGroup().addTo(map);
    const sigmetLayer = new window.SigmetLayer();
    
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

    const WindGridLayer = L.LayerGroup.extend({
        initialize: function() {
            L.LayerGroup.prototype.initialize.call(this);
            this.active = false;
            this._currentGeneration = 0;
            this._abortController = null;
            this._scheduleUpdate = () => {
                if (this._timeout) clearTimeout(this._timeout);
                this._timeout = setTimeout(() => this.updateGrid(), 400);
            };
        },
        onAdd: function(map) {
            L.LayerGroup.prototype.onAdd.call(this, map);
            this._map = map;
            this.active = true;
            this._scheduleUpdate(); // Use the unified scheduler here too
            map.on('moveend', this._scheduleUpdate, this);
        },
        onRemove: function(map) {
            L.LayerGroup.prototype.onRemove.call(this, map);
            this.active = false;
            map.off('moveend', this._scheduleUpdate, this);
            if (this._timeout) clearTimeout(this._timeout);
            if (this._abortController) {
                this._abortController.abort();
                this._abortController = null;
            }
            this.clearLayers();
        },
        updateGrid: async function() {
            if (!this.active) return;
            const generation = ++this._currentGeneration;
            
            if (this._abortController) {
                this._abortController.abort();
            }
            this._abortController = new AbortController();
            const signal = this._abortController.signal;
            
            const bounds = this._map.getBounds();
            const latDelta = bounds.getNorth() - bounds.getSouth();
            const lonDelta = bounds.getEast() - bounds.getWest();
            
            const zoom = this._map.getZoom();
            
            // Balanced density to prevent overlapping "barcode" effect and Leaflet lag
            let steps = 18;
            if (zoom < 5) steps = 10;
            else if (zoom < 8) steps = 14;
            
            const latStep = latDelta / steps;
            const lonStep = lonDelta / steps;
            
            const pointsMap = new Map();
            const startLat = Math.floor(bounds.getSouth() / latStep) * latStep;
            const startLon = Math.floor(bounds.getWest() / lonStep) * lonStep;
            
            for (let lat = startLat; lat <= bounds.getNorth() + latStep; lat += latStep) {
                for (let lon = startLon; lon <= bounds.getEast() + lonStep; lon += lonStep) {
                    if (lat > 90 || lat < -90) continue;
                    
                    let qLon = lon % 360;
                    if (qLon > 180) qLon -= 360;
                    if (qLon < -180) qLon += 360;
                    
                    // Deduplicate API queries (GFS resolution is 0.25 deg, so 2 decimals is plenty)
                    const qLatStr = lat.toFixed(2);
                    const qLonStr = qLon.toFixed(2);
                    const key = `${qLatStr},${qLonStr}`;
                    
                    if (!pointsMap.has(key)) {
                        pointsMap.set(key, { qLat: qLatStr, qLon: qLonStr, renderTargets: [] });
                    }
                    
                    pointsMap.get(key).renderTargets.push({ mapLat: lat, mapLon: lon });
                }
            }
            
            const uniquePoints = Array.from(pointsMap.values());
            if (uniquePoints.length === 0) return;
            
            // Increased chunk size to 90 to drastically reduce the number of requests (max 100 per Open-Meteo docs)
            const chunkSize = 90;
            const chunks = [];
            for (let i = 0; i < uniquePoints.length; i += chunkSize) {
                chunks.push(uniquePoints.slice(i, i + chunkSize));
            }
            
            try {
                // Fetch chunks sequentially to avoid burst rate limits (429 Too Many Requests)
                const chunkResults = [];
                for (const chunk of chunks) {
                    // Check if request is stale during the sequential fetch
                    if (!this.active || generation !== this._currentGeneration) return;
                    
                    const lats = chunk.map(p => p.qLat).join(',');
                    const lons = chunk.map(p => p.qLon).join(',');
                    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`;
                    
                    try {
                        const res = await fetch(url, { signal });
                        if (!res.ok) {
                            console.warn("Open-Meteo chunk failed:", res.status);
                            chunkResults.push([]);
                            continue;
                        }
                        const data = await res.json();
                        chunkResults.push(Array.isArray(data) ? data : [data]);
                    } catch (e) {
                        if (e.name === 'AbortError') {
                            // If aborted, a new generation has taken over, just exit quietly
                            return;
                        }
                        console.warn("Fetch error:", e);
                        chunkResults.push([]);
                    }
                }
                
                if (!this.active || generation !== this._currentGeneration) return; 
                
                // Only update the map if we got at least some valid data back
                // This prevents the map from going blank if the API rate limits us
                const hasData = chunkResults.some(r => r && r.length > 0);
                if (!hasData) return;
                
                this.clearLayers();
                
                chunkResults.forEach((results, chunkIndex) => {
                    results.forEach((point, i) => {
                        const originalPoint = chunks[chunkIndex][i];
                        
                        if (!point || !point.current || typeof point.current.wind_direction_10m !== 'number') return;
                        
                        const windDir = point.current.wind_direction_10m;
                        const windSpeed = point.current.wind_speed_10m;
                        const rotate = windDir + 180;
                        
                        // Dynamic tail length: 8 (0kt) up to 24 (40+ kt)
                        const tailY = Math.min(24, Math.max(8, 8 + (windSpeed / 40) * 16));
                        
                        // Sleek, ultra-thin SVG arrow (stroke-width: 1)
                        const svg = `<svg viewBox="0 0 24 24" width="22" height="22" style="transform: rotate(${rotate}deg); opacity: 0.85; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"><path d="M12 2L12 ${tailY}M12 2L7 7M12 2L17 7" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                        
                        const icon = L.divIcon({
                            className: 'wind-arrow-marker',
                            html: svg,
                            iconSize: [22, 22],
                            iconAnchor: [11, 11]
                        });
                        
                        originalPoint.renderTargets.forEach(target => {
                            const marker = L.marker([Number(target.mapLat), Number(target.mapLon)], { icon, interactive: true, keyboard: false });
                            marker.bindTooltip(`${windSpeed.toFixed(0)} kt`, { direction: 'top', offset: [0, -6], opacity: 0.9, className: 'wind-tooltip' });
                            marker.addTo(this);
                        });
                    });
                });
                
            } catch (err) {
                console.error("Wind Grid Error:", err);
            }
        }
    });

    async function setWeatherOverlay(type) {
        if (currentWeatherLayer) {
            map.removeLayer(currentWeatherLayer);
            currentWeatherLayer = null;
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
            
        } else if (type === 'radar') {
            try {
                const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
                const data = await res.json();
                const latestPath = data.radar.past[data.radar.past.length - 1].path;
                const latestTime = data.radar.past[data.radar.past.length - 1].time;
                
                currentWeatherLayer = L.tileLayer(`${data.host}${latestPath}/256/{z}/{x}/{y}/2/1_1.png`, {
                    opacity: 0.65, maxZoom: 18, maxNativeZoom: 7, attribution: '© RainViewer'
                }).addTo(map);
                
                const d = new Date(latestTime * 1000);
                const zulu = `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} Z`;
                timestampEl.textContent = `Radar updated: ${zulu}`;
                timestampEl.classList.remove('hidden');
                
            } catch (e) {
                console.error('Failed to load RainViewer radar', e);
            }
        } else if (type === 'wind_grid') {
            currentWeatherLayer = new WindGridLayer();
            map.addLayer(currentWeatherLayer);
            
            const now = new Date();
            const zulu = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} Z`;
            timestampEl.textContent = `Wind Grid updated: ${zulu}`;
            timestampEl.classList.remove('hidden');
        } else {
            timestampEl.classList.add('hidden');
        }
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
