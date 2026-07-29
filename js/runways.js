(function () {
    class RunwayLayer {
        constructor() {
            this.layerGroup = L.layerGroup();
            this.active = false;
            this.minZoom = 13;
            
            // Map of drawn airports to avoid redrawing
            this.drawnAirports = new Set();
        }

        addTo(map) {
            this.map = map;
            this.layerGroup.addTo(map);
            this.active = true;
            
            this._update = () => this.update();
            this.map.on('moveend zoomend', this._update);
            
            this.update();
            return this;
        }

        remove() {
            if (this.map) {
                this.map.off('moveend zoomend', this._update);
                this.map.removeLayer(this.layerGroup);
                this.active = false;
            }
        }

        destinationPoint(lat, lon, distanceMeters, bearingDegrees) {
            const R = 6371000;
            const brng = bearingDegrees * Math.PI / 180;
            const lat1 = lat * Math.PI / 180;
            const lon1 = lon * Math.PI / 180;
        
            const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceMeters / R) +
                                   Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(brng));
            const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(lat1),
                                           Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2));
        
            return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
        }

        parseRunwayId(id) {
            // E.g. "34L" -> { num: 34, suffix: "L" }
            const match = id.match(/^0*(\d+)([LCR]?)$/);
            if (match) {
                return { num: parseInt(match[1]), suffix: match[2] };
            }
            return { num: 0, suffix: "" };
        }

        update() {
            if (!this.active || !this.map || !window.MapManager || !window.MapManager.airports) return;

            const zoom = this.map.getZoom();
            if (zoom < this.minZoom) {
                if (this.drawnAirports.size > 0) {
                    this.layerGroup.clearLayers();
                    this.drawnAirports.clear();
                }
                return;
            }

            const bounds = this.map.getBounds().pad(0.5); // Pad to draw runways slightly out of view
            const airports = window.MapManager.airports;
            
            const visibleAirports = new Set();

            airports.forEach(apt => {
                if (!apt.runways || apt.runways.length === 0) return;
                
                if (bounds.contains([apt.lat, apt.lon])) {
                    visibleAirports.add(apt.icao);
                    
                    if (!this.drawnAirports.has(apt.icao)) {
                        this.drawRunways(apt);
                        this.drawnAirports.add(apt.icao);
                    }
                }
            });

            // Cleanup airports that are far away
            if (this.drawnAirports.size > 50) {
                this.layerGroup.clearLayers();
                this.drawnAirports.clear();
                this.update(); // redraw just the visible ones
            }
        }

        getBearing(lat1, lon1, lat2, lon2) {
            return window.getBearing(lat1, lon1, lat2, lon2);
        }

        drawRunways(apt) {
            if (!window.MapManager.runwayCoords || !window.MapManager.runwayCoords[apt.icao]) return;
            
            const realRunways = window.MapManager.runwayCoords[apt.icao];
            
            realRunways.forEach(rwy => {
                if (rwy.id1 && rwy.lat1 && rwy.lon1 && rwy.id2 && rwy.lat2 && rwy.lon2) {
                    const bearing1To2 = this.getBearing(rwy.lat1, rwy.lon1, rwy.lat2, rwy.lon2);
                    const bearing2To1 = (bearing1To2 + 180) % 360;
                    
                    const label1Icon = L.divIcon({
                        className: 'runway-label-container',
                        html: `<div class="runway-label" style="transform: rotate(${bearing1To2 - 180}deg);">${rwy.id1}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    });
                    L.marker([rwy.lat1, rwy.lon1], { icon: label1Icon, interactive: false }).addTo(this.layerGroup);

                    const label2Icon = L.divIcon({
                        className: 'runway-label-container',
                        html: `<div class="runway-label" style="transform: rotate(${bearing2To1 - 180}deg);">${rwy.id2}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    });
                    L.marker([rwy.lat2, rwy.lon2], { icon: label2Icon, interactive: false }).addTo(this.layerGroup);
                }
                else if (rwy.id1 && rwy.lat1 && rwy.lon1) {
                    const label1Icon = L.divIcon({
                        className: 'runway-label-container',
                        html: `<div class="runway-label">${rwy.id1}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    });
                    L.marker([rwy.lat1, rwy.lon1], { icon: label1Icon, interactive: false }).addTo(this.layerGroup);
                }
            });
        }
    }

    window.RunwayLayer = RunwayLayer;

    // Expose bearing calculation and a helper to get true heading
    window.getBearing = function(lat1, lon1, lat2, lon2) {
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        
        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
        const brng = Math.atan2(y, x);
        
        return (brng * 180 / Math.PI + 360) % 360;
    };

    window.getRunwayTrueHeading = function(icao, rwyId) {
        if (!window.MapManager || !window.MapManager.runwayCoords || !window.MapManager.runwayCoords[icao]) {
            const match = rwyId.match(/^0*(\d+)/);
            return match ? parseInt(match[1], 10) * 10 : 0;
        }
        
        const runways = window.MapManager.runwayCoords[icao];
        const normalizedTarget = rwyId.replace(/^0+/, '');
        for (const rwy of runways) {
            const norm1 = rwy.id1 ? rwy.id1.replace(/^0+/, '') : '';
            const norm2 = rwy.id2 ? rwy.id2.replace(/^0+/, '') : '';
            
            if (norm1 === normalizedTarget && rwy.lat1 && rwy.lon1 && rwy.lat2 && rwy.lon2) {
                return window.getBearing(rwy.lat1, rwy.lon1, rwy.lat2, rwy.lon2);
            }
            if (norm2 === normalizedTarget && rwy.lat1 && rwy.lon1 && rwy.lat2 && rwy.lon2) {
                return window.getBearing(rwy.lat2, rwy.lon2, rwy.lat1, rwy.lon1);
            }
        }
        
        const match = rwyId.match(/^0*(\d+)/);
        return match ? parseInt(match[1], 10) * 10 : 0;
    };
})();
