const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, "database.json");
const BOTDIR = path.join(__dirname, "bots");

// =====================================================
// EXPRESS
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// الملفات العامة
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// SESSION
// =====================================================

app.use(
    session({
        secret: process.env.SESSION_SECRET || "CHANGE_THIS_SECRET",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

// =====================================================
// DATABASE
// =====================================================

function readDatabase() {
    if (!fs.existsSync(DB)) {
        fs.writeFileSync(
            DB,
            JSON.stringify(
                {
                    users: [],
                    bots: []
                },
                null,
                2
            )
        );
    }

    try {
        return JSON.parse(fs.readFileSync(DB, "utf8"));
    } catch (error) {
        console.error("Database Error:", error);

        return {
            users: [],
            bots: []
        };
    }
}

function saveDatabase(data) {
    fs.writeFileSync(
        DB,
        JSON.stringify(data, null, 2)
    );
}

// =====================================================
// AUTH
// =====================================================

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            error: "غير مسجل الدخول"
        });
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            error: "غير مسجل الدخول"
        });
    }

    if (!req.session.user.isAdmin) {
        return res.status(403).json({
            success: false,
            error: "هذه الصفحة للمسؤول فقط"
        });
    }

    next();
}

// =====================================================
// BOT PROCESS MANAGER
// =====================================================

const botProcesses = new Map();

function getBotScript(script) {
    const scripts = {
        welcome: "welcome.js",
        protection: "protection.js"
    };

    return scripts[script] || null;
}

function startBot(bot) {

    // البوت شغال مسبقًا
    if (botProcesses.has(bot.id)) {
        return;
    }

    const script = getBotScript(bot.script);

    if (!script) {
        throw new Error("نوع البوت غير معروف");
    }

    if (!bot.token) {
        throw new Error("Bot Token مفقود");
    }

    const scriptPath = path.join(
        BOTDIR,
        script
    );

    if (!fs.existsSync(scriptPath)) {
        throw new Error(
            `ملف البوت غير موجود: ${script}`
        );
    }

    console.log(
        `Starting bot: ${bot.name} (${bot.id})`
    );

    const child = spawn(
        process.execPath,
        [scriptPath],
        {
            cwd: __dirname,

            env: {
                ...process.env,

                BOT_TOKEN: bot.token,

                CLIENT_ID: bot.id
            },

            stdio: [
                "ignore",
                "pipe",
                "pipe"
            ]
        }
    );

    botProcesses.set(
        bot.id,
        child
    );

    child.stdout.on(
        "data",
        data => {
            console.log(
                `[${bot.name}] ${data.toString().trim()}`
            );
        }
    );

    child.stderr.on(
        "data",
        data => {
            console.error(
                `[${bot.name}] ${data.toString().trim()}`
            );
        }
    );

    child.on(
        "error",
        error => {
            console.error(
                `Bot process error (${bot.name}):`,
                error
            );
        }
    );

    child.on(
        "exit",
        (code, signal) => {

            console.log(
                `Bot stopped: ${bot.name} | code=${code} signal=${signal}`
            );

            botProcesses.delete(
                bot.id
            );

            const db = readDatabase();

            const dbBot = db.bots.find(
                x => x.id === bot.id
            );

            if (dbBot) {

                dbBot.status = "offline";

                if (code !== 0) {
                    dbBot.lastError =
                        `Process exited with code ${code}`;
                } else {
                    dbBot.lastError = null;
                }

                saveDatabase(db);
            }
        }
    );
}

function stopBot(id) {

    const process = botProcesses.get(id);

    if (!process) {
        return false;
    }

    try {
        process.kill("SIGTERM");
    } catch (error) {
        console.error(
            "Stop bot error:",
            error.message
        );
    }

    botProcesses.delete(id);

    return true;
}

// =====================================================
// WEBSITE PAGES
// =====================================================

// الصفحة الرئيسية
app.get("/", (req, res) => {

    if (req.session.user) {
        return res.render("index", {
            user: req.session.user
        });
    }

    res.render("login");
});

// Login page
app.get("/login", (req, res) => {

    if (req.session.user) {
        return res.redirect("/");
    }

    res.render("login");
});

