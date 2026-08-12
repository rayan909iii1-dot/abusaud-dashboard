const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const app = express();

// ======================================================
// SETTINGS
// ======================================================

const PORT = Number(process.env.PORT || 3000);

const SITE_URL = (
    process.env.SITE_URL ||
    'https://abusaud-dashboard-production.up.railway.app'
).replace(/\/+$/, '');

const ADMIN_DISCORD_ID = '1113483140086907093';

// ======================================================
// EXPRESS
// ======================================================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ======================================================
// SESSIONS
// ======================================================

const sessionsPath = path.join(__dirname, 'sessions');

if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
}

app.set('trust proxy', 1);

app.use(
    session({
        store: new FileStore({
            path: sessionsPath,
            retries: 3,
            ttl: 60 * 60 * 24 * 7
        }),

        secret:
            process.env.SESSION_SECRET ||
            'CHANGE_THIS_SESSION_SECRET_ON_RAILWAY',

        resave: false,
        saveUninitialized: false,

        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// ======================================================
// DATABASE
// ======================================================

const databasePath = path.join(__dirname, 'database.json');

function getDB() {
    if (!fs.existsSync(databasePath)) {
        const initial = {
            users: [
                {
                    username: 'abu saud',
                    password: '123',
                    email: 'admin@example.com',
                    isAdmin: true,
                    emailVerified: true,
                    discordId: ADMIN_DISCORD_ID
                }
            ],
            bots: []
        };

        saveDB(initial);
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(databasePath, 'utf8')
        );

        if (!Array.isArray(data.users)) {
            data.users = [];
        }

        if (!Array.isArray(data.bots)) {
            data.bots = [];
        }

        return data;
    } catch (error) {
        console.error('[DATABASE ERROR]', error);

        return {
            users: [],
            bots: []
        };
    }
}

function saveDB(data) {
    const tempPath = `${databasePath}.tmp`;

    fs.writeFileSync(
        tempPath,
        JSON.stringify(data, null, 2),
        'utf8'
    );

    fs.renameSync(tempPath, databasePath);
}

// ======================================================
// HELPERS
// ======================================================

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function makeCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashCode(code) {
    return crypto
        .createHash('sha256')
        .update(String(code))
        .digest('hex');
}

function getPendingRegistration(req) {
    return req.session.pendingRegistration || null;
}

function updateBotStatus(botId, status) {
    try {
        const db = getDB();

        const bot = db.bots.find(
            b => b.id === botId
        );

        if (!bot) {
            return;
        }

        bot.status = status;
        bot.updatedAt = new Date().toISOString();

        saveDB(db);
    } catch (error) {
        console.error('[STATUS ERROR]', error);
    }
}

function isAdminUser(interaction) {
    return (
        interaction.user &&
        interaction.user.id === ADMIN_DISCORD_ID
    );
}

function getAdminUsers() {
    return getDB().users;
}

function getUserBots(username) {
    return getDB().bots.filter(
        bot => bot.owner === username
    );
}

function findUserByDiscordId(discordId) {
    const db = getDB();

    return db.users.find(
        user => user.discordId === discordId
    );
}

function findUserByUsername(username) {
    const db = getDB();

    return db.users.find(
        user => user.username === username
    );
}

function safeBotType(type) {
    return String(type || '')
        .trim()
        .toLowerCase();
}

// ======================================================
// EMAIL
// ======================================================

const mailTransporter = nodemailer.createTransport({
    host:
        process.env.SMTP_HOST ||
        'smtp-relay.brevo.com',

    port: Number(
        process.env.SMTP_PORT || 587
    ),

    secure:
        String(process.env.SMTP_SECURE || 'false') === 'true',

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },

    tls: {
        rejectUnauthorized: false
    },

    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000
});

async function sendVerificationEmail(
    email,
    username,
    code
) {
    if (
        !process.env.SMTP_HOST ||
        !process.env.SMTP_USER ||
        !process.env.SMTP_PASS
    ) {
        throw new Error(
            'SMTP environment variables are not configured.'
        );
    }

    await mailTransporter.sendMail({
        from:
            process.env.MAIL_FROM ||
            process.env.SMTP_USER,

        to: email,

        subject:
            'كود التحقق - AbuSaud Store',

        text:
            `مرحباً ${username}\n\n` +
            `كود التحقق الخاص بك هو: ${code}\n\n` +
            `ينتهي الكود خلال 10 دقائق.`,

        html: `
<!doctype html>
<html lang="ar" dir="rtl">
<body style="
margin:0;
background:#070b14;
font-family:Arial,Tahoma,sans-serif;
color:#fff;
padding:35px
">
<div style="
max-width:520px;
margin:auto;
background:#0d1422;
border:1px solid #243149;
border-radius:18px;
padding:30px
">
<h2>AbuSaud Store</h2>

<p>
مرحباً
<b>${escapeHtml(username)}</b>
</p>

<p style="color:#b6c2d4">
استخدم الكود التالي لتأكيد بريدك الإلكتروني:
</p>

<div style="
font-size:32px;
font-weight:800;
letter-spacing:8px;
text-align:center;
background:#080d17;
border:1px solid #273449;
border-radius:12px;
padding:18px;
margin:25px 0
">
${escapeHtml(code)}
</div>

<p style="
color:#94a3b8;
font-size:13px
">
الكود صالح لمدة 10 دقائق فقط.
</p>

</div>
</body>
</html>
`
    });
}

// ======================================================
// EMBED
// ======================================================

const embedData = {
    siteUrl: SITE_URL,

    title:
        'AbuSaud Store | لوحة تحكم البوتات',

    description:
        'لوحة تحكم متكاملة لإدارة وتشغيل البوتات بسهولة.',

    image:
        `${SITE_URL}/images/banner.png`
};

// ======================================================
// HOME
// ======================================================

app.get('/', (req, res) => {
    if (!req.session.user) {
        return res.render('login', {
            error: null,
            embed: embedData
        });
    }

    const db = getDB();

    const isAdmin = Boolean(
        req.session.user.isAdmin
    );

    const bots = isAdmin
        ? db.bots
        : db.bots.filter(
            bot =>
                bot.owner ===
                req.session.user.username
        );

    res.render('index', {
        currentUser:
            req.session.user.username,

        isAdmin,

        bots,

        allUsers:
            db.users,

        availableScripts: [
            'Welcome',
            'bot',
            'Tickets',
            'Protection'
        ],

        embed: embedData
    });
});

// ======================================================
// LOGIN PAGE
// ======================================================

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }

    res.render('login', {
        error: null,
        embed: embedData
    });
});

