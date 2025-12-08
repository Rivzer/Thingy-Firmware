let use24h = true;

async function loadTimeFormat() {
    try {
        const r = await fetch("/api/device-config");
        const d = await r.json();

        if (typeof d.time_format_24h === "boolean") {
            use24h = d.time_format_24h;
        }

        console.log("Time format loaded:", use24h);

    } catch (e) {
        console.warn("Could not load time format:", e);
        use24h = true;
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

    const day = now.getDate();
    const dayWithSuffix = getDayWithSuffix(day);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthName = monthNames[now.getMonth()];

    return {
        time: timeString,
        date: `${dayWithSuffix} ${monthName}`
    };
}

function initLiveClock() {
    function updateClock() {
        const t = getFormattedTime();
        document.querySelector('.time').textContent = t.time;
        document.querySelector('.date').textContent = t.date;
    }

    setTimeout(() => {
        updateClock();
        setInterval(updateClock, 1000);
    }, 100);
}

loadTimeFormat();
