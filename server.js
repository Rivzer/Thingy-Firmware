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
        time_zone: "Europe/London",
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

/**
 * Ensures HTTPS certificates exist; generates if missing.
 */
function ensureCertificates() {
    // CERT_DIR is hier al ensured, maar dit is idempotent
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

/**
 * Returns a valid Spotify access token (auto-refresh).
 */
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

// ===== EXPRESS APP SETUP =====
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

console.log("🔍 Device IP:", HOST_IP);

// ===== WIFI FIRST-RUN MIDDLEWARE =====
app.use((req, res, next) => {
    if (isWiFiConfigured) return next();
    if (req.path.startsWith("/wifi-setup")) return next();
    return res.redirect("/wifi-setup");
});

app.get("/wifi-setup", async (req, res) => {
    if (isWiFiConfigured) return res.redirect("/");

    const wifiPayload = `WIFI:T:${WIFI_AP_AUTH_TYPE};S:${WIFI_AP_SSID};P:${WIFI_AP_PASSWORD};;`;
    const qrDataUrl = await QRCode.toDataURL(wifiPayload);

    res.render("wifi-setup", {
        qr: qrDataUrl,
        ssid: WIFI_AP_SSID,
        password: WIFI_AP_PASSWORD
    });
});

// ===== Thingy MIDDLEWARE =====
app.get("/", (req, res) => {
    res.render("index");
});

app.get("/consoledeck", (req, res) => {
    const cfg = loadConsoleDeckConfig();
    res.render("consoledeck", {
        apps: cfg.apps || [],
        selectedAppId: cfg.selectedAppId || null
    });
});

app.get("/spotify", async (req, res) => {
    const view = req.query.view;

    if (view === "nowplaying") {
        return res.render("spotify-nowplaying");
    }
    else if (view === "likedplaylist") {
        const token = await getValidToken();

        if (!token) {
            return res.render("spotify-liked-playlist", {
                tracks: [],
                notLoggedIn: true,
                error: null,
                initialOffset: 0,
                total: 0,
            });
        }

        try {
            const limit = 50;
            const r = await axios.get("https://api.spotify.com/v1/me/tracks", {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit, offset: 0 },
            });

            const items = r.data.items || [];
            const total = r.data.total || items.length;

            return res.render("spotify-liked-playlist", {
                tracks: items,
                notLoggedIn: false,
                error: null,
                initialOffset: limit,
                total,
            });
        } catch (e) {
            console.log("Liked tracks error:", e.response?.data || e.message);

            return res.render("spotify-liked-playlist", {
                tracks: [],
                notLoggedIn: false,
                error: "Kon je liked nummers niet ophalen.",
                initialOffset: 0,
                total: 0,
            });
        }
    }
    else if (view === "recent") {
        const token = await getValidToken();

        if (!token) {
            return res.render("spotify-recent", {
                tracks: [],
                notLoggedIn: true,
                error: null,
                initialBefore: null,
                hasMore: false,
            });
        }

        try {
            const limit = 50;
            const r = await axios.get(
                "https://api.spotify.com/v1/me/player/recently-played",
                {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { limit }
                }
            );

            const items = r.data.items || [];
            const cursors = r.data.cursors || {};

            return res.render("spotify-recent", {
                tracks: items,
                notLoggedIn: false,
                error: null,
                initialBefore: cursors.before || null,
                hasMore: items.length === limit
            });
        } catch (e) {
            console.log("Recently played error:", e.response?.data || e.message);

            return res.render("spotify-recent", {
                tracks: [],
                notLoggedIn: false,
                error: "Kon je recent afgespeelde nummers niet ophalen.",
                initialBefore: null,
                hasMore: false,
            });
        }
    }
    else if (view === "playlists") {
        const token = await getValidToken();

        if (!token) {
            return res.render("spotify-playlists", {
                playlists: [],
                notLoggedIn: true,
                error: null,
                initialOffset: 0,
                total: 0,
            });
        }

        try {
            const limit = 50;
            const r = await axios.get("https://api.spotify.com/v1/me/playlists", {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit, offset: 0 },
            });

            const items = r.data.items || [];
            const total = r.data.total || items.length;

            return res.render("spotify-playlists", {
                playlists: items,
                notLoggedIn: false,
                error: null,
                initialOffset: limit,
                total,
            });
        } catch (e) {
            console.log("Playlists error:", e.response?.data || e.message);

            return res.render("spotify-playlists", {
                playlists: [],
                notLoggedIn: false,
                error: "Kon je playlists niet ophalen.",
                initialOffset: 0,
                total: 0,
            });
        }
    }

    // default dashboard
    res.render("spotify-dashboard");
});

