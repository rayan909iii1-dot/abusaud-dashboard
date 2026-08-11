const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    AuditLogEvent,
    EmbedBuilder,
    Collection
} = require("discord.js");

const fs = require("fs");
const path = require("path");

/* =========================================================
   ENV
========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN) {
    console.error("❌ Error: Bot Token is missing!");
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error("❌ Error: CLIENT_ID is missing!");
    process.exit(1);
}

/* =========================================================
   SETTINGS
========================================================= */

const PREFIX = "!";

/*
    الأونر الأساسي للبوت
    غيره إلى آيدي حسابك
*/
const OWNER_ID = "1113483140086907093";

/*
    ملف مستقل لكل بوت
*/
const configPath = path.join(
    __dirname,
    `config_${CLIENT_ID}.json`
);

/* =========================================================
   CONFIG
========================================================= */

function getDefaultConfig() {
    return {
        ownerId: OWNER_ID,

        adminId: "",

        logChannelId: "",

        whitelist: [
            OWNER_ID
        ],

        protection: {

            antiRaid: true,

            antiSpam: true,

            channelDelete: true,

            roleDelete: true,

            channelCreate: true,

            roleCreate: true,

            botProtection: true,

            guildUpdate: true
        },

        allowedBots: [],

        raid: {
            joinLimit: 5,
            timeWindow: 10000,
            lockdownDuration: 60000
        },

        spam: {
            messageLimit: 6,
            timeWindow: 5000,
            muteDuration: 10 * 60 * 1000
        },

        channelDelete: {
            limit: 2,
            timeWindow: 10000
        },

        roleDelete: {
            limit: 2,
            timeWindow: 10000
        },

        channelCreate: {
            limit: 5,
            timeWindow: 10000
        },

        roleCreate: {
            limit: 5,
            timeWindow: 10000
        }
    };
}

/* =========================================================
   GET CONFIG
========================================================= */

function getConfig() {

    try {

        if (!fs.existsSync(configPath)) {

            const defaultConfig = getDefaultConfig();

            fs.writeFileSync(
                configPath,
                JSON.stringify(
                    defaultConfig,
                    null,
                    2
                )
            );

            return defaultConfig;
        }

        const data = JSON.parse(
            fs.readFileSync(
                configPath,
                "utf8"
            )
        );

        return {
            ...getDefaultConfig(),
            ...data
        };

    } catch (error) {

        console.error(
            "❌ Config Error:",
            error.message
        );

        return getDefaultConfig();
    }
}

/* =========================================================
   SAVE CONFIG
========================================================= */

function saveConfig(data) {

    try {

        fs.writeFileSync(
            configPath,
            JSON.stringify(
                data,
                null,
                2
            )
        );

        return true;

    } catch (error) {

        console.error(
            "❌ Config Save Error:",
            error.message
        );

        return false;
    }
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.MessageContent,

        GatewayIntentBits.GuildModeration
    ],

    partials: [

        Partials.Channel,

        Partials.GuildMember,

        Partials.Message
    ]
});

/* =========================================================
   DATA
========================================================= */

const spamMap = new Collection();

const raidJoins = new Map();

const protectionCounters = {

    channelDelete: new Map(),

    roleDelete: new Map(),

    channelCreate: new Map(),

    roleCreate: new Map()
};

const lockdownMap = new Map();

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {

    console.log(
        "===================================="
    );

    console.log(
        `🛡️ Protection Bot Online`
    );

    console.log(
        `Bot: ${client.user.tag}`
    );

    console.log(
        `ID: ${client.user.id}`
    );

    console.log(
        `Servers: ${client.guilds.cache.size}`
    );

    console.log(
        "===================================="
    );

    client.user.setPresence({

        activities: [

            {
                name: "Protection System",
                type: 3
            }

        ],

        status: "online"
    });
});

/* =========================================================
   HELPERS
========================================================= */

function isOwner(id) {

    const config = getConfig();

    return id === config.ownerId;
}

function isAdmin(id) {

    const config = getConfig();

    return (

        id === config.ownerId ||

        (
            config.adminId &&
            id === config.adminId
        )
    );
}

