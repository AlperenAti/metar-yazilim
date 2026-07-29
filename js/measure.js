/**
 * WindRose — Measure Tools (Phase 2)
 * Distance measurement and area calculation on the Leaflet map.
 *
 * Distance mode:
 *   - Click to add points, straight geodesic lines between them
 *   - Cumulative distance shown at each point
 *   - Enter → finalize (layer stays), Escape → cancel
 *   - Hover point → red × appears to delete that point
 *
 * Area mode:
 *   - Click to add polygon vertices
 *   - Enter → close polygon, show area in m² / km²
 *   - Hover vertex → red × to delete
 */
(function () {
    'use strict';

    /* ── Constants ────────────────────────────────────────── */
    const R_M = 6_371_000; // Earth radius in metres

    /* ── State ────────────────────────────────────────────── */
    let activeTool   = null;   // 'distance' | 'area' | null
    let points       = [];     // Array of {lat, lon} objects
    let measureGroup = null;   // L.LayerGroup containing active drawing
    let finishedLayers = [];   // Committed layers (can accumulate)
    let map          = null;

    /* ── Geo helpers ──────────────────────────────────────── */
    function toRad(d) { return d * Math.PI / 180; }

    function haversineM(a, b) {
        const dLat = toRad(b.lat - a.lat);
        const dLon = toRad(b.lon - a.lon);
        const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
        return 2 * R_M * Math.asin(Math.sqrt(s));
    }

    function totalDistanceM(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) d += haversineM(pts[i-1], pts[i]);
        return d;
    }

    function cumulativeM(pts, idx) {
        let d = 0;
        for (let i = 1; i <= idx; i++) d += haversineM(pts[i-1], pts[i]);
        return d;
    }

    /** Spherical excess area via Shoelace on unit sphere, result in m² */
    function polygonAreaM2(pts) {
        if (pts.length < 3) return 0;
        // Approximate: project to local flat plane from centroid
        const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
        const cLon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
        const cosLat = Math.cos(toRad(cLat));
        // Convert to metres relative to centroid
        const mPts = pts.map(p => ({
            x: (p.lon - cLon) * toRad(1) * R_M * cosLat,
            y: (p.lat - cLat) * toRad(1) * R_M
        }));
        // Shoelace formula
        let area = 0;
        const n = mPts.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += mPts[i].x * mPts[j].y;
            area -= mPts[j].x * mPts[i].y;
        }
        return Math.abs(area) / 2;
    }

    /* ── Format helpers ───────────────────────────────────── */
    function fmtDist(m) {
        if (m >= 1_000_000) return (m / 1_000_000).toFixed(2) + ' Mm';
        if (m >= 1000)      return (m / 1000).toFixed(2) + ' km';
        return m.toFixed(0) + ' m';
    }

    function fmtArea(m2) {
        if (m2 >= 1e9)  return (m2 / 1e9).toFixed(3) + ' Mkm²';
        if (m2 >= 1e6)  return (m2 / 1e6).toFixed(3) + ' km²';
        if (m2 >= 1000) return (m2 / 1000).toFixed(1) + ' km² ×10⁻³';
        return m2.toFixed(0) + ' m²';
    }

    /* ── Drawing ──────────────────────────────────────────── */
    function redrawActive() {
        if (!measureGroup) return;
        measureGroup.clearLayers();
        if (points.length === 0) return;

        const lls = points.map(p => [p.lat, p.lon]);

        if (activeTool === 'distance') {
            // Polyline
            L.polyline(lls, {
                color: '#f59e0b', weight: 2.5, opacity: 0.9, dashArray: '5,4'
            }).addTo(measureGroup);

            // Point markers
            points.forEach((p, i) => {
                const cumDist = i === 0 ? 0 : cumulativeM(points, i);
                const label   = i === 0 ? 'Start' : fmtDist(cumDist);
                addPointMarker(p, i, label, '#f59e0b', measureGroup);
            });

        } else if (activeTool === 'area') {
            if (points.length >= 3) {
                L.polygon(lls, {
                    color: '#a78bfa', weight: 2, opacity: 0.9,
                    fillColor: '#a78bfa', fillOpacity: 0.12,
                    dashArray: '5,4'
                }).addTo(measureGroup);
            } else {
                L.polyline(lls, {
                    color: '#a78bfa', weight: 2.5, opacity: 0.9, dashArray: '5,4'
                }).addTo(measureGroup);
            }

            points.forEach((p, i) => {
                addPointMarker(p, i, `P${i+1}`, '#a78bfa', measureGroup);
            });
        }
    }

    function addPointMarker(p, idx, label, color, group) {
        const icon = L.divIcon({
            className: 'measure-point-wrapper',
            html: `
            <div class="measure-point" data-idx="${idx}">
                <div class="measure-dot" style="background:${color};box-shadow:0 0 0 3px ${color}33"></div>
                <div class="measure-label">${label}</div>
                <button class="measure-delete" data-idx="${idx}" title="Remove point">×</button>
            </div>`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        });
        const marker = L.marker([p.lat, p.lon], { icon, interactive: true }).addTo(group);

        // Bind delete button after marker is added to DOM (next tick)
        marker.on('add', () => {
            const el = marker.getElement();
            if (!el) return;
            const btn = el.querySelector('.measure-delete');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    points.splice(idx, 1);
                    redrawActive();
                });
            }
        });
    }

    /* ── Finalize (commit to finished layers) ─────────────── */
    function finalize() {
        if (!map || points.length < 2) { cancel(); return; }

        const lls   = points.map(p => [p.lat, p.lon]);
        const group = L.layerGroup().addTo(map);

        if (activeTool === 'distance') {
            const total = totalDistanceM(points);
            L.polyline(lls, { color: '#f59e0b', weight: 2.5, opacity: 0.85 }).addTo(group);
            points.forEach((p, i) => {
                const cum = i === 0 ? 0 : cumulativeM(points, i);
                addFinishedMarker(p, i === 0 ? 'Start' : fmtDist(cum), '#f59e0b', group, () => { group.remove(); finishedLayers = finishedLayers.filter(l => l !== group); });
            });
            // Total label at last point
            const last = points[points.length - 1];
            addTotalLabel([last.lat, last.lon], `Total: ${fmtDist(total)}`, '#f59e0b', group);

        } else if (activeTool === 'area') {
            if (points.length < 3) { cancel(); return; }
            const area = polygonAreaM2(points);
            L.polygon(lls, {
                color: '#a78bfa', weight: 2, fillColor: '#a78bfa', fillOpacity: 0.15
            }).addTo(group);
            points.forEach((p, i) => {
                addFinishedMarker(p, `P${i+1}`, '#a78bfa', group, () => { group.remove(); finishedLayers = finishedLayers.filter(l => l !== group); });
            });
            // Area label at centroid
            const cLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
            const cLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
            addTotalLabel([cLat, cLon], `Area: ${fmtArea(area)}`, '#a78bfa', group);
        }

        finishedLayers.push(group);
        cleanupActive();
    }

    function addFinishedMarker(p, label, color, group, onDelete) {
        const icon = L.divIcon({
            className: 'measure-point-wrapper',
            html: `
            <div class="measure-point" >
                <div class="measure-dot" style="background:${color};box-shadow:0 0 0 3px ${color}33"></div>
                <div class="measure-label">${label}</div>
                <button class="measure-delete measure-delete--final" title="Delete measurement">×</button>
            </div>`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        });
        const marker = L.marker([p.lat, p.lon], { icon }).addTo(group);
        marker.on('add', () => {
            const el = marker.getElement();
            if (!el) return;
            const btn = el.querySelector('.measure-delete');
            if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
        });
    }

    function addTotalLabel(latlng, text, color, group) {
        const icon = L.divIcon({
            className: 'measure-total-wrapper',
            html: `<div class="measure-total-label" style="background:${color}22;border:1px solid ${color}55;color:${color}">${text}</div>`,
            iconSize: [0, 0], iconAnchor: [0, 0]
        });
        L.marker(latlng, { icon, interactive: false }).addTo(group);
    }

    /* ── Tool lifecycle ───────────────────────────────────── */
    function activateTool(tool) {
        if (!map) { map = window.MapManager?.map; }
        if (!map) return;

        // If same tool clicked again → deactivate
        if (activeTool === tool) { cancel(); return; }

        // Cancel any previous tool
        cleanupActive();

        activeTool = tool;
        points = [];

        // Visual feedback on buttons
        document.getElementById('measure-dist-btn')?.classList.toggle('active', tool === 'distance');
        document.getElementById('measure-area-btn')?.classList.toggle('active', tool === 'area');

        // Crosshair cursor
        map.getContainer().classList.add('measure-cursor');

        measureGroup = L.layerGroup().addTo(map);

        // Map click handler
        map._measureClickHandler = (e) => {
            points.push({ lat: e.latlng.lat, lon: e.latlng.lng });
            redrawActive();
        };
        map.on('click', map._measureClickHandler);

        // Show hint
        showHint(tool === 'distance'
            ? 'Click to add points · Enter to commit · Esc to cancel'
            : 'Click to add vertices · Enter to calculate area · Esc to cancel');
    }

    function cancel() {
        cleanupActive();
        hideHint();
    }

    function cleanupActive() {
        if (map) {
            if (map._measureClickHandler) {
                map.off('click', map._measureClickHandler);
                map._measureClickHandler = null;
            }
            map.getContainer().classList.remove('measure-cursor');
        }
        if (measureGroup) { measureGroup.clearLayers(); measureGroup.remove(); measureGroup = null; }
        points = [];
        activeTool = null;
        document.getElementById('measure-dist-btn')?.classList.remove('active');
        document.getElementById('measure-area-btn')?.classList.remove('active');
        hideHint();
    }

    function clearAll() {
        cancel();
        finishedLayers.forEach(l => l.remove());
        finishedLayers = [];
    }

    /* ── Hint bar ─────────────────────────────────────────── */
    function showHint(text) {
        let hint = document.getElementById('measure-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'measure-hint';
            hint.className = 'measure-hint';
            document.querySelector('main').appendChild(hint);
        }
        hint.textContent = text;
        hint.classList.remove('hidden');
    }
    function hideHint() {
        document.getElementById('measure-hint')?.classList.add('hidden');
    }

    /* ── Keyboard handler ─────────────────────────────────── */
    document.addEventListener('keydown', (e) => {
        if (!activeTool) return;
        if (e.key === 'Enter') { e.preventDefault(); finalize(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            points.pop();
            redrawActive();
        }
    });

    /* ── Inject buttons into existing tool panel ──────────── */
    function init() {
        // Wait for tool panel to be created by route-planner.js
        const waitPanel = setInterval(() => {
            const panel = document.getElementById('map-tool-panel');
            if (!panel) return;
            clearInterval(waitPanel);

            // Separator
            const sep = document.createElement('div');
            sep.className = 'tool-separator';
            panel.appendChild(sep);

            // Distance button
            const distBtn = document.createElement('button');
            distBtn.id = 'measure-dist-btn';
            distBtn.className = 'map-tool-btn';
            distBtn.title = 'Measure Distance';
            distBtn.setAttribute('aria-label', 'Measure Distance');
            distBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/>
            </svg>`;
            distBtn.addEventListener('click', () => activateTool('distance'));
            panel.appendChild(distBtn);

            // Area button
            const areaBtn = document.createElement('button');
            areaBtn.id = 'measure-area-btn';
            areaBtn.className = 'map-tool-btn';
            areaBtn.title = 'Measure Area';
            areaBtn.setAttribute('aria-label', 'Measure Area');
            areaBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <polygon points="12,3 21,20 3,20"/>
            </svg>`;
            areaBtn.addEventListener('click', () => activateTool('area'));
            panel.appendChild(areaBtn);

            // Clear all button
            const clearBtn = document.createElement('button');
            clearBtn.id = 'measure-clear-btn';
            clearBtn.className = 'map-tool-btn';
            clearBtn.title = 'Clear all measurements';
            clearBtn.setAttribute('aria-label', 'Clear measurements');
            clearBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
            </svg>`;
            clearBtn.addEventListener('click', clearAll);
            panel.appendChild(clearBtn);

        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MeasureTools = { activateTool, cancel, clearAll };
})();
