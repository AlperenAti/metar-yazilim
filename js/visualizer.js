(function () {
    function drawCompass(ctx, center, size) {
        ctx.save();
        ctx.strokeStyle = 'rgba(129, 158, 183, .3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(center, center, center - 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.moveTo(center, 22); ctx.lineTo(center, size - 22);
        ctx.moveTo(22, center); ctx.lineTo(size - 22, center);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#8294a8';
        ctx.font = '500 11px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', center, 16);
        ctx.fillText('S', center, size - 16);
        ctx.fillText('E', size - 16, center);
        ctx.fillText('W', 16, center);
        ctx.restore();
    }

    function drawRunway(ctx, center, heading) {
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate((heading * Math.PI) / 180);
        
        const rwWidth = 36;
        const rwHeight = 180;

        ctx.fillStyle = '#3a4454';
        ctx.fillRect(-rwWidth / 2, -rwHeight / 2, rwWidth, rwHeight);
        ctx.strokeStyle = '#2b3441';
        ctx.lineWidth = 2;
        ctx.strokeRect(-rwWidth / 2, -rwHeight / 2, rwWidth, rwHeight);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([12, 14]);
        ctx.beginPath();
        ctx.moveTo(0, -rwHeight / 2 + 75);
        ctx.lineTo(0, rwHeight / 2 - 75);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#ffffff';

        function drawEnd(yOffset, num, isTop) {
            ctx.save();
            ctx.translate(0, yOffset);
            if (isTop) ctx.rotate(Math.PI);
            
            const keyWidth = 2.5;
            const keyHeight = 12;
            const keySpacing = 4.5;
            const numKeys = 3;
            for (let i = 0; i < numKeys; i++) {
                ctx.fillRect(4 + i * keySpacing, -keyHeight - 2, keyWidth, keyHeight);
                ctx.fillRect(-4 - keyWidth - i * keySpacing, -keyHeight - 2, keyWidth, keyHeight);
            }
            
            ctx.fillRect(6, -keyHeight - 52, 6, 22);
            ctx.fillRect(-12, -keyHeight - 52, 6, 22);

            ctx.font = '900 16px "Arial", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.save();
            ctx.scale(1, 1.5);
            ctx.fillText(num, 0, (-keyHeight - 24) / 1.5);
            ctx.restore();
            ctx.restore();
        }

        const numPrimary = String(Math.round(heading / 10) || 36).padStart(2, '0');
        drawEnd(rwHeight / 2, numPrimary, false);
        const numSecondary = String(Math.round(((heading + 180) % 360) / 10) || 36).padStart(2, '0');
        drawEnd(-rwHeight / 2, numSecondary, true);
        ctx.restore();
    }

    function drawWind(ctx, center, windDirection, windSpeed) {
        if (!Number.isFinite(windDirection)) return;
        const radians = (windDirection * Math.PI) / 180;
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(radians);
        ctx.strokeStyle = '#44ddbd';
        ctx.fillStyle = '#44ddbd';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -center + 21); ctx.lineTo(0, -25);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -18); ctx.lineTo(-7, -32); ctx.lineTo(7, -32); ctx.closePath();
        ctx.fill();
        ctx.translate(0, -center + 6);
        ctx.rotate(-radians);
        ctx.font = '500 11px "DM Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`${String(windDirection).padStart(3, '0')}°  ${windSpeed ?? '—'} kt`, 0, 0);
        ctx.restore();
    }

    function drawRunwayAndWind(runwayHeading, windDirection, windSpeed, canvasId = 'wind-canvas') {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        // Reset scale if needed for high DPI
        const dpr = window.devicePixelRatio || 1;
        const size = canvas.width / (canvasId === 'dash-wind-canvas' ? dpr : 1); 
        // Note: the original 'wind-canvas' doesn't use dpr scaling in its width directly, it's fixed.
        // We handle that in the caller for dash. Let's just use CSS size.
        const rect = canvas.getBoundingClientRect();
        const displaySize = Math.max(rect.width, size);
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Normalizing size for drawing logic
        const drawSize = canvasId === 'dash-wind-canvas' ? canvas.width / dpr : canvas.width;
        const center = drawSize / 2;

        drawCompass(ctx, center, drawSize);
        if (Number.isFinite(runwayHeading)) drawRunway(ctx, center, runwayHeading);
        drawWind(ctx, center, windDirection, windSpeed);
    }
    
    function clear(canvasId = 'wind-canvas') {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    window.Visualizer = { clear, drawRunwayAndWind };
}());
