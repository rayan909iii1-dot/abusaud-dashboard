const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    AuditLogEvent,
    PermissionsBitField
} = require('discord.js');

const fs = require('fs');
const path = require('path');

/* =========================================================
   ENV
========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN) {
    console.error('❌ Error: Bot Token is missing!');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ Error: CLIENT_ID is missing!');
    process.exit(1);
}

/*
    المالك الأساسي للبوت.
    إذا لم تضع OWNER_ID في Environment Variables
    سيتم استخدام هذا الآيدي.
*/
const MAIN_OWNER_ID = OWNER_ID || '1113483140086907093';

const PREFIX = '!';

/* =========================================================
   CONFIG
========================================================= */

const configPath = path.join(
    __dirname,
    `config_${CLIENT_ID}.json`
);

function createDefaultConfig() {
    return {
        guilds: {}
    };
}

function getConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(
            configPath,
            JSON.stringify(createDefaultConfig(), null, 2),
            'utf8'
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(configPath, 'utf8')
        );
    } catch (error) {
        console.error('❌ Config Error:', error);

        const freshConfig = createDefaultConfig();

        fs.writeFileSync(
            configPath,
            JSON.stringify(freshConfig, null, 2),
            'utf8'
        );

        return freshConfig;
    }
}

function saveConfig(data) {
    fs.writeFileSync(
        configPath,
        JSON.stringify(data, null, 2),
        'utf8'
    );
}

/* =========================================================
   GUILD CONFIG
========================================================= */

function getGuildConfig(guildId) {
    const config = getConfig();

    if (!config.guilds[guildId]) {
        config.guilds[guildId] = {
            ownerId: MAIN_OWNER_ID,

            adminIds: [],

            logChannelId: '',

            allowedBots: [],

            protection: {
                antiRaid: true,
                antiSpam: true,
                botProtection: true,
                channelDelete: true,
                roleDelete: true
            },

            raid: {
                joinLimit: 6,
                timeWindow: 10000
            },

            spam: {
                messageLimit: 6,
                timeWindow: 5000,
                muteDuration: 60000
            },

            channelDelete: {
                limit: 3,
                timeWindow: 10000
            },

            roleDelete: {
                limit: 3,
                timeWindow: 10000
            }
        };

        saveConfig(config);
    }

    return config.guilds[guildId];
}

function saveGuildConfig(guildId, guildConfig) {
    const config = getConfig();

    config.guilds[guildId] = guildConfig;

    saveConfig(config);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],

    partials: [
        Partials.GuildMember,
        Partials.Message,
        Partials.Channel
    ]
});

/* =========================================================
   MEMORY
========================================================= */

const raidJoins = new Map();

const spamMap = new Map();

const channelDeleteCounters = new Map();

const roleDeleteCounters = new Map();

const lockdownMap = new Map();

/* =========================================================
   HELPERS
========================================================= */

function isOwner(member) {
    return member && member.id === MAIN_OWNER_ID;
}

function isAdmin(member) {
    if (!member) {
        return false;
    }

    if (member.id === MAIN_OWNER_ID) {
        return true;
    }

    if (
        member.permissions &&
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) {
        return true;
    }

    const config = getGuildConfig(
        member.guild.id
    );

    return config.adminIds.includes(member.id);
}

function isConfiguredAdmin(member) {
    if (!member) {
        return false;
    }

    if (member.id === MAIN_OWNER_ID) {
        return true;
    }

    const config = getGuildConfig(
        member.guild.id
    );

    return config.adminIds.includes(member.id);
}

function isWhitelisted(guild, userId) {
    if (!userId) {
        return false;
    }

    if (userId === MAIN_OWNER_ID) {
        return true;
    }

    const config = getGuildConfig(
        guild.id
    );

    return config.adminIds.includes(userId);
}

function isAllowedBot(guild, botId) {
    const config = getGuildConfig(
        guild.id
    );

    return config.allowedBots.includes(botId);
}

function getMemberFromMention(message, arg) {
    if (!arg) {
        return null;
    }

    const match = arg.match(
        /^<@!?(\d+)>$/
    );

    if (!match) {
        return null;
    }

    return message.guild.members.cache.get(
        match[1]
    );
}

