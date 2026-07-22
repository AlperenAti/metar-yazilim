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

    const airportLayer = L.layerGroup().addTo(map);
    const aircraftLayer = L.layerGroup().addTo(map);
    const firLayer = L.layerGroup().addTo(map);
    const airports = [
        { icao: 'LTFM', name: 'İstanbul Havalimanı', lat: 41.259, lon: 28.742, runwayHeading: 350 },
        { icao: 'LTFJ', name: 'Sabiha Gökçen Havalimanı', lat: 40.898, lon: 29.309, runwayHeading: 60 },
        { icao: 'LTAC', name: 'Ankara Esenboğa Havalimanı', lat: 40.128, lon: 32.995, runwayHeading: 30 },
        { icao: 'LTAI', name: 'Antalya Havalimanı', lat: 36.898, lon: 30.800, runwayHeading: 180 },
        { icao: 'LTBJ', name: 'İzmir Adnan Menderes Havalimanı', lat: 38.292, lon: 27.156, runwayHeading: 160 },
        { icao: 'LTAF', name: 'Adana Şakirpaşa Havalimanı', lat: 36.982, lon: 35.280, runwayHeading: 50 },
        { icao: 'LTCG', name: 'Trabzon Havalimanı', lat: 40.995, lon: 39.789, runwayHeading: 110 },
        { icao: 'LTBS', name: 'Dalaman Havalimanı', lat: 36.713, lon: 28.792, runwayHeading: 10 },
        { icao: 'LTFE', name: 'Milas-Bodrum Havalimanı', lat: 37.250, lon: 27.664, runwayHeading: 100 },
        { icao: 'LTCB', name: 'Ordu-Giresun Havalimanı', lat: 40.966, lon: 38.077, runwayHeading: 100 },
        { icao: 'LTCE', name: 'Erzurum Havalimanı', lat: 39.956, lon: 41.170, runwayHeading: 80 },
        { icao: 'LTCF', name: 'Kars Harakani Havalimanı', lat: 40.562, lon: 43.115, runwayHeading: 60 },
        { icao: 'LTCC', name: 'Diyarbakır Havalimanı', lat: 37.893, lon: 41.116, runwayHeading: 160 },
        { icao: 'LTCJ', name: 'Batman Havalimanı', lat: 37.929, lon: 41.116, runwayHeading: 10 },
        { icao: 'LTCV', name: 'Şırnak Şerafettin Elçi Havalimanı', lat: 37.363, lon: 42.058, runwayHeading: 110 },
        { icao: 'LTCP', name: 'Adıyaman Havalimanı', lat: 37.731, lon: 38.468, runwayHeading: 10 },
        { icao: 'LTAL', name: 'Kastamonu Havalimanı', lat: 41.314, lon: 33.795, runwayHeading: 10 },
        { icao: 'LTBZ', name: 'Zafer Havalimanı', lat: 39.111, lon: 30.129, runwayHeading: 10 },
        { icao: 'LTBA', name: 'Atatürk Havalimanı', lat: 40.977, lon: 28.821, runwayHeading: 50 },
        { icao: 'LTBU', name: 'Çorlu Atatürk Havalimanı', lat: 41.138, lon: 27.919, runwayHeading: 50 },
        { icao: 'LTAU', name: 'Konya Havalimanı', lat: 37.980, lon: 32.562, runwayHeading: 10 },
        { icao: 'LTAS', name: 'Zonguldak Çaycuma Havalimanı', lat: 41.506, lon: 32.089, runwayHeading: 90 },
        { icao: 'LTAR', name: 'Sivas Nuri Demirağ Havalimanı', lat: 39.813, lon: 36.903, runwayHeading: 50 },
        { icao: 'LTAP', name: 'Amasya Merzifon Havalimanı', lat: 40.829, lon: 35.522, runwayHeading: 50 }
    ];

    function airportIcon(icao) {
        return L.divIcon({ className: '', html: `<div class="airport-marker"><span>${icao}</span></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    }

    airports.forEach(airport => {
        const marker = L.marker([airport.lat, airport.lon], { icon: airportIcon(airport.icao), keyboard: true, title: `${airport.icao} — ${airport.name}` }).addTo(airportLayer);
        marker.on('click', () => {
            window.UI.openAirport(airport, true);
        });
    });

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

    function firPoint(latitude, longitude) {
        return [dmsToDecimal(latitude), dmsToDecimal(longitude)];
    }

    // DHMİ AIP ENR 2.1 publishes these FIR boundary reference coordinates.
    // Border-following sections are deliberately not fabricated as straight lines.
    const firReferences = [
        {
            code: 'LTAA',
            label: 'ANKARA FIR',
            labelPoint: [40.05, 35.35],
            points: [
                firPoint('360456N', '0295958E'), firPoint('385956N', '0295958E'), firPoint('392956N', '0305958E'),
                firPoint('424756N', '0305958E'), firPoint('424756N', '0315958E'), firPoint('424656N', '0335958E'),
                firPoint('424356N', '0361559E'), firPoint('424056N', '0374259E'), firPoint('415356N', '0401959E'),
                firPoint('413556N', '0411659E'), firPoint('413056N', '0413259E')
            ]
        },
        {
            code: 'LTBB',
            label: 'İSTANBUL FIR',
            labelPoint: [40.55, 28.05],
            points: [
                firPoint('415900N', '0280200E'), firPoint('415900N', '0281900E'), firPoint('420700N', '0290000E'),
                firPoint('424755N', '0304513E'), firPoint('424756N', '0305958E'), firPoint('392956N', '0305958E'),
                firPoint('385956N', '0295958E'), firPoint('360456N', '0295958E')
            ]
        }
    ];

    firReferences.forEach(fir => {
        L.polyline(fir.points, { color: '#b7c1cc', weight: 1.25, opacity: .48, dashArray: '7 9', lineCap: 'butt', interactive: false }).addTo(firLayer);
        L.marker(fir.labelPoint, {
            interactive: false,
            icon: L.divIcon({ className: '', html: `<span class="fir-label">${fir.code} · ${fir.label}</span>`, iconSize: [118, 16], iconAnchor: [59, 8] })
        }).addTo(firLayer);
    });

    function aircraftIcon(aircraft) {
        const turn = Number.isFinite(aircraft.heading) ? aircraft.heading : 0;
        const status = aircraft.emergency ? ' emergency' : '';
        return L.divIcon({
            className: '',
            html: `<div class="aircraft-marker${status}"><span style="transform:rotate(${turn}deg)">▲</span></div>`,
            iconSize: [22, 22], iconAnchor: [11, 11]
        });
    }

    function updateAircraftMarkers(aircraft) {
        aircraftLayer.clearLayers();
        aircraft.forEach(plane => {
            const marker = L.marker([plane.lat, plane.lon], { icon: aircraftIcon(plane), keyboard: false, interactive: true, zIndexOffset: plane.emergency ? 1000 : 0 });
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
        setLayerVisibility({ aircrafts, airports: airportsVisible, firs }) {
            const layers = [
                [aircraftLayer, aircrafts],
                [airportLayer, airportsVisible],
                [firLayer, firs]
            ];
            layers.forEach(([layer, visible]) => {
                if (visible && !map.hasLayer(layer)) map.addLayer(layer);
                if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
            });
        }
    };
}());
