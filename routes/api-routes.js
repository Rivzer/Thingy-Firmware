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
        autoDetectLocationFromIP,
        HOST_IP
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
            return res.status(401).json({ error: "User is not logged in." });
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
            console.log("Spotify Playlists API Error:", e.response?.data || e.message);
            res.status(500).json({ error: "Unable to fetch Spotify playlists." });
        }
    });

    // ===== API: SPOTIFY PLAY PLAYLIST =====
    app.get("/api/play-playlist", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.status(401).send("User is not logged in.");

        const id = req.query.playlist;
        if (!id) return res.status(400).send("Playlist ID is missing.");

        try {
            await axios.put(
                "https://api.spotify.com/v1/me/player/play",
                { context_uri: `spotify:playlist:${id}` },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            res.send("OK");
        } catch (err) {
            console.log("Play Playlist Error:", err.response?.data || err.message);
            res.status(500).send("Unable to start playlist.");
        }
    });

    // ===== API: SPOTIFY PLAY TRACK =====
    app.get("/api/play-track", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.status(401).send("User is not logged in.");

        const id = req.query.track;
        if (!id) return res.status(400).send("Track ID is missing.");

        try {
            await axios.put(
                "https://api.spotify.com/v1/me/player/play",
                { uris: [`spotify:track:${id}`] },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            res.send("OK");
        } catch (err) {
            console.log("Play Track Error:", err.response?.data || err.message);
            res.status(500).send("Unable to play track.");
        }
    });

    // ===== API: SPOTIFY GET LIKED SONGS =====
    app.get("/api/liked", async (req, res) => {
        const token = await getValidToken();
        if (!token) {
            return res.status(401).json({ error: "User is not logged in." });
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
            console.log("Liked Tracks API Error:", e.response?.data || e.message);
            res.status(500).json({ error: "Unable to load liked songs." });
        }
    });

    // ===== API: SPOTIFY GET RECENTLY PLAYED =====
    app.get("/api/recent", async (req, res) => {
        const token = await getValidToken();
        if (!token) {
            return res.status(401).json({ error: "User is not logged in." });
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
            console.log("Recently Played API Error:", e.response?.data || e.message);
            res.status(500).json({ error: "Unable to load recently played tracks." });
        }
    });

    // ===== API: SPOTIFY CALLBACK =====
    app.get("/callback", async (req, res) => {
        const code = req.query.code;
        if (!code) return res.send("Authorization code missing.");

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
            console.log("✔ Spotify token saved successfully");

            res.send("<h1>Login successful ✔ You may close this tab.</h1>");
        } catch (err) {
            console.log("Spotify Callback Error:", err.response?.data || err.message);
            res.send("Login failed.");
        }
    });

    // ===== API: VOLUME CONTROL =====
    app.get("/api/volume", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.status(401).send("User is not logged in.");

        const raw = req.query.percent;
        const percent = Number(raw);

        if (Number.isNaN(percent) || percent < 0 || percent > 100) {
            return res.status(400).send("Invalid volume percentage.");
        }

        try {
            await axios.put(
                `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(percent)}`,
                null,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            res.send("OK");
        } catch (err) {
            console.log("Volume Adjustment Error:", err.response?.data || err.message);
            res.status(500).send("Unable to set volume.");
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

            if (!data.item && data.currently_playing_type === "episode") {
                return res.json({
                    track: "Podcast episode",
                    artist: "Metadata not available",
                    cover: "",
                    duration: 0,
                    progress: 0,
                    liked: false,
                    id: null,
                    isPlaying: !!data.is_playing,
                    type: "episode",
                    volume: data.device?.volume_percent ?? null,
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
                volume: data.device?.volume_percent ?? null,
            });

        } catch (e) {
            console.log("Playback Error:", e.response?.data || e.message);
            res.json({});
        }
    });

    // ===== API: PLAYER CONTROLS =====
    app.get("/api/playpause", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        try {
            const playback = await axios.get(
                "https://api.spotify.com/v1/me/player",
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (playback.data?.is_playing) {
                await axios.put("https://api.spotify.com/v1/me/player/pause", {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } else {
                await axios.put("https://api.spotify.com/v1/me/player/play", {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }

            res.send("OK");
        } catch (err) {
            console.log("Play/Pause Error:", err.response?.data || err.message);
            res.send("Unable to toggle playback.");
        }
    });

    app.get("/api/next", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        try {
            await axios.post("https://api.spotify.com/v1/me/player/next", {}, {
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch { }

        res.send("OK");
    });

    app.get("/api/prev", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        try {
            await axios.post("https://api.spotify.com/v1/me/player/previous", {}, {
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch { }

        res.send("OK");
    });

    app.get("/api/seek", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        const position = parseInt(req.query.position, 10);

        try {
            await axios.put(
                `https://api.spotify.com/v1/me/player/seek?position_ms=${position}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch { }

        res.send("OK");
    });

    app.get("/api/like", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        const id = req.query.track;

        try {
            await axios.put(
                `https://api.spotify.com/v1/me/tracks?ids=${id}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch { }

        res.send("OK");
    });

    app.get("/api/unlike", async (req, res) => {
        const token = await getValidToken();
        if (!token) return res.send("User is not logged in.");

        const id = req.query.track;

        try {
            await axios.delete(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch { }

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

    // ===== API: CONSOLE DECK – RUN PROGRAM ON PC =====
    app.post("/api/consoledeck/run", (req, res) => {
        const { id } = req.body || {};

        const cfg = loadConsoleDeckConfig();
        const appIdToRun = id || cfg.selectedAppId;

        if (!appIdToRun) {
            return res.status(400).json({ error: "No app ID provided." });
        }

        const appEntry = cfg.apps.find(a => a.id === appIdToRun);
        if (!appEntry) {
            return res.status(404).json({ error: "Application not found." });
        }

        if (!appEntry.pcCommand) {
            return res.status(400).json({ error: "No command defined for this application." });
        }

        let command = appEntry.pcCommand;
        
        // If it's a direct file path (not already a macro command), wrap it in quotes for paths with spaces
        if (!command.startsWith('.\\macro.exe') && !command.startsWith('"')) {
            // Check if it's a file path (has extension like .exe, .bat, .cmd, .ps1, etc)
            if (command.match(/\.[a-zA-Z0-9]+$/)) {
                command = `"${command}"`;
            }
        }

        console.log(`▶ Executing ConsoleDeck command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("❌ Execution failed:", error.message);
                return res.status(500).json({ error: "Execution failed", detail: error.message });
            }

            console.log("✔ Command executed successfully. Output:", stdout);
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
            console.error("Weather API Error:", err);
            res.status(500).json({ error: "Unable to load weather data." });
        }
    });

    // ===== API: RESET LOCATION =====
    app.post("/api/location/reset", async (req, res) => {
        try {
            console.log("🌍 Resetting location using IP auto-detection...");
            await autoDetectLocationFromIP();

            const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));

            res.json({
                ok: true,
                location: cfg.location || null,
                time_zone: cfg.time_zone || "Europe/Brussels"
            });
        } catch (e) {
            console.error("Location Reset Error:", e);
            res.status(500).json({ ok: false, error: "Unable to reset location." });
        }
    });

    // ===== API: FACTORY RESET =====
    app.post("/api/reset", async (req, res) => {
        try {
            console.log("⚠️ Factory reset initiated...");

            const filesToRemove = [
                DEVICE_CONFIG_FILE,
                TOKEN_FILE,
                CONSOLE_DECK_FILE
            ];

            for (const file of filesToRemove) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log("🗑️ Removed:", file);
                }
            }

            exec("sudo reboot", (err) => {
                if (err) console.error("Reboot Error:", err);
            });

            res.json({ ok: true, rebooting: true });

        } catch (err) {
            console.error("Factory Reset Error:", err);
            res.status(500).json({ error: "Factory reset failed." });
        }
    });

    // ===== API: RESET WIFI =====
    app.post("/api/reset-wifi", async (req, res) => {
        try {
            console.log("⚠️ WiFi reset requested...");

            let cfg = {};
            try {
                cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
            } catch {
                cfg = {};
            }

            cfg.wifiConfigured = false;
            cfg.ap = { ssid: "", password: "" };

            fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(cfg, null, 2));
            console.log("✔ WiFi configuration cleared. Rebooting...");

            exec("sudo reboot", (err) => {
                if (err) console.error("Reboot Error:", err);
            });

            res.json({ ok: true, rebooting: true });

        } catch (err) {
            console.error("WiFi Reset Error:", err);
            res.status(500).json({ error: "WiFi reset failed." });
        }
    });

    // ===== API: WIFI SETUP QR =====
    app.get("/api/setupwifi-qr", async (req, res) => {
        try {
            const url = `http://${HOST_IP}:8889/setupwifi`;

            const qr = await QRCode.toDataURL(url);

            return res.json({
                ok: true,
                qr,
                url
            });

        } catch (err) {
            console.error("QR generation error:", err);
            return res.status(500).json({
                ok: false,
                error: "Failed to generate QR code"
            });
        }
    });
}

module.exports = { registerApiRoutes };