function getChannelFromMention(message, arg) {
    if (!arg) {
        return null;
    }

    const match = arg.match(
        /^<#(\d+)>$/
    );

    if (!match) {
        return null;
    }

    return message.guild.channels.cache.get(
        match[1]
    );
}

/* =========================================================
   LOG SYSTEM
========================================================= */

async function sendLog(
    guild,
    title,
    description,
    color = '#3b82f6'
) {
    try {
        const config = getGuildConfig(
            guild.id
        );

        if (!config.logChannelId) {
            return;
        }

        const channel =
            guild.channels.cache.get(
                config.logChannelId
            );

        if (!channel) {
            return;
        }

        const embed =
            new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(description)
                .setFooter({
                    text:
                        `Protection • ${guild.name}`
                })
                .setTimestamp();

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    } catch (error) {
        console.error(
            '❌ Log Error:',
            error
        );
    }
}

/* =========================================================
   GET AUDIT LOG EXECUTOR
========================================================= */

async function getExecutor(
    guild,
    type,
    targetId
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 5
            });

        const entry =
            logs.entries.find(
                item =>
                    item.target &&
                    item.target.id === targetId &&
                    Date.now() -
                        item.createdTimestamp <
                        10000
            );

        return entry
            ? entry.executor
            : null;

    } catch (error) {
        console.error(
            '❌ Audit Log Error:',
            error
        );

        return null;
    }
}

/* =========================================================
   PUNISH
========================================================= */

async function punish(
    guild,
    userId,
    reason
) {
    try {
        if (isWhitelisted(guild, userId)) {
            return false;
        }

        const member =
            await guild.members
                .fetch(userId)
                .catch(() => null);

        if (!member) {
            return false;
        }

        if (!member.manageable) {
            await sendLog(
                guild,
                '⚠️ Protection Warning',
                `لم أستطع معاقبة <@${userId}> بسبب ترتيب الرتب أو الصلاحيات.`,
                '#f59e0b'
            );

            return false;
        }

        await member.kick(reason);

        await sendLog(
            guild,
            '🔨 Protection Action',
            `تم طرد <@${userId}>.\n\n**السبب:** ${reason}`,
            '#ef4444'
        );

        return true;

    } catch (error) {
        console.error(
            '❌ Punish Error:',
            error
        );

        return false;
    }
}

/* =========================================================
   READY
========================================================= */

client.once(
    'ready',
    async () => {

        console.log(
            `✨ Protection Bot is online as ${client.user.tag} (ID: ${CLIENT_ID})`
        );

        console.log(
            `🛡️ Protection System loaded.`
        );

        client.guilds.cache.forEach(
            guild => {
                getGuildConfig(
                    guild.id
                );
            }
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        `${PREFIX}protectionhelp`,
                    type: 0
                }
            ],
            status: 'online'
        });
    }
);

/* =========================================================
   COMMANDS
========================================================= */