// ======================================================
// NORMAL LOGIN
// ======================================================

app.post('/login', (req, res) => {
    const db = getDB();

    const username = String(
        req.body.username || ''
    ).trim();

    const password = String(
        req.body.password || ''
    );

    const user = db.users.find(
        u =>
            u.username === username &&
            u.password === password
    );

    if (!user) {
        return res.render('login', {
            error:
                'بيانات الدخول غير صحيحة',
            embed: embedData
        });
    }

    if (
        user.email &&
        user.emailVerified === false
    ) {
        return res.render('login', {
            error:
                'يجب تأكيد بريدك الإلكتروني أولاً.',
            embed: embedData
        });
    }

    req.session.user = {
        username: user.username,
        isAdmin: Boolean(user.isAdmin)
    };

    req.session.save(error => {
        if (error) {
            console.error('[LOGIN SESSION ERROR]', error);

            return res.render('login', {
                error:
                    'حدث خطأ أثناء تسجيل الدخول.',
                embed: embedData
            });
        }

        res.redirect('/');
    });
});

// ======================================================
// REGISTER PAGE
// ======================================================

app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }

    res.render('register', {
        error: null,
        embed: embedData
    });
});

// ======================================================
// REGISTER
// ======================================================

app.post('/register', async (req, res) => {
    const db = getDB();

    const username = String(
        req.body.username || ''
    ).trim();

    const email = String(
        req.body.email || ''
    ).trim().toLowerCase();

    const password = String(
        req.body.password || ''
    );

    if (!username || !email || !password) {
        return res.render('register', {
            error:
                'يرجى تعبئة جميع البيانات',
            embed: embedData
        });
    }

    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        return res.render('register', {
            error:
                'يرجى إدخال بريد إلكتروني صحيح',
            embed: embedData
        });
    }

    if (password.length < 6) {
        return res.render('register', {
            error:
                'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
            embed: embedData
        });
    }

    if (
        db.users.some(
            u =>
                String(u.username || '')
                    .toLowerCase() ===
                username.toLowerCase()
        )
    ) {
        return res.render('register', {
            error:
                'اسم المستخدم موجود مسبقاً',
            embed: embedData
        });
    }

    if (
        db.users.some(
            u =>
                u.email &&
                String(u.email).toLowerCase() === email
        )
    ) {
        return res.render('register', {
            error:
                'هذا البريد الإلكتروني مستخدم مسبقاً',
            embed: embedData
        });
    }

    const code = makeCode();

    req.session.pendingRegistration = {
        username,
        email,
        password,
        codeHash: hashCode(code),
        expiresAt:
            Date.now() + 10 * 60 * 1000,
        lastSentAt: Date.now()
    };

    console.log(
        `[REGISTER CODE] ${username}: ${code}`
    );

    try {
        await Promise.race([
            sendVerificationEmail(
                email,
                username,
                code
            ),

            new Promise((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error('SMTP_TIMEOUT')
                        ),
                    8000
                )
            )
        ]);

        return res.render('verify', {
            error: null,
            email,
            embed: embedData
        });
    } catch (error) {
        console.error(
            '[EMAIL ERROR]',
            error
        );

        return res.render('verify', {
            error:
                'تعذر إرسال الإيميل، والكود موجود في Railway Logs.',
            email,
            embed: embedData
        });
    }
});

// ======================================================
// VERIFY EMAIL PAGE
// ======================================================

app.get('/verify-email', (req, res) => {
    const pending =
        getPendingRegistration(req);

    if (!pending) {
        return res.redirect('/register');
    }

    res.render('verify', {
        error: null,
        email: pending.email,
        embed: embedData
    });
});

// ======================================================
// VERIFY EMAIL
// ======================================================

app.post('/verify-email', (req, res) => {
    const pending =
        getPendingRegistration(req);

    const code = String(
        req.body.code || ''
    ).trim();

    if (!pending) {
        return res.redirect('/register');
    }

    if (Date.now() > pending.expiresAt) {
        delete req.session.pendingRegistration;

        return res.render('register', {
            error:
                'انتهت صلاحية الكود. أعد التسجيل.',
            embed: embedData
        });
    }

    if (
        !/^\d{6}$/.test(code) ||
        hashCode(code) !== pending.codeHash
    ) {
        return res.render('verify', {
            error:
                'كود التحقق غير صحيح',
            email: pending.email,
            embed: embedData
        });
    }

    const db = getDB();

    if (
        db.users.some(
            u =>
                u.username.toLowerCase() ===
                pending.username.toLowerCase()
        ) ||
        db.users.some(
            u =>
                u.email &&
                u.email.toLowerCase() ===
                pending.email.toLowerCase()
        )
    ) {
        delete req.session.pendingRegistration;

        return res.render('register', {
            error:
                'الحساب أو البريد مستخدم مسبقاً.',
            embed: embedData
        });
    }

    db.users.push({
        username: pending.username,
        password: pending.password,
        email: pending.email,
        isAdmin: false,
        emailVerified: true
    });

    saveDB(db);

    req.session.user = {
        username: pending.username,
        isAdmin: false
    };

    delete req.session.pendingRegistration;

    req.session.save(() => {
        res.redirect('/');
    });
});

// ======================================================
// RESEND EMAIL
// ======================================================

app.post('/resend-verification', async (req, res) => {
    const pending =
        getPendingRegistration(req);

    if (!pending) {
        return res.redirect('/register');
    }

    const wait =
        60000 -
        (Date.now() - pending.lastSentAt);

    if (wait > 0) {
        return res.render('verify', {
            error:
                `انتظر ${Math.ceil(wait / 1000)} ثانية.`,
            email: pending.email,
            embed: embedData
        });
    }

    const code = makeCode();

    pending.codeHash = hashCode(code);
    pending.expiresAt =
        Date.now() + 10 * 60 * 1000;
    pending.lastSentAt = Date.now();

    console.log(
        `[RESEND CODE] ${pending.username}: ${code}`
    );

    try {
        await sendVerificationEmail(
            pending.email,
            pending.username,
            code
        );

        return res.render('verify', {
            error:
                'تم إرسال كود جديد.',
            email: pending.email,
            success: true,
            embed: embedData
        });
    } catch (error) {
        console.error(
            '[RESEND EMAIL ERROR]',
            error
        );

        return res.render('verify', {
            error:
                'تعذر إرسال الكود.',
            email: pending.email,
            embed: embedData
        });
    }
});

// ======================================================
// ADD BOT FROM WEBSITE
// ======================================================

