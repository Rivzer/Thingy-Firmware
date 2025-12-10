const express = require("express");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

module.exports = function createAdminApp({
    HOST_IP,
    PORT,
    isWiFiConfigured,
    loadConsoleDeckConfig,
    saveConsoleDeckConfig,
    DEVICE_CONFIG_FILE
}) {
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

    adminApp.get("/setupwifi", (req, res) => {
        res.render("setupwifi");
    });

    adminApp.get("/api/consoledeck", (req, res) => {
        const cfg = loadConsoleDeckConfig();
        res.json(cfg);
    });

    adminApp.get("/api/consoledeck/selected", (req, res) => {
        const cfg = loadConsoleDeckConfig();
        const selected = cfg.apps.find(a => a.id === cfg.selectedAppId) || null;
        res.json({ selectedAppId: cfg.selectedAppId, app: selected });
    });

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

            showLabel: showLabel === false || showLabel === "false" ? false : true
        };

        cfg.apps.push(app);
        saveConsoleDeckConfig(cfg);

        res.json(app);
    });

    // Browse for exe file and get full path
    adminApp.post("/api/consoledeck/browse-exe", (req, res) => {
        const { appName } = req.body;

        // Use PowerShell to open file dialog and get path
        const tempScript = path.join(__dirname, `temp_browse_${Date.now()}.ps1`);
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "All Files (*.*)|*.*|Executable Files (*.exe)|*.exe|Batch Files (*.bat;*.cmd)|*.bat;*.cmd|Scripts (*.ps1;*.vbs)|*.ps1;*.vbs"
$dialog.Title = "Select Application"
$dialog.InitialDirectory = [Environment]::GetFolderPath('ProgramFiles')
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
} else {
    Write-Output "CANCELLED"
}
`;

        fs.writeFileSync(tempScript, psScript, 'utf8');

        exec(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tempScript}"`, { encoding: 'utf8' }, (error, stdout, stderr) => {
            try { fs.unlinkSync(tempScript); } catch (e) { }

            if (error) {
                console.error("Browse error:", error);
                console.error("stderr:", stderr);
                return res.status(500).json({ error: "Failed to open file dialog: " + (stderr || error.message) });
            }

            const exePath = stdout.trim();
            
            if (exePath === "CANCELLED" || !exePath) {
                return res.status(400).json({ error: "No file selected" });
            }

            if (fs.existsSync(exePath)) {
                return res.json({ exePath });
            } else {
                return res.status(400).json({ error: "File not found: " + exePath });
            }
        });
    });

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

    adminApp.post("/api/consoledeck/select", (req, res) => {
        const { id } = req.body;

        const cfg = loadConsoleDeckConfig();

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

    adminApp.post("/api/save-wifi", (req, res) => {
        const { ssid, password } = req.body;

        if (!ssid) return res.json({ ok: false, error: "SSID is required" });

        try {
            const cfg = JSON.parse(fs.readFileSync(DEVICE_CONFIG_FILE, "utf8"));

            cfg.ap.ssid = ssid;
            cfg.ap.password = password;
            cfg.wifiConfigured = true;

            fs.writeFileSync(DEVICE_CONFIG_FILE, JSON.stringify(cfg, null, 2));

            exec("sudo reboot", () => { });

            res.json({ ok: true, rebooting: true });
        } catch (err) {
            res.json({ ok: false, error: "Could not save WiFi" });
        }
    });

    return adminApp;
};