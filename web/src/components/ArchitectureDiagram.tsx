/** Yerel mimari şeması: sunucu bilgisayar + otel içi ağdaki istemciler. Temsili; işletme verisi içermez. */
export function ArchitectureDiagram() {
  const clients = [
    { x: 24, label: 'Resepsiyon' },
    { x: 172, label: 'Ön kasa' },
    { x: 320, label: 'Kat hizmetleri' },
    { x: 468, label: 'Yönetim' },
  ];
  return (
    <svg viewBox="0 0 600 400" role="img" aria-labelledby="arch-t arch-d">
      <title id="arch-t">Yerel kurulum şeması</title>
      <desc id="arch-d">Otelin sunucu bilgisayarında PMS servisi ve veritabanı çalışır; resepsiyon, ön kasa, kat hizmetleri ve yönetim bilgisayarları otel içi ağ üzerinden bağlanır.</desc>
      <rect x="150" y="16" width="300" height="132" rx="16" fill="#eff6ff" stroke="#bfdbfe" />
      <text x="300" y="44" textAnchor="middle" fontSize="15" fontWeight="700" fill="#1e3a8a">Otelin sunucu bilgisayarı</text>
      <rect x="170" y="60" width="124" height="70" rx="10" fill="#fff" stroke="#93c5fd" />
      <text x="232" y="88" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">PMS Servisi</text>
      <text x="232" y="107" textAnchor="middle" fontSize="11" fill="#5b6b82">HTTPS · anlık bildirim</text>
      <rect x="306" y="60" width="124" height="70" rx="10" fill="#fff" stroke="#93c5fd" />
      <text x="368" y="88" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">Veritabanı</text>
      <text x="368" y="107" textAnchor="middle" fontSize="11" fill="#5b6b82">yalnız bu bilgisayar</text>
      <line x1="294" y1="95" x2="306" y2="95" stroke="#2563eb" strokeWidth="2" />

      <line x1="300" y1="148" x2="300" y2="200" stroke="#2563eb" strokeWidth="2" />
      <rect x="40" y="200" width="520" height="34" rx="17" fill="#1d4ed8" />
      <text x="300" y="222" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">Otel içi ağ (LAN) — internet gerekmez</text>

      {clients.map(c => (
        <g key={c.label}>
          <line x1={c.x + 54} y1="234" x2={c.x + 54} y2="272" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" />
          <rect x={c.x} y="272" width="108" height="74" rx="10" fill="#fff" stroke="#cbd5e1" />
          <rect x={c.x + 14} y="284" width="80" height="34" rx="4" fill="#f1f5f9" stroke="#e2e8f0" />
          <rect x={c.x + 20} y="291" width="30" height="5" rx="2" fill="#93c5fd" />
          <rect x={c.x + 20} y="301" width="60" height="4" rx="2" fill="#cbd5e1" />
          <rect x={c.x + 20} y="309" width="44" height="4" rx="2" fill="#cbd5e1" />
          <text x={c.x + 54} y="336" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#0f172a">{c.label}</text>
        </g>
      ))}
      <text x="300" y="380" textAnchor="middle" fontSize="12" fill="#5b6b82">Her bilgisayarda PMS Client uygulaması · veriler otelin içinde kalır</text>
    </svg>
  );
}