app.post('/add-bot', (req, res) => {
    if (
        !req.session.user ||
        !req.session.user.isAdmin
    ) {
        return res.redirect('/');
    }

    const name = String(
        req.body.name || ''
    ).trim();

    const token = String(
        req.body.token || ''
    ).trim();

    const type = String(
        req.body.type || ''
    ).trim();

    const owner = String(
        req.body.owner || ''
    ).trim();

    if (!name || !token || !type || !owner) {
        return res.redirect('/');
    }

    const db = getDB();

    const ownerUser = db.users.find(
        user => user.username === owner
    );

    if (!ownerUser) {
        return res.redirect('/');
    }

    db.bots.push({
        id: crypto.randomBytes(8).toString('hex'),
        name,
        token,
        type,
        owner,
        ownerDiscordId:
            ownerUser.discordId || null,
        status: 'متوقف',
        createdAt: new Date().toISOString()
    });

    saveDB(db);

    res.redirect('/');
});

// ======================================================
// START BOT
// ======================================================

app.post('/start/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({
                success: false,
                message:
                    'يجب تسجيل الدخول أولاً.'
            });
        }

        const db = getDB();

        const bot = db.bots.find(
            b => b.id === req.params.id
        );

        if (!bot) {
            return res.status(404).json({
                success: false,
                message:
                    'البوت غير موجود.'
            });
        }

        const isAdmin = Boolean(
            req.session.user.isAdmin
        );

        const isOwner =
            bot.owner ===
            req.session.user.username;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                success: false,
                message:
                    'ليس لديك صلاحية تشغيل هذا البوت.'
            });
        }

        const result =
            await startManagedBot(bot);

        return res.status(
            result.success ? 200 : 500
        ).json(result);
    } catch (error) {
        console.error(
            '[START ROUTE ERROR]',
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                'تعذر تشغيل البوت.'
        });
    }
});

// ======================================================
// STOP BOT
// ======================================================

app.post('/stop/:id', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({
                success: false,
                message:
                    'يجب تسجيل الدخول أولاً.'
            });
        }

        const db = getDB();

        const bot = db.bots.find(
            b => b.id === req.params.id
        );

        if (!bot) {
            return res.status(404).json({
                success: false,
                message:
                    'البوت غير موجود.'
            });
        }

        const isAdmin = Boolean(
            req.session.user.isAdmin
        );

        const isOwner =
            bot.owner ===
            req.session.user.username;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                success: false,
                message:
                    'ليس لديك صلاحية إيقاف هذا البوت.'
            });
        }

        const botClient =
            runningBots.get(bot.id);

        if (!botClient) {
            updateBotStatus(
                bot.id,
                'متوقف'
            );

            return res.json({
                success: true,
                message:
                    'البوت متوقف بالفعل.'
            });
        }

        try {
            botClient.destroy();
        } catch (error) {
            console.error(
                '[BOT DESTROY ERROR]',
                error
            );
        }

        runningBots.delete(bot.id);

        updateBotStatus(
            bot.id,
            'متوقف'
        );

        return res.json({
            success: true,
            message:
                'تم إيقاف البوت.'
        });
    } catch (error) {
        console.error(
            '[STOP ROUTE ERROR]',
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                'تعذر إيقاف البوت.'
        });
    }
});

// ======================================================
// LOGOUT
// ======================================================

app.get('/logout', (req, res) => {
    req.session.destroy(error => {
        if (error) {
            console.error(
                '[LOGOUT ERROR]',
                error
            );
        }

        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// ======================================================
// HEALTH
// ======================================================

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ======================================================
// DISCORD LOGIN TICKETS
// ======================================================

const discordLoginTickets = new Map();

const DISCORD_LOGIN_TICKET_TTL =
    5 * 60 * 1000;

function createDiscordLoginTicket(user) {
    const ticket = crypto
        .randomBytes(32)
        .toString('hex');

    discordLoginTickets.set(
        ticket,
        {
            username: user.username,
            discordId:
                user.discordId || null,
            expiresAt:
                Date.now() +
                DISCORD_LOGIN_TICKET_TTL
        }
    );

    return ticket;
}

function consumeDiscordLoginTicket(ticket) {
    const data =
        discordLoginTickets.get(ticket);

    if (!data) {
        return null;
    }

    discordLoginTickets.delete(ticket);

    if (Date.now() > data.expiresAt) {
        return null;
    }

    return data;
}

setInterval(() => {
    const now = Date.now();

    for (
        const [ticket, data]
        of discordLoginTickets.entries()
    ) {
        if (now > data.expiresAt) {
            discordLoginTickets.delete(ticket);
        }
    }
}, 60000);

// ======================================================
// DISCORD LOGIN ROUTE
// ======================================================

app.get('/discord-login', (req, res) => {
    const ticket = String(
        req.query.ticket || ''
    ).trim();

    if (!ticket) {
        return res
            .status(400)
            .send(
                'رابط تسجيل الدخول غير صالح.'
            );
    }

    const ticketData =
        consumeDiscordLoginTicket(ticket);

    if (!ticketData) {
        return res
            .status(401)
            .send(
                'انتهت صلاحية رابط تسجيل الدخول.'
            );
    }

    const db = getDB();

    const user = db.users.find(
        u =>
            u.username ===
            ticketData.username
    );

    if (!user) {
        return res
            .status(404)
            .send(
                'لم يتم العثور على الحساب.'
            );
    }

    req.session.user = {
        username: user.username,
        isAdmin: Boolean(user.isAdmin)
    };

    req.session.save(error => {
        if (error) {
            console.error(
                '[DISCORD LOGIN SESSION ERROR]',
                error
            );

            return res
                .status(500)
                .send(
                    'تعذر تسجيل الدخول.'
                );
        }

        res.redirect('/');
    });
});

// ======================================================
// START WEBSITE
// ======================================================

const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `Website: ${SITE_URL}`
        );
    }
);

server.on('error', error => {
    console.error(
        '[HTTP SERVER ERROR]',
        error
    );
});

// ======================================================
// MAIN DISCORD CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ======================================================
// RUNNING BOTS
// ======================================================

const runningBots = new Map();

// ======================================================
// PROTECTION BOT
// ======================================================

function setupProtectionBot(
    botClient,
    bot
) {
    botClient.on(
        'guildMemberAdd',
        async member => {
            console.log(
                `[PROTECTION] Member joined ${member.guild.name}: ${member.user.tag}`
            );
        }
    );

    botClient.on(
        'guildMemberRemove',
        async member => {
            console.log(
                `[PROTECTION] Member left ${member.guild.name}: ${member.user.tag}`
            );
        }
    );

    botClient.on(
        'messageCreate',
        async message => {
            if (message.author.bot) {
                return;
            }

            if (message.content === '!ping') {
                await message.reply(
                    '🏓 Pong!'
                );
            }
        }
    );
}

// ======================================================
// WELCOME BOT
// ======================================================

function setupWelcomeBot(
    botClient,
    bot
) {
    botClient.on(
        'guildMemberAdd',
        async member => {
            const channel =
                member.guild.systemChannel;

            if (!channel) {
                return;
            }

            await channel.send(
                `👋 أهلاً وسهلاً ${member} في ${member.guild.name}!`
            );
        }
    );

    botClient.on(
        'messageCreate',
        async message => {
            if (message.author.bot) {
                return;
            }

            if (message.content === '!ping') {
                await message.reply(
                    '🏓 Pong!'
                );
            }
        }
    );
}

// ======================================================
// TICKETS BOT
// ======================================================

function setupTicketsBot(
    botClient,
    bot
) {
    botClient.on(
        'messageCreate',
        async message => {
            if (message.author.bot) {
                return;
            }

            if (message.content === '!ticket') {
                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            '🎫 الدعم الفني'
                        )
                        .setDescription(
                            'اضغط على الزر لفتح تذكرة.'
                        )
                        .setColor(
                            0x0099ff
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    'create_ticket'
                                )
                                .setLabel(
                                    'فتح تذكرة'
                                )
                                .setStyle(
                                    ButtonStyle.Primary
                                )
                        );

                await message.channel.send({
                    embeds: [embed],
                    components: [row]
                });
            }
        }
    );

    botClient.on(
        'interactionCreate',
        async interaction => {
            if (!interaction.isButton()) {
                return;
            }

            if (
                interaction.customId !==
                'create_ticket'
            ) {
                return;
            }

            try {
                if (!interaction.guild) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                const channelName =
                    `ticket-${interaction.user.username}`
                        .toLowerCase()
                        .replace(
                            /[^a-z0-9-_]/g,
                            ''
                        )
                        .slice(0, 80) ||
                    `ticket-${interaction.user.id}`;

                const channel =
                    await interaction.guild.channels.create({
                        name: channelName,
                        type:
                            ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id:
                                    interaction.guild.roles.everyone.id,
                                deny: [
                                    PermissionFlagsBits.ViewChannel
                                ]
                            },
                            {
                                id:
                                    interaction.user.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.ReadMessageHistory
                                ]
                            }
                        ]
                    });

                await channel.send(
                    `🎫 أهلاً ${interaction.user}، تم فتح التذكرة.`
                );

                await interaction.reply({
                    content:
                        `✅ تم فتح التذكرة: ${channel}`,
                    ephemeral: true
                });
            } catch (error) {
                console.error(
                    '[TICKET ERROR]',
                    error
                );

                if (!interaction.replied) {
                    await interaction.reply({
                        content:
                            '❌ تعذر إنشاء التذكرة. تأكد من صلاحيات البوت.',
                        ephemeral: true
                    });
                }
            }
        }
    );
}

