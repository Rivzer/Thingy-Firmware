// ===== DEPENDENCIES & SETUP =====
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const selfsigned = require("selfsigned");
const QRCode = require("qrcode");
const os = require("os");
const { exec } = require("child_process");
const dns = require("dns");

// ===== PATHS & CONSTANTS =====
const APP_ROOT = __dirname;
const CERT_DIR = path.join(APP_ROOT, "keys");
const DATA_DIR = path.join(APP_ROOT, "data");

const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");

const FIRMWARE_FILE = path.join(DATA_DIR, "firmware.json");
const TOKEN_FILE = path.join(DATA_DIR, "spotify_token.json");
const DEVICE_CONFIG_FILE = path.join(DATA_DIR, "device_config.json");
const CONSOLE_DECK_FILE = path.join(DATA_DIR, "console_deck.json");

let currentFirmware = null;
let firmwareError = null;

// Spotify environment config
const HOST_IP = getLocalIP();
const PORT = process.env.PORT || 8888;
const ADMIN_PORT = process.env.ADMIN_PORT || 8889;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_SECRET_CLIENT_ID;
const REDIRECT_URI = `https://${HOST_IP}:${PORT}/callback`;

// ===== GENERIC DIR HELPERS =====
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
// Zorg dat basis mappen altijd bestaan
ensureDir(CERT_DIR);
ensureDir(DATA_DIR);

function loadConsoleDeckConfig() {
    ensureDir(DATA_DIR);

    if (!fs.existsSync(CONSOLE_DECK_FILE)) {
        const defaultConfig = {
            apps: [],
            selectedAppId: null
        };
        fs.writeFileSync(CONSOLE_DECK_FILE, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }

    try {
        const raw = fs.readFileSync(CONSOLE_DECK_FILE, "utf8");
        return JSON.parse(raw);
    } catch (e) {
        console.error("❌ Error reading console_deck.json:", e.message);
        return { apps: [], selectedAppId: null };
    }
}

function saveConsoleDeckConfig(cfg) {
    ensureDir(DATA_DIR);
    fs.writeFileSync(CONSOLE_DECK_FILE, JSON.stringify(cfg, null, 2));
}

// ===== DEVICE CONFIG (FIRST RUN LOGIC) =====
let deviceConfig = {
    wifiConfigured: false,
};

if (fs.existsSync(DEVICE_CONFIG_FILE)) {
    try {
        deviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
        console.log("✔ device_config.json loaded:");
    } catch {
        console.log("⚠️ Could not read device_config.json, using defaults.");
    }
} else {
    deviceConfig = {
        wifiConfigured: false,
        ap: {
            ssid: "",
            password: ""
        },
        device_name: "Raspberry Pi Zero 2W",
        time_format_24h: true
    };

    console.log("✔ device_config.json created:");
    fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(deviceConfig, null, 2));
    deviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
    console.log("✔ device_config.json loaded:");
}

// ===== FIRMWARE LOADING =====
if (!fs.existsSync(FIRMWARE_FILE)) {
    firmwareError = "firmware.json not found";
    console.error("❌", firmwareError);
} else {
    try {
        const raw = fs.readFileSync(FIRMWARE_FILE, "utf8");
        const parsed = JSON.parse(raw);

        if (!parsed.version) {
            firmwareError = "firmware.json missing required field: version";
        } else if (!parsed.url) {
            firmwareError = "firmware.json missing required field: url";
        } else {
            currentFirmware = parsed;
        }
    } catch (e) {
        firmwareError = "Invalid firmware.json: " + e.message;
    }

    if (firmwareError) {
        console.error("❌", firmwareError);
    } else {
        console.log("✔ firmware.json loaded:");
    }
}

let isWiFiConfigured = deviceConfig.wifiConfigured;
const WIFI_AP_SSID = deviceConfig.ap.ssid;
const WIFI_AP_PASSWORD = deviceConfig.ap.password;
const WIFI_AP_AUTH_TYPE = WIFI_AP_PASSWORD ? "WPA" : "nopass";

// ===== HELPER FUNCTIONS =====
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.internal) continue;
            if (iface.family === "IPv4") return iface.address;
        }
    }
    return "127.0.0.1";
}

