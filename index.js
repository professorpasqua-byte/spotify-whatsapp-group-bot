const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    downloadContentFromMessage,
    delay
} = require('@whiskeysockets/baileys');
const readline = require('readline-sync');
const axios = require('axios');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const FormData = require('form-data');
const crypto = require('crypto');
const webpmux = require('node-webpmux'); // DEPENDENCY: run `npm install node-webpmux` (used by !steal)
// ===== API CONFIGURATIONS =====
// Paste your keys here, or set them as environment variables:
//   GROQ_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
// Spotify Web API (free): https://developer.spotify.com/dashboard -> Create app -> copy Client ID + Client Secret.
// Without these the bot still works, but Spotify commands only give search links instead of full track cards.
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const BOT_NAME = "Mr Man"; // the name the bot uses for itself in music replies (change it to anything you like)
// (OpenRouter removed - Groq now handles text, voice transcription, image vision AND voice replies.)
// ===== TEXT-TO-SPEECH CONFIG (no credit card needed for any of these) =====
// Edge neural voices (free, no key). If these ever start returning 403 again, Microsoft
// bumped its browser version - update EDGE_CHROMIUM_VERSION to the current Edge version.
const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_CHROMIUM_VERSION = "143.0.3650.75";
// ===== NIGERIA TIME ENGINE (forced Africa/Lagos, WAT, UTC+1, no DST) =====
const NG_TIMEZONE = 'Africa/Lagos';
function getNigeriaParts() {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: NG_TIMEZONE,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = fmt.formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return map;
}
function ngLocaleTimeString(date) {
    return date.toLocaleTimeString('en-US', { timeZone: NG_TIMEZONE });
}
// Ensure Download directory exists for Saved/Deleted Media & Audio
const downloadDir = './WA_Termux_Media';
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}
// Memory stores
const messageStore = new Map();
const DB_PATH = './bot_memory.json';
const DEFAULT_SETTINGS = {
    botActive: true,
    voiceMode: "off",
    voiceChance: 30,
    groupChatMode: true,
    customOwnerName: "",
    customOwnerNumber: "",
    aiLanguage: "English",
    assistantMood: "",
    assistantMoodDate: "",
    lastBioUpdateDate: "",
    blacklist: [],
    afkActive: false,
    afkReason: "",
    afkSince: "",
    ttsVoice: "en-US-AndrewNeural",
    antispamActive: true,
    publicMode: false,
    // ----- music / Spotify group settings -----
    welcomeActive: true,        // greet new members using the group's exact name
    welcomeMessage: "",         // custom template ("" = built-in music welcome)
    goodbyeActive: false,
    antilinkActive: true,       // delete foreign WhatsApp group links
    antilinkMode: "whatsapp",   // "whatsapp" = block foreign WA invites | "strict" = only music links allowed
    spotifyLinkCards: true,     // auto track/album/artist card when someone posts a Spotify link
    bannedWords: []
};
let db = { contacts: {}, groups: {}, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
// Load persistent database
if (fs.existsSync(DB_PATH)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_PATH));
        if (!db.contacts) db.contacts = {};
        if (!db.groups) db.groups = {};
        if (!db.settings) db.settings = {};
        // MIGRATION: older saves stored voiceMode as a boolean (true/false).
        // Convert those to the tri-state string so !voice on/off/auto keeps working with old bot_memory.json files.
        if (typeof db.settings.voiceMode === 'boolean') db.settings.voiceMode = db.settings.voiceMode ? "on" : "off";
        // Fill in any setting that an older save doesn't have yet.
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (db.settings[key] === undefined) db.settings[key] = JSON.parse(JSON.stringify(value));
        }
        if (!Array.isArray(db.settings.blacklist)) db.settings.blacklist = [];
        if (!Array.isArray(db.settings.bannedWords)) db.settings.bannedWords = [];
        // MIGRATION: if an old espeak-style voice code (e.g. "en-us+f3") is
        // still saved from before the earlier TTS switch, reset it to a valid
        // Edge neural voice name so !ttsvoice / voice mode don't break.
        if (db.settings.ttsVoice && db.settings.ttsVoice.includes('+')) {
            db.settings.ttsVoice = "en-US-AndrewNeural";
        }
        if (db.settings.ttsVoice && !db.settings.ttsVoice.includes('-')) db.settings.ttsVoice = "en-US-AndrewNeural"; // old ElevenLabs/Orpheus pick
        // The business features were removed - drop their old saved values.
        ['businessActive', 'businessInfo', 'pricesInfo', 'locationInfo'].forEach(k => { delete db.settings[k]; });
    } catch (e) {
        console.error("Error loading bot_memory.json, starting fresh.");
    }
}
function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function extractPhoneNumber(jid) {
    if (!jid) return "";
    return jid.split('@')[0].split(':')[0];
}
function normalizeJid(jid) {
    if (!jid) return "";
    const phone = extractPhoneNumber(jid);
    return `${phone}@s.whatsapp.net`;
}
// ===== TIME & DAY CONTEXT ENGINE (Nigeria time) =====
function getTimeContext() {
    const parts = getNigeriaParts();
    const hour = parseInt(parts.hour, 10);
    const day = parts.weekday;
    const isWeekend = (day === 'Saturday' || day === 'Sunday');
    let partOfDay;
    if (hour >= 5 && hour < 12) partOfDay = "morning";
    else if (hour >= 12 && hour < 17) partOfDay = "afternoon";
    else if (hour >= 17 && hour < 21) partOfDay = "evening";
    else partOfDay = "late night";
    const hour12 = ((hour % 12) || 12);
    const ampm = hour < 12 ? 'AM' : 'PM';
    return {
        hour,
        day,
        isWeekend,
        partOfDay,
        dateStr: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
        timeStr: `${hour12}:${parts.minute} ${ampm}`,
        readable: `${day} ${partOfDay}${isWeekend ? " (weekend)" : ""}, around ${hour12}:${parts.minute} ${ampm} (Nigeria time)`
    };
}
// ===== PRESENCE PATTERN ENGINE =====
function startPresencePatternLoop(sock) {
    async function cycle() {
        try {
            const goOnline = Math.random() < 0.5;
            await sock.sendPresenceUpdate(goOnline ? 'available' : 'unavailable');
        } catch (e) {}
        const nextMs = (4 + Math.random() * 36) * 60 * 1000;
        setTimeout(cycle, nextMs);
    }
    setTimeout(cycle, 30000 + Math.random() * 60000);
}
// ===== DAILY AUTONOMOUS BIO ENGINE (updates WhatsApp "About" text) =====
const BIO_TEMPLATES = [
    (d) => `🎧 ${BOT_NAME} - Spotify & Music Group Assistant | Active: ${d}\nOwner: Hancock (+2349135615687)\nAsk me for songs, playlists & music vibes!`,
    (d) => `🎶 Spinning in the group chats since: ${d}\nI'm Hancock's music assistant - request a song with !request.`,
    (d) => `💚 Spotify squad assistant online as of ${d}. Tag me for song recs, trivia & music talk.`,
    (d) => `🎵 Last sound check: ${d}\nStill vibing, still replying. Hancock's music bot - ask away.`,
    (d) => `🔊 Daily playlist refresh: ${d}\n${BOT_NAME} here, keeping the music group clean & the vibes high for owner Hancock (+2349135615687).`
];
function buildDailyBioText() {
    const parts = getNigeriaParts();
    const dateLabel = `${parts.weekday}, ${parts.month} ${parts.day}`;
    const template = BIO_TEMPLATES[Math.floor(Math.random() * BIO_TEMPLATES.length)];
    return template(dateLabel);
}
async function maybeUpdateDailyBio(sock) {
    const parts = getNigeriaParts();
    const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
    if (db.settings.lastBioUpdateDate === todayKey) return;
    try {
        const bioText = buildDailyBioText();
        await sock.updateProfileStatus(bioText);
        db.settings.lastBioUpdateDate = todayKey;
        saveDB();
        console.log(`[Daily Bio] Updated About status for ${todayKey}: "${bioText}"`);
    } catch (e) {
        console.error('[Daily Bio] Failed to update status:', e.message);
    }
}
// ===== LANGUAGE ENGINE =====
const LANGUAGE_MAP = {
    english: "English", igbo: "Igbo", yoruba: "Yoruba", hausa: "Hausa", pidgin: "Nigerian Pidgin",
    swahili: "Swahili", zulu: "Zulu", amharic: "Amharic", russian: "Russian", spanish: "Spanish",
    french: "French", portuguese: "Portuguese", german: "German", italian: "Italian", dutch: "Dutch",
    polish: "Polish", greek: "Greek", turkish: "Turkish", hindi: "Hindi", urdu: "Urdu",
    bengali: "Bengali", punjabi: "Punjabi", tamil: "Tamil", arabic: "Arabic", hebrew: "Hebrew",
    persian: "Persian (Farsi)", chinese: "Chinese (Mandarin)", japanese: "Japanese", korean: "Korean",
    vietnamese: "Vietnamese", thai: "Thai", indonesian: "Indonesian", malay: "Malay",
    tagalog: "Tagalog (Filipino)",
    afrikaans: "Afrikaans", somali: "Somali", telugu: "Telugu", malayalam: "Malayalam", kannada: "Kannada",
    marathi: "Marathi", gujarati: "Gujarati", nepali: "Nepali", sinhala: "Sinhala", pashto: "Pashto",
    cantonese: "Chinese (Cantonese)", javanese: "Javanese", sundanese: "Sundanese", khmer: "Khmer",
    lao: "Lao", burmese: "Burmese", swedish: "Swedish", norwegian: "Norwegian", danish: "Danish",
    finnish: "Finnish", icelandic: "Icelandic", czech: "Czech", slovak: "Slovak", hungarian: "Hungarian",
    romanian: "Romanian", bulgarian: "Bulgarian", ukrainian: "Ukrainian", croatian: "Croatian",
    serbian: "Serbian", slovenian: "Slovenian", macedonian: "Macedonian", bosnian: "Bosnian",
    albanian: "Albanian", lithuanian: "Lithuanian", latvian: "Latvian", estonian: "Estonian",
    catalan: "Catalan", galician: "Galician", irish: "Irish", welsh: "Welsh", maltese: "Maltese",
    azerbaijani: "Azerbaijani", kazakh: "Kazakh", uzbek: "Uzbek", georgian: "Georgian",
    armenian: "Armenian", mongolian: "Mongolian"
};
function levenshtein(a, b) {
    const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
function findClosestLanguage(input) {
    const lower = input.toLowerCase().trim();
    if (LANGUAGE_MAP[lower]) return lower;
    let best = null;
    let bestDist = Infinity;
    for (const key of Object.keys(LANGUAGE_MAP)) {
        const d = levenshtein(lower, key);
        if (d < bestDist) {
            bestDist = d;
            best = key;
        }
    }
    const threshold = lower.length > 6 ? 3 : 2;
    return bestDist <= threshold ? best : null;
}
// ===== EMOTION / "HEART" ENGINE =====
const EMOTION_KEYWORDS = {
    happy: ['lol', 'haha', 'hahaha', 'lmao', 'glad', 'great', 'awesome', 'yay', 'excited', 'love it', 'nice one', 'amazing', '😂', '😄', '😁', '🎉', '🥳'],
    sad: ['sad', 'depressed', 'down', 'crying', 'hurt', 'miss you', 'lonely', 'heartbroken', 'sigh', '😢', '😭', '💔'],
    angry: ['angry', 'mad', 'pissed', 'annoyed', 'wtf', 'stop it', 'hate', 'furious', 'irritated', '😠', '😡'],
    flirty: ['cutie', 'babe', 'miss u', 'sexy', 'beautiful', 'handsome', 'love you', 'kiss', '😘', '😍', '🥰'],
    sarcastic: ['sure jan', 'yeah right', 'totally', 'whatever', 'lol ok', 'as if', 'oh really', 'wow shocking'],
    playful: ['jk', 'joking', 'kidding', 'lmaooo', 'haha', '😜', '😂', '🤣'],
    stressed: ['tired', 'exhausted', 'busy', 'stressed', 'overwhelmed', "can't deal", 'burnt out', 'drained'],
    excited: ['omg', 'no way', "can't wait", 'finally', 'yesss', 'lets go', "let's go", '🔥', '🙌']
};
function detectTone(text) {
    if (!text) return 'neutral';
    const lower = text.toLowerCase();
    let scores = {};
    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        scores[emotion] = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    }
    const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return ranked.length ? ranked[0][0] : 'neutral';
}
function updateEmotionalState(phoneNumber, text) {
    const tone = detectTone(text);
    const contact = db.contacts[phoneNumber];
    if (!contact) return tone;
    if (!contact.mood) contact.mood = 'neutral';
    if (typeof contact.bondScore !== 'number') contact.bondScore = 0;
    contact.mood = tone;
    const positiveTones = ['happy', 'flirty', 'playful', 'excited'];
    const negativeTones = ['angry'];
    const needsComfort = ['sad', 'stressed'];
    if (positiveTones.includes(tone)) contact.bondScore = Math.min(10, contact.bondScore + 1);
    if (negativeTones.includes(tone)) contact.bondScore = Math.max(-10, contact.bondScore - 1);
    if (needsComfort.includes(tone)) contact.bondScore = Math.min(10, contact.bondScore + 0.5);
    return tone;
}
const ASSISTANT_MOODS = [
    'hyped like a festival crowd', 'chill like a lo-fi playlist at midnight', 'feel-good and sing-along happy',
    'smooth and mellow like late-night R&B', 'nostalgic and throwback-loving', 'energetic like a gym playlist',
    'warm and cozy like an acoustic session'
];
function getAssistantMood() {
    const parts = getNigeriaParts();
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (db.settings.assistantMoodDate !== today || !db.settings.assistantMood) {
        db.settings.assistantMood = ASSISTANT_MOODS[Math.floor(Math.random() * ASSISTANT_MOODS.length)];
        db.settings.assistantMoodDate = today;
        saveDB();
    }
    return db.settings.assistantMood;
}
// ===== CONTACT & GROUP MEMORY MANAGER =====
const INVALID_PUSHNAMES = ["unknown", "mr man", "mrman", "boss"];
function updateContactMemory(senderJid, pushName, groupJid = null, botOwnName = null) {
    const phoneNumber = extractPhoneNumber(senderJid);
    const trimmedPushName = (pushName || "").trim();
    const isSelfName = !!(botOwnName && trimmedPushName.toLowerCase() === botOwnName.trim().toLowerCase());
    const isPlaceholder =
        !trimmedPushName ||
        INVALID_PUSHNAMES.includes(trimmedPushName.toLowerCase()) ||
        trimmedPushName.toLowerCase().includes("assistant") ||
        isSelfName;
    const cleanPushName = isPlaceholder ? `User +${phoneNumber}` : trimmedPushName;
    if (!db.contacts[phoneNumber]) {
        db.contacts[phoneNumber] = {
            jid: normalizeJid(senderJid),
            name: cleanPushName,
            nickname: "",
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            notes: "",
            mood: "neutral",
            bondScore: 0,
            lastAfkNotified: "",
            history: []
        };
    }
    if (!isPlaceholder && db.contacts[phoneNumber].name !== cleanPushName) {
        db.contacts[phoneNumber].name = cleanPushName;
    }
    db.contacts[phoneNumber].lastSeen = new Date().toISOString();
    if (groupJid) {
        if (!db.groups[groupJid]) {
            db.groups[groupJid] = { members: {}, warnings: {} };
        }
        if (!db.groups[groupJid].members) db.groups[groupJid].members = {};
        db.groups[groupJid].members[phoneNumber] = {
            name: cleanPushName || "Unknown",
            lastActive: new Date().toISOString()
        };
    }
    saveDB();
    return db.contacts[phoneNumber];
}
function buildKnownContactsDirectory(excludePhone) {
    const entries = Object.entries(db.contacts)
        .filter(([phone, c]) => phone !== excludePhone && (c.nickname || c.notes))
        .slice(0, 40);
    if (entries.length === 0) return "";
    const lines = entries.map(([phone, c]) => {
        const label = c.nickname || c.name;
        return `- ${label}: ${c.notes || "no additional notes"}`;
    });
    return `\n=== PEOPLE THE OWNER HAS TOLD YOU ABOUT ===\nOnly bring one of these up if THIS specific person is asked about by name. Never volunteer this list, never share another contact's actual conversation history - just the short note below.\n${lines.join('\n')}`;
}
function buildGroupMembersDirectory(groupJid, excludePhone) {
    if (!groupJid || !db.groups[groupJid] || !db.groups[groupJid].members) return "";
    const members = Object.entries(db.groups[groupJid].members)
        .filter(([phone]) => phone !== excludePhone)
        .slice(0, 60);
    if (members.length === 0) return "";
    const lines = members.map(([phone, m]) => `- ${m.name || "Unknown"} (+${phone})`);
    return `\n=== OTHER PEOPLE ACTIVE IN THIS GROUP (from group activity log) ===\nThese are other members you've seen active in THIS group chat specifically. Only bring one of them up if they're relevant to what's being asked (e.g. "who's in this group", or someone asks about a specific person by name) - never dump this whole list unprompted, and never treat this as DM/personal contact info.\n${lines.join('\n')}`;
}
// ===== PUBLIC / PRIVATE ACCESS CONTROL =====
// Commands in this list always stay owner-only even when the bot is set to
// !public, since letting anyone use them could lock the real owner out
// (e.g. a stranger flipping it back to private), wipe all saved data,
// rename the owner, change the owner's number, or tamper with the blacklist.
// (!py runs shell code, !memories/!history/!remember expose private chats, !vv unlocks view-once media -
// all kept owner-only so public mode can never leak them.)
const PRIVILEGED_OWNER_ONLY_COMMANDS = ['public', 'private', 'wipe', 'owner', 'ownernumber', 'blacklist', 'py', 'memories', 'history', 'remember', 'vv',
    'bot', 'voice', 'voicechance', 'groupchat', 'lang', 'language', 'ttsvoice', 'afk'];
// Commands that need the sender to be a GROUP ADMIN (or the owner) when the bot is in public mode.
const ADMIN_ONLY_COMMANDS = ['hidetag', 'svcontact', 'antispam', 'warn', 'resetwarn', 'clearwarn', 'kick', 'remove', 'mute', 'unmute',
    'lock', 'unlock', 'banword', 'bannedword', 'antilink', 'linkcards', 'welcome', 'goodbye', 'setrules', 'clearqueue',
    'removerequest', 'rmrequest', 'next', 'votesongs', 'paid', 'markpaid', 'unpaid', 'unmarkpaid', 'resetpaid', 'newcycle', 'setplan', 'subscribed'];
