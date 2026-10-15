import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Ban, CreditCard, FilePlus2, Lock, Percent, Plus, Printer, Receipt, RotateCcw, Undo2, Unlock } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { ExchangeRatesView, Folio, FolioDetail, FolioLine, Reservation } from '../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, fmtRate, isZero, LINE_LABEL, parseRate } from '../lib/format';
import { useAgencies, useCompanies, usePaymentMethods, useTransactionCodes } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { DocFooter, DocHeader } from './PrintDoc';
import { Badge, Empty, ErrorBox, Field, Modal, Money, MoneyInput, Spinner, useContextMenu } from './ui';

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: q => ['folio', 'folios', 'reservation', 'reservations', 'dashboard', 'cashier', 'accounts'].includes(String(q.queryKey[0])) });
}

type Dialog =
  | { kind: 'charge' } | { kind: 'payment' } | { kind: 'refund' } | { kind: 'discount'; line?: FolioLine } | { kind: 'void'; line: FolioLine }
  | { kind: 'transfer'; line: FolioLine } | { kind: 'balance' } | { kind: 'newFolio' } | { kind: 'invoice' } | { kind: 'reopen' } | null;

export function FolioPanel({ reservation, folioId: fixedFolio }: { reservation?: Reservation; folioId?: string }) {
  const { can } = useSession();
  const refresh = useRefresh();
  const menu = useContextMenu();
  const folios = useQuery({
    queryKey: ['folios', reservation?.id ?? fixedFolio],
    queryFn: () => (reservation ? get<Folio[]>(`/api/v1/folios${qs({ reservationId: reservation.id })}`) : Promise.resolve([] as Folio[])),
  });
  const [sel, setSel] = useState<string | null>(fixedFolio ?? null);
  const activeId = sel ?? folios.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ['folio', activeId], queryFn: () => get<FolioDetail>(`/api/v1/folios/${activeId}`), enabled: !!activeId });
  const [dlg, setDlg] = useState<Dialog>(null);
  const [printing, setPrinting] = useState(false);
  const f = detail.data?.folio;
  const editable = f?.status === 'open';

  const close = useAction(async (key: string) => { await post(`/api/v1/folios/${f!.id}/close`, { version: f!.version }, key); await refresh(); }, { success: 'Folyo kapatıldı.' });
  const routing = useAction(async (key: string, w: number) => { await post(`/api/v1/reservations/${reservation!.id}/routing`, { roomChargeWindow: w }, key); await refresh(); }, { success: 'Oda ücreti yönlendirmesi güncellendi.' });

  const lineMenu = (e: React.MouseEvent, l: FolioLine) => {
    if (!editable || l.isVoided || l.lineType === 'void') return;
    menu.open(e, [
      { label: 'Satırı iptal et', icon: <Ban size={14} />, disabled: !can('folio.void'), onClick: () => setDlg({ kind: 'void', line: l }) },
      { label: 'Başka folyoya aktar', icon: <ArrowRightLeft size={14} />, disabled: !can('folio.transfer') || l.lineType !== 'charge', onClick: () => setDlg({ kind: 'transfer', line: l }) },
      { label: 'Bu masrafa indirim', icon: <Percent size={14} />, disabled: !can('folio.discount') || l.lineType !== 'charge', onClick: () => setDlg({ kind: 'discount', line: l }) },
    ]);
  };

  if (folios.isLoading) return <Spinner />;
  if (folios.error) return <ErrorBox error={folios.error} />;
  if (!activeId) return <Empty icon={<Receipt />} title="Folyo bulunmuyor" text="Rezervasyonun folyosu girişte veya ilk işlemde oluşturulur." action={reservation && can('folio.post') ? <button className="btn" onClick={() => setDlg({ kind: 'newFolio' })}><FilePlus2 /> Folyo aç</button> : undefined} />;

  return (
    <div className="stack">
      {reservation && (
        <div className="folio-tabs">
          {folios.data?.map(x => (
            <button key={x.id} className={`folio-tab ${x.id === activeId ? 'active' : ''}`} onClick={() => setSel(x.id)}>
              <b>Pencere {x.windowNo}</b> · {x.name} {x.status === 'closed' && <Badge color="gray">Kapalı</Badge>}
              <small>{x.folioNumber} · Bakiye {fmtMoney(x.balance, x.currency)}{reservation.roomChargeWindow === x.windowNo ? ' · oda ücreti' : ''}</small>
            </button>
          ))}
          {can('folio.post') && <button className="btn sm" onClick={() => setDlg({ kind: 'newFolio' })}><FilePlus2 /> Yeni pencere</button>}
        </div>
      )}
      {detail.isLoading || !f ? <Spinner /> : (
        <>
          <div className="row wrap">
            {editable && can('folio.post') && <button className="btn sm" onClick={() => setDlg({ kind: 'charge' })}><Plus /> Masraf</button>}
            {editable && can('payment.create') && <button className="btn sm primary" onClick={() => setDlg({ kind: 'payment' })}><CreditCard /> Tahsilat</button>}
            {editable && can('payment.refund') && <button className="btn sm" onClick={() => setDlg({ kind: 'refund' })}><Undo2 /> İade</button>}
            {editable && can('folio.discount') && <button className="btn sm" onClick={() => setDlg({ kind: 'discount' })}><Percent /> İndirim</button>}
            {editable && can('folio.transfer') && !isZero(f.balance) && <button className="btn sm" onClick={() => setDlg({ kind: 'balance' })}><ArrowRightLeft /> Bakiye aktar</button>}
            {reservation && can('folio.transfer') && reservation.roomChargeWindow !== f.windowNo && reservation.status !== 'checked_out' &&
              <button className="btn sm" disabled={routing.busy} onClick={() => void routing.run(f.windowNo)}>Oda ücretini bu pencereye yönlendir</button>}
            <span className="spacer" />
            <button className="btn sm" onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 50); }}><Printer /> Yazdır</button>
            {can('folio.close') && (f.invoiceNumber ? <span className="muted">Fatura: {f.invoiceNumber} · {fmtDate(f.invoiceDate)}</span> : <button className="btn sm" onClick={() => setDlg({ kind: 'invoice' })}>Fatura no gir</button>)}
            {editable && can('folio.close') && <button className="btn sm" disabled={!isZero(f.balance) || close.busy} title={isZero(f.balance) ? '' : 'Bakiyesi sıfır olmayan folyo kapatılamaz'} onClick={() => void close.run()}><Lock /> Kapat</button>}
            {!editable && can('folio.close') && <button className="btn sm" onClick={() => setDlg({ kind: 'reopen' })}><Unlock /> Yeniden aç</button>}
          </div>

          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="dt">
              <thead><tr><th>İş günü</th><th>Tür</th><th>Açıklama</th><th>Oda</th><th style={{ textAlign: 'right' }}>Miktar</th><th style={{ textAlign: 'right' }}>Tutar</th><th>Kullanıcı</th><th>Zaman</th></tr></thead>
              <tbody>
                {detail.data!.lines.map(l => (
                  <tr key={l.id} className={l.isVoided ? 'strike' : ''} onContextMenu={e => lineMenu(e, l)} onClick={e => lineMenu(e, l)} style={{ cursor: editable ? 'context-menu' : undefined }}>
                    <td>{fmtDate(l.businessDate)}</td>
                    <td>{LINE_LABEL[l.lineType] ?? l.lineType}{l.paymentMethod ? ` · ${l.paymentMethod}` : ''}</td>
                    <td>{l.description}{l.reference && <span className="muted"> · {l.reference}</span>}{l.reason && <span className="muted"> · {l.reason}</span>}{l.isVoided && <Badge color="red">İptal edildi</Badge>}</td>
                    <td>{l.roomNumber}</td>
                    <td className="num">{l.lineType === 'charge' ? fmtQty(l.quantity) : ''}</td>
                    <td className="num"><Money value={l.amount} colored /></td>
                    <td>{l.username}</td>
                    <td className="muted">{fmtDateTime(l.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Borç {fmtMoney(f.totalCharges)} · Alacak {fmtMoney(f.totalCredits)}</td><td className="num"><b>{fmtMoney(f.balance, f.currency)}</b></td><td colSpan={2}>Bakiye</td></tr>
              </tfoot>
            </table>
            {detail.data!.lines.length === 0 && <Empty title="Bu folyoda henüz işlem yok" />}
          </div>
          {editable && <div className="muted" style={{ fontSize: 11.5 }}>Satır üzerinde tıklayarak iptal, aktarım veya indirim işlemlerini açabilirsiniz. İşlemler silinmez; düzeltme ayrı satır olarak kaydedilir.</div>}
        </>
      )}
      {menu.node}
      {dlg && f && <FolioDialog dlg={dlg} folio={f} reservation={reservation} folios={folios.data ?? []} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg?.kind === 'newFolio' && !f && reservation && <FolioDialog dlg={dlg} reservation={reservation} folios={[]} onClose={() => setDlg(null)} onDone={refresh} />}
      {printing && f && detail.data && createPortal(<FolioPrint detail={detail.data} reservation={reservation} />, document.getElementById('print-root')!)}
    </div>
  );
}

function FolioDialog({ dlg, folio, reservation, folios, onClose, onDone }: { dlg: NonNullable<Dialog>; folio?: Folio; reservation?: Reservation; folios: Folio[]; onClose: () => void; onDone: () => Promise<unknown> }) {
  const codes = useTransactionCodes();
  const methods = usePaymentMethods();
  const companies = useCompanies();
  const agencies = useAgencies();
  const { can } = useSession();
  const cashier = useQuery({ queryKey: ['cashier', 'current'], queryFn: () => get<unknown>('/api/v1/cashier/current'), enabled: can('cashier.manage') });
  const isMoney = dlg.kind === 'payment' || dlg.kind === 'refund';
  const fx = useQuery({ queryKey: ['exchangeRates'], queryFn: () => get<ExchangeRatesView>('/api/v1/exchange-rates'), enabled: isMoney });
  const [v, setV] = useState<Record<string, string>>({ quantity: '1', kind: 'discount', payerKind: 'guest', invoiceDate: new Date().toISOString().slice(0, 10) });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV(s => ({ ...s, [k]: e.target.value }));
  const setVal = (k: string) => (x: string) => setV(s => ({ ...s, [k]: x }));
  const method = methods.data?.find(m => m.id === v.methodId);
  const code = codes.data?.find(c => c.id === v.codeId);
  const others = folios.filter(x => x.id !== folio?.id && x.status === 'open');
  // Dövizli işlem: tutar sunucuda kurla hesaplanır; burada yalnız bilgi amaçlı yaklaşık karşılık gösterilir.
  const tCur = v.currency && v.currency !== folio?.currency ? v.currency : null;
  const fxRate = tCur ? fx.data?.rates.find(r => r.currency === tCur) : undefined;
  const manualRate = v.rate ? parseRate(v.rate) : null;
  const appliedRate = manualRate ?? fxRate?.rate;
  const approx = tCur && v.tendered && appliedRate ? (Math.round(Number(v.tendered) * Number(appliedRate) * 100) / 100).toFixed(2) : null;
  const money = tCur
    ? { tenderedCurrency: tCur, tenderedAmount: v.tendered, exchangeRate: manualRate, amount: approx ?? '0' }
    : { amount: v.amount };

  const act = useAction(async (key: string) => {
    const id = folio?.id;
    switch (dlg.kind) {
      case 'charge': await post(`/api/v1/folios/${id}/charges`, { transactionCodeId: v.codeId, description: v.description || null, quantity: v.quantity, unitPrice: v.unitPrice, reference: v.reference || null }, key); break;
      case 'payment': await post(`/api/v1/folios/${id}/payments`, { paymentMethodId: v.methodId, ...money, description: v.description || null, reference: v.reference || null, companyId: v.companyId || null, agencyId: v.agencyId || null, isDeposit: v.isDeposit === '1' }, key); break;
      case 'refund': await post(`/api/v1/folios/${id}/refunds`, { paymentMethodId: v.methodId, ...money, reason: v.reason, reference: v.reference || null }, key); break;
      case 'discount': await post(`/api/v1/folios/${id}/discounts`, { kind: v.kind, amount: v.amount, reason: v.reason, relatedLineId: dlg.line?.id ?? null }, key); break;
      case 'void': await post(`/api/v1/folio-lines/${dlg.line.id}/void`, { reason: v.reason }, key); break;
      case 'transfer': await post(`/api/v1/folio-lines/${dlg.line.id}/transfer`, { targetFolioId: v.target, amount: v.amount || null, reason: v.reason }, key); break;
      case 'balance': await post(`/api/v1/folios/${id}/transfer-balance`, { targetFolioId: v.target, reason: v.reason }, key); break;
      case 'newFolio': await post(`/api/v1/folios${qs({ reservationId: reservation!.id })}`, { payerKind: v.payerKind, companyId: v.payerKind === 'company' ? v.companyId : null, agencyId: v.payerKind === 'agency' ? v.agencyId : null, name: v.name || null }, key); break;
      case 'invoice': await post(`/api/v1/folios/${id}/invoice-reference`, { invoiceNumber: v.invoiceNumber, invoiceDate: v.invoiceDate }, key); break;
      case 'reopen': await post(`/api/v1/folios/${id}/reopen`, { reason: v.reason }, key); break;
    }
    await onDone();
  }, { success: 'İşlem kaydedildi.' });

  const toAccount = method && ['city_ledger', 'company', 'agency'].includes(method.kind);
  const needsShift = (dlg.kind === 'payment' || dlg.kind === 'refund') && !toAccount && cashier.isFetched && !cashier.data;
  const ok = {
    charge: !!v.codeId && !!v.unitPrice && Number(v.quantity) > 0,
    payment: !!v.methodId && (tCur ? !!v.tendered && !!appliedRate && !toAccount : !!v.amount) && (!method?.requiresReference || !!v.reference) && (!toAccount || !!v.companyId || !!v.agencyId) && !needsShift,
    refund: !!v.methodId && (tCur ? !!v.tendered && !!appliedRate : !!v.amount) && !!v.reason?.trim() && !needsShift,
    discount: !!v.amount && !!v.reason?.trim(),
    void: !!v.reason?.trim(),
    transfer: !!v.target && !!v.reason?.trim(),
    balance: !!v.target && !!v.reason?.trim(),
    newFolio: v.payerKind === 'guest' || (v.payerKind === 'company' && !!v.companyId) || (v.payerKind === 'agency' && !!v.agencyId),
    invoice: !!v.invoiceNumber?.trim() && !!v.invoiceDate,
    reopen: !!v.reason?.trim(),
  }[dlg.kind];

  const titles: Record<string, string> = { charge: 'Masraf ekle', payment: 'Tahsilat', refund: 'İade', discount: 'İndirim / allowance', void: 'Satır iptali', transfer: 'Satır aktarımı', balance: 'Bakiye aktarımı', newFolio: 'Yeni folyo penceresi', invoice: 'Fatura bilgisi', reopen: 'Folyoyu yeniden aç' };
  const reason = <Field label="Gerekçe" required className="span-4"><input className="input" value={v.reason ?? ''} onChange={set('reason')} maxLength={300} /></Field>;

  return (
    <Modal title={`${titles[dlg.kind]}${folio ? ` · ${folio.folioNumber}` : ''}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className={`btn ${dlg.kind === 'void' ? 'danger' : 'primary'}`} disabled={!ok || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>{act.busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
    </>}>
      <div className="form-grid">
        {dlg.kind === 'charge' && <>
          <Field label="İşlem kodu" required className="span-4">
            <select className="input" value={v.codeId ?? ''} onChange={e => { const c = codes.data?.find(x => x.id === e.target.value); setV(s => ({ ...s, codeId: e.target.value, unitPrice: c?.defaultPrice ?? s.unitPrice ?? '' })); }} autoFocus>
              <option value="">Seçin</option>{codes.data?.filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax').map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          {codes.data && codes.data.filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax').length === 0 && <div className="warn-box span-4">Tanımlı işlem kodu yok. Yönetim → İşlem Kodları ve Ödeme Tipleri ekranından ekleyin.</div>}
          <Field label="Miktar" required><input className="input num" value={v.quantity} onChange={set('quantity')} inputMode="decimal" /></Field>
          <Field label="Birim fiyat" required><MoneyInput value={v.unitPrice ?? ''} onChange={setVal('unitPrice')} /></Field>
          <Field label="KDV" ><input className="input" disabled value={code ? `%${code.vatRate}` : ''} /></Field>
          <Field label="Referans"><input className="input" value={v.reference ?? ''} onChange={set('reference')} /></Field>
          <Field label="Açıklama" className="span-4"><input className="input" value={v.description ?? ''} onChange={set('description')} placeholder={code?.name} /></Field>
        </>}
        {(dlg.kind === 'payment' || dlg.kind === 'refund') && <>
          <Field label="Ödeme tipi" required className="span-2">
            <select className="input" value={v.methodId ?? ''} onChange={set('methodId')} autoFocus>
              <option value="">Seçin</option>{methods.data?.filter(m => m.isActive && (dlg.kind === 'payment' || !['city_ledger', 'company', 'agency'].includes(m.kind))).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          {(fx.data?.currencies.length ?? 0) > 0 && !toAccount && (
            <Field label="Para birimi" className="span-2">
              <select className="input" value={v.currency ?? folio?.currency ?? ''} onChange={e => setV(s => ({ ...s, currency: e.target.value, tendered: '', rate: '' }))}>
                <option value={folio?.currency}>{folio?.currency}</option>
                {fx.data!.currencies.filter(c => c !== folio?.currency).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}
          {!tCur ? (
            <Field label="Tutar" required className="span-2" hint={folio && dlg.kind === 'payment' ? `Bakiye ${fmtMoney(folio.balance, folio.currency)}` : undefined}>
              <div className="row"><MoneyInput value={v.amount ?? ''} onChange={setVal('amount')} />{folio && dlg.kind === 'payment' && !folio.balance.startsWith('-') && !isZero(folio.balance) && <button className="btn sm" onClick={() => setVal('amount')(folio.balance)}>Tamamı</button>}</div>
            </Field>
          ) : <>
            <Field label={`${dlg.kind === 'payment' ? 'Alınan' : 'Verilen'} ${tCur}`} required className="span-2"
              hint={fxRate ? `Kur ${fmtRate(fxRate.rate)} (${fmtDate(fxRate.rateDate)})` : 'Bu döviz için kur girilmemiş'}>
              <div className="row"><MoneyInput value={v.tendered ?? ''} onChange={setVal('tendered')} />
                {folio && dlg.kind === 'payment' && appliedRate && Number(folio.balance) > 0 && <button className="btn sm" title="Bakiyenin döviz karşılığı" onClick={() => setVal('tendered')((Math.ceil(Number(folio.balance) / Number(appliedRate) * 100) / 100).toFixed(2))}>Tamamı</button>}</div>
            </Field>
            {can('exchange_rate.manage') && <Field label="Kur (elle, isteğe bağlı)" className="span-2" hint="Boşsa günün kuru kullanılır"><input className="input num" value={v.rate ?? ''} onChange={set('rate')} inputMode="decimal" placeholder={fxRate ? fmtRate(fxRate.rate) : ''} /></Field>}
            <div className="span-4 info-box">
              {approx ? <>Folyoya işlenecek tutar ≈ <b>{fmtMoney(approx, folio?.currency)}</b> (kesin tutar kayıtta hesaplanır).</> : !appliedRate ? <>{tCur} için kur yok. Ön Kasa → Döviz Kurları ekranından girin.</> : <>Döviz tutarını girin.</>}
            </div>
          </>}
          {toAccount && dlg.kind === 'payment' && <>
            <Field label="Şirket" className="span-2"><select className="input" value={v.companyId ?? ''} onChange={e => setV(s => ({ ...s, companyId: e.target.value, agencyId: '' }))}><option value="">—</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="veya Acente" className="span-2"><select className="input" value={v.agencyId ?? ''} onChange={e => setV(s => ({ ...s, agencyId: e.target.value, companyId: '' }))}><option value="">—</option>{agencies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </>}
          <Field label={`Referans${method?.requiresReference ? '' : ' (isteğe bağlı)'}`} required={method?.requiresReference} className="span-2" hint="Slip, dekont veya provizyon no"><input className="input" value={v.reference ?? ''} onChange={set('reference')} /></Field>
          {dlg.kind === 'payment' ? <Field label="Açıklama" className="span-2"><input className="input" value={v.description ?? ''} onChange={set('description')} /></Field> : reason}
          {dlg.kind === 'payment' && <div className="span-4"><label className="check"><input type="checkbox" checked={v.isDeposit === '1'} onChange={e => setV(s => ({ ...s, isDeposit: e.target.checked ? '1' : '' }))} /> Depozito olarak kaydet</label></div>}
          {needsShift && <div className="error-box span-4">Nakit/kart işlemi için açık kasa vardiyanız yok. Ön Kasa → Kasa Vardiyası ekranından vardiya açın.</div>}
        </>}
        {dlg.kind === 'discount' && <>
          <Field label="Tür" className="span-2"><select className="input" value={v.kind} onChange={set('kind')}><option value="discount">İndirim</option><option value="allowance">Allowance (düzeltme)</option></select></Field>
          <Field label="Tutar" required className="span-2" hint={dlg.line ? `İlgili masraf: ${dlg.line.description} (${fmtMoney(dlg.line.amount)})` : undefined}><MoneyInput value={v.amount ?? ''} onChange={setVal('amount')} autoFocus /></Field>
          {reason}
        </>}
        {dlg.kind === 'void' && <>
          <div className="span-4 warn-box">{dlg.line.description} · {fmtMoney(dlg.line.amount)} satırı iptal edilecek. Satır silinmez; ters kayıt oluşturulur.</div>
          {reason}
        </>}
        {(dlg.kind === 'transfer' || dlg.kind === 'balance') && <>
          <Field label="Hedef folyo" required className="span-4">
            <select className="input" value={v.target ?? ''} onChange={set('target')}><option value="">Seçin</option>{others.map(x => <option key={x.id} value={x.id}>Pencere {x.windowNo} · {x.name} · {x.folioNumber}</option>)}</select>
          </Field>
          {others.length === 0 && <div className="warn-box span-4">Aktarım için başka açık folyo penceresi yok. Önce yeni pencere açın.</div>}
          {dlg.kind === 'transfer' && <Field label="Tutar (boşsa tamamı)" className="span-2"><MoneyInput value={v.amount ?? ''} onChange={setVal('amount')} /></Field>}
          {reason}
        </>}
        {dlg.kind === 'newFolio' && <>
          <Field label="Ödeyen" className="span-2"><select className="input" value={v.payerKind} onChange={set('payerKind')}><option value="guest">Misafir</option><option value="company">Şirket</option><option value="agency">Acente</option></select></Field>
          {v.payerKind === 'company' && <Field label="Şirket" required className="span-2"><select className="input" value={v.companyId ?? ''} onChange={set('companyId')}><option value="">Seçin</option>{companies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          {v.payerKind === 'agency' && <Field label="Acente" required className="span-2"><select className="input" value={v.agencyId ?? ''} onChange={set('agencyId')}><option value="">Seçin</option>{agencies.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <Field label="Folyo adı (isteğe bağlı)" className="span-4"><input className="input" value={v.name ?? ''} onChange={set('name')} /></Field>
        </>}
        {dlg.kind === 'invoice' && <>
          <Field label="Fatura numarası" required className="span-2"><input className="input" value={v.invoiceNumber ?? ''} onChange={set('invoiceNumber')} autoFocus /></Field>
          <Field label="Fatura tarihi" required className="span-2"><input type="date" className="input" value={v.invoiceDate} onChange={set('invoiceDate')} /></Field>
          <div className="span-4 muted" style={{ fontSize: 12 }}>Fatura dış muhasebe/e-fatura programında kesilir; burada yalnız numarası kayıt altına alınır.</div>
        </>}
        {dlg.kind === 'reopen' && <>{reason}<div className="span-4 muted"><RotateCcw size={12} /> Yeniden açma işlemi denetim kaydına yazılır.</div></>}
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

/** Misafire verilen folyo dökümü: borç ve alacak ayrı sütunlarda, bakiye belirgin. A4, kenar boşluklarını belge kendisi verir. */
function FolioPrint({ detail, reservation }: { detail: FolioDetail; reservation?: Reservation }) {
  const f = detail.folio;
  const lines = detail.lines.filter(l => !l.isVoided && l.lineType !== 'void');
  const abs = (m: string) => m.replace('-', '');
  const isDebit = (m: string) => !m.startsWith('-');
  const qty = (l: FolioLine) => l.lineType === 'charge' && Number(l.quantity) !== 1 ? `${fmtQty(l.quantity)} × ${fmtMoney(l.unitPrice)}` : '';
  const balance = Number(f.balance);
  const info: [string, string | undefined][] = [
    ['Misafir / Ödeyen', f.name],
    ['Oda', reservation?.roomNumber ?? undefined],
    ['Rezervasyon', reservation?.reservationNumber ?? f.reservationNumber],
    ['Giriş', reservation ? fmtDate(reservation.arrival) : undefined],
    ['Çıkış', reservation ? fmtDate(reservation.departure) : undefined],
    ['Kişi', reservation ? `${reservation.adults} yetişkin${reservation.children ? `, ${reservation.children} çocuk` : ''}` : undefined],
  ];
  return (
    <div className="doc folio-doc">
      <DocHeader kind="Folyo" no={f.folioNumber} lines={[`Pencere ${f.windowNo} · ${f.currency}`]} />

      <section className="fd-info">
        {info.filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </section>

      <table className="fd-table">
        <colgroup><col style={{ width: '19mm' }} /><col /><col style={{ width: '28mm' }} /><col style={{ width: '26mm' }} /><col style={{ width: '26mm' }} /></colgroup>
        <thead><tr><th>Tarih</th><th>Açıklama</th><th className="r">Miktar × Fiyat</th><th className="r">Borç</th><th className="r">Alacak</th></tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id}>
              <td className="fd-date">{fmtDate(l.businessDate)}</td>
              <td>{l.description}{l.reference && <span className="fd-ref"> · {l.reference}</span>}</td>
              <td className="r fd-muted">{qty(l)}</td>
              <td className="r">{isDebit(l.amount) ? fmtMoney(l.amount) : ''}</td>
              <td className="r">{isDebit(l.amount) ? '' : fmtMoney(abs(l.amount))}</td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td colSpan={5} className="fd-muted" style={{ textAlign: 'center' }}>Folyoda hareket yok.</td></tr>}
        </tbody>
      </table>

      <section className="fd-totals">
        <div><span>Toplam borç</span><span>{fmtMoney(f.totalCharges)}</span></div>
        <div><span>Toplam alacak</span><span>{fmtMoney(abs(f.totalCredits))}</span></div>
        <div className="fd-balance">
          <span>{balance > 0 ? 'Ödenecek bakiye' : balance < 0 ? 'Misafir alacağı' : 'Bakiye'}</span>
          <span>{fmtMoney(abs(f.balance), f.currency)}</span>
        </div>
      </section>

      <section className="fd-sign">
        <div><div className="fd-line" />Misafir imzası</div>
        <div><div className="fd-line" />Resepsiyon</div>
      </section>

      <DocFooter lead="Konaklamanız için teşekkür ederiz."
        note={`Bu belge bilgi amaçlıdır, fatura yerine geçmez.${f.invoiceNumber ? ` Fatura no: ${f.invoiceNumber}${f.invoiceDate ? ` (${fmtDate(f.invoiceDate)})` : ''}.` : ''}`} />
    </div>
  );
}
