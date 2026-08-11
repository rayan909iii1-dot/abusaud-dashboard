const express = require('express');
const session = require('express-session');
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
    PermissionsBitField,
    ChannelType
} = require('discord.js');

const app = express();

// ======================================================
// SETTINGS
// ======================================================

const PORT = Number(process.env.PORT || 3000);

const SITE_URL =
    process.env.SITE_URL ||
    'https://abusaud-dashboard-production.up.railway.app';

const ADMIN_DISCORD_ID =
    '1113483140086907093';

// ======================================================
// EXPRESS
// ======================================================

app.set('trust proxy', 1);

app.set(
    'view engine',
    'ejs'
);

app.set(
    'views',
    path.join(__dirname, 'views')
);

app.use(
    express.json()
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(
        path.join(__dirname, 'public')
    )
);

// ======================================================
// SESSIONS
// ======================================================
// استخدمنا MemoryStore لتجنب مشكلة:
// session-file-store ENOENT
//
// للمشروع الحالي وعلى Railway Instance واحدة هذا كافي.
// ======================================================

app.use(
    session({

        secret:
            process.env.SESSION_SECRET ||
            'CHANGE_THIS_SESSION_SECRET_123456789',

        resave: false,

        saveUninitialized: false,

        cookie: {

            secure:
                process.env.NODE_ENV === 'production',

            httpOnly: true,

            sameSite: 'lax',

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                7
        }
    })
);

// ======================================================
// DATABASE
// ======================================================

const databasePath =
    path.join(
        __dirname,
        'database.json'
    );

function getDB() {

    if (
        !fs.existsSync(
            databasePath
        )
    ) {

        const initial = {

            users: [
                {
                    username: 'abu saud',
                    password: '123456',
                    email: 'admin@example.com',
                    isAdmin: true,
                    emailVerified: true,
                    discordId: ADMIN_DISCORD_ID
                }
            ],

            bots: []
        };

        fs.writeFileSync(
            databasePath,
            JSON.stringify(
                initial,
                null,
                2
            ),
            'utf8'
        );
    }

    try {

        const data =
            JSON.parse(
                fs.readFileSync(
                    databasePath,
                    'utf8'
                )
            );

        if (
            !Array.isArray(
                data.users
            )
        ) {
            data.users = [];
        }

        if (
            !Array.isArray(
                data.bots
            )
        ) {
            data.bots = [];
        }

        return data;

    } catch (error) {

        console.error(
            '[DATABASE ERROR]',
            error.message
        );

        return {
            users: [],
            bots: []
        };
    }
}

function saveDB(data) {

    try {

        fs.writeFileSync(
            databasePath,
            JSON.stringify(
                data,
                null,
                2
            ),
            'utf8'
        );

        return true;

    } catch (error) {

        console.error(
            '[DATABASE SAVE ERROR]',
            error.message
        );

        return false;
    }
}

// ======================================================
// HELPERS
// ======================================================

function escapeHtml(value) {

    return String(value)
        .replaceAll(
            '&',
            '&amp;'
        )
        .replaceAll(
            '<',
            '&lt;'
        )
        .replaceAll(
            '>',
            '&gt;'
        )
        .replaceAll(
            '"',
            '&quot;'
        )
        .replaceAll(
            "'",
            '&#039;'
        );
}

function makeCode() {

    return crypto
        .randomInt(
            100000,
            1000000
        )
        .toString();
}

function hashCode(code) {

    return crypto
        .createHash('sha256')
        .update(String(code))
        .digest('hex');
}

function getPendingRegistration(req) {

    return (
        req.session.pendingRegistration ||
        null
    );
}

function isLoggedIn(req) {

    return Boolean(
        req.session &&
        req.session.user
    );
}

function isAdmin(req) {

    return Boolean(
        req.session &&
        req.session.user &&
        req.session.user.isAdmin
    );
}

// ======================================================
// EMAIL
// ======================================================

