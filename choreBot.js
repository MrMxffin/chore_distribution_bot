const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const dotenv = require('dotenv');
const fs = require('fs');
const bot_version = require('root-require')('package.json').version;
const ds_version = require('root-require')('package.json').ds_version;

dotenv.config();

const storageFilePath = './data/bot_data.json';

// Function to check if a file exists
function fileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch (err) {
        return false;
    }
}

// Load saved data from a file (if it exists)
let savedData = {};

if (fileExists(storageFilePath)) {
    try {
        const data = fs.readFileSync(storageFilePath, 'utf8');
        savedData = JSON.parse(data);
    } catch (err) {
        console.error('Error reading storage file:', err.message);
    }
}

// Initialize data or use the loaded data
const taskMap = [];
const chats = savedData.chats || {};

// Load schedules
for (const chatId in chats) {
    const chatData = chats[chatId];
    const chores = chatData.chores || [];
    taskMap[chatId] = [];
    for (const chore of chores) {
        taskMap[chatId].push(cron.schedule(chore.cronSchedule, () => {
            const choreAssignmentString = handleChoreAssignment(chatId, chore.messageThreadId, chore.assignees, chore.titles);
            if (choreAssignmentString) {
                bot.sendMessage(chatId, choreAssignmentString, {message_thread_id: chore.messageThreadId});
                saveDataToFile(); // Save data after updating assignments
            }
        }));
    }
}

// Save data to the file after any updates
function saveDataToFile() {
    const dataToSave = {
        chats,
    };

    try {
        fs.writeFileSync(storageFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (err) {
        console.error('Error writing to storage file:', err.message);
    }
}


const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

function initializeAssigneeCount(assignee, chatId) {
    // Check if chats[chatId] is defined, if not, initialize it
    chats[chatId] = chats[chatId] || {};

    // Check if chats[chatId].assignmentCountMap is defined, if not, initialize it
    chats[chatId].assignmentCountMap = chats[chatId].assignmentCountMap || {};

    // Initialize the assignment count for the assignee
    chats[chatId].assignmentCountMap[assignee] = chats[chatId].assignmentCountMap[assignee] || 0;
}

function getMinAssignee(assignees, chatId) {
    const filteredAssignmentCountMap = Object.fromEntries(
        Object.entries(chats[chatId].assignmentCountMap)
            .filter(([key]) => assignees.includes(key))
    );

    const minCount = Math.min(...Object.values(filteredAssignmentCountMap));
    const minAssignees = Object.entries(filteredAssignmentCountMap)
        .filter(([key, value]) => value === minCount)
        .map(([key]) => key);

    // If there is more than one person with the minimum assignments, choose a random one
    const randomIndex = Math.floor(Math.random() * minAssignees.length);
    return minAssignees[randomIndex];
}


function assignChoresToMinAssignees(titles, assignees, chatId) {
    const assignmentMap = {};

    titles.forEach((chore) => {
        const assignee = getMinAssignee(assignees, chatId).toLowerCase();
        assignmentMap[chore] = assignee;
        chats[chatId].assignmentCountMap[assignee]++;
    });
    return assignmentMap;
}

function handleChoreAssignment(chatId, messageThreadId, assignees, titles) {

    assignees.forEach(assignee => initializeAssigneeCount(assignee, chatId));

    const assignmentMap = assignChoresToMinAssignees(titles, assignees, chatId);

    return Object.entries(assignmentMap)
        .map(([chore, assignee]) => `🧹 ${chore} wurde ${assignee} zugewiesen.`)
        .join('\n');
}

// Function to handle the /start command
function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    bot.sendMessage(chatId, '🌟 Willkommen beim ChoreDistributionBot! Verwende /help, um die verfügbaren Befehle anzuzeigen.', {message_thread_id: messageThreadId});
}

// Function to handle the /help command
function handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const helpText = `
        🤖 Verfügbare Befehle:
        /start - Starte den Bot
        /help - Zeige diese Hilfemeldung an
        /add_chore - Füge eine wiederkehrende Aufgabe hinzu
        /remove_chore - Entferne eine Aufgabe anhand des Schlüssels
        /list_chores - Zeige alle Aufgaben für diesen Chat an
        /show_leaderboard - Zeige das Leaderboard von abgeschlossenen Aufgaben an
        /trash - Füge eine Standardaufgabe hinzu
        /set_default_users - Lege Standardbenutzer für Aufgaben fest
        /version - Zeige die Bot-Version und Datenstruktur-Version an
    `;
    bot.sendMessage(chatId, helpText, {message_thread_id: messageThreadId});
}