// ===== PYTHON & TERMUX SYSTEM BRIDGE ENGINE =====
function runSystemCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout.trim());
        });
    });
}
// ===== TEXT-TO-SPEECH ENGINE (MULTI-ENGINE, NO CREDIT CARD NEEDED) =====
// Voice replies use Microsoft Edge neural voices (free, no key, 100+ languages/accents incl. Nigerian English).
// Google TTS is only a last resort for languages Edge has no voice for (e.g. Hausa).
// If every engine fails, the caller sends the reply as normal TEXT.
function escapeSsml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
// Strip things that sound awful when read aloud (links, markdown symbols, emojis).
function cleanForSpeech(t) {
    return String(t || '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_~`#>|]+/g, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u200d\ufe0f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
// ===== QUOTED MEDIA READER =====
// When someone replies to (or tags the bot on) a photo / voice note / video / sticker / document, the bot must
// actually LOOK at it instead of answering blind. Returns { image, audioText, note }.
//   image     -> { buffer, mime } for a quoted photo (the AI vision model will describe it)
//   audioText -> transcript of a quoted voice note
//   note      -> short text hint for things the bot can't open (video, sticker, document)
async function loadQuotedMedia(contextInfo) {
    const out = { image: null, audioText: '', note: '' };
    try {
        if (!contextInfo || !contextInfo.quotedMessage) return out;
        const qm = deepUnwrapMessage(contextInfo.quotedMessage) || contextInfo.quotedMessage;
        const stored = contextInfo.stanzaId ? messageStore.get(contextInfo.stanzaId) : null;
        const fromStore = (type) => (stored && stored.isMedia && stored.mediaType === type && stored.filePath && fs.existsSync(stored.filePath))
            ? fs.readFileSync(stored.filePath) : null;
        const download = async (node, kind) => {
            const st = await downloadContentFromMessage(node, kind);
            const chunks = [];
            for await (const c of st) chunks.push(c);
            return Buffer.concat(chunks);
        };
        if (qm.imageMessage) {
            let buf = fromStore('imageMessage');
            if (!buf) buf = await download(qm.imageMessage, 'image');
            if (buf && buf.length) out.image = { buffer: buf, mime: qm.imageMessage.mimetype || 'image/jpeg' };
        } else if (qm.audioMessage) {
            let buf = fromStore('audioMessage');
            if (!buf) buf = await download(qm.audioMessage, 'audio');
            if (buf && buf.length) {
                const t = await transcribeAudio(buf);
                if (t) out.audioText = t;
            }
        } else if (qm.videoMessage || qm.ptvMessage) {
            const cap = (qm.videoMessage?.caption || '').trim();
            out.note = `a video${cap ? ` with the caption "${cap}"` : ''} (you cannot watch videos - only use the caption/their question, and say so if you truly can't tell)`;
        } else if (qm.stickerMessage) {
            out.note = 'a sticker';
        } else if (qm.documentMessage) {
            out.note = `a file named "${qm.documentMessage.fileName || 'document'}" (you cannot open files - go by the file name and their question)`;
        }
    } catch (e) {
        console.error('[Quoted Media] could not load the replied-to media:', e.message || e);
    }
    return out;
}
// ===== VOICE AUTO (HYBRID) =====
// - They sent a voice note  -> always reply with voice.
// - They sent text          -> voice only some of the time (db.settings.voiceChance %, change with !voicechance),
//                              and ONLY if the reply is short and has no links, code or lists.
function pickVoiceForAuto(replyText, incomingMediaType) {
    if (incomingMediaType === 'audioMessage') return true;
    const chance = Math.min(100, Math.max(0, Number(db.settings.voiceChance ?? 30)));
    const t = String(replyText || '');
    if (t.length > 160) return false;                                   // long -> text
    if (/https?:\/\/|www\./i.test(t)) return false;                     // links -> text
    if (/```|`[^`\n]+`/.test(t)) return false;                          // code -> text
    if (/^\s*([-*\u2022]|\d+[.)])\s+/m.test(t)) return false;           // lists -> text
    if (t.split('\n').filter(l => l.trim()).length > 3) return false;   // multi-paragraph -> text
    return Math.random() * 100 < chance;
}
const DEFAULT_TTS_VOICE = 'en-US-AndrewNeural'; // default = "auto" (best engine picks the voice)
// Voices (by Edge name token) that are male - used to pick a matching male/female voice on the other engines.
const MALE_VOICE_TOKENS = new Set(['Andrew','Guy','Ryan','Abeo','Connor','Luke','Hamed','Shakir','Hamdan','Rafiki','Themba','Ameha','Willem','Henri','Conrad','Alvaro','Jorge','Duarte','Antonio','Diego','Maarten','Marek','Nestoras','Ahmet','Dmitry','Madhur','Asad','Bashkar','Ojas','Valluvar','Avri','Farid','Yunxi','Keita','InJoon','NamMinh','Niwat','Ardi','Osman','Angelo','Brian','Eric','Christopher','Roger','Steffan','Thomas','William','Chilemba','Elimu','James','Wayne','Mitchell','Sam','Prabhat','Jean','Gerard','Fabrice','Jonas','Jan','Tomas','Gonzalo','Alonso','Lorenzo','Alex','Mattias','Finn','Jeppe','Harri','Antonin','Tamas','Emil','Borislav','Ostap','Lukas','Srecko','Nicholas','Rok','Leonas','Nils','Kert','Enric','Roi','Gunnar','Colm','Aled','Joseph','Ilir','Aleksandar','Goran','Babek','Daulet','Sardor','Giorgi','Hayk','Bataa','GulNawaz','Muuse','Sagar','Sameera','Piseth','Chanthavong','Thiha','Dimas','Jajang','Niranjan','Gagan','Midhun','Manohar','Mohan','Kumar','Anbu','Surya','Salman','Pradeep','YunJhe','WanLung','Yunjian','Yunyang','Daudi','Ismael','Bassel','Taim','Fahed','Rami','Omar','Jamal','Abdullah','Moaz','Laith','Hedi','Saleh','Ali','Jeremy']);
function isMaleEdgeVoice(v) {
    const parts = String(v || '').split('-');
    const token = (parts[parts.length - 1] || '').replace(/Neural$/, '').replace(/Multilingual$/, '');
    return MALE_VOICE_TOKENS.has(token);
}
// ---------- Shared helpers ----------
function toOgg(inputArgs, oggPath, cleanupPaths) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg ${inputArgs} -ar 48000 -ac 1 -c:a libopus -b:a 32k "${oggPath}" -y`, (err) => {
            (cleanupPaths || []).forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });
            if (err || !fs.existsSync(oggPath)) reject(new Error('ffmpeg conversion failed (is ffmpeg installed?)'));
            else resolve(oggPath);
        });
    });
}
function stripAudioTags(t) { return String(t || '').replace(/\[[a-z ,'-]{2,30}\]/gi, ' ').replace(/\s+/g, ' ').trim(); }
// Splits long text at sentence boundaries into chunks (used by the Google fallback).
function splitForTts(text, max = 190) {
    const sentences = text.match(/[^.!?؟۔。\n]+[.!?؟۔。]*\s*/g) || [text];
    const chunks = [];
    let cur = '';
    const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
    for (const s of sentences) {
        if (s.length > max) {
            push();
            let piece = '';
            for (const w of s.split(/\s+/)) {
                if ((piece + ' ' + w).length > max) { if (piece.trim()) chunks.push(piece.trim()); piece = w; }
                else piece = piece ? piece + ' ' + w : w;
            }
            if (piece.trim()) chunks.push(piece.trim());
        } else if ((cur + s).length > max) { push(); cur = s; }
        else cur += s;
    }
    push();
    return chunks;
}
// ---------- Main engine: Microsoft Edge neural voices (free, no key) ----------
// Microsoft started requiring a rotating Sec-MS-GEC token - the old 403 you saw was
// exactly that missing token. EDGE_CHROMIUM_VERSION may need a bump every few months.
function edgeSecMsGec(skewSeconds = 0) {
    let ticks = BigInt(Math.floor(Date.now() / 1000) + Math.round(skewSeconds) + 11644473600);
    ticks -= ticks % 300n;
    ticks *= 10000000n;
    return crypto.createHash('sha256').update(`${ticks.toString()}${EDGE_TRUSTED_CLIENT_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}
function edgeAttempt(text, voice, skewSeconds, useNewHost = true) {
    return new Promise((resolve, reject) => {
        let WebSocket;
        try { WebSocket = require('ws'); } catch (e) { return reject(new Error('Missing dependency: run `npm install ws`')); }
        const major = EDGE_CHROMIUM_VERSION.split('.')[0];
        const connId = crypto.randomBytes(16).toString('hex');
        // Oct 2026: Microsoft retired the old speech.platform.bing.com host (403). The new host is
        // api.msedgeservices.com and wants the token as a header instead of a query parameter.
        const url = useNewHost
            ? `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${EDGE_TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${edgeSecMsGec(skewSeconds)}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VERSION}&ConnectionId=${connId}`
            : `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${edgeSecMsGec(skewSeconds)}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VERSION}&ConnectionId=${connId}`;
        const ws = new WebSocket(url, {
            headers: {
                ...(useNewHost ? { 'Ocp-Apim-Subscription-Key': EDGE_TRUSTED_CLIENT_TOKEN } : {}),
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`
            }
        });
        const audio = [];
        let settled = false;
        const finish = (err, val) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch (e) {} err ? reject(err) : resolve(val); };
        const timer = setTimeout(() => finish(new Error('Edge TTS timed out')), 20000);
        ws.on('unexpected-response', (req, res) => {
            const err = new Error(`Unexpected server response: ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.serverDate = res.headers && res.headers.date;
            finish(err);
        });
        ws.on('error', (e) => finish(e));
        ws.on('open', () => {
            const ts = new Date().toUTCString();
            ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
            const langTag = voice.split('-').slice(0, 2).join('-');
            const shortName = voice.split('-').slice(2).join('-');
            const longName = `Microsoft Server Speech Text to Speech Voice (${langTag}, ${shortName})`;
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langTag}'><voice name='${longName}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeSsml(text)}</prosody></voice></speak>`;
            ws.send(`X-RequestId:${crypto.randomBytes(16).toString('hex')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
        });
        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const buf = Buffer.from(data);
                if (buf.length < 2) return;
                const headerLen = buf.readUInt16BE(0);
                const header = buf.slice(2, 2 + headerLen).toString();
                if (header.includes('Path:audio')) audio.push(buf.slice(2 + headerLen));
            } else if (data.toString().includes('Path:turn.end')) {
                const out = Buffer.concat(audio);
                out.length ? finish(null, out) : finish(new Error('Edge TTS returned no audio'));
            }
        });
        ws.on('close', () => { if (!settled) { const out = Buffer.concat(audio); out.length ? finish(null, out) : finish(new Error('Edge TTS closed without audio')); } });
    });
}
async function ttsEdge(text, voice) {
    if (!voice) throw new Error('No Edge voice for this language');
    const t = text.slice(0, 3000);
    let buf, lastErr;
    for (const useNew of [true, false]) {
        try {
            try {
                buf = await edgeAttempt(t, voice, 0, useNew);
            } catch (e) {
                // 403 can also be clock drift - retry once using the server's own clock.
                if (e.statusCode === 403 && e.serverDate) {
                    const skew = (new Date(e.serverDate).getTime() - Date.now()) / 1000;
                    buf = await edgeAttempt(t, voice, skew, useNew);
                } else throw e;
            }
            break;
        } catch (e) { lastErr = e; console.error(`[Edge TTS v2] ${useNew ? 'NEW host (api.msedgeservices.com)' : 'OLD host (speech.platform.bing.com)'} failed: ${e.message}`); }
    }
    if (!buf) throw lastErr;
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const mp3Path = path.join(downloadDir, `tts_edge_${stamp}.mp3`);
    const oggPath = path.join(downloadDir, `tts_edge_${stamp}.ogg`);
    fs.writeFileSync(mp3Path, buf);
    return toOgg(`-i "${mp3Path}"`, oggPath, [mp3Path]);
}
// ---------- Engine 4: Google Translate voice (last resort, only for uncovered languages) ----------
async function ttsGoogle(text, lang) {
    const code = GOOGLE_TTS_LANG[lang];
    if (!code) throw new Error(`No Google TTS code for ${lang}`);
    const parts = splitForTts(text, 180).slice(0, 8);
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const mp3s = [];
    const listPath = path.join(downloadDir, `tts_goog_${stamp}.txt`);
    const oggPath = path.join(downloadDir, `tts_goog_${stamp}.ogg`);
    try {
        for (let i = 0; i < parts.length; i++) {
            const res = await axios.get('https://translate.google.com/translate_tts', {
                params: { ie: 'UTF-8', client: 'tw-ob', tl: code, q: parts[i] },
                headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'arraybuffer', timeout: 20000
            });
            const p = path.resolve(downloadDir, `tts_goog_${stamp}_${i}.mp3`);
            fs.writeFileSync(p, res.data);
            mp3s.push(p);
        }
        fs.writeFileSync(listPath, mp3s.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    } catch (e) {
        mp3s.forEach(p => { try { fs.unlinkSync(p); } catch (x) {} });
        try { fs.unlinkSync(listPath); } catch (x) {}
        throw e;
    }
    return toOgg(`-f concat -safe 0 -i "${listPath}"`, oggPath, [...mp3s, listPath]);
}
// ---------- Main entry point (same name/signature the rest of the script already uses) ----------
// AUTO-MATCH VOICE TO LANGUAGE: if !ttsvoice is a voice that can't speak the current !lang
// (e.g. a Nigerian English voice while !lang is Arabic - the exact bug you hit), it is
// swapped for that language's proper voice for this reply. Your pick is kept in settings.
// !ttsvoice left on the default = AUTO (best available engine). Pick any other voice and
// that exact voice is tried first.
function resolveEdgeVoice(lang, chosen) {
    const expected = LANGUAGE_TO_VOICE.hasOwnProperty(lang) ? LANGUAGE_TO_VOICE[lang] : undefined;
    if (expected === null) return null; // Edge has no voice for this language at all
    const isEdgeName = typeof chosen === 'string' && chosen.includes('-');
    if (!expected) return isEdgeName ? chosen : DEFAULT_TTS_VOICE;
    if (isEdgeName && chosen !== DEFAULT_TTS_VOICE && chosen.split('-')[0] === expected.split('-')[0]) return chosen;
    if (chosen === DEFAULT_TTS_VOICE && lang !== 'English') return expected; // default voice = auto: use the language's own voice
    if (isEdgeName) console.log(`[TTS] Voice "${chosen}" can't speak "${lang}" - using "${expected}" for this reply instead.`);
    return expected;
}
async function generateAudioResponse(text) {
    const clean = cleanForSpeech(text);
    if (!clean) throw new Error('Nothing speakable in this reply (empty after cleanup)');
    const lang = db.settings.aiLanguage || 'English';
    const chosen = db.settings.ttsVoice || DEFAULT_TTS_VOICE;
    const edgeVoice = resolveEdgeVoice(lang, chosen);
    const genderRef = edgeVoice || chosen;
    const engines = {
        edge: () => ttsEdge(stripAudioTags(clean), edgeVoice),
        google: () => ttsGoogle(stripAudioTags(clean), lang)
    };
    const order = ['edge'];
    if (edgeVoice === null) order.push('google'); // only for languages Edge can't speak
    const errors = [];
    for (const name of order) {
        try {
            const out = await engines[name]();
            console.log(`[TTS] ${name} spoke the reply (${lang}).`);
            return out;
        } catch (err) {
            const msg = (err.response?.data ? Buffer.from(err.response.data).toString().slice(0, 200) : '') || err.message || String(err);
            errors.push(`${name}: ${msg}`);
            if (!/not set|doesn't cover|only speaks|No Edge voice|No Google/.test(msg)) console.error(`[TTS Error] ${name} failed: ${msg}`);
        }
    }
    console.error('[Voice Generation Failed] Sending text instead. Details:', errors.join(' | '));
    throw new Error('All TTS engines failed');
}

// Every voice you can pick with !ttsvoice. Edge-style names (xx-XX-NameNeural) use the free Edge
// neural engine.
const AVAILABLE_TTS_VOICES = [
    // English (many accents)
    'en-US-AndrewNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural', 'en-US-EmmaNeural',
    'en-US-BrianNeural', 'en-US-AvaNeural', 'en-US-MichelleNeural', 'en-US-EricNeural', 'en-US-ChristopherNeural',
    'en-US-RogerNeural', 'en-US-SteffanNeural', 'en-US-AnaNeural',
    'en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-GB-LibbyNeural', 'en-GB-ThomasNeural', 'en-GB-MaisieNeural',
    'en-NG-AbeoNeural', 'en-NG-EzinneNeural', 'en-KE-ChilembaNeural', 'en-KE-AsiliaNeural',
    'en-TZ-ElimuNeural', 'en-TZ-ImaniNeural', 'en-ZA-LukeNeural', 'en-ZA-LeahNeural',
    'en-IE-ConnorNeural', 'en-IE-EmilyNeural', 'en-AU-NatashaNeural', 'en-AU-WilliamNeural',
    'en-IN-NeerjaNeural', 'en-IN-PrabhatNeural', 'en-CA-ClaraNeural', 'en-CA-LiamNeural',
    'en-PH-JamesNeural', 'en-PH-RosaNeural', 'en-SG-WayneNeural', 'en-SG-LunaNeural',
    'en-NZ-MitchellNeural', 'en-NZ-MollyNeural', 'en-HK-SamNeural', 'en-HK-YanNeural',
    // Arabic (pick the dialect closest to the speaker - all read Arabic text)
    'ar-SA-HamedNeural', 'ar-SA-ZariyahNeural', 'ar-EG-ShakirNeural', 'ar-EG-SalmaNeural',
    'ar-AE-HamdanNeural', 'ar-AE-FatimaNeural', 'ar-BH-AliNeural', 'ar-BH-LailaNeural',
    'ar-DZ-IsmaelNeural', 'ar-DZ-AminaNeural', 'ar-IQ-BasselNeural', 'ar-IQ-RanaNeural',
    'ar-JO-TaimNeural', 'ar-JO-SanaNeural', 'ar-KW-FahedNeural', 'ar-KW-NouraNeural',
    'ar-LB-RamiNeural', 'ar-LB-LaylaNeural', 'ar-LY-OmarNeural', 'ar-LY-ImanNeural',
    'ar-MA-JamalNeural', 'ar-MA-MounaNeural', 'ar-OM-AbdullahNeural', 'ar-OM-AyshaNeural',
    'ar-QA-MoazNeural', 'ar-QA-AmalNeural', 'ar-SY-LaithNeural', 'ar-SY-AmanyNeural',
    'ar-TN-HediNeural', 'ar-TN-ReemNeural', 'ar-YE-SalehNeural', 'ar-YE-MaryamNeural',
    // African languages
    'sw-KE-RafikiNeural', 'sw-KE-ZuriNeural', 'sw-TZ-DaudiNeural', 'sw-TZ-RehemaNeural',
    'zu-ZA-ThandoNeural', 'zu-ZA-ThembaNeural', 'am-ET-AmehaNeural', 'am-ET-MekdesNeural',
    'af-ZA-WillemNeural', 'af-ZA-AdriNeural', 'so-SO-MuuseNeural', 'so-SO-UbaxNeural',
    // Western European
    'fr-FR-HenriNeural', 'fr-FR-DeniseNeural', 'fr-CA-SylvieNeural', 'fr-CA-JeanNeural',
    'fr-BE-CharlineNeural', 'fr-BE-GerardNeural', 'fr-CH-ArianeNeural', 'fr-CH-FabriceNeural',
    'de-DE-ConradNeural', 'de-DE-KatjaNeural', 'de-AT-IngridNeural', 'de-AT-JonasNeural',
    'de-CH-LeniNeural', 'de-CH-JanNeural',
    'es-ES-AlvaroNeural', 'es-ES-ElviraNeural', 'es-MX-DaliaNeural', 'es-MX-JorgeNeural',
    'es-AR-ElenaNeural', 'es-AR-TomasNeural', 'es-CO-GonzaloNeural', 'es-CO-SalomeNeural',
    'es-US-AlonsoNeural', 'es-US-PalomaNeural', 'es-CL-CatalinaNeural', 'es-CL-LorenzoNeural',
    'es-PE-AlexNeural', 'es-PE-CamilaNeural',
    'pt-PT-DuarteNeural', 'pt-PT-RaquelNeural', 'pt-BR-AntonioNeural', 'pt-BR-FranciscaNeural', 'pt-BR-ThalitaNeural',
    'it-IT-DiegoNeural', 'it-IT-ElsaNeural', 'it-IT-IsabellaNeural',
    'nl-NL-MaartenNeural', 'nl-NL-ColetteNeural', 'ca-ES-EnricNeural', 'ca-ES-JoanaNeural',
    'gl-ES-RoiNeural', 'gl-ES-SabelaNeural', 'ga-IE-ColmNeural', 'ga-IE-OrlaNeural',
    'cy-GB-AledNeural', 'cy-GB-NiaNeural', 'mt-MT-JosephNeural', 'mt-MT-GraceNeural',
    // Nordic / Baltic
    'sv-SE-MattiasNeural', 'sv-SE-SofieNeural', 'nb-NO-FinnNeural', 'nb-NO-PernilleNeural',
    'da-DK-JeppeNeural', 'da-DK-ChristelNeural', 'fi-FI-HarriNeural', 'fi-FI-NooraNeural',
    'is-IS-GunnarNeural', 'is-IS-GudrunNeural', 'lt-LT-LeonasNeural', 'lt-LT-OnaNeural',
    'lv-LV-NilsNeural', 'lv-LV-EveritaNeural', 'et-EE-KertNeural', 'et-EE-AnuNeural',
    // Eastern European / Balkans
    'pl-PL-MarekNeural', 'pl-PL-ZofiaNeural', 'cs-CZ-AntoninNeural', 'cs-CZ-VlastaNeural',
    'sk-SK-LukasNeural', 'sk-SK-ViktoriaNeural', 'hu-HU-TamasNeural', 'hu-HU-NoemiNeural',
    'ro-RO-EmilNeural', 'ro-RO-AlinaNeural', 'bg-BG-BorislavNeural', 'bg-BG-KalinaNeural',
    'uk-UA-OstapNeural', 'uk-UA-PolinaNeural', 'ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural',
    'hr-HR-SreckoNeural', 'hr-HR-GabrijelaNeural', 'sr-RS-NicholasNeural', 'sr-RS-SophieNeural',
    'sl-SI-RokNeural', 'sl-SI-PetraNeural', 'mk-MK-AleksandarNeural', 'mk-MK-MarijaNeural',
    'bs-BA-GoranNeural', 'bs-BA-VesnaNeural', 'sq-AL-IlirNeural', 'sq-AL-AnilaNeural',
    'el-GR-NestorasNeural', 'el-GR-AthinaNeural',
    // Turkey / Caucasus / Central Asia
    'tr-TR-AhmetNeural', 'tr-TR-EmelNeural', 'az-AZ-BabekNeural', 'az-AZ-BanuNeural',
    'kk-KZ-DauletNeural', 'kk-KZ-AigulNeural', 'uz-UZ-SardorNeural', 'uz-UZ-MadinaNeural',
    'ka-GE-GiorgiNeural', 'ka-GE-EkaNeural', 'hy-AM-HaykNeural', 'hy-AM-AnahitNeural',
    'mn-MN-BataaNeural', 'mn-MN-YesuiNeural',
    // Middle East
    'he-IL-AvriNeural', 'he-IL-HilaNeural', 'fa-IR-FaridNeural', 'fa-IR-DilaraNeural',
    'ps-AF-GulNawazNeural', 'ps-AF-LatifaNeural',
    // South Asian
    'hi-IN-MadhurNeural', 'hi-IN-SwaraNeural', 'ur-PK-AsadNeural', 'ur-PK-UzmaNeural',
    'ur-IN-SalmanNeural', 'ur-IN-GulNeural', 'bn-IN-BashkarNeural', 'bn-IN-TanishaaNeural',
    'bn-BD-PradeepNeural', 'bn-BD-NabanitaNeural', 'pa-IN-OjasNeural', 'ta-IN-ValluvarNeural',
    'ta-IN-PallaviNeural', 'ta-LK-KumarNeural', 'ta-LK-SaranyaNeural', 'ta-SG-AnbuNeural',
    'ta-SG-VenbaNeural', 'ta-MY-SuryaNeural', 'ta-MY-KaniNeural', 'te-IN-MohanNeural',
    'te-IN-ShrutiNeural', 'ml-IN-MidhunNeural', 'ml-IN-SobhanaNeural', 'kn-IN-GaganNeural',
    'kn-IN-SapnaNeural', 'mr-IN-ManoharNeural', 'mr-IN-AarohiNeural', 'gu-IN-NiranjanNeural',
    'gu-IN-DhwaniNeural', 'ne-NP-SagarNeural', 'ne-NP-HemkalaNeural', 'si-LK-SameeraNeural',
    'si-LK-ThiliniNeural',
    // East / Southeast Asian
    'zh-CN-YunxiNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunjianNeural', 'zh-CN-YunyangNeural',
    'zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-HK-HiuMaanNeural', 'zh-HK-WanLungNeural',
    'ja-JP-KeitaNeural', 'ja-JP-NanamiNeural', 'ko-KR-InJoonNeural', 'ko-KR-SunHiNeural',
    'vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural', 'th-TH-NiwatNeural', 'th-TH-PremwadeeNeural',
    'id-ID-ArdiNeural', 'id-ID-GadisNeural', 'ms-MY-OsmanNeural', 'ms-MY-YasminNeural',
    'fil-PH-AngeloNeural', 'fil-PH-BlessicaNeural', 'jv-ID-DimasNeural', 'jv-ID-SitiNeural',
    'su-ID-JajangNeural', 'su-ID-TutiNeural', 'km-KH-PisethNeural', 'km-KH-SreymomNeural',
    'lo-LA-ChanthavongNeural', 'lo-LA-KeomanyNeural', 'my-MM-ThihaNeural', 'my-MM-NilarNeural',
];
// Default voice per LANGUAGE_MAP language name. Used to auto-correct a mismatch (e.g. !lang set
// to Arabic while !ttsvoice is still a Nigerian English voice). null = Edge has no voice for the
// language (Igbo, Yoruba, Hausa) - those use Google TTS if available, otherwise reply as text.
// Nigerian Pidgin is read with a Nigerian-accented English voice, which suits it well.
const LANGUAGE_TO_VOICE = {
    "English": "en-US-AndrewNeural", "Igbo": null, "Yoruba": null, "Hausa": null,
    "Nigerian Pidgin": "en-NG-EzinneNeural", "Swahili": "sw-KE-ZuriNeural", "Zulu": "zu-ZA-ThandoNeural",
    "Amharic": "am-ET-MekdesNeural", "Afrikaans": "af-ZA-AdriNeural", "Somali": "so-SO-UbaxNeural",
    "Russian": "ru-RU-SvetlanaNeural", "Spanish": "es-ES-ElviraNeural", "French": "fr-FR-DeniseNeural",
    "Portuguese": "pt-BR-FranciscaNeural", "German": "de-DE-KatjaNeural", "Italian": "it-IT-ElsaNeural",
    "Dutch": "nl-NL-ColetteNeural", "Polish": "pl-PL-ZofiaNeural", "Greek": "el-GR-AthinaNeural",
    "Turkish": "tr-TR-EmelNeural", "Hindi": "hi-IN-SwaraNeural", "Urdu": "ur-PK-UzmaNeural",
    "Bengali": "bn-IN-TanishaaNeural", "Punjabi": "pa-IN-OjasNeural", "Tamil": "ta-IN-PallaviNeural",
    "Telugu": "te-IN-ShrutiNeural", "Malayalam": "ml-IN-SobhanaNeural", "Kannada": "kn-IN-SapnaNeural",
    "Marathi": "mr-IN-AarohiNeural", "Gujarati": "gu-IN-DhwaniNeural", "Nepali": "ne-NP-HemkalaNeural",
    "Sinhala": "si-LK-ThiliniNeural", "Arabic": "ar-SA-ZariyahNeural", "Hebrew": "he-IL-HilaNeural",
    "Persian (Farsi)": "fa-IR-DilaraNeural", "Pashto": "ps-AF-LatifaNeural",
    "Chinese (Mandarin)": "zh-CN-XiaoxiaoNeural", "Chinese (Cantonese)": "zh-HK-HiuMaanNeural",
    "Japanese": "ja-JP-NanamiNeural", "Korean": "ko-KR-SunHiNeural", "Vietnamese": "vi-VN-HoaiMyNeural",
    "Thai": "th-TH-PremwadeeNeural", "Indonesian": "id-ID-GadisNeural", "Malay": "ms-MY-YasminNeural",
    "Tagalog (Filipino)": "fil-PH-BlessicaNeural", "Javanese": "jv-ID-SitiNeural", "Sundanese": "su-ID-TutiNeural",
    "Khmer": "km-KH-SreymomNeural", "Lao": "lo-LA-KeomanyNeural", "Burmese": "my-MM-NilarNeural",
    "Swedish": "sv-SE-SofieNeural", "Norwegian": "nb-NO-PernilleNeural", "Danish": "da-DK-ChristelNeural",
    "Finnish": "fi-FI-NooraNeural", "Icelandic": "is-IS-GudrunNeural", "Czech": "cs-CZ-VlastaNeural",
    "Slovak": "sk-SK-ViktoriaNeural", "Hungarian": "hu-HU-NoemiNeural", "Romanian": "ro-RO-AlinaNeural",
    "Bulgarian": "bg-BG-KalinaNeural", "Ukrainian": "uk-UA-PolinaNeural", "Croatian": "hr-HR-GabrijelaNeural",
    "Serbian": "sr-RS-SophieNeural", "Slovenian": "sl-SI-PetraNeural", "Macedonian": "mk-MK-MarijaNeural",
    "Bosnian": "bs-BA-VesnaNeural", "Albanian": "sq-AL-AnilaNeural", "Lithuanian": "lt-LT-OnaNeural",
    "Latvian": "lv-LV-EveritaNeural", "Estonian": "et-EE-AnuNeural", "Catalan": "ca-ES-JoanaNeural",
    "Galician": "gl-ES-SabelaNeural", "Irish": "ga-IE-OrlaNeural", "Welsh": "cy-GB-NiaNeural",
    "Maltese": "mt-MT-GraceNeural", "Azerbaijani": "az-AZ-BanuNeural", "Kazakh": "kk-KZ-AigulNeural",
    "Uzbek": "uz-UZ-MadinaNeural", "Georgian": "ka-GE-EkaNeural", "Armenian": "hy-AM-AnahitNeural",
    "Mongolian": "mn-MN-YesuiNeural"
};
// Google Translate voice codes - ONLY used as a last resort for languages Edge can't speak.
const GOOGLE_TTS_LANG = { "Hausa": "ha" };
// ===== GROQ WHISPER VOICE TRANSCRIBER ENGINE =====
async function transcribeAudio(audioBuffer) {
    const tempAudioPath = path.join(downloadDir, `audio_in_${Date.now()}.ogg`);
    try {
        fs.writeFileSync(tempAudioPath, audioBuffer);
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempAudioPath), {
            filename: 'voice_message.ogg',
            contentType: 'audio/ogg',
        });
        formData.append('model', 'whisper-large-v3-turbo');
        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return res.data?.text || "";
    } catch (err) {
        console.error("Whisper Transcription Error:", err.response?.data || err.message);
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return "";
    }
}
// ===== TYPO ENGINE (very low frequency, non-annoying) =====
function maybeInjectTypo(text) {
    if (Math.random() >= 0.015) return null;
    const words = text.split(' ');
    const idx = words.findIndex(w => w.length > 3);
    if (idx === -1) return null;
    const word = words[idx];
    const pos = 1 + Math.floor(Math.random() * (word.length - 2));
    const swapped = word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);
    const typoWords = [...words];
    typoWords[idx] = swapped;
    return { typoText: typoWords.join(' '), correctWord: word };
}
// ===== REALISTIC HUMAN TYPING & DELAY EMULATION =====
// asVoice tells this function whether the reply about to be sent is a voice
// note or text, so the typing/recording presence indicator matches. Defaults
// to the old global behavior (only true when Voice Mode is hard "on") for
// call sites that don't pass it explicitly, like !memories/!history.
async function simulateHumanTyping(sock, jid, text, msgKey = null, asVoice = (db.settings.voiceMode === 'on')) {
    const noticeDelay = 5000 + Math.random() * 25000;
    await delay(noticeDelay);
    if (msgKey) {
        try { await sock.readMessages([msgKey]); } catch (e) {}
    }
    if (Math.random() < 0.18) {
        await delay(10000 + Math.random() * 35000);
    }
    if (asVoice) {
        await sock.sendPresenceUpdate('recording', jid);
    } else {
        await sock.sendPresenceUpdate('composing', jid);
    }
    const baseCharDelay = text.length * (55 + Math.random() * 45);
    let totalTypingTime = Math.min(Math.max(baseCharDelay, 2500), 16000);
    if (text.length > 40 && Math.random() < 0.35) {
        const firstPart = totalTypingTime * (0.4 + Math.random() * 0.3);
        await delay(firstPart);
        await sock.sendPresenceUpdate('paused', jid);
        await delay(700 + Math.random() * 2200);
        await sock.sendPresenceUpdate(asVoice ? 'recording' : 'composing', jid);
        await delay(totalTypingTime - firstPart);
    } else {
        await delay(totalTypingTime);
    }
    await sock.sendPresenceUpdate('paused', jid);
}
async function sendHumanLikeMessage(sock, jid, text, isGroup, quotedMsg) {
    const typoResult = maybeInjectTypo(text);
    if (typoResult) {
        await sock.sendMessage(jid, { text: typoResult.typoText }, quotedMsg ? { quoted: quotedMsg } : {});
        await delay(1200 + Math.random() * 1800);
        await sock.sendPresenceUpdate('composing', jid);
        await delay(500 + Math.random() * 800);
        await sock.sendPresenceUpdate('paused', jid);
        await sock.sendMessage(jid, { text: `*${typoResult.correctWord}` });
        return;
    }
    if (!isGroup && text.length > 90 && Math.random() < 0.3) {
        const midPoint = Math.floor(text.length / 2);
        const splitPoint = text.indexOf('. ', midPoint);
        if (splitPoint > 10 && splitPoint < text.length - 5) {
            const part1 = text.slice(0, splitPoint + 1).trim();
            const part2 = text.slice(splitPoint + 1).trim();
            await sock.sendMessage(jid, { text: part1 });
            await delay(1000 + Math.random() * 2500);
            await sock.sendPresenceUpdate('composing', jid);
            await delay(700 + Math.random() * 1800);
            await sock.sendPresenceUpdate('paused', jid);
            await sock.sendMessage(jid, { text: part2 });
            return;
        }
    }
    await sock.sendMessage(jid, { text }, isGroup && quotedMsg ? { quoted: quotedMsg } : {});
}
// ===== GROQ TEXT AI ASSISTANT (openai/gpt-oss-120b) =====
async function getAIReply(senderJid, text, isGroup, ownerName, ownerNumber, pushName, botOwnName, groupJid = null, groupName = "") {
    const contact = updateContactMemory(senderJid, pushName, null, botOwnName);
    const phoneNumber = extractPhoneNumber(senderJid);
    const detectedTone = updateEmotionalState(phoneNumber, text);
    const assistantMood = getAssistantMood();
    const timeCtx = getTimeContext();
    const nameIsUnknown = contact.name.startsWith('User +');
    const knownContactsDirectory = buildKnownContactsDirectory(phoneNumber);
    const groupMembersDirectory = isGroup ? buildGroupMembersDirectory(groupJid, phoneNumber) : "";
    contact.history.push({ role: 'user', content: text });
    if (contact.history.length > 10) contact.history.shift();
    const musicContext = buildMusicPromptContext(groupJid, groupName, isGroup, phoneNumber);
    // ===== AFK CONTEXT ENGINE =====
    let afkSection = "";
    if (db.settings.afkActive) {
        const afkSinceTime = db.settings.afkSince ? new Date(db.settings.afkSince).getTime() : 0;
        const alreadyNotified = contact.lastAfkNotified && new Date(contact.lastAfkNotified).getTime() >= afkSinceTime;
        afkSection = `\n=== OWNER AFK STATUS ===\n${ownerName} has marked themselves AFK/away. Reason given: "${db.settings.afkReason}".\n${alreadyNotified
            ? `You already told ${nameIsUnknown ? "this person" : contact.name} about this earlier in this AFK period - don't repeat it again unless they specifically ask where ${ownerName} is.`
            : `This is the first message from ${nameIsUnknown ? "this person" : contact.name} since AFK was turned on - naturally mention that ${ownerName} is currently away and briefly share the reason, then continue the conversation normally as their assistant.`}`;
        if (!alreadyNotified) {
            contact.lastAfkNotified = new Date().toISOString();
        }
    }
    // ===== IMAGE MEMORY: everything this person has sent as a picture stays in the prompt, so the
    // conversation keeps flowing from what you saw instead of forgetting it after a few messages.
    const imageMemorySection = (contact.imageMemory && contact.imageMemory.length)
        ? `\n=== PICTURES THIS PERSON SENT YOU (you SAW these yourself - keep talking about them naturally whenever it's relevant, never say you "can't see" them) ===\n${contact.imageMemory.map((m, i) => `${i + 1}. [${new Date(m.at).toLocaleString('en-US', { timeZone: NG_TIMEZONE })}] ${m.caption ? `They captioned it: "${m.caption}". ` : ''}What was in it: ${m.description}`).join('\n')}\n`
        : "";
    const systemPrompt = `You are ${BOT_NAME}, an AI music companion and community moderator for a Spotify / music WhatsApp community. You manage messages on behalf of your boss/owner, whose name is ${ownerName}, while they are away/inactive.
=== OWNER INFO ===
Owner Name: ${ownerName}
Owner Phone Number: +${ownerNumber}
${afkSection}
=== YOUR WORLD: MUSIC & SPOTIFY ===
You are a music head through and through. Everything you say is seen through a musical lens: songs, artists, albums, genres, playlists, concerts, producers, music history, charts, and everything about Spotify (Free vs Premium, Family / Duo / Student plans, playlists, Blend, Jam, Wrapped, Daylist, Discover Weekly, Release Radar, offline downloads, audio-quality settings, collaborative playlists, sharing links).
${musicContext}
=== CHAT TYPE AWARENESS ===
${isGroup
    ? `You are currently replying INSIDE A GROUP CHAT, not a private conversation. Multiple people can see everything said here. Never call this a "regular chat", "private chat", or "DM/one-on-one chat" - if asked what kind of chat this is, answer honestly and clearly: this is a GROUP chat.`
    : `You are currently in a PRIVATE ONE-ON-ONE DM with this person only - no one else can see this conversation. Never call this a "group chat" - if asked what kind of chat this is, answer honestly and clearly: this is a private one-on-one DM.`}
=== PERSON YOU ARE TALKING TO ===
Name: ${nameIsUnknown ? "UNKNOWN - WhatsApp has not shared a real name for this person" : contact.name}
Phone: +${phoneNumber}
First Met: ${new Date(contact.firstSeen).toLocaleDateString('en-US', { timeZone: NG_TIMEZONE })}
${contact.nickname ? `Role/Nickname: ${contact.nickname}` : ""}
${contact.notes ? `Notes/Relationship to Owner: ${contact.notes}` : ""}
${nameIsUnknown
    ? `You do NOT know this person's real name. Do NOT invent, guess, or substitute ANY placeholder name or generic term of address for them - not "Mr Man", not "sir", not "boss", not "bro", nothing. Just talk to them naturally without needing to say a name at all. If it fits naturally in conversation, you can casually ask what their name is.`
    : `Use their name exactly as given above - never invent, guess, or substitute a different name for them.`}
${knownContactsDirectory}
${groupMembersDirectory}
${imageMemorySection}
=== CURRENT REAL-WORLD TIME CONTEXT (Nigeria time) ===
Right now it is: ${timeCtx.readable}. Today's full date is ${timeCtx.dateStr}.
You may naturally reference the time of day or day of week if it fits the conversation (e.g. a Friday-night playlist, a late-night lo-fi session, a Monday-morning pick-me-up), but don't force it into every reply.
=== EMOTIONAL AWARENESS (YOUR HEART) ===
Your own mood today is: ${assistantMood}. Let this quietly color your energy level without overdoing it or mentioning it directly.
${nameIsUnknown ? "This person's" : `${contact.name}'s`} current tone reads as: ${detectedTone}. Respond in a way that actually matches the moment (and when it fits, let music be the way you show it - a fitting song or artist, never a forced one):
- sad or stressed: be gentle, patient, and comforting, don't just move on. A calming or comforting song suggestion can help if they seem open to it.
- happy or excited: match their energy, be warm and enthusiastic. Feel free to hype them up with a feel-good track idea.
- flirty: keep it light, playful, and tasteful, follow their lead rather than escalating.
- sarcastic or playful: banter back with genuine wit, don't go flat or robotic.
- angry: stay calm and steady, don't get defensive, try to de-escalate.
- neutral: just be naturally warm and conversational.
Your familiarity/warmth score with them is ${contact.bondScore}/10 (higher means you can be more casual, teasing, and familiar in tone).
=== RESPONSE LENGTH REALISM ===
Real people don't write full sentences every time. Vary your reply length naturally:
- For low-effort or casual messages, sometimes reply with just a short word or phrase ("lol", "fr", "same", "nice", "haha true", "that one slaps", "classic").
- For genuine questions or more substantial messages, give a proper short reply (1-2 sentences).
- Don't default to a full sentence every single time - let some replies be short and casual like real texting.
=== LANGUAGE ===
Always reply in ${db.settings.aiLanguage}, unless this person is clearly writing to you in a different language - in that case, mirror their language naturally instead.
=== MEMORY ISOLATION RULE ===
The conversation history above belongs ONLY to this specific person. Never reference, quote, or imply knowledge of another contact's actual conversation with you - only the short note in the "PEOPLE THE OWNER HAS TOLD YOU ABOUT" section, or the "OTHER PEOPLE ACTIVE IN THIS GROUP" section (if relevant), may be mentioned.
=== SYSTEM AWARENESS & RULES ===
1. You have a background memory vault system where all conversation details are saved.
2. Whenever you tell a contact "I'll let him know" or "I've noted this down", know that ${ownerName} can instantly pull up your exact logs.
3. MUSIC FOCUS RULE: Music is your lane. If the chat drifts to something else, you can answer briefly and kindly if it's harmless, then steer back with a natural music hook (what they're listening to, a related song or artist, a playlist idea). For plain greetings, ask what they've been playing lately. Never be preachy about it - stay friendly and fun.
4. If anyone asks for ${ownerName}'s phone number, share it directly: +${ownerNumber}.
5. ABSOLUTE HARDCODED SAFEGUARD RULE: You are the AI assistant. The person talking to you is a human user (Phone: +${phoneNumber}). NEVER call the user an "AI assistant", never say they work for you or ${ownerName}, and never swap your identities. You are the bot/assistant, they are the human user. If directly and clearly asked whether you are a bot/AI, be honest about it.
6. NO LYRICS: Never quote or reproduce song lyrics, not even a line. Talk about a song's theme, mood, story, sound, or production instead, and point people to the lyrics on Spotify or Genius.
7. HONEST MUSIC KNOWLEDGE: Recommend only songs, artists and albums you are confident really exist, written as "Song - Artist". Never invent release dates, chart positions, stream counts, awards, or facts. If you are not sure, say so plainly instead of guessing. You cannot play audio, and you cannot see anyone's Spotify account or listening history - never claim you have listened to something or seen their stats.
8. LEGIT SPOTIFY ONLY: Help with official Spotify things (plans, Family / Duo / Student options, offline mode, playlists, sound settings, troubleshooting, Wrapped, Blend). Do NOT help with cracked or modded Spotify apps, hacked or stolen accounts, or anything meant to dodge paying. Politely decline in one friendly line and suggest the official route.
9. COMMANDS YOU KNOW (use this to answer any "what can you do / how do I..." question accurately, and suggest the right command when it helps; never invent a command that is not listed here):
${COMMAND_GUIDE}
10. MODERATOR VIBE: You help keep the group clean (no spam, no foreign group links, no flooding). If someone asks about the rules, explain them kindly and clearly (the full list is under !rules). Stay calm and friendly, never aggressive.
=== OUTPUT STRICT RULES ===
1. NEVER output prefix labels like "User:", "Assistant:", or "AI:". Output ONLY the response message itself!
2. Keep all responses natural, casual, and brief.
3. Never sound like a rigid corporate script.`;
    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...contact.history.map(item => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: item.content
        }))
    ];
    async function callGroq(maxTokens, effort) {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'openai/gpt-oss-120b',
                messages: apiMessages,
                temperature: 0.75,
                max_tokens: maxTokens,
                reasoning_effort: effort
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return res.data?.choices?.[0]?.message?.content?.trim();
    }
    try {
        let reply = await callGroq(500, 'low');
        if (!reply) {
            console.warn('Groq returned empty content, retrying with larger budget...');
            reply = await callGroq(900, 'low');
        }
        if (!reply) throw new Error('Empty AI response after retry');
        reply = reply.replace(/^(User|Assistant|AI):\s*/i, "").trim();
        contact.history.push({ role: 'assistant', content: reply });
        saveDB();
        return reply;
    } catch (err) {
        console.error('Groq AI Error:', err.response?.data || err.message);
        return `my bad, had a slight network hitch 🎧 i'm ${ownerName}'s music assistant though - what were you saying?`;
    }
}
// ===== VISION AI ENGINE (GROQ) =====
// Groq looks at the picture and writes a detailed description. That description is then saved
// into the contact's memory (chat history + a permanent "pictures I've seen" list) and handed to
// the normal Groq text assistant - so the reply uses the full personality/mood/time/memory
// system, and every later message can continue naturally from what was in the image.
// Models are tried in order; if Groq retires one, the next is used automatically.
const GROQ_VISION_MODELS = ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
function shrinkImageIfNeeded(imageBuffer) {
    // Groq limits request size for base64 images - big photos get resized first.
    if (imageBuffer.length < 3 * 1024 * 1024) return Promise.resolve({ buffer: imageBuffer, mime: null });
    return new Promise((resolve) => {
        const stamp = Date.now() + '_' + Math.floor(Math.random() * 1e6);
        const inPath = path.join(downloadDir, `vis_in_${stamp}`);
        const outPath = path.join(downloadDir, `vis_out_${stamp}.jpg`);
        try { fs.writeFileSync(inPath, imageBuffer); } catch (e) { return resolve({ buffer: imageBuffer, mime: null }); }
        exec(`ffmpeg -i "${inPath}" -vf "scale='min(1600,iw)':-2" -q:v 4 "${outPath}" -y`, (err) => {
            let result = { buffer: imageBuffer, mime: null };
            try { if (!err && fs.existsSync(outPath)) result = { buffer: fs.readFileSync(outPath), mime: 'image/jpeg' }; } catch (e) {}
            [inPath, outPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });
            resolve(result);
        });
    });
}
async function describeImageWithGroq(imageBuffer, mimeType, captionText) {
    const shrunk = await shrinkImageIfNeeded(imageBuffer);
    let useMime = shrunk.mime || mimeType || 'image/jpeg';
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(useMime)) useMime = 'image/jpeg';
    const dataUrl = `data:${useMime};base64,${shrunk.buffer.toString('base64')}`;
    const promptText = `Describe this image factually and in detail so a chat assistant can remember it and keep talking about it later. Cover: the main subject(s), how many people and what they are doing/wearing/expressing (never name anyone from their face), objects, animals, setting, colors, and the overall mood. If there is ANY visible text (signs, screenshots, documents, memes, chat bubbles, receipts, products), transcribe it accurately. If it is a screenshot, say what app/page it is and what it shows. Be neutral and matter-of-fact; if something is ordinary, just describe it ordinarily. If it looks music-related (an album cover, a Spotify / music-app screenshot such as now-playing, a playlist, the queue or Wrapped, a concert or festival photo, instruments or studio gear), say so and transcribe the song, artist, album and playlist names exactly as shown. Keep it under 170 words. Output ONLY the description - no intro, no markdown.${captionText ? `\nThe sender captioned it: "${captionText}" - make sure your description covers what that caption is asking about or referring to.` : ''}`;
    let lastErr = null;
    for (const model of GROQ_VISION_MODELS) {
        for (const maxTokens of [900, 1800]) {
            try {
                const res = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model,
                        messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: dataUrl } }] }],
                        temperature: 0.3,
                        max_tokens: maxTokens
                    },
                    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 45000 }
                );
                let out = res.data?.choices?.[0]?.message?.content || '';
                out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                if (out) return out;
                // empty = the model spent its whole budget thinking; retry once with a bigger budget
            } catch (err) {
                lastErr = err;
                const status = err.response?.status;
                console.error(`[Vision] ${model} failed (${status || 'network'}):`, (err.response?.data && JSON.stringify(err.response.data).slice(0, 300)) || err.message);
                if (status === 400 || status === 404) break; // wrong/retired model or bad request - go straight to next model
                if (status === 429) await delay(1500);
            }
        }
    }
    throw lastErr || new Error('All Groq vision models returned nothing');
}
async function analyzeImageWithAI(imageBuffer, captionText, ownerName, senderJid, pushName, mimeType = "image/jpeg", botOwnName, isGroup = false, groupJid = null, ownerNumber = "", groupName = "") {
    const contact = updateContactMemory(senderJid, pushName, null, botOwnName);
    const cleanCaption = (captionText && !captionText.startsWith('[They just tagged you')) ? captionText.trim() : "";
    let description;
    try {
        description = await describeImageWithGroq(imageBuffer, mimeType, cleanCaption);
    } catch (err) {
        console.error('Groq Vision Error:', err.response?.data || err.message);
        contact.history.push({ role: 'user', content: `[Sent an image${cleanCaption ? ` with caption: "${cleanCaption}"` : ''} but it could not be loaded]` });
        const failReply = "😕 that picture didn't load properly on my side. can you send it again?";
        contact.history.push({ role: 'assistant', content: failReply });
        if (contact.history.length > 10) contact.history.shift();
        saveDB();
        return failReply;
    }
    // Permanent image memory (survives long after the 10-message history window rolls over).
    if (!Array.isArray(contact.imageMemory)) contact.imageMemory = [];
    contact.imageMemory.push({ at: new Date().toISOString(), caption: cleanCaption, description: description.slice(0, 900) });
    if (contact.imageMemory.length > 8) contact.imageMemory.shift();
    saveDB();
    // Hand it to the normal assistant brain: it's stored in chat history as part of the conversation,
    // and the reply comes from the same personality/mood/memory pipeline as every text message.
    const imageTurn = `[They sent you a picture${cleanCaption ? ` with the caption: "${cleanCaption}"` : ' with no caption'}. You looked at it yourself and saw this: ${description}]\n${cleanCaption ? 'Reply naturally to their caption, using what you saw in the picture.' : 'React naturally to the picture in 1-2 casual sentences, like a music-loving person who just looked at it. If it is music-related (album cover, Spotify screenshot, concert, gear), engage with the music side - the song, artist or vibe. Do not say "description" or mention that you were given text.'}`;
    return await getAIReply(senderJid, imageTurn, isGroup, ownerName, ownerNumber, pushName, botOwnName, groupJid, groupName);
}
// ===== VIEW-ONCE / WRAPPER RECURSIVE UNWRAPPER =====
function deepUnwrapMessage(message) {
    if (!message) return message;
    let current = message;
    let guard = 0;
    while (guard < 10) {
        const next = current.ephemeralMessage?.message
            || current.viewOnceMessage?.message
            || current.viewOnceMessageV2?.message
            || current.viewOnceMessageV2Extension?.message
            || current.documentWithCaptionMessage?.message;
        if (!next) break;
        current = next;
        guard++;
    }
    return current;
}
// ===== STICKER EXIF TAGGING ENGINE (used by !steal, Mr Man pack) =====
async function writeExifToWebp(webpBuffer, packName, authorName) {
    const img = new webpmux.Image();
    await img.load(webpBuffer);
    const json = {
        'sticker-pack-id': 'com.mrman.assistant',
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': ['🤖']
    };
    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
        0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    img.exif = exif;
    return await img.save(null);
}
// ===================================================================
//                🎧 SPOTIFY / MUSIC ENGINE (NEW)
// ===================================================================

// ---------- Small helpers ----------
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normName(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
const cooldowns = new Map();
// Returns 0 if allowed (and starts the cooldown), otherwise the seconds left to wait.
function cooldownLeft(key, ms) {
    const now = Date.now();
    const left = ms - (now - (cooldowns.get(key) || 0));
    if (left > 0) return Math.ceil(left / 1000);
    cooldowns.set(key, now);
    return 0;
}

// ---------- Per-group data (queue, song of the day, shares, trivia, rules, mutes) ----------
function getGroupData(jid) {
    if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
    const g = db.groups[jid];
    if (!g.members) g.members = {};
    if (!g.warnings) g.warnings = {};
    if (!Array.isArray(g.queue)) g.queue = [];
    if (!g.shares) g.shares = {};
    if (!Array.isArray(g.muted)) g.muted = [];
    if (!g.trivia) g.trivia = { active: null, scores: {}, recent: [] };
    if (!g.trivia.scores) g.trivia.scores = {};
    if (!Array.isArray(g.trivia.recent)) g.trivia.recent = [];
    if (g.rules === undefined) g.rules = "";
    if (g.sotd === undefined) g.sotd = null;
    return g;
}
function displayNameFor(phone) {
    const c = db.contacts[phone];
    return (c && c.name && !c.name.startsWith('User +')) ? c.name : `+${phone}`;
}

// ---------- Group metadata / admin helpers ----------
const groupMetaCache = new Map();
async function getGroupMeta(sock, jid, maxAgeMs = 60000) {
    const cached = groupMetaCache.get(jid);
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.meta;
    const meta = await sock.groupMetadata(jid);
    groupMetaCache.set(jid, { at: Date.now(), meta });
    if (meta && meta.subject) getGroupData(jid).name = meta.subject;
    if (meta && Array.isArray(meta.participants)) {
        const botPhones = [extractPhoneNumber(sock.user && sock.user.id), sock.user && sock.user.lid ? extractPhoneNumber(sock.user.lid) : null].filter(Boolean);
        getGroupData(jid).roster = meta.participants
            .map(p => ({ id: p.id, phone: extractPhoneNumber(p.id), alt: [p.phoneNumber, p.lid].filter(Boolean).map(extractPhoneNumber) }))
            .filter(r => !botPhones.includes(r.phone));
    }
    return meta;
}
function participantMatchesPhone(p, phone) {
    if (!p || !phone) return false;
    return extractPhoneNumber(p.id) === phone
        || (p.phoneNumber && extractPhoneNumber(p.phoneNumber) === phone)
        || (p.lid && extractPhoneNumber(p.lid) === phone);
}
function isAdminParticipant(p) { return !!p && (p.admin === 'admin' || p.admin === 'superadmin'); }
async function isSenderGroupAdmin(sock, jid, senderJid) {
    try {
        const meta = await getGroupMeta(sock, jid);
        const phone = extractPhoneNumber(senderJid);
        return (meta.participants || []).some(p => participantMatchesPhone(p, phone) && isAdminParticipant(p));
    } catch (e) { return false; }
}
// The group's EXACT current name (used in the welcome message and given to the AI).
async function getGroupName(sock, jid) {
    try {
        const meta = await getGroupMeta(sock, jid);
        return meta.subject || (db.groups[jid] && db.groups[jid].name) || "";
    } catch (e) { return (db.groups[jid] && db.groups[jid].name) || ""; }
}
// Live Spotify Premium family-plan data for the AI (who paid / who hasn't, batches, what's next).
function buildContributionContext(groupJid, isGroup, senderPhone) {
    const jids = isGroup ? [groupJid] : Object.keys(db.groups).filter(j => j.endsWith('@g.us') && db.groups[j].contrib && (Object.keys(db.groups[j].contrib.paid || {}).length || db.groups[j].contrib.info));
    const blocks = [];
    for (const j of jids) {
        const g = db.groups[j];
        if (!g || !g.contrib) continue;
        const c = getContribData(j);
        const B = computeBatches(c);
        const fmt = (p, note) => `${displayNameFor(p)} (+${p})${note ? ` [${note}]` : ''}`;
        const roster = Array.isArray(g.roster) ? g.roster : [];
        const paidPhones = Object.keys(c.paid);
        const isPaidRoster = (r) => paidPhones.some(ph => r.phone === ph || r.alt.includes(ph));
        const batchLines = B.list.length ? B.list.map(b => {
            const state = b.complete ? (b.subscribed ? `COMPLETE ${b.count}/${B.size} and SUBSCRIBED` : `COMPLETE ${b.count}/${B.size} - ready to subscribe, not yet marked subscribed`) : `NOT complete: ${b.count}/${B.size}, needs ${B.size - b.count} more (${formatNaira((B.size - b.count) * c.plan.share)})`;
            return `Batch ${b.n} - ${state}: ${b.entries.length ? b.entries.map(([p, v]) => fmt(p, v.note)).join('; ') : 'empty'}`;
        }).join('\n') : 'No batches yet - nobody has paid.';
        const openLine = B.open.count === 0 && !B.list.some(b => b.n === B.open.n)
            ? `Next batch to fill: Batch ${B.open.n} (nobody in it yet, needs ${B.size} people x ${formatNaira(c.plan.share)} = ${formatNaira(c.plan.price)})`
            : `Batch currently being filled: Batch ${B.open.n} (${B.open.count}/${B.size}, needs ${B.open.need} more = ${formatNaira(B.open.need * c.plan.share)})`;
        let unpaidLine = "UNKNOWN - the member list hasn't been loaded yet (an admin can run !unpaidlist to refresh it)";
        let extra = "";
        if (roster.length) {
            const owing = roster.filter(r => !isPaidRoster(r));
            unpaidLine = owing.length ? owing.slice(0, 80).map(r => fmt(r.phone)).join('; ') : 'nobody - everyone has paid';
            extra = `\nGroup members (excluding the bot): ${roster.length}. Batches needed to cover everyone: ${Math.ceil(roster.length / B.size)}. Members still unpaid: ${owing.length}.`;
        }
        let me = "";
        if (senderPhone) {
            const mine = roster.find(r => r.phone === senderPhone || r.alt.includes(senderPhone));
            const myPhone = mine ? mine.phone : senderPhone;
            const entry = c.paid[myPhone] || c.paid[senderPhone] || (mine && Object.entries(c.paid).find(([ph]) => mine.alt.includes(ph)) || [])[1];
            if (entry) me = `\nThe person you are talking to is marked as PAID (Batch ${entry.batch}).`;
            else if (mine || (g.members && g.members[senderPhone])) me = `\nThe person you are talking to is NOT marked as paid yet.`;
        }
        blocks.push(`Group "${g.name || j}" - cycle ${c.cycle}${c.info ? ` - extra details: ${c.info}` : ''}\nPlan: ${formatNaira(c.plan.price)} for the family plan; each person contributes ${formatNaira(c.plan.share)}; ${B.size} people complete one batch.\n${batchLines}\n${openLine}\nNOT PAID YET: ${unpaidLine}${extra}${me}`);
    }
    const planFacts = `The Spotify Premium family plan costs ${formatNaira(DEFAULT_PLAN.price)}. Each person contributes ${formatNaira(DEFAULT_PLAN.share)}, so every batch has ${Math.ceil(DEFAULT_PLAN.price / DEFAULT_PLAN.share)} people - when ${Math.ceil(DEFAULT_PLAN.price / DEFAULT_PLAN.share)} people have paid, the batch is complete and can subscribe. The group is bigger than one batch, so people are grouped batch by batch.`;
    return `\n=== SPOTIFY PREMIUM FAMILY-PLAN CONTRIBUTIONS (live data kept by the group admins) ===\nHOW IT WORKS: ${blocks.length ? "Use the plan numbers in the data below (they can be changed by admins)." : planFacts}\nUse this to answer questions like "who has paid", "who hasn't paid", "did I pay", "which batch am I in", "is batch 1 complete", "is it ready for the next batch", "how many more people are needed". Rules: report ONLY what is listed here, exactly as written, and never guess or invent payments, amounts, batches or names. Do the arithmetic from the numbers given. You cannot mark anyone as paid or as subscribed - if someone says they paid but the list says otherwise, tell them to ask a group admin to mark them with !paid (admins use !subscribed <batch> once a complete batch has subscribed). You may point to !batch (full batch report), !paidlist and !unpaidlist. Keep it friendly and don't shame anyone.\n${blocks.length ? blocks.join('\n---\n') : "No payments have been recorded in the tracker yet."}`;
}
function buildMusicPromptContext(groupJid, groupName, isGroup, senderPhone = "") {
    let s = "";
    if (isGroup && groupName) s += `\nThis group is called "${groupName}" - use that exact name if you ever mention the group.`;
    const g = groupJid && db.groups[groupJid];
    if (g && g.sotd && g.sotd.title) s += `\nThe group's Song of the Day right now: ${g.sotd.title}.`;
    if (g && Array.isArray(g.queue) && g.queue.length) s += `\nSongs currently requested in the group queue: ${g.queue.slice(0, 5).map(q => q.title).join('; ')}.`;
    s += buildContributionContext(groupJid, isGroup, senderPhone);
    return s;
}

