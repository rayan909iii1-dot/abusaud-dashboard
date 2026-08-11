const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

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
    StringSelectMenuBuilder
} = require('discord.js');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || '1113483140086907093';

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

// ======================================================
// DATABASE
// ======================================================

const databasePath = path.join(__dirname, 'database.json');

function getDB() {
    if (!fs.existsSync(databasePath)) {
        const initial = {
            users: [{
                username: 'abu saud',
                password: '123456',
                email: 'admin@example.com',
                isAdmin: true,
                emailVerified: true,
                discordId: ADMIN_DISCORD_ID
            }],
            bots: []
        };

        fs.writeFileSync(databasePath, JSON.stringify(initial, null, 2), 'utf8');
    }

    try {
        const data = JSON.parse(fs.readFileSync(databasePath, 'utf8'));

        if (!Array.isArray(data.users)) data.users = [];
        if (!Array.isArray(data.bots)) data.bots = [];

        return data;
    } catch (error) {
        console.error('[DATABASE ERROR]', error.message);
        return { users: [], bots: [] };
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(databasePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('[DATABASE SAVE ERROR]', error.message);
        return false;
    }
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
    return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function isLoggedIn(req) {
    return Boolean(req.session && req.session.user);
}

function isAdmin(req) {
    return Boolean(req.session && req.session.user && req.session.user.isAdmin);
}

function getUserBots(username) {
    const db = getDB();
    return db.bots.filter(bot => bot.owner === username);
}

function updateBotStatus(botId, status, extra = {}) {
    const db = getDB();
    const bot = db.bots.find(b => b.id === botId);

    if (!bot) return;

    bot.status = status;
    bot.lastStatusUpdate = new Date().toISOString();

    Object.assign(bot, extra);
    saveDB(db);

    console.log(`[BOT STATUS] ${bot.name}: ${status}`);
}

// ======================================================
// EMAIL
// ======================================================

const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendVerificationEmail(email, username, code) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP environment variables are not configured.');
    }

    await mailTransporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'كود التحقق - AbuSaud Store',
        text:
            `مرحباً ${username}\n\n` +
            `كود التحقق الخاص بك هو: ${code}\n\n` +
            `ينتهي الكود خلال 10 دقائق.`,
        html: `
<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;background:#070b14;font-family:Arial,Tahoma,sans-serif;color:#fff;padding:35px">
<div style="max-width:520px;margin:auto;background:#0d1422;border:1px solid #243149;border-radius:18px;padding:30px">
<h2>AbuSaud Store</h2>
<p>مرحباً <b>${escapeHtml(username)}</b>،</p>
<p style="color:#b6c2d4">استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
<div style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;background:#080d17;border:1px solid #273449;border-radius:12px;padding:18px;margin:25px 0">
${escapeHtml(code)}
</div>
<p style="color:#94a3b8;font-size:13px">الكود صالح لمدة 10 دقائق فقط.</p>
</div>
</body>
</html>`
    });
}

// ======================================================
// WEB
// ======================================================

const embedData = {
    siteUrl: SITE_URL,
    title: 'AbuSaud Store | لوحة تحكم البوتات',
    description: 'لوحة تحكم متكاملة لإدارة وتشغيل البوتات بسهولة.',
    image: `${SITE_URL}/images/banner.png`
};

app.get('/', (req, res) => {
    if (!isLoggedIn(req)) {
        return res.render('login', { error: null, embed: embedData });
    }

    const db = getDB();
    const admin = isAdmin(req);

    const bots = admin
        ? db.bots
        : db.bots.filter(bot => bot.owner === req.session.user.username);

    return res.render('index', {
        currentUser: req.session.user.username,
        isAdmin: admin,
        bots,
        allUsers: db.users,
        availableScripts: ['Welcome', 'Tickets', 'Protection', 'bot'],
        embed: embedData
    });
});

app.get('/login', (req, res) => {
    if (isLoggedIn(req)) return res.redirect('/');
    return res.render('login', { error: null, embed: embedData });
});

app.post('/login', (req, res) => {
    const db = getDB();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = db.users.find(u =>
        u.username === username && u.password === password
    );

    if (!user) {
        return res.render('login', {
            error: 'بيانات الدخول غير صحيحة',
            embed: embedData
        });
    }

    if (user.email && user.emailVerified === false) {
        return res.render('login', {
            error: 'يجب تأكيد بريدك الإلكتروني أولاً.',
            embed: embedData
        });
    }

    req.session.user = {
        username: user.username,
        isAdmin: Boolean(user.isAdmin),
        discordId: user.discordId || null
    };

    return req.session.save(() => res.redirect('/'));
});

app.get('/register', (req, res) => {
    if (isLoggedIn(req)) return res.redirect('/');
    return res.render('register', { error: null, embed: embedData });
});

app.post('/register', async (req, res) => {
    const db = getDB();

    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const renderError = error => res.render('register', { error, embed: embedData });

    if (!username || !email || !password) return renderError('يرجى تعبئة جميع البيانات');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderError('يرجى إدخال بريد إلكتروني صحيح');
    if (password.length < 6) return renderError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');

    if (db.users.some(u => String(u.username).toLowerCase() === username.toLowerCase())) {
        return renderError('اسم المستخدم موجود مسبقاً');
    }

    if (db.users.some(u => u.email && String(u.email).toLowerCase() === email)) {
        return renderError('هذا البريد الإلكتروني مستخدم مسبقاً');
    }

    const code = makeCode();

    req.session.pendingRegistration = {
        username,
        email,
        password,
        codeHash: hashCode(code),
        expiresAt: Date.now() + 10 * 60 * 1000,
        lastSentAt: Date.now()
    };

    console.log(`[REGISTER CODE] ${username}: ${code}`);

    try {
        await Promise.race([
            sendVerificationEmail(email, username, code),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 8000)
            )
        ]);

        return res.render('verify', { error: null, email, embed: embedData });
    } catch (error) {
        console.error('[EMAIL ERROR]', error.message);
        return res.render('verify', {
            error: 'تعذر إرسال الإيميل، والكود موجود في Railway Logs.',
            email,
            embed: embedData
        });
    }
});

