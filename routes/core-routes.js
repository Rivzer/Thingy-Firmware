function registerCoreRoutes(app, { loadConsoleDeckConfig }) {

    // Home
    app.get("/", (req, res) => {
        res.render("index");
    });

    // Console Deck
    app.get("/consoledeck", (req, res) => {
        const cfg = loadConsoleDeckConfig();
        res.render("consoledeck", {
            apps: cfg.apps || [],
            selectedAppId: cfg.selectedAppId || null
        });
    });

    // Weather view
    app.get("/weather", (req, res) => {
        res.render("weather");
    });

    // Clock
    app.get("/clock", (req, res) => {
        res.render("clock");
    });

    // Picture frame
    app.get("/pictureframe", (req, res) => {
        res.render("pictureframe");
    });
}

module.exports = { registerCoreRoutes };
