import type { Guest } from '../lib/types';
import { useCompanies } from '../lib/queries';
import { Field } from './ui';

export const ID_TYPES: Record<string, string> = { tckn: 'T.C. Kimlik No', passport: 'Pasaport', id_card: 'Kimlik kartı', driver_license: 'Ehliyet', other: 'Diğer' };

export const MARITAL: Record<string, string> = { single: 'Bekâr', married: 'Evli', divorced: 'Boşanmış', widowed: 'Dul' };
export const LANGUAGES: Record<string, string> = { tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', ru: 'Rusça', ar: 'Arapça', fr: 'Fransızca', fa: 'Farsça', nl: 'Felemenkçe', it: 'İtalyanca', es: 'İspanyolca', uk: 'Ukraynaca', az: 'Azerice', zh: 'Çince' };

export interface GuestDraft {
  firstName: string; lastName: string; gender: string; birthDate: string; birthPlace: string; fatherName: string; motherName: string; nationality: string;
  identityType: string; identityNumber: string; identityCountry: string; identityExpiry: string; phone: string; email: string; address: string; city: string; country: string;
  taxOffice: string; taxNumber: string; companyId: string; notes: string; preferences: string; isVip: boolean; vipLevel: string; kvkkConsent: boolean; marketingConsent: boolean;
  title: string; maritalStatus: string; language: string; phone2: string; identitySerial: string; identityIssuePlace: string; identityIssueDate: string;
  district: string; postalCode: string; vehiclePlate: string; alertNote: string;
}

export const emptyGuest = (): GuestDraft => ({
  firstName: '', lastName: '', gender: '', birthDate: '', birthPlace: '', fatherName: '', motherName: '', nationality: 'TR', identityType: 'tckn', identityNumber: '',
  identityCountry: '', identityExpiry: '', phone: '', email: '', address: '', city: '', country: 'TR', taxOffice: '', taxNumber: '', companyId: '', notes: '', preferences: '',
  isVip: false, vipLevel: '', kvkkConsent: false, marketingConsent: false,
  title: '', maritalStatus: '', language: '', phone2: '', identitySerial: '', identityIssuePlace: '', identityIssueDate: '', district: '', postalCode: '', vehiclePlate: '', alertNote: '',
});

export function guestToDraft(g: Guest): GuestDraft {
  const s = (v?: string | null) => v ?? '';
  return {
    firstName: g.firstName, lastName: g.lastName, gender: s(g.gender), birthDate: s(g.birthDate), birthPlace: s(g.birthPlace), fatherName: s(g.fatherName), motherName: s(g.motherName),
    nationality: s(g.nationality), identityType: s(g.identityType), identityNumber: s(g.identityNumber), identityCountry: s(g.identityCountry), identityExpiry: s(g.identityExpiry),
    phone: s(g.phone), email: s(g.email), address: s(g.address), city: s(g.city), country: s(g.country), taxOffice: s(g.taxOffice), taxNumber: s(g.taxNumber), companyId: s(g.companyId),
    notes: s(g.notes), preferences: s(g.preferences), isVip: g.isVip, vipLevel: s(g.vipLevel), kvkkConsent: g.kvkkConsent, marketingConsent: g.marketingConsent,
    title: s(g.title), maritalStatus: s(g.maritalStatus), language: s(g.language), phone2: s(g.phone2), identitySerial: s(g.identitySerial),
    identityIssuePlace: s(g.identityIssuePlace), identityIssueDate: s(g.identityIssueDate), district: s(g.district), postalCode: s(g.postalCode),
    vehiclePlate: s(g.vehiclePlate), alertNote: s(g.alertNote),
  };
}

/** Sunucuya gidecek gövde: boş metinler null olur. */
export function draftToBody(d: GuestDraft, version?: number) {
  const n = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    firstName: d.firstName.trim(), lastName: d.lastName.trim(), gender: n(d.gender), birthDate: n(d.birthDate), birthPlace: n(d.birthPlace), fatherName: n(d.fatherName),
    motherName: n(d.motherName), nationality: n(d.nationality)?.toUpperCase() ?? null, identityType: n(d.identityType), identityNumber: n(d.identityNumber),
    identityCountry: n(d.identityCountry)?.toUpperCase() ?? null, identityExpiry: n(d.identityExpiry), phone: n(d.phone), email: n(d.email), address: n(d.address), city: n(d.city),
    country: n(d.country)?.toUpperCase() ?? null, taxOffice: n(d.taxOffice), taxNumber: n(d.taxNumber), companyId: n(d.companyId), notes: n(d.notes), preferences: n(d.preferences),
    isVip: d.isVip, vipLevel: n(d.vipLevel), kvkkConsent: d.kvkkConsent, marketingConsent: d.marketingConsent, version: version ?? null,
    title: n(d.title), maritalStatus: n(d.maritalStatus), language: n(d.language), phone2: n(d.phone2), identitySerial: n(d.identitySerial),
    identityIssuePlace: n(d.identityIssuePlace), identityIssueDate: n(d.identityIssueDate), district: n(d.district), postalCode: n(d.postalCode),
    vehiclePlate: n(d.vehiclePlate), alertNote: n(d.alertNote),
  };
}