const mailTransporter =
    nodemailer.createTransport({

        host:
            process.env.SMTP_HOST ||
            'smtp-relay.brevo.com',

        port:
            Number(
                process.env.SMTP_PORT ||
                587
            ),

        secure: false,

        auth: {

            user:
                process.env.SMTP_USER,

            pass:
                process.env.SMTP_PASS
        },

        tls: {
            rejectUnauthorized: false
        }
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

        to:
            email,

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

<h2>
AbuSaud Store
</h2>

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
// EMBED DATA
// ======================================================

const embedData = {

    siteUrl:
        SITE_URL,

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

app.get(
    '/',
    (req, res) => {

        if (!req.session.user) {

            return res.render(
                'login',
                {
                    error: null,
                    embed: embedData
                }
            );
        }

        const db =
            getDB();

        const admin =
            Boolean(
                req.session.user.isAdmin
            );

        const bots =
            admin
                ? db.bots
                : db.bots.filter(
                    bot =>
                        bot.owner ===
                        req.session.user.username
                );

        return res.render(
            'index',
            {

                currentUser:
                    req.session.user.username,

                isAdmin:
                    admin,

                bots,

                allUsers:
                    db.users,

                availableScripts: [
                    'Welcome',
                    'bot',
                    'Tickets',
                    'Protection'
                ],

                embed:
                    embedData
            }
        );
    }
);

// ======================================================
// LOGIN PAGE
// ======================================================

app.get(
    '/login',
    (req, res) => {

        if (req.session.user) {
            return res.redirect('/');
        }

        return res.render(
            'login',
            {
                error: null,
                embed: embedData
            }
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

app.post(
    '/login',
    (req, res) => {

        const db =
            getDB();

        const username =
            String(
                req.body.username ||
                ''
            ).trim();

        const password =
            String(
                req.body.password ||
                ''
            );

        const user =
            db.users.find(
                u =>
                    u.username ===
                    username &&
                    u.password ===
                    password
            );

        if (!user) {

            return res.render(
                'login',
                {

                    error:
                        'بيانات الدخول غير صحيحة',

                    embed:
                        embedData
                }
            );
        }

        if (
            user.email &&
            user.emailVerified === false
        ) {

            return res.render(
                'login',
                {

                    error:
                        'يجب تأكيد بريدك الإلكتروني أولاً.',

                    embed:
                        embedData
                }
            );
        }

        req.session.user = {

            username:
                user.username,

            isAdmin:
                Boolean(
                    user.isAdmin
                ),

            discordId:
                user.discordId ||
                null
        };

        req.session.save(
            error => {

                if (error) {

                    console.error(
                        '[SESSION ERROR]',
                        error
                    );

                    return res
                        .status(500)
                        .send(
                            'حدث خطأ في الجلسة.'
                        );
                }

                return res.redirect('/');
            }
        );
    }
);

// ======================================================
// REGISTER PAGE
// ======================================================

app.get(
    '/register',
    (req, res) => {

        if (req.session.user) {
            return res.redirect('/');
        }

        return res.render(
            'register',
            {
                error: null,
                embed: embedData
            }
        );
    }
);

// ======================================================
// REGISTER
// ======================================================

app.post(
    '/register',
    async (req, res) => {

        const db =
            getDB();

        const username =
            String(
                req.body.username ||
                ''
            ).trim();

        const email =
            String(
                req.body.email ||
                ''
            )
                .trim()
                .toLowerCase();

        const password =
            String(
                req.body.password ||
                ''
            );

        if (
            !username ||
            !email ||
            !password
        ) {

            return res.render(
                'register',
                {

                    error:
                        'يرجى تعبئة جميع البيانات',

                    embed:
                        embedData
                }
            );
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(email)
        ) {

            return res.render(
                'register',
                {

                    error:
                        'يرجى إدخال بريد إلكتروني صحيح',

                    embed:
                        embedData
                }
            );
        }

        if (
            password.length < 6
        ) {

            return res.render(
                'register',
                {

                    error:
                        'كلمة المرور يجب أن تكون 6 أحرف على الأقل',

                    embed:
                        embedData
                }
            );
        }

        if (
            db.users.some(
                u =>
                    String(
                        u.username
                    )
                        .toLowerCase() ===
                    username.toLowerCase()
            )
        ) {

            return res.render(
                'register',
                {

                    error:
                        'اسم المستخدم موجود مسبقاً',

                    embed:
                        embedData
                }
            );
        }

        if (
            db.users.some(
                u =>
                    u.email &&
                    String(
                        u.email
                    )
                        .toLowerCase() ===
                    email
            )
        ) {

            return res.render(
                'register',
                {

                    error:
                        'هذا البريد الإلكتروني مستخدم مسبقاً',

                    embed:
                        embedData
                }
            );
        }

        const code =
            makeCode();

        req.session.pendingRegistration = {

            username,

            email,

            password,

            codeHash:
                hashCode(code),

            expiresAt:
                Date.now() +
                10 * 60 * 1000,

            lastSentAt:
                Date.now()
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

                new Promise(
                    (_, reject) =>
                        setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        'SMTP_TIMEOUT'
                                    )
                                ),
                            8000
                        )
                )
            ]);

            return res.render(
                'verify',
                {

                    error: null,

                    email,

                    embed:
                        embedData
                }
            );

        } catch (error) {

            console.error(
                '[EMAIL ERROR]',
                error.message
            );

            return res.render(
                'verify',
                {

                    error:
                        'تعذر إرسال الإيميل، والكود موجود في Railway Logs.',

                    email,

                    embed:
                        embedData
                }
            );
        }
    }
);

// ======================================================
// VERIFY EMAIL PAGE
// ======================================================

app.get(
    '/verify-email',
    (req, res) => {

        const pending =
            getPendingRegistration(req);

        if (!pending) {
            return res.redirect('/register');
        }

        return res.render(
            'verify',
            {

                error: null,

                email:
                    pending.email,

                embed:
                    embedData
            }
        );
    }
);

// ======================================================
// VERIFY EMAIL
// ======================================================

app.post(
    '/verify-email',
    (req, res) => {

        const pending =
            getPendingRegistration(req);

        const code =
            String(
                req.body.code ||
                ''
            ).trim();

        if (!pending) {
            return res.redirect('/register');
        }

        if (
            Date.now() >
            pending.expiresAt
        ) {

            delete req.session
                .pendingRegistration;

            return res.render(
                'register',
                {

                    error:
                        'انتهت صلاحية الكود. أعد التسجيل.',

                    embed:
                        embedData
                }
            );
        }

        if (
            !/^\d{6}$/.test(code) ||
            hashCode(code) !==
            pending.codeHash
        ) {

            return res.render(
                'verify',
                {

                    error:
                        'كود التحقق غير صحيح',

                    email:
                        pending.email,

                    embed:
                        embedData
                }
            );
        }

        const db =
            getDB();

        db.users.push({

            username:
                pending.username,

            password:
                pending.password,

            email:
                pending.email,

            isAdmin:
                false,

            emailVerified:
                true,

            discordId:
                null
        });

        saveDB(db);

        req.session.user = {

            username:
                pending.username,

            isAdmin:
                false,

            discordId:
                null
        };

        delete req.session
            .pendingRegistration;

        req.session.save(
            () => {
                res.redirect('/');
            }
        );
    }
);

// ======================================================
// RESEND VERIFICATION
// ======================================================

app.post(
    '/resend-verification',
    async (req, res) => {

        const pending =
            getPendingRegistration(req);

        if (!pending) {
            return res.redirect('/register');
        }

        const wait =
            60000 -
            (
                Date.now() -
                pending.lastSentAt
            );

        if (wait > 0) {

            return res.render(
                'verify',
                {

                    error:
                        `انتظر ${Math.ceil(
                            wait / 1000
                        )} ثانية.`,

                    email:
                        pending.email,

                    embed:
                        embedData
                }
            );
        }

        const code =
            makeCode();

        pending.codeHash =
            hashCode(code);

        pending.expiresAt =
            Date.now() +
            10 * 60 * 1000;

        pending.lastSentAt =
            Date.now();

        console.log(
            `[RESEND CODE] ${pending.username}: ${code}`
        );

        try {

            await sendVerificationEmail(
                pending.email,
                pending.username,
                code
            );

            return res.render(
                'verify',
                {

                    error:
                        'تم إرسال كود جديد.',

                    email:
                        pending.email,

                    success:
                        true,

                    embed:
                        embedData
                }
            );

        } catch (error) {

            console.error(
                '[RESEND ERROR]',
                error.message
            );

            return res.render(
                'verify',
                {

                    error:
                        'تعذر إرسال الكود.',

                    email:
                        pending.email,

                    embed:
                        embedData
                }
            );
        }
    }
);

// ======================================================
// LOGOUT
// ======================================================

app.get(
    '/logout',
    (req, res) => {

        req.session.destroy(
            () => {
                res.redirect('/login');
            }
        );
    }
);

// ======================================================
// HEALTH
// ======================================================

app.get(
    '/health',
    (req, res) => {

        return res
            .status(200)
            .json({
                success: true,
                status: 'online'
            });
    }
);

// ======================================================
// DISCORD LOGIN TICKETS
// ======================================================

const discordLoginTickets =
    new Map();

const DISCORD_LOGIN_TICKET_TTL =
    5 * 60 * 1000;

function createDiscordLoginTicket(user) {

    const ticket =
        crypto
            .randomBytes(32)
            .toString('hex');

    discordLoginTickets.set(
        ticket,
        {

            username:
                user.username,

            discordId:
                user.discordId ||
                null,

            expiresAt:
                Date.now() +
                DISCORD_LOGIN_TICKET_TTL
        }
    );

    return ticket;
}

function consumeDiscordLoginTicket(ticket) {

    const data =
        discordLoginTickets.get(
            ticket
        );

    if (!data) {
        return null;
    }

    discordLoginTickets.delete(
        ticket
    );

    if (
        Date.now() >
        data.expiresAt
    ) {
        return null;
    }

    return data;
}

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                ticket,
                data
            ]
            of discordLoginTickets
                .entries()
        ) {

            if (
                now >
                data.expiresAt
            ) {

                discordLoginTickets
                    .delete(ticket);
            }
        }

    },
    60000
);

