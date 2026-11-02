/**
 * 🎬 WhatsApp YouTube & Shorts Status (Durum) Otomatik İndirme, 60sn Bölümleme ve Yayınlama Servisi
 * Klasör: C:\Cursor\85_whatsapp_youtube_status
 * Entegrasyon: C:\Cursor\76_mail_watsup (whatsapp_service.js, whatsapp_yonetim.html, portal.html)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = __dirname;
const DOWNLOADS_DIR = path.join(APP_DIR, 'downloads');
const JOBS_DB_PATH = path.join(APP_DIR, 'jobs_db.json');
const PYTHON_SCRIPT_PATH = path.join(APP_DIR, 'yt_processor.py');
const FEATURE_ID = 'in_youtube_status_publisher';

// Klasörleri hazırla
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// YouTube (Shorts, Watch, youtu.be, live) ve Instagram (Reels, Post, TV, Share) URL yakalama regex
const VIDEO_URL_REGEX = /(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:shorts\/[A-Za-z0-9_-]{6,}|watch\?[^\s]*v=[A-Za-z0-9_-]{6,}|live\/[A-Za-z0-9_-]{6,}|embed\/[A-Za-z0-9_-]{6,})|youtu\.be\/[A-Za-z0-9_-]{6,}|instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv|share\/reel)\/[A-Za-z0-9_-]+[^\s]*))/i;
const YOUTUBE_URL_REGEX = VIDEO_URL_REGEX;

let jobsCache = null;

function loadJobs() {
    if (jobsCache !== null) return jobsCache;
    try {
        if (fs.existsSync(JOBS_DB_PATH)) {
            const raw = fs.readFileSync(JOBS_DB_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                jobsCache = parsed;
                return jobsCache;
            }
        }
    } catch (e) {
        console.error('[YT-Status] jobs_db.json okuma hatası:', e.message);
    }
    jobsCache = [];
    return jobsCache;
}

function saveJobs() {
    try {
        fs.writeFileSync(JOBS_DB_PATH, JSON.stringify(loadJobs(), null, 2), 'utf8');
    } catch (e) {
        console.error('[YT-Status] jobs_db.json yazma hatası:', e.message);
    }
}

function getJobById(jobId) {
    return loadJobs().find(j => j.jobId === jobId) || null;
}

function getLatestWaitingJob() {
    const jobs = loadJobs();
    for (let i = 0; i < jobs.length; i++) {
        if (jobs[i].status === 'WAITING_APPROVAL') {
            return jobs[i];
        }
    }
    return null;
}

function extractVideoUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(VIDEO_URL_REGEX);
    if (!match) return null;
    let url = match[1].trim();
    // Sondaki nokta, virgül, parantez gibi noktalama işaretlerini temizle
    url = url.replace(/[.,;!?()\[\]"']+$/g, '');
    return url;
}

const extractYoutubeUrl = extractVideoUrl;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Python yt_processor.py betiğini çalıştırarak videoyu indirir ve 60sn parçalara böler
 */