// Function to handle the /add_chore command
function handleAddChoreCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const commandArgs = msg.text.split(' ').slice(1).join(' ');

    // Check if command arguments are missing
    if (!commandArgs || commandArgs.trim() === '') {
        bot.sendMessage(chatId, '✨ Bitte gib die Details der Aufgabe im Format an: /add_chore Aufgabe 1,Aufgabe 2,...;Cron-Schedule;@Benutzer1,@Benutzer2,...', {message_thread_id: messageThreadId});
        return;
    }

    // Parse command arguments (titles, cronSchedule, assignees)
    let [titles, [cronSchedule], assignees] = commandArgs.split(';').map(s => s.split(',').map(s => s.trim()));

    // Validate the cron schedule format
    if (!(cron.validate(cronSchedule) || cronSchedule === "@now")) {
        bot.sendMessage(chatId, '❌ Ungültiges Cron-Schedule-Format. Bitte gib ein gültiges Cron-Schedule an.', {message_thread_id: messageThreadId});
        return;
    }

    if (assignees[0] === "@default" && assignees.length === 0) {
        // Check if default users are set for the chat
        if (!chats[chatId].defaultUsers || chats[chatId].defaultUsers.length === 0) {
            bot.sendMessage(chatId, '❌ Standardbenutzer sind nicht festgelegt. Verwende /set_default_users, um Standardbenutzer festzulegen.', {message_thread_id: messageThreadId});
            return;
        }
    } else {
        assignees = chats[chatId].defaultUsers;
    }

    if (cronSchedule === "@now") {
        const choreAssignmentString = handleChoreAssignment(chatId, messageThreadId, assignees, titles);
        if (choreAssignmentString) {
            saveDataToFile(); // Save data after updating assignments
            bot.sendMessage(chatId, choreAssignmentString, {message_thread_id: messageThreadId});
        }
    } else {
        // Initialize the 'chats' object if it doesn't exist
        chats[chatId] = chats[chatId] || {};

        // Initialize the 'chores' array if it doesn't exist
        chats[chatId].chores = chats[chatId].chores || [];

        // Initialize the 'assignmentCountMap' if it doesn't exist
        chats[chatId].assignmentCountMap = chats[chatId].assignmentCountMap || {};

        // Push the new chore to the 'chores' array
        chats[chatId].chores.push({
            titles,
            cronSchedule,
            assignees,
            messageThreadId,
            key: chats[chatId].chores.length > 0 ? chats[chatId].chores[chats[chatId].chores.length - 1].key + 1 : 0
        });

        saveDataToFile(); // Save data after adding a new chore

        taskMap.push(cron.schedule(cronSchedule, () => {
            const choreAssignmentString = handleChoreAssignment(chatId, messageThreadId, assignees, titles);
            if (choreAssignmentString) {
                bot.sendMessage(chatId, choreAssignmentString, {message_thread_id: messageThreadId});
                saveDataToFile(); // Save data after updating assignments
            }
        }));

        bot.sendMessage(chatId, '✅ Aufgabe erfolgreich hinzugefügt!', {message_thread_id: messageThreadId});
    }
}

// Function to handle the /remove_chore command
function handleRemoveChoreCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;

    // Check if chore key is missing
    if (msg.text.split(' ').length < 2) {
        bot.sendMessage(chatId, '✨ Bitte gib den Schlüssel der Aufgabe an, die du mit /remove_chore [Schlüssel] entfernen möchtest.', {
            message_thread_id: messageThreadId,
        });
        return;
    }

    const choreKey = parseInt(msg.text.split(' ')[1], 10);

    if (chats[chatId] && chats[chatId].chores) {
        const index = chats[chatId].chores.findIndex((chore) => chore.key === choreKey);
        if (index !== -1) {
            chats[chatId].chores.splice(index, 1);
            taskMap[chatId][index].stop();
            saveDataToFile(); // Save data after removing a chore
            bot.sendMessage(chatId, '✅ Aufgabe erfolgreich entfernt!', {message_thread_id: messageThreadId});
        } else {
            bot.sendMessage(chatId, '❌ Ungültiger Aufgabenschlüssel. Bitte gib einen gültigen Schlüssel an.', {
                message_thread_id: messageThreadId,
            });
        }
    } else {
        bot.sendMessage(chatId, '📋 Keine Daten für diesen Chat verfügbar.', {message_thread_id: messageThreadId});
    }
}


// Function to handle the /list_chores command
function handleListChoresCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;

    // Check if chatId exists in chats and if chores array is defined
    if (chats[chatId] && chats[chatId].chores) {
        const chores = chats[chatId].chores;
        if (chores.length === 0) {
            bot.sendMessage(chatId, '📋 Keine Aufgaben verfügbar. Verwende /add_chore, um wiederkehrende Aufgaben hinzuzufügen.', {message_thread_id: messageThreadId});
        } else {
            const choreList = chores
                .map((chore) => {
                    return `🔑 Schlüssel: ${chore.key}\n🧹 Aufgaben:\n- ${chore.titles.join('\n- ')}\n⏰ Cron-Schedule: ${chore.cronSchedule}\n👷🏼 Zuständige:\n- ${chore.assignees.join('\n- ')}\n`;
                });

            if (choreList.length === 0) {
                bot.sendMessage(chatId, '📋 Keine Aufgaben verfügbar. Verwende /add_chore, um wiederkehrende Aufgaben hinzuzufügen.', {message_thread_id: messageThreadId});
            } else {
                bot.sendMessage(chatId, choreList.join('\n'), {message_thread_id: messageThreadId});
            }
        }
    } else {
        bot.sendMessage(chatId, '📋 Keine Daten für diesen Chat verfügbar.', {message_thread_id: messageThreadId});
    }
}

