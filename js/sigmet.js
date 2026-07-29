// sigmet.js - Handles fetching and rendering of global SIGMETs from NOAA AWC

window.SigmetLayer = L.LayerGroup.extend({
    initialize: function() {
        L.LayerGroup.prototype.initialize.call(this);
        this.active = false;
        this.sigmetData = null;
        this.fetchInterval = null;
        
        this.hazardColors = {
            'TURB': '#e67e22',
            'ICE': '#3498db',
            'TS': '#e74c3c',
            'VA': '#9b59b6',
            'MTW': '#f1c40f',
            'CAT': '#f39c12',
            'TC': '#c0392b',
            'DEFAULT': '#95a5a6'
        };
    },
    
    onAdd: function(map) {
        L.LayerGroup.prototype.onAdd.call(this, map);
        this.active = true;
        this.startFetching();
        this.updateLayer();
    },
    
    onRemove: function(map) {
        this.active = false;
        this.stopFetching();
        this.clearLayers();
        L.LayerGroup.prototype.onRemove.call(this, map);
    },
    
    startFetching: function() {
        this.fetchData();
        // Refresh every 10 minutes (600000 ms)
        this.fetchInterval = setInterval(() => this.fetchData(), 600000);
    },
    
    stopFetching: function() {
        if (this.fetchInterval) {
            clearInterval(this.fetchInterval);
            this.fetchInterval = null;
        }
    },
    
    fetchData: async function() {
        if (!this.active) return;
        try {
            const res = await fetch('/api/weather/isigmet');
            if (!res.ok) throw new Error(`SIGMET fetch failed: ${res.status}`);
            
            const data = await res.json();
            this.sigmetData = data;
            
            this.updateLayer();
        } catch (err) {
            console.error('Error fetching SIGMETs:', err);
        }
    },
    
    updateLayer: function() {
        if (!this.active || !this.sigmetData) return;
        
        this.clearLayers();
        
        const now = new Date();
        
        L.geoJSON(this.sigmetData, {
            filter: (feature) => {
                if (!feature.properties || !feature.properties.validTimeTo) return false;
                const validTo = new Date(feature.properties.validTimeTo);
                return validTo > now;
            },
            style: (feature) => {
                const hazard = feature.properties.hazard || 'DEFAULT';
                const color = this.hazardColors[hazard] || this.hazardColors['DEFAULT'];
                return {
                    color: color,
                    weight: 2,
                    opacity: 0.8,
                    fillColor: color,
                    fillOpacity: 0.15,
                    dashArray: '5, 5'
                };
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                const hazard = props.hazard || 'UNKNOWN';
                const qual = props.qualifier ? ` ${props.qualifier}` : '';
                
                let tooltipContent = `${hazard}${qual}`;
                if (props.base || props.top) {
                    const baseStr = props.base ? `FL${Math.round(props.base/100)}` : 'SFC';
                    const topStr = props.top ? `FL${Math.round(props.top/100)}` : 'UNL';
                    tooltipContent += ` <br>${baseStr} - ${topStr}`;
                }
                
                layer.bindTooltip(tooltipContent, {
                    className: 'sigmet-tooltip',
                    direction: 'center',
                    sticky: true
                });
                
                const fir = props.firName || props.firId || 'Unknown FIR';
                const validFrom = props.validTimeFrom ? new Date(props.validTimeFrom).toUTCString().replace('GMT', 'Z') : '-';
                const validTo = props.validTimeTo ? new Date(props.validTimeTo).toUTCString().replace('GMT', 'Z') : '-';
                const rawText = props.rawSigmet || 'No raw text provided';
                
                const popupContent = `
                    <div style="margin-bottom: 8px;">
                        <strong style="font-size:14px; color:var(--text);">${fir}</strong><br>
                        <span style="font-size:11px; color:var(--muted);">Valid: ${validFrom} to ${validTo}</span>
                    </div>
                    <div class="sigmet-popup">${rawText}</div>
                `;
                
                layer.bindPopup(popupContent, { maxWidth: 400 });
                
                // Add a permanent label at the center of the polygon
                if (layer.getBounds) {
                    const center = layer.getBounds().getCenter();
                    const color = this.hazardColors[hazard] || this.hazardColors['DEFAULT'];
                    const labelIcon = L.divIcon({
                        className: 'sigmet-center-label',
                        html: `<span style="color: ${color}; font-weight: 800; font-size: 16px; text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8), 1px -1px 2px rgba(0,0,0,0.8), -1px 1px 2px rgba(0,0,0,0.8);">${hazard}</span>`,
                        iconSize: [40, 20],
                        iconAnchor: [20, 10]
                    });
                    L.marker(center, { icon: labelIcon, interactive: false }).addTo(this);
                }
            }
        }).addTo(this);
    }
});
