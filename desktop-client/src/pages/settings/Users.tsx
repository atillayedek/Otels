import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Unlock } from 'lucide-react';
import { api, get } from '../../lib/api';
import type { Permission, Role, User } from '../../lib/types';
import { fmtDateTime, ROLE_LABEL } from '../../lib/format';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Tabs, useToast, type Column } from '../../components/ui';

export default function UsersSettingsPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const users = useQuery({ queryKey: ['settings', 'users'], queryFn: () => get<User[]>('/api/v1/users') });
  const roles = useQuery({ queryKey: ['settings', 'roles'], queryFn: () => get<Role[]>('/api/v1/roles') });
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const [role, setRole] = useState<Role | 'new' | null>(null);
  const roleName = (c: string) => roles.data?.find(r => r.code === c)?.name ?? ROLE_LABEL[c] ?? c;
  const cols: Column<User>[] = [
    { key: 'username', header: 'Kullanıcı adı', width: 140, filter: true }, { key: 'fullName', header: 'Ad soyad', filter: true },
    { key: 'roles', header: 'Roller', value: u => u.roles.map(roleName).join(', ') },
    { key: 'lastLoginAt', header: 'Son giriş', width: 140, render: u => fmtDateTime(u.lastLoginAt) },
    { key: 'st', header: 'Durum', width: 170, render: u => <>{u.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge>} {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge color="red">Kilitli</Badge>} {u.mustChangePassword && <Badge color="orange">Parola değişmeli</Badge>}</> },
  ];
  const rcols: Column<Role>[] = [
    { key: 'code', header: 'Kod', width: 200 }, { key: 'name', header: 'Ad' },
    { key: 'permissions', header: 'Yetki sayısı', align: 'right', width: 110, value: r => r.permissions.length },
    { key: 'isSystem', header: '', width: 90, render: r => r.isSystem ? <Badge color="blue">Sistem</Badge> : null },
  ];
  return (
    <div className="page">
      <PageHead title="Kullanıcılar ve Roller" actions={tab === 'users' ? <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Kullanıcı</button> : <button className="btn primary" onClick={() => setRole('new')}><Plus /> Rol</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'users', label: 'Kullanıcılar', count: users.data?.length }, { key: 'roles', label: 'Roller', count: roles.data?.length }]} />
      {tab === 'users' ? <DataTable rows={users.data ?? []} columns={cols} rowKey={u => u.id} onRowClick={setEdit} empty={<Empty title="Kullanıcı yok" />} />
        : <DataTable rows={roles.data ?? []} columns={rcols} rowKey={r => r.code} onRowClick={setRole} />}
      {edit && <UserModal u={edit === 'new' ? undefined : edit} roles={roles.data ?? []} onClose={() => setEdit(null)} />}
      {role && <RoleModal r={role === 'new' ? undefined : role} onClose={() => setRole(null)} />}
    </div>
  );
}

const PW_HINT = 'En az 10 karakter; harf ve rakam içermeli.';

