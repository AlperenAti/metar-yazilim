/* global L */

window.UpperTempLayer = L.Layer.extend({
    initialize: function(fl) {
        this.fl = fl || '340';
        const LEVELS = {
            '50': 850, '100': 700, '180': 500, '240': 400,
            '300': 300, '340': 250, '390': 200, '450': 150
        };
        this.pressure = LEVELS[this.fl] || 250;
        
        this._heatLayer = L.heatLayer([], { 
            radius: 40, 
            blur: 30, 
            maxZoom: 17, 
            max: 1.0,
            gradient: {
                0.0: '#a855f7', // -80C (Deep Purple)
                0.25: '#3b82f6', // -50C (Blue)
                0.5: '#0ea5e9', // -20C (Light Blue)
                0.75: '#10b981', // 10C (Green)
                1.0: '#ef4444'   // 40C (Red)
            }
        });
        this.active = false;
        this._abortController = null;
    },

    onAdd: function(map) {
        this._map = map;
        this.active = true;
        this._heatLayer.addTo(map);
        
        this._map.on('moveend', this._fetchGrid, this);
        this._fetchGrid();
    },

    onRemove: function(map) {
        this.active = false;
        this._map.off('moveend', this._fetchGrid, this);
        if (this._abortController) this._abortController.abort();
        
        if (this._map.hasLayer(this._heatLayer)) {
            this._map.removeLayer(this._heatLayer);
        }
    },

    _fetchGrid: async function() {
        if (!this.active) return;
        
        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        const signal = this._abortController.signal;
        
        try {
            const bounds = this._map.getBounds();
            const n = Math.min(85, bounds.getNorth() + 2);
            const s = Math.max(-85, bounds.getSouth() - 2);
            const w = bounds.getWest() - 2;
            const e = bounds.getEast() + 2;

            const gridWidth = 10;
            const gridHeight = 10;
            
            const dy = (n - s) / (gridHeight - 1);
            const dx = (e - w) / (gridWidth - 1);
            
            const points = [];
            for (let y = 0; y < gridHeight; y++) {
                const lat = n - (y * dy);
                for (let x = 0; x < gridWidth; x++) {
                    let lon = w + (x * dx);
                    while (lon > 180) lon -= 360;
                    while (lon < -180) lon += 360;
                    points.push({ lat, lon });
                }
            }
            
            const lats = points.map(p => p.lat.toFixed(2)).join(',');
            const lons = points.map(p => p.lon.toFixed(2)).join(',');
            
            const url = `https://api.open-meteo.com/v1/gfs?latitude=${lats}&longitude=${lons}&hourly=temperature_${this.pressure}hPa&timezone=UTC&forecast_days=1`;
            
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error("Open-Meteo Limit");
            
            const chunkResults = await res.json();
            if (!this.active) return;
            
            const allResults = Array.isArray(chunkResults) ? chunkResults : [chunkResults];
            const currentHour = new Date().getUTCHours();
            
            const heatData = [];
            
            for (let i = 0; i < allResults.length; i++) {
                const point = allResults[i];
                const coords = points[i];
                let temp = null;
                if (point?.hourly && point.hourly[`temperature_${this.pressure}hPa`]) {
                    temp = point.hourly[`temperature_${this.pressure}hPa`][currentHour];
                }
                
                if (temp != null) {
                    let normalized = (temp - (-80)) / (40 - (-80));
                    normalized = Math.max(0.01, Math.min(1.0, normalized));
                    heatData.push([coords.lat, coords.lon, normalized]);
                }
            }
            
            this._heatLayer.setLatLngs(heatData);
            
        } catch(err) {
            if (err.name === 'AbortError') return;
            console.error('Upper Temp Fetch Error:', err);
        }
    }
});