client.on(
    'messageCreate',
    async message => {

        if (
            message.author.bot ||
            !message.guild
        ) {
            return;
        }

        if (
            !message.content.startsWith(
                PREFIX
            )
        ) {
            return;
        }

        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);

        const command =
            args.shift()
                .toLowerCase();

        const config =
            getGuildConfig(
                message.guild.id
            );

        /* =====================================================
           HELP
        ===================================================== */

        if (
            command ===
            'protectionhelp'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية استخدام أوامر الحماية.'
                );
            }

            const embed =
                new EmbedBuilder()
                    .setColor('#3b82f6')
                    .setTitle(
                        '🛡️ Protection Commands'
                    )
                    .setDescription(
                        [
                            '**👑 الإدارة**',

                            '`!setadmin @user`',
                            'إضافة مسؤول جديد.',

                            '`!removeadmin @user`',
                            'إزالة مسؤول.',

                            '`!admins`',
                            'عرض جميع المسؤولين.',

                            '**📋 Logs**',

                            '`!setlog #channel`',
                            'تعيين روم اللوق.',

                            '**🤖 Bot Protection**',

                            '`!allowbot @bot`',
                            'السماح لبوت.',

                            '`!removebot @bot`',
                            'إزالة بوت من قائمة السماح.',

                            '**🛡️ Protection**',

                            '`!protection`',
                            'عرض حالة الحماية.',

                            '`!protectionhelp`',
                            'عرض هذه القائمة.'
                        ].join('\n\n')
                    )
                    .setFooter({
                        text:
                            'AbuSaud Protection'
                    })
                    .setTimestamp();

            return message.reply({
                embeds: [embed]
            });
        }

        /* =====================================================
           SET ADMIN
        ===================================================== */

        if (
            command ===
            'setadmin'
        ) {

            if (!isOwner(message.member)) {
                return message.reply(
                    '❌ هذا الأمر للمالك الأساسي للبوت فقط.'
                );
            }

            const target =
                getMemberFromMention(
                    message,
                    args[0]
                );

            if (!target) {
                return message.reply(
                    '❌ الاستخدام الصحيح:\n`!setadmin @user`'
                );
            }

            if (
                target.user.bot
            ) {
                return message.reply(
                    '❌ لا يمكنك إضافة بوت كمسؤول.'
                );
            }

            if (
                target.id ===
                MAIN_OWNER_ID
            ) {
                return message.reply(
                    'ℹ️ هذا الشخص هو المالك الأساسي بالفعل.'
                );
            }

            if (
                config.adminIds.includes(
                    target.id
                )
            ) {
                return message.reply(
                    '⚠️ هذا العضو مسؤول بالفعل.'
                );
            }

            config.adminIds.push(
                target.id
            );

            saveGuildConfig(
                message.guild.id,
                config
            );

            await message.reply(
                `✅ تم إضافة ${target} كمسؤول للحماية.`
            );

            await sendLog(
                message.guild,
                '👑 New Protection Admin',
                `تم إضافة ${target} كمسؤول بواسطة ${message.author}.`,
                '#22c55e'
            );

            return;
        }

        /* =====================================================
           REMOVE ADMIN
        ===================================================== */

        if (
            command ===
            'removeadmin'
        ) {

            if (!isOwner(message.member)) {
                return message.reply(
                    '❌ هذا الأمر للمالك الأساسي للبوت فقط.'
                );
            }

            const target =
                getMemberFromMention(
                    message,
                    args[0]
                );

            if (!target) {
                return message.reply(
                    '❌ الاستخدام الصحيح:\n`!removeadmin @user`'
                );
            }

            if (
                target.id ===
                MAIN_OWNER_ID
            ) {
                return message.reply(
                    '❌ لا يمكن إزالة المالك الأساسي.'
                );
            }

            if (
                !config.adminIds.includes(
                    target.id
                )
            ) {
                return message.reply(
                    '⚠️ هذا العضو ليس مسؤولًا.'
                );
            }

            config.adminIds =
                config.adminIds.filter(
                    id =>
                        id !== target.id
                );

            saveGuildConfig(
                message.guild.id,
                config
            );

            await message.reply(
                `✅ تم إزالة ${target} من مسؤولي الحماية.`
            );

            await sendLog(
                message.guild,
                '👤 Protection Admin Removed',
                `تم إزالة ${target} من المسؤولين بواسطة ${message.author}.`,
                '#f59e0b'
            );

            return;
        }

        /* =====================================================
           ADMINS
        ===================================================== */

        if (
            command ===
            'admins'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية.'
                );
            }

            const admins =
                config.adminIds.length
                    ? config.adminIds
                        .map(
                            id =>
                                `<@${id}>`
                        )
                        .join('\n')
                    : 'لا يوجد مسؤولون إضافيون.';

            const embed =
                new EmbedBuilder()
                    .setColor('#3b82f6')
                    .setTitle(
                        '👑 Protection Administrators'
                    )
                    .addFields(
                        {
                            name:
                                '👑 المالك الأساسي',
                            value:
                                `<@${MAIN_OWNER_ID}>`,
                            inline: false
                        },
                        {
                            name:
                                '🛡️ المسؤولون',
                            value:
                                admins,
                            inline: false
                        }
                    )
                    .setTimestamp();

            return message.reply({
                embeds: [embed]
            });
        }

        /* =====================================================
           SET LOG
        ===================================================== */

        if (
            command ===
            'setlog'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية تعيين روم اللوق.'
                );
            }

            const channel =
                getChannelFromMention(
                    message,
                    args[0]
                );

            if (!channel) {
                return message.reply(
                    '❌ الاستخدام الصحيح:\n`!setlog #channel`'
                );
            }

            if (
                !channel.isTextBased()
            ) {
                return message.reply(
                    '❌ يجب اختيار روم نصي.'
                );
            }

            config.logChannelId =
                channel.id;

            saveGuildConfig(
                message.guild.id,
                config
            );

            await message.reply(
                `✅ تم تعيين ${channel} كروم Logs.`
            );

            await sendLog(
                message.guild,
                '📋 Logs Enabled',
                `تم تعيين هذه الروم بواسطة ${message.author}.`,
                '#22c55e'
            );

            return;
        }

        /* =====================================================
           ALLOW BOT
        ===================================================== */

        if (
            command ===
            'allowbot'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية.'
                );
            }

            const botMember =
                getMemberFromMention(
                    message,
                    args[0]
                );

            if (
                !botMember ||
                !botMember.user.bot
            ) {
                return message.reply(
                    '❌ الاستخدام الصحيح:\n`!allowbot @bot`'
                );
            }

            if (
                config.allowedBots.includes(
                    botMember.id
                )
            ) {
                return message.reply(
                    '⚠️ هذا البوت مسموح له بالفعل.'
                );
            }

            config.allowedBots.push(
                botMember.id
            );

            saveGuildConfig(
                message.guild.id,
                config
            );

            return message.reply(
                `✅ تم السماح للبوت ${botMember}.`
            );
        }

        /* =====================================================
           REMOVE BOT
        ===================================================== */

        if (
            command ===
            'removebot'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية.'
                );
            }

            const botMember =
                getMemberFromMention(
                    message,
                    args[0]
                );

            if (
                !botMember ||
                !botMember.user.bot
            ) {
                return message.reply(
                    '❌ الاستخدام الصحيح:\n`!removebot @bot`'
                );
            }

            config.allowedBots =
                config.allowedBots.filter(
                    id =>
                        id !== botMember.id
                );

            saveGuildConfig(
                message.guild.id,
                config
            );

            return message.reply(
                `✅ تم إزالة ${botMember} من قائمة البوتات المسموحة.`
            );
        }

        /* =====================================================
           PROTECTION STATUS
        ===================================================== */

        if (
            command ===
            'protection'
        ) {

            if (!isAdmin(message.member)) {
                return message.reply(
                    '❌ ليس لديك صلاحية.'
                );
            }

            const admins =
                config.adminIds.length;

            const log =
                config.logChannelId
                    ? `<#${config.logChannelId}>`
                    : 'غير محدد';

            const embed =
                new EmbedBuilder()
                    .setColor('#3b82f6')
                    .setTitle(
                        '🛡️ Protection System'
                    )
                    .addFields(
                        {
                            name:
                                '👑 Owner',
                            value:
                                `<@${MAIN_OWNER_ID}>`,
                            inline: true
                        },
                        {
                            name:
                                '🛡️ Admins',
                            value:
                                `${admins} مسؤول`,
                            inline: true
                        },
                        {
                            name:
                                '📋 Logs',
                            value:
                                log,
                            inline: true
                        },
                        {
                            name:
                                '🚨 Anti Raid',
                            value:
                                config.protection.antiRaid
                                    ? '🟢 ON'
                                    : '🔴 OFF',
                            inline: true
                        },
                        {
                            name:
                                '🚫 Anti Spam',
                            value:
                                config.protection.antiSpam
                                    ? '🟢 ON'
                                    : '🔴 OFF',
                            inline: true
                        },
                        {
                            name:
                                '🤖 Bot Protection',
                            value:
                                config.protection.botProtection
                                    ? '🟢 ON'
                                    : '🔴 OFF',
                            inline: true
                        },
                        {
                            name:
                                '🗑️ Channel Delete',
                            value:
                                config.protection.channelDelete
                                    ? '🟢 ON'
                                    : '🔴 OFF',
                            inline: true
                        },
                        {
                            name:
                                '🎭 Role Delete',
                            value:
                                config.protection.roleDelete
                                    ? '🟢 ON'
                                    : '🔴 OFF',
                            inline: true
                        }
                    )
                    .setTimestamp();

            return message.reply({
                embeds: [embed]
            });
        }
    }
);