// ======================================================
// DISCORD LOGIN ROUTE
// ======================================================

app.get(
    '/discord-login',
    (req, res) => {

        const ticket =
            String(
                req.query.ticket ||
                ''
            ).trim();

        if (!ticket) {

            return res
                .status(400)
                .send(
                    'رابط تسجيل الدخول غير صالح.'
                );
        }

        const ticketData =
            consumeDiscordLoginTicket(
                ticket
            );

        if (!ticketData) {

            return res
                .status(401)
                .send(
                    'انتهت صلاحية رابط تسجيل الدخول.'
                );
        }

        const db =
            getDB();

        const user =
            db.users.find(
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

            username:
                user.username,

            isAdmin:
                Boolean(
                    user.isAdmin
                ),

            discordId:
                user.discordId ||
                ticketData.discordId ||
                null
        };

        req.session.save(
            error => {

                if (error) {

                    console.error(
                        '[DISCORD SESSION ERROR]',
                        error.message
                    );

                    return res
                        .status(500)
                        .send(
                            'تعذر تسجيل الدخول.'
                        );
                }

                return res.redirect('/');
            }
        );
    }
);

// ======================================================
// ADD BOT FROM WEBSITE
// ======================================================

app.post(
    '/add-bot',
    (req, res) => {

        if (!isAdmin(req)) {

            return res
                .status(403)
                .json({
                    success: false,
                    message: 'غير مصرح.'
                });
        }

        const db =
            getDB();

        const name =
            String(
                req.body.name ||
                req.body.botName ||
                ''
            ).trim();

        const token =
            String(
                req.body.token ||
                ''
            ).trim();

        const type =
            String(
                req.body.type ||
                'bot'
            ).trim();

        const owner =
            String(
                req.body.owner ||
                ''
            ).trim();

        if (
            !name ||
            !token
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        'اسم البوت والتوكن مطلوبان.'
                });
        }

        const bot = {

            id:
                crypto
                    .randomBytes(8)
                    .toString('hex'),

            name,

            token,

            type,

            owner:
                owner ||
                req.session.user.username,

            ownerDiscordId:
                null,

            status:
                'مضاف',

            createdAt:
                new Date()
                    .toISOString()
        };

        db.bots.push(bot);

        saveDB(db);

        return res.redirect('/');
    }
);

