function registerWifiRoutes(app, {
    isWiFiConfigured,
    WIFI_AP_AUTH_TYPE,
    WIFI_AP_SSID,
    WIFI_AP_PASSWORD,
    QRCode
}) {
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
}

module.exports = { registerWifiRoutes };