export function GuestFields({ value: g, onChange, compact }: { value: GuestDraft; onChange: (g: GuestDraft) => void; compact?: boolean }) {
  const companies = useCompanies();
  const set = (k: keyof GuestDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...g, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <div className="form-grid">
      <Field label="Ad" required><input className="input" value={g.firstName} onChange={set('firstName')} maxLength={80} /></Field>
      <Field label="Soyad" required><input className="input" value={g.lastName} onChange={set('lastName')} maxLength={80} /></Field>
      <Field label="Uyruk" hint="Ülke kodu, örn. TR, DE"><input className="input" value={g.nationality} onChange={set('nationality')} maxLength={2} /></Field>
      <Field label="Cinsiyet"><select className="input" value={g.gender} onChange={set('gender')}><option value="">—</option><option value="female">Kadın</option><option value="male">Erkek</option><option value="other">Diğer</option></select></Field>
      <Field label="Kimlik türü"><select className="input" value={g.identityType} onChange={set('identityType')}><option value="">—</option>{Object.entries(ID_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Kimlik / pasaport no" className="span-2"><input className="input mono" value={g.identityNumber} onChange={set('identityNumber')} maxLength={30} /></Field>
      <Field label="Doğum tarihi"><input type="date" className="input" value={g.birthDate} onChange={set('birthDate')} /></Field>
      <Field label="Telefon"><input className="input" value={g.phone} onChange={set('phone')} maxLength={30} /></Field>
      <Field label="E-posta" className="span-2"><input className="input" type="email" value={g.email} onChange={set('email')} maxLength={160} /></Field>
      <Field label="VIP"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={g.isVip} onChange={set('isVip')} /> VIP misafir</label></Field>
      {!compact && <>
        <Field label="Hitap"><input className="input" list="guest-titles" value={g.title} onChange={set('title')} maxLength={20} />
          <datalist id="guest-titles"><option value="Bay" /><option value="Bayan" /><option value="Dr." /><option value="Prof. Dr." /><option value="Av." /><option value="Mr." /><option value="Mrs." /><option value="Ms." /></datalist></Field>
        <Field label="Medeni hali"><select className="input" value={g.maritalStatus} onChange={set('maritalStatus')}><option value="">—</option>{Object.entries(MARITAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Dil"><select className="input" value={g.language} onChange={set('language')}><option value="">—</option>{Object.entries(LANGUAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          {g.language && !LANGUAGES[g.language] && <option value={g.language}>{g.language.toUpperCase()}</option>}</select></Field>
        <Field label="İkinci telefon"><input className="input" value={g.phone2} onChange={set('phone2')} maxLength={30} /></Field>
        <Field label="Doğum yeri"><input className="input" value={g.birthPlace} onChange={set('birthPlace')} /></Field>
        <Field label="Baba adı"><input className="input" value={g.fatherName} onChange={set('fatherName')} /></Field>
        <Field label="Anne adı"><input className="input" value={g.motherName} onChange={set('motherName')} /></Field>
        <Field label="Belge seri no"><input className="input mono" value={g.identitySerial} onChange={set('identitySerial')} maxLength={30} /></Field>
        <Field label="Kimlik veren ülke"><input className="input" value={g.identityCountry} onChange={set('identityCountry')} maxLength={2} /></Field>
        <Field label="Belgenin verildiği yer"><input className="input" value={g.identityIssuePlace} onChange={set('identityIssuePlace')} maxLength={100} /></Field>
        <Field label="Veriliş tarihi"><input type="date" className="input" value={g.identityIssueDate} onChange={set('identityIssueDate')} /></Field>
        <Field label="Kimlik geçerlilik"><input type="date" className="input" value={g.identityExpiry} onChange={set('identityExpiry')} /></Field>
        <Field label="Adres" className="span-2"><input className="input" value={g.address} onChange={set('address')} /></Field>
        <Field label="İlçe"><input className="input" value={g.district} onChange={set('district')} maxLength={100} /></Field>
        <Field label="Şehir"><input className="input" value={g.city} onChange={set('city')} /></Field>
        <Field label="Posta kodu"><input className="input" value={g.postalCode} onChange={set('postalCode')} maxLength={20} /></Field>
        <Field label="Ülke"><input className="input" value={g.country} onChange={set('country')} maxLength={2} /></Field>
        <Field label="Araç plakası"><input className="input mono" value={g.vehiclePlate} onChange={set('vehiclePlate')} maxLength={20} /></Field>
        <Field label="Vergi dairesi"><input className="input" value={g.taxOffice} onChange={set('taxOffice')} /></Field>
        <Field label="Vergi / T.C. no (fatura)"><input className="input mono" value={g.taxNumber} onChange={set('taxNumber')} maxLength={20} /></Field>
        <Field label="Şirket" className="span-2"><select className="input" value={g.companyId} onChange={set('companyId')}><option value="">—</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        {g.isVip && <Field label="VIP seviyesi"><input className="input" value={g.vipLevel} onChange={set('vipLevel')} maxLength={20} /></Field>}
        <Field label="Tercihler" className="span-2"><input className="input" value={g.preferences} onChange={set('preferences')} placeholder="Yüksek kat, yastık tercihi…" /></Field>
        <Field label="Notlar" className="span-4"><textarea className="input" rows={2} value={g.notes} onChange={set('notes')} /></Field>
        <Field label="Resepsiyon uyarısı" className="span-4" hint="Doluysa misafirin rezervasyonu açıldığında ve girişte uyarı olarak gösterilir."><input className="input" value={g.alertNote} onChange={set('alertNote')} maxLength={500} placeholder="ör. Ödemeyi peşin alın · Sigara içilmeyen oda istiyor" /></Field>
      </>}
      <div className="span-4 row wrap">
        <label className="check"><input type="checkbox" checked={g.kvkkConsent} onChange={set('kvkkConsent')} /> KVKK aydınlatması yapıldı / açık rıza alındı</label>
        <label className="check"><input type="checkbox" checked={g.marketingConsent} onChange={set('marketingConsent')} /> Ticari ileti izni</label>
      </div>
    </div>
  );
}
