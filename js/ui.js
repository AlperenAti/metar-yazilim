(function () {
    const $ = id => document.getElementById(id);
    const dashboard = $('dashboard');
    const airportPanel = $('airport-panel');
    const tabs = [...document.querySelectorAll('.tab')];
    const tabPanels = [...document.querySelectorAll('.tab-panel')];
    const searchForm = $('search-form');
    const searchInput = $('search-input');
    const toast = $('toast');
    let selectedAirport = null;
    let metarText = '';
    let weatherRequestId = 0;
    let airportTrafficRequestId = 0;
    let toastTimer = null;

    function showToast(message, type = '') {
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.className = `toast show ${type}`.trim();
        toastTimer = window.setTimeout(() => { toast.className = 'toast'; }, 3900);
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('tr-TR').format(value);
    }

    function formatObservationTime(value) {
        if (!value) return 'Gözlem saati yayınlanmadı';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return `Gözlem: ${value}`;
        return `Gözlem: ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
    }

    function runwayPair(heading) {
        const first = Math.round(heading / 10) || 36;
        const second = Math.round(((heading + 180) % 360) / 10) || 36;
        return `${String(first).padStart(2, '0')}/${String(second).padStart(2, '0')}`;
    }

    function flightPhase(flight) {
        if (!Number.isFinite(flight.verticalRate)) return 'Dikey hız yok';
        if (flight.verticalRate > 250) return 'Tırmanıyor';
        if (flight.verticalRate < -250) return 'Alçalıyor';
        return 'Düz uçuş';
    }

    function clearElement(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function createFlightRow(flight, options = {}) {
        const row = document.createElement('div');
        row.className = 'flight-row';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${flight.callsign || flight.registration || 'Bilinmeyen uçak'} bilgisi`);

        const symbol = document.createElement('span');
        symbol.className = `flight-symbol${flight.emergency ? ' alert' : ''}`;
        symbol.textContent = flight.emergency ? '!' : '▲';

        const identity = document.createElement('div');
        identity.className = 'flight-id';
        identity.textContent = flight.callsign || flight.registration || flight.hex || 'Bilinmeyen';
        const secondary = document.createElement('small');
        secondary.textContent = options.distance ? `${options.distance.toFixed(1)} NM · ${flightPhase(flight)}` : (flight.type || flightPhase(flight));
        identity.appendChild(secondary);

        const data = document.createElement('div');
        data.className = 'flight-data';
        data.textContent = flight.altitude === null ? '— ft' : `${formatNumber(flight.altitude)} ft`;
        const speed = document.createElement('small');
        speed.textContent = `${flight.speed ?? '—'} kt${flight.emergency ? ' · 7700' : ''}`;
        data.appendChild(speed);

        row.append(symbol, identity, data);
        const activate = () => {
            document.querySelectorAll('.flight-row.selected').forEach(item => item.classList.remove('selected'));
            row.classList.add('selected');
            showFlight(flight);
        };
        row.addEventListener('click', activate);
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
        });
        return row;
    }

    function renderFlightList(element, flights, options = {}) {
        clearElement(element);
        if (!flights.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = options.emptyText || 'Bu alanda görünür ADS-B yayını yok.';
            element.appendChild(empty);
            return;
        }
        flights.slice(0, options.limit || 12).forEach(flight => element.appendChild(createFlightRow(flight, options.getOptions?.(flight) || {})));
    }

    function setTab(tabName) {
        tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
    }

    function resetWeather() {
        $('weather-status').className = 'data-status loading';
        $('weather-status').replaceChildren(document.createElement('i'), document.createTextNode(' METAR getiriliyor…'));
        $('ws-fltcat').textContent = '—';
        $('ws-fltcat').className = 'flight-category unknown';
        $('ws-summary').textContent = 'Resmî hava raporu bekleniyor';
        $('ws-temp').textContent = '—';
        $('metar-wind').textContent = '—';
        $('metar-vis').textContent = '—';
        $('metar-qnh').textContent = '—';
        $('metar-dewp').textContent = '—';
        $('metar-raw').textContent = 'Veri bekleniyor…';
        $('metar-issued').textContent = '—';
        $('taf-raw').textContent = 'Veri bekleniyor…';
        metarText = '';
        window.Visualizer.clear();
    }

    function updateWeather(weather) {
        const { metar, taf, tafUnavailable } = weather;
        const status = $('weather-status');
        status.className = 'data-status';
        status.replaceChildren(document.createElement('i'), document.createTextNode(metar ? ' Aviation Weather Center kaynağından güncel METAR' : ' Bu meydan için güncel METAR yok'));

        if (!metar) {
            $('metar-raw').textContent = 'Bu ICAO için Aviation Weather Center güncel METAR döndürmedi.';
            $('taf-raw').textContent = tafUnavailable ? 'TAF kaynağına ulaşılamadı.' : 'Yayınlanmış TAF yok.';
            return;
        }

        metarText = metar.raw;
        $('ws-fltcat').textContent = metar.category;
        $('ws-fltcat').className = `flight-category ${metar.category.toLowerCase()}`;
        $('ws-summary').textContent = metar.weather;
        $('ws-temp').textContent = metar.temperature ?? '—';
        $('metar-wind').textContent = metar.wind;
        $('metar-vis').textContent = metar.visibility;
        $('metar-qnh').textContent = metar.altimeter === null ? '—' : `${metar.altimeter} hPa`;
        $('metar-dewp').textContent = metar.dewpoint === null ? '—' : `${metar.dewpoint} °C`;
        $('metar-raw').textContent = metar.raw || 'Ham METAR metni yayınlanmadı.';
        $('metar-issued').textContent = formatObservationTime(metar.issued);
        $('taf-raw').textContent = taf || (tafUnavailable ? 'TAF kaynağına ulaşılamadı.' : 'Bu meydan için yayınlanmış TAF yok.');
        window.Visualizer.drawRunwayAndWind(selectedAirport.runwayHeading, metar.windDirection, metar.windSpeed);
    }

    async function refreshAirportWeather() {
        if (!selectedAirport) return;
        const requestId = ++weatherRequestId;
        resetWeather();
        try {
            const weather = await window.API.fetchAirportWeather(selectedAirport.icao);
            if (requestId !== weatherRequestId) return;
            updateWeather(weather);
        } catch (error) {
            if (requestId !== weatherRequestId) return;
            const status = $('weather-status');
            status.className = 'data-status';
            status.replaceChildren(document.createElement('i'), document.createTextNode(` METAR alınamadı: ${error.message}`));
            $('metar-raw').textContent = 'Bağlantı düzeldiğinde “Veriyi yenile” düğmesini kullanın.';
            $('taf-raw').textContent = 'METAR isteği başarısız olduğu için TAF gösterilemedi.';
        }
    }

    function openAirport(airport, focusMap = false) {
        selectedAirport = airport;
        $('apt-icao').textContent = airport.icao;
        $('apt-name').textContent = airport.name;
        $('runway-label').textContent = `Referans RWY ${runwayPair(airport.runwayHeading)}`;
        $('airport-region').textContent = 'TÜRKİYE · GERÇEK VERİ';
        setTab('weather');
        airportPanel.classList.add('open');
        airportPanel.setAttribute('aria-hidden', 'false');
        
        // Auto-collapse dashboard on mobile for better visibility
        if (window.innerWidth <= 720) {
            dashboard.classList.add('collapsed');
        }

        if (focusMap) window.MapManager.focusAirport(airport);
        const url = new URL(window.location.href);
        url.searchParams.set('icao', airport.icao);
        window.history.replaceState({}, '', url);
        refreshAirportWeather();
        window.App?.refreshAirportTraffic(airport);
    }

    function closeAirport() {
        airportPanel.classList.remove('open');
        airportPanel.setAttribute('aria-hidden', 'true');
        const url = new URL(window.location.href);
        url.searchParams.delete('icao');
        window.history.replaceState({}, '', url);
    }

    function renderAirspace(flights, totalBeforeFiltering, totalEmergency) {
        $('aircraft-count').textContent = formatNumber(flights.length);
        $('aircraft-subtitle').textContent = totalBeforeFiltering === flights.length ? 'ADS-B yayını' : `${formatNumber(totalBeforeFiltering)} yayından süzüldü`;
        $('emergency-count').textContent = formatNumber(totalEmergency);
        $('airport-count').textContent = formatNumber(window.MapManager.airports.length);
        $('last-updated').textContent = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
        renderFlightList($('live-flight-list'), flights, { limit: 10, emptyText: 'Seçili filtrelerde görünür ADS-B yayını yok.' });
    }

    function renderAirportTraffic(flights, airport = selectedAirport) {
        if (!airport || airport !== selectedAirport) return;
        const nearby = flights.map(flight => ({ flight, distance: window.MapManager.distanceNm(airport, flight) }))
            .filter(item => item.distance <= 60)
            .sort((first, second) => first.distance - second.distance);
        $('airport-traffic-status').textContent = `60 NM içindeki ${nearby.length} canlı ADS-B yayını`;
        renderFlightList($('airport-flight-list'), nearby.map(item => item.flight), {
            limit: 30,
            emptyText: '60 NM içindeki görünür ADS-B yayını yok. Bu, havaalanında trafik olmadığı anlamına gelmeyebilir.',
            getOptions: flight => ({ distance: nearby.find(item => item.flight.hex === flight.hex)?.distance })
        });
    }

    function setAirportTrafficLoading() {
        $('airport-traffic-status').textContent = 'Havalimanı çevresindeki yayınlar getiriliyor…';
    }

    function setAirportTrafficError(message) {
        $('airport-traffic-status').textContent = 'Canlı ADS-B verisi alınamadı';
        clearElement($('airport-flight-list'));
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = message;
        $('airport-flight-list').appendChild(empty);
    }

    function getFilters() {
        return {
            maxAltitude: Number($('altitude-filter').value),
            callsignOnly: $('callsign-filter').checked,
            highlightEmergency: $('emergency-filter').checked
        };
    }

    function updateAltitudeLabel() {
        const value = Number($('altitude-filter').value);
        $('filter-altitude-label').textContent = value >= 45000 ? 'Tümü' : `${formatNumber(value)} ft altı`;
    }

    function showFlight(flight) {
        window.MapManager.focusFlight(flight);
        const description = `${flight.callsign || flight.registration || flight.hex || 'Bilinmeyen'} · ${flight.altitude ?? '—'} ft · ${flight.speed ?? '—'} kt${flight.emergency ? ' · ACİL DURUM 7700' : ''}`;
        showToast(description, flight.emergency ? 'error' : '');
    }

    function applyLayerVisibility() {
        const settings = {
            aircrafts: $('layer-aircraft').checked,
            airports: $('layer-airports').checked,
            firs: $('layer-firs').checked
        };
        window.MapManager.setLayerVisibility(settings);
        window.localStorage.setItem('metar-layers', JSON.stringify(settings));
    }

    async function copyText(value, success) {
        if (!value) { showToast('Kopyalanacak veri yok.', 'error'); return; }
        try {
            await navigator.clipboard.writeText(value);
            showToast(success);
        } catch {
            showToast('Tarayıcı bu ortamda panoya erişim vermedi.', 'error');
        }
    }

    function populateAirportOptions() {
        const optionList = $('airport-options');
        window.MapManager.airports.forEach(airport => {
            const option = document.createElement('option');
            option.value = airport.icao;
            option.label = airport.name;
            optionList.appendChild(option);
        });
    }

    function initialize() {
        populateAirportOptions();
        const savedTheme = window.localStorage.getItem('metar-theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            window.MapManager.setTheme('light');
        }
        try {
            const savedLayers = JSON.parse(window.localStorage.getItem('metar-layers'));
            if (savedLayers) {
                $('layer-aircraft').checked = savedLayers.aircrafts !== false;
                $('layer-airports').checked = savedLayers.airports !== false;
                $('layer-firs').checked = savedLayers.firs !== false;
            }
        } catch { /* Invalid local preference: use visible layers. */ }
        applyLayerVisibility();
        $('theme-btn').addEventListener('click', () => {
            const light = document.body.classList.toggle('light-mode');
            window.MapManager.setTheme(light ? 'light' : 'dark');
            window.localStorage.setItem('metar-theme', light ? 'light' : 'dark');
            $('theme-btn').setAttribute('aria-label', light ? 'Koyu temaya geç' : 'Açık temaya geç');
        });
        $('dashboard-toggle').addEventListener('click', () => dashboard.classList.toggle('collapsed'));
        $('close-airport-btn').addEventListener('click', closeAirport);
        $('clear-selection-btn').addEventListener('click', closeAirport);
        $('focus-airport-btn').addEventListener('click', () => selectedAirport && window.MapManager.focusAirport(selectedAirport, 14));
        $('refresh-airport-btn').addEventListener('click', () => { refreshAirportWeather(); if (selectedAirport) window.App?.refreshAirportTraffic(selectedAirport); });
        $('copy-link-btn').addEventListener('click', () => copyText(window.location.href, 'Havalimanı bağlantısı kopyalandı.'));
        $('copy-metar').addEventListener('click', () => copyText(metarText, 'METAR panoya kopyalandı.'));
        $('refresh-map-btn').addEventListener('click', () => window.App?.refreshAirspace());
        tabs.forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
        searchForm.addEventListener('submit', event => {
            event.preventDefault();
            const airport = window.MapManager.findAirport(searchInput.value);
            if (!airport) {
                showToast('Bu sürümde haritada kayıtlı bir meydan bulunamadı. ICAO listeden seçilebilir.', 'error');
                return;
            }
            openAirport(airport, true);
            searchInput.value = '';
            searchInput.blur();
        });
        ['altitude-filter', 'callsign-filter', 'emergency-filter'].forEach(id => $(id).addEventListener('input', () => {
            updateAltitudeLabel();
            window.App?.applyFilters();
        }));
        ['layer-aircraft', 'layer-airports', 'layer-firs'].forEach(id => $(id).addEventListener('change', applyLayerVisibility));
        updateAltitudeLabel();
        const icao = new URLSearchParams(window.location.search).get('icao');
        if (icao) {
            const airport = window.MapManager.findAirport(icao);
            if (airport) window.setTimeout(() => openAirport(airport, true), 150);
        }
    }

    window.UI = {
        initialize,
        openAirport,
        closeAirport,
        refreshAirportWeather,
        renderAirspace,
        renderAirportTraffic,
        setAirportTrafficLoading,
        setAirportTrafficError,
        getFilters,
        showToast,
        showFlight,
        getSelectedAirport: () => selectedAirport
    };
}());