/* =========================================================
   BOT PROTECTION + ANTI RAID
========================================================= */

client.on(
    'guildMemberAdd',
    async member => {

        try {

            const guild =
                member.guild;

            const config =
                getGuildConfig(
                    guild.id
                );

            /* =================================================
               BOT PROTECTION
            ================================================= */

            if (
                member.user.bot &&
                config.protection.botProtection
            ) {

                if (
                    isAllowedBot(
                        guild,
                        member.id
                    )
                ) {
                    return;
                }

                const executor =
                    await getExecutor(
                        guild,
                        AuditLogEvent.BotAdd,
                        member.id
                    );

                if (
                    executor &&
                    !isWhitelisted(
                        guild,
                        executor.id
                    )
                ) {

                    await member
                        .kick(
                            'Protection Bot: Unauthorized Bot'
                        )
                        .catch(() => {});

                    await sendLog(
                        guild,
                        '🤖 Unauthorized Bot',
                        `تمت محاولة إضافة بوت غير مصرح به.\n\n**البوت:** ${member.user.tag}\n**بواسطة:** <@${executor.id}>`,
                        '#ef4444'
                    );

                    await punish(
                        guild,
                        executor.id,
                        'إضافة بوت غير مصرح به'
                    );
                }

                return;
            }

            /* =================================================
               ANTI RAID
            ================================================= */

            if (
                !config.protection.antiRaid
            ) {
                return;
            }

            const now =
                Date.now();

            let joins =
                raidJoins.get(
                    guild.id
                ) || [];

            joins.push(now);

            joins =
                joins.filter(
                    timestamp =>
                        now - timestamp <=
                        config.raid.timeWindow
                );

            raidJoins.set(
                guild.id,
                joins
            );

            if (
                joins.length >=
                config.raid.joinLimit
            ) {

                if (
                    !lockdownMap.get(
                        guild.id
                    )
                ) {

                    lockdownMap.set(
                        guild.id,
                        true
                    );

                    await sendLog(
                        guild,
                        '🚨 Anti-Raid Activated',
                        `تم اكتشاف دخول **${joins.length}** أعضاء خلال فترة قصيرة.\n\nتم تفعيل وضع الحماية.`,
                        '#ef4444'
                    );

                    try {

                        await guild.setVerificationLevel(
                            4,
                            'Protection Bot: Anti-Raid'
                        );

                    } catch (error) {

                        console.log(
                            '❌ Verification Error:',
                            error.message
                        );
                    }

                    /*
                        بعد دقيقة نلغي الـLockdown
                        إذا هدأ السيرفر.
                    */

                    setTimeout(
                        () => {
                            lockdownMap.delete(
                                guild.id
                            );

                            raidJoins.delete(
                                guild.id
                            );
                        },
                        60000
                    );
                }
            }

        } catch (error) {

            console.error(
                '❌ guildMemberAdd Error:',
                error
            );
        }
    }
);