// Register page
app.get("/register", (req, res) => {

    if (req.session.user) {
        return res.redirect("/");
    }

    res.render("register");
});

// Verify page
app.get("/verify", (req, res) => {

    res.render("verify");
});

// =====================================================
// LOGIN
// =====================================================

app.post(
    "/api/login",
    (req, res) => {

        const {
            username,
            password
        } = req.body;

        const db = readDatabase();

        const user = db.users.find(
            user =>
                user.username === username &&
                user.password === password
        );

        if (!user) {

            return res.status(401).json({
                success: false,
                error: "اسم المستخدم أو كلمة المرور غير صحيحة"
            });
        }

        req.session.user = {
            username: user.username,
            isAdmin: !!user.isAdmin
        };

        res.json({
            success: true,
            user: req.session.user
        });
    }
);

// =====================================================
// REGISTER
// =====================================================

app.post(
    "/api/register",
    (req, res) => {

        const {
            username,
            password
        } = req.body;

        if (!username || !password) {

            return res.status(400).json({
                success: false,
                error: "اسم المستخدم وكلمة المرور مطلوبة"
            });
        }

        if (username.length < 3) {

            return res.status(400).json({
                success: false,
                error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"
            });
        }

        if (password.length < 4) {

            return res.status(400).json({
                success: false,
                error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل"
            });
        }

        const db = readDatabase();

        const exists = db.users.some(
            user =>
                user.username.toLowerCase() ===
                username.toLowerCase()
        );

        if (exists) {

            return res.status(409).json({
                success: false,
                error: "اسم المستخدم مستخدم بالفعل"
            });
        }

        db.users.push({
            username,
            password,
            isAdmin: false
        });

        saveDatabase(db);

        res.json({
            success: true,
            message: "تم إنشاء الحساب بنجاح"
        });
    }
);

// =====================================================
// LOGOUT
// =====================================================

app.post(
    "/api/logout",
    (req, res) => {

        req.session.destroy(
            error => {

                if (error) {

                    return res.status(500).json({
                        success: false,
                        error: "تعذر تسجيل الخروج"
                    });
                }

                res.json({
                    success: true
                });
            }
        );
    }
);

// =====================================================
// CURRENT USER
// =====================================================

app.get(
    "/api/me",
    requireAuth,
    (req, res) => {

        res.json({
            success: true,
            user: req.session.user
        });
    }
);

// =====================================================
// USER BOTS
// =====================================================

app.get(
    "/api/my-bots",
    requireAuth,
    (req, res) => {

        const db = readDatabase();

        const bots = db.bots
            .filter(
                bot =>
                    bot.owner ===
                    req.session.user.username
            )
            .map(bot => ({

                id: bot.id,

                name: bot.name,

                script: bot.script,

                owner: bot.owner,

                status:
                    botProcesses.has(bot.id)
                        ? "online"
                        : bot.status || "offline",

                lastError:
                    bot.lastError || null,

                // لا نرسل التوكن للعميل
                token: undefined
            }));

        res.json({
            success: true,
            bots
        });
    }
);

// =====================================================
// START USER BOT
// =====================================================

app.post(
    "/api/bots/:id/start",
    requireAuth,
    (req, res) => {

        const db = readDatabase();

        const bot = db.bots.find(
            bot =>
                bot.id === req.params.id &&
                bot.owner ===
                    req.session.user.username
        );

        if (!bot) {

            return res.status(404).json({
                success: false,
                error: "البوت غير موجود في حسابك"
            });
        }

        try {

            if (botProcesses.has(bot.id)) {

                return res.json({
                    success: true,
                    status: "online"
                });
            }

            bot.status = "starting";
            bot.lastError = null;

            saveDatabase(db);

            startBot(bot);

            res.json({
                success: true,
                status: "starting"
            });

        } catch (error) {

            console.error(
                "Start Bot Error:",
                error
            );

            bot.status = "offline";
            bot.lastError = error.message;

            saveDatabase(db);

            res.status(500).json({
                success: false,
                status: "offline",
                error: error.message
            });
        }
    }
);

// =====================================================
// STOP USER BOT
// =====================================================

