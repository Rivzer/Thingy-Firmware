// routes/api-routes.js
const express = require("express");

function registerApiRoutes(app, deps) {
    const {
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
        autoDetectLocationFromIP
    } = deps;

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
                { context_uri: `spotify:playlist:${id}` },
                { headers: { Authorization: `Bearer ${token}` } }
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
                { uris: [`spotify:track:${id}`] },
                { headers: { Authorization: `Bearer ${token}` } }
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

        const limit = 50;
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

        const limit = 50;
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

    // ===== API: DEVICE CONFIG =====
    app.get("/api/device-config", async (req, res) => {
        try {
            const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
            res.json({
                time_format_24h: cfg.time_format_24h !== false,
                time_zone: cfg.time_zone || "Europe/Brussels",
                device_name: cfg.device_name || "Raspberry Pi Zero 2W",
                location: cfg.location || null
            });
        } catch (e) {
            res.json({
                time_format_24h: true,
                time_zone: "Europe/Brussels",
                device_name: "Raspberry Pi Zero 2W",
                location: null
            });
        }
    });

    // ===== API: CONSOLE DECK – PROGRAMMA STARTEN OP DE PI =====
    app.post("/api/consoledeck/run", (req, res) => {
        const { id } = req.body || {};

        const cfg = loadConsoleDeckConfig();

        // Als geen id meegegeven: gebruik geselecteerde app
        const appIdToRun = id || cfg.selectedAppId;

        if (!appIdToRun) {
            return res.status(400).json({ error: "Geen app-id opgegeven en geen geselecteerde app." });
        }

        const appEntry = cfg.apps.find(a => a.id === appIdToRun);
        if (!appEntry) {
            return res.status(404).json({ error: "App niet gevonden" });
        }

        if (!appEntry.pcCommand) {
            return res.status(400).json({ error: "Geen pcCommand ingesteld voor deze app" });
        }

        const command = appEntry.pcCommand;

        console.log(`▶ ConsoleDeck: start command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("❌ Fout bij uitvoeren:", error.message);
                console.error("STDERR:", stderr);
                return res.status(500).json({ error: "Uitvoeren mislukt", detail: error.message });
            }

            console.log("✔ Programma uitgevoerd. STDOUT:", stdout);
            res.json({ ok: true, command, stdout });
        });
    });

    // ===== API: WEATHER =====
    app.get("/api/weather", async (req, res) => {
        try {
            const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));

            const location = getLocationFromConfig(cfg);

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current_weather=true`;
            const response = await axios.get(url);
            const weather = response.data.current_weather;

            const mapped = mapWeatherCode(weather.weathercode);

            res.json({
                location,
                current: {
                    temp: weather.temperature,
                    wind: weather.windspeed,
                    code: weather.weathercode,
                    time: weather.time,
                    condition: mapped.condition,
                    icon: mapped.icon
                }
            });
        } catch (err) {
            console.error("Weather error:", err);
            res.status(500).json({ error: "Failed to load weather" });
        }
    });

    // ===== API: RESET LOCATION (auto-detect via IP) =====
    app.post("/api/location/reset", async (req, res) => {
        try {
            // Locatie opnieuw proberen op te halen via IP
            await autoDetectLocationFromIP();

            // Nieuwe config inlezen
            const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));

            res.json({
                ok: true,
                location: cfg.location || null,
                time_zone: cfg.time_zone || "Europe/Brussels"
            });
        } catch (e) {
            console.error("Location reset error:", e);
            res.status(500).json({ ok: false, error: "Failed to reset location" });
        }
    });

    // ===== API: FACTORY RESET =====
    app.post("/api/reset", async (req, res) => {
        try {
            console.log("⚠️ Factory reset triggered...");

            const filesToRemove = [
                DEVICE_CONFIG_FILE,
                TOKEN_FILE,
                CONSOLE_DECK_FILE
            ];

            for (const file of filesToRemove) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log("🗑️ Removed", file);
                }
            }

            exec("sudo reboot", (err) => {
                if (err) console.error("❌ Reboot error:", err);
            });

            res.json({ ok: true, rebooting: true });

        } catch (err) {
            console.error("❌ Factory reset error:", err);
            res.status(500).json({ error: "Factory reset failed" });
        }
    });

    // ===== API: RESET WIFI =====
    app.post("/api/reset-wifi", async (req, res) => {
        try {
            console.log("⚠️ WiFi reset triggered...");

            let cfg = {};
            try {
                cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
            } catch {
                cfg = {};
            }

            cfg.wifiConfigured = false;
            cfg.ap = { ssid: "", password: "" };

            fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(cfg, null, 2));
            console.log("✔ WiFi settings reset");

            exec("sudo reboot", (err) => {
                if (err) console.error("❌ Reboot error:", err);
            });

            res.json({ ok: true, rebooting: true });

        } catch (err) {
            console.error("❌ WiFi reset error:", err);
            res.status(500).json({ error: "Reset WiFi failed" });
        }
    });

}

module.exports = { registerApiRoutes };