function isWhitelisted(id) {

    const config = getConfig();

    if (!id) return false;

    if (id === config.ownerId) {
        return true;
    }

    if (
        config.adminId &&
        id === config.adminId
    ) {
        return true;
    }

    return config.whitelist.includes(id);
}

function isAllowedBot(id) {

    const config = getConfig();

    return config.allowedBots.includes(id);
}

/* =========================================================
   LOG CHANNEL
========================================================= */

function getLogChannel(guild) {

    const config = getConfig();

    if (!config.logChannelId) {
        return null;
    }

    return guild.channels.cache.get(
        config.logChannelId
    ) || null;
}

/* =========================================================
   SEND LOG
========================================================= */

async function sendLog(
    guild,
    title,
    description,
    color = 0x3b82f6
) {

    try {

        const channel =
            getLogChannel(guild);

        if (!channel) return;

        const embed = new EmbedBuilder()

            .setColor(color)

            .setTitle(title)

            .setDescription(description)

            .setTimestamp()

            .setFooter({
                text: "Protection System"
            });

        await channel.send({

            embeds: [
                embed
            ]

        });

    } catch (error) {

        console.log(
            "❌ Log Error:",
            error.message
        );
    }
}

/* =========================================================
   CLEAN COUNTER
========================================================= */

function cleanCounter(
    map,
    guildId,
    timeWindow
) {

    const now = Date.now();

    const data =
        map.get(guildId) || [];

    const filtered =
        data.filter(
            timestamp =>
                now - timestamp <= timeWindow
        );

    map.set(
        guildId,
        filtered
    );

    return filtered;
}

/* =========================================================
   GET AUDIT EXECUTOR
========================================================= */

