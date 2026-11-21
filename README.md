## ⭐ Support the Project

If this bot is useful to you:

- ⭐ Star this repository
- 🍴 Fork it if you want your own copy
- 🐛 Report bugs or suggest features
- 🔗 Share it with other music group admins

Every bit of support helps.




# 🎧 Spotify & Music WhatsApp Group Bot

A WhatsApp bot for running a Spotify and music group, built with **Node.js, Baileys and Termux**.

It started as a general AI assistant and moderation bot, and now everything about it is about music. It looks up songs on Spotify, plays short previews, keeps a request queue, runs music trivia, welcomes new members by the group's exact name, moderates the chat, and keeps track of who has paid for a shared Spotify Premium family plan, batch by batch. The AI behind it (Groq) knows it lives in a music group, knows every command, and knows who has paid and who hasn't.

---

## 🧪 Test the Bot

To see it working before you set it up, message **[+YOUR_NUMBER](https://wa.me/YOUR_NUMBER)** or add it to a test group.

_(Replace the number above with your own test number.)_

---

## 🆘 Need Help?

If you're having issues with the script, message **[+2348137031314](https://wa.me/2348137031314)** on WhatsApp.

You can also email **[professorpasqua@gmail.com](mailto:professorpasqua@gmail.com)**.

---

## ✨ Features & Capabilities

### 🎵 Spotify Lookups

Search Spotify straight from WhatsApp. The bot answers with a clean card and the cover art.

- Song search with artist, album, release year, length and link
- Artist info with genres, latest releases and top search results
- Album info with the full tracklist
- Playlist search
- Fresh releases
- Paste any Spotify link into `!song` and get its card

If you haven't added Spotify keys, these commands still work, but they send a Spotify search link instead of a card.

---

### 🔗 Spotify Link Cards

When someone posts a Spotify link in the group, the bot can reply with a card for it: the song, album, artist or playlist, with its cover. It waits a few seconds between cards so it never floods the chat. Admins can turn it on or off. Every shared link is also counted for the sharers leaderboard.

---

### ▶️ Play Previews

`!play` sends a 30 second preview of a song as an audio message, together with the cover and the Spotify link for the full track.

Spotify doesn't let bots stream full songs, so the previews come from Apple's free iTunes Search API. No key is needed for this one.

---

### 🤖 AI Music Picks

Powered by Groq. Ask for songs by mood, by artist, by genre or by theme.

- `!mood` for a vibe or activity, like "late night drive"
- `!similar` for songs like another song or artist
- `!genre` for the essentials of a genre
- `!makeplaylist` for a 10 song playlist
- `!musicfact` for a short music fact

Every pick is looked up on Spotify, and the link is only added when the match really is that song by that artist.

---

### 🎤 Song Requests & Queue

Members can request songs and vote on them.

- Add songs to a shared queue (3 pending songs per person)
- Upvote the ones you want
- Turn the top songs into a native WhatsApp poll
- Admins play or announce the next song straight from the queue

---

### 🌟 Song of the Day

Admins can pin a Song of the Day. Anyone can pull it up with `!sotd`.

---

### 🧠 Music Trivia

The AI writes a multiple choice question. Members answer with A, B, C or D. The first correct answer wins a point, and each person gets one try per question. There is a trivia leaderboard, and a second leaderboard for the members who share the most Spotify links.

---

### 💚 Spotify Premium Family Plan Tracker

Built for groups that pool money for a Spotify Premium family plan and do it in batches.

The default setup is what a lot of Nigerian groups use: the family plan costs ₦2,500, everyone pays ₦500, so **5 people make one batch**. You can change the numbers with `!setplan`.

How it works:

- Admins mark people as paid by tagging them
- The first 5 people go into Batch 1, the next 5 into Batch 2, and so on
- When a batch hits 5, the bot announces that it's complete and ready to subscribe
- An admin marks the batch as subscribed after paying Spotify
- `!batch` shows every batch, who is in it, what's complete, what's still missing and how much money is needed
- `!unpaidlist` tags everyone who hasn't paid yet
- At the end of the month, `!resetpaid` starts a fresh cycle and keeps a short history

You can also force someone into a specific batch, for example `!paid @Tunde batch 2`.

The AI knows all of this. Ask it "is batch 1 complete?", "did I pay?", "who's next?" or "how many more people do we need?" and it answers from the real tracker data. It cannot mark anyone as paid, that stays with the admins.

---

### 👋 Welcome Message

When someone joins, the bot welcomes them in the chat, with the group picture if there is one. The message always uses the **exact current name of the group**, so if you rename the group, the welcome changes with it.

You can write your own welcome text with placeholders:

- `{user}` the new member
- `{group}` the exact group name
- `{count}` the member number

There is also an optional goodbye message, and `!welcome test` shows you a preview.

---

### 🧠 Smart Contact & Memory Vault

The bot keeps a memory for every person who talks to it.

- Tracks people who message the bot
- Stores WhatsApp push names
- Saves nicknames and owner notes
- Keeps recent conversation history
- Tracks mood and how familiar someone is
- Tracks group activity
- Never repeats what one person said to it when talking to someone else

---

### 🌐 Universal Language Mode

The bot can reply in a language you choose, or just mirror the language of the person writing to it.

Supported languages include:

- English
- Igbo
- Yoruba
- Hausa
- Nigerian Pidgin
- Swahili
- Zulu
- Amharic
- Russian
- Spanish
- French
- Portuguese
- German
- Italian
- Dutch
- Polish
- Greek
- Turkish
- Hindi
- Urdu
- Bengali
- Punjabi
- Tamil
- Arabic
- Hebrew
- Persian
- Chinese
- Japanese
- Korean
- Vietnamese
- Thai
- Indonesian
- Malay
- Tagalog

---

### 🤖 AI Conversation Engine

Powered by **Groq** for fast replies.

The bot talks like a music fan. It knows it's inside a Spotify group and uses the group's exact name. When a conversation drifts, it gently steers it back to music. Some things it will never do:

- It won't quote song lyrics, it talks about the song instead
- It won't invent release dates, chart positions or stream counts
- It won't claim it listened to something or saw anyone's Spotify account
- It won't help with cracked or modded Spotify apps or hacked accounts

It also knows every command in the script, who is allowed to use each one, and the current state of the family plan tracker, so it can answer "how do I do this?" questions correctly.

---

### 💗 Emotional Awareness

The bot reads the tone of a message and answers to match, instead of using one flat voice for everything.

Tones it recognizes:

- Happy
- Sad
- Angry
- Playful
- Sarcastic
- Stressed
- Excited
- Flirty
- Neutral

When it fits, a mood can come with a song idea.

---

### 🕒 Nigeria Time Awareness

The bot uses **Africa/Lagos (WAT, UTC+1)**. It knows the current time and date, the day of the week, and whether it's morning, afternoon, evening, late night or the weekend.

---

### 🟢 Human-Like Presence

The bot switches between online and offline now and then, so it doesn't look like it's awake 24 hours a day.

---

### ⌨️ Delayed & Human-Like Typing

Replies are not instant. The bot:

- Waits a random amount of time before answering
- Shows "typing..." before it sends
- Takes longer on long replies
- Sometimes pauses in the middle and carries on
- Shows "recording audio" when it's about to send a voice note

---

### ✍️ Natural Typo Simulation

Once in a while the bot sends a word with a small typo, waits a moment, then sends the correction.

---

### 💬 Natural Message Splitting

In private chats, a long reply is sometimes split into two messages with a short pause between them.

---

### 🎙️ Voice Notes

#### Voice transcription

Incoming voice notes are downloaded and transcribed with Groq Whisper.

Model:

`whisper-large-v3-turbo`

#### Voice replies

The bot can answer with voice notes using Microsoft Edge's free neural voices, with Google TTS as a backup. There are many voices across many languages, including US, UK, Irish, South African and Nigerian English. `!voice auto` makes it answer with a voice note whenever someone sends one, and only sometimes when they send text, and only if the reply is short.

---

### 👁️ AI Vision

The bot can look at pictures people send and talk about them.

It's tuned for music. If a picture is an album cover, a Spotify screenshot (now playing, a playlist, the queue, Wrapped), a concert photo or studio gear, it says so and reads the song, artist, album and playlist names exactly as shown. Vision runs on Groq vision models.

---

### 📅 Daily Automatic WhatsApp Bio

The bot updates its WhatsApp About once a day with the date and a short music themed message that mentions the owner.

---

### 🌐 Live Translation

Translate typed text, or a message you reply to, into any supported language.

---

### 📊 Polls

Create a native WhatsApp poll with a question and up to 12 options.

---

### 💤 AFK Mode

Tell the bot you're away, with an optional reason. It will mention it when it's relevant. Clear it when you're back.

---

## 👥 Group Features

### 🛡️ Antilink

Deletes WhatsApp group invite links from other groups, warns the sender, and removes them after 3 warnings. The group's own invite link is always allowed.

It has three settings:

- **on**: only links to other WhatsApp groups are removed
- **strict**: only music links are allowed (Spotify, YouTube, Apple Music, SoundCloud, Audiomack and similar), everything else is removed
- **off**

Admins are never moderated.

---

### 🛡️ Antispam

One switch, three kinds of spam:

- The same sticker, photo or video sent over and over
- The same text sent 3 times in a row
- Flooding, which is 6 messages within 8 seconds

The spam is deleted, the sender is warned, and they are removed after 3 strikes.

---

### 🚫 Banned Words

Admins can build a list of banned words. A message with one of them is deleted and the sender gets a warning. Only whole words match, so a harmless word that contains a banned one is left alone.

---

### ⚠️ Warnings, Kick, Mute & Lock

Admins can moderate by hand too:

- Warn someone, check or clear their warnings
- Remove a member
- Mute a member, so their messages are deleted until they're unmuted
- Lock the group so only admins can send messages, then unlock it
- Set the group rules, which anyone can read with `!rules`

You can tag the person or reply to their message. The bot refuses to warn, mute or remove admins or the owner.

The bot needs to be a group admin for deleting, removing, muting and locking.

---

### 👥 Group Chat Mode

Controls whether the AI talks in groups. When it's on, the bot answers when it is mentioned, tagged or replied to. When it's off, it stays quiet in groups.

---

### 📢 Hidetag

Tag everyone in the group without showing the individual @mentions.

**Example:**

```text
!hidetag Attention everyone!
```

### 🟢 Online Member Detection

**Command**

    !listonline

Lists members who currently look active in the group.

---

### 📇 Group Contact Export

**Command**

    !svcontact

Creates a `.vcf` file with the group's members that you can save to your phone.

---

### 🚨 Deleted Message Detection

The bot keeps a local store of messages and media. When someone deletes a message, the Termux console can show the sender, the time, the text, and where the media was saved.

---

### 💾 Automatic Media Handling

Images, videos, audio, stickers, documents and video notes can be downloaded locally. Voice notes can also be sent to the transcription system.

---

### 🥷 Sticker Stealer

Reply to a sticker, image or video and the bot turns it into a sticker with your own pack and author name.

---

## 🔐 Who Can Use What

Commands start with `!` or `.`

- **Private mode (default):** only you, the owner, can use commands
- **Public mode (`!public`):** members can use the everyday music commands. Admin commands still check that the sender is a real group admin, and owner commands stay with you
- Settings like `!bot`, `!voice`, `!lang`, `!groupchat`, `!ttsvoice` and `!afk`, and private things like `!py`, `!memories`, `!history`, `!remember`, `!vv` and `!wipe`, always stay with the owner, even in public mode

If you want members to use `!song`, `!request`, `!play` and the rest, send `!public` once.

---

## 🎧 Member Commands

### Spotify

    !song <name or Spotify link>
    !artist <name>
    !album <name>
    !playlist <query>
    !newreleases
    !lyrics <song>
    !play <song>

`!lyrics` only gives a Genius link. The bot never pastes lyrics.

**Example**

    !song essence wizkid
    !play calm down rema

---

### AI Picks

    !mood <vibe or activity>
    !similar <song or artist>
    !genre <genre>
    !makeplaylist <theme>
    !musicfact [topic]

**Examples**

    !mood late night drive
    !genre afrobeats
    !makeplaylist road trip

---

### Requests & Queue

    !request <song>
    !queue
    !vote <number>
    !sotd

---

### Trivia & Leaderboards

    !trivia [topic]
    !answer <A, B, C or D>
    !leaderboard
    !topsharers

---

### Group Info

    !rules
    !warnings [@user]
    !batch
    !paidlist
    !unpaidlist
    !contribution
    !menu

---

### Utility

    !translate <language> <text>
    !poll <question> | option1 | option2 | option3
    !listonline
    !status
    !steal

Reply to a sticker, image or video with `!steal` to turn it into a sticker.

---

## 🛡️ Admin Commands

Group admins and the owner can use these.

### Family Plan Tracker

    !paid @user1 @user2 [note] [batch N]
    !unpaid @user
    !subscribed <batch number>
    !subscribed <batch number> off
    !setplan <total price> <each person pays>
    !setcontribution <extra details>
    !resetpaid

**Examples**

    !paid @Tunde @Ada 500 November
    !paid @Chika batch 2
    !subscribed 1
    !setplan 2500 500

---

### Moderation

    !warn @user [reason]
    !resetwarn @user
    !kick @user
    !mute @user
    !unmute @user
    !lock
    !unlock
    !banword add <word>
    !banword remove <word>
    !banword list
    !setrules <text>
    !hidetag <message>
    !svcontact

---

### Automatic Protection

    !antilink on
    !antilink strict
    !antilink off
    !antispam on
    !antispam off
    !linkcards on
    !linkcards off

---

### Welcome & Goodbye

    !welcome on
    !welcome off
    !welcome set <your text>
    !welcome reset
    !welcome test
    !goodbye on
    !goodbye off

**Example**

    !welcome set Welcome {user} to {group}! You are member #{count} 🎧

---

### Queue Control

    !play
    !play <number>
    !next
    !removerequest <number>
    !clearqueue
    !votesongs
    !sotd <song>
    !sotd clear

`!play` with nothing after it plays the top voted song in the queue. `!next` announces the next song and plays its preview.

---

## 👑 Owner Command Suite

### 🤖 Bot Control

    !bot
    !bot on
    !bot off

---

### 🌍 Public or Private

    !public
    !private

---

### 🎙️ Voice Mode

    !voice on
    !voice off
    !voice auto
    !voicechance <0 to 100>

---

### 👥 Group Chat Mode

    !groupchat on
    !groupchat off

---

### 👑 Owner Name & Number

    !owner set
    !owner clear
    !ownernumber <number>
    !ownernumber clear

---

### 🐍 Python / Termux Bridge

    !py

Owner only. This runs code on your device, so it is never available to members.

---

### 🌐 Language

    !lang
    !lang list
    !lang reset

**Examples**

    !lang yoruba
    !lang pidgin
    !lang french

---

### 🎙️ TTS Voice

    !ttsvoice
    !ttsvoice list
    !ttsvoice reset

**Example**

    !ttsvoice en-NG-AbeoNeural

---

### 🚫 Blacklist

    !blacklist <number>
    !blacklist list
    !blacklist remove <number>

In groups, tag someone or reply to their message instead of typing the number.

---

### 💤 AFK

    !afk <reason>
    !afk clear

---

### 👁️ View Once Unlock

    !vv

Reply to a view-once photo, video or voice note with `!vv` to unlock it. Owner only.

---

## 🧠 Memory Vault

    !memories
    !remember <number> <nickname> | <note>
    !history <number>
    !wipe

**Example**

    !remember 2348012345678 John | John from the Tuesday batch

`!wipe` clears everything: contacts, history and group data like queues, scores, rules and the family plan tracker. All four commands are owner only.

---

## 📊 System Status

    !status
    !sys

Shows:

- Uptime and RAM usage
- Saved contacts
- Bot, voice and group chat status
- Current language
- Owner name and number
- The bot's mood and the Nigeria time
- Daily bio update status
- Blacklist count and AFK status
- Current TTS voice
- Whether Spotify is connected
- Welcome message, antilink, antispam and banned words status

---

## 📋 Command Reference

| Command | What it does | Who |
|---|---|---|
| `!song` | Song card with cover and link | Everyone |
| `!artist` | Artist info and latest releases | Everyone |
| `!album` | Album and tracklist | Everyone |
| `!playlist` | Search playlists | Everyone |
| `!newreleases` | Fresh albums | Everyone |
| `!lyrics` | Genius link for a song | Everyone |
| `!play` | 30 second preview of a song | Everyone |
| `!mood` | Songs for a mood or activity | Everyone |
| `!similar` | Songs like another song or artist | Everyone |
| `!genre` | Essentials of a genre | Everyone |
| `!makeplaylist` | 10 song playlist for a theme | Everyone |
| `!musicfact` | A short music fact | Everyone |
| `!request` | Add a song to the queue | Everyone |
| `!queue` | See the queue | Everyone |
| `!vote` | Upvote a queued song | Everyone |
| `!sotd` | See the Song of the Day | Everyone |
| `!trivia` | Start music trivia | Everyone |
| `!answer` | Answer the trivia question | Everyone |
| `!leaderboard` | Trivia leaderboard | Everyone |
| `!topsharers` | Who shares the most Spotify links | Everyone |
| `!rules` | Group rules | Everyone |
| `!warnings` | Check warnings | Everyone |
| `!batch` | Family plan status, batch by batch | Everyone |
| `!paidlist` | Same batch view of who has paid | Everyone |
| `!unpaidlist` | Who hasn't paid yet | Everyone |
| `!contribution` | Plan price and details | Everyone |
| `!menu` / `!help` | Full command list | Everyone |
| `!translate` | Translate text or a replied message | Everyone |
| `!poll` | Native WhatsApp poll | Everyone |
| `!listonline` | Detect active group members | Everyone |
| `!status` / `!sys` | System status | Everyone |
| `!steal` | Turn a sticker, image or video into a sticker | Everyone |
| `!paid` | Mark people as paid | Admin |
| `!unpaid` | Remove someone from the paid list | Admin |
| `!subscribed` | Mark a complete batch as subscribed | Admin |
| `!setplan` | Set the plan price and share | Admin |
| `!setcontribution` | Extra details on the lists | Admin |
| `!resetpaid` | Start a new month | Admin |
| `!warn` | Warn a member | Admin |
| `!resetwarn` | Clear a member's warnings | Admin |
| `!kick` | Remove a member | Admin |
| `!mute` / `!unmute` | Mute or unmute a member | Admin |
| `!lock` / `!unlock` | Lock or unlock the group | Admin |
| `!banword` | Manage banned words | Admin |
| `!setrules` | Set the group rules | Admin |
| `!antilink` | Antilink on, strict or off | Admin |
| `!antispam` | Antispam on or off | Admin |
| `!linkcards` | Spotify link cards on or off | Admin |
| `!welcome` | Welcome message settings | Admin |
| `!goodbye` | Goodbye message | Admin |
| `!next` | Announce and play the next queued song | Admin |
| `!removerequest` | Remove a song from the queue | Admin |
| `!clearqueue` | Empty the queue | Admin |
| `!votesongs` | Turn the queue into a poll | Admin |
| `!hidetag` | Mention all group members | Admin |
| `!svcontact` | Export group contacts | Admin |
| `!bot` | Turn AI auto-replies on or off | Owner |
| `!public` / `!private` | Let members use commands or not | Owner |
| `!voice` | Voice mode on, off or auto | Owner |
| `!voicechance` | How often it answers with voice | Owner |
| `!ttsvoice` | Choose the neural voice | Owner |
| `!groupchat` | AI in groups on or off | Owner |
| `!lang` | Change the language | Owner |
| `!owner` | Set the owner name | Owner |
| `!ownernumber` | Set the owner number | Owner |
| `!afk` | Set or clear AFK | Owner |
| `!blacklist` | Block a number | Owner |
| `!vv` | Unlock view-once media | Owner |
| `!py` | Run Python through Termux | Owner |
| `!memories` | View the memory vault | Owner |
| `!remember` | Save info about a contact | Owner |
| `!history` | View a contact's history | Owner |
| `!wipe` | Clear all stored data | Owner |

---

## ⚙️ Installation

### 1. Install Termux Dependencies

Update Termux first.

    pkg update && pkg upgrade -y

Then install what the bot needs.

    pkg install nodejs git python ffmpeg zip -y

`ffmpeg` is needed for voice notes and stickers. `python` is only needed if you want to use `!py`.

---

### 2. Enter the Project Folder

    cd ~/spotify-bot

---

### 3. Install the Node.js Packages

    npm install

If you don't have a `package.json` yet, install the packages directly:

    npm install @whiskeysockets/baileys readline-sync axios pino form-data node-webpmux ws

---

## 🔑 API Configuration

The bot uses three external services.

| Service | Used for | Key needed |
|---|---|---|
| Groq | AI chat, voice transcription, image reading, AI music picks, trivia | Yes |
| Spotify Web API | Song, artist, album and playlist cards, link cards | Yes (free) |
| iTunes Search API | The 30 second `!play` previews | No |

Put your keys at the top of `index.js`:

    const GROQ_API_KEY = "YOUR_GROQ_API_KEY";
    const SPOTIFY_CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID";
    const SPOTIFY_CLIENT_SECRET = "YOUR_SPOTIFY_CLIENT_SECRET";

Or set them as environment variables instead: `GROQ_API_KEY`, `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. The environment variable wins if both are set.

### Groq

Get a key at [console.groq.com](https://console.groq.com).

### Spotify

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create an app and tick **Web API**
3. Copy the **Client ID** and **Client secret** into `index.js`

The bot only needs Spotify's public catalog, so there is no login step for your members.

### Good to know about Spotify

- Apps in development mode need the app owner to have an active **Spotify Premium** plan
- Search returns at most 10 results per request
- Spotify no longer gives popularity numbers, top tracks or recommendations to new apps, so `!artist` shows search ranked results and the recommendations come from Groq
- Spotify doesn't allow full song streaming through bots, that's why `!play` sends a 30 second preview with a link to the full song
- If a song has no preview, the bot sends the Spotify link instead

---

## 🚀 Running the Bot

Start it with:

    node index.js

The first time, the bot asks for your WhatsApp number and gives you a pairing code.

Open **WhatsApp → Linked Devices → Link with phone number** and enter the code.

After that, add the number to your group, make it an admin so it can moderate, and send `!public` if you want members to use the music commands.

---

## ☁️ Deployment

You can also host it on any Node.js platform, such as **Pterodactyl**.

### Startup Command

    node index.js

Make sure the host has:

- Node.js
- FFmpeg

---

## 🛠️ Built With

- Node.js
- Baileys
- Termux
- Groq (`openai/gpt-oss-120b` for chat, Whisper `whisper-large-v3-turbo` for voice, Groq vision models for images)
- Spotify Web API
- iTunes Search API
- Microsoft Edge neural TTS, with Google TTS as a backup
- node-webpmux
- ws
- FFmpeg

---

## 🔐 Security

Never put these in a public repository:

- API keys and client secrets
- WhatsApp login and session files (the `auth_info` folder)
- `bot_memory.json`, which holds your contacts and chat history
- Any private settings

If a key or secret ever gets shared by accident, create a new one right away. On Spotify, use "Rotate client secret" on the app page. On Groq, make a new key in the console.
