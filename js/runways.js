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

        drawRunways(apt) {
            apt.runways.forEach(rwy => {
                const id1 = rwy[0];
                const id2 = rwy[1];
                const lengthFt = rwy[2];
                const widthFt = rwy[3] || 150;
                
                const lengthM = lengthFt * 0.3048;
                
                const rwy1 = this.parseRunwayId(id1);
                
                let heading = rwy1.num * 10;
                if (heading === 0) return; 
                
                let offsetM = 0;
                if (rwy1.suffix === 'L') offsetM = -400;
                if (rwy1.suffix === 'R') offsetM = 400;
                
                let centerLat = apt.lat;
                let centerLon = apt.lon;
                
                if (offsetM !== 0) {
                    const offsetHeading = (heading + 90) % 360;
                    const offsetCenter = this.destinationPoint(centerLat, centerLon, offsetM, offsetHeading);
                    centerLat = offsetCenter[0];
                    centerLon = offsetCenter[1];
                }

                const startPoint = this.destinationPoint(centerLat, centerLon, lengthM / 2, (heading + 180) % 360);
                const endPoint = this.destinationPoint(centerLat, centerLon, lengthM / 2, heading);

                // Draw background runway surface (Dark grey)
                L.polyline([startPoint, endPoint], {
                    color: '#2a2b2d',
                    weight: 22,
                    opacity: 0.9,
                    lineCap: 'butt'
                }).addTo(this.layerGroup);

                // Draw centerline (Dashed white/grey)
                L.polyline([startPoint, endPoint], {
                    color: '#8b98a5',
                    weight: 2,
                    dashArray: '10, 15',
                    opacity: 0.8
                }).addTo(this.layerGroup);

                const label1Rot = heading - 180; 
                const label1Icon = L.divIcon({
                    className: 'runway-label-container',
                    html: `<div class="runway-label" style="transform: rotate(${label1Rot}deg);">${id1}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                });
                L.marker(startPoint, { icon: label1Icon, interactive: false }).addTo(this.layerGroup);

                if (id2) {
                    const label2Rot = heading % 360; 
                    const label2Icon = L.divIcon({
                        className: 'runway-label-container',
                        html: `<div class="runway-label" style="transform: rotate(${label2Rot}deg);">${id2}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    });
                    L.marker(endPoint, { icon: label2Icon, interactive: false }).addTo(this.layerGroup);
                }
            });
        }
    }

    window.RunwayLayer = RunwayLayer;
})();