app.get('/verify-email', (req, res) => {
    const pending = req.session.pendingRegistration;
    if (!pending) return res.redirect('/register');

    return res.render('verify', {
        error: null,
        email: pending.email,
        embed: embedData
    });
});

app.post('/verify-email', (req, res) => {
    const pending = req.session.pendingRegistration;
    const code = String(req.body.code || '').trim();

    if (!pending) return res.redirect('/register');

    if (Date.now() > pending.expiresAt) {
        delete req.session.pendingRegistration;
        return res.render('register', {
            error: 'انتهت صلاحية الكود. أعد التسجيل.',
            embed: embedData
        });
    }

    if (!/^\d{6}$/.test(code) || hashCode(code) !== pending.codeHash) {
        return res.render('verify', {
            error: 'كود التحقق غير صحيح',
            email: pending.email,
            embed: embedData
        });
    }

    const db = getDB();

    if (db.users.some(u => String(u.username).toLowerCase() === pending.username.toLowerCase())) {
        delete req.session.pendingRegistration;
        return res.render('register', {
            error: 'اسم المستخدم أصبح مستخدماً بالفعل',
            embed: embedData
        });
    }

    if (db.users.some(u => u.email && String(u.email).toLowerCase() === pending.email)) {
        delete req.session.pendingRegistration;
        return res.render('register', {
            error: 'البريد الإلكتروني أصبح مستخدماً بالفعل',
            embed: embedData
        });
    }

    db.users.push({
        username: pending.username,
        password: pending.password,
        email: pending.email,
        isAdmin: false,
        emailVerified: true,
        discordId: null
    });

    saveDB(db);

    req.session.user = {
        username: pending.username,
        isAdmin: false,
        discordId: null
    };

    delete req.session.pendingRegistration;

    return req.session.save(() => res.redirect('/'));
});