app.get("/weather", (req, res) => {
    res.render("weather");
});

app.get("/clock", (req, res) => {
    res.render("clock");
});

app.get("/pictureframe", (req, res) => {
    res.render("pictureframe");
});

app.get("/settings", (req, res) => {
    res.render("settings");
});

// ===== API: FIRMWARE =====
app.get("/api/firmware", async (req, res) => {
    const info = await checkFirmwareUpdate();
    res.json(info);
});

// ===== API: APP STATE =====
app.get("/api/state", (req, res) => {
    res.json({ loggedIn: fs.existsSync(TOKEN_FILE) });
});

// ===== API: QR LOGIN URL =====
app.get("/api/qr", async (req, res) => {
    const scopes = [
        "user-read-playback-state",
        "user-modify-playback-state",
        "user-read-currently-playing",
        "user-library-read",
        "user-library-modify",
        "user-read-recently-played",
        "playlist-read-private",
        "playlist-read-collaborative"
    ].join(" ");

    const params = querystring.stringify({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: scopes,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params}`;
    const qr = await QRCode.toDataURL(authUrl);

    res.json({ qr, url: authUrl });
});

// ===== API: SPOTIFY GET USER PLAYLISTS =====
app.get("/api/playlists", async (req, res) => {
    const token = await getValidToken();
    if (!token) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const limit = 50;
    const offset = Number(req.query.offset) || 0;

    try {
        const r = await axios.get("https://api.spotify.com/v1/me/playlists", {
            headers: { Authorization: `Bearer ${token}` },
            params: { limit, offset },
        });

        res.json({
            items: r.data.items || [],
            total: r.data.total || 0,
            nextOffset: offset + limit,
            hasMore: (offset + limit) < (r.data.total || 0),
        });
    } catch (e) {
        console.log("Playlists API error:", e.response?.data || e.message);
        res.status(500).json({ error: "Failed to fetch playlists" });
    }
});

// ===== API: SPOTIFY PLAY PLAYLIST =====
app.get("/api/play-playlist", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.status(401).send("Not logged in");

    const id = req.query.playlist;
    if (!id) return res.status(400).send("Missing playlist id");

    try {
        await axios.put(
            "https://api.spotify.com/v1/me/player/play",
            {
                context_uri: `spotify:playlist:${id}`,
            },
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        res.send("OK");
    } catch (err) {
        console.log("Play playlist error:", err.response?.data || err.message);
        res.status(500).send("Error playing playlist");
    }
});

// ===== API: SPOTIFY PLAY TRACK =====
app.get("/api/play-track", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.status(401).send("Not logged in");

    const id = req.query.track;
    if (!id) return res.status(400).send("Missing track id");

    try {
        await axios.put(
            "https://api.spotify.com/v1/me/player/play",
            {
                uris: [`spotify:track:${id}`],
            },
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        res.send("OK");
    } catch (err) {
        console.log("Play track error:", err.response?.data || err.message);
        res.status(500).send("Error playing track");
    }
});

// ===== API: SPOTIFY GET LIKED SONGS =====
app.get("/api/liked", async (req, res) => {
    const token = await getValidToken();
    if (!token) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const limit = 50; // Spotify max
    const offset = Number(req.query.offset) || 0;

    try {
        const r = await axios.get("https://api.spotify.com/v1/me/tracks", {
            headers: { Authorization: `Bearer ${token}` },
            params: { limit, offset },
        });

        res.json({
            items: r.data.items || [],
            total: r.data.total || 0,
            nextOffset: offset + limit,
            hasMore: (offset + limit) < (r.data.total || 0),
        });
    } catch (e) {
        console.log("Liked tracks API error:", e.response?.data || e.message);
        res.status(500).json({ error: "Failed to fetch liked tracks" });
    }
});

// ===== API: SPOTIFY GET RECENTLY PLAYED =====
app.get("/api/recent", async (req, res) => {
    const token = await getValidToken();
    if (!token) {
        return res.status(401).json({ error: "Not logged in" });
    }

    const limit = 50; // Spotify max
    const before = req.query.before || undefined;

    try {
        const r = await axios.get(
            "https://api.spotify.com/v1/me/player/recently-played",
            {
                headers: { Authorization: `Bearer ${token}` },
                params: { limit, before }
            }
        );

        const items = r.data.items || [];
        const cursors = r.data.cursors || {};

        res.json({
            items,
            nextBefore: cursors.before || null,
            hasMore: items.length === limit && !!cursors.before,
        });
    } catch (e) {
        console.log("Recently played API error:", e.response?.data || e.message);
        res.status(500).json({ error: "Failed to fetch recently played tracks" });
    }
});

// ===== API: SPOTIFY CALLBACK =====
app.get("/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send("No code received!");

    const authHeader =
        "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    try {
        const response = await axios.post(
            "https://accounts.spotify.com/api/token",
            querystring.stringify({
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Authorization: authHeader,
                },
            }
        );

        const tokens = {
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in: response.data.expires_in,
            scope: response.data.scope,
            token_type: response.data.token_type,
            created_at: Date.now(),
        };

        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        console.log("✔ Saved new spotify_token.json");

        res.send("<h1>Login OK ✔ You can close this tab</h1>");
    } catch (err) {
        console.log("Callback error:", err.response?.data || err.message);
        res.send("Error");
    }
});

// ===== API: VOLUME CONTROL =====
app.get("/api/volume", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.status(401).send("Not logged in");

    const raw = req.query.percent;
    const percent = Number(raw);

    if (Number.isNaN(percent) || percent < 0 || percent > 100) {
        return res.status(400).send("Invalid volume percent");
    }

    try {
        await axios.put(
            `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(percent)}`,
            null,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        res.send("OK");
    } catch (err) {
        console.log("Volume error:", err.response?.data || err.message);
        res.status(500).send("Error setting volume");
    }
});

// ===== API: PLAYBACK STATUS =====
app.get("/api/playback", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.json({});

    try {
        const r = await axios.get("https://api.spotify.com/v1/me/player", {
            headers: { Authorization: `Bearer ${token}` },
        });

        const data = r.data;
        if (!data) return res.json({});

        // Episode but no item
        if (!data.item && data.currently_playing_type === "episode") {
            return res.json({
                track: "Podcast episode playing",
                artist: "Spotify does not provide episode metadata",
                cover: "",
                duration: 0,
                progress: 0,
                liked: false,
                id: null,
                isPlaying: !!data.is_playing,
                type: "episode",
                volume: typeof data.device?.volume_percent === "number"
                    ? data.device.volume_percent
                    : null,
            });
        }

        if (!data.item) return res.json({});

        // Normal track/episode
        const item = data.item;

        let title = item.name || "";
        let subtitle = "";
        let cover = "";

        if (item.type === "track") {
            subtitle = item.artists.map((a) => a.name).join(", ");
            cover = item.album?.images?.[0]?.url || "";
        } else if (item.type === "episode") {
            subtitle = item.show?.name || "Podcast";
            cover =
                item.images?.[0]?.url ||
                item.show?.images?.[0]?.url ||
                "";
        }

        let liked = false;

        if (item.type === "track") {
            try {
                const resLike = await axios.get(
                    `https://api.spotify.com/v1/me/tracks/contains?ids=${item.id}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                liked = resLike.data[0];
            } catch { }
        }

        res.json({
            track: title,
            artist: subtitle,
            cover,
            duration: item.duration_ms || 0,
            progress: data.progress_ms || 0,
            liked,
            id: item.id,
            isPlaying: !!data.is_playing,
            type: item.type,
            volume: typeof data.device?.volume_percent === "number"
                ? data.device.volume_percent
                : null,
        });

    } catch (e) {
        console.log("Playback error:", e.response?.data || e.message);
        res.json({});
    }
});