// ======================================================
// START MANAGED BOT
// ======================================================

async function startManagedBot(bot) {
    if (!bot) {
        console.error(
            '[BOT START] Bot not found'
        );

        return {
            success: false,
            message:
                'البوت غير موجود.'
        };
    }

    if (!bot.token) {
        console.error(
            `[BOT START] ${bot.name} has no token`
        );

        updateBotStatus(
            bot.id,
            'متوقف'
        );

        return {
            success: false,
            message:
                'توكن البوت غير موجود.'
        };
    }

    if (runningBots.has(bot.id)) {
        return {
            success: true,
            message:
                'البوت يعمل بالفعل.'
        };
    }

    let botClient = null;

    try {
        botClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });

        botClient.once(
            'ready',
            () => {
                console.log(
                    `[BOT READY] ${bot.name} -> ${botClient.user.tag}`
                );

                updateBotStatus(
                    bot.id,
                    'يعمل'
                );
            }
        );

        botClient.on(
            'error',
            error => {
                console.error(
                    `[BOT ERROR] ${bot.name}:`,
                    error
                );
            }
        );

        botClient.on(
            'shardError',
            error => {
                console.error(
                    `[BOT SHARD ERROR] ${bot.name}:`,
                    error
                );
            }
        );

        botClient.on(
            'warn',
            warning => {
                console.warn(
                    `[BOT WARN] ${bot.name}:`,
                    warning
                );
            }
        );

        const type =
            safeBotType(bot.type);

        console.log(
            `[BOT START] ${bot.name} | Type: ${type}`
        );

        if (type === 'protection') {
            setupProtectionBot(
                botClient,
                bot
            );
        } else if (type === 'welcome') {
            setupWelcomeBot(
                botClient,
                bot
            );
        } else if (type === 'tickets') {
            setupTicketsBot(
                botClient,
                bot
            );
        } else if (type === 'bot') {
            // البوت العام حالياً يستخدم !ping.
            botClient.on(
                'messageCreate',
                async message => {
                    if (message.author.bot) {
                        return;
                    }

                    if (
                        message.content ===
                        '!ping'
                    ) {
                        await message.reply(
                            '🏓 Pong!'
                        );
                    }
                }
            );
        } else {
            console.warn(
                `[BOT START] Unknown bot type: ${bot.type}`
            );
        }

        console.log(
            `[BOT LOGIN] Trying to login ${bot.name}...`
        );

        await botClient.login(
            bot.token
        );

        runningBots.set(
            bot.id,
            botClient
        );

        updateBotStatus(
            bot.id,
            'يعمل'
        );

        console.log(
            `[BOT STARTED] ${bot.name}`
        );

        return {
            success: true,
            message:
                'تم تشغيل البوت بنجاح.'
        };
    } catch (error) {
        console.error(
            '================================'
        );

        console.error(
            `[BOT START FAILED] ${bot.name}`
        );

        console.error(
            'Message:',
            error.message
        );

        console.error(
            'Code:',
            error.code
        );

        console.error(
            'Stack:',
            error.stack
        );

        console.error(
            '================================'
        );

        if (botClient) {
            try {
                botClient.destroy();
            } catch (destroyError) {
                console.error(
                    '[BOT DESTROY AFTER ERROR]',
                    destroyError
                );
            }
        }

        runningBots.delete(
            bot.id
        );

        updateBotStatus(
            bot.id,
            'متوقف'
        );

        let message =
            error.message ||
            'تعذر تشغيل البوت.';

        if (
            error.code ===
            'TokenInvalid'
        ) {
            message =
                'توكن البوت غير صالح. ادخل إلى Discord Developer Portal وخذ Bot Token جديد ثم استبدله.';
        }

        return {
            success: false,
            message
        };
    }
}