app.post(
    "/api/bots/:id/stop",
    requireAuth,
    (req, res) => {

        const db = readDatabase();

        const bot = db.bots.find(
            bot =>
                bot.id === req.params.id &&
                bot.owner ===
                    req.session.user.username
        );

        if (!bot) {

            return res.status(404).json({
                success: false,
                error: "البوت غير موجود في حسابك"
            });
        }

        stopBot(bot.id);

        bot.status = "offline";
        bot.lastError = null;

        saveDatabase(db);

        res.json({
            success: true,
            status: "offline"
        });
    }
);

// =====================================================
// ADMIN - USERS
// =====================================================

app.get(
    "/api/admin/users",
    requireAdmin,
    (req, res) => {

        const db = readDatabase();

        const users = db.users.map(
            user => ({

                username: user.username,

                isAdmin: !!user.isAdmin,

                bots: db.bots.filter(
                    bot =>
                        bot.owner ===
                        user.username
                ).length
            })
        );

        res.json({
            success: true,
            users
        });
    }
);

// =====================================================
// ADMIN - CREATE USER
// =====================================================

app.post(
    "/api/admin/users",
    requireAdmin,
    (req, res) => {

        const {
            username,
            password,
            isAdmin
        } = req.body;

        if (!username || !password) {

            return res.status(400).json({
                success: false,
                error: "username/password مطلوبان"
            });
        }

        const db = readDatabase();

        if (
            db.users.some(
                user =>
                    user.username === username
            )
        ) {

            return res.status(409).json({
                success: false,
                error: "الحساب موجود بالفعل"
            });
        }

        db.users.push({
            username,
            password,
            isAdmin: !!isAdmin
        });

        saveDatabase(db);

        res.json({
            success: true
        });
    }
);

// =====================================================
// ADMIN - ALL BOTS
// =====================================================

app.get(
    "/api/admin/bots",
    requireAdmin,
    (req, res) => {

        const db = readDatabase();

        const bots = db.bots.map(
            bot => ({

                id: bot.id,

                name: bot.name,

                script: bot.script,

                owner: bot.owner,

                status:
                    botProcesses.has(bot.id)
                        ? "online"
                        : bot.status || "offline",

                lastError:
                    bot.lastError || null
            })
        );

        res.json({
            success: true,
            bots
        });
    }
);

// =====================================================
// ADMIN - ADD BOT
// =====================================================

app.post(
    "/api/admin/bots",
    requireAdmin,
    (req, res) => {

        const {
            name,
            token,
            script,
            owner
        } = req.body;

        if (
            !name ||
            !token ||
            !script ||
            !owner
        ) {

            return res.status(400).json({
                success: false,
                error: "كل الحقول مطلوبة"
            });
        }

        if (!getBotScript(script)) {

            return res.status(400).json({
                success: false,
                error: "نوع البوت غير مسموح"
            });
        }

        const db = readDatabase();

        const ownerExists =
            db.users.some(
                user =>
                    user.username === owner
            );

        if (!ownerExists) {

            return res.status(404).json({
                success: false,
                error: "العميل غير موجود"
            });
        }

        const botId =
            crypto.randomBytes(10)
                .toString("hex");

        db.bots.push({

            id: botId,

            name,

            token,

            script,

            owner,

            status: "offline",

            lastError: null
        });

        saveDatabase(db);

        res.json({
            success: true,
            id: botId
        });
    }
);

// =====================================================
// ADMIN - DELETE BOT
// =====================================================

app.post(
    "/api/admin/bots/:id/delete",
    requireAdmin,
    (req, res) => {

        const db = readDatabase();

        const index =
            db.bots.findIndex(
                bot =>
                    bot.id ===
                    req.params.id
            );

        if (index === -1) {

            return res.status(404).json({
                success: false,
                error: "البوت غير موجود"
            });
        }

        stopBot(req.params.id);

        db.bots.splice(index, 1);

        saveDatabase(db);

        res.json({
            success: true
        });
    }
);

// =====================================================
// ERROR HANDLING
// =====================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught Exception:",
            error
        );
    }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            `Dashboard running on port ${PORT}`
        );

        console.log(
            `http://localhost:${PORT}`
        );

        console.log(
            "================================="
        );
    }
);
