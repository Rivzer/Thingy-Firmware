// admin-app.js
const express = require("express");
const path = require("path");

module.exports = function createAdminApp({
    HOST_IP,
    PORT,
    isWiFiConfigured,
    loadConsoleDeckConfig,
    saveConsoleDeckConfig
}) {
    const adminApp = express();

    adminApp.set("view engine", "ejs");
    adminApp.set("views", path.join(__dirname, "admin_views"));

    adminApp.use(express.json());
    adminApp.use(express.urlencoded({ extended: true }));
    adminApp.use(express.static(path.join(__dirname, "admin_public")));

    // Dashboard
    adminApp.get("/", (req, res) => {
        const cfg = loadConsoleDeckConfig();

        res.render("admin-dashboard", {
            ip: HOST_IP,
            port: PORT,
            wifiConfigured: isWiFiConfigured,
            config: cfg
        });
    });

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

    // Nieuwe app toevoegen
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

    // App verwijderen
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

    // App selecteren
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

    // App bewerken
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

    return adminApp;
};