// ===== API: PLAYER CONTROLS =====
app.get("/api/playpause", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    try {
        const playback = await axios.get(
            "https://api.spotify.com/v1/me/player",
            { headers: { Authorization: `Bearer ${token}` } }
        );

        if (playback.data?.is_playing) {
            await axios.put(
                "https://api.spotify.com/v1/me/player/pause",
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } else {
            await axios.put(
                "https://api.spotify.com/v1/me/player/play",
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
        }

        res.send("OK");
    } catch (err) {
        console.log("Play/pause error:", err.response?.data || err.message);
        res.send("Error");
    }
});

app.get("/api/next", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    await axios
        .post("https://api.spotify.com/v1/me/player/next", {}, {
            headers: { Authorization: `Bearer ${token}` },
        })
        .catch(() => { });

    res.send("OK");
});

app.get("/api/prev", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    await axios
        .post("https://api.spotify.com/v1/me/player/previous", {}, {
            headers: { Authorization: `Bearer ${token}` },
        })
        .catch(() => { });

    res.send("OK");
});

app.get("/api/seek", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    const position = parseInt(req.query.position, 10);

    await axios
        .put(
            `https://api.spotify.com/v1/me/player/seek?position_ms=${position}`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        )
        .catch(() => { });

    res.send("OK");
});

