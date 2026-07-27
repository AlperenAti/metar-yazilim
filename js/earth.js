window.EarthView = (function() {
    let globe = null;
    let initialized = false;
    let airportsData = [];
    let cloudMesh = null;

    const init = async () => {
        if (initialized) return;
        
        const container = document.getElementById('earth-container');
        const loader = document.getElementById('earth-loading');
        
        // Initialize Globe
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
                <div style="background: rgba(7, 17, 29, 0.9); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(0, 240, 255, 0.3); font-family: 'Inter', sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                    <div style="color: #fff; font-weight: 600; font-size: 14px; margin-bottom: 4px;">${d.i}</div>
                    <div style="color: #a0aec0; font-size: 12px;">${d.n}</div>
                </div>
            `)
            .onPointClick(point => {
                const mappedPoint = {
                    icao: point.i,
                    name: point.n,
                    lat: point.lat,
                    lon: point.lon
                };
                if (window.MapManager && window.MapManager.onAirportClick) {
                    window.MapManager.onAirportClick(mappedPoint);
                } else if (window.UIManager && window.UIManager.fetchAndPopulateDashboard) {
                    window.UIManager.fetchAndPopulateDashboard(point.i);
                    document.getElementById('view-list-btn').click(); 
                }
            })
            .onGlobeReady(() => {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
                
                // Real-time Day/Night Cycle
                if (window.THREE) {
                    const updateSunLight = () => {
                        const d = new Date();
                        const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
                        const declination = -23.44 * Math.cos((360 / 365) * (dayOfYear + 10) * (Math.PI / 180));
                        const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
                        const subsolarLng = 180 - (utcHours * 15);
                        const subsolarLat = declination;
                        
                        const phi = (90 - subsolarLat) * (Math.PI / 180);
                        const theta = (subsolarLng + 180) * (Math.PI / 180);
                        const r = 1000;
                        
                        const x = -(r * Math.sin(phi) * Math.cos(theta));
                        const z = (r * Math.sin(phi) * Math.sin(theta));
                        const y = (r * Math.cos(phi));
                        
                        const dLight = globe.scene().children.find(obj => obj.type === 'DirectionalLight');
                        if (dLight) {
                            dLight.position.set(x, y, z);
                            dLight.intensity = 1.2;
                        }
                        const aLight = globe.scene().children.find(obj => obj.type === 'AmbientLight');
                        if (aLight) {
                            aLight.intensity = 0.15; // Dark night side
                        }
                    };
                    updateSunLight();
                    setInterval(updateSunLight, 60000); // Update every minute
                }
            });

        // Add custom layer for clouds
        globe.customThreeObject(d => {
            if (d.type !== 'clouds' || !window.THREE) return null;
            if (cloudMesh) return cloudMesh; // Reuse if already created
            
            const globeRadius = globe.getGlobeRadius();
            cloudMesh = new THREE.Mesh(
                new THREE.SphereGeometry(globeRadius * 1.005, 72, 72),
                new THREE.MeshBasicMaterial({ 
                    map: new THREE.TextureLoader().load('https://realearth.ssec.wisc.edu/api/image?products=globalir&width=2048&height=1024'),
                    transparent: true,
                    opacity: 0.6,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );
            
            (function rotateClouds() {
                if(cloudMesh) cloudMesh.rotation.y -= 0.0002;
                requestAnimationFrame(rotateClouds);
            })();
            
            return cloudMesh;
        });

        // Auto-rotate disabled per user request
        globe.controls().autoRotate = false;
        globe.controls().autoRotateSpeed = 0.5;

        // Fetch and filter airports
        try {
            const response = await fetch('data/airports.json');
            const data = await response.json();
            airportsData = data.filter(a => a.t === 1 || a.t === 2);
            globe.pointsData(airportsData);
        } catch (e) {
            console.error("Failed to load airports for Earth view", e);
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            if (document.body.classList.contains('earth-active') && globe) {
                globe.width([container.clientWidth]);
                globe.height([container.clientHeight]);
            }
        });

        // Wire up UI Quality Toggle
        document.getElementsByName('globe_quality').forEach(radio => {
            radio.addEventListener('change', (e) => {
                loader.style.display = 'flex';
                loader.style.opacity = '1';
                if (e.target.value === 'high') {
                    globe.globeImageUrl('assets/earth_8k.jpg');
                } else {
                    globe.globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
                }
            });
        });

        // Wire up Weather Layer Toggle (Clouds)
        document.getElementsByName('weather_layer').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'clouds') {
                    globe.customLayerData([{ type: 'clouds' }]);
                } else {
                    globe.customLayerData([]);
                }
            });
        });

        // Set initial cloud state if already checked in UI
        const cloudRadio = document.querySelector('input[name="weather_layer"][value="clouds"]');
        if (cloudRadio && cloudRadio.checked) {
            globe.customLayerData([{ type: 'clouds' }]);
        } else {
            globe.customLayerData([]); // Ensure it's hidden initially if not checked
        }

        initialized = true;
    };

    const show = () => {
        document.body.classList.add('earth-active');
        document.getElementById('earth-wrapper').classList.remove('hidden');
        document.getElementById('map').style.visibility = 'hidden';
        
        if (!initialized) {
            init();
        } else {
            if (globe) {
                const container = document.getElementById('earth-container');
                globe.width([container.clientWidth]);
                globe.height([container.clientHeight]);
                
                // Sync cloud state when switching back to Earth
                const cloudRadio = document.querySelector('input[name="weather_layer"][value="clouds"]');
                if (cloudRadio && cloudRadio.checked) {
                    globe.customLayerData([{ type: 'clouds' }]);
                } else {
                    globe.customLayerData([]);
                }
            }
        }
    };

    const hide = () => {
        document.body.classList.remove('earth-active');
        document.getElementById('earth-wrapper').classList.add('hidden');
        document.getElementById('map').style.visibility = 'visible';
    };

    return { init, show, hide };
})();