function runPythonProcessor(youtubeUrl, jobDir, segmentSeconds = 59) {
    return new Promise((resolve, reject) => {
        const args = [
            PYTHON_SCRIPT_PATH,
            '--url', youtubeUrl,
            '--out', jobDir,
            '--segment', String(segmentSeconds)
        ];

        const proc = spawn('python', args, {
            cwd: APP_DIR,
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        let stdoutData = '';
        let stderrData = '';

        proc.stdout.on('data', chunk => {
            stdoutData += chunk.toString('utf8');
        });

        proc.stderr.on('data', chunk => {
            stderrData += chunk.toString('utf8');
        });

        proc.on('error', err => {
            reject(new Error(`Python başlatılamadı: ${err.message}`));
        });

        proc.on('close', code => {
            let jsonPayload = null;

            // 1. Standart işaretleyiciler arasından JSON'ı al
            const markerMatch = stdoutData.match(/===JSON_OUTPUT_START===([\s\S]*?)===JSON_OUTPUT_END===/);
            if (markerMatch && markerMatch[1]) {
                try {
                    jsonPayload = JSON.parse(markerMatch[1].trim());
                } catch (_) {}
            }

            // 2. Alternatif: Satır satır veya regex ile en son geçerli JSON nesnesini bul
            if (!jsonPayload) {
                // \r ve \n ayrıştırması
                const rawChunks = stdoutData.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                for (let i = rawChunks.length - 1; i >= 0; i--) {
                    const chunk = rawChunks[i];
                    if (chunk.startsWith('{') && chunk.endsWith('}')) {
                        try {
                            jsonPayload = JSON.parse(chunk);
                            if (jsonPayload) break;
                        } catch (_) {}
                    }
                }
            }

            // 3. Hala bulunamadıysa { "success": ... } bloğunu regex ile ara
            if (!jsonPayload) {
                const jsonMatch = stdoutData.match(/\{[\s\S]*"success"[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        jsonPayload = JSON.parse(jsonMatch[0].trim());
                    } catch (_) {}
                }
            }

            if (jsonPayload && jsonPayload.success) {
                resolve(jsonPayload);
            } else if (jsonPayload && jsonPayload.error) {
                reject(new Error(jsonPayload.error));
            } else {
                reject(new Error(`Video işleme çıktısı okunamadı: ${stderrData || stdoutData || 'Bilinmeyen hata (kod: ' + code + ')'}`));
            }
        });
    });
}

/**
 * Kullanıcıya gönderilecek onay ve parça detay mesajını oluşturur
 */
function buildApprovalMessage(job) {
    const isIg = job.platform === 'INSTAGRAM' || (job.url && job.url.includes('instagram.com'));
    const typeBadge = isIg
        ? (job.isShort ? '📸 Instagram Reel' : '📹 Instagram Video')
        : (job.isShort ? '📱 YouTube Shorts' : '🎬 YouTube Video');
    const headerTitle = isIg ? 'INSTAGRAM & REELS' : 'YOUTUBE';
    const authorLabel = isIg ? 'Hesap' : 'Kanal';

    let msg = `🎬 *${headerTitle} WHATSAPP DURUM (STATUS) HAZIRLAYICI*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 *Başlık:* ${job.title}\n`;
    msg += `📺 *${authorLabel}:* ${job.uploader}\n`;
    msg += `🏷️ *Tür:* ${typeBadge} (${job.width || '?'}x${job.height || '?'})\n`;
    msg += `⏱️ *Toplam Süre:* ${job.totalDurationFormatted} (${job.totalDurationSec} sn)\n`;
    msg += `📦 *Toplam Boyut:* ${job.totalPartsSizeMb} MB\n`;
    msg += `✂️ *Bölüm Sayısı:* *${job.totalParts} Parça* (Max 60 sn Status Formatı)\n`;
    msg += `🆔 *İşlem No:* \`${job.jobId}\`\n\n`;

    msg += `📋 *HAZIRLANAN DURUM BÖLÜMLERİ:*\n`;
    (job.parts || []).forEach(p => {
        msg += `   🔹 *${p.partNumber}/${job.totalParts}. Bölüm:* \`${p.startFormatted} - ${p.endFormatted}\` (${p.durationSec} sn • ${p.sizeMb} MB)\n`;
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `❓ *WhatsApp Durumunuzda (Status) sırayla yayına alınsın mı?*\n\n`;
    msg += `✅ *EVET* veya *ONAY* ➔ Tüm bölümleri sırayla WhatsApp Durum'da paylaşır\n`;
    msg += `📲 *ÖNİZLE* ➔ Bölümleri önce bu sohbete video olarak gönderir\n`;
    msg += `❌ *HAYIR* veya *İPTAL* ➔ Yayını iptal eder\n\n`;
    msg += `🌐 _Web Kontrol Paneli:_ http://localhost:5003/youtube_status.html`;
    return msg;
}

/**
 * Bağımlılıkları (client, featureGate, tabularBot, MessageMedia) bağlayarak yöneticiyi oluşturur
 */
function createYoutubeStatusManager({ getClient, getTargetChatId, featureGate, tabularBot, MessageMedia }) {

    async function sendSafeMessage(chatId, text, options = {}) {
        const client = getClient();
        if (!client) throw new Error('WhatsApp istemcisi henüz hazır değil.');
        if (tabularBot && typeof tabularBot.registerSentMessage === 'function' && typeof text === 'string') {
            tabularBot.registerSentMessage(text);
        }
        return await client.sendMessage(chatId, text, options);
    }

    /**
     * Yeni bir YouTube linkini indirir, 60sn parçalara böler ve onay bekleyen iş olarak kaydeder
     */
    async function createAndProcessJob(youtubeUrl, { notifyWhatsapp = true, chatId = null, source = 'WHATSAPP', segmentSeconds = 59 } = {}) {
        const jobId = `yt_${Date.now()}`;
        const jobDir = path.join(DOWNLOADS_DIR, jobId);
        const targetChat = chatId || getTargetChatId();
        const isIg = (youtubeUrl || '').includes('instagram.com');
        const platformName = isIg ? 'INSTAGRAM REELS / VİDEO' : 'YOUTUBE VİDEO';

        // Önceki WAITING_APPROVAL işleri varsa süresi geçmiş olarak işaretle
        const jobs = loadJobs();
        jobs.forEach(j => {
            if (j.status === 'WAITING_APPROVAL') {
                j.status = 'SUPERSEDED';
            }
        });

        const newJob = {
            jobId,
            url: youtubeUrl,
            source,
            platform: isIg ? 'INSTAGRAM' : 'YOUTUBE',
            status: 'DOWNLOADING',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            chatId: targetChat,
            title: 'İndiriliyor...',
            uploader: '-',
            totalDurationSec: 0,
            totalDurationFormatted: '00:00',
            totalParts: 0,
            totalPartsSizeMb: 0,
            parts: [],
            error: null
        };

        jobs.unshift(newJob);
        if (jobs.length > 50) jobs.length = 50;
        saveJobs();

        if (notifyWhatsapp && targetChat) {
            try {
                await sendSafeMessage(
                    targetChat,
                    `⏳ *${platformName} İNDİRİLİYOR VE BÖLÜMLENİYOR...*\n━━━━━━━━━━━━━━━━━━━━\n🔗 *Link:* ${youtubeUrl}\n✂️ *Format:* 60 Saniyelik WhatsApp Status Bölümleri\n\n_Lütfen bekleyin, video analiz edilip parçalara ayrıldığında onayınız istenecektir..._`
                );
            } catch (e) {
                console.error('[YT-Status] Başlangıç bildirimi gönderilemedi:', e.message);
            }
        }

        try {
            const result = await runPythonProcessor(youtubeUrl, jobDir, segmentSeconds);

            newJob.status = 'WAITING_APPROVAL';
            newJob.updatedAt = new Date().toISOString();
            newJob.platform = result.platform || (isIg ? 'INSTAGRAM' : 'YOUTUBE');
            newJob.videoId = result.videoId;
            newJob.title = result.title;
            newJob.uploader = result.uploader;
            newJob.webpageUrl = result.webpageUrl || youtubeUrl;
            newJob.thumbnail = result.thumbnail;
            newJob.isShort = result.isShort;
            newJob.width = result.width;
            newJob.height = result.height;
            newJob.totalDurationSec = result.totalDurationSec;
            newJob.totalDurationFormatted = result.totalDurationFormatted;
            newJob.sourceSizeMb = result.sourceSizeMb;
            newJob.totalPartsSizeMb = result.totalPartsSizeMb;
            newJob.segmentLengthSec = result.segmentLengthSec;
            newJob.totalParts = result.totalParts;
            newJob.parts = (result.parts || []).map(p => ({
                ...p,
                previewUrl: `/api/yt-status/video/${jobId}/${p.fileName}`,
                published: false,
                publishedAt: null
            }));

            saveJobs();

            if (notifyWhatsapp && targetChat) {
                const approvalText = buildApprovalMessage(newJob);
                await sendSafeMessage(targetChat, approvalText);
            }

            return newJob;
        } catch (err) {
            newJob.status = 'FAILED';
            newJob.updatedAt = new Date().toISOString();
            newJob.error = err.message;
            saveJobs();

            if (notifyWhatsapp && targetChat) {
                await sendSafeMessage(
                    targetChat,
                    `❌ *${platformName} İŞLEME HATASI*\n━━━━━━━━━━━━━━━━━━━━\n🔗 *Link:* ${youtubeUrl}\n⚠️ *Hata:* ${err.message}`
                );
            }
            throw err;
        }
    }

    async function reinjectUtils() {
        try {
            const client = getClient();
            if (client && client.pupPage) {
                const utilsPath = path.resolve(__dirname, '..', '76_mail_watsup', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
                delete require.cache[require.resolve(utilsPath)];
                const { LoadUtils } = require(utilsPath);
                await client.pupPage.evaluate(LoadUtils);
                console.log('[YT-Status] ✅ LoadUtils live re-injected into Puppeteer page successfully.');
            }
        } catch (e) {
            console.error('[YT-Status] reinjectUtils warning:', e.message);
        }
    }

    /**
     * Onaylanan işi sırayla WhatsApp Status (status@broadcast) ve/veya Kendi Sohbetinde yayına alır
     */
    async function publishJobToStatus(jobId, { mode = 'STATUS', alsoSendToSelfChat = true } = {}) {
        const job = getJobById(jobId);
        if (!job) throw new Error(`İşlem bulunamadı: ${jobId}`);
        if (!job.parts || job.parts.length === 0) throw new Error('Yayınlanacak video bölümü bulunamadı.');

        const client = getClient();
        if (!client) throw new Error('WhatsApp bağlantısı aktif değil.');

        const targetChat = (job.chatId && !job.chatId.endsWith('@lid')) ? job.chatId : getTargetChatId();
        job.status = 'PUBLISHING';
        job.updatedAt = new Date().toISOString();
        saveJobs();

        // Her yayından önce güncel Utils injection'ı garantile
        await reinjectUtils();

        const total = job.parts.length;
        const modeTitle = mode === 'SELF_CHAT_ONLY'
            ? '📲 Sohbete Video Gönderimi'
            : '🟢 WhatsApp Durum (Status) Yayını';

        if (targetChat) {
            await sendSafeMessage(
                targetChat,
                `🚀 *WHATSAPP DURUM YAYINI BAŞLATILDI*\n━━━━━━━━━━━━━━━━━━━━\n📌 *Video:* ${job.title}\n🎞️ *Toplam:* ${total} Bölüm sırayla yükleniyor...\n📡 *Mod:* ${modeTitle}`
            );
        }

        let statusSuccessCount = 0;
        let chatSuccessCount = 0;
        const errors = [];

        for (let i = 0; i < total; i++) {
            const part = job.parts[i];
            if (!fs.existsSync(part.filePath)) {
                errors.push(`Bölüm ${part.partNumber} dosyası bulunamadı.`);
                continue;
            }

            const media = MessageMedia.fromFilePath(part.filePath);
            const caption = total > 1
                ? `🎬 ${job.title} [${part.partNumber}/${total}] (${part.startFormatted}-${part.endFormatted})`
                : `🎬 ${job.title}`;

            if (tabularBot && typeof tabularBot.registerSentMessage === 'function') {
                tabularBot.registerSentMessage(caption);
            }

            // 1. WhatsApp Durum (status@broadcast) Gönderimi
            if (mode !== 'SELF_CHAT_ONLY') {
                try {
                    await client.sendMessage('status@broadcast', media, { caption });
                    statusSuccessCount++;
                    part.published = true;
                    part.publishedAt = new Date().toISOString();
                    saveJobs();
                } catch (statusErr) {
                    console.error(`[YT-Status] status@broadcast gönderim hatası (Bölüm ${part.partNumber}):`, statusErr.message);
                    errors.push(`Bölüm ${part.partNumber} Status hatası: ${statusErr.message}`);
                }
            }

            // 2. Kendi sohbetine (05054667617) kopyasını/önizlemesini gönder (kullanıcı telefondan da görebilsin)
            if (targetChat && (mode === 'SELF_CHAT_ONLY' || alsoSendToSelfChat)) {
                try {
                    const selfCaption = mode === 'SELF_CHAT_ONLY'
                        ? `📲 *[ÖNİZLEME ${part.partNumber}/${total}]* ${job.title} (${part.startFormatted}-${part.endFormatted})`
                        : `✅ *[DURUMDA YAYINLANDI ${part.partNumber}/${total}]* ${job.title} (${part.startFormatted}-${part.endFormatted})`;
                    if (tabularBot && typeof tabularBot.registerSentMessage === 'function') {
                        tabularBot.registerSentMessage(selfCaption);
                    }
                    await client.sendMessage(targetChat, media, { caption: selfCaption });
                    chatSuccessCount++;
                } catch (chatErr) {
                    console.error(`[YT-Status] Self-chat video gönderim hatası (Bölüm ${part.partNumber}):`, chatErr.message);
                }
            }

            // Bölümlerin WhatsApp Status'ta doğru sırayla dizilmesi için kısa bekleme
            if (i < total - 1) {
                await sleep(2500);
            }
        }

        if (mode === 'SELF_CHAT_ONLY') {
            // Ön izleme modunda tekrar onay verebilmesi için WAITING_APPROVAL'da bırakabiliriz
            job.status = 'WAITING_APPROVAL';
        } else {
            job.status = (statusSuccessCount > 0) ? 'PUBLISHED' : (chatSuccessCount > 0 ? 'PUBLISHED_CHAT_ONLY' : 'FAILED');
            job.publishedAt = new Date().toISOString();
        }
        job.error = errors.length > 0 ? errors.join(' | ') : null;
        job.updatedAt = new Date().toISOString();
        saveJobs();

        if (targetChat) {
            if (mode === 'SELF_CHAT_ONLY') {
                await sendSafeMessage(
                    targetChat,
                    `📲 *ÖNİZLEME TAMAMLANDI (${chatSuccessCount}/${total} Bölüm)*\n━━━━━━━━━━━━━━━━━━━━\nWhatsApp Durumda (Status) yayına almak için *EVET* veya *ONAY*, iptal için *HAYIR* yazabilirsiniz.`
                );
            } else {
                let summary = `🎉 *WHATSAPP DURUM (STATUS) YAYINI TAMAMLANDI!*\n━━━━━━━━━━━━━━━━━━━━\n`;
                summary += `📌 *Video:* ${job.title}\n`;
                summary += `✅ *Durum'a (Status) Yüklenen:* ${statusSuccessCount} / ${total} Bölüm\n`;
                summary += `📲 *Sohbete Gönderilen:* ${chatSuccessCount} / ${total} Bölüm\n`;
                if (errors.length > 0) {
                    summary += `⚠️ *Notlar:* ${errors.join(' | ')}\n`;
                }
                summary += `🕒 *Saat:* ${new Date().toLocaleTimeString('tr-TR')}`;
                await sendSafeMessage(targetChat, summary);
            }
        }

        return {
            success: true,
            job,
            statusSuccessCount,
            chatSuccessCount,
            errors
        };
    }

    /**
     * Gelen WhatsApp mesajlarını dinler:
     * 1) Bekleyen bir onay varsa EVET / ONAY / ÖNİZLE / HAYIR / İPTAL komutlarını işler
     * 2) Mesajda YouTube / Shorts linki varsa indirip 60sn parçalara böler ve onay ister
     */
    async function handleIncomingMessage(msg, text, client) {
        if (!text || typeof text !== 'string') return false;
        const cleanText = text.trim();
        const lower = cleanText.toLocaleLowerCase('tr-TR');
        const targetChat = (msg.fromMe && msg.to) ? msg.to : msg.from;

        // 1. Yardım / Durum komutu (/yt, /youtube, /ig, /instagram, /reel, /reels, /status)
        if (['/yt', '/youtube', '/ytstatus', '/ig', '/instagram', '/reel', '/reels', '/status'].includes(lower)) {
            const gate = featureGate.checkIncomingGate(FEATURE_ID, cleanText);
            if (!gate.allowed) return true;

            const waiting = getLatestWaitingJob();
            let info = `🎬 *YOUTUBE & INSTAGRAM WHATSAPP DURUM (STATUS) SERVİSİ*\n━━━━━━━━━━━━━━━━━━━━\n`;
            info += `🟢 *Servis Durumu:* AKTİF (60sn Otomatik Bölümleyici)\n`;
            info += `📱 *Kullanım:* Bu sohbete herhangi bir *YouTube Video*, *YouTube Shorts* veya *Instagram Reel / Video* linki gönderin.\n`;
            info += `✂️ Sistem videoyu otomatik indirir, 60 saniyelik parçalara böler ve yayına almadan önce size parça sayısını bildirip *ONAY* ister.\n\n`;
            if (waiting) {
                const waitPlatform = waiting.platform === 'INSTAGRAM' ? '📸 Instagram' : '🎬 YouTube';
                info += `⏳ *Onay Bekleyen Video:* [${waitPlatform}] ${waiting.title} (${waiting.totalParts} Bölüm)\n`;
                info += `👉 Yayınlamak için *EVET*, iptal için *HAYIR* yazabilirsiniz.\n\n`;
            }
            info += `🌐 *Web Paneli:* http://localhost:5003/youtube_status.html\n`;
            info += `🎛️ *ON/OFF Matrisi:* http://localhost:5003/whatsapp_yonetim.html`;
            await sendSafeMessage(targetChat, info);
            return true;
        }

        // 2. Bekleyen onay (WAITING_APPROVAL) kontrolü
        const waitingJob = getLatestWaitingJob();
        if (waitingJob) {
            const isApprove = ['evet', 'onay', 'onayla', 'yayınla', 'yayinla', 'evet yayınla', 'evet yayinla', 'durumda yayınla'].includes(lower);
            const isPreview = ['önizle', 'onizle', 'test', 'bana gönder', 'bana gonder'].includes(lower);
            const isCancel = ['hayır', 'hayir', 'iptal', 'vazgeç', 'vazgec', 'red'].includes(lower);

            if (isApprove || isPreview || isCancel) {
                const gate = featureGate.checkIncomingGate(FEATURE_ID, cleanText);
                if (!gate.allowed) {
                    return true;
                }

                if (isCancel) {
                    waitingJob.status = 'CANCELLED';
                    waitingJob.updatedAt = new Date().toISOString();
                    saveJobs();
                    await sendSafeMessage(
                        targetChat,
                        `🛑 *YOUTUBE DURUM YAYINI İPTAL EDİLDİ*\n━━━━━━━━━━━━━━━━━━━━\n📌 *Video:* ${waitingJob.title}\n🗑️ *Durum:* Yayınlanmadan iptal edildi.`
                    );
                    return true;
                }

                if (isPreview) {
                    publishJobToStatus(waitingJob.jobId, { mode: 'SELF_CHAT_ONLY', alsoSendToSelfChat: true }).catch(err => {
                        console.error('[YT-Status] Önizleme hatası:', err.message);
                    });
                    return true;
                }

                if (isApprove) {
                    await sendSafeMessage(targetChat, `⏳ *Onayınız Alındı!*\n"${waitingJob.title}" videosunun ${waitingJob.totalParts} bölümü sırayla WhatsApp Durumunuzda (Status) yayına alınıyor...`);
                    publishJobToStatus(waitingJob.jobId, { mode: 'STATUS', alsoSendToSelfChat: true }).catch(err => {
                        console.error('[YT-Status] Yayınlama hatası:', err.message);
                    });
                    return true;
                }
            }
        }

        // 3. Mesaj içinde YouTube veya Instagram linki var mı?
        const videoUrl = extractVideoUrl(cleanText);
        if (!videoUrl) {
            return false;
        }

        // WhatsApp Merkezi ON/OFF Yönetim Matrisi kontrolü
        const gate = featureGate.checkIncomingGate(FEATURE_ID, cleanText);
        if (!gate.allowed) {
            console.log(`[YT-Status] 🛑 Video linki algılandı fakat '${FEATURE_ID}' şalteri KAPALI olduğu için işlenmedi.`);
            return true; // Diğer botların (AI vb.) bu linki yanlışlıkla işlememesi için true dönüyoruz
        }

        const isIg = videoUrl.includes('instagram.com');
        console.log(`[YT-Status] 🎬 ${isIg ? 'Instagram' : 'YouTube'} linki algılandı: ${videoUrl}`);
        createAndProcessJob(videoUrl, {
            notifyWhatsapp: true,
            chatId: targetChat,
            source: 'WHATSAPP',
            segmentSeconds: 59
        }).catch(err => {
            console.error('[YT-Status] Video işleme hatası:', err.message);
        });

        return true;
    }

    /**
     * Express HTTP Rotalarını (Port 5055 ve Port 5003 Proxy için) bağlar
     */
    function registerRoutes(app) {
        // 1. Tüm işleri ve ON/OFF şalter durumunu getir
        app.get('/api/yt-status/jobs', (req, res) => {
            try {
                const featureEnabled = featureGate.isFeatureEnabled(FEATURE_ID);
                const masterEnabled = featureGate.isFeatureEnabled('master_incoming_listener');
                const jobs = loadJobs();
                res.json({
                    success: true,
                    featureId: FEATURE_ID,
                    featureEnabled,
                    masterEnabled,
                    activeWaitingJob: getLatestWaitingJob(),
                    jobs
                });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 2. Web arayüzünden yeni YouTube veya Instagram (Reel/Video) linki gönder ve 60sn parçalara böl
        app.post('/api/yt-status/submit', async (req, res) => {
            try {
                const { url, notifyWhatsapp = true, segmentSeconds = 59 } = req.body || {};
                const videoUrl = extractVideoUrl(url || '');
                if (!videoUrl) {
                    return res.status(400).json({ success: false, error: 'Geçerli bir YouTube veya Instagram (Reel/Video) linki giriniz.' });
                }

                // İşlemi başlat ve tamamlanmasını bekle
                const job = await createAndProcessJob(videoUrl, {
                    notifyWhatsapp: Boolean(notifyWhatsapp),
                    chatId: getTargetChatId(),
                    source: 'WEB_PORTAL',
                    segmentSeconds: Number(segmentSeconds) || 59
                });

                res.json({ success: true, job });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 3. Web arayüzünden onay ver ve WhatsApp Status'ta yayınla
        app.post('/api/yt-status/approve/:jobId', async (req, res) => {
            try {
                const { jobId } = req.params;
                const { mode = 'STATUS', alsoSendToSelfChat = true } = req.body || {};
                const job = getJobById(jobId);
                if (!job) {
                    return res.status(404).json({ success: false, error: 'İşlem bulunamadı.' });
                }

                // Arka planda başlat veya bekle
                const result = await publishJobToStatus(jobId, { mode, alsoSendToSelfChat });
                res.json(result);
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 4. İşi iptal et
        app.post('/api/yt-status/cancel/:jobId', async (req, res) => {
            try {
                const { jobId } = req.params;
                const job = getJobById(jobId);
                if (!job) {
                    return res.status(404).json({ success: false, error: 'İşlem bulunamadı.' });
                }
                job.status = 'CANCELLED';
                job.updatedAt = new Date().toISOString();
                saveJobs();

                const targetChat = job.chatId || getTargetChatId();
                if (targetChat) {
                    sendSafeMessage(
                        targetChat,
                        `🛑 *YOUTUBE DURUM YAYINI WEB PANELİNDEN İPTAL EDİLDİ*\n━━━━━━━━━━━━━━━━━━━━\n📌 *Video:* ${job.title}`
                    ).catch(() => {});
                }

                res.json({ success: true, job });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 5. İşi ve dosyalarını sil
        app.delete('/api/yt-status/jobs/:jobId', (req, res) => {
            try {
                const { jobId } = req.params;
                const jobs = loadJobs();
                const idx = jobs.findIndex(j => j.jobId === jobId);
                if (idx === -1) {
                    return res.status(404).json({ success: false, error: 'İşlem bulunamadı.' });
                }
                jobs.splice(idx, 1);
                saveJobs();

                const jobDir = path.join(DOWNLOADS_DIR, jobId);
                if (fs.existsSync(jobDir)) {
                    fs.rmSync(jobDir, { recursive: true, force: true });
                }

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 6. Web arayüzünden ON/OFF şalterini değiştir
        app.post('/api/yt-status/toggle', (req, res) => {
            try {
                const { enabled } = req.body || {};
                const result = featureGate.setFeatureState(FEATURE_ID, Boolean(enabled));
                res.json({
                    success: true,
                    featureId: FEATURE_ID,
                    enabled: featureGate.isFeatureEnabled(FEATURE_ID),
                    result
                });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 6.1 Status Gönderim Teşhis Endpoint'i
        app.post('/api/yt-status/eval', async (req, res) => {
            try {
                const client = getClient();
                if (!client || !client.pupPage) return res.json({ success: false, error: 'No pupPage' });
                const code = req.body.code;
                const result = await client.pupPage.evaluate(new Function(`return (async () => { ${code} })();`));
                res.json({ success: true, result });
            } catch (e) {
                res.json({ success: false, error: e.message, stack: e.stack });
            }
        });

        app.get('/api/yt-status/debug-status', async (req, res) => {
            try {
                const client = getClient();
                if (!client || !client.pupPage) {
                    return res.json({ success: false, error: 'Client / pupPage hazır değil' });
                }

                const debugResult = await client.pupPage.evaluate(async () => {
                    const trace = {};
                    try {
                        const { getMaybeMeLidUser, getMaybeMePnUser } = window.require('WAWebUserPrefsMeUser');
                        const lidUser = getMaybeMeLidUser();
                        const meUser = getMaybeMePnUser();
                        trace.lidUser = lidUser;
                        trace.meUser = meUser;

                        // Check what Msg constructor does
                        const newMsgKey = new (window.require('WAWebMsgKey'))({
                            from: meUser,
                            to: meUser,
                            id: await window.require('WAWebMsgKey').newId(),
                            selfDir: 'out',
                        });

                        trace.msgKey = newMsgKey;

                        // Try creating plain text msg model
                        try {
                            const plainMsg = new (window.require('WAWebCollections').Msg.modelClass)({
                                id: newMsgKey,
                                ack: 0,
                                body: 'test',
                                from: meUser,
                                to: meUser,
                                local: true,
                                self: 'out',
                                isNewMsg: true,
                                type: 'chat'
                            });
                            trace.plainMsgSuccess = true;
                        } catch (pErr) {
                            trace.plainMsgError = pErr.message;
                        }

                        // Try creating media msg model
                        try {
                            const dummyMedia = {
                                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                                mimetype: 'image/png',
                                filename: 'test.png'
                            };
                            const mediaData = await window.WWebJS.processMediaData(dummyMedia, {
                                forceSticker: false, forceGif: false, forceVoice: false, forceDocument: false, forceMediaHd: false, sendToChannel: false, sendToStatus: false
                            });

                            trace.mediaDataKeys = Object.keys(mediaData);
                            trace.mediaDataId = mediaData.id;
                            trace.mediaData_x_id = mediaData.__x_id;
                            const json = mediaData.toJSON ? mediaData.toJSON() : {};
                            trace.mediaDataJsonKeys = Object.keys(json);
                            trace.mediaDataJsonId = json.id;

                            const merged = {
                                ack: 0,
                                body: 'test',
                                from: meUser,
                                to: meUser,
                                local: true,
                                self: 'out',
                                isNewMsg: true,
                                type: 'image',
                                ...mediaData,
                                ...json,
                                id: newMsgKey // explicitly set AFTER spread
                            };
                            delete merged.__x_id;

                            trace.mergedId = merged.id;

                            const mediaMsg = new (window.require('WAWebCollections').Msg.modelClass)(merged);
                            trace.mediaMsgSuccess = true;

                            // TEST STATUS MEDIA MSG
                            try {
                                const statusChat = await window.WWebJS.getChat('status@broadcast', { getAsModel: false });
                                trace.statusChatFound = !!statusChat;

                                const authorWid = window.require('WAWebWidFactory').asUserWidOrThrow(lidUser || meUser);
                                const statusMsgKey = new (window.require('WAWebMsgKey'))({
                                    from: authorWid,
                                    to: statusChat.id,
                                    id: await window.require('WAWebMsgKey').newId(),
                                    participant: authorWid,
                                    selfDir: 'out',
                                });
                                trace.statusMsgKey = statusMsgKey;

                                const statusMerged = {
                                    ...merged,
                                    id: statusMsgKey,
                                    from: authorWid,
                                    to: statusChat.id,
                                    author: authorWid,
                                    cannotBeRanked: false
                                };
                                delete statusMerged.__x_id;

                                const statusMsgModel = new (window.require('WAWebCollections').Msg.modelClass)(statusMerged);
                                statusMsgModel.id = statusMsgKey;
                                trace.statusMsgModelSuccess = true;

                                // Test what sendStatusMediaMsgAction requires
                                const statusAction = window.require('WAWebSendStatusMsgAction');
                                trace.statusActionKeys = Object.keys(statusAction);
                                trace.sendStatusMediaMsgActionStr = statusAction.sendStatusMediaMsgAction.toString();
                            } catch (sErr) {
                                trace.statusMsgError = sErr.message;
                                trace.statusMsgStack = sErr.stack;
                            }
                            trace.mediaMsgSuccess = true;
                        } catch (mErr) {
                            trace.mediaMsgError = mErr.message;
                            trace.mediaMsgStack = mErr.stack;
                        }
                    } catch (e) {
                        trace.topError = e.message;
                    }
                    return trace;
                });

                res.json({ success: true, debugResult });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message, stack: err.stack });
            }
        });

        // 7. Bölümlenmiş MP4 video dosyalarını tarayıcıda önizleme için sun
        app.get('/api/yt-status/video/:jobId/:fileName', (req, res) => {
            try {
                const safeJobId = path.basename(req.params.jobId || '');
                const safeFile = path.basename(req.params.fileName || '');
                const filePath = path.join(DOWNLOADS_DIR, safeJobId, safeFile);
                if (!fs.existsSync(filePath)) {
                    return res.status(404).send('Video dosyası bulunamadı.');
                }
                res.sendFile(filePath);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });
    }

    return {
        FEATURE_ID,
        handleIncomingMessage,
        createAndProcessJob,
        publishJobToStatus,
        registerRoutes,
        loadJobs,
        getLatestWaitingJob
    };
}

module.exports = {
    createYoutubeStatusManager,
    extractYoutubeUrl,
    extractVideoUrl,
    FEATURE_ID
};