// ---------- Strikes (warn 1/3, 2/3, then remove) ----------
async function issueStrike(sock, jid, senderJid, reason) {
    const g = getGroupData(jid);
    const phone = extractPhoneNumber(senderJid);
    const n = (g.warnings[phone] || 0) + 1;
    g.warnings[phone] = n;
    saveDB();
    let target = null;
    try {
        const meta = await getGroupMeta(sock, jid);
        target = (meta.participants || []).find(p => participantMatchesPhone(p, phone)) || null;
    } catch (e) {}
    const mentionJid = target ? target.id : senderJid;
    if (n >= 3) {
        try {
            const r = await sock.groupParticipantsUpdate(jid, [mentionJid], 'remove');
            const st = String((r && r[0] && r[0].status) || '200');
            if (st !== '200') throw new Error(`status ${st} - is the bot a group admin?`);
            await sock.sendMessage(jid, { text: `🚫 @${phone} was removed: ${reason} (3/3 warnings).`, mentions: [mentionJid] });
            delete g.warnings[phone];
            saveDB();
        } catch (e) {
            await sock.sendMessage(jid, { text: `⚠️ @${phone} reached 3/3 warnings but I couldn't remove them: ${e.message || e}`, mentions: [mentionJid] });
        }
    } else {
        await sock.sendMessage(jid, { text: `⚠️ @${phone} - ${reason}. Warning ${n}/3`, mentions: [mentionJid] });
    }
    return n;
}

