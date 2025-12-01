// Global time utility functions


async function loadTimeFormat() {
    try {
        const r = await fetch("/api/device-config");
        const d = await r.json();
        use24h = d.time24;
    } catch (e) {
        console.warn("Could not load time format:", e);
    }
}

function getDayWithSuffix(day) {
    if (day >= 11 && day <= 13) return day + "th";
    const lastDigit = day % 10;
    if (lastDigit === 1) return day + "st";
    if (lastDigit === 2) return day + "nd";
    if (lastDigit === 3) return day + "rd";
    return day + "th";
}


function getFormattedTime() {
    const now = new Date();
    
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    let suffix = "";
    
    if (!use24h) {
        suffix = hours >= 12 ? " PM" : " AM";
        hours = hours % 12;
        if (hours === 0) hours = 12;
    }
    
    const hoursStr = use24h ? hours.toString().padStart(2, '0') : hours.toString();
    const timeString = `${hoursStr}:${minutes}${suffix}`;
    
    // Date
    const day = now.getDate();
    const dayWithSuffix = getDayWithSuffix(day);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[now.getMonth()];
    
    const dateString = `${dayWithSuffix} ${monthName}`;
    
    return {
        time: timeString,
        date: dateString,
        hours: hours,
        minutes: minutes,
        suffix: suffix,
        day: day,
        month: monthName,
        raw: now
    };
}

function initLiveClock() {
    function updateClock() {
        const timeData = getFormattedTime();
        
        const timeEl = document.querySelector('.time');
        const dateEl = document.querySelector('.date');
        
        if (timeEl) timeEl.textContent = timeData.time;
        if (dateEl) dateEl.textContent = timeData.date;
    }
    
    // Start clock after time format is loaded
    setTimeout(() => {
        updateClock();
        setInterval(updateClock, 1000);
    }, 100);
}

// Initialize on load
loadTimeFormat();