/* =========================================================
   ANTI SPAM
========================================================= */

client.on(
    'messageCreate',
    async message => {

        try {

            if (
                message.author.bot ||
                !message.guild
            ) {
                return;
            }

            const config =
                getGuildConfig(
                    message.guild.id
                );

            if (
                !config.protection.antiSpam
            ) {
                return;
            }

            if (
                isWhitelisted(
                    message.guild,
                    message.author.id
                )
            ) {
                return;
            }

            const key =
                `${message.guild.id}:${message.author.id}`;

            const now =
                Date.now();

            let messages =
                spamMap.get(key) || [];

            messages.push(now);

            messages =
                messages.filter(
                    timestamp =>
                        now - timestamp <=
                        config.spam.timeWindow
                );

            spamMap.set(
                key,
                messages
            );

            if (
                messages.length >=
                config.spam.messageLimit
            ) {

                spamMap.delete(key);

                await message.delete()
                    .catch(() => {});

                if (
                    message.member
                ) {

                    await message.member
                        .timeout(
                            config.spam.muteDuration,
                            'Protection Bot: Anti-Spam'
                        )
                        .catch(() => {});
                }

                await sendLog(
                    message.guild,
                    '🚫 Anti-Spam',
                    `تم اكتشاف Spam من <@${message.author.id}>.\n\nتم اتخاذ إجراء تلقائي.`,
                    '#ef4444'
                );
            }

        } catch (error) {

            console.error(
                '❌ Anti-Spam Error:',
                error
            );
        }
    }
);