// ======================================================
// PENDING DISCORD VERIFICATIONS
// ======================================================

const discordPendingRegistrations =
    new Map();

const discordPendingLogins =
    new Map();

const DISCORD_CODE_TTL =
    10 * 60 * 1000;

// ======================================================
// CLEAN PENDING CODES
// ======================================================

setInterval(() => {
    const now = Date.now();

    for (
        const [
            userId,
            data
        ]
        of discordPendingRegistrations.entries()
    ) {
        if (now > data.expiresAt) {
            discordPendingRegistrations.delete(
                userId
            );
        }
    }

    for (
        const [
            userId,
            data
        ]
        of discordPendingLogins.entries()
    ) {
        if (now > data.expiresAt) {
            discordPendingLogins.delete(
                userId
            );
        }
    }
}, 60000);

// ======================================================
// MAIN BOT READY
// ======================================================

client.once(
    'ready',
    () => {
        console.log(
            `Discord Bot logged in as ${client.user.tag}`
        );
    }
);

client.on(
    'error',
    error => {
        console.error(
            '[MAIN DISCORD CLIENT ERROR]',
            error
        );
    }
);

client.on(
    'shardError',
    error => {
        console.error(
            '[MAIN DISCORD SHARD ERROR]',
            error
        );
    }
);

// ======================================================
// !SETUP
// ======================================================

client.on(
    'messageCreate',
    async message => {
        if (message.author.bot) {
            return;
        }

        if (message.content !== '!setup') {
            return;
        }

        const embed =
            new EmbedBuilder()
                .setTitle(
                    'AbuSaud Store | تسجيل وفتح الحسابات'
                )
                .setDescription(
                    'انقر على الزر بالأسفل لإنشاء حساب جديد أو تسجيل الدخول.'
                )
                .setColor(
                    0x0099ff
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            'open_register_modal'
                        )
                        .setLabel(
                            'إنشاء حساب جديد'
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            'open_login_modal'
                        )
                        .setLabel(
                            'تسجيل الدخول'
                        )
                        .setStyle(
                            ButtonStyle.Success
                        )
                );

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });

        await message
            .delete()
            .catch(() => {});
    }
);

// ======================================================
// MAIN DISCORD INTERACTIONS
// ======================================================

