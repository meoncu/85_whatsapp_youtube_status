# 🎬 WhatsApp YouTube & Instagram Reels Durum (Status) Yayıncısı (60sn)

Bu proje; WhatsApp üzerinden veya Web Portalından gönderilen **YouTube Video**, **YouTube Shorts** ve **Instagram Reel / Video** linklerini otomatik indirip, WhatsApp Durum (Status) limitine uygun olarak **maksimum 60 saniyelik parçalara (H.264 + AAC, yuv420p)** bölen ve kullanıcının onayıyla bağlı WhatsApp hesabının Durumunda (`status@broadcast`) sırayla yayınlayan entegre bir otomasyon sistemidir.

---

## 🚀 Özellikler

- 📱 **Çift Platform Desteği:**
  - **YouTube:** Normal videolar ve 9:16 dikey YouTube Shorts videoları.
  - **Instagram:** Instagram Reels ve paylaşılan video gönderileri.
- ✂️ **60 Saniyelik Akıllı Parçalara Bölme:**
  - Uzun videolar FFmpeg ile 60 saniyelik temiz parçalara (`part_01.mp4`, `part_02.mp4`...) bölünür.
  - WhatsApp Durum oynatıcısının takılmaması için `libx264`, `yuv420p`, `aac` ve `+faststart` bayraklarıyla optimize edilir.
- 🤖 **WhatsApp Çift Yönlü Onay Botu:**
  - Kullanıcı WhatsApp'tan bir link attığında sistem videoyu analiz edip parçalara ayırır.
  - Parça sayısını, süreleri ve boyutları bildirerek onay ister (`WAITING_APPROVAL`).
  - **EVET** / **ONAY** yazıldığında tüm bölümler sırayla WhatsApp Durum'da paylaşılır.
  - **ÖNİZLE** yazıldığında parçalar önce sohbete video olarak iletilir.
  - **HAYIR** / **İPTAL** yazıldığında yayın iptal edilir.
  - `/yt` veya `/ig` komutlarıyla servis durumu ve onay bekleyen iş sorgulanabilir.
- 🌐 **Modern Web Yönetim Portalı:**
  - `http://localhost:5003/youtube_status.html` üzerinden görsel kontrol paneli.
  - Web üzerinden manuel link girme, önizleme videosu izleme, tek tıkla Durum'da yayınlama veya iptal etme.
  - WhatsApp Otomatik Dinleme Şalteri (ON/OFF).

---

## 📁 Proje Dosya Yapısı

```
85_whatsapp_youtube_status/
├── BASLAT.bat                 # Portalı tarayıcıda başlatan kısayol betiği
├── youtube_status_manager.js  # Node.js yönetici modülü & Express API rotaları
├── youtube_status.html        # Web yönetim arayüzü & video oynatıcı dashboard
├── yt_processor.py            # yt-dlp & FFmpeg tabanlı indirme ve 60sn bölümleyici
├── jobs_db.json               # İşlem ve durum kayıtları veritabanı
├── .gitignore                 # Medya dosyalarını ve geçici klasörleri hariç tutan kural dosyası
└── README.md                  # Proje dokümantasyonu
```

---

## 🛠️ Kurulum & Gereksinimler

1. **Node.js** (v18+)
2. **Python** (3.10+)
   ```bash
   pip install yt-dlp imageio-ffmpeg
   ```
3. **FFmpeg** (Sistem PATH'inde veya `imageio_ffmpeg` ile kurulu)
4. **WhatsApp Web İstemcisi Entegrasyonu** (`whatsapp-web.js`)

---

## 💻 Kullanım

### 1. Web Paneli ile:
`BASLAT.bat` dosyasını çalıştırın veya tarayıcınızdan:
```
http://localhost:5003/youtube_status.html
```
adresine gidin. Linki yapıştırıp **İndir & 60sn Parçalara Böl** butonuna tıklayın.

### 2. WhatsApp ile:
Yetkili WhatsApp numaranıza herhangi bir YouTube veya Instagram video linki atın:
- Örnek YouTube: `https://youtube.com/shorts/...`
- Örnek Instagram: `https://www.instagram.com/reel/...`

Gelen özet mesaja **EVET** yazarak Durumunuzda yayınlayın.

---

## 📄 Lisans
Bu proje özel kullanım ve kurumsal otomasyon amaçlı geliştirilmiştir.