/* =========================================================
   CHANNEL DELETE PROTECTION
========================================================= */

client.on(
    'channelDelete',
    async channel => {

        try {

            if (!channel.guild) {
                return;
            }

            const guild =
                channel.guild;

            const config =
                getGuildConfig(
                    guild.id
                );

            if (
                !config.protection.channelDelete
            ) {
                return;
            }

            const executor =
                await getExecutor(
                    guild,
                    AuditLogEvent.ChannelDelete,
                    channel.id
                );

            if (!executor) {
                return;
            }

            if (
                isWhitelisted(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                channelDeleteCounters.get(
                    guild.id
                ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.channelDelete.timeWindow
                );

            channelDeleteCounters.set(
                guild.id,
                data
            );

            await punish(
                guild,
                executor.id,
                `حذف روم: ${channel.name}`
            );

            await sendLog(
                guild,
                '🗑️ Channel Deleted',
                `تم حذف الروم:\n**${channel.name}**\n\nبواسطة: <@${executor.id}>`,
                '#ef4444'
            );

            if (
                data.length >=
                config.channelDelete.limit
            ) {

                await sendLog(
                    guild,
                    '🚨 Channel Protection',
                    `تم اكتشاف حذف عدة رومات بواسطة <@${executor.id}>.`,
                    '#ef4444'
                );
            }

        } catch (error) {

            console.error(
                '❌ Channel Delete Error:',
                error
            );
        }
    }
);

/* =========================================================
   ROLE DELETE PROTECTION
========================================================= */

client.on(
    'roleDelete',
    async role => {

        try {

            const guild =
                role.guild;

            const config =
                getGuildConfig(
                    guild.id
                );

            if (
                !config.protection.roleDelete
            ) {
                return;
            }

            const executor =
                await getExecutor(
                    guild,
                    AuditLogEvent.RoleDelete,
                    role.id
                );

            if (!executor) {
                return;
            }

            if (
                isWhitelisted(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                roleDeleteCounters.get(
                    guild.id
                ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.roleDelete.timeWindow
                );

            roleDeleteCounters.set(
                guild.id,
                data
            );

            await punish(
                guild,
                executor.id,
                `حذف رتبة: ${role.name}`
            );

            await sendLog(
                guild,
                '🎭 Role Deleted',
                `تم حذف الرتبة:\n**${role.name}**\n\nبواسطة: <@${executor.id}>`,
                '#ef4444'
            );

            if (
                data.length >=
                config.roleDelete.limit
            ) {

                await sendLog(
                    guild,
                    '🚨 Role Protection',
                    `تم اكتشاف حذف عدة رتب بواسطة <@${executor.id}>.`,
                    '#ef4444'
                );
            }

        } catch (error) {

            console.error(
                '❌ Role Delete Error:',
                error
            );
        }
    }
);

/* =========================================================
   CLEANUP
========================================================= */

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                key,
                timestamps
            ] of spamMap
        ) {

            const filtered =
                timestamps.filter(
                    timestamp =>
                        now - timestamp <=
                        10000
                );

            if (
                filtered.length === 0
            ) {
                spamMap.delete(key);
            } else {
                spamMap.set(
                    key,
                    filtered
                );
            }
        }

    },
    30000
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
    'error',
    error => {
        console.error(
            '❌ Discord Client Error:',
            error
        );
    }
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '❌ Unhandled Rejection:',
            error
        );
    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
    BOT_TOKEN
);
