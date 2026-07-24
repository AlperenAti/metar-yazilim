// notam.js - NOTAM fetching, filtering, and UI logic

class NotamProvider {
    constructor() {
        this.isConnected = true; 
    }

    async fetchForAirport(icao) {
        if (!this.isConnected) {
            throw new Error("NOTAM_PROVIDER_NOT_CONNECTED");
        }
        
        const params = new URLSearchParams();
        params.append('searchType', '0');
        params.append('locators', icao);
        
        let res;
        try {
            res = await fetch('https://metar-yazilim.onrender.com/api/weather/notam?icao=' + icao);
        } catch (e) {
            throw new Error("Network error or server unreachable");
        }
        
        if (!res || !res.ok) {
            throw new Error(`FAA API did not respond (Code: ${res ? res.status : 'Unknown'})`);
        }
        
        const data = await res.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        const list = data.notamList || data.notams || [];
        
        return list.map(item => {
            const rawText = item.traditionalMessage || item.message || item.rawText || JSON.stringify(item);
            const number = item.notamNumber || item.notamId || item.id || "N/A";
            
            // Format dates if possible
            const validFrom = item.startDate || item.issueDate || new Date().toISOString();
            const validTo = item.endDate || item.validTimeTo || null;
            
            // Auto-categorize based on raw text
            let category = 'other';
            const upperText = rawText.toUpperCase();
            if (upperText.includes('RWY') || upperText.includes('RUNWAY')) category = 'runway';
            else if (upperText.includes('TWY') || upperText.includes('TAXIWAY') || upperText.includes('APRON') || upperText.includes('AD')) category = 'airport';
            else if (upperText.includes('NAV') || upperText.includes('VOR') || upperText.includes('ILS') || upperText.includes('NDB') || upperText.includes('RADAR')) category = 'navaid';
            else if (upperText.includes('FIR') || upperText.includes('AIRSPACE') || upperText.includes('UIR') || upperText.includes('OBST')) category = 'airspace';

            return {
                id: number,
                icao: icao,
                number: number,
                category: category,
                validFrom: validFrom,
                validTo: validTo,
                rawText: rawText,
                summary: "" // Raw text contains the summary usually
            };
        });
    }
}

window.NotamManager = {
    provider: new NotamProvider(),
    currentIcao: null,
    currentNotams: [],
    
    init() {
        const toggle = document.getElementById('notam-critical-only');
        if (toggle) {
            toggle.addEventListener('change', () => this.renderNotams());
        }
    },
    
    async loadForAirport(icao) {
        this.currentIcao = icao;
        const container = document.getElementById('notam-list-container');
        const externalLink = document.getElementById('notam-official-link');
        
        container.innerHTML = '<p class="empty-state">Loading NOTAM data...</p>';
        externalLink.href = `https://notams.aim.faa.gov/notamSearch/search?searchType=0&locators=${icao}`;
        
        try {
            this.currentNotams = await this.provider.fetchForAirport(icao);
            this.renderNotams();
        } catch (err) {
            if (err.message === "NOTAM_PROVIDER_NOT_CONNECTED") {
                container.innerHTML = `
                    <div style="text-align:center; padding: 20px 0;">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" style="margin-bottom:10px;">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        <p class="empty-state" style="color: var(--text); margin-bottom:8px; font-weight:600;">
                            NOTAM Source Disconnected
                        </p>
                        <p class="empty-state" style="font-size: 11px; max-width: 90%; margin: 0 auto; line-height:1.4;">
                            No configured NOTAM provider is available. For now, you can access the latest NOTAMs for ${icao} using the official FAA portal link below.
                        </p>
                    </div>
                `;
            } else {
                container.innerHTML = `<p class="empty-state" style="color: #e74c3c;">Failed to fetch NOTAM data: ${err.message}</p>`;
            }
        }
    },
    
    renderNotams() {
        const container = document.getElementById('notam-list-container');
        const criticalOnly = document.getElementById('notam-critical-only')?.checked;
        
        if (!this.currentNotams || this.currentNotams.length === 0) {
            if (this.provider.isConnected) {
                container.innerHTML = '<p class="empty-state">No active NOTAMs found for this airport.</p>';
            }
            return;
        }
        
        const now = new Date();
        const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        
        // Apply Time Filter & Priority Filter
        const filtered = this.currentNotams.filter(notam => {
            const validFrom = new Date(notam.validFrom);
            const validTo = notam.validTo ? new Date(notam.validTo) : null;
            
            // Time filter: Active now OR starting within 14 days
            const isExpired = validTo && validTo < now;
            const isTooFarFuture = validFrom > twoWeeks;
            
            if (isExpired || isTooFarFuture) return false;
            
            // Priority filter
            if (criticalOnly) {
                const isCritical = ['runway', 'taxiway', 'navaid', 'airspace', 'obstacle'].includes(notam.category) ||
                                   (notam.purpose && (notam.purpose.includes('N') || notam.purpose.includes('B')));
                
                if (!isCritical) return false;
            }
            
            return true;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = `<p class="empty-state">No NOTAMs match the selected filters. Turn off the filter above to view all NOTAMs.</p>`;
            return;
        }
        
        container.innerHTML = filtered.map(notam => this.createNotamHtml(notam)).join('');
    },
    
    createNotamHtml(notam) {
        const badgeClass = notam.category ? `notam-badge ${notam.category}` : 'notam-badge other';
        const categoryName = notam.category || 'Other';
        
        let validFromStr = notam.validFrom;
        let validToStr = notam.validTo || 'UFN (Until Further Notice)';
        
        try {
            // Try to parse FAA's custom date formats like "01/15/2026 12:00"
            const fromDate = new Date(notam.validFrom);
            if (!isNaN(fromDate)) validFromStr = fromDate.toLocaleString();
            
            if (notam.validTo) {
                const toDate = new Date(notam.validTo);
                if (!isNaN(toDate)) validToStr = toDate.toLocaleString();
            }
        } catch(e) {}
        
        return `
            <div class="notam-card">
                <div class="notam-card-header">
                    <span class="${badgeClass}">${categoryName.toUpperCase()}</span>
                    <span class="notam-number">${notam.number}</span>
                </div>
                ${notam.summary ? `<h4 class="notam-summary">${notam.summary}</h4>` : ''}
                <div class="notam-raw-text">${notam.rawText}</div>
                <div class="notam-dates">
                    <span>From: ${validFromStr}</span>
                    <span>To: ${validToStr}</span>
                </div>
            </div>
        `;
    }
};

// Initialize listeners on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.NotamManager.init();
});