async function getExecutor(
    guild,
    type,
    targetId
) {

    try {

        const logs =
            await guild.fetchAuditLogs({

                type: type,

                limit: 10
            });

        const entry =
            logs.entries.find(entry => {

                return (

                    entry.target?.id === targetId &&

                    Date.now() -
                    entry.createdTimestamp <
                    15000
                );
            });

        return entry?.executor || null;

    } catch (error) {

        console.log(
            "Audit Log Error:",
            error.message
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

        if (!userId) return;

        if (isWhitelisted(userId)) {

            await sendLog(

                guild,

                "🟡 Whitelisted Action",

                `العضو: <@${userId}>\n` +
                `السبب: ${reason}\n\n` +
                `تم تجاهل الإجراء لأن العضو في قائمة الاستثناء.`,

                0xf59e0b
            );

            return;
        }

        const member =
            await guild.members
                .fetch(userId)
                .catch(() => null);

        if (!member) return;

        if (
            member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {

            await sendLog(

                guild,

                "⚠️ محاولة تخريب",

                `العضو: <@${userId}>\n` +
                `السبب: ${reason}\n\n` +
                `لم يتم تنفيذ العقوبة بسبب امتلاكه Administrator.`,

                0xf59e0b
            );

            return;
        }

        let punished = false;

        try {

            await member.kick(
                `Protection Bot: ${reason}`
            );

            punished = true;

        } catch {

            try {

                await member.timeout(

                    24 * 60 * 60 * 1000,

                    `Protection Bot: ${reason}`
                );

                punished = true;

            } catch {}
        }

        await sendLog(

            guild,

            punished
                ? "🔴 تم اتخاذ إجراء أمني"
                : "⚠️ فشل تنفيذ العقوبة",

            `العضو: <@${userId}>\n` +
            `السبب: **${reason}**`,

            punished
                ? 0xef4444
                : 0xf59e0b
        );

    } catch (error) {

        console.log(
            "Punishment Error:",
            error.message
        );
    }
}

/* =========================================================
   OWNER COMMANDS
========================================================= */

client.on(
    "messageCreate",
    async message => {

        try {

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
                    .split(/ +/);

            const command =
                args.shift()
                    .toLowerCase();

            const config =
                getConfig();

            /* =================================================
               SET ADMIN
            ================================================= */

            if (
                command === "setadmin"
            ) {

                if (
                    message.author.id !==
                    config.ownerId
                ) {

                    return message.reply(
                        "❌ هذا الأمر للمالك فقط."
                    );
                }

                const member =
                    message.mentions.members
                        .first();

                if (!member) {

                    return message.reply(
                        "❌ الاستخدام:\n`!setadmin @الشخص`"
                    );
                }

                config.adminId =
                    member.id;

                if (
                    !config.whitelist.includes(
                        member.id
                    )
                ) {

                    config.whitelist.push(
                        member.id
                    );
                }

                saveConfig(config);

                await message.reply(
                    `✅ تم تحديد المسؤول.\n\n` +
                    `👤 المسؤول: ${member}\n` +
                    `🆔 ID: \`${member.id}\``
                );

                return;
            }

            /* =================================================
               REMOVE ADMIN
            ================================================= */

            if (
                command === "removeadmin"
            ) {

                if (
                    message.author.id !==
                    config.ownerId
                ) {

                    return message.reply(
                        "❌ هذا الأمر للمالك فقط."
                    );
                }

                const oldAdmin =
                    config.adminId;

                config.adminId = "";

                config.whitelist =
                    config.whitelist.filter(
                        id =>
                            id !== oldAdmin
                    );

                if (
                    !config.whitelist.includes(
                        config.ownerId
                    )
                ) {

                    config.whitelist.push(
                        config.ownerId
                    );
                }

                saveConfig(config);

                await message.reply(
                    "✅ تم إزالة المسؤول."
                );

                return;
            }

            /* =================================================
               SET LOG
            ================================================= */

            if (
                command === "setlog"
            ) {

                if (
                    message.author.id !==
                    config.ownerId
                ) {

                    return message.reply(
                        "❌ هذا الأمر للمالك فقط."
                    );
                }

                const channel =
                    message.mentions.channels
                        .first();

                if (!channel) {

                    return message.reply(
                        "❌ الاستخدام:\n`!setlog #روم-اللوق`"
                    );
                }

                config.logChannelId =
                    channel.id;

                saveConfig(config);

                await message.reply(
                    `✅ تم تحديد روم اللوق:\n${channel}`
                );

                await sendLog(

                    message.guild,

                    "📋 Log Channel Updated",

                    `تم تحديد ${channel} كروم لوق الحماية.`,

                    0x22c55e
                );

                return;
            }

            /* =================================================
               ADD BOT
            ================================================= */

            if (
                command === "allowbot"
            ) {

                if (
                    message.author.id !==
                    config.ownerId
                ) {

                    return message.reply(
                        "❌ هذا الأمر للمالك فقط."
                    );
                }

                const bot =
                    message.mentions.users
                        .first();

                if (
                    !bot ||
                    !bot.bot
                ) {

                    return message.reply(
                        "❌ منشن البوت المطلوب."
                    );
                }

                if (
                    !config.allowedBots
                        .includes(bot.id)
                ) {

                    config.allowedBots.push(
                        bot.id
                    );
                }

                saveConfig(config);

                await message.reply(
                    `✅ تم السماح للبوت:\n${bot}\n\n` +
                    `🆔 \`${bot.id}\``
                );

                return;
            }

            /* =================================================
               REMOVE BOT
            ================================================= */

            if (
                command === "removebot"
            ) {

                if (
                    message.author.id !==
                    config.ownerId
                ) {

                    return message.reply(
                        "❌ هذا الأمر للمالك فقط."
                    );
                }

                const bot =
                    message.mentions.users
                        .first();

                if (!bot) {

                    return message.reply(
                        "❌ منشن البوت."
                    );
                }

                config.allowedBots =
                    config.allowedBots.filter(
                        id =>
                            id !== bot.id
                    );

                saveConfig(config);

                await message.reply(
                    `✅ تم إزالة البوت من قائمة السماح:\n${bot}`
                );

                return;
            }

            /* =================================================
               PROTECTION STATUS
            ================================================= */

            if (
                command === "protection"
            ) {

                if (
                    !isAdmin(
                        message.author.id
                    )
                ) {

                    return message.reply(
                        "❌ ليس لديك صلاحية استخدام هذا الأمر."
                    );
                }

                const admin =
                    config.adminId
                        ? `<@${config.adminId}>`
                        : "غير محدد";

                const log =
                    config.logChannelId
                        ? `<#${config.logChannelId}>`
                        : "غير محدد";

                const embed =
                    new EmbedBuilder()

                        .setColor(
                            0x3b82f6
                        )

                        .setTitle(
                            "🛡️ Protection System"
                        )

                        .addFields(

                            {
                                name:
                                    "👑 Owner",

                                value:
                                    `<@${config.ownerId}>`,

                                inline: true
                            },

                            {
                                name:
                                    "🛡️ Admin",

                                value:
                                    admin,

                                inline: true
                            },

                            {
                                name:
                                    "📋 Logs",

                                value:
                                    log,

                                inline: true
                            },

                            {
                                name:
                                    "🚨 Anti Raid",

                                value:
                                    config.protection
                                        .antiRaid
                                        ? "🟢 ON"
                                        : "🔴 OFF",

                                inline: true
                            },

                            {
                                name:
                                    "🚫 Anti Spam",

                                value:
                                    config.protection
                                        .antiSpam
                                        ? "🟢 ON"
                                        : "🔴 OFF",

                                inline: true
                            },

                            {
                                name:
                                    "🤖 Bot Protection",

                                value:
                                    config.protection
                                        .botProtection
                                        ? "🟢 ON"
                                        : "🔴 OFF",

                                inline: true
                            },

                            {
                                name:
                                    "🗑️ Channel Delete",

                                value:
                                    config.protection
                                        .channelDelete
                                        ? "🟢 ON"
                                        : "🔴 OFF",

                                inline: true
                            },

                            {
                                name:
                                    "🎭 Role Delete",

                                value:
                                    config.protection
                                        .roleDelete
                                        ? "🟢 ON"
                                        : "🔴 OFF",

                                inline: true
                            }
                        )

                        .setTimestamp();

                await message.reply({
                    embeds: [
                        embed
                    ]
                });

                return;
            }

            /* =================================================
               HELP
            ================================================= */

            if (
                command === "protectionhelp"
            ) {

                if (
                    !isAdmin(
                        message.author.id
                    )
                ) {

                    return message.reply(
                        "❌ ليس لديك صلاحية."
                    );
                }

                const embed =
                    new EmbedBuilder()

                        .setColor(
                            0x3b82f6
                        )

                        .setTitle(
                            "🛡️ Protection Commands"
                        )

                        .setDescription(

                            [
                                "`!setadmin @user`",
                                "تحديد المسؤول",

                                "`!removeadmin`",
                                "إزالة المسؤول",

                                "`!setlog #channel`",
                                "تحديد روم اللوق",

                                "`!allowbot @bot`",
                                "السماح لبوت",

                                "`!removebot @bot`",
                                "إزالة بوت من السماح",

                                "`!protection`",
                                "عرض حالة الحماية",

                                "`!protectionhelp`",
                                "عرض المساعدة"
                            ].join("\n\n")
                        )

                        .setFooter({
                            text:
                                "Protection System"
                        });

                await message.reply({
                    embeds: [
                        embed
                    ]
                });

                return;
            }

        } catch (error) {

            console.error(
                "❌ Command Error:",
                error
            );
        }
    }
);

/* =========================================================
   ANTI RAID
========================================================= */

client.on(
    "guildMemberAdd",
    async member => {

        try {

            const guild =
                member.guild;

            const config =
                getConfig();

            /* =================================================
               BOT PROTECTION
            ================================================= */

            if (
                member.user.bot &&
                config.protection
                    .botProtection
            ) {

                if (
                    isAllowedBot(
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
                        executor.id
                    )
                ) {

                    await member.kick(
                        "Protection Bot: Unauthorized Bot"
                    ).catch(() => {});

                    await punish(

                        guild,

                        executor.id,

                        `إضافة بوت غير مصرح به: ${member.user.tag}`
                    );
                }

                return;
            }

            /* =================================================
               ANTI RAID
            ================================================= */

            if (
                !config.protection
                    .antiRaid
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

                        "🚨 Anti-Raid Activated",

                        `تم اكتشاف دخول **${joins.length}** أعضاء خلال فترة قصيرة.\n\nتم تفعيل وضع الحماية.`,

                        0xef4444
                    );

                    try {

                        await guild.setVerificationLevel(

                            4,

                            "Protection Bot: Anti-Raid"
                        );

                    } catch (error) {

                        console.log(
                            "Verification Error:",
                            error.message
                        );
                    }

                    setTimeout(
                        async () => {

                            try {

                                await guild.setVerificationLevel(

                                    1,

                                    "Protection Bot: Raid Protection Ended"
                                );

                            } catch {}

                            lockdownMap.delete(
                                guild.id
                            );

                            raidJoins.delete(
                                guild.id
                            );

                            await sendLog(

                                guild,

                                "🟢 Anti-Raid Deactivated",

                                "انتهت فترة الحماية وعاد السيرفر للوضع الطبيعي.",

                                0x22c55e
                            );

                        },

                        config.raid
                            .lockdownDuration
                    );
                }
            }

        } catch (error) {

            console.error(
                "❌ Anti-Raid Error:",
                error
            );
        }
    }
);