// ======================================================
// BOT MANAGER
// ======================================================

const runningBots =
    new Map();

function updateBotStatus(
    botId,
    status
) {

    const db =
        getDB();

    const bot =
        db.bots.find(
            b =>
                b.id ===
                botId
        );

    if (!bot) {
        return;
    }

    bot.status =
        status;

    bot.lastStatusUpdate =
        new Date()
            .toISOString();

    saveDB(db);

    console.log(
        `[BOT STATUS] ${bot.name}: ${status}`
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

            try {

                const channelId =
                    bot.welcomeChannelId ||
                    bot.channelId;

                if (!channelId) {
                    return;
                }

                const channel =
                    await member.guild.channels
                        .fetch(channelId)
                        .catch(
                            () => null
                        );

                if (
                    !channel ||
                    !channel.isTextBased()
                ) {
                    return;
                }

                const message =
                    bot.welcomeMessage ||
                    `أهلاً وسهلاً بك ${member} في ${member.guild.name}! 👋`;

                await channel.send({
                    content:
                        message
                });

            } catch (error) {

                console.error(
                    `[WELCOME ERROR] ${bot.name}:`,
                    error.message
                );
            }
        }
    );
}

// ======================================================
// PROTECTION BOT
// ======================================================

function setupProtectionBot(
    botClient,
    bot
) {

    const antiRaid =
        new Map();

    botClient.on(
        'guildMemberAdd',
        async member => {

            try {

                const guildId =
                    member.guild.id;

                const now =
                    Date.now();

                const old =
                    antiRaid.get(
                        guildId
                    ) || [];

                const recent =
                    old.filter(
                        time =>
                            now - time <
                            10000
                    );

                recent.push(now);

                antiRaid.set(
                    guildId,
                    recent
                );

                const limit =
                    Number(
                        bot.raidLimit ||
                        10
                    );

                if (
                    recent.length >=
                    limit
                ) {

                    console.log(
                        `[PROTECTION] Possible raid detected in ${member.guild.name}`
                    );
                }

            } catch (error) {

                console.error(
                    `[PROTECTION ERROR] ${bot.name}:`,
                    error.message
                );
            }
        }
    );

    botClient.on(
        'guildBanAdd',
        async ban => {

            console.log(
                `[PROTECTION] Ban detected in ${ban.guild.name}: ${ban.user.tag}`
            );
        }
    );

    botClient.on(
        'guildMemberRemove',
        async member => {

            // يمكن إضافة أنظمة الحماية هنا لاحقاً
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
        'interactionCreate',
        async interaction => {

            try {

                if (
                    !interaction.isButton()
                ) {
                    return;
                }

                if (
                    interaction.customId !==
                    'ticket_create'
                ) {
                    return;
                }

                const guild =
                    interaction.guild;

                if (!guild) {
                    return;
                }

                const existing =
                    guild.channels.cache.find(
                        channel =>
                            channel.name ===
                            `ticket-${interaction.user.id}`
                    );

                if (existing) {

                    return interaction.reply({

                        content:
                            `لديك تذكرة مفتوحة بالفعل: ${existing}`,

                        ephemeral:
                            true
                    });
                }

                const channel =
                    await guild.channels.create({

                        name:
                            `ticket-${interaction.user.id}`,

                        type:
                            ChannelType.GuildText,

                        permissionOverwrites: [

                            {
                                id:
                                    guild.roles.everyone.id,

                                deny: [
                                    PermissionsBitField.Flags.ViewChannel
                                ]
                            },

                            {
                                id:
                                    interaction.user.id,

                                allow: [
                                    PermissionsBitField.Flags.ViewChannel,
                                    PermissionsBitField.Flags.SendMessages,
                                    PermissionsBitField.Flags.ReadMessageHistory
                                ]
                            }
                        ]
                    });

                await channel.send({

                    content:
                        `${interaction.user}`,

                    embeds: [

                        new EmbedBuilder()

                            .setTitle(
                                '🎫 تذكرتك'
                            )

                            .setDescription(
                                'اكتب مشكلتك هنا وسيتم مساعدتك.'
                            )

                            .setColor(
                                0x0099ff
                            )
                    ]
                });

                return interaction.reply({

                    content:
                        `تم إنشاء التذكرة: ${channel}`,

                    ephemeral:
                        true
                });

            } catch (error) {

                console.error(
                    `[TICKETS ERROR] ${bot.name}:`,
                    error.message
                );
            }
        }
    );
}

// ======================================================
// GENERIC BOT SETUP
// ======================================================

function setupGenericBot(
    botClient,
    bot
) {

    // بوت عادي بدون نظام خاص
}

// ======================================================
// START MANAGED BOT
// ======================================================

async function startManagedBot(
    bot
) {

    if (
        !bot ||
        !bot.id
    ) {
        return false;
    }

    if (
        !bot.token ||
        typeof bot.token !== 'string'
    ) {

        updateBotStatus(
            bot.id,
            'توكن غير موجود'
        );

        return false;
    }

    if (
        runningBots.has(
            bot.id
        )
    ) {

        return true;
    }

    const botClient =
        new Client({

            intents: [

                GatewayIntentBits.Guilds,

                GatewayIntentBits.GuildMembers,

                GatewayIntentBits.GuildModeration,

                GatewayIntentBits.GuildMessages,

                GatewayIntentBits.MessageContent
            ]
        });

    botClient.once(
        'clientReady',
        () => {

            console.log(
                `[BOT MANAGER] ${bot.name} is online as ${botClient.user.tag}`
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
                `[MANAGED BOT ERROR] ${bot.name}:`,
                error.message
            );
        }
    );

    botClient.on(
        'shardError',
        error => {

            console.error(
                `[MANAGED BOT SHARD ERROR] ${bot.name}:`,
                error.message
            );
        }
    );

    const type =
        String(
            bot.type ||
            'bot'
        )
            .toLowerCase()
            .trim();

    if (
        type ===
        'protection'
    ) {

        setupProtectionBot(
            botClient,
            bot
        );

    } else if (
        type ===
        'welcome'
    ) {

        setupWelcomeBot(
            botClient,
            bot
        );

    } else if (
        type ===
        'tickets'
    ) {

        setupTicketsBot(
            botClient,
            bot
        );

    } else {

        setupGenericBot(
            botClient,
            bot
        );
    }

    try {

        console.log(
            `[BOT MANAGER] Starting ${bot.name}...`
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

        return true;

    } catch (error) {

        console.error(
            `[BOT MANAGER] Failed to start ${bot.name}:`,
            error.message
        );

        updateBotStatus(
            bot.id,
            'متوقف'
        );

        try {
            botClient.destroy();
        } catch (_) {}

        // مهم جداً:
        // لا نرمي الخطأ حتى لا يسقط السيرفر.
        return false;
    }
}

// ======================================================
// STOP MANAGED BOT
// ======================================================

async function stopManagedBot(
    botId
) {

    const botClient =
        runningBots.get(
            botId
        );

    if (!botClient) {

        updateBotStatus(
            botId,
            'متوقف'
        );

        return true;
    }

    try {

        botClient.destroy();

    } catch (error) {

        console.error(
            '[BOT STOP ERROR]',
            error.message
        );
    }

    runningBots.delete(
        botId
    );

    updateBotStatus(
        botId,
        'متوقف'
    );

    return true;
}

// ======================================================
// RESTART BOT
// ======================================================

async function restartManagedBot(
    botId
) {

    const db =
        getDB();

    const bot =
        db.bots.find(
            b =>
                b.id ===
                botId
        );

    if (!bot) {
        return false;
    }

    await stopManagedBot(
        botId
    );

    await new Promise(
        resolve =>
            setTimeout(
                resolve,
                1000
            )
    );

    return startManagedBot(
        bot
    );
}

// ======================================================
// START BOT ROUTE
// ======================================================

app.post(
    '/start/:id',
    async (req, res) => {

        if (!isAdmin(req)) {

            return res
                .status(403)
                .json({

                    success: false,

                    message:
                        'غير مصرح لك.'
                });
        }

        const db =
            getDB();

        const bot =
            db.bots.find(
                b =>
                    b.id ===
                    req.params.id
            );

        if (!bot) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        'البوت غير موجود.'
                });
        }

        const success =
            await startManagedBot(
                bot
            );

        if (!success) {

            return res
                .status(400)
                .json({

                    success: false,

                    message:
                        'تعذر تشغيل البوت.'
                });
        }

        return res.json({

            success: true,

            message:
                'تم تشغيل البوت بنجاح.'
        });
    }
);