// Function to handle the /show_leaderboard command
function handleShowLeaderboardCommand(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;

    if (chats[chatId] && chats[chatId].assignmentCountMap) {
        const chatData = chats[chatId];

        // Convert assignmentCountMap to a string
        const leaderboardText = Object.entries(chatData.assignmentCountMap)
            .map(([assignee, count]) => `${assignee}: ${count} Aufgaben abgeschlossen.`)
            .join('\n');

        bot.sendMessage(chatId, leaderboardText, {message_thread_id: messageThreadId});
    } else {
        bot.sendMessage(chatId, '📋 Keine Daten für diesen Chat verfügbar.', {message_thread_id: messageThreadId});
    }
}

// Function to handle the /set_default_users command
function handleSetDefaultUsers(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const commandArgs = msg.text.split(' ').slice(1).join(' ');

    // If command arguments are not provided, show an error message
    if (!commandArgs) {
        bot.sendMessage(chatId, '❌ Keine Benutzer angegeben. Verwende /set_default_users mit mindestens einem Benutzer.', {message_thread_id: messageThreadId});
        return;
    }

    // Parse command arguments to get default users
    const defaultUsersList = commandArgs.split(',').map(user => user.trim().toLowerCase());

    // Update or initialize default users for the chat
    chats[chatId] = chats[chatId] || {};
    chats[chatId].defaultUsers = defaultUsersList;

    saveDataToFile(); // Save data after updating default users

    bot.sendMessage(chatId, '✅ Standardbenutzer erfolgreich festgelegt.', {message_thread_id: messageThreadId});
}

// Function to handle the /trash command
function handleTrash(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const commandArgs = msg.text.split(' ')[1];

    if (!commandArgs) {
        bot.sendMessage(chatId, '❌ Kein Müll festgelegt. Verwende /trash mit einem Argument.', {message_thread_id: messageThreadId});
    }
    // Check if default users are set for the chat
    if (!chats[chatId].defaultUsers || chats[chatId].defaultUsers.length === 0) {
        bot.sendMessage(chatId, '❌ Standardbenutzer sind nicht festgelegt. Verwende /set_default_users, um Standardbenutzer festzulegen.', {message_thread_id: messageThreadId});
        return;
    }

    // Prepare arguments for the /add_chore command
    const addChoreArgs = `${commandArgs}müll rausbringen;@now;${chats[chatId].defaultUsers.join(',')}`;

    // Call the handleAddChoreCommand function to add the task
    handleAddChoreCommand({
        chat: {id: chatId},
        message_thread_id: messageThreadId,
        text: `/add_chore ${addChoreArgs}`,
    });
}

// Function to handle the /version command
function handleVersion(msg) {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    bot.sendMessage(chatId, `🤖 Bot-Version: ${bot_version}\n📊 Datenstruktur-Version: ${ds_version}`, {message_thread_id: messageThreadId});
}

// Function to handle different commands
function handleCommand(msg) {
    const command = msg.text.split(' ')[0]; // Extract the command (e.g., "/start", "/add_chore", etc.)

    switch (command) {
        case '/start':
            handleStartCommand(msg);
            break;
        case '/help':
            handleHelpCommand(msg);
            break;
        case '/add_chore':
            handleAddChoreCommand(msg);
            break;
        case '/remove_chore':
            handleRemoveChoreCommand(msg);
            break;
        case '/list_chores':
            handleListChoresCommand(msg);
            break;
        case '/show_leaderboard':
            handleShowLeaderboardCommand(msg);
            break;
        case '/trash':
            handleTrash(msg);
            break;
        case '/set_default_users':
            handleSetDefaultUsers(msg);
            break;
        case '/version':
            handleVersion(msg);
            break
        default:
            const chatId = msg.chat.id;
            const messageThreadId = msg.message_thread_id;
            bot.sendMessage(chatId, '❌ Unbekannter Befehl. Verwende /help, um die verfügbaren Befehle anzuzeigen.', {message_thread_id: messageThreadId});
    }
}

// Handle all incoming messages
bot.on('message', (msg) => {
    handleCommand(msg);
});

// Log errors
bot.on('polling_error', (error) => {
    console.error(error);
});
