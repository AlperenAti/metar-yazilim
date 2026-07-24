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
            this._scheduleUpdate();
        },

        onRemove: function(map) {
            L.LayerGroup.prototype.onRemove.call(this, map);
            this.active = false;
            map.off('moveend', this._scheduleUpdate);
            
            if (this._timeout) clearTimeout(this._timeout);
            if (this._abortController) this._abortController.abort();
            
            if (this._velocityLayer) {
                map.removeLayer(this._velocityLayer);
                this._velocityLayer = null;
            }
        },

        async _fetchGrid() {
            if (!this.active) return;
            const generation = ++this._currentGeneration;
            
            if (this._abortController) this._abortController.abort();
            this._abortController = new AbortController();
            const signal = this._abortController.signal;
            
            const bounds = this._map.getBounds();
            
            // We need a dense enough grid for fluid particles.
            // leaflet-velocity interpolates beautifully, so a 20x20 grid is visually stunning.
            // 20x20 = 400 points = 4 Open-Meteo requests.
            const gridWidth = 20;
            const gridHeight = 20;
            
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
                    if (!res.ok) throw new Error("API Error");
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