app.post('/resend-verification', async (req, res) => {
    const pending = req.session.pendingRegistration;
    if (!pending) return res.redirect('/register');

    const wait = 60 * 1000 - (Date.now() - pending.lastSentAt);

    if (wait > 0) {
        return res.render('verify', {
            error: `انتظر ${Math.ceil(wait / 1000)} ثانية قبل إعادة إرسال الكود.`,
            email: pending.email,
            embed: embedData
        });
    }

    const code = makeCode();
    pending.codeHash = hashCode(code);
    pending.expiresAt = Date.now() + 10 * 60 * 1000;
    pending.lastSentAt = Date.now();

    console.log(`[RESEND CODE] ${pending.username}: ${code}`);

    try {
        await Promise.race([
            sendVerificationEmail(pending.email, pending.username, code),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 8000)
            )
        ]);

        return res.render('verify', {
            error: 'تم إرسال كود جديد إلى بريدك الإلكتروني.',
            success: true,
            email: pending.email,
            embed: embedData
        });
    } catch (error) {
        console.error('[RESEND EMAIL ERROR]', error.message);
        return res.render('verify', {
            error: 'تعذر إرسال الإيميل، الكود موجود في Railway Logs.',
            email: pending.email,
            embed: embedData
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// ======================================================
// BOT MANAGER
// ======================================================

const runningBots = new Map();

function normalizeType(type) {
    const value = String(type || 'bot').trim().toLowerCase();

    if (value === 'protection' || value === 'protect') return 'protection';
    if (value === 'welcome') return 'welcome';
    if (value === 'tickets' || value === 'ticket') return 'tickets';

    return 'bot';
}

function updateRunningStatus(bot, status, extra = {}) {
    updateBotStatus(bot.id, status, extra);
}

// ------------------------------------------------------
// Managed Discord Client
// ------------------------------------------------------

function createManagedClient(type = 'bot') {
    const normalized = normalizeType(type);

    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ];

    // Protection needs moderation/audit-log related gateway events.
    if (normalized === 'protection') {
        intents.push(GatewayIntentBits.GuildModeration);
    }

    return new Client({ intents });
}

// ------------------------------------------------------
// WELCOME BOT
// ------------------------------------------------------

function setupWelcomeBot(client, bot) {
    client.once('ready', () => {
        console.log(`[WELCOME] ${bot.name} online as ${client.user.tag}`);

        updateRunningStatus(bot, 'يعمل', {
            discordTag: client.user.tag,
            lastError: null
        });

        client.user.setPresence({
            activities: [{ name: 'Welcome System', type: 3 }],
            status: 'online'
        });
    });

    client.on('guildMemberAdd', async member => {
        try {
            const channelId = bot.welcomeChannelId || bot.channelId;

            // If no channel is configured, do not crash the bot.
            if (!channelId) return;

            const channel = await member.guild.channels
                .fetch(channelId)
                .catch(() => null);

            if (!channel || !channel.isTextBased()) return;

            const message =
                bot.welcomeMessage ||
                `أهلاً وسهلاً بك ${member} في ${member.guild.name}! 👋`;

            await channel.send({ content: message });
        } catch (error) {
            console.error(`[WELCOME ERROR] ${bot.name}:`, error.message);
        }
    });
}

// ------------------------------------------------------
// PROTECTION BOT
// ------------------------------------------------------

function setupProtectionBot(client, bot) {
    const config = {
        whitelist: Array.isArray(bot.whitelist) ? bot.whitelist : [],
        logChannelId: bot.logChannelId || bot.channelId || null,

        raid: {
            enabled: true,
            joinLimit: Number(bot.raidJoinLimit || 5),
            timeWindow: 10_000,
            lockdownDuration: 60_000
        },

        spam: {
            enabled: true,
            messageLimit: 6,
            timeWindow: 5_000,
            muteDuration: 10 * 60 * 1000
        },

        channelDelete: {
            enabled: true,
            limit: 2,
            timeWindow: 10_000
        },

        roleDelete: {
            enabled: true,
            limit: 2,
            timeWindow: 10_000
        },

        channelCreate: {
            enabled: true,
            limit: 5,
            timeWindow: 10_000
        },

        roleCreate: {
            enabled: true,
            limit: 5,
            timeWindow: 10_000
        },

        botProtection: {
            enabled: true,
            allowBots: Array.isArray(bot.allowBots) ? bot.allowBots : []
        }
    };

    const spamMap = new Map();
    const raidJoins = new Map();
    const counters = {
        channelDelete: new Map(),
        roleDelete: new Map(),
        channelCreate: new Map(),
        roleCreate: new Map()
    };
    const lockdowns = new Map();

    const isWhitelisted = id =>
        Boolean(id) && config.whitelist.includes(id);

    const isProtectedBot = id =>
        Boolean(id) && config.botProtection.allowBots.includes(id);

    function getLogChannel(guild) {
        if (!config.logChannelId) return null;
        return guild.channels.cache.get(config.logChannelId) || null;
    }

    async function sendLog(guild, title, description, color = 0x3b82f6) {
        try {
            const channel = getLogChannel(guild);
            if (!channel || !channel.isTextBased()) return;

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(description)
                .setTimestamp()
                .setFooter({ text: 'Protection System' });

            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(`[PROTECTION LOG ERROR] ${bot.name}:`, error.message);
        }
    }

    async function getExecutor(guild, type, targetId) {
        try {
            const logs = await guild.fetchAuditLogs({
                type,
                limit: 10
            });

            const entry = logs.entries.find(entry =>
                entry.target?.id === targetId &&
                Date.now() - entry.createdTimestamp < 10_000
            );

            return entry?.executor || null;
        } catch (error) {
            console.error(
                `[AUDIT LOG ERROR] ${bot.name}:`,
                error.message
            );
            return null;
        }
    }

    async function punish(guild, userId, reason) {
        try {
            if (!userId || isWhitelisted(userId)) return;

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;

            if (
                member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                await sendLog(
                    guild,
                    'تم اكتشاف محاولة تخريب',
                    `العضو: <@${userId}>\nالسبب: ${reason}\nلم يتم اتخاذ إجراء بسبب امتلاكه Administrator.`,
                    0xf59e0b
                );
                return;
            }

            try {
                await member.kick(reason);
            } catch {
                try {
                    await member.timeout(
                        24 * 60 * 60 * 1000,
                        reason
                    );
                } catch {}
            }

            await sendLog(
                guild,
                'تم اتخاذ إجراء أمني',
                `العضو: <@${userId}>\nالسبب: **${reason}**`,
                0xef4444
            );
        } catch (error) {
            console.error(`[PUNISH ERROR] ${bot.name}:`, error.message);
        }
    }

    function cleanCounter(map, guildId, timeWindow) {
        const now = Date.now();
        const values = (map.get(guildId) || [])
            .filter(timestamp => now - timestamp <= timeWindow);

        map.set(guildId, values);
        return values;
    }

    client.once('ready', () => {
        console.log(`[PROTECTION] ${bot.name} online as ${client.user.tag}`);

        updateRunningStatus(bot, 'يعمل', {
            discordTag: client.user.tag,
            lastError: null
        });

        client.user.setPresence({
            activities: [{ name: 'Protection System', type: 3 }],
            status: 'online'
        });
    });

    // Anti Raid + unauthorized bot protection
    client.on('guildMemberAdd', async member => {
        try {
            if (member.user.bot) {
                if (
                    config.botProtection.enabled &&
                    !isProtectedBot(member.id)
                ) {
                    const executor = await getExecutor(
                        member.guild,
                        AuditLogEvent.BotAdd,
                        member.id
                    );

                    if (executor && !isWhitelisted(executor.id)) {
                        await punish(
                            member.guild,
                            executor.id,
                            'إضافة بوت غير مصرح به'
                        );

                        await member.kick(
                            'Protection Bot: Unauthorized Bot'
                        ).catch(() => {});
                    }
                }

                return;
            }

            if (!config.raid.enabled) return;

            const guildId = member.guild.id;
            const now = Date.now();

            const recent = (raidJoins.get(guildId) || [])
                .filter(time => now - time <= config.raid.timeWindow);

            recent.push(now);
            raidJoins.set(guildId, recent);

            if (
                recent.length >= config.raid.joinLimit &&
                !lockdowns.has(guildId)
            ) {
                lockdowns.set(guildId, true);

                await sendLog(
                    member.guild,
                    'Anti-Raid Activated',
                    `تم اكتشاف دخول **${recent.length}** أعضاء خلال فترة قصيرة.\n\nتم تفعيل وضع الحماية.`,
                    0xef4444
                );

                try {
                    await member.guild.setVerificationLevel(
                        4,
                        'Protection Bot: Anti-Raid'
                    );
                } catch {}

                setTimeout(async () => {
                    try {
                        await member.guild.setVerificationLevel(
                            1,
                            'Protection Bot: Raid Protection Ended'
                        );
                    } catch {}

                    lockdowns.delete(guildId);
                    raidJoins.delete(guildId);

                    await sendLog(
                        member.guild,
                        'Anti-Raid Deactivated',
                        'انتهت فترة الحماية وعاد النظام للوضع الطبيعي.',
                        0x22c55e
                    );
                }, config.raid.lockdownDuration);
            }
        } catch (error) {
            console.error(`[RAID ERROR] ${bot.name}:`, error.message);
        }
    });

    // Anti Spam
    client.on('messageCreate', async message => {
        try {
            if (!config.spam.enabled) return;
            if (!message.guild || message.author.bot) return;
            if (isWhitelisted(message.author.id)) return;

            const now = Date.now();
            const old = spamMap.get(message.author.id) || [];

            const filtered = old.filter(
                timestamp => now - timestamp <= config.spam.timeWindow
            );

            filtered.push(now);
            spamMap.set(message.author.id, filtered);

            if (filtered.length >= config.spam.messageLimit) {
                spamMap.delete(message.author.id);

                await message.delete().catch(() => {});

                if (message.member) {
                    await message.member.timeout(
                        config.spam.muteDuration,
                        'Protection Bot: Anti-Spam'
                    ).catch(() => {});
                }

                await sendLog(
                    message.guild,
                    'Anti-Spam',
                    `تم اكتشاف Spam من <@${message.author.id}>.\n\nتم اتخاذ إجراء تلقائي.`,
                    0xef4444
                );
            }
        } catch (error) {
            console.error(`[SPAM ERROR] ${bot.name}:`, error.message);
        }
    });

    // Channel delete
    client.on('channelDelete', async channel => {
        try {
            if (!config.channelDelete.enabled || !channel.guild) return;

            const guild = channel.guild;
            const executor = await getExecutor(
                guild,
                AuditLogEvent.ChannelDelete,
                channel.id
            );

            if (!executor || isWhitelisted(executor.id)) return;

            const values = cleanCounter(
                counters.channelDelete,
                guild.id,
                config.channelDelete.timeWindow
            );

            values.push(Date.now());
            counters.channelDelete.set(guild.id, values);

            await punish(
                guild,
                executor.id,
                `حذف روم: ${channel.name || 'غير معروف'}`
            );

            if (values.length >= config.channelDelete.limit) {
                await sendLog(
                    guild,
                    'Channel Protection',
                    `تم اكتشاف حذف عدة رومات بواسطة <@${executor.id}>.`,
                    0xef4444
                );
            }
        } catch (error) {
            console.error(`[CHANNEL DELETE ERROR] ${bot.name}:`, error.message);
        }
    });

    // Role delete
    client.on('roleDelete', async role => {
        try {
            if (!config.roleDelete.enabled) return;

            const guild = role.guild;
            const executor = await getExecutor(
                guild,
                AuditLogEvent.RoleDelete,
                role.id
            );

            if (!executor || isWhitelisted(executor.id)) return;

            const values = cleanCounter(
                counters.roleDelete,
                guild.id,
                config.roleDelete.timeWindow
            );

            values.push(Date.now());
            counters.roleDelete.set(guild.id, values);

            await punish(
                guild,
                executor.id,
                `حذف رتبة: ${role.name}`
            );
        } catch (error) {
            console.error(`[ROLE DELETE ERROR] ${bot.name}:`, error.message);
        }
    });

    // Channel create
    client.on('channelCreate', async channel => {
        try {
            if (!config.channelCreate.enabled || !channel.guild) return;

            const guild = channel.guild;
            const executor = await getExecutor(
                guild,
                AuditLogEvent.ChannelCreate,
                channel.id
            );

            if (!executor || isWhitelisted(executor.id)) return;

            const values = cleanCounter(
                counters.channelCreate,
                guild.id,
                config.channelCreate.timeWindow
            );

            values.push(Date.now());
            counters.channelCreate.set(guild.id, values);

            if (values.length >= config.channelCreate.limit) {
                await channel.delete(
                    'Protection Bot: Excessive Channel Creation'
                ).catch(() => {});

                await punish(
                    guild,
                    executor.id,
                    'إنشاء عدد كبير من الرومات'
                );
            }
        } catch (error) {
            console.error(`[CHANNEL CREATE ERROR] ${bot.name}:`, error.message);
        }
    });

    // Role create
    client.on('roleCreate', async role => {
        try {
            if (!config.roleCreate.enabled) return;

            const guild = role.guild;
            const executor = await getExecutor(
                guild,
                AuditLogEvent.RoleCreate,
                role.id
            );

            if (!executor || isWhitelisted(executor.id)) return;

            const values = cleanCounter(
                counters.roleCreate,
                guild.id,
                config.roleCreate.timeWindow
            );

            values.push(Date.now());
            counters.roleCreate.set(guild.id, values);

            if (values.length >= config.roleCreate.limit) {
                await role.delete(
                    'Protection Bot: Excessive Role Creation'
                ).catch(() => {});

                await punish(
                    guild,
                    executor.id,
                    'إنشاء عدد كبير من الرتب'
                );
            }
        } catch (error) {
            console.error(`[ROLE CREATE ERROR] ${bot.name}:`, error.message);
        }
    });

    // Guild update
    client.on('guildUpdate', async (oldGuild, newGuild) => {
        try {
            const executor = await getExecutor(
                newGuild,
                AuditLogEvent.GuildUpdate,
                newGuild.id
            );

            if (!executor || isWhitelisted(executor.id)) return;

            const changes = [];

            if (oldGuild.name !== newGuild.name) {
                changes.push('تغيير اسم السيرفر');
            }

            if (oldGuild.icon !== newGuild.icon) {
                changes.push('تغيير صورة السيرفر');
            }

            if (!changes.length) return;

            await punish(
                newGuild,
                executor.id,
                changes.join(' + ')
            );

            await sendLog(
                newGuild,
                'Server Protection',
                `تم اكتشاف تعديل على السيرفر بواسطة <@${executor.id}>.\n\n${changes.join('\n')}`,
                0xef4444
            );
        } catch (error) {
            console.error(`[GUILD UPDATE ERROR] ${bot.name}:`, error.message);
        }
    });

    client.on('error', error => {
        console.error(`[PROTECTION CLIENT ERROR] ${bot.name}:`, error.message);
    });
}

// ------------------------------------------------------
// TICKETS / GENERIC
// ------------------------------------------------------

function setupTicketsBot(client, bot) {
    client.once('ready', () => {
        console.log(`[TICKETS] ${bot.name} online as ${client.user.tag}`);

        updateRunningStatus(bot, 'يعمل', {
            discordTag: client.user.tag,
            lastError: null
        });
    });

    client.on('error', error => {
        console.error(`[TICKETS ERROR] ${bot.name}:`, error.message);
    });
}

function setupGenericBot(client, bot) {
    client.once('ready', () => {
        console.log(`[BOT] ${bot.name} online as ${client.user.tag}`);

        updateRunningStatus(bot, 'يعمل', {
            discordTag: client.user.tag,
            lastError: null
        });
    });

    client.on('error', error => {
        console.error(`[BOT ERROR] ${bot.name}:`, error.message);
    });
}

// ------------------------------------------------------
// START / STOP
// ------------------------------------------------------

async function startManagedBot(bot) {
    if (!bot || !bot.id || !bot.token) {
        return false;
    }

    const existing = runningBots.get(bot.id);

    if (existing) {
        return true;
    }

    updateBotStatus(bot.id, 'جارٍ التشغيل', {
        lastError: null
    });

    const type = normalizeType(bot.type);
    const client = createManagedClient(type);

    try {
        if (type === 'protection') {
            setupProtectionBot(client, bot);
        } else if (type === 'welcome') {
            setupWelcomeBot(client, bot);
        } else if (type === 'tickets') {
            setupTicketsBot(client, bot);
        } else {
            setupGenericBot(client, bot);
        }

        await client.login(bot.token);

        runningBots.set(bot.id, {
            kind: 'client',
            client,
            bot
        });

        console.log(`[BOT MANAGER] ${bot.name} started as ${type}.`);

        return true;
    } catch (error) {
        console.error(
            `[BOT MANAGER] Failed to start ${bot.name}:`,
            error
        );

        updateBotStatus(bot.id, 'متوقف', {
            lastError: error.message,
            discordTag: null
        });

        try {
            client.destroy();
        } catch {}

        runningBots.delete(bot.id);

        return false;
    }
}

async function stopManagedBot(botId) {
    const managed = runningBots.get(botId);

    if (!managed) {
        updateBotStatus(botId, 'متوقف');
        return true;
    }

    try {
        managed.client.destroy();
    } catch (error) {
        console.error('[BOT STOP ERROR]', error.message);
    }

    runningBots.delete(botId);
    updateBotStatus(botId, 'متوقف');

    return true;
}

async function restartManagedBot(botId) {
    const db = getDB();
    const bot = db.bots.find(b => b.id === botId);

    if (!bot) return false;

    await stopManagedBot(botId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    return startManagedBot(bot);
}

function canManageBot(req, bot) {
    if (!isLoggedIn(req) || !bot) return false;
    if (req.session.user.isAdmin) return true;
    return bot.owner === req.session.user.username;
}

// ======================================================
// BOT API / ROUTES
// ======================================================

app.post('/add-bot', (req, res) => {
    if (!isLoggedIn(req)) {
        return res.status(401).json({
            success: false,
            message: 'يجب تسجيل الدخول.'
        });
    }

    const db = getDB();

    const name = String(req.body.name || req.body.botName || '').trim();
    const token = String(req.body.token || '').trim();
    const type = normalizeType(req.body.type || 'bot');

    if (!name || !token) {
        return res.status(400).json({
            success: false,
            message: 'اسم البوت والتوكن مطلوبان.'
        });
    }

    const bot = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        token,
        type,
        owner: req.session.user.username,
        ownerDiscordId: req.session.user.discordId || null,
        status: 'متوقف',
        createdAt: new Date().toISOString()
    };

    db.bots.push(bot);
    saveDB(db);

    return res.redirect('/');
});

app.post('/start/:id', async (req, res) => {
    const db = getDB();
    const bot = db.bots.find(b => b.id === req.params.id);

    if (!bot || !canManageBot(req, bot)) {
        return res.status(403).json({
            success: false,
            message: 'غير مصرح لك.'
        });
    }

    const success = await startManagedBot(bot);
    const latest = getDB().bots.find(b => b.id === bot.id);

    return res.json({
        success,
        status: latest?.status || 'متوقف',
        error: latest?.lastError || null,
        discordTag: latest?.discordTag || null
    });
});

app.post('/stop/:id', async (req, res) => {
    const db = getDB();
    const bot = db.bots.find(b => b.id === req.params.id);

    if (!bot || !canManageBot(req, bot)) {
        return res.status(403).json({
            success: false,
            message: 'غير مصرح لك.'
        });
    }

    const success = await stopManagedBot(bot.id);

    return res.json({
        success,
        status: 'متوقف',
        error: null
    });
});

app.post('/restart/:id', async (req, res) => {
    const db = getDB();
    const bot = db.bots.find(b => b.id === req.params.id);

    if (!bot || !canManageBot(req, bot)) {
        return res.status(403).json({
            success: false,
            message: 'غير مصرح لك.'
        });
    }

    const success = await restartManagedBot(bot.id);
    const latest = getDB().bots.find(b => b.id === bot.id);

    return res.json({
        success,
        status: latest?.status || 'متوقف',
        error: latest?.lastError || null,
        discordTag: latest?.discordTag || null
    });
});

app.post('/delete/:id', async (req, res) => {
    const db = getDB();
    const index = db.bots.findIndex(b => b.id === req.params.id);

    if (index === -1 || !canManageBot(req, db.bots[index])) {
        return res.status(403).json({
            success: false,
            message: 'غير مصرح لك.'
        });
    }

    const bot = db.bots[index];

    await stopManagedBot(bot.id);

    db.bots.splice(index, 1);
    saveDB(db);

    return res.json({
        success: true,
        message: 'تم حذف البوت.'
    });
});

app.get('/api/bots', (req, res) => {
    if (!isLoggedIn(req)) {
        return res.status(401).json({ success: false });
    }

    const db = getDB();

    const bots = req.session.user.isAdmin
        ? db.bots
        : db.bots.filter(bot => bot.owner === req.session.user.username);

    return res.json({
        success: true,
        bots: bots.map(bot => ({
            ...bot,
            token: undefined
        }))
    });
});

// ======================================================
// DISCORD LOGIN
// ======================================================

const discordLoginTickets = new Map();
const DISCORD_LOGIN_TICKET_TTL = 5 * 60 * 1000;

function createDiscordLoginTicket(user) {
    const ticket = crypto.randomBytes(32).toString('hex');

    discordLoginTickets.set(ticket, {
        username: user.username,
        discordId: user.discordId || null,
        expiresAt: Date.now() + DISCORD_LOGIN_TICKET_TTL
    });

    return ticket;
}

function consumeDiscordLoginTicket(ticket) {
    const data = discordLoginTickets.get(ticket);

    if (!data) return null;

    discordLoginTickets.delete(ticket);

    if (Date.now() > data.expiresAt) return null;

    return data;
}

setInterval(() => {
    const now = Date.now();

    for (const [ticket, data] of discordLoginTickets.entries()) {
        if (now > data.expiresAt) {
            discordLoginTickets.delete(ticket);
        }
    }
}, 60 * 1000);

app.get('/discord-login', (req, res) => {
    const ticket = String(req.query.ticket || '').trim();

    if (!ticket) {
        return res.status(400).send('رابط تسجيل الدخول غير صالح.');
    }

    const data = consumeDiscordLoginTicket(ticket);

    if (!data) {
        return res.status(401).send('انتهت صلاحية رابط تسجيل الدخول أو تم استخدامه مسبقاً.');
    }

    const db = getDB();
    const user = db.users.find(u => u.username === data.username);

    if (!user) {
        return res.status(404).send('لم يتم العثور على الحساب.');
    }

    req.session.user = {
        username: user.username,
        isAdmin: Boolean(user.isAdmin),
        discordId: user.discordId || data.discordId || null
    };

    return req.session.save(error => {
        if (error) {
            console.error('[DISCORD LOGIN SESSION ERROR]', error);
            return res.status(500).send('تعذر إنشاء جلسة تسجيل الدخول.');
        }

        return res.redirect('/');
    });
});

// ======================================================
// MAIN DISCORD BOT
// ======================================================

const mainClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const discordPendingRegistrations = new Map();
const discordPendingLogins = new Map();

mainClient.once('ready', () => {
    console.log(`[Discord] Logged in as ${mainClient.user.tag}`);
});

mainClient.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!setup') {
        const embed = new EmbedBuilder()
            .setTitle('AbuSaud Store | تسجيل وفتح الحسابات')
            .setDescription('انقر على الزر بالأسفل لإنشاء حسابك الجديد أو تسجيل الدخول.')
            .setColor(0x0099ff);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_register_modal')
                .setLabel('إنشاء حساب جديد')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('open_login_modal')
                .setLabel('تسجيل الدخول')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });

        await message.delete().catch(() => {});
    }
});