app.get("/api/like", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    const id = req.query.track;

    await axios
        .put(
            `https://api.spotify.com/v1/me/tracks?ids=${id}`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        )
        .catch(() => { });

    res.send("OK");
});

app.get("/api/unlike", async (req, res) => {
    const token = await getValidToken();
    if (!token) return res.send("Not logged in");

    const id = req.query.track;

    await axios
        .delete(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        .catch(() => { });

    res.send("OK");
});

app.get("/api/device-config", (req, res) => {
    try {
        const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
        res.json({ time24: cfg.time_format_24h !== false }); // default = 24h
    } catch (e) {
        res.json({ time24: true }); // fallback
    }
});

// ===== ADMIN APP SETUP =====
const adminApp = express();

adminApp.set("view engine", "ejs");
adminApp.set("views", path.join(__dirname, "admin_views"));

adminApp.use(express.json());
adminApp.use(express.urlencoded({ extended: true }));
adminApp.use(express.static(path.join(__dirname, "admin_public")));

adminApp.get("/", (req, res) => {
    const cfg = loadConsoleDeckConfig();

    res.render("admin-dashboard", {
        ip: HOST_IP,
        port: PORT,
        wifiConfigured: isWiFiConfigured,
        config: cfg
    });
});

// ===== CONSOLE DECK API (ADMIN) =====

// Volledige config (optioneel, handig voor debug)
adminApp.get("/api/consoledeck", (req, res) => {
    const cfg = loadConsoleDeckConfig();
    res.json(cfg);
});

// Alleen de geselecteerde app (voor later gebruik)
adminApp.get("/api/consoledeck/selected", (req, res) => {
    const cfg = loadConsoleDeckConfig();
    const selected = cfg.apps.find(a => a.id === cfg.selectedAppId) || null;
    res.json({ selectedAppId: cfg.selectedAppId, app: selected });
});

// Nieuwe app toevoegen (gebruik je in admin-dashboard.ejs)
adminApp.post("/api/consoledeck/apps", (req, res) => {
    const { name, pcCommand, icon, color, category, showLabel } = req.body;

    if (!name || !pcCommand) {
        return res.status(400).json({ error: "name en pcCommand zijn verplicht" });
    }

    const cfg = loadConsoleDeckConfig();

    const id = "app_" + Date.now();
    const app = {
        id,
        name,
        pcCommand,
        icon: icon || "",
        color: color || "",
        category: category || "",
        // als showLabel niet is meegestuurd -> standaard true
        showLabel: showLabel === false || showLabel === "false" ? false : true
    };

    cfg.apps.push(app);
    saveConsoleDeckConfig(cfg);

    res.json(app);
});

// App verwijderen (gebruik je bij delete button)
adminApp.delete("/api/consoledeck/apps/:id", (req, res) => {
    const { id } = req.params;

    const cfg = loadConsoleDeckConfig();
    const index = cfg.apps.findIndex(a => a.id === id);

    if (index === -1) {
        return res.status(404).json({ error: "App niet gevonden" });
    }

    const [removed] = cfg.apps.splice(index, 1);

    if (cfg.selectedAppId === id) {
        cfg.selectedAppId = null;
    }

    saveConsoleDeckConfig(cfg);
    res.json({ removed });
});

// App selecteren (wat later gebruikt zal worden om iets te openen)
adminApp.post("/api/consoledeck/select", (req, res) => {
    const { id } = req.body;

    const cfg = loadConsoleDeckConfig();

    // id kan ook null zijn om "niets geselecteerd" te doen
    if (id !== null) {
        const app = cfg.apps.find(a => a.id === id);
        if (!app) {
            return res.status(404).json({ error: "App niet gevonden" });
        }
    }

    cfg.selectedAppId = id;
    saveConsoleDeckConfig(cfg);

    res.json({ selectedAppId: cfg.selectedAppId });
});

adminApp.put("/api/consoledeck/apps/:id", (req, res) => {
    const { id } = req.params;
    const { name, pcCommand, icon, color, category, showLabel } = req.body;

    const cfg = loadConsoleDeckConfig();
    const app = cfg.apps.find(a => a.id === id);

    if (!app) {
        return res.status(404).json({ error: "App niet gevonden" });
    }

    if (name !== undefined) app.name = name;
    if (pcCommand !== undefined) app.pcCommand = pcCommand;
    if (icon !== undefined) app.icon = icon;
    if (color !== undefined) app.color = color;
    if (category !== undefined) app.category = category;
    if (showLabel !== undefined) {
        app.showLabel = (showLabel === true || showLabel === "true");
    }

    saveConsoleDeckConfig(cfg);
    res.json(app);
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