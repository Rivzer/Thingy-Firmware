function registerSpotifyRoutes(app, { getValidToken, axios }) {

    app.get("/spotify", async (req, res) => {
        const view = req.query.view;

        // ===== GLOBAL LOGIN CHECK =====
        const token = await getValidToken();

        if (!token) {
            return res.render("spotify-login");
        }

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
}

module.exports = { registerSpotifyRoutes };
