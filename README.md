# METAR Airspace

Gerçek dünya hava sahası için canlı ADS-B uçak konumları ve resmî METAR/TAF gösteren, bağımlılıksız bir web uygulaması.

## Çalıştırma

En kolay yöntem [start.cmd](start.cmd) dosyasına çift tıklamaktır. Bu dosya önce sistemdeki Node.js'i, ardından Codex'in paketli Node çalışma zamanını dener.

Sisteminizde Node.js 18 veya üstü kuruluysa proje klasöründe aşağıdaki komutu da çalıştırabilirsiniz:

```bash
npm start
```

Ardından [http://localhost:3000](http://localhost:3000) adresini açın.

`server.mjs`, sayfayı sunar ve yalnızca Aviation Weather Center'ın METAR/TAF uç noktalarına istek aktarır. Bunun nedeni resmî kaynağın tarayıcıdan doğrudan CORS erişimine izin vermemesidir. Herhangi bir genel CORS proxy veya API anahtarı kullanılmaz.

## 📡 Veri Kaynakları

1. **Hava Trafiği (ADS-B):** [airplanes.live](https://airplanes.live) küresel ADS-B ağından anlık olarak (her 30 saniyede bir) çekilir. Uygulama tüm trafik tamamen gerçektir.
2. **Hava Durumu (METAR/TAF):** Resmi kaynaklardan (Aviation Weather Center) sağlanan gerçek hava durumu bültenleridir.
3. **Meydan ve Pist Bilgileri:** Küresel Açık Harita (OpenStreetMap / Overpass) kaynaklı güncel navigasyon altyapısıdır.
- Uygulama uçuş takip veya operasyonel karar verme aracı değildir.
