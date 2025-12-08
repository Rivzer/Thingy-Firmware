function registerSettingsRoutes(app, {
    fs,
    DEVICE_CONFIG_FILE,
    hasInternet,
    HOST_IP,
    currentFirmware
}) {

    app.get("/settings", async (req, res) => {
        const view = req.query.view;

        if (view === "apps") {
            return res.render("settings/apps");
        }
        else if (view === "deviceinformation") {
            let devCfg = {};
            try {
                devCfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));
            } catch (e) {
                console.error("Kon device_config.json niet lezen:", e.message);
                devCfg = {};
            }

            const wifiConfigured = devCfg.wifiConfigured === true;
            const internetOnline = await hasInternet();

            return res.render("settings/deviceinformation", {
                device: devCfg,
                ip: HOST_IP,
                wifiConfigured,
                internetOnline,
                firmware: currentFirmware,
            });
        }

        res.render("settings/settings");
    });
}

module.exports = { registerSettingsRoutes };