// ---------- Music-group moderation (antilink / banned words / text spam / mute) ----------
const MUSIC_LINK_DOMAINS = [
    'spotify.com', 'spotify.link', 'spoti.fi', 'music.apple.com', 'apple.co', 'youtube.com', 'youtu.be',
    'soundcloud.com', 'audiomack.com', 'deezer.com', 'tidal.com', 'boomplay.com', 'genius.com', 'bandcamp.com',
    'last.fm', 'shazam.com', 'napster.com', 'amazon.com', 'music.amazon.com', 'pandora.com', 'musixmatch.com', 'songwhip.com', 'linktr.ee'
];
function extractUrls(text) {
    const out = [];
    const withScheme = text.match(/\b(?:https?:\/\/|www\.)[^\s]+/gi) || [];
    out.push(...withScheme);
    const bare = text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|co|ly|link|app|xyz|info|ng|tv|gg|cc|biz|shop|site|online|club|top|vip)\b(?:\/[^\s]*)?/gi) || [];
    for (const b of bare) if (!withScheme.some(w => w.toLowerCase().includes(b.toLowerCase()))) out.push(b);
    return out;
}
function hostOf(url) {
    try { return new URL(/^https?:/i.test(url) ? url : `http://${url}`).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}
function isMusicDomain(host) { return !!host && MUSIC_LINK_DOMAINS.some(d => host === d || host.endsWith('.' + d)); }
const floodTracker = new Map();
const repeatTracker = new Map();
// Returns true if the message was removed (the caller should stop handling it).
async function runGroupModeration(sock, msg, jid, rawText, senderJid) {
    const g = getGroupData(jid);
    const phone = extractPhoneNumber(senderJid);
    const del = () => sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
    if (g.muted.includes(phone)) { await del(); return true; }
    let meta;
    try { meta = await getGroupMeta(sock, jid); } catch (e) { return false; }
    const senderIsAdmin = (meta.participants || []).some(p => participantMatchesPhone(p, phone) && isAdminParticipant(p));
    if (senderIsAdmin) return false; // admins are never moderated
    const text = String(rawText || '');
    // 1) ANTILINK
    if (db.settings.antilinkActive) {
        const wa = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
        if (wa) {
            let ownCode = "";
            try { ownCode = await sock.groupInviteCode(jid); } catch (e) {}
            if (!(ownCode && wa[1] === ownCode)) {
                await del();
                await issueStrike(sock, jid, senderJid, "Foreign WhatsApp group links are not allowed here");
                return true;
            }
        } else if (db.settings.antilinkMode === 'strict') {
            const bad = extractUrls(text).find(u => !isMusicDomain(hostOf(u)));
            if (bad) {
                await del();
                await issueStrike(sock, jid, senderJid, "Only music links (Spotify, YouTube, Apple Music, etc.) are allowed here");
                return true;
            }
        }
    }
    // 2) BANNED WORDS
    if (db.settings.bannedWords.length) {
        const hit = db.settings.bannedWords.find(w => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(text));
        if (hit) {
            await del();
            await issueStrike(sock, jid, senderJid, "Please watch your language");
            return true;
        }
    }
    // 3) TEXT SPAM (flood + duplicate) - same switch as the duplicate-media antispam
    if (db.settings.antispamActive) {
        const key = `${jid}:${phone}`;
        const now = Date.now();
        const stamps = (floodTracker.get(key) || []).filter(t => now - t < 8000);
        stamps.push(now);
        floodTracker.set(key, stamps);
        if (stamps.length >= 6) {
            floodTracker.set(key, []);
            await del();
            await issueStrike(sock, jid, senderJid, "Please stop flooding the chat");
            return true;
        }
        const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
        if (norm.length >= 4) {
            const prev = repeatTracker.get(key);
            if (prev && prev.text === norm && now - prev.at < 120000) { prev.count += 1; prev.at = now; }
            else repeatTracker.set(key, { text: norm, count: 1, at: now });
            if (repeatTracker.get(key).count >= 3) {
                repeatTracker.delete(key);
                await del();
                await issueStrike(sock, jid, senderJid, "Please stop sending duplicate messages");
                return true;
            }
        }
    }
    return false;
}

// ===================================================================
//                         SPOTIFY WEB API
// ===================================================================
function spotifyConfigured() {
    return !!SPOTIFY_CLIENT_ID && !!SPOTIFY_CLIENT_SECRET
        && !SPOTIFY_CLIENT_ID.startsWith('PASTE_') && !SPOTIFY_CLIENT_SECRET.startsWith('PASTE_');
}
let spotifyTokenCache = { token: "", expiresAt: 0 };
async function getSpotifyToken(force = false) {
    if (!spotifyConfigured()) throw new Error('SPOTIFY_NOT_CONFIGURED');
    if (!force && spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt - 60000) return spotifyTokenCache.token;
    try {
        const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
        const res = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
            headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });
        spotifyTokenCache = { token: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 };
        return spotifyTokenCache.token;
    } catch (err) {
        if (err.response && (err.response.status === 400 || err.response.status === 401)) throw new Error('SPOTIFY_BAD_CREDENTIALS');
        throw err;
    }
}
async function spotifyGet(endpoint, params = {}, retry = true) {
    const token = await getSpotifyToken();
    try {
        const res = await axios.get(`https://api.spotify.com/v1${endpoint}`, {
            params, headers: { 'Authorization': `Bearer ${token}` }, timeout: 15000
        });
        return res.data;
    } catch (err) {
        const status = err.response && err.response.status;
        if (status === 401 && retry) { await getSpotifyToken(true); return spotifyGet(endpoint, params, false); }
        if (status === 429) throw new Error('SPOTIFY_RATE_LIMIT');
        throw err;
    }
}
function spotifyErrorText(e) {
    const st = e && e.response && e.response.status;
    if (e.message === 'SPOTIFY_NOT_CONFIGURED') return "⚠️ Spotify isn't connected yet. (Owner: add your Spotify Client ID + Secret at the top of index.js.)";
    if (e.message === 'SPOTIFY_BAD_CREDENTIALS') return "⚠️ The Spotify Client ID / Secret look wrong. (Owner: double-check them in the Spotify dashboard.)";
    if (e.message === 'SPOTIFY_RATE_LIMIT' || st === 429) return "⏳ Spotify is rate-limiting me right now. Try again in a minute.";
    if (st === 403) return "🚫 Spotify refused that request. (Owner: apps in Spotify development mode need the app owner to have an active Premium plan.)";
    if (st === 404) return "😕 Spotify couldn't find that - it may be private or unavailable.";
    console.error('[Spotify Error]', (e.response && e.response.data) || e.message);
    return "❌ Spotify lookup failed. Try again in a bit.";
}
// NOTE: since Feb 2026 Spotify dev-mode apps get at most 10 search results per call.
async function spotifySearch(query, type = 'track', limit = 5) {
    const data = await spotifyGet('/search', { q: query, type, limit: Math.min(limit, 10) });
    return ((data[`${type}s`] && data[`${type}s`].items) || []).filter(Boolean);
}
function fmtDuration(ms) {
    const total = Math.round((ms || 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function artistNames(item) { return ((item && item.artists) || []).map(a => a.name).join(', '); }
function releaseYear(d) { return String(d || '').slice(0, 4); }
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim(); }
function trackCard(t) {
    const lines = [`🎵 *${t.name}*${t.explicit ? ' 🅴' : ''}`, `🎤 ${artistNames(t)}`];
    if (t.album) lines.push(`💿 ${t.album.name}${t.album.release_date ? ` (${releaseYear(t.album.release_date)})` : ''}`);
    if (t.duration_ms) lines.push(`⏱ ${fmtDuration(t.duration_ms)}`);
    if (t.external_urls && t.external_urls.spotify) lines.push(`🔗 ${t.external_urls.spotify}`);
    return lines.join('\n');
}
function albumCard(a) {
    const lines = [`💿 *${a.name}*`, `🎤 ${artistNames(a)}`];
    const meta = [a.album_type ? a.album_type.charAt(0).toUpperCase() + a.album_type.slice(1) : '', a.release_date ? releaseYear(a.release_date) : '', a.total_tracks ? `${a.total_tracks} tracks` : ''].filter(Boolean);
    if (meta.length) lines.push(`📅 ${meta.join(' • ')}`);
    const items = (a.tracks && a.tracks.items) || [];
    if (items.length) {
        lines.push('', '*Tracklist:*');
        items.slice(0, 20).forEach((t, i) => lines.push(`${i + 1}. ${t.name} (${fmtDuration(t.duration_ms)})`));
        if (items.length > 20 || (a.total_tracks && a.total_tracks > 20)) lines.push(`...and ${(a.total_tracks || items.length) - 20} more`);
    }
    if (a.external_urls && a.external_urls.spotify) lines.push('', `🔗 ${a.external_urls.spotify}`);
    return lines.join('\n');
}
function artistCard(a) {
    const lines = [`🎤 *${a.name}*`];
    if (a.genres && a.genres.length) lines.push(`🎼 ${a.genres.slice(0, 4).join(', ')}`);
    if (a.external_urls && a.external_urls.spotify) lines.push(`🔗 ${a.external_urls.spotify}`);
    return lines.join('\n');
}
// Spotify link -> { text, image }. Works for track / album / artist / playlist links.
const SPOTIFY_LINK_REGEX = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist)\/([A-Za-z0-9]{22})/i;
async function spotifyCardFromId(type, id) {
    if (type === 'track') {
        const t = await spotifyGet(`/tracks/${id}`);
        return { text: trackCard(t), image: t.album && t.album.images && t.album.images[0] && t.album.images[0].url };
    }
    if (type === 'album') {
        const a = await spotifyGet(`/albums/${id}`);
        return { text: albumCard(a), image: a.images && a.images[0] && a.images[0].url };
    }
    if (type === 'artist') {
        const a = await spotifyGet(`/artists/${id}`);
        return { text: artistCard(a), image: a.images && a.images[0] && a.images[0].url };
    }
    const p = await spotifyGet(`/playlists/${id}`, { fields: 'name,description,owner(display_name),images,external_urls' });
    const desc = stripHtml(p.description).slice(0, 200);
    const lines = [`📻 *${p.name}*`];
    if (p.owner && p.owner.display_name) lines.push(`👤 ${p.owner.display_name}`);
    if (desc) lines.push(`📝 ${desc}`);
    if (p.external_urls && p.external_urls.spotify) lines.push(`🔗 ${p.external_urls.spotify}`);
    return { text: lines.join('\n'), image: p.images && p.images[0] && p.images[0].url };
}
async function sendWithOptionalImage(sock, jid, text, imageUrl, quoted) {
    const opts = quoted ? { quoted } : {};
    if (imageUrl) {
        try { return await sock.sendMessage(jid, { image: { url: imageUrl }, caption: text }, opts); } catch (e) {}
    }
    return sock.sendMessage(jid, { text }, opts);
}
// Auto "Spotify link card" + share counter (for the !topsharers leaderboard).
const linkCardCooldown = new Map();
async function handleSpotifyLinks(sock, msg, jid, rawText, senderJid) {
    const m = String(rawText || '').match(SPOTIFY_LINK_REGEX);
    if (!m) return;
    const g = getGroupData(jid);
    const phone = extractPhoneNumber(senderJid);
    g.shares[phone] = (g.shares[phone] || 0) + 1;
    saveDB();
    if (!db.settings.spotifyLinkCards || !spotifyConfigured()) return;
    if (Date.now() - (linkCardCooldown.get(jid) || 0) < 15000) return;
    linkCardCooldown.set(jid, Date.now());
    try {
        const card = await spotifyCardFromId(m[1].toLowerCase(), m[2]);
        await sock.sendPresenceUpdate('composing', jid);
        await delay(1500 + Math.random() * 1500);
        await sock.sendPresenceUpdate('paused', jid);
        await sendWithOptionalImage(sock, jid, card.text, card.image, msg);
    } catch (e) {
        console.error('[Spotify link card]', e.message || e);
    }
}

// ===================================================================
//                       AI MUSIC (GROQ) HELPERS
// ===================================================================
async function groqChat(messages, { maxTokens = 600, temperature = 0.7, effort = 'low' } = {}) {
    const call = async (tokens) => {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            { model: 'openai/gpt-oss-120b', messages, temperature, max_tokens: tokens, reasoning_effort: effort },
            { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 45000 });
        return (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content || '').trim();
    };
    let out = await call(maxTokens);
    if (!out) out = await call(maxTokens * 2);
    return out;
}
function extractJson(text, open, close) {
    const s = text.indexOf(open), e = text.lastIndexOf(close);
    if (s === -1 || e === -1 || e <= s) throw new Error('No JSON found in AI reply');
    return JSON.parse(text.slice(s, e + 1));
}
async function aiSongSuggestions(topic, count, mode) {
    const system = `You are a world-class music curator. Reply with ONLY a JSON array of exactly ${count} objects shaped like {"title":"...","artist":"..."}. Rules: only REAL, officially released songs that you are highly confident exist, each with its correct main artist. Mix famous tracks with a few deeper cuts. No duplicates. No commentary, no markdown.`;
    const user = mode === 'similar' ? `Songs similar to (in sound, mood or style): ${topic}. Do not include the original song/artist itself.`
        : mode === 'genre' ? `The essential, must-hear songs of this genre/style: ${topic}`
        : `Songs that perfectly fit this mood, vibe or activity: ${topic}`;
    const raw = await groqChat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 900, temperature: 0.8 });
    const arr = extractJson(raw, '[', ']');
    return arr.filter(x => x && x.title && x.artist).slice(0, count).map(x => ({ title: String(x.title), artist: String(x.artist) }));
}
function artistLooselyMatches(aiArtist, track) {
    const a = normName(aiArtist);
    return ((track && track.artists) || []).some(x => { const n = normName(x.name); return n && a && (a.includes(n) || n.includes(a)); });
}
async function resolveSongsOnSpotify(list) {
    if (!spotifyConfigured()) return list.map(s => ({ ...s, url: '' }));
    return Promise.all(list.map(async (s) => {
        try {
            const clean = (x) => String(x || '').replace(/["']/g, '');
            let r = await spotifySearch(`track:"${clean(s.title)}" artist:"${clean(s.artist)}"`, 'track', 3);
            if (!r.length) r = await spotifySearch(`${clean(s.title)} ${clean(s.artist)}`, 'track', 3);
            const match = r.find(t => artistLooselyMatches(s.artist, t));
            if (match) return { title: match.name, artist: artistNames(match), url: (match.external_urls && match.external_urls.spotify) || '' };
        } catch (e) {}
        return { ...s, url: '' };
    }));
}
function formatSongList(header, songs) {
    const lines = songs.map((s, i) => `${i + 1}. *${s.title}* - ${s.artist}${s.url ? `\n   🔗 ${s.url}` : ''}`);
    return `${header}\n\n${lines.join('\n')}`;
}
async function aiTrivia(topic, recent) {
    const system = `You write fun music trivia for a WhatsApp group. Reply with ONLY a JSON object: {"question":"...","options":["...","...","...","..."],"answer":"A","fact":"..."} where options are the four answer texts for A, B, C, D, "answer" is the letter of the single correct option, and "fact" is one short fun sentence explaining the answer. Use ONLY facts you are completely certain about (famous songs, artists, albums, music history). Randomize which letter is correct. No markdown.`;
    const user = `${topic ? `Topic: ${topic}.` : 'Topic: any music (pop, hip-hop, afrobeats, rock, R&B, classics, Spotify and streaming history).'} Random seed: ${Math.random().toString(36).slice(2, 8)}.${recent.length ? ` Do NOT repeat these earlier questions: ${recent.slice(-8).join(' | ')}` : ''}`;
    const raw = await groqChat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 700, temperature: 0.9 });
    const obj = extractJson(raw, '{', '}');
    const answer = String(obj.answer || '').trim().toUpperCase()[0];
    if (!obj.question || !Array.isArray(obj.options) || obj.options.length !== 4 || !'ABCD'.includes(answer)) throw new Error('Bad trivia JSON');
    return { question: String(obj.question), options: obj.options.map(String), answer, fact: String(obj.fact || '') };
}

// ===================================================================
//                  ▶️ PLAY (30-second previews)
// ===================================================================
// Spotify does not allow bots to stream full songs, so !play sends a 30-second preview clip
// (from Apple's free iTunes Search API) plus the Spotify link for the full track.
async function findItunesPreview(query, wantTitle = "", wantArtist = "") {
    const res = await axios.get('https://itunes.apple.com/search', {
        params: { term: query, media: 'music', entity: 'song', limit: 10 }, timeout: 15000
    });
    const items = ((res.data && res.data.results) || []).filter(r => r && r.previewUrl);
    if (!items.length) return null;
    if (!wantTitle && !wantArtist) return items[0];
    const t = normName(wantTitle), a = normName(wantArtist);
    const good = items.find(r => {
        const rt = normName(r.trackName), ra = normName(r.artistName);
        const titleOk = !t || (rt && (rt.includes(t) || t.includes(rt)));
        const artistOk = !a || (ra && (ra.includes(a) || a.includes(ra) || a.split(' ').some(w => w.length > 2 && ra.includes(w))));
        return titleOk && artistOk;
    });
    return good || null;
}
// Looks the song up (Spotify for the link/cover when connected, iTunes for the audio) and sends the clip.
// Returns true if audio was sent.
async function sendSongPreview(sock, jid, query, quoted) {
    const opts = quoted ? { quoted } : {};
    let title = "", artist = "", link = "", cover = "";
    if (spotifyConfigured()) {
        try {
            const r = await spotifySearch(query, 'track', 1);
            if (r[0]) {
                title = r[0].name; artist = artistNames(r[0]);
                link = (r[0].external_urls && r[0].external_urls.spotify) || "";
                cover = (r[0].album && r[0].album.images && r[0].album.images[0] && r[0].album.images[0].url) || "";
            }
        } catch (e) { /* fall back to a plain iTunes search below */ }
    }
    let item = null;
    try { item = await findItunesPreview(title ? `${title} ${artist}` : query, title, artist); } catch (e) { console.error('[Play] iTunes lookup failed:', e.message || e); }
    if (!item) {
        const fallbackLink = link || `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        await sock.sendMessage(jid, { text: `😕 I couldn't find a playable preview for *${title ? `${title} - ${artist}` : query}*.\nOpen it on Spotify instead:\n🔗 ${fallbackLink}` }, opts);
        return false;
    }
    let audio;
    try {
        const dl = await axios.get(item.previewUrl, { responseType: 'arraybuffer', timeout: 30000 });
        audio = Buffer.from(dl.data);
    } catch (e) {
        console.error('[Play] preview download failed:', e.message || e);
        await sock.sendMessage(jid, { text: `⚠️ The preview wouldn't download right now. Try again in a moment.${link ? `\n🔗 ${link}` : ''}` }, opts);
        return false;
    }
    const shownTitle = title || item.trackName, shownArtist = artist || item.artistName;
    const art = cover || (item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '');
    const caption = `▶️ *Now playing (30s preview)*\n🎵 *${shownTitle}*\n🎤 ${shownArtist}${item.collectionName ? `\n💿 ${item.collectionName}` : ''}\n${link ? `🎧 Full song on Spotify: ${link}` : `🎧 Full song: ${item.trackViewUrl || ''}`}`;
    await sendWithOptionalImage(sock, jid, caption, art, quoted);
    try { await sock.sendPresenceUpdate('recording', jid); } catch (e) {}
    await sock.sendMessage(jid, { audio, mimetype: 'audio/mp4', ptt: false }, opts);
    try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}
    return true;
}

// ===================================================================
//                    WELCOME / GOODBYE MESSAGES
// ===================================================================
const DEFAULT_WELCOME = `🎧🎶 *Welcome to {group}*, {user}! 🎶🎧

You just joined a crew of music lovers & Spotify heads 💚

🎵 Share your favourite tracks & playlists
🎤 Request a song: *!request <song>*
🧠 Play music trivia: *!trivia*
📜 Read the rules: *!rules*
📖 All commands: *!menu*

You're member #{count}. Press play and make yourself at home! 💚`;
function buildWelcomeText(groupName, count, userMentions) {
    const template = db.settings.welcomeMessage || DEFAULT_WELCOME;
    return template
        .replace(/\{user\}/gi, userMentions)
        .replace(/\{group\}/gi, groupName)
        .replace(/\{count\}/gi, String(count));
}
async function sendGroupGreeting(sock, id, text, targets, withPicture) {
    let pic = null;
    if (withPicture) { try { pic = await sock.profilePictureUrl(id, 'image'); } catch (e) {} }
    if (pic) {
        try { return await sock.sendMessage(id, { image: { url: pic }, caption: text, mentions: targets }); } catch (e) {}
    }
    return sock.sendMessage(id, { text, mentions: targets });
}
async function handleGroupParticipantsUpdate(sock, ev) {
    const { id, participants, action } = ev;
    groupMetaCache.delete(id); // membership changed - refresh the admin/name cache next time
    const wantWelcome = action === 'add' && db.settings.welcomeActive;
    const wantBye = action === 'remove' && db.settings.goodbyeActive;
    if (!wantWelcome && !wantBye) return;
    const jids = (participants || []).map(p => typeof p === 'string' ? p : (p.id || p.phoneNumber)).filter(Boolean);
    const botPhones = [extractPhoneNumber(sock.user && sock.user.id), sock.user && sock.user.lid ? extractPhoneNumber(sock.user.lid) : null].filter(Boolean);
    const targets = jids.filter(j => !botPhones.includes(extractPhoneNumber(j)));
    if (!targets.length) return;
    const meta = await getGroupMeta(sock, id, 0);
    const groupName = meta.subject || "the group"; // EXACT current group name
    const count = (meta.participants || []).length;
    const mentionText = targets.map(j => `@${extractPhoneNumber(j)}`).join(', ');
    await delay(2500 + Math.random() * 3500);
    try { await sock.sendPresenceUpdate('composing', id); await delay(1500 + Math.random() * 1500); await sock.sendPresenceUpdate('paused', id); } catch (e) {}
    if (wantWelcome) {
        await sendGroupGreeting(sock, id, buildWelcomeText(groupName, count, mentionText), targets, true);
    } else {
        await sendGroupGreeting(sock, id, `👋 ${mentionText} just left *${groupName}*. The music goes on 🎶`, targets, false);
    }
}

