(function () {
    const canvas = document.getElementById('wind-canvas');
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;

    function clear() {
        ctx.clearRect(0, 0, size, size);
    }

    function drawCompass() {
        ctx.save();
        ctx.strokeStyle = 'rgba(129, 158, 183, .3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(center, center, 101, 0, Math.PI * 2);
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

    function drawRunway(heading) {
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate((heading * Math.PI) / 180);
        ctx.fillStyle = '#526577';
        ctx.fillRect(-11, -76, 22, 152);
        ctx.strokeStyle = '#e7f0f8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(0, -65); ctx.lineTo(0, 65);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#b9cad9';
        ctx.font = '500 10px "DM Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(heading / 10)).padStart(2, '0'), 0, -83);
        ctx.fillText(String(Math.round(((heading + 180) % 360) / 10)).padStart(2, '0'), 0, 91);
        ctx.restore();
    }

    function drawWind(windDirection, windSpeed) {
        if (!Number.isFinite(windDirection)) return;
        const radians = (windDirection * Math.PI) / 180;
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(radians);
        ctx.strokeStyle = '#44ddbd';
        ctx.fillStyle = '#44ddbd';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -109); ctx.lineTo(0, -25);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -18); ctx.lineTo(-7, -32); ctx.lineTo(7, -32); ctx.closePath();
        ctx.fill();
        ctx.translate(0, -124);
        ctx.rotate(-radians);
        ctx.font = '500 11px "DM Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`${String(windDirection).padStart(3, '0')}°  ${windSpeed ?? '—'} kt`, 0, 0);
        ctx.restore();
    }

    function drawRunwayAndWind(runwayHeading, windDirection, windSpeed) {
        clear();
        drawCompass();
        if (Number.isFinite(runwayHeading)) drawRunway(runwayHeading);
        drawWind(windDirection, windSpeed);
    }

    window.Visualizer = { clear, drawRunwayAndWind };
}());
