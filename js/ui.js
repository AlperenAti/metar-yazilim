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
        if (!value) return 'Observation time not published';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return `Observed: ${value}`;
        return `Observed: ${new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
    }

    function runwayPair(heading) {
        const first = Math.round(heading / 10) || 36;
        const second = Math.round(((heading + 180) % 360) / 10) || 36;
        return `${String(first).padStart(2, '0')}/${String(second).padStart(2, '0')}`;
    }

    function flightPhase(flight) {
        if (!Number.isFinite(flight.verticalRate)) return 'No vertical rate';
        if (flight.verticalRate > 250) return 'Climbing';
        if (flight.verticalRate < -250) return 'Descending';
        return 'Level flight';
    }

    function clearElement(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function createFlightRow(flight, options = {}) {
        const row = document.createElement('div');
        row.className = 'flight-row';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${flight.callsign || flight.registration || 'Unknown aircraft'} info`);

        const symbol = document.createElement('span');
        symbol.className = `flight-symbol`;
        symbol.textContent = '▲';

        const identity = document.createElement('div');
        identity.className = 'flight-id';
        identity.textContent = flight.callsign || flight.registration || flight.hex || 'Unknown';
        const secondary = document.createElement('small');
        secondary.textContent = options.distance ? `${options.distance.toFixed(1)} NM · ${flightPhase(flight)}` : (flight.type || flightPhase(flight));
        identity.appendChild(secondary);

        const data = document.createElement('div');
        data.className = 'flight-data';
        data.textContent = flight.altitude === null ? '— ft' : `${formatNumber(flight.altitude)} ft`;
        const speed = document.createElement('small');
        speed.textContent = `${flight.speed ?? '—'} kt`;
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
            empty.textContent = options.emptyText || 'No visible ADS-B stream in this area.';
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
        $('weather-status').replaceChildren(document.createElement('i'), document.createTextNode(' Fetching METAR…'));
        $('ws-fltcat').textContent = '—';
        $('ws-fltcat').className = 'flight-category unknown';
        $('ws-summary').textContent = 'Awaiting official weather report';
        $('ws-temp').textContent = '—';
        $('metar-wind').textContent = '—';
        $('metar-vis').textContent = '—';
        $('metar-qnh').textContent = '—';
        $('metar-dewp').textContent = '—';
        $('metar-raw').textContent = 'Waiting for data…';
        $('metar-issued').textContent = '—';
        $('taf-raw').textContent = 'Waiting for data…';
        clearElement($('taf-parsed'));
        metarText = '';
        window.Visualizer.clear();
    }

    function updateWeather(weather) {
        const { metar, taf, tafUnavailable } = weather;
        const status = $('weather-status');
        status.className = 'data-status';
        status.replaceChildren(document.createElement('i'), document.createTextNode(metar ? ' Current METAR from Aviation Weather Center' : ' No current METAR for this airport'));

        if (!metar) {
            $('metar-raw').textContent = 'Aviation Weather Center did not return a current METAR for this ICAO.';
            $('taf-raw').textContent = tafUnavailable ? 'TAF source unreachable.' : 'No published TAF.';
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
        $('metar-raw').textContent = metar.raw || 'Raw METAR text not published.';
        $('metar-issued').textContent = formatObservationTime(metar.issued);
        $('taf-raw').textContent = taf || (tafUnavailable ? 'TAF source unreachable.' : 'No published TAF for this airport.');
        
        renderTafParsed(taf, tafUnavailable);
        
        window.Visualizer.drawRunwayAndWind(selectedAirport.runwayHeading, metar.windDirection, metar.windSpeed);
        
        if (window.AtisGenerator) {
            const atisObj = window.AtisGenerator.generateAtis(selectedAirport, metar);
            if (atisObj) {
                $('atis-text').innerHTML = `<strong>${atisObj.phoneticLetter}</strong><br><br>${atisObj.text}`;
                $('play-atis-btn').onclick = () => {
                    const btn = $('play-atis-btn');
                    if (btn.classList.contains('playing')) {
                        window.AtisGenerator.stopAudio();
                        btn.classList.remove('playing');
                        btn.innerHTML = '<span class="icon">▶</span> Play Audio';
                    } else {
                        btn.classList.add('playing');
                        btn.innerHTML = '<span class="icon">⏹</span> Stop Audio';
                        window.AtisGenerator.playAudio(atisObj.text, () => {
                            btn.classList.remove('playing');
                            btn.innerHTML = '<span class="icon">▶</span> Play Audio';
                        });
                    }
                };
            } else {
                $('atis-text').innerHTML = '<p class="empty-state">ATIS could not be generated from current METAR.</p>';
            }
        }
    }

    function renderTafParsed(tafText, tafUnavailable) {
        const container = $('taf-parsed');
        clearElement(container);
        if (!tafText || tafUnavailable) return;

        const flatTaf = tafText.replace(/\s+/g, ' ');
        const regex = /\b(FM\d{6}|BECMG|TEMPO|PROB30\s+TEMPO|PROB40\s+TEMPO|PROB30|PROB40)\b/;
        const parts = flatTaf.split(regex);

        // Keep only the initial part in the raw view to make it cleaner, if there are entries.
        // Otherwise, it just shows the full TAF.
        if (parts.length > 1) {
            $('taf-raw').textContent = parts[0].trim();
        } else {
            $('taf-raw').textContent = tafText;
        }

        let entryCount = 1;
        for (let i = 1; i < parts.length; i += 2) {
            const keyword = parts[i].trim();
            const content = parts[i + 1] ? parts[i + 1].trim() : '';
            
            const entryDiv = document.createElement('div');
            entryDiv.className = 'taf-entry';
            
            const header = document.createElement('div');
            header.className = 'taf-entry-header';
            
            let prettyKeyword = keyword;
            if (keyword.startsWith('FM')) {
                const day = keyword.substring(2, 4);
                const hour = keyword.substring(4, 6);
                const min = keyword.substring(6, 8);
                prettyKeyword = `FM (From Day ${day}, ${hour}:${min}Z)`;
            } else if (keyword === 'BECMG') {
                prettyKeyword = 'BECMG (Expected Change)';
            } else if (keyword === 'TEMPO') {
                prettyKeyword = 'TEMPO (Temporary Change)';
            } else if (keyword.includes('PROB')) {
                prettyKeyword = keyword + ' (Probability)';
            }
            
            header.textContent = `Entry #${entryCount} · ${prettyKeyword}`;
            
            const body = document.createElement('div');
            body.className = 'taf-entry-body';
            body.textContent = `${keyword} ${content}`.trim();
            
            entryDiv.appendChild(header);
            entryDiv.appendChild(body);
            container.appendChild(entryDiv);
            
            entryCount++;
        }
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
            status.replaceChildren(document.createElement('i'), document.createTextNode(` Failed to fetch METAR: ${error.message}`));
            $('metar-raw').textContent = 'Use "Refresh data" button when connection is restored.';
            $('taf-raw').textContent = 'TAF could not be displayed due to METAR request failure.';
        }
    }

    function formatCoordinates(lat, lon) {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        const latAbs = Math.abs(lat);
        const lonAbs = Math.abs(lon);
        
        const latDeg = Math.floor(latAbs);
        const latMin = ((latAbs - latDeg) * 60).toFixed(2);
        
        const lonDeg = Math.floor(lonAbs);
        const lonMin = ((lonAbs - lonDeg) * 60).toFixed(2);
        
        return `${latDir}${latDeg}°${latMin}' / ${lonDir}${lonDeg}°${lonMin}'`;
    }

    function renderAirportInfo(airport) {
        $('apt-coords').textContent = formatCoordinates(airport.lat, airport.lon);
        
        const elevFt = airport.elevation || 0;
        const elevM = Math.round(elevFt * 0.3048);
        $('apt-elev').textContent = `${elevFt} ft / ${elevM} m`;
        
        const rwyContainer = $('apt-runways');
        if (airport.runways && airport.runways.length > 0) {
            rwyContainer.innerHTML = airport.runways.map(r => {
                const ident = `${r[0] || '?'}/${r[1] || '?'}`;
                const lenFt = r[2] || 0;
                const widFt = r[3] || 0;
                let dims = 'Dimensions unknown';
                if (lenFt > 0) {
                    const lenM = Math.round(lenFt * 0.3048);
                    const widM = widFt > 0 ? Math.round(widFt * 0.3048) : '?';
                    dims = `${lenM} x ${widM} m (${lenFt} ft)`;
                }
                return `<div class="runway-item">
                    <span class="runway-ident">${ident}</span>
                    <span class="runway-dim">${dims}</span>
                </div>`;
            }).join('');
        } else {
            rwyContainer.innerHTML = '<p class="empty-state">No runway data available.</p>';
        }
        
        const freqContainer = $('apt-freqs');
        if (airport.frequencies && airport.frequencies.length > 0) {
            freqContainer.innerHTML = airport.frequencies.map(f => {
                return `<div class="freq-badge"><span class="freq-type">${f[0]}</span><span class="freq-val">${f[1]}</span></div>`;
            }).join('');
        } else {
            freqContainer.innerHTML = '<p class="empty-state">No frequency data available.</p>';
        }
    }

    function openAirport(airport, focusMap = false) {
        selectedAirport = airport;
        $('apt-icao').textContent = airport.icao;
        $('apt-name').textContent = airport.name;
        $('runway-label').textContent = `Reference RWY ${runwayPair(airport.runwayHeading)}`;
        
        let regionName = 'UNKNOWN';
        if (airport.country) {
            try {
                regionName = new Intl.DisplayNames(['en'], { type: 'region' }).of(airport.country).toUpperCase();
            } catch (e) {
                regionName = airport.country;
            }
        }
        $('airport-region').textContent = `${regionName} · REAL DATA`;
        
        renderAirportInfo(airport);
        
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
        window.NotamManager?.loadForAirport(airport.icao);
    }

    function closeAirport() {
        if (window.AtisGenerator) window.AtisGenerator.stopAudio();
        const btn = $('play-atis-btn');
        if (btn) {
            btn.classList.remove('playing');
            btn.innerHTML = '<span class="icon">▶</span> Play Audio';
        }
        
        airportPanel.classList.remove('open');
        airportPanel.setAttribute('aria-hidden', 'true');
        const url = new URL(window.location.href);
        url.searchParams.delete('icao');
        window.history.replaceState({}, '', url);
    }

    function renderAirspace(flights, totalBeforeFiltering) {
        $('aircraft-count').textContent = formatNumber(flights.length);
        $('aircraft-subtitle').textContent = `of ${formatNumber(totalBeforeFiltering)} live`;
        $('airport-count').textContent = formatNumber(window.MapManager.airports.length);
        $('last-updated').textContent = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
        renderFlightList($('live-flight-list'), flights, { limit: 10, emptyText: 'No visible ADS-B stream with selected filters.' });
    }

    function renderAirportTraffic(flights, airport = selectedAirport) {
        if (!airport || airport !== selectedAirport) return;
        const nearby = flights.map(flight => ({ flight, distance: window.MapManager.distanceNm(airport, flight) }))
            .filter(item => item.distance <= 60)
            .sort((first, second) => first.distance - second.distance);
        $('airport-traffic-status').textContent = `${nearby.length} live ADS-B streams within 60 NM`;
        renderFlightList($('airport-flight-list'), nearby.map(item => item.flight), {
            limit: 30,
            emptyText: 'No visible ADS-B streams within 60 NM. This may not mean there is no traffic at the airport.',
            getOptions: flight => ({ distance: nearby.find(item => item.flight.hex === flight.hex)?.distance })
        });
    }

    function setAirportTrafficLoading() {
        $('airport-traffic-status').textContent = 'Fetching streams around airport…';
    }

    function setAirportTrafficError(message) {
        $('airport-traffic-status').textContent = 'Failed to fetch live ADS-B data';
        clearElement($('airport-flight-list'));
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = message;
        $('airport-flight-list').appendChild(empty);
    }

    function getFilters() {
        return {
            maxAltitude: Number($('altitude-filter').value),
            callsignOnly: $('callsign-filter').checked
        };
    }

    function updateAltitudeLabel() {
        const value = Number($('altitude-filter').value);
        $('filter-altitude-label').textContent = value >= 45000 ? 'All' : `Under ${formatNumber(value)} ft`;
    }

    function showFlight(flight) {
        window.MapManager.focusFlight(flight);
        const description = `${flight.callsign || flight.registration || flight.hex || 'Unknown'} · ${flight.altitude ?? '—'} ft · ${flight.speed ?? '—'} kt`;
        showToast(description);
    }

    function applyLayerVisibility() {
        const settings = {
            aircrafts: $('layer-aircraft').checked,
            airports: $('layer-airports').checked,
            sigmets: $('layer-sigmet').checked
        };
        window.MapManager.setLayerVisibility(settings);
        window.localStorage.setItem('metar-layers', JSON.stringify(settings));
    }

    async function copyText(value, success) {
        if (!value) { showToast('No data to copy.', 'error'); return; }
        try {
            await navigator.clipboard.writeText(value);
            showToast(success);
        } catch {
            showToast('Browser denied clipboard access in this environment.', 'error');
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
                $('layer-sigmet').checked = savedLayers.sigmets === true; // Default off to reduce clutter
            }
        } catch { /* Invalid local preference: use visible layers. */ }
        applyLayerVisibility();

        if (window.innerWidth <= 720) {
            dashboard.classList.add('collapsed');
        }
        $('theme-btn').addEventListener('click', () => {
            const light = document.body.classList.toggle('light-mode');
            window.MapManager.setTheme(light ? 'light' : 'dark');
            window.localStorage.setItem('metar-theme', light ? 'light' : 'dark');
            $('theme-btn').setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
        });
        $('dashboard-toggle').addEventListener('click', () => dashboard.classList.toggle('collapsed'));
        
        $('weather-menu-btn').addEventListener('click', () => {
            $('weather-menu-btn').classList.toggle('active');
            $('weather-menu-panel').classList.toggle('hidden');
        });
        $('close-weather-menu').addEventListener('click', () => {
            $('weather-menu-btn').classList.remove('active');
            $('weather-menu-panel').classList.add('hidden');
        });
        document.getElementsByName('weather_layer').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) window.MapManager.setWeatherOverlay(e.target.value);
            });
        });

        $('close-airport-btn').addEventListener('click', closeAirport);
        $('clear-selection-btn').addEventListener('click', closeAirport);
        $('focus-airport-btn').addEventListener('click', () => selectedAirport && window.MapManager.focusAirport(selectedAirport, 14));
        $('refresh-airport-btn').addEventListener('click', () => { refreshAirportWeather(); if (selectedAirport) window.App?.refreshAirportTraffic(selectedAirport); });
        $('copy-link-btn').addEventListener('click', () => copyText(window.location.href, 'Airport link copied.'));
        $('copy-metar').addEventListener('click', () => copyText(metarText, 'METAR copied to clipboard.'));
        $('refresh-map-btn').addEventListener('click', () => window.App?.refreshAirspace());
        tabs.forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
        searchForm.addEventListener('submit', event => {
            event.preventDefault();
            const airport = window.MapManager.findAirport(searchInput.value);
            if (!airport) {
                showToast('No airport found on the map in this version. ICAO can be selected from the list.', 'error');
                return;
            }
            openAirport(airport, true);
            searchInput.value = '';
            searchInput.blur();
        });
        ['altitude-filter', 'callsign-filter'].forEach(id => $(id).addEventListener('input', () => {
            updateAltitudeLabel();
            window.App?.applyFilters();
        }));
        ['layer-aircraft', 'layer-airports', 'layer-sigmet'].forEach(id => $(id).addEventListener('change', applyLayerVisibility));
        updateAltitudeLabel();
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
        updateAirportCount: () => {
            if ($('airport-count')) $('airport-count').textContent = formatNumber(window.MapManager.airports.length);
        },
        getSelectedAirport: () => selectedAirport
    };
}());