// ======================================================
// STOP BOT ROUTE
// ======================================================

app.post(
    '/stop/:id',
    async (req, res) => {

        if (!isAdmin(req)) {

            return res
                .status(403)
                .json({

                    success: false,

                    message:
                        'غير مصرح لك.'
                });
        }

        const db =
            getDB();

        const bot =
            db.bots.find(
                b =>
                    b.id ===
                    req.params.id
            );

        if (!bot) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        'البوت غير موجود.'
                });
        }

        await stopManagedBot(
            bot.id
        );

        return res.json({

            success: true,

            message:
                'تم إيقاف البوت.'
        });
    }
);

// ======================================================
// RESTART BOT ROUTE
// ======================================================

app.post(
    '/restart/:id',
    async (req, res) => {

        if (!isAdmin(req)) {

            return res
                .status(403)
                .json({

                    success: false,

                    message:
                        'غير مصرح لك.'
                });
        }

        const success =
            await restartManagedBot(
                req.params.id
            );

        if (!success) {

            return res
                .status(400)
                .json({

                    success: false,

                    message:
                        'تعذر إعادة تشغيل البوت.'
                });
        }

        return res.json({

            success: true,

            message:
                'تم إعادة تشغيل البوت.'
        });
    }
);

// ======================================================
// BOT STATUS API
// ======================================================

app.get(
    '/api/bots/:id/status',
    (req, res) => {

        if (!isLoggedIn(req)) {

            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        'غير مسجل الدخول.'
                });
        }

        const db =
            getDB();

        const bot =
            db.bots.find(
                b =>
                    b.id ===
                    req.params.id
            );

        if (!bot) {

            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        'البوت غير موجود.'
                });
        }

        if (
            !req.session.user.isAdmin &&
            bot.owner !==
            req.session.user.username
        ) {

            return res
                .status(403)
                .json({
                    success: false,
                    message:
                        'غير مصرح.'
                });
        }

        return res.json({

            success: true,

            running:
                runningBots.has(
                    bot.id
                ),

            status:
                bot.status ||
                'متوقف'
        });
    }
);

