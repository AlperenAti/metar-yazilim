/*
 * Global Animated Wind Particles (Streamlines)
 * Fetches GFS data from Open-Meteo and feeds it dynamically to leaflet-velocity.
 */

(function () {
    L.WindParticlesLayer = L.LayerGroup.extend({
        initialize: function(options) {
            L.LayerGroup.prototype.initialize.call(this);
            this._velocityLayer = null;
            this._currentGeneration = 0;
            this._abortController = null;
            this._legend = null;
            this.active = false;
        },

        onAdd: function(map) {
            L.LayerGroup.prototype.onAdd.call(this, map);
            this._map = map;
            this.active = true;

            this._scheduleUpdate = () => {
                if (this._timeout) clearTimeout(this._timeout);
                this._timeout = setTimeout(() => this._fetchGrid(), 600);
            };

            map.on('moveend', this._scheduleUpdate);
            this._onClick = (e) => this._handleMapClick(e);
            map.on('click', this._onClick);
            
            if (!this._legend) {
                this._legend = new WindLegend();
            }
            this._legend.addTo(map);
            
            this._scheduleUpdate();
        },

        onRemove: function(map) {
            L.LayerGroup.prototype.onRemove.call(this, map);
            this.active = false;
            map.off('moveend', this._scheduleUpdate);
            map.off('click', this._onClick);
            
            if (this._timeout) clearTimeout(this._timeout);
            if (this._abortController) this._abortController.abort();
            
            if (this._velocityLayer) {
                map.removeLayer(this._velocityLayer);
                this._velocityLayer = null;
            }
            if (this._legend) {
                map.removeControl(this._legend);
                this._legend = null;
            }
        },

        async _handleMapClick(e) {
            if (!this.active) return;
            
            // Immediate visual feedback to prevent spam-clicking confusion
            const loadingPopup = L.popup({ className: 'dark-popup', closeOnClick: true })
                .setLatLng(e.latlng)
                .setContent('<div style="font-family: Inter, sans-serif; font-size: 12px; color: #8b98a5; padding: 5px; text-align: center;">Fetching data...</div>')
                .openOn(this._map);

            const lat = e.latlng.lat.toFixed(2);
            const lon = e.latlng.lng.toFixed(2);
            
            try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`;
                const res = await fetch(url);
                
                if (!res.ok) {
                    loadingPopup.setContent('<div style="font-family: Inter, sans-serif; font-size: 12px; color: #f54263; padding: 5px; text-align: center;">API Rate Limit.<br>Please wait a second.</div>');
                    return;
                }
                
                const data = await res.json();
                
                if (data && data.current && typeof data.current.wind_speed_10m === 'number') {
                    const speedKn = data.current.wind_speed_10m;
                    const dir = data.current.wind_direction_10m;
                    
                    const container = document.createElement('div');
                    container.style.fontFamily = "'Inter', sans-serif";
                    container.style.textAlign = 'center';
                    
                    const title = document.createElement('div');
                    title.style.fontSize = '11px';
                    title.style.color = '#8b98a5'; 
                    title.style.marginBottom = '4px';
                    title.style.textTransform = 'uppercase';
                    title.innerText = 'Wind at location';
                    
                    const valueDiv = document.createElement('div');
                    valueDiv.style.fontSize = '16px';
                    valueDiv.style.fontWeight = '600';
                    valueDiv.style.color = '#fff';
                    valueDiv.appendChild(document.createTextNode(`${dir}° @ `));
                    
                    const span = document.createElement('span');
                    span.style.cursor = 'pointer';
                    span.style.borderBottom = '1px dashed #8b98a5';
                    span.style.color = '#4da6ff';
                    span.title = "Click to change units";
                    span.innerText = `${speedKn.toFixed(1)} kt`;
                    
                    let state = 0;
                    span.addEventListener('click', (ev) => {
                        ev.stopPropagation(); 
                        state = (state + 1) % 3;
                        if (state === 0) span.innerText = speedKn.toFixed(1) + ' kt';
                        else if (state === 1) span.innerText = (speedKn * 1.852).toFixed(1) + ' km/h';
                        else if (state === 2) span.innerText = (speedKn * 1.15078).toFixed(1) + ' mph';
                    });
                    
                    valueDiv.appendChild(span);
                    container.appendChild(title);
                    container.appendChild(valueDiv);
                    
                    loadingPopup.setContent(container);
                } else {
                    loadingPopup.setContent('<div style="font-family: Inter, sans-serif; font-size: 12px; color: #f54263; padding: 5px; text-align: center;">No data here.</div>');
                }
            } catch(err) {
                console.warn("Click fetch error:", err);
                loadingPopup.setContent('<div style="font-family: Inter, sans-serif; font-size: 12px; color: #f54263; padding: 5px; text-align: center;">Network Error</div>');
            }
        },

        async _fetchGrid() {
            if (!this.active) return;
            const generation = ++this._currentGeneration;
            
            if (this._abortController) this._abortController.abort();
            this._abortController = new AbortController();
            const signal = this._abortController.signal;
            
            const bounds = this._map.getBounds();
            
            // A 10x10 grid is 100 points, which means exactly 1 Open-Meteo API request!
            // This completely eliminates the 429 Too Many Requests burst limits.
            // leaflet-velocity will smoothly interpolate these 100 points across the screen.
            const gridWidth = 10;
            const gridHeight = 10;
            
            const n = bounds.getNorth();
            const s = bounds.getSouth();
            let w = bounds.getWest();
            let e = bounds.getEast();
            
            // Prevent huge overlaps or bad dx
            if (e - w > 360) { e = w + 360; }
            
            const dy = (n - s) / (gridHeight - 1);
            const dx = (e - w) / (gridWidth - 1);
            
            // Generate exact coordinates
            const points = [];
            
            // leaflet-velocity expects data starting from North to South, West to East
            for (let y = 0; y < gridHeight; y++) {
                const lat = n - (y * dy);
                for (let x = 0; x < gridWidth; x++) {
                    const lon = w + (x * dx);
                    
                    let qLon = lon % 360;
                    if (qLon > 180) qLon -= 360;
                    if (qLon < -180) qLon += 360;
                    
                    let qLat = lat;
                    if (qLat > 90) qLat = 90;
                    if (qLat < -90) qLat = -90;
                    
                    points.push({ lat: qLat, lon: qLon });
                }
            }
            
            // Chunking to max 100 per request
            const chunkSize = 100;
            const chunks = [];
            for (let i = 0; i < points.length; i += chunkSize) {
                chunks.push(points.slice(i, i + chunkSize));
            }
            
            try {
                const fetchPromises = chunks.map(async chunk => {
                    const lats = chunk.map(p => p.lat.toFixed(2)).join(',');
                    const lons = chunk.map(p => p.lon.toFixed(2)).join(',');
                    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
                    
                    const res = await fetch(url, { signal });
                    if (!res.ok) {
                        if (res.status === 429) {
                            throw new Error("RATE_LIMIT");
                        }
                        throw new Error("API Error");
                    }
                    return await res.json();
                });
                
                const chunkResults = await Promise.all(fetchPromises);
                if (generation !== this._currentGeneration || !this.active) return;
                
                // Flatten results to match the 'points' array exactly
                const allResults = [];
                chunkResults.forEach(data => {
                    const arr = Array.isArray(data) ? data : [data];
                    arr.forEach(r => allResults.push(r));
                });
                
                // Build U and V arrays
                const uData = [];
                const vData = [];
                
                for (let i = 0; i < allResults.length; i++) {
                    const point = allResults[i];
                    if (point && point.current && typeof point.current.wind_direction_10m === 'number') {
                        const speed = point.current.wind_speed_10m; // in m/s
                        const dir = point.current.wind_direction_10m; // meteorological degrees
                        
                        // Convert meteorological degrees to math radians
                        // Meteorological: 0 is North, blowing to South.
                        // U is toward East (+), V is toward North (+)
                        // If wind is from 90 (East), U is negative.
                        const rad = dir * Math.PI / 180;
                        const u = -speed * Math.sin(rad);
                        const v = -speed * Math.cos(rad);
                        
                        uData.push(u);
                        vData.push(v);
                    } else {
                        // Fallback
                        uData.push(0);
                        vData.push(0);
                    }
                }
                
                // Construct leaflet-velocity JSON format
                const velocityData = [
                    {
                        header: {
                            parameterCategory: 2,
                            parameterNumber: 2, // U-component
                            dx: dx,
                            dy: dy,
                            la1: n,
                            la2: s,
                            lo1: w,
                            lo2: e,
                            nx: gridWidth,
                            ny: gridHeight
                        },
                        data: uData
                    },
                    {
                        header: {
                            parameterCategory: 2,
                            parameterNumber: 3, // V-component
                            dx: dx,
                            dy: dy,
                            la1: n,
                            la2: s,
                            lo1: w,
                            lo2: e,
                            nx: gridWidth,
                            ny: gridHeight
                        },
                        data: vData
                    }
                ];
                
                // Render the new velocity layer
                this._renderVelocity(velocityData);

            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.warn("Wind Particles Error:", e);
                    if (e.message === "RATE_LIMIT") {
                        // Show a discrete popup on the map instead of a blocking alert
                        L.popup({ className: 'dark-popup' })
                            .setLatLng(this._map.getCenter())
                            .setContent('<div style="color: #f54263; font-weight: bold; text-align: center;">Open-Meteo API Rate Limit!<br><span style="font-size: 12px; color: #fff;">Lütfen 1 dakika bekleyin.</span></div>')
                            .openOn(this._map);
                    }
                }
            }
        },

        _renderVelocity(data) {
            if (this._velocityLayer) {
                this._map.removeLayer(this._velocityLayer);
            }
            
            this._velocityLayer = L.velocityLayer({
                displayValues: true,
                displayOptions: {
                    velocityType: 'Global Wind',
                    displayPosition: 'bottomleft',
                    displayEmptyString: 'No wind data'
                },
                data: data,
                maxVelocity: 30,     // Max velocity for color scale (m/s)
                velocityScale: 0.008, // Adjust particle speed
                colorScale: [
                    "#8b98a5",
                    "#4da6ff",
                    "#4ddb85",
                    "#f5c542",
                    "#f57c42",
                    "#f54263"
                ]
            });
            
            if (this.active) {
                this._velocityLayer.addTo(this._map);
            }
        }
    });

    const WindLegend = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function (map) {
            const div = L.DomUtil.create('div', 'wind-legend-control');
            // Colors: ["#8b98a5", "#4da6ff", "#4ddb85", "#f5c542", "#f57c42", "#f54263"]
            div.innerHTML = `
                <div class="wind-legend-title">Wind Speed (kt)</div>
                <div class="wind-legend-scale" style="margin-bottom: 14px;">
                    <div style="background: #8b98a5;"><span>0</span></div>
                    <div style="background: #4da6ff;"><span>10</span></div>
                    <div style="background: #4ddb85;"><span>20</span></div>
                    <div style="background: #f5c542;"><span>30</span></div>
                    <div style="background: #f57c42;"><span>40</span></div>
                    <div style="background: #f54263;"><span>50+</span></div>
                </div>
            `;
            return div;
        }
    });

    window.WindParticlesLayer = L.WindParticlesLayer;
}());