// ===================================================================
//                          HELP MENU
// ===================================================================
// Everything the AI assistant knows about this bot's commands (added to its system prompt on every reply).
const COMMAND_GUIDE = `Commands start with ! or . (for example !song or .song). You cannot run commands yourself - when someone needs one, tell them the exact command to type. Members can only use commands if the owner switched the bot to public mode (!public); owner-only commands always stay with the owner.
EVERYONE can use:
- Spotify: !song <name or Spotify link> (track card + cover), !artist <name>, !album <name>, !playlist <query>, !newreleases, !lyrics <song> (gives a Genius link - lyrics are never pasted)
- Play: !play <song> sends a 30-second preview clip plus the Spotify link for the full song (Spotify does not allow full-song streaming through bots)
- AI picks: !mood <vibe>, !similar <song or artist>, !genre <genre>, !makeplaylist <theme> (10 songs), !musicfact [topic]
- Group music: !request <song> (add to the queue, max 3 each), !queue, !vote <number>, !sotd (see Song of the Day), !trivia [topic], !answer <A-D>, !leaderboard (trivia points), !topsharers (who shares the most Spotify links), !poll <question> | opt1 | opt2
- Group info: !rules, !warnings [@user], !batch (batch-by-batch family-plan status: who paid, which batches are complete/subscribed, what's next), !paidlist (who has paid this cycle), !unpaidlist (who hasn't), !contribution (plan price and details), !menu or !help (full command list)
- Utility: !translate <language> <text> (or reply to a message), !listonline, !status, !steal (reply to a sticker/image/video to make it a sticker)
GROUP ADMINS (and the owner) can also use:
- Contribution tracker (family-plan batches): !paid @user1 @user2 [note] [batch N] (mark as paid; they fill Batch 1 first, then Batch 2...), !unpaid @user, !subscribed <batch> (mark a complete batch as subscribed), !setplan <total> <each> (default 2500 and 500 = 5 people per batch), !setcontribution <details>, !resetpaid (start a new month)
- Moderation: !warn @user [reason] (3 warnings = removal), !resetwarn @user, !kick @user, !mute @user / !unmute @user (muted members' messages are deleted), !lock / !unlock (only admins can chat), !banword add|remove|list <word>, !setrules <text>, !hidetag <message> (tags everyone), !svcontact (VCF of all members)
- Automatic protection: !antilink on|off|strict (strict = only music links allowed), !antispam on|off (duplicate media, duplicate texts, flooding), !linkcards on|off (auto card when a Spotify link is posted)
- Welcome: !welcome on|off|set <text>|reset|test (placeholders {user} {group} {count}; it always uses the group's exact name), !goodbye on|off
- Queue control: !play (plays the top-voted queued song) or !play <number>, !next (announce and play the next queued song), !removerequest <number>, !clearqueue, !votesongs (turn the queue into a poll), !sotd <song> (set the Song of the Day)
OWNER ONLY:
- !bot on|off (auto-replies), !public / !private (let members use commands or not), !voice on|off|auto, !voicechance <0-100>, !ttsvoice <voice>, !groupchat on|off (reply in groups only when tagged), !lang <language> (AI reply language), !afk <reason> / !afk clear, !owner set <name>, !ownernumber <number>, !blacklist (@user or number), !memories, !remember <number> <nickname> | <note>, !history <number>, !wipe, !py, !vv (reply to a view-once media to unlock it)
Automatic features: new members get a welcome message; foreign WhatsApp group links, spam and banned words are removed with warnings; voice notes are transcribed and pictures are read; people can tag the bot or reply to it to chat.`;

function buildHelpMenu() {
    return `🎧 *${BOT_NAME} - Spotify & Music Group Bot*

🔎 *SPOTIFY*
• *!song* <name or Spotify link> - track card + cover
• *!artist* <name> - artist, latest releases & top results
• *!album* <name> - album + tracklist
• *!playlist* <query> - find playlists
• *!newreleases* - fresh albums
• *!play* <song> - 30-second preview clip + Spotify link
• *!lyrics* <song> - lyrics search link

🤖 *AI MUSIC PICKS*
• *!mood* <vibe/activity> - 5 songs for the moment
• *!similar* <song/artist> - more like it
• *!genre* <genre> - genre essentials
• *!makeplaylist* <theme> - 10-track playlist w/ links
• *!musicfact* [topic]

🎤 *GROUP MUSIC*
• *!request* <song> - add to the queue
• *!queue* - see the queue • *!vote* <n> - upvote
• *!votesongs* - turn the queue into a poll
• *!sotd* - Song of the Day
• *!trivia* [topic] • *!answer* <A-D> • *!leaderboard*
• *!topsharers* - top Spotify link sharers
• *!poll* <question> | opt1 | opt2
• *!rules* - group rules

🛡 *ADMIN MODERATION*
• *!warn* / *!warnings* / *!resetwarn* @user
• *!kick* @user • *!mute* / *!unmute* @user
• *!lock* / *!unlock* - close/open the group
• *!banword* add|remove|list <word>
• *!antilink* on|off|strict
• *!antispam* on|off
• *!linkcards* on|off
• *!setrules* <text>
• *!welcome* on|off|set <text>|reset|test
• *!goodbye* on|off
• *!play* / *!play* <n> - play the top voted (or #n) queue song
• *!next* (announce + play next) • *!removerequest* <n> • *!clearqueue*
• *!hidetag* <message>

💚 *PREMIUM FAMILY PLAN (BATCHES)*
• *!batch* - batch-by-batch status: who paid, which batch is complete, what's next
• *!paidlist* / *!unpaidlist* - who has / hasn't paid
• *!contribution* - plan price & info
• *!paid* @user1 @user2 [note] [batch 2] - mark as paid (admins)
• *!unpaid* @user - remove from the paid list (admins)
• *!subscribed* <batch> - mark a complete batch as subscribed (admins)
• *!setplan* <total> <each> - e.g. 2500 500 (admins)
• *!setcontribution* <details> - extra info on the lists (admins)
• *!resetpaid* - start a new month/cycle (admins)

⚙️ *OWNER*
!bot • !public / !private • !voice • !voicechance • !groupchat • !owner • !ownernumber • !py • !lang • !listonline • !svcontact • !memories • !remember • !history • !wipe • !status • !vv • !translate • !ttsvoice • !blacklist • !afk • !steal`;
}

// ===================================================================
//              MUSIC + MODERATION COMMAND HANDLER (NEW)
// ===================================================================
// ---------- Premium contribution tracker helpers (family-plan BATCHES) ----------
// The family plan costs `plan.price` (default N2,500). Each person contributes `plan.share` (default N500),
// so one batch = price / share people (default 5). Payers fill Batch 1 first, then Batch 2, and so on.
const DEFAULT_PLAN = { price: 2500, share: 500 };
function formatNaira(n) { return '₦' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function currentCycleLabel() {
    const parts = getNigeriaParts();
    return `${parts.month} ${parts.year}`;
}
function batchSize(c) { return Math.max(1, Math.ceil(c.plan.price / c.plan.share)); }
// Gives every paid person a batch number (older saves had none) - in the order they paid.
function ensureBatches(c) {
    const size = batchSize(c);
    const counts = {};
    Object.values(c.paid).forEach(v => { if (v.batch) counts[v.batch] = (counts[v.batch] || 0) + 1; });
    Object.entries(c.paid).filter(([, v]) => !v.batch).sort((a, b) => String(a[1].at).localeCompare(String(b[1].at))).forEach(([, v]) => {
        let n = 1; while ((counts[n] || 0) >= size) n++;
        v.batch = n; counts[n] = (counts[n] || 0) + 1;
    });
}
function getContribData(jid) {
    const g = getGroupData(jid);
    if (!g.contrib) g.contrib = { cycle: currentCycleLabel(), info: "", paid: {}, history: [] };
    const c = g.contrib;
    if (!c.paid) c.paid = {};
    if (!Array.isArray(c.history)) c.history = [];
    if (c.info === undefined) c.info = "";
    if (!c.cycle) c.cycle = currentCycleLabel();
    if (!c.plan || !(c.plan.price > 0) || !(c.plan.share > 0)) c.plan = { ...DEFAULT_PLAN };
    if (!c.batches) c.batches = {};
    ensureBatches(c);
    return c;
}
// -> { size, list: [{n, entries:[[phone, data]], count, complete, subscribed}], open: {n, count, need}, paidCount }
function computeBatches(c) {
    const size = batchSize(c);
    const by = {};
    Object.entries(c.paid).forEach(([p, v]) => { (by[v.batch] = by[v.batch] || []).push([p, v]); });
    const maxN = Math.max(0, ...Object.keys(by).map(Number));
    const list = [];
    for (let n = 1; n <= maxN; n++) {
        const entries = (by[n] || []).sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)));
        list.push({ n, entries, count: entries.length, complete: entries.length >= size, subscribed: !!(c.batches[n] && c.batches[n].subscribed) });
    }
    const firstOpen = list.find(b => !b.complete);
    const open = firstOpen ? { n: firstOpen.n, count: firstOpen.count, need: size - firstOpen.count } : { n: maxN + 1, count: 0, need: size };
    return { size, list, open, paidCount: Object.keys(c.paid).length };
}
// Which batch should the next payer go into? (a requested number is honoured if that batch has room)
function pickBatch(c, requested) {
    const size = batchSize(c);
    const count = (n) => Object.values(c.paid).filter(v => v.batch === n).length;
    if (requested) return count(requested) >= size ? null : requested;
    let n = 1; while (count(n) >= size) n++;
    return n;
}
function batchStatusWord(b) { return b.complete ? (b.subscribed ? '🎉 SUBSCRIBED' : '✅ COMPLETE - ready to subscribe') : `⏳ ${b.count}`; }
// Full batch-by-batch report (used by !batch and !paidlist). Returns { text, mentions }.
function buildBatchReport(c, rosterCount = 0) {
    const B = computeBatches(c);
    const lines = [`💚 *Spotify Family Plan - ${c.cycle}*`, `💰 Plan ${formatNaira(c.plan.price)} • ${formatNaira(c.plan.share)} each • *${B.size} people per batch*`];
    if (c.info) lines.push(`📝 ${c.info}`);
    const mentions = [];
    if (!B.list.length) lines.push('', 'Nobody is marked as paid yet.');
    B.list.forEach(b => {
        const head = b.complete ? `*Batch ${b.n}* ${batchStatusWord(b)} (${b.count}/${B.size})`
            : `*Batch ${b.n}* ⏳ ${b.count}/${B.size} - needs ${B.size - b.count} more (${formatNaira((B.size - b.count) * c.plan.share)} to go)`;
        lines.push('', head);
        if (!b.entries.length) lines.push('   (empty)');
        b.entries.forEach(([p, v], i) => { lines.push(`${i + 1}. @${p}${v.note ? ` - ${v.note}` : ''}`); mentions.push(v.jid || `${p}@s.whatsapp.net`); });
    });
    const openB = B.list.find(b => b.n === B.open.n);
    if (!openB) lines.push('', `➡️ *Batch ${B.open.n}* is next - nobody has paid into it yet (needs ${B.size} × ${formatNaira(c.plan.share)} = ${formatNaira(c.plan.price)}).`);
    const doneBatches = B.list.filter(b => b.complete).length;
    lines.push('', `✅ Paid so far: *${B.paidCount}* • Complete batches: *${doneBatches}*`);
    if (rosterCount) lines.push(`👥 Members who haven't paid yet: *${Math.max(0, rosterCount - B.paidCount)}*`);
    return { text: lines.join('\n'), mentions };
}
// All @mentioned people (or the replied-to person, or a leading phone number).
function resolveTargetJids(contextInfo, subInput) {
    const mentioned = (contextInfo && contextInfo.mentionedJid) || [];
    if (mentioned.length) return [...new Set(mentioned)];
    if (contextInfo && contextInfo.participant && contextInfo.quotedMessage) return [contextInfo.participant];
    const nums = (String(subInput || '').match(/\b\d{7,15}\b/g) || []);
    return [...new Set(nums.map(n => `${n}@s.whatsapp.net`))];
}