// ======================================================
// DELETE BOT
// ======================================================

app.post(
    '/delete-bot/:id',
    async (req, res) => {

        if (!isAdmin(req)) {

            return res
                .status(403)
                .json({

                    success: false,

                    message:
                        'غير مصرح لك.'
                });
        }

        const db =
            getDB();

        const index =
            db.bots.findIndex(
                b =>
                    b.id ===
                    req.params.id
            );

        if (index === -1) {

            return res
                .status(404)
                .json({

                    success: false,

                    message:
                        'البوت غير موجود.'
                });
        }

        await stopManagedBot(
            req.params.id
        );

        const removed =
            db.bots.splice(
                index,
                1
            )[0];

        saveDB(db);

        return res.json({

            success: true,

            message:
                `تم حذف البوت ${removed.name}.`
        });
    }
);

// ======================================================
// DISCORD CLIENT
// ======================================================

const client =
    new Client({

        intents: [

            GatewayIntentBits.Guilds,

            GatewayIntentBits.GuildMessages,

            GatewayIntentBits.MessageContent
        ]
    });

// ======================================================
// PENDING DISCORD REGISTRATIONS
// ======================================================

const discordPendingRegistrations =
    new Map();

const discordPendingLogins =
    new Map();

// ======================================================
// DISCORD READY
// ======================================================

client.once(
    'clientReady',
    async () => {

        console.log(
            `Discord Bot logged in as ${client.user.tag}`
        );

        // تشغيل البوتات المحفوظة
        // لكن فشل أي بوت لا يسقط السيرفر.

        const db =
            getDB();

        console.log(
            `[BOT MANAGER] Found ${db.bots.length} saved bot(s).`
        );

        for (
            const bot
            of db.bots
        ) {

            try {

                await startManagedBot(
                    bot
                );

            } catch (error) {

                console.error(
                    `[BOT MANAGER] Unexpected error with ${bot.name}:`,
                    error.message
                );

                updateBotStatus(
                    bot.id,
                    'متوقف'
                );
            }
        }
    }
);

// ======================================================
// !SETUP
// ======================================================

client.on(
    'messageCreate',
    async message => {

        if (
            message.author.bot
        ) {
            return;
        }

        if (
            message.content !==
            '!setup'
        ) {
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

            embeds: [
                embed
            ],

            components: [
                row
            ]
        });

        await message
            .delete()
            .catch(
                () => {}
            );
    }
);

// ======================================================
// DISCORD LOGIN / REGISTER INTERACTIONS
// ======================================================

