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
                this._timeout = setTimeout(() => this._fetchGrid(), 1000); // 1 saniye bekle (Spam koruması)
            };

            this._map.on('moveend', this._scheduleUpdate);
            this._onClick = (e) => this._handleMapClick(e);
            this._map.on('click', this._onClick);
            
            if (!this._legend) {
                this._legend = new WindLegend();
            }
            this._legend.addTo(map);
            
            this._fetchGrid();
        },

        onRemove: function(map) {
            L.LayerGroup.prototype.onRemove.call(this, map);
            this.active = false;
            this._map.off('moveend', this._scheduleUpdate);
            this._map.off('click', this._onClick);
            
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
                console.warn("Click fetch error:", err);
                loadingPopup.remove();
            }
        },

        async _fetchGrid() {
            if (!this.active) return;
            
            if (this._abortController) this._abortController.abort();
            this._abortController = new AbortController();
            const signal = this._abortController.signal;
            
            try {
                // To capture local weather (like typhoons) we MUST use the current screen bounds,
                // but we keep it at 10x10 (1 request) to avoid Open-Meteo bans.
                const bounds = this._map.getBounds();
                const gridWidth = 10;
                const gridHeight = 10;
                
                const n = bounds.getNorth();
                const s = bounds.getSouth();
                let w = bounds.getWest();
                let e = bounds.getEast();
                
                if (e - w > 360) { e = w + 360; }
                
                const dy = (n - s) / (gridHeight - 1);
                const dx = (e - w) / (gridWidth - 1);
                
                const latsArr = [];
                const lonsArr = [];
                for (let y = 0; y < gridHeight; y++) {
                    const lat = n - (y * dy);
                    for (let x = 0; x < gridWidth; x++) {
                        const lon = w + (x * dx);
                        latsArr.push(lat.toFixed(2));
                        lonsArr.push(lon.toFixed(2));
                    }
                }
                
                const latsStr = latsArr.join(',');
                const lonsStr = lonsArr.join(',');
                const url = `https://api.open-meteo.com/v1/gfs?latitude=${latsStr}&longitude=${lonsStr}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
                
                const res = await fetch(url, { signal });
                if (!res.ok) {
                    throw new Error("Open-Meteo Rate Limit or Network Error");
                }
                
                const data = await res.json();
                if (!this.active) return;
                
                const pointsData = Array.isArray(data) ? data : [data];
                const uData = [];
                const vData = [];
                
                for (let i = 0; i < pointsData.length; i++) {
                    const point = pointsData[i];
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
