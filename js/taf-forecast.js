// taf-forecast.js — Hourly TAF forecast table (metar-taf.com style)
// Parses raw TAF text into a scrollable hourly table + human-readable explanation

window.TAFForecast = (function () {

    // ----------------------------------------------------------------
    // Utility helpers
    // ----------------------------------------------------------------
    function pad(n) { return String(n).padStart(2, '0'); }

    // Parse "DDHH" or "DDHHMM" into a UTC Date, relative to a reference Date.
    function parseDDHH(s, ref) {
        const dd = parseInt(s.substring(0, 2), 10);
        const hh = parseInt(s.substring(2, 4), 10);
        const mm = s.length >= 6 ? parseInt(s.substring(4, 6), 10) : 0;
        const d  = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), dd, hh, mm, 0));
        // Roll over month if day looks like it wraps
        if (dd < ref.getUTCDate() - 20) {
            d.setUTCMonth(d.getUTCMonth() + 1);
        }
        return d;
    }

    // Parse wind token → { dir: number|'VRB', speed, gust }
    function parseWind(tokens) {
        const t = tokens.find(t => /^(VRB|\d{3})\d{2,3}(G\d{2,3})?KT$/i.test(t));
        if (!t) return null;
        const m = t.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/i);
        if (!m) return null;
        return {
            dir:   m[1] === 'VRB' ? 'VRB' : parseInt(m[1], 10),
            speed: parseInt(m[2], 10),
            gust:  m[3] ? parseInt(m[3], 10) : null
        };
    }

    // Parse visibility → { vis: metres|9999, cavok: bool }
    function parseVis(tokens) {
        if (tokens.includes('CAVOK')) return { vis: 9999, cavok: true };
        const vt = tokens.find(t => /^\d{4}$/.test(t) && t !== '0000');
        if (vt) return { vis: parseInt(vt, 10), cavok: false };
        const sm = tokens.find(t => /^\d+SM$/.test(t));
        if (sm) return { vis: Math.round(parseInt(sm, 10) * 1609), cavok: false };
        return { vis: 9999, cavok: false };
    }

    // Parse cloud layers → { ceiling: ft|null, cover: 'CAVOK'|'SKC'|'FEW'|'SCT'|'BKN'|'OVC'|null }
    function parseClouds(tokens) {
        if (tokens.includes('CAVOK')) return { ceiling: null, cover: 'CAVOK' };
        if (tokens.includes('SKC') || tokens.includes('NCD') || tokens.includes('NSC'))
            return { ceiling: null, cover: 'SKC' };

        let ceiling = null;
        let topCover = null;
        for (const t of tokens) {
            const m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/);
            if (!m) continue;
            const h = parseInt(m[2], 10) * 100;
            const c = m[1];
            if (!topCover || ['SCT', 'BKN', 'OVC'].indexOf(c) > ['SCT', 'BKN', 'OVC'].indexOf(topCover)) {
                topCover = c;
            }
            if ((c === 'BKN' || c === 'OVC') && (ceiling === null || h < ceiling)) {
                ceiling = h;
            }
        }
        return { ceiling, cover: topCover };
    }

    // Parse weather phenomena
    function parseWx(tokens) {
        const wxTokens = tokens.filter(t =>
            /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP)*(BR|FG|FU|VA|DU|SA|HZ|PY)?(PO|SQ|FC|SS|DS)?$/.test(t)
            && t.length >= 2
            && !/^\d+$/.test(t)
            && !['CAVOK','SKC','NSC','NCD'].includes(t)
            && !/^(FEW|SCT|BKN|OVC)/.test(t)
            && !/KT$/.test(t)
            && !/^\d{4}(\/\d{4})?$/.test(t)
        );
        return wxTokens;
    }

    // Flight category from conditions
    function flightCat(vis9999, cavok, ceiling, wxCodes) {
        const hasFG = wxCodes.some(w => w.includes('FG'));
        const visSM = vis9999 >= 9999 ? 10 : vis9999 / 1609;
        const ceilFt = ceiling === null ? 99999 : ceiling;

        if (cavok) return 'VFR';
        if (hasFG || ceilFt < 500 || visSM < 1) return 'LIFR';
        if (ceilFt < 1000 || visSM < 3) return 'IFR';
        if (ceilFt < 3000 || visSM < 5) return 'MVFR';
        return 'VFR';
    }

    // Parse a block of tokens into a conditions object
    function parseBlock(tokens) {
        const wind   = parseWind(tokens);
        const visObj = parseVis(tokens);
        const clouds = parseClouds(tokens);
        const wx     = parseWx(tokens);
        return { wind, vis: visObj.vis, cavok: visObj.cavok, ceiling: clouds.ceiling, cover: clouds.cover, wx };
    }

    // Merge base conditions with an override (only overwrite non-null fields)
    function merge(base, override) {
        const r = Object.assign({}, base);
        if (override.wind)              r.wind    = override.wind;
        if (override.vis !== undefined) { r.vis = override.vis; r.cavok = override.cavok; }
        if (override.ceiling !== undefined || override.cover) {
            r.ceiling = override.ceiling;
            r.cover   = override.cover;
        }
        if (override.wx && override.wx.length) r.wx = override.wx;
        return r;
    }

    // ----------------------------------------------------------------
    // Main parser: TAF → array of hourly conditions
    // ----------------------------------------------------------------
    function parseTAFToHourly(rawTaf) {
        if (!rawTaf) return { hours: [], validFrom: null, validTo: null };
        const flat = rawTaf.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const now  = new Date();

        // Extract validity period
        const vm = flat.match(/\b(\d{4})\/(\d{4})\b/);
        if (!vm) return { hours: [], validFrom: null, validTo: null };
        const validFrom = parseDDHH(vm[1], now);
        const validTo   = parseDDHH(vm[2], now);

        // Strip TAF header
        const body = flat.replace(/^TAF(?:\s+(?:AMD|COR))?\s+\w{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, '');

        // Split into segments by BECMG / TEMPO / FM / PROB
        const SEG_RE = /(BECMG|TEMPO|FM\d{6}|PROB\d{2}(?:\s+TEMPO)?)/g;
        const rawSegs = body.split(SEG_RE).filter(s => s.trim());

        const segments = [];

        // Base segment
        segments.push({ type: 'BASE', from: validFrom, to: validTo, cond: parseBlock(rawSegs[0].split(' ')) });

        // Subsequent segments
        let i = 1;
        while (i < rawSegs.length) {
            const keyword = rawSegs[i].trim();
            const content = rawSegs[i + 1] ? rawSegs[i + 1].trim() : '';
            i += 2;

            const tokens = content.split(' ');
            let segFrom, segTo, type;

            if (keyword.startsWith('FM')) {
                const ddhhmm = keyword.replace('FM', '');
                segFrom = parseDDHH(ddhhmm, now);
                segTo   = validTo;
                type    = 'FM';
            } else if (keyword.startsWith('BECMG') || keyword.startsWith('TEMPO') || keyword.startsWith('PROB')) {
                const tm = tokens[0] && /^\d{4}\/\d{4}$/.test(tokens[0]) ? tokens.shift() : null;
                if (tm) {
                    segFrom = parseDDHH(tm.split('/')[0], now);
                    segTo   = parseDDHH(tm.split('/')[1], now);
                } else { continue; }
                type = keyword.startsWith('BECMG') ? 'BECMG' : keyword.startsWith('TEMPO') ? 'TEMPO' : 'PROB';
            } else { continue; }

            segments.push({ type, from: segFrom, to: segTo, cond: parseBlock(tokens) });
        }

        // Generate hourly data by walking forward one hour at a time
        const hours = [];
        let t = new Date(validFrom);
        t.setUTCMinutes(0, 0, 0);

        // Current "persistent" conditions start from BASE
        let persistent = { ...segments[0].cond };

        while (t.getTime() <= validTo.getTime()) {
            // Apply FM groups that are now fully in effect
            for (const seg of segments) {
                if (seg.type === 'FM' && t >= seg.from) {
                    persistent = merge(persistent, seg.cond);
                    seg._applied = true;
                }
            }
            // Apply BECMG groups that have completed transition
            for (const seg of segments) {
                if (seg.type === 'BECMG' && t >= seg.to && !seg._applied) {
                    persistent = merge(persistent, seg.cond);
                    seg._applied = true;
                }
            }

            // Current conditions = persistent + any active TEMPO
            let current = { ...persistent };
            let isChanging = false;

            for (const seg of segments) {
                if (seg.type === 'BECMG' && t >= seg.from && t < seg.to) {
                    current     = merge(current, seg.cond);
                    isChanging  = true;
                }
                if (seg.type === 'TEMPO' && t >= seg.from && t < seg.to) {
                    current = merge(current, seg.cond);
                }
            }

            const cat = flightCat(current.vis, current.cavok, current.ceiling, current.wx || []);
            hours.push({ time: new Date(t), cond: current, cat, changing: isChanging });

            t = new Date(t.getTime() + 3_600_000);
        }

        return { hours, validFrom, validTo };
    }

    // ----------------------------------------------------------------
    // Weather icon resolver
    // ----------------------------------------------------------------
    function wxIcon(cond, isDaytime) {
        const wx = cond.wx || [];
        if (wx.some(w => /TS/.test(w)))           return { icon: '⛈', label: 'Thunderstorm' };
        if (wx.some(w => /FZRA|FZDZ/.test(w)))   return { icon: '🧊', label: 'Freezing Rain' };
        if (wx.some(w => /SN|RASN/.test(w)))      return { icon: '🌨', label: 'Snow' };
        if (wx.some(w => /SH/.test(w)))           return { icon: '🌦', label: 'Showers' };
        if (wx.some(w => /RA|DZ/.test(w)))        return { icon: '🌧', label: 'Rain' };
        if (wx.some(w => /FG/.test(w)))           return { icon: '🌫', label: 'Fog' };
        if (wx.some(w => /HZ/.test(w)))           return { icon: '🌁', label: 'Haze' };

        const cover = cond.cover;
        const ceil  = cond.ceiling;
        if (cond.cavok || cover === 'SKC' || cover === 'CAVOK') {
            return isDaytime ? { icon: '☀', label: 'Clear' } : { icon: '🌙', label: 'Clear' };
        }
        if (cover === 'OVC' || (ceil !== null && ceil < 1500)) return { icon: '☁', label: 'Overcast' };
        if (cover === 'BKN') return isDaytime ? { icon: '🌥', label: 'Cloudy' } : { icon: '☁', label: 'Cloudy' };
        if (cover === 'SCT') return isDaytime ? { icon: '⛅', label: 'P.Cloudy' } : { icon: '🌙', label: 'P.Cloudy' };
        if (cover === 'FEW') return isDaytime ? { icon: '🌤', label: 'Mostly Clear' } : { icon: '🌙', label: 'Clear' };
        return isDaytime ? { icon: '☀', label: 'Clear' } : { icon: '🌙', label: 'Clear' };
    }

    const CAT_COLORS = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#8b5cf6' };

    // ----------------------------------------------------------------
    // Render hourly table + explanation
    // ----------------------------------------------------------------
    function render(container, rawTaf, airport) {
        if (!container) return;
        if (!rawTaf) {
            container.innerHTML = '<p class="empty-state">No TAF available for this airport.</p>';
            const v = document.getElementById('forecast-validity');
            if (v) v.textContent = '';
            return;
        }

        const lat = airport ? +airport.lat : null;
        const lon = airport ? +airport.lon : null;
        const { hours, validFrom, validTo } = parseTAFToHourly(rawTaf);

        if (!hours.length) {
            container.innerHTML = '<p class="empty-state">Could not parse TAF.</p>';
            return;
        }

        // Update validity label
        const v = document.getElementById('forecast-validity');
        if (v && validFrom && validTo) {
            const fmt = d => `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${pad(d.getUTCHours())}:00Z`;
            v.textContent = `${fmt(validFrom)} → ${fmt(validTo)}`;
        }

        // Build columns
        const ROW_KEYS = ['time','cat','weather','vis','ceiling','wind','speed','gusts','sun'];
        const ROW_LABELS = { time:'Time', cat:'Code', weather:'Weather', vis:'Visibility', ceiling:'Ceiling', wind:'Wind', speed:'Speed', gusts:'Gusts', sun:'Sun' };

        const cols = hours.map(h => {
            const c = h.cond;
            const ts = h.time;

            let isDaytime = true;
            let sunriseH = null, sunsetH = null;
            if (window.SunCalc && lat !== null) {
                const st = SunCalc.getTimes(ts, lat, lon);
                isDaytime = ts >= st.sunrise && ts <= st.sunset;
                if (st.sunrise.getUTCDate() === ts.getUTCDate() && st.sunrise.getUTCHours() === ts.getUTCHours())
                    sunriseH = `${pad(st.sunrise.getHours())}:${pad(st.sunrise.getMinutes())}`;
                if (st.sunset.getUTCDate() === ts.getUTCDate() && st.sunset.getUTCHours() === ts.getUTCHours())
                    sunsetH = `${pad(st.sunset.getHours())}:${pad(st.sunset.getMinutes())}`;
            }

            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const dayStr   = dayNames[ts.getUTCDay()];
            const timeStr  = `${pad(ts.getUTCHours())}:00`;

            const isNow = (() => { const n = new Date(); return ts.getUTCHours() === n.getUTCHours() && ts.getUTCDate() === n.getUTCDate(); })();

            const { icon, label } = wxIcon(c, isDaytime);

            const visStr = c.cavok || c.vis >= 9999 ? '10km+' : c.vis >= 1000 ? (c.vis/1000).toFixed(1)+'km' : c.vis+'m';
            const ceilStr = c.ceiling ? (c.ceiling >= 1000 ? (c.ceiling/100).toFixed(0)+' ft' : c.ceiling+' ft') : (c.cover === 'CAVOK'||c.cover==='SKC' ? 'Clear' : '—');

            let windDirStr = '—';
            let arrowStyle = '';
            if (c.wind) {
                if (c.wind.dir === 'VRB') { windDirStr = 'Var'; }
                else {
                    windDirStr = `${c.wind.dir}°`;
                    arrowStyle = `style="display:inline-block;transform:rotate(${c.wind.dir}deg);font-size:18px;"`;
                }
            }
            const windArrow = c.wind
                ? (c.wind.dir === 'VRB' ? '<span style="font-size:16px;opacity:.6">○</span>' : `<span ${arrowStyle}>↑</span>`)
                : '—';

            const speedStr = c.wind ? `${c.wind.speed} kt` : '—';
            const gustStr  = c.wind && c.wind.gust ? `${c.wind.gust} kt` : '';

            let sunCell = '';
            if (sunriseH) sunCell = `<span class="tf-sun-rise">↑${sunriseH}</span>`;
            if (sunsetH)  sunCell = `<span class="tf-sun-set">↓${sunsetH}</span>`;

            return {
                isNow, dayStr, timeStr,
                cat: h.cat, catColor: CAT_COLORS[h.cat] || '#6b7280',
                icon, label,
                visStr, ceilStr,
                windArrow, windDirStr, speedStr, gustStr,
                sunCell
            };
        });

        // Build HTML
        let html = '<div class="tf-scroll-outer"><table class="tf-table">';

        // Row: Time
        html += '<tr class="tf-row-time"><td class="tf-label">Time</td>' + cols.map(c =>
            `<td class="tf-cell ${c.isNow ? 'tf-now' : ''}">${c.dayStr}<br><strong>${c.timeStr}</strong></td>`
        ).join('') + '</tr>';

        // Row: Code
        html += '<tr class="tf-row-cat"><td class="tf-label">Code</td>' + cols.map(c =>
            `<td class="tf-cell"><span class="tf-badge" style="background:${c.catColor}">${c.cat}</span></td>`
        ).join('') + '</tr>';

        // Row: Weather
        html += '<tr class="tf-row-wx"><td class="tf-label">Weather</td>' + cols.map(c =>
            `<td class="tf-cell"><div class="tf-wx-icon">${c.icon}</div><div class="tf-wx-lbl">${c.label}</div></td>`
        ).join('') + '</tr>';

        // Row: Visibility
        html += '<tr><td class="tf-label">Visibility</td>' + cols.map(c =>
            `<td class="tf-cell tf-muted">${c.visStr}</td>`
        ).join('') + '</tr>';

        // Row: Ceiling
        html += '<tr><td class="tf-label">Ceiling</td>' + cols.map(c =>
            `<td class="tf-cell tf-muted">${c.ceilStr}</td>`
        ).join('') + '</tr>';

        // Row: Wind direction
        html += '<tr><td class="tf-label">Wind</td>' + cols.map(c =>
            `<td class="tf-cell">${c.windArrow}<br><small class="tf-muted">${c.windDirStr}</small></td>`
        ).join('') + '</tr>';

        // Row: Speed
        html += '<tr><td class="tf-label">Speed</td>' + cols.map(c =>
            `<td class="tf-cell tf-muted">${c.speedStr}</td>`
        ).join('') + '</tr>';

        // Row: Gusts
        html += '<tr><td class="tf-label">Gusts</td>' + cols.map(c =>
            `<td class="tf-cell" style="color:#f97316;">${c.gustStr}</td>`
        ).join('') + '</tr>';

        // Row: Sun
        html += '<tr class="tf-row-sun"><td class="tf-label">Sunrise/Set</td>' + cols.map(c =>
            `<td class="tf-cell">${c.sunCell}</td>`
        ).join('') + '</tr>';

        html += '</table></div>';

        // ----------------------------------------------------------------
        // Explanation section
        // ----------------------------------------------------------------
        html += buildExplanation(rawTaf);

        container.innerHTML = html;

        // Scroll "now" column into view
        const nowCell = container.querySelector('.tf-now');
        if (nowCell) {
            setTimeout(() => nowCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 100);
        }
    }

    function buildExplanation(rawTaf) {
        if (!rawTaf) return '';
        const flat = rawTaf.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const now  = new Date();

        // Re-parse segments for human text
        const body = flat.replace(/^TAF(?:\s+(?:AMD|COR))?\s+\w{4}\s+\d{6}Z\s+\d{4}\/\d{4}\s*/, '');
        const SEG_RE = /(BECMG|TEMPO|FM\d{6}|PROB\d{2}(?:\s+TEMPO)?)/g;
        const rawSegs = body.split(SEG_RE).filter(s => s.trim());

        const items = [];

        // Base period header
        const vm = flat.match(/\b(\d{4})\/(\d{4})\b/);
        if (vm) {
            const f = parseDDHH(vm[1], now);
            const t = parseDDHH(vm[2], now);
            const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            items.push({ heading: `From ${dayNames[f.getUTCDay()]} ${pad(f.getUTCHours())}:00 UTC to ${dayNames[t.getUTCDay()]} ${pad(t.getUTCHours())}:00 UTC`,
                bullets: condToBullets(parseBlock(rawSegs[0].split(' '))) });
        }

        let i = 1;
        while (i < rawSegs.length) {
            const kw   = rawSegs[i].trim();
            const cont = rawSegs[i + 1] ? rawSegs[i + 1].trim() : '';
            i += 2;
            const toks = cont.split(' ');

            let heading = '';
            let filteredToks = toks;

            if (kw.startsWith('FM')) {
                const ddhhmm = kw.replace('FM', '');
                const ft = parseDDHH(ddhhmm, now);
                const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                heading = `From ${dayNames[ft.getUTCDay()]} ${pad(ft.getUTCHours())}:${pad(ft.getUTCMinutes() || 0)} UTC`;
            } else {
                const tm = toks[0] && /^\d{4}\/\d{4}$/.test(toks[0]) ? toks.shift() : null;
                if (tm) {
                    const f = parseDDHH(tm.split('/')[0], now);
                    const t2= parseDDHH(tm.split('/')[1], now);
                    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                    const prefix = kw.startsWith('BECMG') ? 'Becomes' : kw.startsWith('TEMPO') ? 'Temporarily' : 'Probability';
                    heading = `${prefix}: ${dayNames[f.getUTCDay()]} ${pad(f.getUTCHours())}:00 – ${dayNames[t2.getUTCDay()]} ${pad(t2.getUTCHours())}:00 UTC`;
                    filteredToks = toks;
                }
            }

            if (heading) {
                items.push({ heading, bullets: condToBullets(parseBlock(filteredToks)) });
            }
        }

        let html = '<div class="tf-explanation"><h4>Forecast Summary</h4>';
        for (const item of items) {
            html += `<div class="tf-exp-group"><div class="tf-exp-heading">${item.heading}</div><ul class="tf-exp-bullets">`;
            for (const b of item.bullets) {
                html += `<li>${b}</li>`;
            }
            html += '</ul></div>';
        }
        html += '</div>';
        return html;
    }

    function condToBullets(cond) {
        const bullets = [];
        if (!cond) return bullets;

        // Wind
        if (cond.wind) {
            const w = cond.wind;
            if (w.dir === 'VRB') {
                bullets.push(`Wind: Variable direction at ${w.speed} kt${w.gust ? `, gusting ${w.gust} kt` : ''}`);
            } else if (w.speed === 0) {
                bullets.push('Wind: Calm');
            } else {
                bullets.push(`Wind: ${w.dir}° at ${w.speed} kt${w.gust ? `, gusting ${w.gust} kt` : ''}`);
            }
        }

        // Visibility
        if (cond.cavok) {
            bullets.push('CAVOK — Ceiling and visibility OK (vis ≥ 10 km, no significant cloud below 5,000 ft)');
        } else if (cond.vis && cond.vis < 9999) {
            const km = cond.vis >= 1000 ? (cond.vis / 1000).toFixed(1) + ' km' : cond.vis + ' m';
            bullets.push(`Visibility: ${km}`);
        }

        // Clouds
        if (!cond.cavok && cond.cover && !['SKC','NCD','NSC','CAVOK'].includes(cond.cover)) {
            const coverNames = { FEW:'Few clouds', SCT:'Scattered clouds', BKN:'Broken clouds', OVC:'Overcast' };
            if (cond.ceiling) {
                bullets.push(`Clouds: ${coverNames[cond.cover] || cond.cover} at ${cond.ceiling.toLocaleString()} ft`);
            }
        } else if (!cond.cavok && (cond.cover === 'SKC' || cond.cover === 'NCD')) {
            bullets.push('Sky clear');
        }

        // Weather phenomena
        if (cond.wx && cond.wx.length) {
            const wxDescs = {
                'TS':'Thunderstorm', 'TSRA':'Thunderstorm with rain', 'RA':'Rain', 'DZ':'Drizzle',
                'SN':'Snow', 'SG':'Snow grains', 'GR':'Hail', 'GS':'Small hail',
                'SH':'Showers', 'FG':'Fog', 'BR':'Mist', 'HZ':'Haze', 'FU':'Smoke',
                'RASN':'Rain and snow', 'FZRA':'Freezing rain', 'FZDZ':'Freezing drizzle',
                '+RA':'Heavy rain', '-RA':'Light rain', '+SN':'Heavy snow', '-SN':'Light snow',
                '+TSRA':'Heavy thunderstorm with rain', '-TSRA':'Light thunderstorm with rain'
            };
            const wxList = cond.wx.map(w => wxDescs[w] || w).join(', ');
            bullets.push(`Phenomena: ${wxList}`);
        }

        return bullets.length ? bullets : ['No significant change'];
    }

    return { render };

})();