client.on(
    'interactionCreate',
    async interaction => {

        try {

            // ==================================================
            // BUTTONS
            // ==================================================

            if (
                interaction.isButton()
            ) {

                // REGISTER
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

                // LOGIN
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
                        discordPendingRegistrations
                            .get(
                                interaction.user.id
                            );

                    if (!pending) {

                        return interaction.reply({

                            content:
                                'لا توجد عملية تسجيل معلقة.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {

                        discordPendingRegistrations
                            .delete(
                                interaction.user.id
                            );

                        return interaction.reply({

                            content:
                                'انتهت صلاحية الكود.',

                            ephemeral:
                                true
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
                        discordPendingLogins
                            .get(
                                interaction.user.id
                            );

                    if (!pending) {

                        return interaction.reply({

                            content:
                                'لا يوجد تسجيل دخول معلق.',

                            ephemeral:
                                true
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

            // ==================================================
            // MODALS
            // ==================================================

            if (
                interaction.isModalSubmit()
            ) {

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

                    const db =
                        getDB();

                    if (
                        !username ||
                        !email ||
                        !password
                    ) {

                        return interaction.reply({

                            content:
                                '❌ أكمل جميع البيانات.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                            .test(email)
                    ) {

                        return interaction.reply({

                            content:
                                '❌ البريد الإلكتروني غير صحيح.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        password.length < 6
                    ) {

                        return interaction.reply({

                            content:
                                '❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        db.users.some(
                            u =>
                                u.username
                                    .toLowerCase() ===
                                username
                                    .toLowerCase()
                        )
                    ) {

                        return interaction.reply({

                            content:
                                '❌ اسم المستخدم مستخدم مسبقاً.',

                            ephemeral:
                                true
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

                            ephemeral:
                                true
                        });
                    }

                    const code =
                        makeCode();

                    discordPendingRegistrations
                        .set(
                            interaction.user.id,
                            {

                                username,

                                email,

                                password,

                                codeHash:
                                    hashCode(
                                        code
                                    ),

                                expiresAt:
                                    Date.now() +
                                    10 * 60 * 1000
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

                            components: [
                                row
                            ],

                            ephemeral:
                                true
                        });

                    } catch (error) {

                        console.error(
                            '[DISCORD REGISTER DM]',
                            error.message
                        );

                        discordPendingRegistrations
                            .delete(
                                interaction.user.id
                            );

                        return interaction.reply({

                            content:
                                '❌ تعذر إرسال رسالة خاصة لك. فعّل الـDM وحاول مرة أخرى.',

                            ephemeral:
                                true
                        });
                    }
                }

                // VERIFY REGISTER
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
                        discordPendingRegistrations
                            .get(
                                interaction.user.id
                            );

                    if (!pending) {

                        return interaction.reply({

                            content:
                                '❌ انتهت جلسة التسجيل.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {

                        discordPendingRegistrations
                            .delete(
                                interaction.user.id
                            );

                        return interaction.reply({

                            content:
                                '❌ انتهت صلاحية الكود.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        !/^\d{6}$/
                            .test(
                                enteredCode
                            )
                    ) {

                        return interaction.reply({

                            content:
                                '❌ الكود يجب أن يكون 6 أرقام.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        hashCode(
                            enteredCode
                        ) !==
                        pending.codeHash
                    ) {

                        return interaction.reply({

                            content:
                                '❌ الكود غير صحيح.',

                            ephemeral:
                                true
                        });
                    }

                    const db =
                        getDB();

                    db.users.push({

                        username:
                            pending.username,

                        password:
                            pending.password,

                        email:
                            pending.email,

                        isAdmin:
                            false,

                        emailVerified:
                            true,

                        discordId:
                            interaction.user.id
                    });

                    saveDB(db);

                    discordPendingRegistrations
                        .delete(
                            interaction.user.id
                        );

                    return interaction.reply({

                        content:
                            '✅ تم إنشاء حسابك بنجاح.',

                        ephemeral:
                            true
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

                    const db =
                        getDB();

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

                            ephemeral:
                                true
                        });
                    }

                    const code =
                        makeCode();

                    discordPendingLogins
                        .set(
                            interaction.user.id,
                            {

                                username:
                                    user.username,

                                codeHash:
                                    hashCode(
                                        code
                                    ),

                                expiresAt:
                                    Date.now() +
                                    10 * 60 * 1000
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

                            components: [
                                row
                            ],

                            ephemeral:
                                true
                        });

                    } catch (error) {

                        console.error(
                            '[DISCORD LOGIN DM]',
                            error.message
                        );

                        return interaction.reply({

                            content:
                                '❌ تعذر إرسال الكود للخاص.',

                            ephemeral:
                                true
                        });
                    }
                }

                // VERIFY LOGIN
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
                        discordPendingLogins
                            .get(
                                interaction.user.id
                            );

                    if (!pending) {

                        return interaction.reply({

                            content:
                                '❌ لا يوجد تسجيل دخول معلق.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        Date.now() >
                        pending.expiresAt
                    ) {

                        discordPendingLogins
                            .delete(
                                interaction.user.id
                            );

                        return interaction.reply({

                            content:
                                '❌ انتهت صلاحية الكود.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        !/^\d{6}$/
                            .test(
                                enteredCode
                            )
                    ) {

                        return interaction.reply({

                            content:
                                '❌ الكود يجب أن يكون 6 أرقام.',

                            ephemeral:
                                true
                        });
                    }

                    if (
                        hashCode(
                            enteredCode
                        ) !==
                        pending.codeHash
                    ) {

                        return interaction.reply({

                            content:
                                '❌ الكود غير صحيح.',

                            ephemeral:
                                true
                        });
                    }

                    discordPendingLogins
                        .delete(
                            interaction.user.id
                        );

                    const db =
                        getDB();

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

                            ephemeral:
                                true
                        });
                    }

                    const ticket =
                        createDiscordLoginTicket({

                            username:
                                user.username,

                            discordId:
                                interaction.user.id
                        });

                    const loginUrl =
                        `${SITE_URL}/discord-login?ticket=${encodeURIComponent(
                            ticket
                        )}`;

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

                        components: [
                            row
                        ],

                        ephemeral:
                            true
                    });
                }
            }

        } catch (error) {

            console.error(
                '[INTERACTION ERROR]',
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {

                await interaction.reply({

                    content:
                        '❌ حدث خطأ غير متوقع.',

                    ephemeral:
                        true
                }).catch(
                    () => {}
                );
            }
        }
    }
);

// ======================================================
// ADMIN HELPERS
// ======================================================

function isAdminUser(
    interaction
) {

    return (
        interaction.user &&
        interaction.user.id ===
        ADMIN_DISCORD_ID
    );
}

function getAdminUsers() {

    return getDB().users;
}

function getUserBots(
    username
) {

    return getDB()
        .bots
        .filter(
            bot =>
                bot.owner ===
                username
        );
}

// ======================================================
// !ADMIN
// ======================================================

client.on(
    'messageCreate',
    async message => {

        if (
            message.author.bot
        ) {
            return;
        }

        if (
            message.content !==
            '!admin'
        ) {
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

            embeds: [
                embed
            ],

            components: [
                row
            ]
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

            const customId =
                interaction.customId ||
                '';

            if (
                customId.startsWith(
                    'admin_'
                )
            ) {

                if (
                    !isAdminUser(
                        interaction
                    )
                ) {

                    return interaction.reply({

                        content:
                            '❌ هذه اللوحة خاصة بصاحب البوت فقط.',

                        ephemeral:
                            true
                    });
                }
            }

            // ==================================================
            // اختيار حساب
            // ==================================================

            if (
                interaction.isButton() &&
                customId ===
                'admin_accounts'
            ) {

                const users =
                    getAdminUsers();

                if (!users.length) {

                    return interaction.reply({

                        content:
                            '❌ لا توجد حسابات.',

                        ephemeral:
                            true
                    });
                }

                const options =
                    users
                        .slice(
                            0,
                            25
                        )
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

                    components: [
                        row
                    ],

                    ephemeral:
                        true
                });
            }

            // ==================================================
            // جميع البوتات
            // ==================================================

            if (
                interaction.isButton() &&
                customId ===
                'admin_all_bots'
            ) {

                const db =
                    getDB();

                if (
                    !db.bots.length
                ) {

                    return interaction.reply({

                        content:
                            '🤖 لا توجد بوتات حالياً.',

                        ephemeral:
                            true
                    });
                }

                const text =
                    db.bots
                        .slice(
                            0,
                            20
                        )
                        .map(
                            (
                                bot,
                                index
                            ) => {

                                return (
                                    `**${index + 1}. ${bot.name || 'بدون اسم'}**\n` +
                                    `👤 الحساب: ${bot.owner || 'غير محدد'}\n` +
                                    `📦 النوع: ${bot.type || 'غير محدد'}\n` +
                                    `🟢 الحالة: ${bot.status || 'مضاف'}`
                                );
                            }
                        )
                        .join(
                            '\n\n'
                        );

                return interaction.reply({

                    content:
                        `🤖 **البوتات الموجودة:**\n\n${text}`,

                    ephemeral:
                        true
                });
            }

            // ==================================================
            // اختيار الحساب
            // ==================================================

            if (
                interaction.isStringSelectMenu() &&
                customId ===
                'admin_select_user'
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

                        ephemeral:
                            true
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

                            `🤖 عدد البوتات: **${
                                bots.length
                            }**`
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

                    content:
                        '',

                    embeds: [
                        embed
                    ],

                    components: [
                        row
                    ]
                });
            }

            // ==================================================
            // إضافة بوت
            // ==================================================

            if (
                interaction.isButton() &&
                customId.startsWith(
                    'admin_add_'
                )
            ) {

                const index =
                    Number(
                        customId.replace(
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

                        ephemeral:
                            true
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
                            'Welcome / Tickets / Protection'
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

            // ==================================================
            // عرض بوتات الحساب
            // ==================================================

            if (
                interaction.isButton() &&
                customId.startsWith(
                    'admin_list_'
                )
            ) {

                const index =
                    Number(
                        customId.replace(
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

                        ephemeral:
                            true
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

                        ephemeral:
                            true
                    });
                }

                const text =
                    bots
                        .slice(
                            0,
                            20
                        )
                        .map(
                            (
                                bot,
                                i
                            ) => {

                                return (
                                    `${i + 1}. **${bot.name || 'بدون اسم'}** ` +
                                    `— ${bot.type || 'غير محدد'} ` +
                                    `— ${bot.status || 'مضاف'}`
                                );
                            }
                        )
                        .join(
                            '\n'
                        );

                return interaction.reply({

                    content:
                        `🤖 **بوتات ${user.username}:**\n\n${text}`,

                    ephemeral:
                        true
                });
            }

            // ==================================================
            // حفظ البوت
            // ==================================================

            if (
                interaction.isModalSubmit() &&
                customId.startsWith(
                    'admin_add_modal_'
                )
            ) {

                const index =
                    Number(
                        customId.replace(
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

                        ephemeral:
                            true
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

                        ephemeral:
                            true
                    });
                }

                const db =
                    getDB();

                const bot = {

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
                        'مضاف',

                    createdAt:
                        new Date()
                            .toISOString()
                };

                db.bots.push(
                    bot
                );

                saveDB(db);

                // محاولة تشغيله مباشرة.
                // إذا كان التوكن خطأ، الموقع لا يسقط.

                const started =
                    await startManagedBot(
                        bot
                    );

                return interaction.reply({

                    content:
                        started
                            ? `✅ تم إضافة وتشغيل البوت **${name}** وربطه بحساب **${user.username}**.\n\n📦 النوع: ${type}\n🟢 الحالة: يعمل`
                            : `✅ تم إضافة البوت **${name}** وربطه بحساب **${user.username}**.\n\n📦 النوع: ${type}\n🔴 الحالة: متوقف\n\n⚠️ تأكد أن Bot Token صحيح.`,

                    ephemeral:
                        true
                });
            }

        } catch (error) {

            console.error(
                '[ADMIN INTERACTION ERROR]',
                error.message
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {

                await interaction.reply({

                    content:
                        '❌ حدث خطأ داخل لوحة الإدارة.',

                    ephemeral:
                        true
                }).catch(
                    () => {}
                );
            }
        }
    }
);

// ======================================================
// DISCORD LOGIN
// ======================================================

const discordToken =
    process.env.DISCORD_TOKEN;

console.log(
    '[Discord] Token exists:',
    Boolean(
        discordToken
    )
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
    )
        .catch(
            error => {

                console.error(
                    '[Discord] Main bot login failed:',
                    error.message
                );

                // لا نسوي process.exit هنا
                // حتى لا يطيح الموقع.
            }
        );
}

// ======================================================
// START WEBSITE
// ======================================================

app.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `Website: ${SITE_URL}`
        );

        console.log(
            `[SERVER] Bot manager enabled.`
        );
    }
);

// ======================================================
// GLOBAL ERROR HANDLERS
// ======================================================

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

        // لا نسوي process.exit
        // حتى لا يسقط الموقع بسبب بوت فرعي.
    }
);

