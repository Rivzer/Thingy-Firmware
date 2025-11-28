// ===== DEPENDENCIES & SETUP =====
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const fs = require("fs");
const https = require("https");
const path = require("path");
const selfsigned = require("selfsigned");
const QRCode = require("qrcode");
const os = require("os");

// ===== PATHS & CONSTANTS =====
const APP_ROOT = __dirname;
const TOKEN_FILE = path.join(APP_ROOT, "spotify_token.json");
const DEVICE_CONFIG_FILE = path.join(APP_ROOT, "device_config.json");
const CERT_DIR = path.join(APP_ROOT, "keys");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
const FIRMWARE_FILE = path.join(APP_ROOT, "firmware.json");
let currentFirmware = { version: "0.0.0", url: "https://raw.githubusercontent.com/Rivzer/Thingy-Firmware/main/firmware.json" };

// Spotify environment config
const HOST_IP = getLocalIP();
const PORT = process.env.PORT || 8888;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_SECRET_CLIENT_ID;
const REDIRECT_URI = `https://${HOST_IP}:${PORT}/callback`;

// ===== DEVICE CONFIG (FIRST RUN LOGIC) =====
let deviceConfig = {
    wifiConfigured: false,
};

if (fs.existsSync(DEVICE_CONFIG_FILE)) {
    try {
        deviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
    } catch {
        console.log("⚠️ Could not read device_config.json, using defaults.");
    }
}
else if (!fs.existsSync(DEVICE_CONFIG_FILE)) {
    deviceConfig = {
        wifiConfigured: false,
        ap: {
            ssid: "",
            password: ""
        },
        time_zone: "Europe/London"
    };

    fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(deviceConfig, null, 2));
}

if (fs.existsSync(FIRMWARE_FILE)) {
    try {
        currentFirmware = JSON.parse(fs.readFileSync(FIRMWARE_FILE, "utf8"));
    } catch {
        console.log("⚠️ Could not read firmware.json, using fallback version 0.0.0");
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
    try {
        const response = await axios.get(currentFirmware.url, { timeout: 5000 });
        const manifest = response.data;

        const latest = manifest.latest;
        const downloadUrl = manifest.url;

        const cmp = compareVersions(latest, currentFirmware.version);

        return {
            current: currentFirmware.version,
            latest,
            downloadUrl,
            updateAvailable: cmp === 1,
        };
    } catch (err) {
        console.log("Firmware check failed:", err.message);
        return {
            current: currentFirmware.version,
            latest: null,
            downloadUrl: null,
            updateAvailable: false,
            error: true,
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
    res.render("consoledeck");
});

app.get("/spotify", (req, res) => {
    res.render("spotify");
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
