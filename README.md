# METAR Airspace

Gerçek dünya hava sahası için canlı ADS-B uçak konumları ve resmî METAR/TAF gösteren, bağımlılıksız bir web uygulaması.

## Çalıştırma

En kolay yöntem [start.cmd](start.cmd) dosyasına çift tıklamaktır. Bu dosya önce sistemdeki Node.js'i, ardından Codex'in paketli Node çalışma zamanını dener.

Sisteminizde Node.js 18 veya üstü kuruluysa proje klasöründe aşağıdaki komutu da çalıştırabilirsiniz:

```bash
npm start
```

Ardından [http://localhost:3000](http://localhost:3000) adresini açın.

`server.mjs`, sayfayı sunar ve yalnızca Aviation Weather Center'ın METAR/TAF uç noktalarına istek aktarır. Bunun nedeni resmî kaynağın tarayıcıdan doğrudan CORS erişimine izin vermemesidir. Herhangi bir genel CORS proxy, VATSIM kaynağı veya API anahtarı kullanılmaz.

## Veri sınırları

- Uçak noktaları: public ADS-B yayınları; kapsama alanı ve gecikme alıcı ağına bağlıdır.
- METAR/TAF: Aviation Weather Center'ın güncel raporları.
- D-ATIS: küresel, tek ve açık bir veri akışı değildir. Bir ANSP/havaalanı veya lisanslı sağlayıcı entegrasyonu olmadan panelde “veri yok” olarak kalır.
- FIR çizgileri: DHMİ AIP ENR 2.1'de yayınlanan LTAA Ankara ve LTBB İstanbul FIR koordinatlarına dayalı görsel referans katmanıdır. Operasyonel seyrüsefer veya sınır tespiti için kullanılmaz; AIRAC değişikliklerinde güncellenmelidir.
- Uygulama uçuş takip veya operasyonel karar verme aracı değildir.