function UserModal({ u, roles, onClose }: { u?: User; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ username: u?.username ?? '', fullName: u?.fullName ?? '', email: u?.email ?? '', password: '', isActive: u?.isActive ?? true, roles: u?.roles ?? [] as string[] });
  const [reset, setReset] = useState('');
  const save = useAction(async (key: string) => {
    if (u) await api('PUT', `/api/v1/users/${u.id}`, { fullName: f.fullName, email: f.email || null, isActive: f.isActive, roles: f.roles, version: u.version });
    else await api('POST', '/api/v1/users', { username: f.username.trim().toLowerCase(), fullName: f.fullName, email: f.email || null, password: f.password, roles: f.roles }, { key });
    await qc.invalidateQueries({ queryKey: ['settings', 'users'] });
  }, { success: 'Kullanıcı kaydedildi.' });
  const doReset = async () => {
    try { await api('POST', `/api/v1/users/${u!.id}/reset-password`, { newPassword: reset }); setReset(''); toast.ok('Parola sıfırlandı. Kullanıcı ilk girişte parolasını değiştirecek; açık oturumları kapatıldı.'); } catch (e) { toast.error(e); }
  };
  const unlock = async () => { try { await api('POST', `/api/v1/users/${u!.id}/unlock`); await qc.invalidateQueries({ queryKey: ['settings', 'users'] }); toast.ok('Hesap kilidi açıldı.'); } catch (e) { toast.error(e); } };
  const toggle = (c: string) => setF(s => ({ ...s, roles: s.roles.includes(c) ? s.roles.filter(x => x !== c) : [...s.roles, c] }));
  return (
    <Modal title={u ? `Kullanıcı · ${u.username}` : 'Yeni kullanıcı'} size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.fullName.trim() || f.roles.length === 0 || (!u && (!/^[a-z0-9._-]{3,40}$/.test(f.username) || f.password.length < 10)) || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kullanıcı adı" required hint={!u ? 'Küçük harf, rakam, nokta, tire' : undefined}><input className="input" value={f.username} disabled={!!u} onChange={e => setF(s => ({ ...s, username: e.target.value.toLowerCase() }))} autoFocus={!u} /></Field>
        <Field label="Ad soyad" required className="span-2"><input className="input" value={f.fullName} onChange={e => setF(s => ({ ...s, fullName: e.target.value }))} /></Field>
        <Field label="E-posta"><input className="input" value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} /></Field>
        {!u && <Field label="İlk parola" required hint={`${PW_HINT} Kullanıcı ilk girişte değiştirir.`} className="span-2"><input type="password" className="input" value={f.password} onChange={e => setF(s => ({ ...s, password: e.target.value }))} autoComplete="new-password" /></Field>}
        {u && <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif (pasif kullanıcı giriş yapamaz)</label></div>}
        <div className="span-4"><div className="section-title">Roller</div>
          <div className="grid cols-3" style={{ gap: 6 }}>{roles.map(r => <label key={r.code} className="check"><input type="checkbox" checked={f.roles.includes(r.code)} onChange={() => toggle(r.code)} /> {r.name}</label>)}</div>
        </div>
      </div>
      <ErrorBox error={save.error} />
      {u && (
        <div className="row wrap" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <input type="password" className="input" style={{ width: 220 }} placeholder="Yeni parola" value={reset} onChange={e => setReset(e.target.value)} autoComplete="new-password" />
          <button className="btn" disabled={reset.length < 10} onClick={() => void doReset()}><KeyRound /> Parolayı sıfırla</button>
          {u.lockedUntil && <button className="btn" onClick={() => void unlock()}><Unlock /> Kilidi aç</button>}
          <span className="muted" style={{ fontSize: 12 }}>{PW_HINT}</span>
        </div>
      )}
    </Modal>
  );
}

function RoleModal({ r, onClose }: { r?: Role; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ['settings', 'permissions'], queryFn: () => get<Permission[]>('/api/v1/roles/permissions') });
  const [f, setF] = useState({ code: r?.code ?? '', name: r?.name ?? '', permissions: r?.permissions ?? [] as string[] });
  const save = useAction(async () => {
    if (r) await api('PUT', `/api/v1/roles/${r.code}`, { name: f.name, permissions: f.permissions });
    else await api('POST', '/api/v1/roles', { code: f.code.trim().toUpperCase(), name: f.name, permissions: f.permissions });
    await qc.invalidateQueries({ queryKey: ['settings', 'roles'] });
  }, { success: 'Rol kaydedildi.' });
  const modules = [...new Set(perms.data?.map(p => p.module))];
  const toggle = (c: string) => setF(s => ({ ...s, permissions: s.permissions.includes(c) ? s.permissions.filter(x => x !== c) : [...s.permissions, c] }));
  return (
    <Modal title={r ? `Rol · ${r.name}` : 'Yeni rol'} size="xl" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.name.trim() || (!r && !/^[A-Za-z_]{3,40}$/.test(f.code)) || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} disabled={!!r} onChange={e => setF(s => ({ ...s, code: e.target.value }))} /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
      </div>
      {r?.isSystem && <div className="info-box" style={{ marginTop: 8 }}>Sistem rolü. Yetkilerini değiştirebilirsiniz; rol silinemez.</div>}
      <div className="grid cols-3" style={{ marginTop: 12 }}>
        {modules.map(m => (
          <div key={m} className="card"><div className="card-head"><h3>{m}</h3></div><div className="card-body stack" style={{ gap: 4 }}>
            {perms.data!.filter(p => p.module === m).map(p => <label key={p.code} className="check" title={p.code}><input type="checkbox" checked={f.permissions.includes(p.code)} onChange={() => toggle(p.code)} /> {p.description}</label>)}
          </div></div>
        ))}
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