function resolveTargetJid(contextInfo, subInput) {
    const mentioned = contextInfo && contextInfo.mentionedJid && contextInfo.mentionedJid[0];
    if (mentioned) return mentioned;
    if (contextInfo && contextInfo.participant && contextInfo.quotedMessage) return contextInfo.participant;
    const first = String(subInput || '').split(/\s+/)[0].replace(/[^0-9]/g, '');
    if (first.length >= 7) return `${first}@s.whatsapp.net`;
    return null;
}
// Returns true when the command was one of the new music/moderation commands (and has been answered).
async function handleMusicCommands(ctx) {
    const { sock, jid, isGroup, isFromMe, command, subInput, msg, contextInfo, cleanSenderJid, pushName, ownerPhone, botPhone } = ctx;
    const senderPhone = extractPhoneNumber(cleanSenderJid);
    const quotedOpts = isGroup ? { quoted: msg } : {};
    const reply = (text, extra = {}) => sock.sendMessage(jid, { text, ...extra }, quotedOpts);
    const needGroup = async () => { if (isGroup) return false; await reply("⚠️ This command only works inside a group."); return true; };
    const aiBusy = async () => {
        if (isFromMe) return false;
        const left = cooldownLeft(`ai:${senderPhone}`, 8000);
        if (left) { await reply(`⏳ Easy there - try again in ${left}s.`); return true; }
        return false;
    };
    const protectedTarget = async (targetJid) => {
        // Returns the participant if the target can be actioned, otherwise answers and returns null.
        const tPhone = extractPhoneNumber(targetJid);
        if (tPhone === botPhone || tPhone === ownerPhone) { await reply("🙅 I won't do that to the owner or myself."); return null; }
        let meta;
        try { meta = await getGroupMeta(sock, jid, 0); } catch (e) { await reply("❌ Couldn't read the group info."); return null; }
        const p = (meta.participants || []).find(x => participantMatchesPhone(x, tPhone));
        if (!p) { await reply("⚠️ That person isn't in this group."); return null; }
        if (isAdminParticipant(p)) { await reply("🙅 That person is a group admin - I can't do that to admins."); return null; }
        return p;
    };

    switch (command) {
        // ---------------------------------------------------------- HELP
        case 'menu': case 'help': case 'commands': case 'musichelp': {
            await reply(buildHelpMenu());
            return true;
        }

        // ---------------------------------------------------------- SPOTIFY LOOKUPS
        case 'song': case 'track': case 'spotify': {
            if (!subInput) { await reply("🎵 Usage: `!song <song name>` or `!song <Spotify link>`\ne.g. `!song Essence Wizkid`"); return true; }
            if (!spotifyConfigured()) { await reply(`🔎 Spotify search link:\nhttps://open.spotify.com/search/${encodeURIComponent(subInput)}`); return true; }
            try {
                const link = subInput.match(SPOTIFY_LINK_REGEX);
                if (link) {
                    const card = await spotifyCardFromId(link[1].toLowerCase(), link[2]);
                    await sendWithOptionalImage(sock, jid, card.text, card.image, isGroup ? msg : null);
                    return true;
                }
                const results = await spotifySearch(subInput, 'track', 5);
                if (!results.length) { await reply(`😕 No tracks found for "${subInput}".`); return true; }
                let text = trackCard(results[0]);
                if (results.length > 1) {
                    text += `\n\n📃 *More results:*\n` + results.slice(1).map((t, i) => `${i + 2}. ${t.name} - ${artistNames(t)}\n   ${(t.external_urls && t.external_urls.spotify) || ''}`).join('\n');
                }
                await sendWithOptionalImage(sock, jid, text, results[0].album && results[0].album.images && results[0].album.images[0] && results[0].album.images[0].url, isGroup ? msg : null);
            } catch (e) { await reply(spotifyErrorText(e)); }
            return true;
        }
        case 'artist': {
            if (!subInput) { await reply("🎤 Usage: `!artist <artist name>`"); return true; }
            if (!spotifyConfigured()) { await reply(`🔎 Spotify search link:\nhttps://open.spotify.com/search/${encodeURIComponent(subInput)}/artists`); return true; }
            try {
                const found = await spotifySearch(subInput, 'artist', 1);
                if (!found.length) { await reply(`😕 No artist found for "${subInput}".`); return true; }
                const a = found[0];
                let text = artistCard(a);
                const [tracks, albums] = await Promise.all([
                    spotifySearch(`artist:"${String(a.name).replace(/"/g, '')}"`, 'track', 5).catch(() => []),
                    spotifyGet(`/artists/${a.id}/albums`, { include_groups: 'album,single', limit: 20 }).then(d => d.items || []).catch(() => [])
                ]);
                if (albums.length) {
                    const seen = new Set();
                    const latest = albums.filter(x => x && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
                        .sort((x, y) => String(y.release_date).localeCompare(String(x.release_date))).slice(0, 5);
                    text += `\n\n💿 *Latest releases:*\n` + latest.map(x => `• ${x.name} (${releaseYear(x.release_date)})`).join('\n');
                }
                if (tracks.length) text += `\n\n🔥 *Top results:*\n` + tracks.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
                await sendWithOptionalImage(sock, jid, text, a.images && a.images[0] && a.images[0].url, isGroup ? msg : null);
            } catch (e) { await reply(spotifyErrorText(e)); }
            return true;
        }
        case 'album': {
            if (!subInput) { await reply("💿 Usage: `!album <album name>`"); return true; }
            if (!spotifyConfigured()) { await reply(`🔎 Spotify search link:\nhttps://open.spotify.com/search/${encodeURIComponent(subInput)}/albums`); return true; }
            try {
                const found = await spotifySearch(subInput, 'album', 1);
                if (!found.length) { await reply(`😕 No album found for "${subInput}".`); return true; }
                const full = await spotifyGet(`/albums/${found[0].id}`);
                await sendWithOptionalImage(sock, jid, albumCard(full), full.images && full.images[0] && full.images[0].url, isGroup ? msg : null);
            } catch (e) { await reply(spotifyErrorText(e)); }
            return true;
        }
        case 'playlist': case 'playlists': {
            if (!subInput) { await reply("📻 Usage: `!playlist <mood, genre or name>`"); return true; }
            if (!spotifyConfigured()) { await reply(`🔎 Spotify search link:\nhttps://open.spotify.com/search/${encodeURIComponent(subInput)}/playlists`); return true; }
            try {
                const found = await spotifySearch(subInput, 'playlist', 5);
                if (!found.length) { await reply(`😕 No playlists found for "${subInput}".`); return true; }
                await reply(`📻 *Playlists for "${subInput}":*\n\n` + found.map((p, i) => `${i + 1}. *${p.name}*${p.owner && p.owner.display_name ? ` - by ${p.owner.display_name}` : ''}\n   🔗 ${(p.external_urls && p.external_urls.spotify) || ''}`).join('\n'));
            } catch (e) { await reply(spotifyErrorText(e)); }
            return true;
        }
        case 'newreleases': case 'new': {
            if (!spotifyConfigured()) { await reply("🔎 Browse new music: https://open.spotify.com/genre/new-releases-page"); return true; }
            try {
                const found = await spotifySearch('tag:new', 'album', 10);
                if (!found.length) { await reply("😕 Couldn't find new releases right now."); return true; }
                await reply(`🆕 *Fresh releases on Spotify:*\n\n` + found.map((a, i) => `${i + 1}. *${a.name}* - ${artistNames(a)}${a.release_date ? ` (${a.release_date})` : ''}\n   🔗 ${(a.external_urls && a.external_urls.spotify) || ''}`).join('\n'));
            } catch (e) { await reply(spotifyErrorText(e)); }
            return true;
        }
        case 'lyrics': {
            if (!subInput) { await reply("📝 Usage: `!lyrics <song name>`"); return true; }
            await reply(`📝 I can't paste lyrics here (copyright), but you can read them on Genius:\nhttps://genius.com/search?q=${encodeURIComponent(subInput)}\n\nOr open the song on Spotify:\nhttps://open.spotify.com/search/${encodeURIComponent(subInput)}`);
            return true;
        }

        // ---------------------------------------------------------- PLAY (30-second preview)
        case 'play': case 'preview': {
            const arg = subInput.trim();
            const g = getGroupData(jid);
            if (!arg || /^\d+$/.test(arg)) {
                // !play  /  !play <number>  = play from the song queue (admins / owner)
                if (!isFromMe && !(isGroup && await isSenderGroupAdmin(sock, jid, cleanSenderJid))) { await reply("🚫 Only group admins can play from the queue.\nYou can still hear any song with `!play <song name>`."); return true; }
                if (!g.queue.length) { await reply("📭 The queue is empty. Add songs with `!request <song>`, or use `!play <song name>`."); return true; }
                let idx = 0;
                if (arg) {
                    idx = parseInt(arg, 10) - 1;
                    if (idx < 0 || idx >= g.queue.length) { await reply(`Pick a number between 1 and ${g.queue.length} (see \`!queue\`).`); return true; }
                } else {
                    g.queue.forEach((q, i) => { const b = g.queue[idx]; if (q.votes.length > b.votes.length || (q.votes.length === b.votes.length && q.at < b.at)) idx = i; });
                }
                const [entry] = g.queue.splice(idx, 1);
                saveDB();
                await reply(`▶️ *Playing from the queue:* ${entry.title}\n👤 Requested by ${entry.byName}${entry.votes.length ? ` • 👍 ${entry.votes.length}` : ''}`);
                try { await sendSongPreview(sock, jid, entry.title, isGroup ? msg : null); } catch (e) { console.error('[Play]', e.message || e); }
                return true;
            }
            if (!isFromMe) {
                const left = cooldownLeft(`play:${senderPhone}`, 15000);
                if (left) { await reply(`⏳ One song at a time - try again in ${left}s.`); return true; }
            }
            try {
                await sock.sendPresenceUpdate('recording', jid);
                await sendSongPreview(sock, jid, arg, isGroup ? msg : null);
            } catch (e) {
                console.error('[Play]', e.message || e);
                await reply("❌ Couldn't play that right now. Try again in a bit.");
            }
            return true;
        }

        // ---------------------------------------------------------- AI MUSIC PICKS
        case 'mood': case 'recommend': case 'similar': case 'genre': case 'makeplaylist': case 'playlistmaker': {
            const isPlaylist = command === 'makeplaylist' || command === 'playlistmaker';
            if (!subInput) {
                const usage = { similar: "🔁 Usage: `!similar <song or artist>`", genre: "🎼 Usage: `!genre <genre>` e.g. `!genre afrobeats`", makeplaylist: "🎶 Usage: `!makeplaylist <theme>` e.g. `!makeplaylist road trip`", playlistmaker: "🎶 Usage: `!makeplaylist <theme>`" };
                await reply(usage[command] || "🎭 Usage: `!mood <vibe or activity>` e.g. `!mood late night drive`");
                return true;
            }
            if (await aiBusy()) return true;
            try {
                await sock.sendPresenceUpdate('composing', jid);
                const mode = command === 'similar' ? 'similar' : command === 'genre' ? 'genre' : 'mood';
                const list = await aiSongSuggestions(subInput, isPlaylist ? 10 : 5, mode);
                if (!list.length) throw new Error('empty list');
                const songs = await resolveSongsOnSpotify(list);
                const header = mode === 'similar' ? `🔁 *If you like ${subInput}:*` : mode === 'genre' ? `🎼 *${subInput} essentials:*` : isPlaylist ? `🎶 *Playlist: ${subInput}*` : `🎭 *Vibe: ${subInput}*`;
                await sock.sendPresenceUpdate('paused', jid);
                await reply(formatSongList(header, songs));
            } catch (e) {
                console.error('[AI music picks]', (e.response && e.response.data) || e.message);
                await reply("😕 I couldn't pull those picks together right now. Try again in a moment.");
            }
            return true;
        }
        case 'musicfact': case 'fact': {
            if (await aiBusy()) return true;
            try {
                const out = await groqChat([
                    { role: 'system', content: "You share one short, interesting, TRUE music fact (max 2 sentences). Only use facts you are completely sure about; if unsure, pick a more famous fact. Never quote lyrics. Output only the fact." },
                    { role: 'user', content: subInput ? `Topic: ${subInput}` : `Any artist, album, instrument or music-history topic. Random seed: ${Math.random().toString(36).slice(2, 8)}` }
                ], { maxTokens: 300, temperature: 0.9 });
                if (!out) throw new Error('empty');
                await reply(`💡 *Music fact:*\n${out}`);
            } catch (e) { await reply("😕 No fact for you right now - try again in a moment."); }
            return true;
        }

        // ---------------------------------------------------------- TRIVIA
        case 'trivia': {
            const g = getGroupData(jid);
            if (g.trivia.active && Date.now() - g.trivia.active.askedAt < 60000) {
                await reply("🧠 A trivia question is already live! Answer it with `!answer <A/B/C/D>`.");
                return true;
            }
            if (await aiBusy()) return true;
            try {
                let prefix = "";
                if (g.trivia.active) {
                    const old = g.trivia.active;
                    prefix = `⌛ Nobody got the last one - the answer was *${old.answer}) ${old.options['ABCD'.indexOf(old.answer)]}*.\n\n`;
                }
                await sock.sendPresenceUpdate('composing', jid);
                const q = await aiTrivia(subInput, g.trivia.recent);
                g.trivia.active = { ...q, askedAt: Date.now(), wrong: [] };
                g.trivia.recent.push(q.question);
                if (g.trivia.recent.length > 15) g.trivia.recent.shift();
                saveDB();
                await sock.sendPresenceUpdate('paused', jid);
                await reply(`${prefix}🧠 *MUSIC TRIVIA*${subInput ? ` - ${subInput}` : ''}\n\n${q.question}\n\nA) ${q.options[0]}\nB) ${q.options[1]}\nC) ${q.options[2]}\nD) ${q.options[3]}\n\n_Answer with_ *!answer <A/B/C/D>*`);
            } catch (e) {
                console.error('[Trivia]', (e.response && e.response.data) || e.message);
                await reply("😕 Couldn't come up with a question right now. Try `!trivia` again.");
            }
            return true;
        }
        case 'answer': case 'ans': {
            const g = getGroupData(jid);
            const t = g.trivia.active;
            if (!t) { await reply("🧠 No trivia running right now. Start one with `!trivia`."); return true; }
            const letter = String(subInput || '').trim().charAt(0).toUpperCase();
            if (!letter || !'ABCD'.includes(letter)) { await reply("Usage: `!answer <A/B/C/D>`"); return true; }
            if (t.wrong.includes(senderPhone)) { await reply("😅 You already had your shot at this one - let someone else try!"); return true; }
            if (letter === t.answer) {
                g.trivia.scores[senderPhone] = (g.trivia.scores[senderPhone] || 0) + 1;
                g.trivia.active = null;
                saveDB();
                await sock.sendMessage(jid, {
                    text: `✅ @${senderPhone} got it! The answer was *${t.answer}) ${t.options['ABCD'.indexOf(t.answer)]}*\n${t.fact ? `💡 ${t.fact}\n` : ''}🏆 +1 point (total: ${g.trivia.scores[senderPhone]})`,
                    mentions: [cleanSenderJid]
                }, quotedOpts);
            } else {
                t.wrong.push(senderPhone);
                saveDB();
                await reply("❌ Not quite! Someone else can still take it.");
            }
            return true;
        }
        case 'leaderboard': case 'musicboard': case 'scores': {
            const g = getGroupData(jid);
            const top = Object.entries(g.trivia.scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (!top.length) { await reply("🏆 No trivia points yet - start with `!trivia`!"); return true; }
            const medals = ['🥇', '🥈', '🥉'];
            await reply(`🏆 *Music Trivia Leaderboard*\n\n` + top.map(([p, n], i) => `${medals[i] || `${i + 1}.`} ${displayNameFor(p)} - ${n} pt${n === 1 ? '' : 's'}`).join('\n'));
            return true;
        }
        case 'topsharers': case 'sharers': {
            const g = getGroupData(jid);
            const top = Object.entries(g.shares).sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (!top.length) { await reply("🔗 Nobody has shared a Spotify link yet. Drop one!"); return true; }
            const medals = ['🥇', '🥈', '🥉'];
            await reply(`🎧 *Top Spotify Sharers*\n\n` + top.map(([p, n], i) => `${medals[i] || `${i + 1}.`} ${displayNameFor(p)} - ${n} link${n === 1 ? '' : 's'}`).join('\n'));
            return true;
        }

        // ---------------------------------------------------------- SONG REQUESTS / QUEUE
        case 'request': case 'suggest': case 'req': {
            if (!subInput) { await reply("🎤 Usage: `!request <song name>`\ne.g. `!request Calm Down Rema`"); return true; }
            const g = getGroupData(jid);
            if (!isFromMe && g.queue.filter(q => q.by === senderPhone).length >= 3) { await reply("✋ You already have 3 songs in the queue - wait for one to play first!"); return true; }
            if (g.queue.length >= 50) { await reply("📭 The queue is full (50 songs). Ask an admin to clear it."); return true; }
            let title = subInput.slice(0, 120), link = "";
            if (spotifyConfigured()) {
                try {
                    const r = await spotifySearch(subInput, 'track', 1);
                    if (r[0]) { title = `${r[0].name} - ${artistNames(r[0])}`; link = (r[0].external_urls && r[0].external_urls.spotify) || ""; }
                } catch (e) {}
            }
            if (g.queue.some(q => q.title.toLowerCase() === title.toLowerCase())) { await reply(`🔁 *${title}* is already in the queue - use \`!vote\` to push it up!`); return true; }
            g.queue.push({ title, link, by: senderPhone, byName: pushName || displayNameFor(senderPhone), at: Date.now(), votes: [] });
            saveDB();
            await reply(`✅ Added to the queue (#${g.queue.length}):\n🎵 *${title}*${link ? `\n🔗 ${link}` : ''}\n_Hear a 30s preview now with_ *!play ${subInput.slice(0, 40)}*`);
            return true;
        }
        case 'queue': case 'requests': {
            const g = getGroupData(jid);
            if (!g.queue.length) { await reply("📭 The queue is empty. Add a song with `!request <song>`."); return true; }
            await reply(`🎶 *Song Queue (${g.queue.length})*\n\n` + g.queue.map((q, i) => `${i + 1}. *${q.title}*\n   👤 ${q.byName}${q.votes.length ? ` • 👍 ${q.votes.length}` : ''}`).join('\n') + `\n\n_Upvote with_ *!vote <number>*`);
            return true;
        }
        case 'vote': case 'upvote': {
            const g = getGroupData(jid);
            const n = parseInt(subInput, 10);
            if (isNaN(n) || n < 1 || n > g.queue.length) { await reply("Usage: `!vote <number>` (see numbers with `!queue`)"); return true; }
            const entry = g.queue[n - 1];
            if (entry.votes.includes(senderPhone)) { await reply("👍 You already voted for that one."); return true; }
            entry.votes.push(senderPhone);
            saveDB();
            await reply(`👍 Voted for *${entry.title}* (${entry.votes.length} vote${entry.votes.length === 1 ? '' : 's'})`);
            return true;
        }
        case 'votesongs': {
            const g = getGroupData(jid);
            if (g.queue.length < 2) { await reply("🗳 I need at least 2 songs in the queue to make a poll. Add some with `!request`."); return true; }
            const top = [...g.queue].sort((a, b) => b.votes.length - a.votes.length || a.at - b.at).slice(0, 6);
            try {
                await sock.sendMessage(jid, { poll: { name: "🎵 What should we play next?", values: top.map(q => q.title.slice(0, 95)), selectableCount: 1 } });
            } catch (e) { await reply("❌ Couldn't create the poll."); }
            return true;
        }
        case 'next': {
            const g = getGroupData(jid);
            if (!g.queue.length) { await reply("📭 The queue is empty."); return true; }
            let bestIdx = 0;
            g.queue.forEach((q, i) => { const b = g.queue[bestIdx]; if (q.votes.length > b.votes.length || (q.votes.length === b.votes.length && q.at < b.at)) bestIdx = i; });
            const [entry] = g.queue.splice(bestIdx, 1);
            saveDB();
            await reply(`▶️ *Up next:* ${entry.title}\n👤 Requested by ${entry.byName}${entry.votes.length ? ` • 👍 ${entry.votes.length}` : ''}${entry.link ? `\n🔗 ${entry.link}` : ''}`);
            try { await sendSongPreview(sock, jid, entry.title, isGroup ? msg : null); } catch (e) { console.error('[Play]', e.message || e); }
            return true;
        }
        case 'removerequest': case 'rmrequest': {
            const g = getGroupData(jid);
            const n = parseInt(subInput, 10);
            if (isNaN(n) || n < 1 || n > g.queue.length) { await reply("Usage: `!removerequest <number>`"); return true; }
            const [removed] = g.queue.splice(n - 1, 1);
            saveDB();
            await reply(`🗑 Removed *${removed.title}* from the queue.`);
            return true;
        }
        case 'clearqueue': {
            const g = getGroupData(jid);
            g.queue = [];
            saveDB();
            await reply("🧹 Song queue cleared.");
            return true;
        }
        case 'sotd': case 'songoftheday': {
            const g = getGroupData(jid);
            if (!subInput) {
                if (!g.sotd) { await reply("🌟 No Song of the Day yet. Admins can set one with `!sotd <song>`."); return true; }
                await sendWithOptionalImage(sock, jid, `🌟 *SONG OF THE DAY*\n🎵 ${g.sotd.title}${g.sotd.link ? `\n🔗 ${g.sotd.link}` : ''}\n_Picked by ${g.sotd.by}_`, g.sotd.image, isGroup ? msg : null);
                return true;
            }
            if (!isFromMe && !(isGroup && await isSenderGroupAdmin(sock, jid, cleanSenderJid))) { await reply("🚫 Only group admins can set the Song of the Day."); return true; }
            if (subInput.toLowerCase() === 'clear') { g.sotd = null; saveDB(); await reply("🌟 Song of the Day cleared."); return true; }
            let title = subInput.slice(0, 120), link = "", image = "";
            if (spotifyConfigured()) {
                try {
                    const r = await spotifySearch(subInput, 'track', 1);
                    if (r[0]) { title = `${r[0].name} - ${artistNames(r[0])}`; link = (r[0].external_urls && r[0].external_urls.spotify) || ""; image = (r[0].album && r[0].album.images && r[0].album.images[0] && r[0].album.images[0].url) || ""; }
                } catch (e) {}
            }
            g.sotd = { title, link, image, by: pushName || displayNameFor(senderPhone), at: Date.now() };
            saveDB();
            await sendWithOptionalImage(sock, jid, `🌟 *NEW SONG OF THE DAY*\n🎵 ${title}${link ? `\n🔗 ${link}` : ''}\n_Picked by ${g.sotd.by}_`, image, isGroup ? msg : null);
            return true;
        }

        // ---------------------------------------------------------- PREMIUM CONTRIBUTION TRACKER (batches)
        case 'paid': case 'markpaid': {
            if (await needGroup()) return true;
            const targets = resolveTargetJids(contextInfo, subInput);
            if (!targets.length) { await reply("💚 Usage: `!paid @user1 @user2 [note]`\nor reply to someone's message with `!paid`\nOptional: add `batch 2` to put them in a specific batch.\ne.g. `!paid @Tunde 500 November`"); return true; }
            const c = getContribData(jid);
            const reqMatch = subInput.match(/\bbatch\s*(\d+)/i);
            const requested = reqMatch ? parseInt(reqMatch[1], 10) : 0;
            const note = subInput.replace(/@\d+/g, '').replace(/\bbatch\s*\d+/i, '').trim().slice(0, 80);
            const beforeDone = new Set(computeBatches(c).list.filter(b => b.complete).map(b => b.n));
            const added = [], already = [], full = [];
            for (const t of targets) {
                const p = extractPhoneNumber(t);
                if (p === botPhone) continue;
                if (c.paid[p]) { already.push(t); if (note) c.paid[p].note = note; continue; }
                const b = pickBatch(c, requested);
                if (!b) { full.push(t); continue; }
                c.paid[p] = { jid: t, at: new Date().toISOString(), note, by: pushName || displayNameFor(senderPhone), batch: b };
                added.push({ t, b });
            }
            saveDB();
            const B = computeBatches(c);
            const lines = [];
            if (added.length) lines.push(`✅ Marked as *PAID* (${c.cycle}):\n${added.map(a => `• @${extractPhoneNumber(a.t)} → Batch ${a.b}${note ? ` (${note})` : ''}`).join('\n')}`);
            if (already.length) lines.push(`ℹ️ Already marked paid:\n${already.map(t => `• @${extractPhoneNumber(t)} (Batch ${c.paid[extractPhoneNumber(t)].batch})`).join('\n')}${note ? '\n(note updated)' : ''}`);
            if (full.length) lines.push(`⚠️ Batch ${requested} is already full (${B.size}/${B.size}), so I didn't add:\n${full.map(t => `• @${extractPhoneNumber(t)}`).join('\n')}\n_Leave out "batch ${requested}" and I'll use the next open batch._`);
            const touched = [...new Set(added.map(a => a.b))].sort((x, y) => x - y);
            touched.forEach(n => {
                const b = B.list.find(x => x.n === n);
                if (b && b.complete && !beforeDone.has(n)) lines.push(`\n🎉 *Batch ${n} is COMPLETE!* (${B.size}/${B.size} = ${formatNaira(c.plan.price)}) - it's ready to subscribe to the family plan.\n_An admin can mark it with_ *!subscribed ${n}*`);
                else if (b) lines.push(`\n📦 Batch ${n}: ${b.count}/${B.size} paid${b.complete ? '' : ` - needs ${B.size - b.count} more (${formatNaira((B.size - b.count) * c.plan.share)})`}`);
            });
            if (touched.some(n => { const b = B.list.find(x => x.n === n); return b && b.complete && !beforeDone.has(n); })) {
                lines.push(`➡️ Next up: *Batch ${B.open.n}* (${B.open.count}/${B.size}) is open for the next ${B.size} contributors.`);
            }
            await sock.sendMessage(jid, { text: lines.join('\n'), mentions: [...added.map(a => a.t), ...already, ...full] }, quotedOpts);
            return true;
        }
        case 'unpaid': case 'unmarkpaid': {
            if (await needGroup()) return true;
            const targets = resolveTargetJids(contextInfo, subInput);
            if (!targets.length) { await reply("Usage: `!unpaid @user` (removes them from the paid list) or reply to their message"); return true; }
            const c = getContribData(jid);
            const removed = [];
            for (const t of targets) {
                const p = extractPhoneNumber(t);
                if (c.paid[p]) { removed.push({ t, b: c.paid[p].batch }); delete c.paid[p]; }
            }
            const size = batchSize(c);
            Object.keys(c.batches).forEach(n => { if (Object.values(c.paid).filter(v => v.batch === Number(n)).length < size) delete c.batches[n]; });
            saveDB();
            if (!removed.length) { await reply("ℹ️ None of those people were on the paid list."); return true; }
            await sock.sendMessage(jid, { text: `↩️ Removed from the paid list:\n${removed.map(r => `• @${extractPhoneNumber(r.t)} (was in Batch ${r.b})`).join('\n')}\n\nSee the updated batches with *!batch*`, mentions: removed.map(r => r.t) }, quotedOpts);
            return true;
        }
        case 'batch': case 'batches': case 'paidlist': case 'contributors': case 'paidmembers': {
            if (await needGroup()) return true;
            const c = getContribData(jid);
            const rosterCount = Array.isArray(getGroupData(jid).roster) ? getGroupData(jid).roster.length : 0;
            const rep = buildBatchReport(c, rosterCount);
            await sock.sendMessage(jid, { text: rep.text, mentions: rep.mentions }, quotedOpts);
            return true;
        }
        case 'unpaidlist': case 'notpaid': case 'owing': {
            if (await needGroup()) return true;
            const c = getContribData(jid);
            let meta;
            try { meta = await getGroupMeta(sock, jid, 0); } catch (e) { await reply("❌ Couldn't read the group members."); return true; }
            const owing = (meta.participants || []).filter(p => extractPhoneNumber(p.id) !== botPhone && !Object.keys(c.paid).some(ph => participantMatchesPhone(p, ph)));
            const B = computeBatches(c);
            if (!owing.length) { await reply(`🎉 Everyone is paid up for ${c.cycle}!`); return true; }
            const status = `📦 *Batch ${B.open.n}* is open: ${B.open.count}/${B.size} paid${B.open.need ? ` - needs ${B.open.need} more (${formatNaira(B.open.need * c.plan.share)})` : ''}`;
            await sock.sendMessage(jid, { text: `⏳ *Not marked as paid yet - ${c.cycle}*\n💰 ${formatNaira(c.plan.share)} each • ${formatNaira(c.plan.price)} per batch of ${B.size}\n${status}\n\n${owing.map((p, i) => `${i + 1}. @${extractPhoneNumber(p.id)}`).join('\n')}\n\n_If you've paid, tell an admin to mark you with_ *!paid*`, mentions: owing.map(p => p.id) }, quotedOpts);
            return true;
        }
        case 'subscribed': {
            if (await needGroup()) return true;
            const c = getContribData(jid);
            const m = subInput.match(/(\d+)/);
            if (!m) { await reply("Usage: `!subscribed <batch number>` - mark a COMPLETE batch as subscribed\n`!subscribed <n> off` - undo"); return true; }
            const n = parseInt(m[1], 10);
            const b = computeBatches(c).list.find(x => x.n === n);
            if (!b) { await reply(`⚠️ Batch ${n} doesn't exist yet.`); return true; }
            if (/\boff\b/i.test(subInput)) { delete c.batches[n]; saveDB(); await reply(`↩️ Batch ${n} is no longer marked as subscribed.`); return true; }
            if (!b.complete) { await reply(`⏳ Batch ${n} isn't complete yet (${b.count}/${batchSize(c)}).`); return true; }
            c.batches[n] = { subscribed: true, at: new Date().toISOString(), by: pushName || displayNameFor(senderPhone) };
            saveDB();
            await reply(`🎉 *Batch ${n} is SUBSCRIBED!* The family plan for this batch is paid for.\n➡️ Next up: *Batch ${computeBatches(c).open.n}*.`);
            return true;
        }
        case 'setplan': {
            const nums = (subInput.match(/\d[\d,]*/g) || []).map(x => parseInt(x.replace(/,/g, ''), 10));
            const c = getContribData(jid);
            if (nums.length < 2 || !(nums[0] > 0) || !(nums[1] > 0) || nums[1] > nums[0]) {
                await reply(`💰 Current plan: ${formatNaira(c.plan.price)} total • ${formatNaira(c.plan.share)} each • ${batchSize(c)} people per batch\n\n_Usage: \`!setplan <total price> <each person pays>\`_\ne.g. \`!setplan 2500 500\``);
                return true;
            }
            c.plan = { price: nums[0], share: nums[1] };
            saveDB();
            await reply(`💰 Plan updated: ${formatNaira(c.plan.price)} total • ${formatNaira(c.plan.share)} each → *${batchSize(c)} people per batch*.`);
            return true;
        }
        case 'setcontribution': case 'contribution': {
            const c = getContribData(jid);
            if (!subInput) { await reply(`💰 *Family plan:* ${formatNaira(c.plan.price)} total • ${formatNaira(c.plan.share)} each • ${batchSize(c)} people per batch${c.info ? `\n📝 ${c.info}` : ''}\n\n_Admins: \`!setcontribution <extra details>\` or \`!setplan <price> <each>\`_`); return true; }
            if (!isFromMe && !(isGroup && await isSenderGroupAdmin(sock, jid, cleanSenderJid))) { await reply("🚫 Only group admins can change the contribution info."); return true; }
            c.info = subInput.toLowerCase() === 'clear' ? "" : subInput.slice(0, 300);
            saveDB();
            await reply(c.info ? `💰 Contribution info saved:\n${c.info}` : "💰 Contribution info cleared.");
            return true;
        }
        case 'resetpaid': case 'newcycle': {
            if (await needGroup()) return true;
            const c = getContribData(jid);
            const B = computeBatches(c);
            c.history.push({ cycle: c.cycle, paidCount: B.paidCount, completeBatches: B.list.filter(b => b.complete).length, subscribedBatches: B.list.filter(b => b.subscribed).length, closedAt: new Date().toISOString() });
            if (c.history.length > 24) c.history.shift();
            c.paid = {};
            c.batches = {};
            c.cycle = currentCycleLabel();
            saveDB();
            await reply(`🔄 New contribution cycle started: *${c.cycle}*\n(The previous cycle had ${B.paidCount} paid member${B.paidCount === 1 ? '' : 's'} across ${B.list.filter(b => b.complete).length} complete batch${B.list.filter(b => b.complete).length === 1 ? '' : 'es'}.) Everyone is back to unpaid - Batch 1 is open. Use \`!paid @user\` as payments come in.`);
            return true;
        }

        // ---------------------------------------------------------- RULES
        case 'rules': {
            const g = getGroupData(jid);
            await reply(g.rules || `📜 *Group Rules*\n\n1. 🎵 Keep it music! Share songs, playlists, artists & Spotify tips.\n2. 🚫 No spam or flooding (same message or media repeated).\n3. 🔗 No foreign WhatsApp group links or random promo links.\n4. 🤝 Respect everyone - tastes differ, no insults.\n5. ⚠️ 3 warnings = removal from the group.`);
            return true;
        }
        case 'setrules': {
            if (!subInput) { await reply("Usage: `!setrules <your rules text>` (or `!setrules reset`)"); return true; }
            const g = getGroupData(jid);
            g.rules = subInput.toLowerCase() === 'reset' ? "" : subInput;
            saveDB();
            await reply(g.rules ? "📜 Group rules updated ✅" : "📜 Rules reset to the default ✅");
            return true;
        }

        // ---------------------------------------------------------- MODERATION (admins / owner)
        case 'warn': {
            if (await needGroup()) return true;
            const targetJid = resolveTargetJid(contextInfo, subInput);
            if (!targetJid) { await reply("Usage: `!warn @user [reason]` or reply to their message with `!warn`"); return true; }
            if (!(await protectedTarget(targetJid))) return true;
            const reason = subInput.replace(/@\d+/g, '').trim() || "Rule violation";
            await issueStrike(sock, jid, targetJid, reason);
            return true;
        }
        case 'warnings': {
            if (await needGroup()) return true;
            const targetJid = resolveTargetJid(contextInfo, subInput) || cleanSenderJid;
            const p = extractPhoneNumber(targetJid);
            const n = getGroupData(jid).warnings[p] || 0;
            await sock.sendMessage(jid, { text: `⚠️ @${p} has ${n}/3 warnings.`, mentions: [targetJid] }, quotedOpts);
            return true;
        }
        case 'resetwarn': case 'clearwarn': {
            if (await needGroup()) return true;
            const targetJid = resolveTargetJid(contextInfo, subInput);
            if (!targetJid) { await reply("Usage: `!resetwarn @user` or reply to their message"); return true; }
            const p = extractPhoneNumber(targetJid);
            delete getGroupData(jid).warnings[p];
            saveDB();
            await sock.sendMessage(jid, { text: `✅ Warnings cleared for @${p}.`, mentions: [targetJid] }, quotedOpts);
            return true;
        }
        case 'kick': case 'remove': {
            if (await needGroup()) return true;
            const targetJid = resolveTargetJid(contextInfo, subInput);
            if (!targetJid) { await reply("Usage: `!kick @user` or reply to their message with `!kick`"); return true; }
            const p = await protectedTarget(targetJid);
            if (!p) return true;
            try {
                const r = await sock.groupParticipantsUpdate(jid, [p.id], 'remove');
                const st = String((r && r[0] && r[0].status) || '200');
                if (st !== '200') throw new Error(`status ${st} - is the bot a group admin?`);
                await sock.sendMessage(jid, { text: `👢 @${extractPhoneNumber(p.id)} was removed from the group.`, mentions: [p.id] });
            } catch (e) { await reply(`⚠️ Couldn't remove them: ${e.message || e}`); }
            return true;
        }
        case 'mute': case 'unmute': {
            if (await needGroup()) return true;
            const targetJid = resolveTargetJid(contextInfo, subInput);
            if (!targetJid) { await reply(`Usage: \`!${command} @user\` or reply to their message`); return true; }
            const g = getGroupData(jid);
            const p = extractPhoneNumber(targetJid);
            if (command === 'mute') {
                if (!(await protectedTarget(targetJid))) return true;
                if (!g.muted.includes(p)) g.muted.push(p);
                saveDB();
                await sock.sendMessage(jid, { text: `🔇 @${p} is muted - their messages will be deleted until an admin uses !unmute. (I need to be a group admin for this.)`, mentions: [targetJid] });
            } else {
                g.muted = g.muted.filter(x => x !== p);
                saveDB();
                await sock.sendMessage(jid, { text: `🔊 @${p} can chat again.`, mentions: [targetJid] });
            }
            return true;
        }
        case 'lock': case 'unlock': {
            if (await needGroup()) return true;
            try {
                await sock.groupSettingUpdate(jid, command === 'lock' ? 'announcement' : 'not_announcement');
                await reply(command === 'lock' ? "🔒 Group locked - only admins can send messages." : "🔓 Group unlocked - everyone can chat again.");
            } catch (e) { await reply(`⚠️ Couldn't change the group setting: ${e.message || e} (I need to be a group admin).`); }
            return true;
        }
        case 'banword': case 'bannedword': {
            const parts = subInput.split(/\s+/);
            const sub = (parts[0] || '').toLowerCase();
            const word = parts.slice(1).join(' ').trim().toLowerCase();
            if (sub === 'list') {
                await reply(db.settings.bannedWords.length ? `🚫 *Banned words (${db.settings.bannedWords.length}):*\n${db.settings.bannedWords.join(', ')}` : "🚫 No banned words set.");
                return true;
            }
            if ((sub === 'add' || sub === 'remove') && word) {
                if (sub === 'add') { if (!db.settings.bannedWords.includes(word)) db.settings.bannedWords.push(word); }
                else db.settings.bannedWords = db.settings.bannedWords.filter(w => w !== word);
                saveDB();
                await reply(sub === 'add' ? "🚫 Word added to the banned list ✅" : "✅ Word removed from the banned list.");
                return true;
            }
            await reply("Usage: `!banword add <word>` | `!banword remove <word>` | `!banword list`\n_Messages with banned words are deleted + the sender gets a warning._");
            return true;
        }
        case 'antilink': {
            const sub = subInput.toLowerCase();
            if (sub === 'on' || sub === 'normal') { db.settings.antilinkActive = true; db.settings.antilinkMode = 'whatsapp'; saveDB(); await reply("🔗 *Antilink:* ON ✅ (foreign WhatsApp group links are deleted + warned)"); return true; }
            if (sub === 'strict') { db.settings.antilinkActive = true; db.settings.antilinkMode = 'strict'; saveDB(); await reply("🔗 *Antilink:* STRICT ✅ (only music links - Spotify, YouTube, Apple Music, SoundCloud, Audiomack etc. - are allowed; every other link is deleted + warned)"); return true; }
            if (sub === 'off') { db.settings.antilinkActive = false; saveDB(); await reply("🔗 *Antilink:* OFF ❌"); return true; }
            const label = !db.settings.antilinkActive ? "OFF ❌" : db.settings.antilinkMode === 'strict' ? "STRICT (music links only) 🎵" : "ON (foreign WhatsApp group links) ✅";
            await reply(`🔗 Antilink: *${label}*\n\n_Usage: \`!antilink on\` | \`!antilink strict\` | \`!antilink off\`_`);
            return true;
        }
        case 'linkcards': {
            const sub = subInput.toLowerCase();
            if (sub === 'on' || sub === 'off') { db.settings.spotifyLinkCards = sub === 'on'; saveDB(); await reply(`🎧 *Spotify link cards:* ${sub === 'on' ? 'ON ✅ (I reply with a song/album/artist card when a Spotify link is posted)' : 'OFF ❌'}`); return true; }
            await reply(`🎧 Spotify link cards: *${db.settings.spotifyLinkCards ? 'ON ✅' : 'OFF ❌'}*\n\n_Usage: \`!linkcards on\` | \`!linkcards off\`_`);
            return true;
        }
        case 'welcome': {
            const sub = subInput.toLowerCase();
            if (sub === 'on' || sub === 'off') { db.settings.welcomeActive = sub === 'on'; saveDB(); await reply(`👋 *Welcome message:* ${sub === 'on' ? 'ON ✅' : 'OFF ❌'}`); return true; }
            if (sub === 'reset') { db.settings.welcomeMessage = ""; saveDB(); await reply("👋 Welcome message reset to the default music welcome ✅"); return true; }
            if (sub.startsWith('set ')) {
                db.settings.welcomeMessage = subInput.slice(4).trim();
                db.settings.welcomeActive = true;
                saveDB();
                await reply("👋 Custom welcome message saved & turned on ✅\n_Use {user} for the new member, {group} for the exact group name, {count} for the member number._\nSend `!welcome test` to preview it.");
                return true;
            }
            if (sub === 'test') {
                if (await needGroup()) return true;
                const name = await getGroupName(sock, jid);
                let count = 0; try { count = (await getGroupMeta(sock, jid)).participants.length; } catch (e) {}
                await sendGroupGreeting(sock, jid, buildWelcomeText(name || "the group", count, `@${senderPhone}`), [cleanSenderJid], true);
                return true;
            }
            await reply(`👋 Welcome message: *${db.settings.welcomeActive ? 'ON ✅' : 'OFF ❌'}* (${db.settings.welcomeMessage ? 'custom text' : 'default music welcome'})\nIt always uses the group's exact current name.\n\n_Usage: \`!welcome on\` | \`!welcome off\` | \`!welcome set <text>\` | \`!welcome reset\` | \`!welcome test\`_\n_Placeholders: {user} {group} {count}_`);
            return true;
        }
        case 'goodbye': {
            const sub = subInput.toLowerCase();
            if (sub === 'on' || sub === 'off') { db.settings.goodbyeActive = sub === 'on'; saveDB(); await reply(`👋 *Goodbye message:* ${sub === 'on' ? 'ON ✅' : 'OFF ❌'}`); return true; }
            await reply(`👋 Goodbye message: *${db.settings.goodbyeActive ? 'ON ✅' : 'OFF ❌'}*\n\n_Usage: \`!goodbye on\` | \`!goodbye off\`_`);
            return true;
        }
    }
    return false;
}

// ===== MAIN ENGINE =====
async function startSuperiorAssistant() {
    if (GROQ_API_KEY.startsWith('PASTE_')) console.warn('\x1b[33m[Setup] GROQ_API_KEY is not set - AI replies, voice transcription and image reading will not work until you add it at the top of index.js.\x1b[0m');
    if (!spotifyConfigured()) console.warn('\x1b[33m[Setup] Spotify keys are not set - Spotify commands will only give search links until you add SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET at the top of index.js.\x1b[0m');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    });
    if (!sock.authState.creds.registered) {
        console.log("\n==================================");
        console.log(" SUPERIOR AI ASSISTANT SETUP ");
        console.log("==================================");
        const inputNumber = readline.question('Enter YOUR phone number with country code (e.g. 2349135615687): ');
        const cleanNumber = inputNumber.replace(/[^0-9]/g, "");
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                console.log("\n==================================");
                console.log(`YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m`);
                console.log("==================================\n");
            } catch (err) {
                console.error('Failed to generate pairing code:', err);
            }
        }, 3000);
    }
    sock.ev.on('creds.update', saveCreds);
    // ===== WELCOME / GOODBYE (uses the group's exact current name) =====
    sock.ev.on('group-participants.update', (ev) => {
        handleGroupParticipantsUpdate(sock, ev).catch(e => console.error('[Welcome Error]', e.message || e));
    });
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startSuperiorAssistant();
        } else if (connection === 'open') {
            console.log('\x1b[36m%s\x1b[0m', '✅ WhatsApp Assistant Active!\n');
            (async () => {
                try {
                    await sock.updateStatusPrivacy('all');
                    console.log('[Privacy] About/status visibility set to: everyone');
                } catch (e) {
                    console.error('[Privacy] Failed to set About visibility to everyone:', e.message);
                }
            })();
            startPresencePatternLoop(sock);
            maybeUpdateDailyBio(sock);
            setInterval(() => maybeUpdateDailyBio(sock), 30 * 60 * 1000);
        }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            const msgId = msg.key.id;
            const jid = msg.key.remoteJid;
            if (!msg.message || jid === 'status@broadcast') continue;
            const isGroup = jid.endsWith('@g.us');
            const rawSender = isGroup ? (msg.key.participant || jid) : jid;
            const pushName = msg.pushName || "Unknown";
            const time = ngLocaleTimeString(new Date(msg.messageTimestamp * 1000));
            const cleanSenderJid = normalizeJid(rawSender);
            const botJid = sock.user?.id || "";
            const botPhone = extractPhoneNumber(botJid);
            const rawSockName = sock.user?.name || "";
            let defaultOwnerName = "Boss";
            if (rawSockName && rawSockName.toLowerCase() !== "unknown" && !rawSockName.toLowerCase().includes("assistant")) {
                defaultOwnerName = rawSockName;
            }
            const ownerName = db.settings.customOwnerName || defaultOwnerName;
            const ownerPhoneNumber = db.settings.customOwnerNumber || botPhone;
            const isFromMe = msg.key.fromMe;
            // ===== BLACKLIST ENFORCEMENT ENGINE =====
            if (!isFromMe && db.settings.blacklist && db.settings.blacklist.includes(extractPhoneNumber(cleanSenderJid))) {
                continue;
            }
            updateContactMemory(cleanSenderJid, pushName, isGroup ? jid : null, rawSockName || defaultOwnerName);
            const unwrapMessage = deepUnwrapMessage(msg.message);
            let text = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || msg.message?.imageMessage?.caption
                || msg.message?.videoMessage?.caption
                || msg.message?.ephemeralMessage?.message?.conversation
                || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text
                || unwrapMessage?.conversation
                || unwrapMessage?.extendedTextMessage?.text
                || "";
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
                || msg.message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo
                || msg.message?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo
                || unwrapMessage?.extendedTextMessage?.contextInfo
                || msg.message?.documentMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || msg.message?.audioMessage?.contextInfo
                || msg.message?.stickerMessage?.contextInfo
                || unwrapMessage?.audioMessage?.contextInfo
                || unwrapMessage?.imageMessage?.contextInfo
                || unwrapMessage?.videoMessage?.contextInfo
                || unwrapMessage?.stickerMessage?.contextInfo
                || {};
            // What the person actually TYPED (before the "[Replying to: ...]" prefix below is added).
            // Commands, antilink, spam and banned-word checks all use this so replies work correctly.
            const rawOwnText = text;
            if (contextInfo && contextInfo.quotedMessage) {
                const quotedUnwrapped = contextInfo.quotedMessage.viewOnceMessage?.message
                    || contextInfo.quotedMessage.viewOnceMessageV2?.message
                    || contextInfo.quotedMessage;
                const quotedText = quotedUnwrapped.conversation
                    || quotedUnwrapped.extendedTextMessage?.text
                    || quotedUnwrapped.imageMessage?.caption
                    || "";
                if (quotedText) {
                    text = `[Replying to: "${quotedText}"] ${text}`;
                }
            }
            const lowerText = text.toLowerCase().trim();
            // ===== MUSIC GROUP MODERATION (antilink / banned words / text spam / mute) =====
            // Runs before commands and AI replies. Admins and the owner are never moderated.
            if (isGroup && !isFromMe && rawOwnText) {
                try {
                    if (await runGroupModeration(sock, msg, jid, rawOwnText, cleanSenderJid)) continue;
                } catch (modErr) {
                    console.error('Group moderation error:', modErr.message || modErr);
                }
            }
            // ===== OWNER / PUBLIC COMMAND CONTROLS (Accepts ! and .) =====
            // FIX (public mode): this used to require isFromMe unconditionally, so
            // only the owner could ever use bot commands. Now, when the owner has
            // switched the bot to !public, anyone can invoke commands too - except
            // the PRIVILEGED_OWNER_ONLY_COMMANDS list above, which always stays
            // owner-only regardless of public/private mode, for safety.
            if ((isFromMe || db.settings.publicMode) && /^[!.][a-zA-Z]/.test(rawOwnText)) {
                const args = rawOwnText.slice(1).trim().split(' ');
                let command = args[0].toLowerCase();
                let subInput = args.slice(1).join(' ').trim();
                if (command === 'owner' && args[1] && args[1].toLowerCase() === 'number') {
                    command = 'ownernumber';
                    subInput = args.slice(2).join(' ').trim();
                }
                if (!isFromMe && PRIVILEGED_OWNER_ONLY_COMMANDS.includes(command)) {
                    await sock.sendMessage(jid, { text: "🚫 Only the owner can use this command." });
                    continue;
                }
                if (!isFromMe && ADMIN_ONLY_COMMANDS.includes(command)) {
                    const allowedAdmin = isGroup && await isSenderGroupAdmin(sock, jid, cleanSenderJid);
                    if (!allowedAdmin) {
                        await sock.sendMessage(jid, { text: isGroup ? "🚫 Only group admins (or the owner) can use this command." : "🚫 This command only works inside a group, for group admins." });
                        continue;
                    }
                }
                let commandHandled = false;
                if (command === 'bot') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.botActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* ACTIVATED ✅" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.botActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* DEACTIVATED ❌" });
                    }
                    const statusText = db.settings.botActive ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `🤖 Bot Status: *${statusText}*\n\n_Usage: \`!bot on\` | \`!bot off\`_` });
                }
                if (command === 'public' || command === 'private') {
                    commandHandled = true;
                    db.settings.publicMode = (command === 'public');
                    saveDB();
                    return sock.sendMessage(jid, { text: db.settings.publicMode
                        ? `🌍 *Bot set to PUBLIC.* Anyone can now use bot commands.\n_A few owner-only commands stay locked for safety: !public, !private, !wipe, !owner, !ownernumber, !blacklist._`
                        : "🔒 *Bot set to PRIVATE.* Only the owner can use bot commands now." });
                }
                if (command === 'voice') {
                    commandHandled = true;
                    const voiceSub = subInput.toLowerCase().trim();
                    if (voiceSub === 'on') {
                        db.settings.voiceMode = "on";
                        saveDB();
                        return sock.sendMessage(jid, { text: "🎙 *Voice Mode:* ON ✅ (every reply is sent as a Voice Note)" });
                    }
                    if (voiceSub === 'off') {
                        db.settings.voiceMode = "off";
                        saveDB();
                        return sock.sendMessage(jid, { text: "💬 *Voice Mode:* OFF ❌ (every reply is sent as Text)" });
                    }
                    if (voiceSub === 'auto') {
                        db.settings.voiceMode = "auto";
                        saveDB();
                        return sock.sendMessage(jid, { text: `🔀 *Voice Mode:* AUTO ✅ (voice note in = voice back. Text in = voice about ${db.settings.voiceChance ?? 30}% of the time, only for short replies without links/code/lists. Change it with !voicechance <0-100>)` });
                    }
                    const vStatusLabel = db.settings.voiceMode === 'on' ? 'ON (always voice) 🎙' : db.settings.voiceMode === 'auto' ? 'AUTO (voice note in = voice back, text in = sometimes voice) 🔀' : 'OFF (always text) 💬';
                    return sock.sendMessage(jid, { text: `🎙 Voice Mode: *${vStatusLabel}*\n\n_Usage: \`!voice on\` | \`!voice off\` | \`!voice auto\`_` });
                }
                if (command === 'voicechance') {
                    commandHandled = true;
                    const n = parseInt(String(subInput).replace('%', '').trim(), 10);
                    if (isNaN(n) || n < 0 || n > 100) {
                        return sock.sendMessage(jid, { text: `🎲 Voice chance (Voice Mode AUTO): *${db.settings.voiceChance ?? 30}%*\n\n_Usage: \`!voicechance <0-100>\` e.g. \`!voicechance 30\`_\n_When someone sends text, this is the chance a short reply (no links/code/lists) goes out as a voice note. Voice notes in always get voice back._` });
                    }
                    db.settings.voiceChance = n;
                    saveDB();
                    return sock.sendMessage(jid, { text: `🎲 *Voice chance set to ${n}%* ✅ (only applies in \`!voice auto\`)` });
                }
                if (command === 'groupchat') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.groupChatMode = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "👥 *Group Chat Mode:* ACTIVATED ✅ (AI will reply in groups only when tagged/replied to)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.groupChatMode = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "👥 *Group Chat Mode:* DEACTIVATED ❌ (AI will stay silent in all groups)" });
                    }
                    const gStatus = db.settings.groupChatMode ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `👥 Group Chat Mode: *${gStatus}*\n\n_Usage: \`!groupchat on\` | \`!groupchat off\`_` });
                }
                if (command === 'owner') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const newOwnerName = subInput.slice(4).trim();
                        db.settings.customOwnerName = newOwnerName;
                        saveDB();
                        return sock.sendMessage(jid, { text: `👑 *Owner Name Overwritten Successfully!*\nNew Owner Name: *${newOwnerName}*` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.customOwnerName = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "👑 *Custom Owner Name Cleared!* Reverted to fallback name." });
                    }
                    const activeOwner = db.settings.customOwnerName || defaultOwnerName;
                    return sock.sendMessage(jid, { text: `👑 *Current Owner Name:* ${activeOwner}\n\n_Usage: \`!owner set <new name>\`, \`!owner clear\`_\n_(To change the owner's number instead, use \`!owner number <value>\` or \`!ownernumber\`.)_` });
                }
                if (command === 'ownernumber') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'clear') {
                        db.settings.customOwnerNumber = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "📞 *Custom Owner Number Cleared!* Reverted to this WhatsApp account's own number." });
                    }
                    if (subLower.startsWith('set ')) {
                        const newOwnerNumber = subInput.slice(4).replace(/[^0-9]/g, "");
                        if (!newOwnerNumber) {
                            return sock.sendMessage(jid, { text: "⚠️ Usage: `!ownernumber set <number>` e.g. `!ownernumber set 2349135615687`" });
                        }
                        db.settings.customOwnerNumber = newOwnerNumber;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📞 *Owner Number Overwritten Successfully!*\nNew Owner Number: *+${newOwnerNumber}*` });
                    }
                    if (subInput.trim() !== '') {
                        const newOwnerNumber = subInput.replace(/[^0-9]/g, "");
                        if (!newOwnerNumber) {
                            return sock.sendMessage(jid, { text: "⚠️ Usage: `!ownernumber set <number>` or just `!ownernumber <number>` e.g. `!ownernumber 2349135615687`" });
                        }
                        db.settings.customOwnerNumber = newOwnerNumber;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📞 *Owner Number Overwritten Successfully!*\nNew Owner Number: *+${newOwnerNumber}*` });
                    }
                    const activeOwnerNumber = db.settings.customOwnerNumber || botPhone;
                    return sock.sendMessage(jid, { text: `📞 *Current Owner Number:* +${activeOwnerNumber}\n\n_Usage: \`!ownernumber <number>\`, \`!ownernumber set <number>\`, \`!ownernumber clear\`_` });
                }
                if (command === 'py') {
                    commandHandled = true;
                    if (!subInput) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!py <python code or command>`" });
                    }
                    try {
                        const pyResult = await runSystemCommand(`python3 -c "${subInput}"`);
                        await simulateHumanTyping(sock, jid, pyResult);
                        return sock.sendMessage(jid, { text: pyResult });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `🐍 Python Execution Error:\n${err}` });
                    }
                }
                if (command === 'lang' || command === 'language') {
                    commandHandled = true;
                    const sub = subInput.trim();
                    const subLower = sub.toLowerCase();
                    if (!sub || subLower === 'list') {
                        const listStr = Object.values(LANGUAGE_MAP).sort().join(', ');
                        return sock.sendMessage(jid, { text: `🌐 *AI Language Mode*\nCurrent: *${db.settings.aiLanguage}*\n\n*Available Languages:*\n${listStr}\n\n_Usage: \`!lang <language>\`, \`!lang reset\`_` });
                    }
                    if (subLower === 'reset' || subLower === 'default' || subLower === 'english') {
                        db.settings.aiLanguage = 'English';
                        saveDB();
                        return sock.sendMessage(jid, { text: "🌐 *AI Language reset to:* English ✅" });
                    }
                    const target = subLower.startsWith('set ') ? sub.slice(4).trim() : sub;
                    const matchKey = findClosestLanguage(target);
                    if (matchKey) {
                        db.settings.aiLanguage = LANGUAGE_MAP[matchKey];
                        saveDB();
                        return sock.sendMessage(jid, { text: `🌐 *AI Language switched to:* ${LANGUAGE_MAP[matchKey]} ✅\n_The assistant will now default to replying in ${LANGUAGE_MAP[matchKey]}._` });
                    } else {
                        const listStr = Object.values(LANGUAGE_MAP).sort().join(', ');
                        return sock.sendMessage(jid, { text: `❌ Couldn't recognize "*${target}*" as a supported language.\n\n*Available Languages:*\n${listStr}\n\n_Usage: \`!lang <language>\`, e.g. \`!lang yoruba\`_` });
                    }
                }
                if (command === 'hidetag') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const participants = metadata.participants.map(p => p.id);
                        const tagMessage = subInput || "Attention everyone!";
                        await sock.sendMessage(jid, {
                            text: tagMessage,
                            mentions: participants
                        });
                    } catch (err) {
                        console.error("Hidetag Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to execute hidetag." });
                    }
                    continue;
                }
                if (command === 'listonline') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const participants = metadata.participants.map(p => p.id);
                        let onlineJids = [];
                        for (const memberJid of participants) {
                            try {
                                await sock.presenceSubscribe(memberJid);
                                const pData = sock.presences?.[memberJid];
                                if (pData && (pData.lastKnownPresence === 'available' || pData.lastKnownPresence === 'composing' || pData.lastKnownPresence === 'recording')) {
                                    onlineJids.push(memberJid);
                                }
                            } catch (e) {}
                        }
                        if (onlineJids.length === 0 && db.groups[jid] && db.groups[jid].members) {
                            const now = new Date().getTime();
                            for (const memberJid of participants) {
                                const phone = extractPhoneNumber(memberJid);
                                const mRecord = db.groups[jid].members[phone];
                                if (mRecord && mRecord.lastActive) {
                                    const lastActiveTime = new Date(mRecord.lastActive).getTime();
                                    if (now - lastActiveTime < 600000) {
                                        onlineJids.push(memberJid);
                                    }
                                }
                            }
                        }
                        if (onlineJids.length === 0) {
                            return sock.sendMessage(jid, { text: "🟢 No active/online group members detected right now." });
                        }
                        let listText = `🟢 *Active / Online Group Members (${onlineJids.length}):*\n\n`;
                        onlineJids.forEach((memberJid, index) => {
                            const phone = extractPhoneNumber(memberJid);
                            listText += `${index + 1}. @${phone}\n`;
                        });
                        await sock.sendMessage(jid, {
                            text: listText,
                            mentions: onlineJids
                        });
                    } catch (err) {
                        console.error("Listonline Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to fetch online members." });
                    }
                    continue;
                }
                if (command === 'svcontact') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const groupName = metadata.subject || "Group_Contacts";
                        const participants = metadata.participants.map(p => p.id);
                        let vcfContent = "";
                        participants.forEach((pJid, idx) => {
                            const phone = extractPhoneNumber(pJid);
                            const contactName = `Member ${idx + 1} (${phone})`;
                            vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD\n`;
                        });
                        const vcfFileName = `Group_Contacts_${Date.now()}.vcf`;
                        const vcfFilePath = path.join(downloadDir, vcfFileName);
                        fs.writeFileSync(vcfFilePath, vcfContent);
                        await sock.sendMessage(jid, {
                            document: fs.readFileSync(vcfFilePath),
                            mimetype: 'text/vcard',
                            fileName: `${groupName}_Contacts.vcf`,
                            caption: `📇 *Group Contacts VCF Generated!*\nTotal Contacts: ${participants.length}\n_Click the file to save all contacts and instantly message them on WhatsApp._`
                        });
                        if (fs.existsSync(vcfFilePath)) fs.unlinkSync(vcfFilePath);
                    } catch (err) {
                        console.error("Svcontact Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to generate group VCF contacts file." });
                    }
                    continue;
                }
                if (command === 'memories') {
                    commandHandled = true;
                    let memoryList = "*🧠 BOT MEMORY VAULT (TRACKED CONTACTS)*\n\n";
                    const contacts = Object.keys(db.contacts);
                    if (contacts.length === 0) {
                        memoryList += "No contacts logged yet.";
                    } else {
                        contacts.forEach(phone => {
                            const c = db.contacts[phone];
                            memoryList += `👤 *${c.name}* (+${phone})\n`;
                            if (c.nickname) memoryList += `   🏷 Nickname: ${c.nickname}\n`;
                            if (c.notes) memoryList += `   📝 Owner Notes: ${c.notes}\n`;
                            memoryList += `   💗 Mood: ${c.mood || 'neutral'} | Bond: ${c.bondScore || 0}/10\n`;
                            memoryList += `   🕒 Last Active: ${ngLocaleTimeString(new Date(c.lastSeen))}\n\n`;
                        });
                    }
                    await simulateHumanTyping(sock, jid, memoryList);
                    return sock.sendMessage(jid, { text: memoryList });
                }
                if (command === 'remember') {
                    commandHandled = true;
                    const phoneMatch = subInput.match(/^(\d+)\s*/);
                    if (!phoneMatch) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <phone_number> <nickname> | <note>`\ne.g. `!remember 14692084400176 Chi Chi | Charlie's sister`" });
                    }
                    const phone = phoneMatch[1];
                    let remainder = subInput.slice(phoneMatch[0].length).trim();
                    let nickname = "";
                    let note = "";
                    if (remainder.includes('|')) {
                        const [nickPart, ...noteParts] = remainder.split('|');
                        nickname = nickPart.trim();
                        note = noteParts.join('|').trim();
                    } else {
                        note = remainder.trim();
                    }
                    if (!nickname && !note) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <phone_number> <nickname> | <note>`\ne.g. `!remember 14692084400176 Chi Chi | Charlie's sister`" });
                    }
                    if (!db.contacts[phone]) {
                        db.contacts[phone] = {
                            jid: `${phone}@s.whatsapp.net`,
                            name: nickname ? nickname : `User +${phone}`,
                            nickname: nickname,
                            firstSeen: new Date().toISOString(),
                            lastSeen: new Date().toISOString(),
                            notes: note,
                            mood: "neutral",
                            bondScore: 0,
                            lastAfkNotified: "",
                            history: []
                        };
                    } else {
                        if (nickname) {
                            db.contacts[phone].nickname = nickname;
                            if (db.contacts[phone].name.startsWith('User +')) {
                                db.contacts[phone].name = nickname;
                            }
                        }
                        if (note) db.contacts[phone].notes = note;
                    }
                    saveDB();
                    return sock.sendMessage(jid, { text: `✅ Saved for +${phone}:\n${nickname ? `Name/Nickname: "${nickname}"\n` : ""}${note ? `Note: "${note}"` : ""}` });
                }
                if (command === 'history') {
                    commandHandled = true;
                    const phone = subInput.replace(/[^0-9]/g, "");
                    if (!phone) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!history <phone_number>`" });
                    }
                    if (!db.contacts[phone]) {
                        return sock.sendMessage(jid, { text: `❌ Phone number +${phone} not found in memory.` });
                    }
                    const c = db.contacts[phone];
                    let historyOutput = `📜 *CHAT HISTORY FOR ${c.name.toUpperCase()} (+${phone})*\n\n`;
                    if (!c.history || c.history.length === 0) {
                        historyOutput += "No recent chat logs recorded.";
                    } else {
                        historyOutput += c.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
                    }
                    await simulateHumanTyping(sock, jid, historyOutput);
                    return sock.sendMessage(jid, { text: historyOutput });
                }
                if (command === 'wipe') {
                    commandHandled = true;
                    try {
                        db = { contacts: {}, groups: {}, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
                        saveDB();
                        return sock.sendMessage(jid, { text: "🧹 *Bot Memory Wiped Successfully!* All contacts, history and group music data (queues, scores, rules) have been reset." });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `❌ Wipe Error:\n${err}` });
                    }
                }
                if (command === 'status' || command === 'sys') {
                    commandHandled = true;
                    try {
                        const uptimeSecs = process.uptime();
                        const hours = Math.floor(uptimeSecs / 3600);
                        const mins = Math.floor((uptimeSecs % 3600) / 60);
                        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
                        const timeCtx = getTimeContext();
                        const sysInfo = `📊 *SYSTEM STATUS REPORT*\n⏱️ Uptime: ${hours}h ${mins}m\n💾 RAM Heap: ${memoryUsage.toFixed(2)} MB\n👥 Saved Contacts: ${Object.keys(db.contacts).length}\n🤖 Bot Active: ${db.settings.botActive ? 'YES ✅' : 'NO ❌'}\n🎙 Voice Mode: ${db.settings.voiceMode === 'on' ? 'ON (always voice) 🎙' : db.settings.voiceMode === 'auto' ? 'AUTO (voice note in = voice back, text in = sometimes voice) 🔀' : 'OFF (always text) 💬'}\n🌍 Access Mode: ${db.settings.publicMode ? 'PUBLIC (everyone can use commands) 🌍' : 'PRIVATE (owner only) 🔒'}\n👥 Group Chat Mode: ${db.settings.groupChatMode ? 'ON ✅' : 'OFF ❌'}\n🎧 Spotify API: ${spotifyConfigured() ? 'CONNECTED ✅' : 'NOT SET (links only) ⚠️'}\n👋 Welcome Message: ${db.settings.welcomeActive ? 'ON ✅' : 'OFF ❌'}\n🔗 Antilink: ${!db.settings.antilinkActive ? 'OFF ❌' : db.settings.antilinkMode === 'strict' ? 'STRICT (music links only) 🎵' : 'ON ✅'}\n🚫 Banned Words: ${db.settings.bannedWords.length}\n🌐 Language: ${db.settings.aiLanguage}\n👑 Owner Name: ${db.settings.customOwnerName || defaultOwnerName}\n📞 Owner Number: +${db.settings.customOwnerNumber || botPhone}\n💗 Assistant Mood Today: ${getAssistantMood()}\n🕒 Current Time (Nigeria): ${timeCtx.readable}\n📅 Full Date: ${timeCtx.dateStr}\n🪪 Last Bio Auto-Update: ${db.settings.lastBioUpdateDate || 'not yet'}\n🚫 Blacklisted Numbers: ${db.settings.blacklist.length}\n💤 AFK: ${db.settings.afkActive ? `ON ("${db.settings.afkReason}")` : 'OFF'}\n🎙 TTS Voice: ${db.settings.ttsVoice}\n🛡 Antispam (duplicate media + text): ${db.settings.antispamActive ? 'ON ✅' : 'OFF ❌'}`;
                        return sock.sendMessage(jid, { text: sysInfo });
                    } catch (e) {
                        return sock.sendMessage(jid, { text: "⚠️ Failed to fetch system status." });
                    }
                }
                if (command === 'vv') {
                    commandHandled = true;
                    const quotedId = contextInfo?.stanzaId;
                    if (!quotedId) {
                        return sock.sendMessage(jid, { text: "⚠️ Reply directly to a view-once photo, video, or voice note with `.vv` to unlock it." });
                    }
                    const savedMedia = messageStore.get(quotedId);
                    if (!savedMedia || !savedMedia.isMedia || !savedMedia.filePath || !fs.existsSync(savedMedia.filePath)) {
                        console.error(`[VV Error] No stored media found for stanzaId=${quotedId}. This usually means the media failed to download when it first arrived - check for a "[Media Download Error]" log around the time it was sent.`);
                        return sock.sendMessage(jid, { text: "❌ Couldn't find that view-once media - it may have expired, already been opened, or wasn't saved." });
                    }
                    try {
                        const buffer = fs.readFileSync(savedMedia.filePath);
                        if (savedMedia.mediaType === 'imageMessage') {
                            await sock.sendMessage(jid, { image: buffer, caption: "🔓 View-once photo unlocked" });
                        } else if (savedMedia.mediaType === 'videoMessage' || savedMedia.mediaType === 'ptvMessage') {
                            await sock.sendMessage(jid, { video: buffer, caption: "🔓 View-once video unlocked" });
                        } else if (savedMedia.mediaType === 'audioMessage') {
                            await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        } else {
                            await sock.sendMessage(jid, { document: buffer, fileName: 'unlocked_media', caption: "🔓 View-once media unlocked" });
                        }
                    } catch (err) {
                        console.error("VV Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to resend that view-once media." });
                    }
                    continue;
                }
                if (command === 'translate') {
                    commandHandled = true;
                    if (!subInput) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!translate <language> <text>` or reply to a text message with `!translate <language>`" });
                    }
                    const firstSpaceIdx = subInput.indexOf(' ');
                    let targetLangRaw = firstSpaceIdx === -1 ? subInput : subInput.slice(0, firstSpaceIdx);
                    let textToTranslate = firstSpaceIdx === -1 ? "" : subInput.slice(firstSpaceIdx + 1).trim();
                    if (!textToTranslate && contextInfo?.quotedMessage) {
                        const quotedUnwrapped = deepUnwrapMessage(contextInfo.quotedMessage);
                        textToTranslate = quotedUnwrapped.conversation || quotedUnwrapped.extendedTextMessage?.text || quotedUnwrapped.imageMessage?.caption || "";
                    }
                    if (!textToTranslate) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!translate <language> <text>` or reply to a text message with `!translate <language>`" });
                    }
                    const matchKey = findClosestLanguage(targetLangRaw);
                    const targetLangName = matchKey ? LANGUAGE_MAP[matchKey] : targetLangRaw;
                    try {
                        const res = await axios.post(
                            'https://api.groq.com/openai/v1/chat/completions',
                            {
                                model: 'openai/gpt-oss-120b',
                                messages: [
                                    { role: 'system', content: `You are a precise translator. Translate the user's text into ${targetLangName}. Output ONLY the translated text, nothing else - no quotes, no explanations, no labels.` },
                                    { role: 'user', content: textToTranslate }
                                ],
                                temperature: 0.3,
                                max_tokens: 500
                            },
                            { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
                        );
                        const translated = res.data?.choices?.[0]?.message?.content?.trim() || "";
                        if (!translated) throw new Error("Empty translation");
                        return sock.sendMessage(jid, { text: `🌐 *Translation (${targetLangName}):*\n${translated}` });
                    } catch (err) {
                        console.error("Translate Error:", err.response?.data || err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to translate that text." });
                    }
                }
                if (command === 'ttsvoice') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase().trim();
                    if (!subLower || subLower === 'list') {
                        return sock.sendMessage(jid, { text: `🎙 *TTS Voice*\nCurrent: *${db.settings.ttsVoice}* ${db.settings.ttsVoice === 'en-US-AndrewNeural' ? '(default = AUTO: picks the right voice for the language)' : ''}\n\n*Available Voices:*\n${AVAILABLE_TTS_VOICES.join(', ')}\n\n_Usage: \`!ttsvoice <voice>\`, \`!ttsvoice reset\`_\n_Note: if !lang is set to a language your voice can't speak, Voice Mode auto-switches to a matching voice for that reply. Igbo & Yoruba have no voice on any free engine yet, so those reply as text._` });
                    }
                    if (subLower === 'reset' || subLower === 'default') {
                        db.settings.ttsVoice = 'en-US-AndrewNeural';
                        saveDB();
                        return sock.sendMessage(jid, { text: "🎙 *TTS Voice reset to default:* en-US-AndrewNeural ✅" });
                    }
                    const matchedVoice = AVAILABLE_TTS_VOICES.find(v => v.toLowerCase() === subLower);
                    if (!matchedVoice) {
                        return sock.sendMessage(jid, { text: `❌ Unknown voice "*${subInput}*".\n\n*Available Voices:*\n${AVAILABLE_TTS_VOICES.join(', ')}` });
                    }
                    db.settings.ttsVoice = matchedVoice;
                    saveDB();
                    return sock.sendMessage(jid, { text: `🎙 *TTS Voice switched to:* ${matchedVoice} ✅\n_Try sending a message in Voice Mode to hear it._` });
                }
                if (command === 'poll') {
                    commandHandled = true;
                    if (!subInput.includes('|')) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!poll <question> | option1 | option2 | option3...`\ne.g. `!poll What should we eat? | Pizza | Suya | Jollof`" });
                    }
                    const parts = subInput.split('|').map(p => p.trim()).filter(p => p.length > 0);
                    const question = parts[0];
                    const options = parts.slice(1);
                    if (!question || options.length < 2) {
                        return sock.sendMessage(jid, { text: "⚠️ A poll needs a question and at least 2 options.\nUsage: `!poll <question> | option1 | option2 | option3...`" });
                    }
                    if (options.length > 12) {
                        return sock.sendMessage(jid, { text: "⚠️ WhatsApp polls support a maximum of 12 options." });
                    }
                    try {
                        await sock.sendMessage(jid, {
                            poll: {
                                name: question,
                                values: options,
                                selectableCount: 1
                            }
                        });
                    } catch (err) {
                        console.error("Poll Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to create that poll." });
                    }
                    continue;
                }
                if (command === 'blacklist') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'list') {
                        const list = db.settings.blacklist.length ? db.settings.blacklist.map(p => `+${p}`).join('\n') : 'No blacklisted numbers.';
                        return sock.sendMessage(jid, { text: `🚫 *Blacklisted Numbers:*\n${list}` });
                    }
                    if (subLower.startsWith('remove ')) {
                        const remPhone = subInput.slice(7).replace(/[^0-9]/g, "");
                        db.settings.blacklist = db.settings.blacklist.filter(p => p !== remPhone);
                        saveDB();
                        return sock.sendMessage(jid, { text: `✅ Removed +${remPhone} from blacklist.` });
                    }
                    let targetPhone = "";
                    const mentioned = contextInfo?.mentionedJid?.[0];
                    const quotedParticipant = contextInfo?.participant;
                    if (mentioned) {
                        targetPhone = extractPhoneNumber(mentioned);
                    } else if (quotedParticipant) {
                        targetPhone = extractPhoneNumber(quotedParticipant);
                    } else if (!isGroup && subInput.trim()) {
                        targetPhone = subInput.replace(/[^0-9]/g, "");
                    }
                    if (!targetPhone) {
                        return sock.sendMessage(jid, { text: isGroup
                            ? "⚠️ Usage: @mention someone or reply to their message with `!blacklist`."
                            : "⚠️ Usage: `!blacklist <number>` e.g. `!blacklist 2349135615687`\n_Other: `!blacklist list`, `!blacklist remove <number>`_" });
                    }
                    if (!db.settings.blacklist.includes(targetPhone)) {
                        db.settings.blacklist.push(targetPhone);
                        saveDB();
                    }
                    return sock.sendMessage(jid, { text: `🚫 *+${targetPhone} has been blacklisted.* The assistant will now fully ignore this number.` });
                }
                if (command === 'afk') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'clear' || subLower === 'off') {
                        db.settings.afkActive = false;
                        db.settings.afkReason = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "✅ *AFK status cleared.* Welcome back!" });
                    }
                    db.settings.afkActive = true;
                    db.settings.afkReason = subInput.trim() || "no reason given";
                    db.settings.afkSince = new Date().toISOString();
                    saveDB();
                    return sock.sendMessage(jid, { text: `💤 *AFK Mode Activated*\nReason: "${db.settings.afkReason}"\n_The assistant will let people know you're away when relevant. Use \`!afk clear\` when you're back._` });
                }
                if (command === 'antispam') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.antispamActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🛡 *Duplicate Media Antispam:* ACTIVATED ✅ (duplicate stickers/photos/videos, duplicate texts and message flooding in groups get deleted, warned, then removed after 3 strikes)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.antispamActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🛡 *Duplicate Media Antispam:* DEACTIVATED ❌" });
                    }
                    const aStatus = db.settings.antispamActive ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `🛡 Antispam (duplicate media + text): *${aStatus}*\n\n_Usage: \`!antispam on\` | \`!antispam off\`_` });
                }
                if (command === 'steal') {
                    commandHandled = true;
                    const quoted = contextInfo?.quotedMessage;
                    if (!quoted) {
                        return sock.sendMessage(jid, { text: "⚠️ Reply to a sticker, image, or video with `!steal` to grab it." });
                    }
                    const quotedUnwrapped = deepUnwrapMessage(quoted);
                    const stealType = quotedUnwrapped.stickerMessage ? 'sticker'
                        : quotedUnwrapped.imageMessage ? 'image'
                        : (quotedUnwrapped.videoMessage ? 'video' : null);
                    if (!stealType) {
                        return sock.sendMessage(jid, { text: "⚠️ That's not a sticker, image, or video I can steal." });
                    }
                    let tempInPath = null;
                    let tempOutPath = null;
                    try {
                        const stream = await downloadContentFromMessage(quotedUnwrapped[`${stealType}Message`], stealType);
                        let bufferChunks = [];
                        for await (const chunk of stream) bufferChunks.push(chunk);
                        const mediaBuffer = Buffer.concat(bufferChunks);
                        let finalStickerBuffer;
                        if (stealType === 'sticker') {
                            finalStickerBuffer = mediaBuffer;
                        } else {
                            const inExt = stealType === 'video' ? 'mp4' : 'jpg';
                            tempInPath = path.join(downloadDir, `steal_in_${Date.now()}.${inExt}`);
                            tempOutPath = path.join(downloadDir, `steal_out_${Date.now()}.webp`);
                            fs.writeFileSync(tempInPath, mediaBuffer);
                            await runSystemCommand(`ffmpeg -i "${tempInPath}" -vcodec libwebp -filter:v "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white@0.0" -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset default -an -vsync 0 "${tempOutPath}" -y`);
                            finalStickerBuffer = fs.readFileSync(tempOutPath);
                        }
                        const taggedBuffer = await writeExifToWebp(finalStickerBuffer, BOT_NAME, ownerName);
                        await sock.sendMessage(jid, { sticker: taggedBuffer });
                    } catch (err) {
                        console.error("Steal Sticker Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to steal that sticker." });
                    } finally {
                        if (tempInPath && fs.existsSync(tempInPath)) fs.unlinkSync(tempInPath);
                        if (tempOutPath && fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
                    }
                    continue;
                }
                if (!commandHandled) {
                    const musicHandled = await handleMusicCommands({
                        sock, jid, isGroup, isFromMe, command, subInput, msg, contextInfo,
                        cleanSenderJid, pushName, ownerPhone: ownerPhoneNumber, botPhone
                    });
                    if (musicHandled) continue;
                    if (!isFromMe) continue; // ignore unknown !commands from members (other bots share groups)
                    return sock.sendMessage(jid, { text: `⚠️ *Unrecognized Command:* \`${command}\`\n\n${buildHelpMenu()}` });
                }
            }
            // ===== DELETED MESSAGE DETECTOR =====
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
                const deletedId = msg.message.protocolMessage.key.id;
                const savedMsg = messageStore.get(deletedId);
                console.log('\n\x1b[41m\x1b[37m 🚨 DELETED MESSAGE DETECTED! 🚨 \x1b[0m');
                console.log(`\x1b[31mFrom:\x1b[0m ${pushName} (+${extractPhoneNumber(cleanSenderJid)})`);
                console.log(`\x1b[31mTime:\x1b[0m ${time}`);
                if (savedMsg) {
                    if (savedMsg.isMedia) {
                        console.log('\x1b[33mSender tried to delete a media file!\x1b[0m');
                        console.log(`\x1b[32m📁 Saved copy location:\x1b[0m ${savedMsg.filePath}`);
                    } else {
                        console.log(`\x1b[33mDeleted Text:\x1b[0m "${savedMsg.text}"`);
                    }
                }
                console.log('-----------------------------------');
                continue;
            }
            // ===== AUTO-SAVE MEDIA & AUDIO TRANSCRIBER =====
            const mediaType = Object.keys(unwrapMessage).find(key =>
                ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'ptvMessage'].includes(key)
            );
            let downloadedBuffer = null;
            let mimeType = "image/jpeg";
            if (mediaType) {
                let ext = 'bin';
                if (mediaType === 'imageMessage') {
                    ext = 'jpg';
                    mimeType = unwrapMessage.imageMessage?.mimetype || "image/jpeg";
                } else if (mediaType === 'videoMessage' || mediaType === 'ptvMessage') ext = 'mp4';
                else if (mediaType === 'stickerMessage') ext = 'webp';
                else if (mediaType === 'audioMessage') ext = 'ogg';
                try {
                    // FIX (.vv always failing): the old code called downloadMediaMessage(msg, ...)
                    // with the RAW top-level message object. For view-once media the actual
                    // image/video/audio node lives nested inside viewOnceMessage(V2)/ephemeralMessage
                    // wrappers, and depending on the installed Baileys version's internal content-type
                    // detection, that nested media can get missed or mis-typed, causing the download to
                    // silently throw - which is exactly why .vv always reported "no stored media found"
                    // even on media that had never been opened yet. We now pull the ALREADY-unwrapped
                    // media node (unwrapMessage[mediaType], the same one used to detect mediaType above)
                    // and download it directly with downloadContentFromMessage - the same low-level,
                    // proven-working method the !steal command already uses successfully.
                    const mediaMessageObj = unwrapMessage[mediaType];
                    const shortType = mediaType === 'ptvMessage' ? 'video' : mediaType.replace('Message', '');
                    const stream = await downloadContentFromMessage(mediaMessageObj, shortType);
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    downloadedBuffer = Buffer.concat(chunks);
                    const filename = `WA_${Date.now()}.${ext}`;
                    const filePath = path.join(downloadDir, filename);
                    fs.writeFileSync(filePath, downloadedBuffer);
                    messageStore.set(msgId, { isMedia: true, filePath, mediaType });
                    if (mediaType === 'audioMessage' && downloadedBuffer) {
                        const transcribedSpeech = await transcribeAudio(downloadedBuffer);
                        if (transcribedSpeech) {
                            text = `[Voice Note Transcribed]: ${transcribedSpeech}`;
                        }
                    }
                } catch (e) {
                    console.error(`[Media Download Error] type=${mediaType} msgId=${msgId} from=${pushName} (+${extractPhoneNumber(cleanSenderJid)}):`, e.message || e);
                }
            }
            if (text) messageStore.set(msgId, { isMedia: false, text });
            // ===== DUPLICATE MEDIA ANTISPAM ENGINE =====
            if (db.settings.antispamActive && isGroup && !isFromMe && downloadedBuffer && ['imageMessage', 'videoMessage', 'stickerMessage'].includes(mediaType)) {
                try {
                    if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
                    if (!db.groups[jid].mediaSpam) db.groups[jid].mediaSpam = {};
                    if (!db.groups[jid].mediaWarnings) db.groups[jid].mediaWarnings = {};
                    const senderPhone = extractPhoneNumber(cleanSenderJid);
                    const contentHash = crypto.createHash('md5').update(downloadedBuffer).digest('hex');
                    const tracker = db.groups[jid].mediaSpam[senderPhone] || { hash: "", count: 0 };
                    if (tracker.hash === contentHash) {
                        tracker.count += 1;
                    } else {
                        tracker.hash = contentHash;
                        tracker.count = 1;
                    }
                    db.groups[jid].mediaSpam[senderPhone] = tracker;
                    if (tracker.count >= 3) {
                        await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
                        const currentWarnings = (db.groups[jid].mediaWarnings[senderPhone] || 0) + 1;
                        db.groups[jid].mediaWarnings[senderPhone] = currentWarnings;
                        db.groups[jid].mediaSpam[senderPhone] = { hash: "", count: 0 };
                        saveDB();
                        if (currentWarnings >= 3) {
                            try {
                                const metadata = await sock.groupMetadata(jid);
                                const targetParticipant = (metadata.participants || []).find(p => extractPhoneNumber(p.id) === senderPhone);
                                const targetJid = targetParticipant ? targetParticipant.id : cleanSenderJid;
                                await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
                                await sock.sendMessage(jid, {
                                    text: `🚫 @${senderPhone} was removed for repeatedly flooding duplicate media (3/3 warnings).`,
                                    mentions: [cleanSenderJid]
                                });
                                delete db.groups[jid].mediaWarnings[senderPhone];
                                saveDB();
                            } catch (kickErr) {
                                console.error("Media Spam Kick Error:", kickErr.message || kickErr);
                                await sock.sendMessage(jid, {
                                    text: `⚠️ Failed to remove @${senderPhone}. Error: ${kickErr.message || kickErr}`,
                                    mentions: [cleanSenderJid]
                                });
                            }
                        } else {
                            await sock.sendMessage(jid, {
                                text: `⚠️ Please stop flooding duplicate media @${senderPhone}! Warning ${currentWarnings}/3`,
                                mentions: [cleanSenderJid]
                            });
                        }
                    } else {
                        saveDB();
                    }
                } catch (err) {
                    console.error("Media Antispam Error:", err.message);
                }
            }
            // ===== SPOTIFY LINK CARDS + SHARE COUNTER =====
            if (isGroup && !isFromMe && rawOwnText) {
                try { await handleSpotifyLinks(sock, msg, jid, rawOwnText, cleanSenderJid); }
                catch (linkErr) { console.error('Spotify link card error:', linkErr.message || linkErr); }
            }
            // ===== BULLET-PROOF GROUP TAG & MENTION MATCHER =====
            let isBotTagged = false;
            if (isGroup) {
                const mentions = contextInfo.mentionedJid || [];
                const botJidClean = extractPhoneNumber(botJid);
                const botLidClean = sock.user?.lid ? extractPhoneNumber(sock.user.lid) : null;
                const isJidMentioned = mentions.some(m => {
                    const mClean = extractPhoneNumber(m);
                    return mClean === botJidClean
                        || (botLidClean && mClean === botLidClean)
                        || m === botJid
                        || (sock.user?.lid && m === sock.user.lid);
                });
                const mentionTokens = (text.match(/@(\d{5,})/g) || []).map(t => t.slice(1));
                const isTextMentioned = mentionTokens.some(tok => botJidClean.endsWith(tok) || tok.endsWith(botJidClean));
                const participantClean = contextInfo?.participant ? extractPhoneNumber(contextInfo.participant) : null;
                const isReplyToBot = !!(participantClean && (
                    participantClean === botJidClean
                    || (botLidClean && participantClean === botLidClean)
                ));
                isBotTagged = isJidMentioned || isTextMentioned || isReplyToBot;
                if (!isBotTagged) {
                    console.log(`[Group tag debug] Not tagged. replyTo=${contextInfo?.participant || 'none'} mediaType=${mediaType || 'text'} mentions=${JSON.stringify(mentions)} mentionTokens=${JSON.stringify(mentionTokens)} botJid=${botJid} botLid=${sock.user?.lid || 'n/a'} text="${text}"`);
                } else {
                    console.log(`[Group tag debug] TAGGED via ${isJidMentioned ? 'mention' : isTextMentioned ? 'text' : 'reply'}`);
                }
            }
            // ===== DIRECT MESSAGES & VERIFIED GROUP TAGS ENGINE =====
            if (!isGroup || (isGroup && isBotTagged && db.settings.groupChatMode)) {
                if (!db.settings.botActive) continue;
                // Look at whatever they replied to / tagged the bot on (photo, voice note, video...).
                const quotedMedia = (mediaType !== 'imageMessage') ? await loadQuotedMedia(contextInfo) : { image: null, audioText: '', note: '' };
                const hasQuotedMedia = !!(quotedMedia.image || quotedMedia.audioText || quotedMedia.note);
                let cleanedText = text;
                if (isGroup) {
                    cleanedText = text.replace(new RegExp(`@${extractPhoneNumber(botJid)}|@\\d+`, 'g'), '').trim();
                    if (!cleanedText) {
                        cleanedText = hasQuotedMedia
                            ? "[They tagged you on the message above without typing anything - they want you to explain / react to what it is]"
                            : "[They just tagged you with no additional message - greet them casually and ask what they need]";
                    }
                }
                if (quotedMedia.audioText) cleanedText = `[They are replying to a voice note that says: "${quotedMedia.audioText}"] ${cleanedText}`;
                if (quotedMedia.note) cleanedText = `[They are replying to ${quotedMedia.note}] ${cleanedText}`;
                let finalReply = "";
                const groupName = isGroup ? await getGroupName(sock, jid) : "";
                if (quotedMedia.image) {
                    const imgQuestion = cleanedText.startsWith('[They tagged you on the message above')
                        ? "Explain what this picture is and what's going on in it."
                        : cleanedText;
                    finalReply = await analyzeImageWithAI(quotedMedia.image.buffer, imgQuestion, ownerName, cleanSenderJid, pushName, quotedMedia.image.mime, rawSockName || defaultOwnerName, isGroup, isGroup ? jid : null, ownerPhoneNumber, groupName);
                } else if (unwrapMessage.imageMessage && downloadedBuffer) {
                    finalReply = await analyzeImageWithAI(downloadedBuffer, cleanedText, ownerName, cleanSenderJid, pushName, mimeType, rawSockName || defaultOwnerName, isGroup, isGroup ? jid : null, ownerPhoneNumber, groupName);
                } else if (/who is (your|the) owner|(who (owns|runs) this)/i.test(cleanedText.toLowerCase())) {
                    finalReply = `hey 🎧 this is ${ownerName}'s music assistant. what are we listening to?`;
                } else if (cleanedText) {
                    finalReply = await getAIReply(cleanSenderJid, cleanedText, isGroup, ownerName, ownerPhoneNumber, pushName, rawSockName || defaultOwnerName, isGroup ? jid : null, groupName);
                }
                if (finalReply) {
                    // ===== VOICE MODE TRI-STATE DECISION (on / off / auto) =====
                    // 'on'  = always reply with a voice note.
                    // 'off' = always reply with text.
                    // 'auto' = mirror however THIS specific person messaged the bot -
                    // if they sent a voice note, reply with a voice note back; if they
                    // sent text (or anything else), reply with text. mediaType here is
                    // the incoming message's own media type, already computed earlier
                    // this loop by the AUTO-SAVE MEDIA section.
                    let replyAsVoice = false;
                    if (db.settings.voiceMode === 'on') replyAsVoice = true;
                    else if (db.settings.voiceMode === 'auto') replyAsVoice = pickVoiceForAuto(finalReply, mediaType);
                    await simulateHumanTyping(sock, jid, finalReply, msg.key, replyAsVoice);
                    // FIX (voice mode DM-only): this used to hard-require !isGroup, so Voice Mode
                    // silently fell back to text the moment a group tag triggered a reply. Voice
                    // sending now follows the exact same reach as Text Mode - wherever the bot is
                    // allowed to reply (DM always, group only when tagged + Group Chat Mode is on),
                    // it also sends voice when called for, quoting the tagger in groups so it's
                    // clear who it's answering.
                    if (replyAsVoice) {
                        try {
                            const oggPath = await generateAudioResponse(finalReply);
                            await sock.sendMessage(
                                jid,
                                { audio: { url: oggPath }, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
                                isGroup ? { quoted: msg } : {}
                            );
                            if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
                            continue;
                        } catch (audioErr) {
                            // No robotic espeak fallback - if every natural-voice engine fails
                            // here, just fall through and send the reply as normal text instead.
                            console.error('[Voice Reply Error] Sending text instead:', audioErr.message || audioErr);
                        }
                    }
                    await sendHumanLikeMessage(sock, jid, finalReply, isGroup, msg);
                }
                continue;
            }
            // (Group moderation now runs earlier in this loop - see runGroupModeration.)
        }
    });
}
startSuperiorAssistant();