function hasInternet() {
    return new Promise((resolve) => {
        dns.lookup("google.com", (err) => {
            if (err) {
                console.log("❌ Geen internet:", err.code || err.message);
                return resolve(false);
            }
            resolve(true);
        });
    });
}

async function autoDetectLocationFromIP() {
    try {
        const res = await axios.get("https://ipapi.co/json/", { timeout: 5000 });
        const data = res.data;
        if (!data) {
            console.log("⚠️ Geen data van IP geolocation");
            return;
        }

        const {
            city,
            country_name,
            country_code,
            latitude,
            longitude,
            timezone
        } = data;

        if (!latitude || !longitude) {
            console.log("⚠️ Geen lat/lon in geolocatie");
            return;
        }

        let cfg = {};
        try {
            cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
        } catch {
            cfg = {};
        }

        cfg.location = {
            city: city || "Unknown",
            country: country_code || country_name || "",
            lat: latitude,
            lon: longitude,
            source: "ip-auto"
        };

        if (timezone) {
            cfg.time_zone = timezone;
        } else if (!cfg.time_zone) {
            cfg.time_zone = "Europe/Brussels";
        }

        fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(cfg, null, 2));
        console.log("📍 Auto location updated from IP:", cfg.location, "tz:", cfg.time_zone);

        deviceConfig = cfg;
    } catch (err) {
        console.error("❌ Failed to auto-detect location from IP:", err.message || err);
    }
}

function mapWeatherCode(code) {
    if (code === 0) return { condition: "Clear sky", icon: "☀️" };
    if ([1, 2, 3].includes(code)) return { condition: "Partly cloudy", icon: "⛅" };
    if ([45, 48].includes(code)) return { condition: "Fog", icon: "🌫️" };
    if ([51, 53, 55].includes(code)) return { condition: "Drizzle", icon: "🌦️" };
    if ([61, 63, 65].includes(code)) return { condition: "Rain", icon: "🌧️" };
    if ([71, 73, 75].includes(code)) return { condition: "Snow", icon: "❄️" };
    if ([80, 81, 82].includes(code)) return { condition: "Showers", icon: "🌧️" };
    if ([95, 96, 99].includes(code)) return { condition: "Thunderstorm", icon: "⛈️" };

    return { condition: "Unknown", icon: "❔" };
}

function getLocationFromConfig(cfg) {
    if (cfg && cfg.location && typeof cfg.location.lat === "number" && typeof cfg.location.lon === "number") {
        return cfg.location;
    }

    return {
        city: "Brussels",
        country: "BE",
        lat: 50.8466,
        lon: 4.3528,
        source: "fallback"
    };
}

function ensureCertificates() {
    if (!fs.existsSync(CERT_DIR)) {
        fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
        console.log("🔐 Generating new self-signed certificate...");

        const attrs = [{ name: "commonName", value: HOST_IP }];
        const pems = selfsigned.generate(attrs, {
            days: 365,
            keySize: 2048,
            algorithm: "sha256",
        });

        fs.writeFileSync(CERT_PATH, pems.cert);
        fs.writeFileSync(KEY_PATH, pems.private);

        console.log("✔️ Certificate generated");
    } else {
        console.log("🔐 Using existing certificate files");
    }
}

async function getValidToken() {
    if (!fs.existsSync(TOKEN_FILE)) {
        return null;
    }

    let tokens = JSON.parse(fs.readFileSync(TOKEN_FILE));

    if (!tokens.created_at || !tokens.expires_in || !tokens.refresh_token) {
        console.log("getValidToken: old token format detected.");
        return tokens.access_token;
    }

    const expiresAt = tokens.created_at + tokens.expires_in * 1000;

    if (Date.now() < expiresAt - 5000) return tokens.access_token;

    console.log("🔄 Access token expired — refreshing...");

    try {
        const response = await axios.post(
            "https://accounts.spotify.com/api/token",
            querystring.stringify({
                grant_type: "refresh_token",
                refresh_token: tokens.refresh_token,
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Authorization:
                        "Basic " +
                        Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
                },
            }
        );

        tokens.access_token = response.data.access_token;
        tokens.expires_in = response.data.expires_in;
        tokens.created_at = Date.now();

        if (response.data.refresh_token) {
            tokens.refresh_token = response.data.refresh_token;
        }

        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        console.log("✔️ Token refreshed!");

        return tokens.access_token;
    } catch (err) {
        console.error("❌ Failed to refresh token:", err.response?.data || err.message);
        return null;
    }
}

