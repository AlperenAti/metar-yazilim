(function() {
    const PHONETIC = {
        'A': 'Alpha', 'B': 'Bravo', 'C': 'Charlie', 'D': 'Delta', 'E': 'Echo', 
        'F': 'Foxtrot', 'G': 'Golf', 'H': 'Hotel', 'I': 'India', 'J': 'Juliett', 
        'K': 'Kilo', 'L': 'Lima', 'M': 'Mike', 'N': 'November', 'O': 'Oscar', 
        'P': 'Papa', 'Q': 'Quebec', 'R': 'Romeo', 'S': 'Sierra', 'T': 'Tango', 
        'U': 'Uniform', 'V': 'Victor', 'W': 'Whiskey', 'X': 'X-ray', 'Y': 'Yankee', 'Z': 'Zulu',
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', 
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'niner'
    };

    function pronounce(text) {
        return String(text).toUpperCase().split('').map(c => PHONETIC[c] || c).join(' ');
    }

    function calculateActiveRunway(airport, windDirection) {
        if (!airport.runways || airport.runways.length === 0) {
            return airport.runwayHeading ? String(Math.round(airport.runwayHeading / 10)).padStart(2, '0') : null;
        }

        let bestRunway = null;
        let bestHeadwind = -999;
        let bestMinDiff = 360;

        airport.runways.forEach(r => {
            const r1 = r[0];
            const r2 = r[1];
            
            if (r1) {
                const hdg1 = window.getRunwayTrueHeading ? Math.round(window.getRunwayTrueHeading(airport.icao, r1)) : parseInt(r1, 10) * 10;
                const diff1 = windDirection !== null && windDirection !== 'VRB' ? Math.abs(windDirection - hdg1) : 0;
                const minDiff1 = Math.min(diff1, 360 - diff1);
                const rad = minDiff1 * Math.PI / 180;
                const headwind1 = (windDirection !== null && windDirection !== 'VRB') ? Math.cos(rad) : 1;

                if (headwind1 > bestHeadwind || (headwind1 === bestHeadwind && minDiff1 < bestMinDiff)) {
                    bestHeadwind = headwind1;
                    bestMinDiff = minDiff1;
                    bestRunway = r1;
                }
            }
            if (r2) {
                const hdg2 = window.getRunwayTrueHeading ? Math.round(window.getRunwayTrueHeading(airport.icao, r2)) : parseInt(r2, 10) * 10;
                const diff2 = windDirection !== null && windDirection !== 'VRB' ? Math.abs(windDirection - hdg2) : 0;
                const minDiff2 = Math.min(diff2, 360 - diff2);
                const rad = minDiff2 * Math.PI / 180;
                const headwind2 = (windDirection !== null && windDirection !== 'VRB') ? Math.cos(rad) : 1;

                if (headwind2 > bestHeadwind || (headwind2 === bestHeadwind && minDiff2 < bestMinDiff)) {
                    bestHeadwind = headwind2;
                    bestMinDiff = minDiff2;
                    bestRunway = r2;
                }
            }
        });

        return bestRunway;
    }

    function parseSkyCondition(raw) {
        if (!raw) return '';
        if (raw.includes('CAVOK')) return 'Ceiling and visibility OK. ';
        
        const matches = [...raw.matchAll(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})(?:CB|TCU)?\b/g)];
        if (matches.length === 0) return 'Sky clear. ';
        
        const translations = {
            'FEW': 'Few clouds',
            'SCT': 'Scattered clouds',
            'BKN': 'Broken clouds',
            'OVC': 'Overcast',
            'VV': 'Vertical visibility'
        };
        
        return matches.map(m => {
            const type = translations[m[1]];
            const alt = parseInt(m[2], 10) * 100;
            return `${type} at ${alt} feet.`;
        }).join(' ') + ' ';
    }

    function parseVisibility(raw) {
        if (raw.includes('CAVOK')) return '';
        
        const visMatch = raw.match(/\b(\d{4}|\d{1,2}(?:\/\d)?SM)\b/);
        if (!visMatch) return '';
        
        const v = visMatch[1];
        if (v.includes('SM')) {
            const sm = v.replace('SM', '');
            if (sm === '1/2') return 'Visibility one half statute miles. ';
            return `Visibility ${pronounce(sm)} statute miles. `;
        } else {
            const meters = parseInt(v, 10);
            if (meters === 9999) return 'Visibility more than ten kilometers. ';
            return `Visibility ${meters} meters. `;
        }
    }

    function generateAtis(airport, metar) {
        if (!metar || !metar.raw) return null;
        
        const now = new Date();
        const seed = (airport.icao.charCodeAt(0) || 0) + (airport.icao.charCodeAt(1) || 0) + (airport.icao.charCodeAt(2) || 0) + (airport.icao.charCodeAt(3) || 0) + now.getUTCHours();
        const infoLetter = String.fromCharCode(65 + (seed % 26)); 
        const infoName = PHONETIC[infoLetter];
        
        // Remove "airport" or "havalimanı" from the name if it exists to prevent double words, though just omitting our hardcoded "airport" is safer.
        let text = `This is ${airport.name} information ${infoName}. `;
        
        // Time
        const timeMatch = metar.raw.match(/\b\d{2}(\d{2})(\d{2})Z\b/);
        if (timeMatch) {
            text += `Time ${pronounce(timeMatch[1])} ${pronounce(timeMatch[2])} Zulu. `;
        }
        
        // Active Runway
        const activeRunway = calculateActiveRunway(airport, metar.windDirection);
        if (activeRunway) {
            text += `Landing and departing runway ${pronounce(activeRunway)}. `;
        }

        // Wind
        if (metar.windDirection === 'VRB') {
            text += `Wind variable at ${pronounce(metar.windSpeed)} knots. `;
        } else if (metar.windDirection !== null && metar.windSpeed !== null) {
            text += `Wind ${pronounce(String(metar.windDirection).padStart(3, '0'))} at ${pronounce(metar.windSpeed)} knots. `;
        }

        // Visibility
        text += parseVisibility(metar.raw);

        // Sky
        text += parseSkyCondition(metar.raw);
        
        // Temperature & Dewpoint
        if (metar.temperature !== null && metar.dewpoint !== null) {
            const t = metar.temperature < 0 ? `minus ${pronounce(Math.abs(metar.temperature))}` : pronounce(metar.temperature);
            const d = metar.dewpoint < 0 ? `minus ${pronounce(Math.abs(metar.dewpoint))}` : pronounce(metar.dewpoint);
            text += `Temperature ${t}, dewpoint ${d}. `;
        }
        
        // Altimeter
        if (metar.altimeter !== null) {
            const altimStr = String(metar.altimeter);
            if (metar.raw.includes(`A${altimStr}`)) {
                text += `Altimeter ${pronounce(altimStr)}. `;
            } else {
                text += `QNH ${pronounce(altimStr)}. `;
            }
        }
        
        text += `Advise on initial contact, you have information ${infoName}.`;
        
        return {
            letter: infoLetter,
            phoneticLetter: infoName,
            text: text,
            runway: activeRunway
        };
    }

    let currentUtterance = null;

    function playAudio(text, onEnd) {
        stopAudio();
        
        if (!window.speechSynthesis) {
            console.error('Speech synthesis not supported');
            return;
        }

        currentUtterance = new SpeechSynthesisUtterance(text);
        currentUtterance.lang = 'en-US'; // Force English pronunciation even if voice is not loaded yet
        
        // Attempt to find a soft English female voice (Zira, Samantha, etc.)
        const voices = window.speechSynthesis.getVoices();
        let voice = voices.find(v => (v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Google US English')) && v.lang.startsWith('en'));
        if (!voice) voice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en-GB'));
        
        if (voice) currentUtterance.voice = voice;
        currentUtterance.rate = 0.95; // Slightly slower for a calmer tone
        currentUtterance.pitch = 1.1; // Slightly higher/softer pitch
        
        currentUtterance.onend = () => {
            currentUtterance = null;
            if (onEnd) onEnd();
        };
        
        window.speechSynthesis.speak(currentUtterance);
    }

    function stopAudio() {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        currentUtterance = null;
    }

    window.AtisGenerator = {
        generateAtis,
        playAudio,
        stopAudio
    };
})();
