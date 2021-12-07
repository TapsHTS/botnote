require("dotenv").config();
const fs = require("fs");
const pronote = require("@EduWireApps/pronote-api");
const fetch = require('node-fetch');
const moment = require("moment");
const devip = require('dev-ip');
moment.locale("fr");
const DATE_END_OF_YEAR = new Date(Date.now() + 31536000000);
const { Discord, Client, MessageEmbed } = require("discord.js");
const client = new Client();

let cache = null;

/**
 * Écrit l'objet dans le cache et met à jour la variable
 * @param {object} newCache Le nouvel objet
 */
const writeCache = (newCache) => {
    cache = newCache;
    fs.writeFileSync("cache.json", JSON.stringify(newCache, null, 4), "utf-8");
};

/**
 * Réinitialise le cache
 */
const resetCache = () => writeCache({
    homeworks: [],
    marks: [],
    lessonsAway: []
});

// Si le fichier cache n'existe pas, on le créé
if (!fs.existsSync("cache.json")) {
    resetCache();
} else {
    // S'il existe, on essaie de le parser et si ça échoue on le reset pour éviter les erreurs
    try {
        cache = JSON.parse(fs.readFileSync("cache.json", "utf-8"));
    } catch (e) {
        console.error(e);
        resetCache();
    }
}

/**
 * Synchronise le cache avec Pronote et se charge d'appeler les fonctions qui envoient les notifications
 * @returns {void}
 */
const pronoteSynchronization = async() => {

    // Connexion à Pronote
    const cas = (process.env.PRONOTE_CAS && process.env.PRONOTE_CAS.length > 0 ? process.env.PRONOTE_CAS : "none");
    const session = await pronote.login(process.env.PRONOTE_URL, process.env.PRONOTE_USERNAME, process.env.PRONOTE_PASSWORD, cas, "student").catch(console.log);
    if (!session) return;

    // Vérification des devoirs
    const homeworks = await session.homeworks(Date.now(), DATE_END_OF_YEAR);
    const newHomeworks = homeworks.filter((work) => !(cache.homeworks.some((cacheWork) => cacheWork.description === work.description)));
    if (newHomeworks.length > 0 && newHomeworks.length <= 3) {
        newHomeworks.forEach((work) => sendDiscordNotificationHomework(work));
    }
    // Mise à jour du cache pour les devoirs
    writeCache({
        ...cache,
        homeworks
    });
    //Vérification des nouvelles notes
    const marks = await session.marks("semester");
    const subjectsNewMarks = marks.subjects.filter((subj) => cache.marks.subjects && cache.marks.subjects.find((s) => s.name === subj.name) && cache.marks.subjects.find((s) => s.name === subj.name).averages.student !== subj.averages.student);
    if (subjectsNewMarks.length > 0 && subjectsNewMarks.length <= 3) {
        subjectsNewMarks.forEach((subj) => {
            const marks = subj.marks.filter((mark) => !(cache.marks.subjects.find((s) => s.name === subj.name).marks.some((cacheMark) => cacheMark.id === mark.id)));
            marks.forEach((mark) => sendDiscordNotificationMark(subj, mark));
        });
    }

    // Mise à jour du cache pour les notes
    writeCache({
        ...cache,
        marks
    });

    //Vérification des professeurs absents
    const nextWeekDay = new Date();
    nextWeekDay.setDate(nextWeekDay.getDate() + 30);
    const timetable = await session.timetable(new Date(), nextWeekDay);
    const awayNotifications = [];
    timetable.filter((lesson) => lesson.isAway).forEach((lesson) => {
        if (!cache.lessonsAway.some((lessonID) => lessonID === lesson.id)) {
            awayNotifications.push({
                teacher: lesson.teacher,
                from: lesson.from,
                subject: lesson.subject,
                id: lesson.id
            });
        }
    });
    if (awayNotifications.length) {
        awayNotifications.forEach((awayNotif) => { sendDiscordNotificationAway(awayNotif) });
    }

    const lessonsAway =

        writeCache({
            ...cache,
            lessonsAway: [
                ...cache.lessonsAway,
                ...awayNotifications.map((n) => n.id)
            ]
        });

    // Déconnexion de Pronote
    session.logout();
};

/**
 * Envoi une notification de cours annulé sur Discord
 * @param {any} awayNotif Les informations sur le cours annulé
 */
const sendDiscordNotificationAway = (awayNotif) => {
    const data = {
        title: '%F0%9F%91%A8%E2%80%8D%E2%9A%95%EF%B8%8F Professeur absent',
        message: `${awayNotif.teacher} (${awayNotif.subject}) sera absent(e) le ${moment(awayNotif.from).format("dddd Do MMMM")}`
    }
    
    client.users.cache.get(process.env.AUTHOR_ID)
    .send(`${data.title}\n${data.message}`);
    
    fetch(`https://alertzy.app/send?accountKey=${process.env.NOTIFICATION_ID}&title=${data.title}&message=${encodeURIComponent(data.message)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
};

/**
 * Envoi un notification de note sur Discord
 * @param {string} subject La matière de la note
 * @param {pronote.Mark} mark La note à envoyer
 */


const sendDiscordNotificationMark = (subject, mark) => {
    const data = {
        title: `%F0%9F%93%9A Nouvelle note en ${subject.name.toUpperCase()}`,
        message: `Tu as eu ${mark.value}/${mark.scale} et la moyenne est de ${mark.average}/${mark.scale}`,
    }
    
    client.users.cache.get(process.env.AUTHOR_ID)
    .send(`${data.title}\n${data.message}`);

    fetch(`https://alertzy.app/send?accountKey=${process.env.NOTIFICATION_ID}&title=${data.title}&message=${encodeURIComponent(data.message)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
};
client.on("ready", () => {
    console.log(`
    ╭─────────────────────────────────────────────────────────────────╮
    │                          ~ Pronote ~                            │
    │                                                                 │
    │                ${client.user.tag} est opérationnel !                 │
    │                      Client: ${process.env.PRONOTE_USERNAME}                           │
    │                      Version: v.1.2.0                           │
    │               Fonction: Professeur Absent et Notes              │
    ╰─────────────────────────────────────────────────────────────────╯
 `)
    setInterval(() => {
        client.user.setActivity("Pronote", {
            type: "WATCHING"
        });
    }, 10000)

    pronoteSynchronization();
    setInterval(() => {
        const date = new Date();
        pronoteSynchronization().catch((e) => console.log(`${date} | ${e.message}`));
    }, 10 * 60 * 1000);
});

// Connexion à Discord
client.login(process.env.TOKEN)
