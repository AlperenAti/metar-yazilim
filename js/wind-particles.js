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
                this._timeout = setTimeout(() => this._fetchGrid(), 1500); // 1.5 second delay (Spam protection)
            };
            this._map.on('moveend', this._scheduleUpdate);

            this._onClick = (e) => this._handleMapClick(e);
            this._map.on('click', this._onClick);
            
            this._fetchGrid();
        },

        onRemove: function(map) {
            L.LayerGroup.prototype.onRemove.call(this, map);
            this.active = false;
            this._map.off('click', this._onClick);
            this._map.off('moveend', this._scheduleUpdate);
            
            if (this._timeout) clearTimeout(this._timeout);
            if (this._abortController) this._abortController.abort();
            
            if (this._velocityLayer) {
                map.removeLayer(this._velocityLayer);
                this._velocityLayer = null;
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
                    loadingPopup.remove();
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
                    loadingPopup.remove();
                }
            } catch(err) {
                loadingPopup.setContent('<div style="font-family: Inter, sans-serif; font-size: 11px; color: #f54263; padding: 5px; text-align: center;">Wind data limit reached.</div>');
                setTimeout(() => loadingPopup.remove(), 2000);
            }
        },

        async _fetchGrid() {
            if (!this.active) return;
            
            if (this._abortController) this._abortController.abort();
            this._abortController = new AbortController();
            const signal = this._abortController.signal;
            
            try {
                // Fetch dynamic grid based on current map bounds for maximum local accuracy
                const bounds = this._map.getBounds();
                const n = Math.min(85, bounds.getNorth() + 1);
                const s = Math.max(-85, bounds.getSouth() - 1);
                const w = bounds.getWest() - 1;
                const e = bounds.getEast() + 1;

                const gridWidth = 10;
                const gridHeight = 10;
                
                const dy = (n - s) / (gridHeight - 1);
                const dx = (e - w) / (gridWidth - 1);
                
                const points = [];
                for (let y = 0; y < gridHeight; y++) {
                    const lat = n - (y * dy);
                    for (let x = 0; x < gridWidth; x++) {
                        let lon = w + (x * dx);
                        // Normalize longitude
                        while (lon > 180) lon -= 360;
                        while (lon < -180) lon += 360;
                        points.push({ lat, lon });
                    }
                }
                
                const chunkSize = 100;
                const chunks = [];
                for (let i = 0; i < points.length; i += chunkSize) {
                    chunks.push(points.slice(i, i + chunkSize));
                }
                
                const fetchPromises = chunks.map(chunk => {
                    const lats = chunk.map(p => p.lat.toFixed(2)).join(',');
                    const lons = chunk.map(p => p.lon.toFixed(2)).join(',');
                    const url = `https://api.open-meteo.com/v1/gfs?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
                    return fetch(url, { signal }).then(res => {
                        if (!res.ok) throw new Error("Open-Meteo Limit");
                        return res.json();
                    });
                });
                
                const chunkResults = await Promise.all(fetchPromises);
                
                if (!this.active) return;
                
                const allResults = [];
                chunkResults.forEach(data => {
                    const arr = Array.isArray(data) ? data : [data];
                    arr.forEach(r => allResults.push(r));
                });
                
                const uData = [];
                const vData = [];
                
                for (let i = 0; i < allResults.length; i++) {
                    const point = allResults[i];
                    if (point && point.current && typeof point.current.wind_direction_10m === 'number') {
                        const speed = point.current.wind_speed_10m; 
                        const dir = point.current.wind_direction_10m; 
                        
                        const rad = dir * Math.PI / 180;
                        const u = -speed * Math.sin(rad);
                        const v = -speed * Math.cos(rad);
                        
                        uData.push(Number(u.toFixed(2)));
                        vData.push(Number(v.toFixed(2)));
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
                
                this._renderVelocity(velocityData);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.warn("Wind Particles Error (Client Fetch):", e);
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

    window.WindParticlesLayer = L.WindParticlesLayer;
}());