function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

async function checkFirmwareUpdate() {
    if (firmwareError || !currentFirmware) {
        return {
            error: true,
            message: firmwareError || "Firmware not loaded",
            current: null,
            latest: null,
            updateAvailable: false,
        };
    }

    try {
        const response = await axios.get(currentFirmware.url, { timeout: 5000 });
        const manifest = response.data;

        if (!manifest.version) {
            return {
                error: true,
                message: "Remote firmware manifest missing 'version'",
                current: currentFirmware.version,
                latest: null,
                updateAvailable: false,
            };
        }

        const latest = manifest.version;
        const cmp = compareVersions(latest, currentFirmware.version);

        return {
            error: false,
            message: null,
            current: currentFirmware.version,
            latest,
            updateAvailable: cmp === 1,
        };
    } catch (err) {
        console.log("Firmware check failed:", err.message);
        return {
            error: true,
            message: "Remote check failed: " + err.message,
            current: currentFirmware.version,
            latest: null,
            updateAvailable: false,
        };
    }
}

// ==== AUTO SETUP =====
(async () => {
    if (!deviceConfig.location || !deviceConfig.location.lat || !deviceConfig.location.lon) {
        console.log("🌍 No location in config yet, trying auto-detect via IP...");
        await autoDetectLocationFromIP();
    } else {
        console.log("📍 Using existing location from config:", deviceConfig.location);
    }
})();

// ===== EXPRESS APP SETUP =====
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

console.log("🔍 Device IP:", HOST_IP);

// ===== WIFI FIRST-RUN MIDDLEWARE =====
// app.use((req, res, next) => {
//     if (isWiFiConfigured) return next();

//     if (
//         req.path.startsWith("/wifi-setup") ||
//         req.path.startsWith("/api/setupwifi-qr") ||
//         req.path.startsWith("/api/save-wifi")
//     ) {
//         return next();
//     }

//     return res.redirect("/wifi-setup");
// });

// ===== ROUTES =====
require("./routes/wifi-routes").registerWifiRoutes(app, {
    isWiFiConfigured,
    WIFI_AP_AUTH_TYPE,
    WIFI_AP_SSID,
    WIFI_AP_PASSWORD,
    QRCode
});

require("./routes/core-routes").registerCoreRoutes(app, {
    loadConsoleDeckConfig
});

require("./routes/spotify-routes").registerSpotifyRoutes(app, {
    getValidToken,
    axios
});

require("./routes/settings-routes").registerSettingsRoutes(app, {
    fs,
    DEVICE_CONFIG_FILE,
    hasInternet,
    HOST_IP,
    currentFirmware
});

// ===== API =====
require("./routes/api-routes").registerApiRoutes(app, {
    checkFirmwareUpdate,
    TOKEN_FILE,
    CONSOLE_DECK_FILE,
    DEVICE_CONFIG_FILE,
    QRCode,
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    getValidToken,
    axios,
    querystring,
    fs,
    loadConsoleDeckConfig,
    exec,
    getLocationFromConfig,
    mapWeatherCode,
    autoDetectLocationFromIP,
    HOST_IP
});

// ===== ADMIN APP SETUP =====
const createAdminApp = require("./admin-app");
const adminApp = createAdminApp({
    HOST_IP,
    PORT,
    isWiFiConfigured,
    loadConsoleDeckConfig,
    saveConsoleDeckConfig,
    DEVICE_CONFIG_FILE
});

// ===== START HTTPS SERVER =====
ensureCertificates();

https
    .createServer(
        {
            key: fs.readFileSync(KEY_PATH),
            cert: fs.readFileSync(CERT_PATH),
        },
        app
    )
    .listen(PORT, () => {
        console.log(`🔒 HTTPS Server running at https://${HOST_IP}:${PORT}`);
    });

// ===== START HTTP SERVER (ADMIN UI) =====
http
    .createServer(adminApp)
    .listen(ADMIN_PORT, () => {
        console.log(`🛠 Admin server running at http://${HOST_IP}:${ADMIN_PORT}`);
    });