mainClient.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) {
            return;
        }

        // ==========================
        // OPEN REGISTER
        // ==========================
        if (interaction.isButton() && interaction.customId === 'open_register_modal') {
            const modal = new ModalBuilder()
                .setCustomId('register_modal')
                .setTitle('إنشاء حساب جديد');

            const username = new TextInputBuilder()
                .setCustomId('reg_username')
                .setLabel('اسم المستخدم')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const email = new TextInputBuilder()
                .setCustomId('reg_email')
                .setLabel('البريد الإلكتروني')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const password = new TextInputBuilder()
                .setCustomId('reg_password')
                .setLabel('كلمة المرور (6 أحرف على الأقل)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(username),
                new ActionRowBuilder().addComponents(email),
                new ActionRowBuilder().addComponents(password)
            );

            return interaction.showModal(modal);
        }

        // ==========================
        // OPEN LOGIN
        // ==========================
        if (interaction.isButton() && interaction.customId === 'open_login_modal') {
            const modal = new ModalBuilder()
                .setCustomId('login_modal')
                .setTitle('تسجيل الدخول عبر الديسكورد');

            const email = new TextInputBuilder()
                .setCustomId('login_email')
                .setLabel('البريد الإلكتروني المسجل به')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(email));

            return interaction.showModal(modal);
        }

        // ==========================
        // REGISTER MODAL
        // ==========================
        if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
            const username = interaction.fields.getTextInputValue('reg_username').trim();
            const email = interaction.fields.getTextInputValue('reg_email').trim().toLowerCase();
            const password = interaction.fields.getTextInputValue('reg_password');

            const db = getDB();

            if (!username || !email || !password) {
                return interaction.reply({ content: 'يرجى تعبئة جميع البيانات.', ephemeral: true });
            }

            if (password.length < 6) {
                return interaction.reply({ content: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.', ephemeral: true });
            }

            if (db.users.some(u => String(u.username).toLowerCase() === username.toLowerCase())) {
                return interaction.reply({ content: 'اسم المستخدم مستخدم مسبقاً!', ephemeral: true });
            }

            if (db.users.some(u => u.email && String(u.email).toLowerCase() === email)) {
                return interaction.reply({ content: 'البريد الإلكتروني مستخدم مسبقاً!', ephemeral: true });
            }

            const code = makeCode();

            discordPendingRegistrations.set(interaction.user.id, {
                username,
                email,
                password,
                codeHash: hashCode(code),
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            try {
                await interaction.user.send(
                    `مرحباً **${username}** 👋\n\n` +
                    `كود التحقق الخاص بإنشاء حسابك في **AbuSaud Store** هو:\n\n` +
                    `\`\`\`${code}\`\`\`\n\n` +
                    `الكود صالح لمدة **10 دقائق**.`
                );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('open_register_verify')
                        .setLabel('إدخال كود التحقق')
                        .setStyle(ButtonStyle.Primary)
                );

                return interaction.reply({
                    content: 'تم إرسال كود التحقق إلى الخاص 📩',
                    components: [row],
                    ephemeral: true
                });
            } catch (error) {
                discordPendingRegistrations.delete(interaction.user.id);
                console.error('[Register DM Error]', error.message);

                return interaction.reply({
                    content: 'تعذر إرسال رسالة الخاص. افتح الرسائل الخاصة في Discord وحاول مرة أخرى.',
                    ephemeral: true
                });
            }
        }

        // ==========================
        // OPEN REGISTER VERIFY
        // ==========================
        if (interaction.isButton() && interaction.customId === 'open_register_verify') {
            const pending = discordPendingRegistrations.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                discordPendingRegistrations.delete(interaction.user.id);
                return interaction.reply({
                    content: 'انتهت صلاحية العملية. ابدأ التسجيل من جديد.',
                    ephemeral: true
                });
            }

            const modal = new ModalBuilder()
                .setCustomId('verify_modal')
                .setTitle('تأكيد كود إنشاء الحساب');

            const code = new TextInputBuilder()
                .setCustomId('verify_code')
                .setLabel('أدخل الكود المرسل إلى الخاص')
                .setStyle(TextInputStyle.Short)
                .setMinLength(6)
                .setMaxLength(6)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(code));

            return interaction.showModal(modal);
        }

        // ==========================
        // VERIFY REGISTER
        // ==========================
        if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
            const entered = interaction.fields.getTextInputValue('verify_code').trim();
            const pending = discordPendingRegistrations.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                discordPendingRegistrations.delete(interaction.user.id);
                return interaction.reply({ content: 'انتهت صلاحية الكود.', ephemeral: true });
            }

            if (!/^\d{6}$/.test(entered) || hashCode(entered) !== pending.codeHash) {
                return interaction.reply({ content: 'كود التحقق غير صحيح ❌', ephemeral: true });
            }

            const db = getDB();

            if (db.users.some(u => String(u.username).toLowerCase() === pending.username.toLowerCase())) {
                discordPendingRegistrations.delete(interaction.user.id);
                return interaction.reply({ content: 'اسم المستخدم أصبح مستخدماً بالفعل.', ephemeral: true });
            }

            db.users.push({
                username: pending.username,
                password: pending.password,
                email: pending.email,
                isAdmin: false,
                emailVerified: true,
                discordId: interaction.user.id
            });

            saveDB(db);
            discordPendingRegistrations.delete(interaction.user.id);

            return interaction.reply({
                content: 'تم إنشاء حسابك وتأكيده بنجاح ✅\n\nيمكنك الآن استخدام زر تسجيل الدخول.',
                ephemeral: true
            });
        }

        // ==========================
        // LOGIN MODAL
        // ==========================
        if (interaction.isModalSubmit() && interaction.customId === 'login_modal') {
            const email = interaction.fields.getTextInputValue('login_email').trim().toLowerCase();
            const db = getDB();

            const user = db.users.find(u => u.email && String(u.email).toLowerCase() === email);

            if (!user) {
                return interaction.reply({
                    content: 'لم يتم العثور على حساب مرتبط بهذا البريد الإلكتروني.',
                    ephemeral: true
                });
            }

            const code = makeCode();

            discordPendingLogins.set(interaction.user.id, {
                username: user.username,
                codeHash: hashCode(code),
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            try {
                await interaction.user.send(
                    `مرحباً **${user.username}** 👋\n\n` +
                    `كود تسجيل الدخول إلى **AbuSaud Store** هو:\n\n` +
                    `\`\`\`${code}\`\`\`\n\n` +
                    `الكود صالح لمدة **10 دقائق**.`
                );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('open_login_verify')
                        .setLabel('إدخال كود الدخول')
                        .setStyle(ButtonStyle.Success)
                );

                return interaction.reply({
                    content: 'تم إرسال كود الدخول إلى الخاص 📩',
                    components: [row],
                    ephemeral: true
                });
            } catch (error) {
                discordPendingLogins.delete(interaction.user.id);

                return interaction.reply({
                    content: 'تعذر إرسال الكود على الخاص.',
                    ephemeral: true
                });
            }
        }

        // ==========================
        // OPEN LOGIN VERIFY
        // ==========================
        if (interaction.isButton() && interaction.customId === 'open_login_verify') {
            const pending = discordPendingLogins.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                discordPendingLogins.delete(interaction.user.id);
                return interaction.reply({
                    content: 'انتهت صلاحية تسجيل الدخول.',
                    ephemeral: true
                });
            }

            const modal = new ModalBuilder()
                .setCustomId('login_verify_modal')
                .setTitle('تأكيد تسجيل الدخول');

            const code = new TextInputBuilder()
                .setCustomId('login_verify_code')
                .setLabel('أدخل الكود المرسل للخاص')
                .setStyle(TextInputStyle.Short)
                .setMinLength(6)
                .setMaxLength(6)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(code));

            return interaction.showModal(modal);
        }

        // ==========================
        // VERIFY LOGIN
        // ==========================
        if (interaction.isModalSubmit() && interaction.customId === 'login_verify_modal') {
            const entered = interaction.fields.getTextInputValue('login_verify_code').trim();
            const pending = discordPendingLogins.get(interaction.user.id);

            if (!pending || Date.now() > pending.expiresAt) {
                discordPendingLogins.delete(interaction.user.id);
                return interaction.reply({ content: 'انتهت صلاحية الكود.', ephemeral: true });
            }

            if (!/^\d{6}$/.test(entered) || hashCode(entered) !== pending.codeHash) {
                return interaction.reply({ content: 'الكود غير صحيح ❌', ephemeral: true });
            }

            discordPendingLogins.delete(interaction.user.id);

            const db = getDB();
            const user = db.users.find(u => u.username === pending.username);

            if (!user) {
                return interaction.reply({ content: 'لم يتم العثور على الحساب.', ephemeral: true });
            }

            const ticket = createDiscordLoginTicket({
                username: user.username,
                discordId: interaction.user.id
            });

            const loginUrl = `${SITE_URL}/discord-login?ticket=${encodeURIComponent(ticket)}`;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('دخول إلى الموقع')
                    .setStyle(ButtonStyle.Link)
                    .setURL(loginUrl)
            );

            return interaction.reply({
                content: 'تم التحقق من الكود بنجاح ✅\n\nالرابط صالح لمدة 5 دقائق ويعمل مرة واحدة فقط.',
                components: [row],
                ephemeral: true
            });
        }

        // ==========================
        // ADMIN PANEL
        // ==========================
        if (interaction.customId && interaction.customId.startsWith('private_admin_')) {
            if (interaction.user.id !== ADMIN_DISCORD_ID) {
                return interaction.reply({
                    content: '❌ هذه اللوحة خاصة بصاحب البوت فقط.',
                    ephemeral: true
                });
            }

            if (interaction.isButton() && interaction.customId === 'private_admin_accounts') {
                const users = getDB().users;

                const options = users.slice(0, 25).map((user, index) => ({
                    label: String(user.username).slice(0, 100),
                    description: String(user.email || 'بدون بريد').slice(0, 100),
                    value: `admin_user_${index}`
                }));

                if (!options.length) {
                    return interaction.reply({ content: 'لا توجد حسابات.', ephemeral: true });
                }

                return interaction.reply({
                    content: '👤 اختر الحساب:',
                    components: [
                        new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('private_admin_select_user')
                                .setPlaceholder('اختر حساب...')
                                .addOptions(options)
                        )
                    ],
                    ephemeral: true
                });
            }

            if (interaction.isButton() && interaction.customId === 'private_admin_all_bots') {
                const bots = getDB().bots;

                if (!bots.length) {
                    return interaction.reply({
                        content: '🤖 لا توجد بوتات مضافة.',
                        ephemeral: true
                    });
                }

                const text = bots.slice(0, 20).map((bot, i) =>
                    `**${i + 1}. ${bot.name}**\n👤 ${bot.owner}\n📦 ${bot.type}\n🟢 ${bot.status}`
                ).join('\n\n');

                return interaction.reply({
                    content: `🤖 **البوتات:**\n\n${text}`,
                    ephemeral: true
                });
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'private_admin_select_user') {
                const index = Number(interaction.values[0].replace('admin_user_', ''));
                const users = getDB().users;
                const user = users[index];

                if (!user) {
                    return interaction.reply({ content: 'الحساب غير موجود.', ephemeral: true });
                }

                const bots = getUserBots(user.username);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`private_admin_add_${index}`)
                        .setLabel('➕ إضافة بوت')
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`private_admin_list_${index}`)
                        .setLabel('📋 بوتات الحساب')
                        .setStyle(ButtonStyle.Primary)
                );

                return interaction.update({
                    content: `👤 حساب: **${user.username}**\n🤖 عدد البوتات: **${bots.length}**`,
                    components: [row]
                });
            }

            if (interaction.isButton() && interaction.customId.startsWith('private_admin_add_')) {
                const index = Number(interaction.customId.replace('private_admin_add_', ''));
                const users = getDB().users;
                const user = users[index];

                if (!user) {
                    return interaction.reply({ content: 'الحساب غير موجود.', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId(`private_admin_add_modal_${index}`)
                    .setTitle(`إضافة بوت لـ ${user.username}`);

                const name = new TextInputBuilder()
                    .setCustomId('admin_bot_name')
                    .setLabel('اسم البوت')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const token = new TextInputBuilder()
                    .setCustomId('admin_bot_token')
                    .setLabel('Bot Token')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                const type = new TextInputBuilder()
                    .setCustomId('admin_bot_type')
                    .setLabel('نوع البوت')
                    .setPlaceholder('Welcome / Protection / Tickets / bot')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(name),
                    new ActionRowBuilder().addComponents(token),
                    new ActionRowBuilder().addComponents(type)
                );

                return interaction.showModal(modal);
            }

            if (interaction.isButton() && interaction.customId.startsWith('private_admin_list_')) {
                const index = Number(interaction.customId.replace('private_admin_list_', ''));
                const users = getDB().users;
                const user = users[index];

                if (!user) {
                    return interaction.reply({ content: 'الحساب غير موجود.', ephemeral: true });
                }

                const bots = getUserBots(user.username);

                if (!bots.length) {
                    return interaction.reply({
                        content: `🤖 حساب **${user.username}** ما عنده بوتات.`,
                        ephemeral: true
                    });
                }

                const text = bots.slice(0, 20).map((bot, i) =>
                    `${i + 1}. **${bot.name}** — ${bot.type} — ${bot.status}`
                ).join('\n');

                return interaction.reply({
                    content: `🤖 **بوتات ${user.username}:**\n\n${text}`,
                    ephemeral: true
                });
            }

            if (interaction.isModalSubmit() && interaction.customId.startsWith('private_admin_add_modal_')) {
                const index = Number(interaction.customId.replace('private_admin_add_modal_', ''));
                const users = getDB().users;
                const user = users[index];

                if (!user) {
                    return interaction.reply({ content: 'الحساب غير موجود.', ephemeral: true });
                }

                const name = interaction.fields.getTextInputValue('admin_bot_name').trim();
                const token = interaction.fields.getTextInputValue('admin_bot_token').trim();
                const type = normalizeType(interaction.fields.getTextInputValue('admin_bot_type').trim());

                if (!name || !token) {
                    return interaction.reply({ content: 'أكمل جميع البيانات.', ephemeral: true });
                }

                const db = getDB();

                const bot = {
                    id: crypto.randomBytes(8).toString('hex'),
                    name,
                    token,
                    type,
                    owner: user.username,
                    ownerDiscordId: user.discordId || null,
                    status: 'متوقف',
                    createdAt: new Date().toISOString()
                };

                db.bots.push(bot);
                saveDB(db);

                // تشغيل البوت مباشرة بعد الإضافة.
                const started = await startManagedBot(bot);

                return interaction.reply({
                    content:
                        `✅ تم إضافة **${name}** للحساب **${user.username}**.\n` +
                        `📦 النوع: **${type}**\n` +
                        `🟢 الحالة: **${started ? 'يعمل' : 'متوقف'}**`,
                    ephemeral: true
                });
            }
        }
    } catch (error) {
        console.error('[INTERACTION ERROR]', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'حدث خطأ غير متوقع.',
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// !admin
mainClient.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.content !== '!admin') return;

    if (message.author.id !== ADMIN_DISCORD_ID) {
        return message.reply('❌ هذا الأمر خاص بصاحب البوت فقط.');
    }

    const embed = new EmbedBuilder()
        .setTitle('🛠️ لوحة الإدارة الخاصة')
        .setDescription('إدارة حسابات المستخدمين والبوتات المرتبطة بهم.')
        .setColor(0x0099ff);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('private_admin_accounts')
            .setLabel('👤 اختيار حساب')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('private_admin_all_bots')
            .setLabel('🤖 جميع البوتات')
            .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({
        embeds: [embed],
        components: [row]
    });
});

// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`Server running on port ${PORT}`);
    console.log(`Website: ${SITE_URL}`);
    console.log(`Bot manager: ENABLED`);
    console.log(`========================================`);
});

const discordToken = process.env.DISCORD_TOKEN;

if (!discordToken) {
    console.error('[Discord] DISCORD_TOKEN is missing from Railway Variables.');
} else {
    mainClient.login(discordToken).catch(error => {
        console.error('[Discord] Main bot login failed:', error.message);
        process.exit(1);
    });
}

// ======================================================
// AUTO START SAVED BOTS
// ======================================================

setTimeout(async () => {
    const db = getDB();

    console.log(`[BOT MANAGER] Found ${db.bots.length} saved bot(s).`);

    for (const bot of db.bots) {
        try {
            await startManagedBot(bot);
        } catch (error) {
            console.error(`[BOT MANAGER] Unexpected error with ${bot.name}:`, error.message);
            updateBotStatus(bot.id, 'متوقف', { lastError: error.message });
        }
    }
}, 2500);

// ======================================================
// CLEAN SHUTDOWN
// ======================================================

async function shutdown(signal) {
    console.log(`[SERVER] ${signal} received. Stopping bots...`);

    const ids = [...runningBots.keys()];

    for (const id of ids) {
        await stopManagedBot(id);
    }

    try {
        mainClient.destroy();
    } catch (_) {}

    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
