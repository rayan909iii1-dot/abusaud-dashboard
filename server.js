const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// إعدادات Express
// =========================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// الملفات العامة
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// Sessions
// =========================

app.use(
    session({
        store: new FileStore({
            path: './sessions'
        }),

        secret:
            process.env.SESSION_SECRET ||
            'AbuSaudSecretKey909',

        resave: false,
        saveUninitialized: false,

        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// =========================
// قاعدة البيانات
// =========================

const getDB = () => {
    const dbPath = path.join(__dirname, 'database.json');

    // إنشاء قاعدة البيانات إذا لم تكن موجودة
    if (!fs.existsSync(dbPath)) {
        const defaultDB = {
            users: [
                {
                    username: 'abu saud',
                    password: '123',
                    isAdmin: true
                }
            ],

            bots: []
        };

        fs.writeFileSync(
            dbPath,
            JSON.stringify(defaultDB, null, 2),
            'utf8'
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(dbPath, 'utf8')
        );
    } catch (error) {
        console.error(
            'Error reading database:',
            error
        );

        return {
            users: [],
            bots: []
        };
    }
};

// حفظ قاعدة البيانات
const saveDB = (data) => {
    const dbPath = path.join(
        __dirname,
        'database.json'
    );

    fs.writeFileSync(
        dbPath,
        JSON.stringify(data, null, 2),
        'utf8'
    );
};

// =========================
// تسجيل الدخول
// =========================

app.get('/login', (req, res) => {
    res.render('login', {
        error: null
    });
});

app.post('/login', (req, res) => {
    const db = getDB();

    const username = req.body.username;
    const password = req.body.password;

    const user = db.users.find(
        (u) =>
            u.username === username &&
            u.password === password
    );

    if (user) {
        req.session.user = {
            username: user.username,
            isAdmin: user.isAdmin
        };

        return res.redirect('/');
    }

    res.render('login', {
        error: 'بيانات الدخول غير صحيحة'
    });
});

// =========================
// التسجيل
// =========================

app.get('/register', (req, res) => {
    res.render('register', {
        error: null
    });
});

app.post('/register', (req, res) => {
    const db = getDB();

    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
        return res.render('register', {
            error: 'يرجى تعبئة جميع البيانات'
        });
    }

    const existingUser = db.users.find(
        (u) => u.username === username
    );

    if (existingUser) {
        return res.render('register', {
            error: 'اسم المستخدم موجود بالفعل'
        });
    }

    db.users.push({
        username: username,
        password: password,
        isAdmin: false
    });

    saveDB(db);

    res.redirect('/login');
});

// =========================
// إضافة بوت
// =========================

app.post('/add-bot', (req, res) => {
    if (
        !req.session.user ||
        !req.session.user.isAdmin
    ) {
        return res.redirect('/');
    }

    const db = getDB();

    db.bots.push({
        ...req.body,
        addedAt: new Date().toISOString()
    });

    saveDB(db);

    res.redirect('/');
});

// =========================
// حذف بوت
// =========================

app.post('/delete-bot', (req, res) => {
    if (
        !req.session.user ||
        !req.session.user.isAdmin
    ) {
        return res.redirect('/');
    }

    const db = getDB();

    const botIndex = db.bots.findIndex(
        (bot) =>
            bot.id === req.body.id
    );

    if (botIndex !== -1) {
        db.bots.splice(botIndex, 1);
        saveDB(db);
    }

    res.redirect('/');
});

// =========================
// الصفحة الرئيسية
// =========================

app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const db = getDB();

    const isAdmin =
        req.session.user.isAdmin === true;

    const userBots = isAdmin
        ? db.bots
        : db.bots.filter(
            (bot) =>
                bot.owner ===
                req.session.user.username
        );

    res.render('index', {
        currentUser:
            req.session.user.username,

        isAdmin: isAdmin,

        bots: userBots,

        allUsers: db.users,

        availableScripts: [
            'Welcome',
            'Tickets',
            'Protection'
        ]
    });
});

// =========================
// تسجيل الخروج
// =========================

app.get('/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error(
                'Session destroy error:',
                error
            );
        }

        res.redirect('/login');
    });
});

// =========================
// صفحة 404
// =========================

app.use((req, res) => {
    res.status(404).send(
        'الصفحة غير موجودة'
    );
});

// =========================
// تشغيل السيرفر
// =========================

app.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log(
            `Server running on port ${PORT}`
        );
    }
);