client.on(
    'interactionCreate',
    async interaction => {
        try {
            if (interaction.isButton()) {
                // REGISTER MODAL
                if (
                    interaction.customId ===
                    'open_register_modal'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'register_modal'
                            )
                            .setTitle(
                                'إنشاء حساب جديد'
                            );

                    const username =
                        new TextInputBuilder()
                            .setCustomId(
                                'reg_username'
                            )
                            .setLabel(
                                'اسم المستخدم'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                50
                            );

                    const email =
                        new TextInputBuilder()
                            .setCustomId(
                                'reg_email'
                            )
                            .setLabel(
                                'البريد الإلكتروني'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                150
                            );

                    const password =
                        new TextInputBuilder()
                            .setCustomId(
                                'reg_password'
                            )
                            .setLabel(
                                'كلمة المرور'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMinLength(
                                6
                            )
                            .setMaxLength(
                                100
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                username
                            ),
                        new ActionRowBuilder()
                            .addComponents(
                                email
                            ),
                        new ActionRowBuilder()
                            .addComponents(
                                password
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // LOGIN MODAL
                if (
                    interaction.customId ===
                    'open_login_modal'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'login_modal'
                            )
                            .setTitle(
                                'تسجيل الدخول'
                            );

                    const email =
                        new TextInputBuilder()
                            .setCustomId(
                                'login_email'
                            )
                            .setLabel(
                                'البريد الإلكتروني'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                150
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                email
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // REGISTER VERIFY
                if (
                    interaction.customId ===
                    'open_register_verify'
                ) {
                    const pending =
                        discordPendingRegistrations.get(
                            interaction.user.id
                        );

                    if (!pending) {
                        return interaction.reply({
                            content:
                                'لا توجد عملية تسجيل معلقة.',
                            ephemeral: true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {
                        discordPendingRegistrations.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                'انتهت صلاحية الكود.',
                            ephemeral: true
                        });
                    }

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'verify_modal'
                            )
                            .setTitle(
                                'تأكيد كود إنشاء الحساب'
                            );

                    const code =
                        new TextInputBuilder()
                            .setCustomId(
                                'verify_code'
                            )
                            .setLabel(
                                'أدخل الكود المرسل للخاص'
                            )
                            .setPlaceholder(
                                'مثال: 224574'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setMinLength(
                                6
                            )
                            .setMaxLength(
                                6
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                code
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // LOGIN VERIFY
                if (
                    interaction.customId ===
                    'open_login_verify'
                ) {
                    const pending =
                        discordPendingLogins.get(
                            interaction.user.id
                        );

                    if (!pending) {
                        return interaction.reply({
                            content:
                                'لا يوجد تسجيل دخول معلق.',
                            ephemeral: true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {
                        discordPendingLogins.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                'انتهت صلاحية الكود.',
                            ephemeral: true
                        });
                    }

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'login_verify_modal'
                            )
                            .setTitle(
                                'تأكيد تسجيل الدخول'
                            );

                    const code =
                        new TextInputBuilder()
                            .setCustomId(
                                'login_verify_code'
                            )
                            .setLabel(
                                'أدخل الكود المرسل للخاص'
                            )
                            .setPlaceholder(
                                'مثال: 224574'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setMinLength(
                                6
                            )
                            .setMaxLength(
                                6
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                code
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }
            }

            if (interaction.isModalSubmit()) {
                // REGISTER
                if (
                    interaction.customId ===
                    'register_modal'
                ) {
                    const username =
                        interaction.fields
                            .getTextInputValue(
                                'reg_username'
                            )
                            .trim();

                    const email =
                        interaction.fields
                            .getTextInputValue(
                                'reg_email'
                            )
                            .trim()
                            .toLowerCase();

                    const password =
                        interaction.fields
                            .getTextInputValue(
                                'reg_password'
                            );

                    const db = getDB();

                    if (
                        !username ||
                        !email ||
                        !password
                    ) {
                        return interaction.reply({
                            content:
                                '❌ أكمل جميع البيانات.',
                            ephemeral: true
                        });
                    }

                    if (
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                            email
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ أدخل بريد إلكتروني صحيح.',
                            ephemeral: true
                        });
                    }

                    if (
                        password.length < 6
                    ) {
                        return interaction.reply({
                            content:
                                '❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل.',
                            ephemeral: true
                        });
                    }

                    if (
                        db.users.some(
                            u =>
                                u.username
                                    .toLowerCase() ===
                                username.toLowerCase()
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ اسم المستخدم مستخدم مسبقاً.',
                            ephemeral: true
                        });
                    }

                    if (
                        db.users.some(
                            u =>
                                u.email &&
                                u.email
                                    .toLowerCase() ===
                                email
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ البريد الإلكتروني مستخدم مسبقاً.',
                            ephemeral: true
                        });
                    }

                    const oldDiscordAccount =
                        findUserByDiscordId(
                            interaction.user.id
                        );

                    if (oldDiscordAccount) {
                        return interaction.reply({
                            content:
                                '❌ حساب Discord الخاص بك مرتبط بحساب موجود مسبقاً.',
                            ephemeral: true
                        });
                    }

                    const code =
                        makeCode();

                    discordPendingRegistrations.set(
                        interaction.user.id,
                        {
                            username,
                            email,
                            password,
                            codeHash:
                                hashCode(code),
                            expiresAt:
                                Date.now() +
                                DISCORD_CODE_TTL
                        }
                    );

                    try {
                        await interaction.user.send(
                            `مرحباً **${username}** 👋

كود التحقق الخاص بإنشاء حسابك في **AbuSaud Store** هو:

\`\`\`
${code}
\`\`\`

الكود صالح لمدة **10 دقائق**.

بعد استلام الكود ارجع للسيرفر واضغط:

**إدخال كود التحقق**`
                        );

                        const row =
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(
                                            'open_register_verify'
                                        )
                                        .setLabel(
                                            'إدخال كود التحقق'
                                        )
                                        .setStyle(
                                            ButtonStyle.Primary
                                        )
                                );

                        return interaction.reply({
                            content:
                                '📩 تم إرسال الكود إلى الخاص.',
                            components: [row],
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error(
                            '[REGISTER DM ERROR]',
                            error
                        );

                        discordPendingRegistrations.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                '❌ تعذر إرسال رسالة خاصة لك. فعّل الـDM وحاول مرة أخرى.',
                            ephemeral: true
                        });
                    }
                }

                // REGISTER VERIFY
                if (
                    interaction.customId ===
                    'verify_modal'
                ) {
                    const enteredCode =
                        interaction.fields
                            .getTextInputValue(
                                'verify_code'
                            )
                            .trim();

                    const pending =
                        discordPendingRegistrations.get(
                            interaction.user.id
                        );

                    if (!pending) {
                        return interaction.reply({
                            content:
                                '❌ انتهت جلسة التسجيل.',
                            ephemeral: true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {
                        discordPendingRegistrations.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                '❌ انتهت صلاحية الكود.',
                            ephemeral: true
                        });
                    }

                    if (
                        !/^\d{6}$/.test(
                            enteredCode
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ الكود يجب أن يكون 6 أرقام.',
                            ephemeral: true
                        });
                    }

                    if (
                        hashCode(
                            enteredCode
                        ) !== pending.codeHash
                    ) {
                        return interaction.reply({
                            content:
                                '❌ الكود غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db = getDB();

                    if (
                        db.users.some(
                            u =>
                                u.username
                                    .toLowerCase() ===
                                pending.username.toLowerCase()
                        ) ||
                        db.users.some(
                            u =>
                                u.email &&
                                u.email
                                    .toLowerCase() ===
                                pending.email.toLowerCase()
                        )
                    ) {
                        discordPendingRegistrations.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                '❌ الحساب أو البريد مستخدم مسبقاً.',
                            ephemeral: true
                        });
                    }

                    db.users.push({
                        username:
                            pending.username,
                        password:
                            pending.password,
                        email:
                            pending.email,
                        isAdmin: false,
                        emailVerified: true,
                        discordId:
                            interaction.user.id
                    });

                    saveDB(db);

                    discordPendingRegistrations.delete(
                        interaction.user.id
                    );

                    return interaction.reply({
                        content:
                            '✅ تم إنشاء حسابك بنجاح.',
                        ephemeral: true
                    });
                }

                // LOGIN
                if (
                    interaction.customId ===
                    'login_modal'
                ) {
                    const email =
                        interaction.fields
                            .getTextInputValue(
                                'login_email'
                            )
                            .trim()
                            .toLowerCase();

                    const db = getDB();

                    const user =
                        db.users.find(
                            u =>
                                u.email &&
                                u.email
                                    .toLowerCase() ===
                                email
                        );

                    if (!user) {
                        return interaction.reply({
                            content:
                                '❌ لم يتم العثور على الحساب.',
                            ephemeral: true
                        });
                    }

                    if (
                        user.discordId &&
                        user.discordId !==
                        interaction.user.id
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الحساب مرتبط بحساب Discord آخر.',
                            ephemeral: true
                        });
                    }

                    const code =
                        makeCode();

                    discordPendingLogins.set(
                        interaction.user.id,
                        {
                            username:
                                user.username,
                            codeHash:
                                hashCode(code),
                            expiresAt:
                                Date.now() +
                                DISCORD_CODE_TTL
                        }
                    );

                    try {
                        await interaction.user.send(
                            `مرحباً **${user.username}** 👋

كود تسجيل الدخول إلى **AbuSaud Store** هو:

\`\`\`
${code}
\`\`\`

الكود صالح لمدة **10 دقائق**.

ارجع للسيرفر واضغط:

**إدخال كود الدخول**`
                        );

                        const row =
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(
                                            'open_login_verify'
                                        )
                                        .setLabel(
                                            'إدخال كود الدخول'
                                        )
                                        .setStyle(
                                            ButtonStyle.Success
                                        )
                                );

                        return interaction.reply({
                            content:
                                '📩 تم إرسال كود الدخول إلى الخاص.',
                            components: [row],
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error(
                            '[LOGIN DM ERROR]',
                            error
                        );

                        discordPendingLogins.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                '❌ تعذر إرسال الكود للخاص.',
                            ephemeral: true
                        });
                    }
                }

                // LOGIN VERIFY
                if (
                    interaction.customId ===
                    'login_verify_modal'
                ) {
                    const enteredCode =
                        interaction.fields
                            .getTextInputValue(
                                'login_verify_code'
                            )
                            .trim();

                    const pending =
                        discordPendingLogins.get(
                            interaction.user.id
                        );

                    if (!pending) {
                        return interaction.reply({
                            content:
                                '❌ لا يوجد تسجيل دخول معلق.',
                            ephemeral: true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {
                        discordPendingLogins.delete(
                            interaction.user.id
                        );

                        return interaction.reply({
                            content:
                                '❌ انتهت صلاحية الكود.',
                            ephemeral: true
                        });
                    }

                    if (
                        !/^\d{6}$/.test(
                            enteredCode
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ الكود يجب أن يكون 6 أرقام.',
                            ephemeral: true
                        });
                    }

                    if (
                        hashCode(
                            enteredCode
                        ) !== pending.codeHash
                    ) {
                        return interaction.reply({
                            content:
                                '❌ الكود غير صحيح.',
                            ephemeral: true
                        });
                    }

                    discordPendingLogins.delete(
                        interaction.user.id
                    );

                    const db = getDB();

                    const user =
                        db.users.find(
                            u =>
                                u.username ===
                                pending.username
                        );

                    if (!user) {
                        return interaction.reply({
                            content:
                                '❌ الحساب غير موجود.',
                            ephemeral: true
                        });
                    }

                    if (
                        user.discordId &&
                        user.discordId !==
                        interaction.user.id
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الحساب مرتبط بحساب Discord آخر.',
                            ephemeral: true
                        });
                    }

                    if (!user.discordId) {
                        user.discordId =
                            interaction.user.id;

                        saveDB(db);
                    }

                    const ticket =
                        createDiscordLoginTicket({
                            username:
                                user.username,
                            discordId:
                                interaction.user.id
                        });

                    const loginUrl =
                        `${SITE_URL}/discord-login?ticket=${encodeURIComponent(ticket)}`;

                    const button =
                        new ButtonBuilder()
                            .setLabel(
                                'دخول إلى الموقع'
                            )
                            .setStyle(
                                ButtonStyle.Link
                            )
                            .setURL(
                                loginUrl
                            );

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                button
                            );

                    return interaction.reply({
                        content:
                            '✅ تم التحقق من الكود.\n\nاضغط دخول إلى الموقع.',
                        components: [row],
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error(
                '[MAIN INTERACTION ERROR]',
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '❌ حدث خطأ غير متوقع.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ======================================================
// !ADMIN
// ======================================================

client.on(
    'messageCreate',
    async message => {
        if (message.author.bot) {
            return;
        }

        if (message.content !== '!admin') {
            return;
        }

        if (
            message.author.id !==
            ADMIN_DISCORD_ID
        ) {
            return message.reply(
                '❌ هذا الأمر خاص بصاحب البوت فقط.'
            );
        }

        const embed =
            new EmbedBuilder()
                .setTitle(
                    '🛠️ لوحة الإدارة الخاصة'
                )
                .setDescription(
                    'من هنا تقدر تختار أي حساب موجود بالموقع وتدير البوتات الخاصة به.'
                )
                .setColor(
                    0x0099ff
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            'admin_accounts'
                        )
                        .setLabel(
                            '👤 اختيار حساب'
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            'admin_all_bots'
                        )
                        .setLabel(
                            '🤖 جميع البوتات'
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        )
                );

        return message.reply({
            embeds: [embed],
            components: [row]
        });
    }
);

// ======================================================
// ADMIN INTERACTIONS
// ======================================================

client.on(
    'interactionCreate',
    async interaction => {
        try {
            if (
                !interaction.isButton() &&
                !interaction.isStringSelectMenu() &&
                !interaction.isModalSubmit()
            ) {
                return;
            }

            const id =
                interaction.customId || '';

            if (
                id.startsWith('admin_') &&
                !isAdminUser(interaction)
            ) {
                return interaction.reply({
                    content:
                        '❌ هذه اللوحة خاصة بصاحب البوت فقط.',
                    ephemeral: true
                }).catch(() => {});
            }

            // SELECT ACCOUNT
            if (
                interaction.isButton() &&
                id === 'admin_accounts'
            ) {
                const users =
                    getAdminUsers();

                if (!users.length) {
                    return interaction.reply({
                        content:
                            '❌ لا توجد حسابات.',
                        ephemeral: true
                    });
                }

                const options =
                    users
                        .slice(0, 25)
                        .map(
                            (
                                user,
                                index
                            ) => ({
                                label:
                                    String(
                                        user.username
                                    ).slice(
                                        0,
                                        100
                                    ),

                                description:
                                    String(
                                        user.email ||
                                        'بدون بريد إلكتروني'
                                    ).slice(
                                        0,
                                        100
                                    ),

                                value:
                                    `admin_user_${index}`
                            })
                        );

                const menu =
                    new StringSelectMenuBuilder()
                        .setCustomId(
                            'admin_select_user'
                        )
                        .setPlaceholder(
                            'اختر حساب...'
                        )
                        .addOptions(
                            options
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            menu
                        );

                return interaction.reply({
                    content:
                        '👤 اختر الحساب الذي تريد إدارته:',
                    components: [row],
                    ephemeral: true
                });
            }

            // ALL BOTS
            if (
                interaction.isButton() &&
                id === 'admin_all_bots'
            ) {
                const db = getDB();

                if (!db.bots.length) {
                    return interaction.reply({
                        content:
                            '🤖 لا توجد بوتات حالياً.',
                        ephemeral: true
                    });
                }

                const text =
                    db.bots
                        .slice(0, 20)
                        .map(
                            (
                                bot,
                                index
                            ) =>
                                `**${index + 1}. ${bot.name || 'بدون اسم'}**\n` +
                                `👤 الحساب: ${bot.owner || 'غير محدد'}\n` +
                                `📦 النوع: ${bot.type || 'غير محدد'}\n` +
                                `🟢 الحالة: ${bot.status || 'مضاف'}`
                        )
                        .join(
                            '\n\n'
                        );

                return interaction.reply({
                    content:
                        `🤖 **البوتات الموجودة:**\n\n${text}`,
                    ephemeral: true
                });
            }

            // SELECT USER
            if (
                interaction.isStringSelectMenu() &&
                id === 'admin_select_user'
            ) {
                const index =
                    Number(
                        interaction.values[0]
                            .replace(
                                'admin_user_',
                                ''
                            )
                    );

                const users =
                    getAdminUsers();

                const user =
                    users[index];

                if (!user) {
                    return interaction.reply({
                        content:
                            '❌ الحساب غير موجود.',
                        ephemeral: true
                    });
                }

                const bots =
                    getUserBots(
                        user.username
                    );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `👤 حساب: ${user.username}`
                        )
                        .setDescription(
                            `📧 البريد: ${
                                user.email ||
                                'بدون بريد'
                            }\n\n` +
                            `🤖 عدد البوتات: **${bots.length}**`
                        )
                        .setColor(
                            0x00b7ff
                        );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `admin_add_${index}`
                                )
                                .setLabel(
                                    '➕ إضافة بوت'
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `admin_list_${index}`
                                )
                                .setLabel(
                                    '📋 بوتات الحساب'
                                )
                                .setStyle(
                                    ButtonStyle.Primary
                                )
                        );

                return interaction.update({
                    content: '',
                    embeds: [embed],
                    components: [row]
                });
            }

            // ADD BOT MODAL
            if (
                interaction.isButton() &&
                id.startsWith('admin_add_')
            ) {
                const index =
                    Number(
                        id.replace(
                            'admin_add_',
                            ''
                        )
                    );

                const users =
                    getAdminUsers();

                const user =
                    users[index];

                if (!user) {
                    return interaction.reply({
                        content:
                            '❌ الحساب غير موجود.',
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `admin_add_modal_${index}`
                        )
                        .setTitle(
                            `إضافة بوت لـ ${user.username}`
                        );

                const botName =
                    new TextInputBuilder()
                        .setCustomId(
                            'admin_bot_name'
                        )
                        .setLabel(
                            'اسم البوت'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(
                            true
                        )
                        .setMaxLength(
                            100
                        );

                const botToken =
                    new TextInputBuilder()
                        .setCustomId(
                            'admin_bot_token'
                        )
                        .setLabel(
                            'Bot Token'
                        )
                        .setStyle(
                            TextInputStyle.Paragraph
                        )
                        .setRequired(
                            true
                        );

                const botType =
                    new TextInputBuilder()
                        .setCustomId(
                            'admin_bot_type'
                        )
                        .setLabel(
                            'نوع البوت'
                        )
                        .setPlaceholder(
                            'Welcome / Tickets / Protection / bot'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(
                            true
                        )
                        .setMaxLength(
                            50
                        );

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            botName
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            botToken
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            botType
                        )
                );

                return interaction.showModal(
                    modal
                );
            }

            // LIST USER BOTS
            if (
                interaction.isButton() &&
                id.startsWith('admin_list_')
            ) {
                const index =
                    Number(
                        id.replace(
                            'admin_list_',
                            ''
                        )
                    );

                const users =
                    getAdminUsers();

                const user =
                    users[index];

                if (!user) {
                    return interaction.reply({
                        content:
                            '❌ الحساب غير موجود.',
                        ephemeral: true
                    });
                }

                const bots =
                    getUserBots(
                        user.username
                    );

                if (!bots.length) {
                    return interaction.reply({
                        content:
                            `🤖 حساب **${user.username}** لا يملك بوتات حالياً.`,
                        ephemeral: true
                    });
                }

                const text =
                    bots
                        .slice(0, 20)
                        .map(
                            (
                                bot,
                                i
                            ) =>
                                `${i + 1}. **${bot.name || 'بدون اسم'}** — ${bot.type || 'غير محدد'} — ${bot.status || 'مضاف'}`
                        )
                        .join(
                            '\n'
                        );

                return interaction.reply({
                    content:
                        `🤖 **بوتات ${user.username}:**\n\n${text}`,
                    ephemeral: true
                });
            }

            // ADD BOT SUBMIT
            if (
                interaction.isModalSubmit() &&
                id.startsWith(
                    'admin_add_modal_'
                )
            ) {
                const index =
                    Number(
                        id.replace(
                            'admin_add_modal_',
                            ''
                        )
                    );

                const users =
                    getAdminUsers();

                const user =
                    users[index];

                if (!user) {
                    return interaction.reply({
                        content:
                            '❌ الحساب غير موجود.',
                        ephemeral: true
                    });
                }

                const name =
                    interaction.fields
                        .getTextInputValue(
                            'admin_bot_name'
                        )
                        .trim();

                const token =
                    interaction.fields
                        .getTextInputValue(
                            'admin_bot_token'
                        )
                        .trim();

                const type =
                    interaction.fields
                        .getTextInputValue(
                            'admin_bot_type'
                        )
                        .trim();

                if (
                    !name ||
                    !token ||
                    !type
                ) {
                    return interaction.reply({
                        content:
                            '❌ أكمل جميع البيانات.',
                        ephemeral: true
                    });
                }

                const db = getDB();

                const newBot = {
                    id:
                        crypto
                            .randomBytes(8)
                            .toString('hex'),

                    name,
                    token,
                    type,

                    owner:
                        user.username,

                    ownerDiscordId:
                        user.discordId ||
                        null,

                    status:
                        'متوقف',

                    createdAt:
                        new Date()
                            .toISOString()
                };

                db.bots.push(
                    newBot
                );

                saveDB(db);

                return interaction.reply({
                    content:
                        `✅ تم إضافة البوت **${name}** وربطه بحساب **${user.username}**.\n\n📦 النوع: ${type}\n🔴 الحالة: متوقف`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error(
                '[ADMIN INTERACTION ERROR]',
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '❌ حدث خطأ أثناء تنفيذ العملية.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown(signal) {
    console.log(
        `[SHUTDOWN] ${signal}`
    );

    for (
        const [botId, botClient]
        of runningBots.entries()
    ) {
        try {
            botClient.destroy();
        } catch (error) {
            console.error(
                `[SHUTDOWN BOT ERROR] ${botId}`,
                error
            );
        }
    }

    runningBots.clear();

    try {
        client.destroy();
    } catch (error) {
        console.error(
            '[SHUTDOWN MAIN DISCORD ERROR]',
            error
        );
    }

    server.close(() => {
        process.exit(0);
    });

    setTimeout(
        () => process.exit(0),
        5000
    );
}

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '[UNHANDLED REJECTION]',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '[UNCAUGHT EXCEPTION]',
            error
        );
    }
);

// ======================================================
// DISCORD LOGIN
// ======================================================

const discordToken =
    process.env.DISCORD_TOKEN;

console.log(
    '[Discord] Token exists:',
    Boolean(discordToken)
);

console.log(
    '[Discord] Token length:',
    discordToken
        ? discordToken.length
        : 0
);

if (!discordToken) {
    console.error(
        '[Discord] DISCORD_TOKEN is missing from Railway Variables.'
    );
} else {
    client.login(
        discordToken
    ).catch(
        error => {
            console.error(
                '[Discord] Login failed:',
                error.message
            );

            // لا نغلق سيرفر الموقع إذا فشل Discord.
            // الموقع يبقى شغال حتى تقدر تصلح التوكن.
        }
    );
}
