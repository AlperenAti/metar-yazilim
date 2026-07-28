window.EarthView = (function() {
    let globe = null;
    let initialized = false;
    let globeReady = false;   // true after onGlobeReady fires
    let airportsData = [];
    let layerMeshes = {}; // id -> THREE.Mesh
    let pendingLayers = []; // layers requested before globe was ready
    let countriesData = [];

    // -------------------------------------------------------------------
    // Layer Definitions — NASA GIBS equirectangular WMS
    // -------------------------------------------------------------------
    function getRecentDate(daysAgo = 2) {
        // The user's clock is set to 2026. NASA GIBS real-time data does not exist in 2026.
        // We must hardcode a date in 2024 to ensure data is returned.
        return '2024-06-01';
    }

    const GLOBE_LAYERS = {
        clouds: {
            getUrl: () => 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png',
            altFactor: 1.004,
            opacity: 1.0,
            blending: 'AdditiveBlending', 
            rotate: false
        }
    };

    function getGlobeGroup() {
        if (!globe) return null;
        // The first Group in the scene with children is the Globe's internal container
        return globe.scene().children.find(c => c.type === 'Group' && c.children.length > 0) || globe.scene();
    }

    function _buildMesh(id) {
        const cfg = GLOBE_LAYERS[id];
        if (!cfg || !globe || !window.THREE) return;

        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';

        const globeRadius = globe.getGlobeRadius();
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(globeRadius * cfg.altFactor, 72, 72),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0, // start invisible until loaded
                blending: THREE[cfg.blending] || THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.FrontSide
            })
        );
        mesh.rotation.y = Math.PI; // Align texture properly with the globe
        layerMeshes[id] = mesh;

        // Only add to scene if checkbox is checked
        const cb = document.getElementById('earth_layer_' + id);
        if (cb && cb.checked) {
            const group = getGlobeGroup();
            if (group) group.add(mesh);
        }

        if (cfg.rotate) {
            (function spin() {
                if (layerMeshes[id]) layerMeshes[id].rotation.y -= 0.00015;
                requestAnimationFrame(spin);
            })();
        }

        loader.load(
            cfg.getUrl(),
            (tex) => {
                if (layerMeshes[id]) {
                    layerMeshes[id].material.map = tex;
                    layerMeshes[id].material.opacity = cfg.opacity;
                    layerMeshes[id].material.needsUpdate = true;
                }
            },
            undefined,
            (err) => {
                console.error(`[EarthView] Failed to load texture for ${id}:`, err);
                if (layerMeshes[id]) {
                    // Turn it translucent red if the texture fails so we can visually debug it
                    layerMeshes[id].material.color.setHex(0xff0000);
                    layerMeshes[id].material.opacity = 0.5;
                    layerMeshes[id].material.needsUpdate = true;
                }
            }
        );
    }

    function syncAllLayers() {
        if (!globe || !globeReady) return;
        const group = getGlobeGroup();
        if (!group) return;

        Object.keys(GLOBE_LAYERS).forEach(id => {
            const cb = document.getElementById('earth_layer_' + id);
            if (!cb) return;
            if (cb.checked) {
                if (layerMeshes[id]) {
                    if (!group.children.includes(layerMeshes[id])) {
                        group.add(layerMeshes[id]);
                    }
                } else {
                    _buildMesh(id);
                }
            } else {
                if (layerMeshes[id]) {
                    group.remove(layerMeshes[id]);
                }
            }
        });
    }

    function syncBorders() {
        if (!globe) return;
        const cb = document.getElementById('earth_layer_borders');
        if (cb && cb.checked) {
            globe.polygonsData(countriesData);
            globe.labelsData(countriesData);
        } else {
            globe.polygonsData([]);
            globe.labelsData([]);
        }
    }

    // -------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------
    const init = async () => {
        if (initialized) return;

        const container = document.getElementById('earth-container');
        const loader    = document.getElementById('earth-loading');

        globe = Globe()(container)
            .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
            .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
            .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
            .pointLat(d => parseFloat(d.lat))
            .pointLng(d => parseFloat(d.lon))
            .pointAltitude(0)
            .pointRadius(d => d.t === 1 ? 0.05 : 0.025)
            .pointColor(d => d.t === 1 ? '#ff3333' : '#00f0ff')
            .pointResolution(32)
            .pointLabel(d => `
                <div style="background:rgba(7,17,29,0.92);padding:8px 12px;border-radius:8px;border:1px solid rgba(0,240,255,0.3);font-family:'Inter',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.6);">
                    <div style="color:#fff;font-weight:700;font-size:14px;margin-bottom:3px;">${d.i}</div>
                    <div style="color:#a0aec0;font-size:12px;">${d.n}</div>
                </div>
            `)
            .onPointClick(point => {
                const ap = {
                    icao: point.i,
                    name: point.n,
                    lat: parseFloat(point.lat),
                    lon: parseFloat(point.lon),
                    runwayHeading: point.rh || 0,
                    elevation: point.e || 0,
                    rwy: point.r || [],
                    freqs: point.f || []
                };
                if (window.UI && window.UI.openAirport) {
                    document.getElementById('dashboard').classList.remove('collapsed');
                    window.UI.openAirport(ap, false);
                }
            })
            .onGlobeReady(() => {
                // Hide loader
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);

                // Mark globe as ready
                globeReady = true;
                
                // Initialize currently checked layers
                syncAllLayers();
                syncBorders();

                // Real-time Day/Night lighting
                if (window.THREE) {
                    const updateSunLight = () => {
                        const now = new Date();
                        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
                        const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
                        const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
                        
                        // Time calculation:
                        // At UTC 12:00, the sun is at Longitude 0.
                        // At UTC 00:00, the sun is at Longitude 180 / -180.
                        let solarLng = 180 - (utcH * 15);
                        if (solarLng > 180) solarLng -= 360;
                        if (solarLng < -180) solarLng += 360;

                        if (typeof globe.getCoords === 'function') {
                            const sunPos = globe.getCoords(decl, solarLng, 5); // Altitude 5 (far away)
                            const dLight = globe.scene().children.find(o => o.type === 'DirectionalLight');
                            if (dLight) { 
                                dLight.position.set(sunPos.x, sunPos.y, sunPos.z); 
                                dLight.intensity = 1.2; 
                            }
                        } else {
                            // Fallback manual spherical coordinates
                            const phi = (90 - decl) * (Math.PI / 180);
                            const theta = (solarLng + 90) * (Math.PI / 180); // +90 aligns correctly in ThreeGlobe
                            const R = 1000;
                            const x = R * Math.sin(phi) * Math.cos(theta);
                            const z = R * Math.sin(phi) * Math.sin(theta);
                            const y = R * Math.cos(phi);
                            const dLight = globe.scene().children.find(o => o.type === 'DirectionalLight');
                            if (dLight) { 
                                dLight.position.set(x, y, z); 
                                dLight.intensity = 1.2; 
                            }
                        }
                        
                        const aLight = globe.scene().children.find(o => o.type === 'AmbientLight');
                        if (aLight) { aLight.intensity = 0.15; }
                    };
                    updateSunLight();
                    setInterval(updateSunLight, 60000);
                }

                // Process any layers that were queued before globe was ready
                pendingLayers.forEach(id => addLayer(id));
                pendingLayers = [];

                // Activate any pre-checked layers
                syncAllLayers();
            });

        // Disable auto-rotate
        globe.controls().autoRotate = false;

        // Load airports
        try {
            const res  = await fetch('data/airports.json');
            const data = await res.json();
            airportsData = data.filter(a => a.t === 1 || a.t === 2);
            globe.pointsData(airportsData);
        } catch (e) {
            console.error('[EarthView] Failed to load airports:', e);
        }

        // Resize handler
        window.addEventListener('resize', () => {
            if (document.body.classList.contains('earth-active') && globe) {
                globe.width([container.clientWidth]);
                globe.height([container.clientHeight]);
            }
        });

        // Load borders
        try {
            const res = await fetch('data/countries.geojson');
            const data = await res.json();
            countriesData = data.features;
            
            globe
                .polygonCapColor(() => 'rgba(0, 0, 0, 0)')
                .polygonSideColor(() => 'rgba(255, 255, 255, 0.02)')
                .polygonStrokeColor(() => 'rgba(0, 0, 0, 0.6)') // Dark borders for visibility over deserts
                .polygonAltitude(0.003)
                .labelLat(d => d.properties.label_lat)
                .labelLng(d => d.properties.label_lon)
                .labelText(d => d.properties.NAME_TR || d.properties.NAME)
                .labelSize(d => d.properties.LABELRANK < 4 ? 0.6 : (d.properties.LABELRANK < 6 ? 0.4 : 0)) // Reduced label size
                .labelAltitude(0.005) // Ensure labels float ABOVE the polygons
                .labelDotRadius(0)
                .labelColor(() => 'rgba(255, 255, 255, 0.8)')
                .labelResolution(3);
                
            syncBorders();
        } catch (e) {
            console.error('[EarthView] Failed to load borders:', e);
        }

        // Borders toggle
        const bordersCb = document.getElementById('earth_layer_borders');
        if (bordersCb) {
            bordersCb.addEventListener('change', syncBorders);
        }

        // Weather layer checkboxes
        Object.keys(GLOBE_LAYERS).forEach(id => {
            const cb = document.getElementById('earth_layer_' + id);
            if (!cb) return;
            cb.addEventListener('change', () => {
                syncAllLayers();
            });
        });

        initialized = true;
    };

    // -------------------------------------------------------------------
    // Show / Hide
    // -------------------------------------------------------------------
    const show = () => {
        document.body.classList.add('earth-active');
        document.getElementById('earth-wrapper').classList.remove('hidden');
        document.getElementById('map').style.visibility = 'hidden';

        if (!initialized) {
            init();
        } else if (globe) {
            const container = document.getElementById('earth-container');
            globe.width([container.clientWidth]);
            globe.height([container.clientHeight]);
            syncAllLayers();
        }
    };

    const hide = () => {
        document.body.classList.remove('earth-active');
        document.getElementById('earth-wrapper').classList.add('hidden');
        document.getElementById('map').style.visibility = 'visible';
    };

    const flyTo = (lat, lon) => {
        if (!globe) return;
        // The altitude 0.15 is much closer to the ground
        // transition time is 1500ms
        globe.pointOfView({ lat: lat, lng: lon, altitude: 0.15 }, 1500);
    };

    return { init, show, hide, flyTo };
})();
