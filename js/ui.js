(function () {
    const $ = id => document.getElementById(id);
    const dashboard = $('dashboard');
    const airportPanel = $('airport-panel');
    const tabs = [...document.querySelectorAll('.tab')];
    const tabPanels = [...document.querySelectorAll('.tab-panel')];
    const searchForm = $('search-form');
    const searchInput = $('search-input');
    const toast = $('toast');
    
    // View Toggle
    const viewMapBtn = $('view-map-btn');
    const viewEarthBtn = $('view-earth-btn');
    const viewListBtn = $('view-list-btn');
    const mapContainer = $('map');
    const fullDashboardView = $('full-dashboard-view');
    const dashboardEmptyState = $('dashboard-empty-state');
    const dashboardContent = $('dashboard-content');
    const dashboardHeroSearchForm = $('dashboard-hero-search-form');
    const dashboardHeroSearchInput = $('dashboard-hero-search-input');
    
    let selectedAirport = null;
    let metarText = '';
    let lastWeatherObj = null;
    let weatherRequestId = 0;
    let airportTrafficRequestId = 0;
    let toastTimer = null;
    let dashboardChartInstances = {};

    window.AppPrefs = {
        tempUnit: window.localStorage.getItem('metar-temp-unit') || 'C',
        speedUnit: window.localStorage.getItem('metar-speed-unit') || 'KT',
        pressureUnit: window.localStorage.getItem('metar-pressure-unit') || 'hPa'
    };

    function convertTemp(celsius) {
        if (celsius === null || celsius === undefined || isNaN(celsius)) return '-';
        const unit = window.AppPrefs.tempUnit;
        if (unit === 'F') return Math.round(celsius * 9/5 + 32) + ' °F';
        if (unit === 'K') return Math.round(celsius + 273.15) + ' K';
        return celsius + ' °C';
    }

    function convertSpeed(knots) {
        if (knots === null || knots === undefined || isNaN(knots)) return '-';
        const unit = window.AppPrefs.speedUnit;
        if (unit === 'MPH') return Math.round(knots * 1.15078) + ' mph';
        if (unit === 'KMH') return Math.round(knots * 1.852) + ' km/h';
        if (unit === 'MS') return Math.round(knots * 0.514444) + ' m/s';
        return knots + ' kt';
    }

    function convertPressure(hpa) {
        if (hpa === null || hpa === undefined || isNaN(hpa)) return '-';
        const unit = window.AppPrefs.pressureUnit;
        if (unit === 'INHG') return (hpa * 0.02953).toFixed(2) + ' inHg';
        return hpa + ' hPa';
    }

    function renderChartError(message) {
        ['chart-temp', 'chart-wind', 'chart-qnh'].forEach(id => {
            const el = $(id);
            if (el && el.parentNode) {
                // Ensure we only show error if the canvas is still empty
                if (el.parentNode.querySelector('.chart-error')) return;
                const err = document.createElement('div');
                err.className = 'chart-error';
                err.style = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:#ff6d74; font-size:14px; font-weight:600; text-align:center; width:100%; padding:0 20px;';
                err.textContent = message;
                el.parentNode.appendChild(err);
                el.style.opacity = '0.1'; // dim the canvas
            }
        });
    }

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
        lastWeatherObj = weather;
        const { metar, taf, tafUnavailable } = weather;
        const status = $('weather-status');
        status.className = 'data-status';
        status.replaceChildren(document.createElement('i'), document.createTextNode(metar ? ' Current METAR from Aviation Weather Center' : ' No current METAR for this airport'));

        if (!metar) {
            $('metar-raw').textContent = 'Aviation Weather Center did not return a current METAR for this ICAO.';
            $('taf-raw').textContent = tafUnavailable ? 'TAF source unreachable.' : 'No published TAF.';
            if (viewListBtn && viewListBtn.classList.contains('active') && selectedAirport) {
                populateDashboard(selectedAirport, weather);
            }
            return;
        }

        metarText = metar.raw;
        $('ws-fltcat').textContent = metar.category;
        $('ws-fltcat').className = `flight-category ${metar.category.toLowerCase()}`;
        $('ws-summary').textContent = metar.weather;
        $('ws-temp').textContent = convertTemp(metar.temperature);
        $('metar-wind').textContent = metar.windSpeed !== null ? `${metar.windDirection}° at ${convertSpeed(metar.windSpeed)}` : metar.wind;
        $('metar-vis').textContent = metar.visibility;
        $('metar-qnh').textContent = convertPressure(metar.altimeter);
        $('metar-dewp').textContent = convertTemp(metar.dewpoint);
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
        
        if (viewListBtn && viewListBtn.classList.contains('active') && selectedAirport) {
            populateDashboard(selectedAirport, weather);
        }
    }

    function estimateTafCategory(content) {
        let category = 'VFR';
        
        // Match visibility like 0800, 4000, 9999
        const visMatch = content.match(/\b\d{4}\b/);
        if (visMatch) {
            const vis = parseInt(visMatch[0], 10);
            if (vis < 800) category = 'LIFR';
            else if (vis < 1500 && category !== 'LIFR') category = 'IFR';
            else if (vis < 5000 && category !== 'LIFR' && category !== 'IFR') category = 'MVFR';
        }
        
        // Match SM visibility (e.g. 1/2SM, 2SM)
        const smMatch = content.match(/\b(\d+)?\s?(1\/2|1\/4|3\/4)?SM\b/);
        if (smMatch) {
            const whole = parseInt(smMatch[1]) || 0;
            const fraction = smMatch[2] === '1/2' ? 0.5 : (smMatch[2] === '1/4' ? 0.25 : (smMatch[2] === '3/4' ? 0.75 : 0));
            const totalSm = whole + fraction;
            if (totalSm < 1) category = 'LIFR';
            else if (totalSm < 3 && category !== 'LIFR') category = 'IFR';
            else if (totalSm <= 5 && category !== 'LIFR' && category !== 'IFR') category = 'MVFR';
        }
        
        // Match ceilings like BKN005, OVC012, VV002
        const ceilMatch = content.match(/(?:BKN|OVC|VV)(\d{3})/g);
        if (ceilMatch) {
            for (const c of ceilMatch) {
                const alt = parseInt(c.substring(3), 10);
                if (alt < 5) category = 'LIFR';
                else if (alt < 10 && category !== 'LIFR') category = 'IFR';
                else if (alt <= 30 && category !== 'LIFR' && category !== 'IFR') category = 'MVFR';
            }
        }
        return category;
    }

    function renderTafParsed(tafText, tafUnavailable) {
        const container = $('taf-parsed');
        clearElement(container);
        if (!tafText || tafUnavailable) return;

        const flatTaf = tafText.replace(/\s+/g, ' ');
        const regex = /\b(FM\d{6}|BECMG|TEMPO|PROB30\s+TEMPO|PROB40\s+TEMPO|PROB30|PROB40)\b/;
        const parts = flatTaf.split(regex);

        $('taf-raw').textContent = tafText;

        const ganttContainer = document.createElement('div');
        ganttContainer.className = 'taf-gantt-container';

        // Initial period is before the first block
        let initialContent = parts[0].trim();
        if (initialContent) {
            // Strip the TAF header (e.g., TAF AMD LTFM 271040Z 2712/2818)
            initialContent = initialContent.replace(/^TAF(?:\s+AMD|\s+COR)?\s+[A-Z0-9]{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, '');
            const initialCat = estimateTafCategory(initialContent);
            ganttContainer.innerHTML += `
                <div class="taf-gantt-item category-${initialCat.toLowerCase()}">
                    <div class="taf-gantt-time">Initial Base</div>
                    <div class="taf-gantt-content">${initialContent}</div>
                </div>
            `;
        }

        for (let i = 1; i < parts.length; i += 2) {
            const keyword = parts[i].trim();
            const content = parts[i + 1] ? parts[i + 1].trim() : '';
            
            let prettyKeyword = keyword;
            if (keyword.startsWith('FM')) {
                const day = keyword.substring(2, 4);
                const hour = keyword.substring(4, 6);
                const min = keyword.substring(6, 8);
                prettyKeyword = `FM ${day}th ${hour}:${min}Z`;
            }

            const cat = estimateTafCategory(content);
            
            ganttContainer.innerHTML += `
                <div class="taf-gantt-item category-${cat.toLowerCase()}">
                    <div class="taf-gantt-time">${prettyKeyword}</div>
                    <div class="taf-gantt-content">${content}</div>
                </div>
            `;
        }
        container.appendChild(ganttContainer);
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
        
        if (viewListBtn && viewListBtn.classList.contains('active')) {
            airportPanel.classList.remove('open');
            airportPanel.setAttribute('aria-hidden', 'true');
            renderFullDashboard(airport);
        } else {
            airportPanel.classList.add('open');
            airportPanel.setAttribute('aria-hidden', 'false');
        }
        
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

    function setupAutocomplete(inputElement) {
        if (!inputElement) return;
        const formElement = inputElement.closest('form');
        if (!formElement) return;
        
        formElement.style.position = 'relative';
        const list = document.createElement('ul');
        list.className = 'autocomplete-list hidden';
        formElement.appendChild(list);
        
        let blurTimeout;

        inputElement.addEventListener('input', () => {
            const val = inputElement.value.trim();
            list.innerHTML = '';
            if (!val || val.length < 2) {
                list.classList.add('hidden');
                return;
            }

            function normalizeTr(text) {
                if (!text) return '';
                return text.replace(/İ/g, 'i').replace(/I/g, 'i')
                           .replace(/ı/g, 'i').replace(/i/g, 'i')
                           .replace(/Ö/g, 'o').replace(/ö/g, 'o')
                           .replace(/Ü/g, 'u').replace(/ü/g, 'u')
                           .replace(/Ş/g, 's').replace(/ş/g, 's')
                           .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
                           .replace(/Ç/g, 'c').replace(/ç/g, 'c')
                           .toLowerCase();
            }
            
            const normalizedVal = normalizeTr(val);
            let matches = [];

            if (window.Fuse) {
                if (!window._airportSearchFuse) {
                    window._airportSearchFuseList = window.MapManager.airports.map(a => ({
                        ...a,
                        searchStr: normalizeTr(a.icao + ' ' + (a.name || ''))
                    }));
                    window._airportSearchFuse = new window.Fuse(window._airportSearchFuseList, {
                        keys: ['searchStr'],
                        threshold: 0.3,
                        ignoreLocation: true
                    });
                }
                const results = window._airportSearchFuse.search(normalizedVal);
                matches = results.slice(0, 10).map(r => r.item);
            } else {
                matches = window.MapManager.airports.filter(a => {
                   const searchStr = normalizeTr(a.icao + ' ' + (a.name || ''));
                   return searchStr.includes(normalizedVal);
                }).slice(0, 10);
            }
            
            if (matches.length > 0) {
                matches.forEach(m => {
                    const li = document.createElement('li');
                    li.innerHTML = `<strong>${m.icao}</strong> - ${m.name}`;
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault(); 
                        inputElement.value = m.icao;
                        list.classList.add('hidden');
                        formElement.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    });
                    list.appendChild(li);
                });
                list.classList.remove('hidden');
            } else {
                list.classList.add('hidden');
            }
        });
        
        inputElement.addEventListener('focus', () => {
            if (inputElement.value.trim().length >= 2) {
                inputElement.dispatchEvent(new Event('input'));
            }
        });

        inputElement.addEventListener('blur', () => {
            blurTimeout = setTimeout(() => {
                list.classList.add('hidden');
            }, 150);
        });
    }

    function generateNaturalLanguageMetar(metar) {
        let text = [];
        if (metar.windDirection === 'VRB') {
            text.push(`The wind is variable at ${metar.windSpeed} kt.`);
        } else if (metar.windDirection !== null && metar.windSpeed !== null) {
            text.push(`The wind is from direction ${metar.windDirection}° with a speed of ${metar.windSpeed} kt.`);
        } else {
            text.push(`Wind information is not available.`);
        }
        
        if (metar.raw.includes('CAVOK')) {
            text.push(`The weather is CAVOK. That means there are no clouds below 5,000 ft or the MSA (minimum safe altitude), whichever is higher. This also means that no cumulonimbus or towering cumulus clouds have been observed and the visibility is 10 km or more. Furthermore, there can't be fog, precipitation nor other significant weather.`);
        } else {
            if (metar.visibility) {
                text.push(`The visibility is ${metar.visibility}.`);
            }
            if (metar.weather && metar.weather !== 'Clear') {
                text.push(`The current weather is ${metar.weather}.`);
            }
            if (metar.ceiling) {
                text.push(`There is a ceiling at ${metar.ceiling} ft.`);
            }
        }
        
        let temps = [];
        if (metar.temperature !== null) temps.push(`temperature is ${metar.temperature} °C`);
        if (metar.dewpoint !== null) temps.push(`dew point is ${metar.dewpoint} °C`);
        if (temps.length > 0) {
            let tempStr = temps.join(' and the ');
            text.push(`The ${tempStr}.`);
        }
        
        if (metar.altimeter !== null) {
            text.push(`The air pressure at sea level is ${metar.altimeter} hPa (QNH).`);
        }
        
        return text.join(' ');
    }

    function calculateCrosswind(headingStr, windDir, windSpeed) {
        if (windDir === 'VRB' || windDir === null || windSpeed === null) return { hw: 0, cw: 0 };
        const rwHeading = parseInt(headingStr, 10) * 10;
        if (isNaN(rwHeading)) return { hw: 0, cw: 0 };
        
        let angle = Math.abs(windDir - rwHeading);
        if (angle > 180) angle = 360 - angle;
        
        const rad = angle * Math.PI / 180;
        const hw = Math.round(Math.cos(rad) * windSpeed);
        const cw = Math.round(Math.sin(rad) * windSpeed);
        return { hw, cw, angle };
    }

    function populateRunwayTable(airport, metar) {
        const tbody = document.querySelector('#dash-rwy-table tbody');
        if (!tbody) return;
        
        clearElement(tbody);
        if (!airport.runways || airport.runways.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">No runway data available.</td></tr>';
            return;
        }
        
        airport.runways.forEach(r => {
            const r1 = r[0];
            const r2 = r[1];
            
            if (r1) {
                const wind1 = calculateCrosswind(r1, metar.windDirection, metar.windSpeed);
                const tr1 = document.createElement('tr');
                tr1.innerHTML = `
                    <td class="rwy-ident">${r1}</td>
                    <td>${parseInt(r1, 10) * 10}°</td>
                    <td>${wind1.cw} kt</td>
                    <td>${wind1.hw >= 0 ? wind1.hw + ' kt (Head)' : Math.abs(wind1.hw) + ' kt (Tail)'}</td>
                `;
                tbody.appendChild(tr1);
            }
            if (r2) {
                const wind2 = calculateCrosswind(r2, metar.windDirection, metar.windSpeed);
                const tr2 = document.createElement('tr');
                tr2.innerHTML = `
                    <td class="rwy-ident">${r2}</td>
                    <td>${parseInt(r2, 10) * 10}°</td>
                    <td>${wind2.cw} kt</td>
                    <td>${wind2.hw >= 0 ? wind2.hw + ' kt (Head)' : Math.abs(wind2.hw) + ' kt (Tail)'}</td>
                `;
                tbody.appendChild(tr2);
            }
        });
    }

    function populateDashTaf(tafText, tafUnavailable) {
        const container = $('dash-taf-container');
        if (!container) return;
        clearElement(container);
        
        $('dash-raw-taf-text').textContent = tafText || '';
        
        if (!tafText || tafUnavailable) {
            container.innerHTML = '<p class="empty-state">No TAF available.</p>';
            return;
        }

        const flatTaf = tafText.replace(/\s+/g, ' ');
        const regex = /\b(FM\d{6}|BECMG|TEMPO|PROB30\s+TEMPO|PROB40\s+TEMPO|PROB30|PROB40)\b/;
        const parts = flatTaf.split(regex);
        
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';

        // Base forecast
        let initialContent = parts[0].trim();
        if (initialContent) {
            initialContent = initialContent.replace(/^TAF(?:\s+AMD|\s+COR)?\s+[A-Z0-9]{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, '');
            const initialCat = estimateTafCategory(initialContent);
            const baseDiv = document.createElement('div');
            baseDiv.className = `dash-taf-entry category-${initialCat.toLowerCase()}`;
            baseDiv.innerHTML = `<div class="dash-taf-title">Initial Forecast</div><div class="dash-taf-body">${initialContent}</div>`;
            container.appendChild(baseDiv);
        }

        for (let i = 1; i < parts.length; i += 2) {
            const keyword = parts[i].trim();
            const content = parts[i + 1] ? parts[i + 1].trim() : '';
            
            const entryDiv = document.createElement('div');
            const cat = estimateTafCategory(content);
            entryDiv.className = `dash-taf-entry category-${cat.toLowerCase()}`;
            
            let prettyKeyword = keyword;
            if (keyword.startsWith('FM')) {
                const day = keyword.substring(2, 4);
                const hour = keyword.substring(4, 6);
                const min = keyword.substring(6, 8);
                prettyKeyword = `From Day ${day}, ${hour}:${min}Z`;
                entryDiv.classList.add('fm');
            } else if (keyword === 'BECMG') {
                prettyKeyword = 'Becoming';
                entryDiv.classList.add('becmg');
            } else if (keyword === 'TEMPO') {
                prettyKeyword = 'Temporary';
                entryDiv.classList.add('tempo');
            } else if (keyword.includes('PROB')) {
                prettyKeyword = keyword + ' (Prob)';
            }
            
            entryDiv.innerHTML = `<div class="dash-taf-title">${prettyKeyword}</div><div class="dash-taf-body">${content}</div>`;
            container.appendChild(entryDiv);
        }
    }

    function populateDashboard(airport, weather) {
        if (!dashboardEmptyState) return;
        dashboardEmptyState.classList.add('hidden');
        dashboardContent.classList.remove('hidden');
        
        $('dash-icao').textContent = airport.icao;
        $('dash-name').textContent = airport.name || 'Unknown Airport';
        
        const metar = weather.metar;
        if (!metar) {
            $('dash-raw-text').textContent = 'No METAR available for this airport.';
            return;
        }
        
        $('dash-time-val').textContent = formatObservationTime(metar.issued);
        
        const catCard = $('dash-cat-card');
        catCard.className = `dash-widget-card category-${metar.category.toLowerCase()}`;
        $('dash-cat-val').textContent = metar.category;
        
        $('dash-temp-val').textContent = convertTemp(metar.temperature);
        $('dash-weather-val').textContent = metar.weather || 'Clear';
        
        $('dash-wind-spd').textContent = convertSpeed(metar.windSpeed);
        $('dash-wind-dir').textContent = metar.windDirection !== null ? `${metar.windDirection}°` : 'Var';
        
        $('dash-vis-val').textContent = metar.visibility || '—';
        $('dash-ceil-val').textContent = metar.ceiling ? `${metar.ceiling} ft` : 'None';
        $('dash-qnh-val').textContent = convertPressure(metar.altimeter);
        
        if (window.SunCalc) {
            const times = window.SunCalc.getTimes(new Date(), airport.lat, airport.lon);
            const sunrise = times.sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const sunset = times.sunset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const hours = Math.round((times.sunset - times.sunrise) / 3600000);
            $('dash-sun-val').innerHTML = `☀️ ${sunrise} 🌙 ${sunset} (${hours}h)`;
        }
        
        $('dash-raw-text').textContent = metar.raw || '—';
        
        
        // Draw detailed wind canvas
        const canvas = $('dash-wind-canvas');
        if (canvas && window.Visualizer) {
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            canvas.width = 400 * dpr;
            canvas.height = 400 * dpr;
            ctx.scale(dpr, dpr);
            
            window.Visualizer.drawRunwayAndWind(airport.runwayHeading, metar.windDirection, metar.windSpeed, canvas.id);
        }
        
        if ($('dash-nl-metar')) {
            $('dash-nl-metar').textContent = generateNaturalLanguageMetar(metar);
        }
        
        populateRunwayTable(airport, metar);
        populateDashTaf(weather.taf, weather.tafUnavailable);
        renderCharts(airport.icao);
    }
    
    async function renderCharts(icao) {
        if (!window.Chart) {
            renderChartError('Chart.js library failed to load via CDN.');
            return;
        }
        
        // Remove old errors
        document.querySelectorAll('.chart-error').forEach(e => e.remove());
        ['chart-temp', 'chart-wind', 'chart-qnh'].forEach(id => {
            if ($(id)) $(id).style.opacity = '1';
        });

        // Destroy existing charts
        ['temp', 'wind', 'qnh'].forEach(type => {
            if (dashboardChartInstances[type]) {
                dashboardChartInstances[type].destroy();
                dashboardChartInstances[type] = null;
            }
        });

        try {
            const history = await window.API.fetchHistoricalMetar(icao);
            if (!history || history.length === 0) {
                renderChartError('Historical data unavailable from API.');
                return;
            }
            
            const chron = history.reverse();
        
        // If we only got 1 point (e.g. server hasn't updated yet to support hours=24), ensure pointRadius > 0 so it's visible.
        const pRadius = chron.length === 1 ? 4 : 2;
        
        const labels = chron.map((m, i) => {
            if (!m.issued) return i;
            const d = new Date(m.issued);
            return isNaN(d.getTime()) ? i : d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }); 
        const temps = chron.map(m => m.temperature);
        const dews = chron.map(m => m.dewpoint);
        const winds = chron.map(m => m.windSpeed);
        const gusts = chron.map(m => m.windSpeed + (m.raw.includes('G') ? 10 : 0)); // crude gust approximation for graph
        const qnhs = chron.map(m => m.altimeter);

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { display: true, ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 6 } },
                y: { display: true, position: 'right', grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'rgba(255,255,255,0.7)' } }
            }
        };

        const ctxTemp = $('chart-temp').getContext('2d');
        dashboardChartInstances['temp'] = new Chart(ctxTemp, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Temperature (°C)', data: temps, borderColor: '#ff4d4d', tension: 0.3, pointRadius: pRadius },
                    { label: 'Dewpoint (°C)', data: dews, borderColor: '#4da6ff', tension: 0.3, pointRadius: pRadius }
                ]
            },
            options: { ...commonOptions, plugins: { title: { display: true, text: 'Temperature & Dewpoint (°C)', color: '#fff' }, legend: { display: false } } }
        });

        const ctxWind = $('chart-wind').getContext('2d');
        dashboardChartInstances['wind'] = new Chart(ctxWind, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Wind Speed (kt)', data: winds, borderColor: '#4da6ff', tension: 0.3, pointRadius: pRadius, fill: true, backgroundColor: 'rgba(77, 166, 255, 0.1)' }
                ]
            },
            options: { ...commonOptions, plugins: { title: { display: true, text: 'Wind speed (kt)', color: '#fff' } } }
        });

        const ctxQnh = $('chart-qnh').getContext('2d');
        dashboardChartInstances['qnh'] = new Chart(ctxQnh, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'QNH (hPa)', data: qnhs, borderColor: '#fff', tension: 0.3, pointRadius: pRadius, stepped: true }
                ]
            },
            options: { ...commonOptions, plugins: { title: { display: true, text: 'QNH (hPa)', color: '#fff' } } }
        });

        } catch (e) {
            console.error(e);
            renderChartError(`Error rendering chart: ${e.message}`);
        }
    }

    function renderFullDashboard(airport) {
        if (!dashboardEmptyState) return;
        dashboardEmptyState.classList.add('hidden');
        dashboardContent.classList.remove('hidden');
        if (lastWeatherObj && lastWeatherObj.metar && lastWeatherObj.metar.icao === airport.icao) {
            populateDashboard(airport, lastWeatherObj);
        }
    }

    function switchView(view, forceEmpty = false) {
        if (!viewMapBtn || !viewListBtn) return;
        
        // Remove active class from all
        viewMapBtn.classList.remove('active');
        viewListBtn.classList.remove('active');
        if (viewEarthBtn) viewEarthBtn.classList.remove('active');
        
        // Hide earth by default unless explicitly asked
        if (window.EarthView) window.EarthView.hide();
        
        if (view === 'map') {
            viewMapBtn.classList.add('active');
            fullDashboardView.classList.add('hidden');
            
            mapContainer.style.display = 'block';
            dashboard.style.display = 'flex';
            if (selectedAirport) {
                airportPanel.classList.add('open');
                window.MapManager.focusAirport(selectedAirport);
            }
        } else if (view === 'list') {
            viewListBtn.classList.add('active');
            fullDashboardView.classList.remove('hidden');
            
            mapContainer.style.display = 'none';
            dashboard.style.display = 'none';
            airportPanel.classList.remove('open');
            
            if (selectedAirport && !forceEmpty) {
                renderFullDashboard(selectedAirport);
            } else {
                dashboardEmptyState.classList.remove('hidden');
                dashboardContent.classList.add('hidden');
            }
        } else if (view === 'earth') {
            if (viewEarthBtn) viewEarthBtn.classList.add('active');
            fullDashboardView.classList.add('hidden');
            mapContainer.style.display = 'none';
            dashboard.style.display = 'none';
            airportPanel.classList.remove('open');
            
            if (window.EarthView) window.EarthView.show();
        }
    }

    function initialize() {
        setupAutocomplete($('search-input'));
        setupAutocomplete($('dashboard-hero-search-input'));
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
        
        if (viewMapBtn && viewListBtn) {
            viewMapBtn.addEventListener('click', () => switchView('map'));
            viewListBtn.addEventListener('click', () => switchView('list', true));
            if (viewEarthBtn) viewEarthBtn.addEventListener('click', () => switchView('earth')); // Forces empty state
        }
        
        // Unit Settings
        const unitSettingsBtn = $('unit-settings-btn');
        const unitSettingsPanel = $('unit-settings-panel');
        if (unitSettingsBtn && unitSettingsPanel) {
            unitSettingsBtn.addEventListener('click', () => {
                unitSettingsPanel.classList.toggle('hidden');
            });
            
            const initUnit = (id, prefKey, memoryKey) => {
                const el = $(id);
                if (el) {
                    el.value = window.AppPrefs[memoryKey];
                    el.addEventListener('change', (e) => {
                        window.AppPrefs[memoryKey] = e.target.value;
                        window.localStorage.setItem(prefKey, e.target.value);
                        if (lastWeatherObj && selectedAirport) {
                            populateDashboard(selectedAirport, lastWeatherObj);
                            updateWeather(lastWeatherObj); // updates map popup
                        }
                    });
                }
            };
            initUnit('unit-temp', 'metar-temp-unit', 'tempUnit');
            initUnit('unit-speed', 'metar-speed-unit', 'speedUnit');
            initUnit('unit-pressure', 'metar-pressure-unit', 'pressureUnit');
        }
        
        if (dashboardHeroSearchForm) {
            dashboardHeroSearchForm.addEventListener('submit', event => {
                event.preventDefault();
                const airport = window.MapManager.findAirport(dashboardHeroSearchInput.value);
                if (!airport) {
                    showToast('Airport not found.', 'error');
                    return;
                }
                dashboardHeroSearchInput.value = '';
                openAirport(airport, false);
            });
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

        const openDashboardBtn = $('open-dashboard-btn');
        if (openDashboardBtn) {
            openDashboardBtn.addEventListener('click', () => switchView('list', false));
        }

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
