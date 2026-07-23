(function () {
    const REFRESH_INTERVAL_MS = 30000;
    let allAircraft = [];
    let isRefreshing = false;
    let airportTrafficRequest = 0;

    function applyFilters() {
        const filters = window.UI.getFilters();
        const filtered = allAircraft.filter(aircraft => {
            if (filters.callsignOnly && !aircraft.callsign) return false;
            if (Number.isFinite(aircraft.altitude) && aircraft.altitude > filters.maxAltitude) return false;
            return true;
        }).sort((first, second) => {
            if (filters.highlightEmergency && first.emergency !== second.emergency) return first.emergency ? -1 : 1;
            return (second.altitude ?? -1) - (first.altitude ?? -1);
        });

        window.MapManager.updateAircraftMarkers(filtered);
        window.UI.renderAirspace(filtered, allAircraft.length);
        const selectedAirport = window.UI.getSelectedAirport();
        if (selectedAirport) window.UI.renderAirportTraffic(filtered, selectedAirport);
    }

    async function refreshAirspace({ quiet = false } = {}) {
        if (isRefreshing) return;
        isRefreshing = true;
        const search = window.MapManager.getViewportSearch();
        try {
            allAircraft = await window.API.fetchAircraftNear(search.lat, search.lon, search.radiusNm);
            applyFilters();
            if (!quiet) window.UI.showToast(`${allAircraft.length} canlı ADS-B yayını yenilendi.`);
        } catch (error) {
            if (!quiet || allAircraft.length === 0) window.UI.showToast(`Canlı hava sahası alınamadı: ${error.message}`, 'error');
        } finally {
            isRefreshing = false;
        }
    }

    async function refreshAirportTraffic(airport) {
        const requestId = ++airportTrafficRequest;
        window.UI.setAirportTrafficLoading();
        try {
            const aircraft = await window.API.fetchAircraftNear(airport.lat, airport.lon, 60);
            if (requestId !== airportTrafficRequest) return;
            window.UI.renderAirportTraffic(aircraft, airport);
        } catch (error) {
            if (requestId !== airportTrafficRequest) return;
            window.UI.setAirportTrafficError(`Kaynak yanıt vermedi: ${error.message}`);
            window.UI.showToast(`Havalimanı çevresindeki uçak verisi alınamadı: ${error.message}`, 'error');
        }
    }

    window.App = { refreshAirspace, refreshAirportTraffic, applyFilters };
    window.UI.initialize();
    refreshAirspace({ quiet: true });
    window.setInterval(() => refreshAirspace({ quiet: true }), REFRESH_INTERVAL_MS);
}());
