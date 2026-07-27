window.EarthView = (function() {
    let globe = null;
    let initialized = false;
    let globeReady = false;   // true after onGlobeReady fires
    let airportsData = [];
    let layerMeshes = {}; // id -> THREE.Mesh
    let pendingLayers = []; // layers requested before globe was ready

    // -------------------------------------------------------------------
    // Layer Definitions — NASA GIBS equirectangular WMS
    // -------------------------------------------------------------------
    function getRecentDate(daysAgo = 2) {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().split('T')[0];
    }

    const GLOBE_LAYERS = {
        clouds: {
            getUrl: () => 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png',
            altFactor: 1.004,
            opacity: 0.9,
            blending: 'NormalBlending',
            rotate: true
        },
        precipitation: {
            getUrl: () => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=IMERG_Precipitation_Rate&TIME=${getRecentDate(3)}&CRS=CRS:84&BBOX=-180,-90,180,90&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE`,
            altFactor: 1.006,
            opacity: 0.85,
            blending: 'AdditiveBlending',
            rotate: false
        },
        temperature: {
            getUrl: () => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_Land_Surface_Temp_Day&TIME=${getRecentDate(3)}&CRS=CRS:84&BBOX=-180,-90,180,90&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE`,
            altFactor: 1.002,
            opacity: 0.65,
            blending: 'AdditiveBlending',
            rotate: false
        },
        wind: {
            getUrl: () => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=GEOS-5_FPIT_Wind_Speed_10m&TIME=${getRecentDate(3)}&CRS=CRS:84&BBOX=-180,-90,180,90&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE`,
            altFactor: 1.003,
            opacity: 0.55,
            blending: 'AdditiveBlending',
            rotate: false
        }
    };

    // -------------------------------------------------------------------
    // Layer management
    // -------------------------------------------------------------------
    function _buildMesh(id) {
        const cfg = GLOBE_LAYERS[id];
        if (!cfg || !globe || !window.THREE) return;

        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';

        loader.load(cfg.getUrl(), (tex) => {
            const globeRadius = globe.getGlobeRadius();
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(globeRadius * cfg.altFactor, 72, 72),
                new THREE.MeshBasicMaterial({
                    map: tex,
                    transparent: true,
                    opacity: cfg.opacity,
                    blending: THREE[cfg.blending] || THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.FrontSide
                })
            );

            layerMeshes[id] = mesh;

            // Only add to scene if checkbox is still checked
            const cb = document.getElementById('earth_layer_' + id);
            if (cb && cb.checked) {
                globe.scene().add(mesh);
            }

            // Slow rotation for cloud layer
            if (cfg.rotate) {
                (function spin() {
                    if (layerMeshes[id]) layerMeshes[id].rotation.y -= 0.00015;
                    requestAnimationFrame(spin);
                })();
            }
        }, undefined, (err) => {
            console.warn('[EarthView] Failed to load layer "' + id + '":', err);
        });
    }

    function addLayer(id) {
        if (!globeReady) {
            // Globe not ready yet — queue it
            if (!pendingLayers.includes(id)) pendingLayers.push(id);
            return;
        }
        if (layerMeshes[id]) {
            // Already loaded — just make sure it's in scene
            if (!globe.scene().children.includes(layerMeshes[id])) {
                globe.scene().add(layerMeshes[id]);
            }
            return;
        }
        _buildMesh(id);
    }

    function removeLayer(id) {
        if (layerMeshes[id] && globe) {
            globe.scene().remove(layerMeshes[id]);
        }
    }

    function syncAllLayers() {
        if (!globe) return;
        Object.keys(GLOBE_LAYERS).forEach(id => {
            const cb = document.getElementById('earth_layer_' + id);
            if (!cb) return;
            if (cb.checked) {
                addLayer(id);
            } else {
                removeLayer(id);
            }
        });
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
            .pointRadius(d => d.t === 1 ? 0.04 : 0.02)
            .pointColor(d => d.t === 1 ? '#00f0ff' : '#007acc')
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
                    elevation: point.e || 0
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

                // Real-time Day/Night lighting
                if (window.THREE) {
                    const updateSunLight = () => {
                        const now = new Date();
                        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
                        const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
                        const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
                        const solarLng = 180 - utcH * 15;
                        const phi   = (90 - decl) * (Math.PI / 180);
                        const theta = (solarLng + 180) * (Math.PI / 180);
                        const R = 1000;
                        const x = -R * Math.sin(phi) * Math.cos(theta);
                        const z =  R * Math.sin(phi) * Math.sin(theta);
                        const y =  R * Math.cos(phi);

                        const dLight = globe.scene().children.find(o => o.type === 'DirectionalLight');
                        if (dLight) { dLight.position.set(x, y, z); dLight.intensity = 1.2; }
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

        // Globe Quality toggle
        document.getElementsByName('globe_quality').forEach(radio => {
            radio.addEventListener('change', e => {
                const l = document.getElementById('earth-loading');
                if (l) { l.style.display = 'flex'; l.style.opacity = '1'; }
                globe.globeImageUrl(
                    e.target.value === 'high'
                        ? 'assets/earth_8k.jpg'
                        : 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
                );
            });
        });

        // Weather layer checkboxes
        Object.keys(GLOBE_LAYERS).forEach(id => {
            const cb = document.getElementById('earth_layer_' + id);
            if (!cb) return;
            cb.addEventListener('change', () => {
                if (cb.checked) addLayer(id);
                else removeLayer(id);
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

    return { init, show, hide };
})();
