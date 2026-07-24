/*
 * High-performance Global Wind Grid Canvas Layer for Leaflet
 * Fetches GFS data from Open-Meteo and renders it using an offscreen sprite atlas.
 */

(function () {
    const SPRITE_SIZE = 44;               
    const DPR = window.devicePixelRatio || 1;
    
    // Professional aviation styling (monochrome slate/white)
    function speedColor(kt) {
      return '#E2E8F0';
    }
    
    function makeHiDPICanvas(w, h) {
      const c = document.createElement('canvas');
      c.width  = Math.round(w * DPR);
      c.height = Math.round(h * DPR);
      const ctx = c.getContext('2d');
      ctx.scale(DPR, DPR);
      return { canvas: c, ctx };
    }
    
    function buildWindBarbSprite(kt) {
      const { canvas, ctx } = makeHiDPICanvas(SPRITE_SIZE, SPRITE_SIZE);
      const cx = SPRITE_SIZE / 2, cy = SPRITE_SIZE / 2;
      const color = speedColor(kt);
      
      // Shadow for better visibility over map
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.8; // Slightly thicker
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    
      if (kt < 3) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.stroke();
        return { canvas, w: SPRITE_SIZE, h: SPRITE_SIZE };
      }
    
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    
      const shaftLen = 16;
      const tipY = cy - shaftLen;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, tipY);
      ctx.stroke();
    
      let remaining = Math.round(kt / 5) * 5;
      let pos = tipY;              
      const step = 3.4;
      const barbLen = 7.5;
    
      while (remaining >= 50) {                          
        ctx.beginPath();
        ctx.moveTo(cx, pos);
        ctx.lineTo(cx + barbLen, pos + 3.2);
        ctx.lineTo(cx, pos + 6.4);
        ctx.closePath();
        ctx.fill();
        pos += 7.2;
        remaining -= 50;
      }
      while (remaining >= 10) {                          
        ctx.beginPath();
        ctx.moveTo(cx, pos);
        ctx.lineTo(cx + barbLen, pos + 3.2);
        ctx.stroke();
        pos += step;
        remaining -= 10;
      }
      if (remaining >= 5) {                               
        ctx.beginPath();
        ctx.moveTo(cx, pos);
        ctx.lineTo(cx + barbLen * 0.5, pos + 1.6);
        ctx.stroke();
      }
    
      return { canvas, w: SPRITE_SIZE, h: SPRITE_SIZE };
    }
    
    const spriteCache = new Map();        
    function getSprite(kt) {
      const bucket = Math.min(150, Math.round(kt / 5) * 5);
      if (!spriteCache.has(bucket)) spriteCache.set(bucket, buildWindBarbSprite(bucket));
      return spriteCache.get(bucket);
    }
    
    L.WindGridLayer = L.Layer.extend({
      initialize(options) {
        L.setOptions(this, options);
        this._data = [];
        this._currentGeneration = 0;
        this._abortController = null;
      },
    
      onAdd(map) {
        this._map = map;
        const size = map.getSize();
        const hd = makeHiDPICanvas(size.x, size.y);
        this._canvas = hd.canvas;
        this._ctx = hd.ctx;
        this._canvas.style.position = 'absolute';
        this._canvas.style.width = size.x + 'px';
        this._canvas.style.height = size.y + 'px';
        this._canvas.style.pointerEvents = 'none'; 
        this._canvas.style.zIndex = 400; // Above base layers, below markers
        map.getPanes().overlayPane.appendChild(this._canvas);
    
        this._scheduleUpdate = () => {
            if (this._timeout) clearTimeout(this._timeout);
            this._timeout = setTimeout(() => this._fetchGrid(), 500);
        };

        this._onMoveEnd = () => {
            this._resetCanvasPos();
            this._scheduleUpdate();
        };
        this._onMove = this._throttledMove.bind(this);
        this._onResize = this._onResizeHandler.bind(this);
    
        this._onZoomStart = () => {
            // Hide smoothly during zoom animation to prevent visual glitches
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        };
        
        map.on('zoomstart', this._onZoomStart);
        map.on('moveend', this._onMoveEnd);
        map.on('move', this._onMove);
        map.on('resize', this._onResize);
    
        this._resetCanvasPos();
        this._scheduleUpdate();
      },
    
      onRemove(map) {
        L.DomUtil.remove(this._canvas);
        map.off('zoomstart', this._onZoomStart);
        map.off('moveend', this._onMoveEnd);
        map.off('move', this._onMove);
        map.off('resize', this._onResize);
        
        if (this._timeout) clearTimeout(this._timeout);
        if (this._abortController) this._abortController.abort();
      },
    
      _onResizeHandler(e) {
        const hd = makeHiDPICanvas(e.newSize.x, e.newSize.y);
        this._canvas.width = hd.canvas.width;
        this._canvas.height = hd.canvas.height;
        this._canvas.style.width = e.newSize.x + 'px';
        this._canvas.style.height = e.newSize.y + 'px';
        this._ctx = this._canvas.getContext('2d');
        this._ctx.scale(DPR, DPR);
        this._resetCanvasPos();
        this._redraw();
      },
    
      _throttledMove() {
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => { 
            this._rafPending = false; 
            this._resetCanvasPos(); 
            this._redraw();
        });
      },
    
      _resetCanvasPos() {
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
      },
    
      async _fetchGrid() {
        const generation = ++this._currentGeneration;
        
        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        const signal = this._abortController.signal;
        
        const bounds = this._map.getBounds();
        const zoom = this._map.getZoom();
        
        // STRICT CAP: 9 steps means 9x9 = 81 points. 
        // This guarantees EXACTLY 1 request to Open-Meteo per map move (Max is 100 points/req).
        // Prevents burst rate-limiting (429 errors) which caused barbs to disappear.
        const steps = 9; 
        
        const latDelta = bounds.getNorth() - bounds.getSouth();
        const lonDelta = bounds.getEast() - bounds.getWest();
        const latStep = latDelta / steps;
        const lonStep = lonDelta / steps;
        
        const pointsMap = new Map();
        const startLat = Math.floor(bounds.getSouth() / latStep) * latStep;
        const startLon = Math.floor(bounds.getWest() / lonStep) * lonStep;
        
        // Build coordinate grid
        for (let lat = startLat; lat <= bounds.getNorth() + latStep; lat += latStep) {
            for (let lon = startLon; lon <= bounds.getEast() + lonStep; lon += lonStep) {
                if (lat > 90 || lat < -90) continue;
                
                let qLon = lon % 360;
                if (qLon > 180) qLon -= 360;
                if (qLon < -180) qLon += 360;
                
                const qLatStr = lat.toFixed(2);
                const qLonStr = qLon.toFixed(2);
                const key = `${qLatStr},${qLonStr}`;
                
                if (!pointsMap.has(key)) {
                    pointsMap.set(key, { qLat: qLatStr, qLon: qLonStr, mapLat: lat, mapLon: lon });
                }
            }
        }
        
        const uniquePoints = Array.from(pointsMap.values());
        if (uniquePoints.length === 0) return;
        
        // Chunk API requests
        const chunkSize = 90;
        const chunks = [];
        for (let i = 0; i < uniquePoints.length; i += chunkSize) {
            chunks.push(uniquePoints.slice(i, i + chunkSize));
        }
        
        const newData = [];
        
        try {
            for (const chunk of chunks) {
                if (generation !== this._currentGeneration) return;
                
                const lats = chunk.map(p => p.qLat).join(',');
                const lons = chunk.map(p => p.qLon).join(',');
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`;
                
                const res = await fetch(url, { signal });
                if (!res.ok) continue;
                const data = await res.json();
                const results = Array.isArray(data) ? data : [data];
                
                results.forEach((point, i) => {
                    const reqPoint = chunk[i];
                    if (point && point.current && typeof point.current.wind_direction_10m === 'number') {
                        newData.push({
                            lat: reqPoint.mapLat,
                            lng: reqPoint.mapLon,
                            dir: point.current.wind_direction_10m,
                            speed: point.current.wind_speed_10m
                        });
                    }
                });
            }
            
            // Only update data if the fetch was actually successful!
            // If it failed, we keep the old data instead of going blank.
            if (generation === this._currentGeneration && newData.length > 0) {
                this._data = newData;
                this._redraw();
            }
        } catch (e) {
            if (e.name !== 'AbortError') console.warn("Open-Meteo error:", e);
        }
      },
    
      _redraw() {
        const map = this._map;
        if (!map) return;
        const ctx = this._ctx;
        const size = map.getSize();
        ctx.clearRect(0, 0, size.x, size.y);
    
        for (let i = 0; i < this._data.length; i++) {
          const s = this._data[i];
          const pt = map.latLngToContainerPoint([s.lat, s.lng]);
          
          // Don't draw if it's completely off-screen
          if (pt.x < -50 || pt.x > size.x + 50 || pt.y < -50 || pt.y > size.y + 50) continue;
          
          const sprite = getSprite(s.speed);
    
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate(s.dir * Math.PI / 180);  
          ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
          ctx.restore();
        }
      }
    });
    
    window.WindGridLayer = L.WindGridLayer;
}());
