window.EarthView = (function() {
    let globe = null;
    let initialized = false;
    let airportsData = [];

    const init = async () => {
        if (initialized) return;
        
        const container = document.getElementById('earth-container');
        const loader = document.getElementById('earth-loading');
        
        // Initialize Globe
        globe = Globe()(container)
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-dark.jpg')
            .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
            .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
            .pointLat(d => parseFloat(d.latitude_deg))
            .pointLng(d => parseFloat(d.longitude_deg))
            .pointAltitude(0.01)
            .pointRadius(0.15)
            .pointColor(d => d.type === 'large_airport' ? '#00f0ff' : '#007acc')
            .pointResolution(32)
            .pointLabel(d => `
                <div style="background: rgba(7, 17, 29, 0.9); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(0, 240, 255, 0.3); font-family: 'Inter', sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                    <div style="color: #fff; font-weight: 600; font-size: 14px; margin-bottom: 4px;">${d.ident}</div>
                    <div style="color: #a0aec0; font-size: 12px;">${d.name}</div>
                </div>
            `)
            .onPointClick(point => {
                if (window.MapManager && window.MapManager.onAirportClick) {
                    window.MapManager.onAirportClick(point);
                } else if (window.UIManager && window.UIManager.fetchAndPopulateDashboard) {
                    window.UIManager.fetchAndPopulateDashboard(point.ident);
                    document.getElementById('view-list-btn').click(); 
                }
            })
            .onGlobeReady(() => {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
            });

        // Auto-rotate
        globe.controls().autoRotate = true;
        globe.controls().autoRotateSpeed = 0.5;

        // Fetch and filter airports
        try {
            const response = await fetch('data/airports.json');
            const data = await response.json();
            
            // Filter to only large and medium airports to maintain 60fps and ensure METAR availability
            airportsData = data.filter(a => a.type === 'large_airport' || a.type === 'medium_airport');
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

        initialized = true;
    };

    const show = () => {
        document.body.classList.add('earth-active');
        document.getElementById('earth-wrapper').classList.remove('hidden');
        
        // Hide map specifically
        document.getElementById('map').style.visibility = 'hidden';
        
        if (!initialized) {
            init();
        } else {
            if (globe) {
                const container = document.getElementById('earth-container');
                globe.width([container.clientWidth]);
                globe.height([container.clientHeight]);
            }
        }
    };

    const hide = () => {
        document.body.classList.remove('earth-active');
        document.getElementById('earth-wrapper').classList.add('hidden');
        document.getElementById('map').style.visibility = 'visible';
    };

    return {
        init,
        show,
        hide
    };
})();