/* =========================================================
   ANTI SPAM
========================================================= */

client.on(
    "messageCreate",
    async message => {

        try {

            if (
                !message.guild ||
                message.author.bot
            ) {
                return;
            }

            const config =
                getConfig();

            if (
                !config.protection
                    .antiSpam
            ) {
                return;
            }

            if (
                isWhitelisted(
                    message.author.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                spamMap.get(
                    message.author.id
                ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.spam.timeWindow
                );

            spamMap.set(
                message.author.id,
                data
            );

            if (
                data.length >=
                config.spam.messageLimit
            ) {

                spamMap.delete(
                    message.author.id
                );

                await message.delete()
                    .catch(() => {});

                if (
                    message.member
                ) {

                    await message.member
                        .timeout(

                            config.spam
                                .muteDuration,

                            "Protection Bot: Anti-Spam"

                        )
                        .catch(() => {});
                }

                await sendLog(

                    message.guild,

                    "🚫 Anti-Spam",

                    `تم اكتشاف Spam من <@${message.author.id}>.\n\nتم اتخاذ إجراء تلقائي.`,

                    0xef4444
                );
            }

        } catch (error) {

            console.error(
                "❌ Anti-Spam Error:",
                error
            );
        }
    }
);

/* =========================================================
   CHANNEL DELETE
========================================================= */

client.on(
    "channelDelete",
    async channel => {

        try {

            if (!channel.guild) {
                return;
            }

            const guild =
                channel.guild;

            const config =
                getConfig();

            if (
                !config.protection
                    .channelDelete
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
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                protectionCounters
                    .channelDelete
                    .get(
                        guild.id
                    ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.channelDelete
                            .timeWindow
                );

            protectionCounters
                .channelDelete
                .set(
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

                "🗑️ Channel Deleted",

                `تم حذف الروم:\n` +
                `**${channel.name}**\n\n` +
                `بواسطة: <@${executor.id}>`,

                0xef4444
            );

            if (
                data.length >=
                config.channelDelete
                    .limit
            ) {

                await sendLog(

                    guild,

                    "🚨 Channel Protection",

                    `تم اكتشاف حذف عدة رومات بواسطة <@${executor.id}>.`,

                    0xef4444
                );
            }

        } catch (error) {

            console.error(
                "❌ Channel Delete Error:",
                error
            );
        }
    }
);

/* =========================================================
   ROLE DELETE
========================================================= */

client.on(
    "roleDelete",
    async role => {

        try {

            const guild =
                role.guild;

            const config =
                getConfig();

            if (
                !config.protection
                    .roleDelete
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
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                protectionCounters
                    .roleDelete
                    .get(
                        guild.id
                    ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.roleDelete
                            .timeWindow
                );

            protectionCounters
                .roleDelete
                .set(
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

                "🎭 Role Deleted",

                `تم حذف الرتبة:\n` +
                `**${role.name}**\n\n` +
                `بواسطة: <@${executor.id}>`,

                0xef4444
            );

        } catch (error) {

            console.error(
                "❌ Role Delete Error:",
                error
            );
        }
    }
);

/* =========================================================
   CHANNEL CREATE
========================================================= */

client.on(
    "channelCreate",
    async channel => {

        try {

            if (!channel.guild) {
                return;
            }

            const guild =
                channel.guild;

            const config =
                getConfig();

            if (
                !config.protection
                    .channelCreate
            ) {
                return;
            }

            const executor =
                await getExecutor(

                    guild,

                    AuditLogEvent.ChannelCreate,

                    channel.id
                );

            if (!executor) {
                return;
            }

            if (
                isWhitelisted(
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                protectionCounters
                    .channelCreate
                    .get(
                        guild.id
                    ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.channelCreate
                            .timeWindow
                );

            protectionCounters
                .channelCreate
                .set(
                    guild.id,
                    data
                );

            if (
                data.length >=
                config.channelCreate
                    .limit
            ) {

                await channel.delete(
                    "Protection Bot: Excessive Channel Creation"
                ).catch(() => {});

                await punish(

                    guild,

                    executor.id,

                    "إنشاء عدد كبير من الرومات"
                );

                await sendLog(

                    guild,

                    "🚨 Channel Creation Protection",

                    `تم اكتشاف إنشاء عدد كبير من الرومات بواسطة <@${executor.id}>.`,

                    0xef4444
                );
            }

        } catch (error) {

            console.error(
                "❌ Channel Create Error:",
                error
            );
        }
    }
);

/* =========================================================
   ROLE CREATE
========================================================= */

client.on(
    "roleCreate",
    async role => {

        try {

            const guild =
                role.guild;

            const config =
                getConfig();

            if (
                !config.protection
                    .roleCreate
            ) {
                return;
            }

            const executor =
                await getExecutor(

                    guild,

                    AuditLogEvent.RoleCreate,

                    role.id
                );

            if (!executor) {
                return;
            }

            if (
                isWhitelisted(
                    executor.id
                )
            ) {
                return;
            }

            const now =
                Date.now();

            let data =
                protectionCounters
                    .roleCreate
                    .get(
                        guild.id
                    ) || [];

            data.push(now);

            data =
                data.filter(
                    timestamp =>
                        now - timestamp <=
                        config.roleCreate
                            .timeWindow
                );

            protectionCounters
                .roleCreate
                .set(
                    guild.id,
                    data
                );

            if (
                data.length >=
                config.roleCreate
                    .limit
            ) {

                await role.delete(
                    "Protection Bot: Excessive Role Creation"
                ).catch(() => {});

                await punish(

                    guild,

                    executor.id,

                    "إنشاء عدد كبير من الرتب"
                );

                await sendLog(

                    guild,

                    "🚨 Role Creation Protection",

                    `تم اكتشاف إنشاء عدد كبير من الرتب بواسطة <@${executor.id}>.`,

                    0xef4444
                );
            }

        } catch (error) {

            console.error(
                "❌ Role Create Error:",
                error
            );
        }
    }
);

/* =========================================================
   GUILD UPDATE
========================================================= */

client.on(
    "guildUpdate",
    async (oldGuild, newGuild) => {

        try {

            const config =
                getConfig();

            if (
                !config.protection
                    .guildUpdate
            ) {
                return;
            }

            const changes = [];

            if (
                oldGuild.name !==
                newGuild.name
            ) {

                changes.push(
                    "تغيير اسم السيرفر"
                );
            }

            if (
                oldGuild.icon !==
                newGuild.icon
            ) {

                changes.push(
                    "تغيير صورة السيرفر"
                );
            }

            if (!changes.length) {
                return;
            }

            const executor =
                await getExecutor(

                    newGuild,

                    AuditLogEvent.GuildUpdate,

                    newGuild.id
                );

            if (!executor) {
                return;
            }

            if (
                isWhitelisted(
                    executor.id
                )
            ) {
                return;
            }

            await punish(

                newGuild,

                executor.id,

                changes.join(" + ")
            );

            await sendLog(

                newGuild,

                "🏠 Server Protection",

                `تم اكتشاف تعديل على السيرفر بواسطة <@${executor.id}>.\n\n` +
                changes.join("\n"),

                0xef4444
            );

        } catch (error) {

            console.error(
                "❌ Guild Update Error:",
                error
            );
        }
    }
);

/* =========================================================
   ERRORS
========================================================= */

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(BOT_TOKEN);
