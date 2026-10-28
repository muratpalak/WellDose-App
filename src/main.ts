import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APPLE_LOGIN_READY, GOOGLE_LOGIN_READY } from './config';
import './styles.css';

type Kind = 'weight' | 'bmi' | 'body_fat_percent' | 'lean_body_mass';
type Page = 'overview' | 'measurements' | 'injections' | 'documents' | 'settings';
type DocumentCategory = 'blood_test' | 'urine_test' | 'radiology' | 'doctor_note' | 'patient_note' | 'prescription';
type HealthDocument = {
  id: string;
  user_id: string;
  category: DocumentCategory;
  title: string;
  document_date: string;
  provider_name: string | null;
  doctor_name: string | null;
  notes: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  created_at: string;
};
type HealthSample = {
  id: string;
  user_id: string;
  kind: Kind;
  value: number;
  unit: string;
  source: 'manual' | 'healthkit' | 'csv' | 'pdf';
  origin_app: string | null;
  observed_at: string;
};
type Injection = {
  id: string;
  drug: string;
  doseMg: number;
  at: string;
  note: string;
};
type JournalPayload = { injections: Injection[] };
type JournalRecord = { user_id: string; payload: JournalPayload; revision: number };

const api = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, autoRefreshToken: true, persistSession: true },
});
const app = document.querySelector<HTMLDivElement>('#app')!;
const kinds: Record<Kind, { name: string; unit: string; short: string }> = {
  weight: { name: 'Kilo', unit: 'kg', short: 'kg' },
  bmi: { name: 'Vücut kitle indeksi', unit: 'kg/m2', short: 'BKİ' },
  body_fat_percent: { name: 'Vücut yağ oranı', unit: 'percent', short: '%' },
  lean_body_mass: { name: 'Yağsız vücut kütlesi', unit: 'kg', short: 'kg' },
};
const documentKinds: Record<DocumentCategory, { label: string; icon: string; description: string }> = {
  blood_test: { label: 'Kan Tahlili', icon: '🩸', description: 'Hemogram, biyokimya ve diğer sonuçlar' },
  urine_test: { label: 'İdrar Tahlili', icon: '🧪', description: 'İdrar analizi ve kültür sonuçları' },
  radiology: { label: 'Radyoloji', icon: '🩻', description: 'MR, BT, ultrason ve röntgen raporları' },
  doctor_note: { label: 'Doktor Notu', icon: '🩺', description: 'Muayene değerlendirmeleri ve öneriler' },
  patient_note: { label: 'Hasta Notu', icon: '📝', description: 'Belirtiler ve kişisel gözlemler' },
  prescription: { label: 'Reçete', icon: '💊', description: 'Reçeteler ve ilaç talimatları' },
};
const DOCUMENTS_BUCKET = 'welldose-health-documents';
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const documentMimes: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
let session: Session | null = null;
let page: Page = 'overview';
let loading = true;
let consent = false;
let samples: HealthSample[] = [];
let journal: JournalRecord | null = null;
let documents: HealthDocument[] = [];
let documentsLoadError = '';
let documentFilter: DocumentCategory | 'all' = 'all';
let editingDocumentId: string | null = null;
let flash = '';
let flashError = false;
let pendingEmail = '';
let generation = 0;
let dataLoadFailed = false;

function esc(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}
function dateDisplay(date: string): string {
  if (!date || Number.isNaN(Date.parse(date))) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(date));
}
function validPastOrPresentDateTime(value: string): boolean {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const date=new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime()<=Date.now()
    && date.getFullYear()===Number(match[1]) && date.getMonth()+1===Number(match[2])
    && date.getDate()===Number(match[3]) && date.getHours()===Number(match[4])
    && date.getMinutes()===Number(match[5]);
}
function validPastOrPresentDate(value: string): boolean {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || value>localDateTime().slice(0,10)) return false;
  const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
  return date.getFullYear()===Number(match[1]) && date.getMonth()+1===Number(match[2])
    && date.getDate()===Number(match[3]);
}
function number(value: number, digits = 1): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value);
}
function show(message: string, isError = false) {
  flash = message;
  flashError = isError;
  // Do not rebuild active forms on a failed submission: users must not lose
  // medication notes or measurements because a network request failed.
  const container = app.querySelector<HTMLElement>('.content, .auth-card, .consent-card, .load-error-card');
  if (container) {
    const oldNotice = Array.from(container.children).find(node => node.classList.contains('notice'));
    const notice = document.createElement('div');
    notice.className = `notice ${isError ? 'notice-error' : ''}`;
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    if (oldNotice) oldNotice.replaceWith(notice);
    else container.prepend(notice);
    return;
  }
  render();
}
function normalizeJournal(payload: unknown): JournalPayload {
  if (typeof payload !== 'object' || !payload) return { injections: [] };
  const value = payload as { injections?: unknown };
  if (!Array.isArray(value.injections)) return { injections: [] };
  const valid: Injection[] = value.injections.filter(item => item && typeof item === 'object'
    && typeof item.at === 'string' && Number.isFinite(Number(item.doseMg))
    && typeof item.drug === 'string').map(item => ({
    id: String(item.id ?? crypto.randomUUID()),
    drug: String(item.drug),
    doseMg: Number(item.doseMg),
    at: String(item.at),
    note: String(item.note ?? ''),
  }));
  return { injections: valid };
}
function banner() {
  return flash ? `<div class="notice ${flashError ? 'notice-error' : ''}" role="status">${esc(flash)}</div>` : '';
}
function loadingErrorScreen() {
  app.innerHTML = `<div class="consent-wrap"><section class="consent-card load-error-card">
    <div class="brand dark-brand"><span class="brand-mark">✳</span><span>well<span class="brand-light">dose</span></span></div>
    <div class="eyebrow">BAĞLANTI HATASI</div><h1>Verilerine şu anda ulaşamıyoruz.</h1>
    <p>Güvenliğin için önceki oturuma ait kayıtları göstermiyoruz. Bağlantını kontrol edip tekrar deneyebilirsin.</p>
    ${banner()}
    <button class="primary-button" data-action="retry-loading">Yeniden dene →</button>
    <button class="text-button" data-action="sign-out">Çıkış yap</button>
  </section></div>`;
}
function icon(symbol: string) {
  return `<span class="symbol" aria-hidden="true">${symbol}</span>`;
}
function loginScreen() {
  app.innerHTML = `
  <div class="auth-shell">
    <div class="auth-side">
      <div class="brand"><span class="brand-mark">✳</span><span>well<span class="brand-light">dose</span></span></div>
      <div class="auth-story"><div class="kicker"><span class="small-dot"></span> SAĞLIK YOLCULUĞUN, SENİN KONTROLÜNDE</div>
        <h1>İyi hissetmenin<br/><em>takibi sende.</em></h1>
        <p>İlacını, vücut ölçümlerini ve ilerlemeni tek bir güvenli sağlık günlüğünde bir araya getir.</p>
      </div>
      <div class="auth-points"><span>◎ Kişisel kayıtlar</span><span>◎ Çoklu cihaz</span><span>◎ Senin izinlerin</span></div>
    </div>
    <main class="auth-card-wrap">
      <section class="auth-card">
        <div class="eyebrow">WELLDOSE HESABIN</div><h2>Yeniden hoş geldin.</h2>
        <p class="subtle">Kendi sağlık günlüğüne güvenle devam et.</p>
        ${banner()}
        <button class="social-button" data-action="apple" ${APPLE_LOGIN_READY ? '' : 'disabled'}><span></span> Apple ile devam et ${APPLE_LOGIN_READY ? '' : '<small>Yakında</small>'}</button>
        <button class="social-button" data-action="google" ${GOOGLE_LOGIN_READY ? '' : 'disabled'}><span class="google-mark">G</span> Google ile devam et ${GOOGLE_LOGIN_READY ? '' : '<small>Yakında</small>'}</button>
        <div class="or"><span>veya e-posta ile</span></div>
        ${pendingEmail ? `
          <p class="subtle"><strong>${esc(pendingEmail)}</strong> adresine gönderilen en son giriş kodunu yaz.</p>
          <form data-form="otp" class="form-stack">
            <label for="otp">Tek kullanımlık giriş kodu</label>
            <input id="otp" type="text" name="token" inputmode="numeric" autocomplete="one-time-code"
              pattern="[0-9]{6,8}" minlength="6" maxlength="8" placeholder="Giriş kodun" required />
            <button class="primary-button" type="submit">Kodla güvenli giriş yap <span aria-hidden="true">→</span></button>
          </form>
          <button class="text-button" type="button" data-action="resend-otp">Yeni kod gönder</button>
          <button class="text-button" type="button" data-action="change-email">Başka e-posta kullan</button>
          <p class="fine">Yalnızca son gönderilen kod geçerlidir. İstersen aynı e-postadaki güvenli giriş bağlantısını da kullanabilirsin.</p>
        ` : `
          <form data-form="email" class="form-stack">
            <label for="email">E-posta adresin</label>
            <input id="email" type="email" name="email" autocomplete="email" placeholder="ad@ornek.com" required />
            <button class="primary-button" type="submit">Giriş kodu gönder <span aria-hidden="true">→</span></button>
          </form>
          <p class="fine">E-postana tek kullanımlık giriş kodu ve güvenli giriş bağlantısı gönderilir.</p>
        `}
        <div class="auth-foot">Verilerin başka kullanıcılarla paylaşılmaz. <span>Beta • Herkese açık değil</span></div>
      </section>
    </main>
  </div>`;
}
function consentScreen() {
  const email = esc(session?.user.email ?? '');
  app.innerHTML = `<div class="consent-wrap"><section class="consent-card">
    <div class="brand dark-brand"><span class="brand-mark">✳</span><span>well<span class="brand-light">dose</span></span></div>
    <div class="eyebrow">GİZLİLİK VE KONTROL</div>
    <h1>Sağlık verilerin yalnızca sana ait.</h1>
    <p>WellDose; girdiğin ölçüm, tedavi günlüğü, sağlık raporu, reçete ve kişisel notları hesabınla ilişkilendirip cihazlar arasında saklar.</p>
    <div class="consent-detail"><span>✓</span> Hesabın: <strong>${email}</strong></div>
    <div class="consent-detail"><span>✓</span> Başka kullanıcılar senin kayıtlarını göremez.</div>
    <div class="consent-detail"><span>✓</span> Verilerini indirebilir veya silebilirsin.</div>
    <div class="consent-detail"><span>✓</span> Apple Sağlık bağlantısı ayrıca izin gerektirir; şu anda aktif değildir.</div>
    ${banner()}
    <label class="consent-checkbox"><input type="checkbox" id="health-consent" /><span>Sağlık bilgilerimi WellDose hesabımda kaydetmeyi ve senkronize etmeyi açıkça kabul ediyorum.</span></label>
    <button class="primary-button" data-action="accept-consent">Kabul et ve devam et <span aria-hidden="true">→</span></button>
    <button class="text-button" data-action="sign-out">Şimdilik çıkış yap</button>
    <p class="fine">Bu, halka açık hizmet için nihai KVKK/GDPR aydınlatma ve açık rıza metni değildir; test aşaması tamamlanmadan düzenlenecektir.</p>
  </section></div>`;
}
function stat(title: string, value: string, detail: string, emoji: string) {
  return `<div class="stat"><div class="stat-icon">${emoji}</div><div class="stat-name">${title}</div><strong>${value}</strong><p>${detail}</p></div>`;
}
function weightGraph() {
  const weights = samples.filter(s => s.kind === 'weight').slice().sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at)).slice(-12);
  if (weights.length < 2) return '<div class="empty-chart">Grafik için en az iki kilo ölçümü ekle.</div>';
  const vals=weights.map(s=>Number(s.value));
  const low=Math.min(...vals)-1, high=Math.max(...vals)+1;
  const coords=vals.map((v,i)=>({x:20+(i/(vals.length-1))*560,y:170-((v-low)/(high-low))*130}));
  return `<div class="graph-wrap" role="img" aria-label="Son ${weights.length} kilo ölçümünün değişimi">
    <svg viewBox="0 0 600 200" preserveAspectRatio="none" class="line-chart"><line x1="20" y1="170" x2="580" y2="170" stroke="#dce9e1"/>
    <line x1="20" y1="105" x2="580" y2="105" stroke="#edf3ef"/><line x1="20" y1="40" x2="580" y2="40" stroke="#edf3ef"/>
    <path d="M${coords.map(p=>`${p.x},${p.y}`).join(' L')}" fill="none" stroke="#407b6e" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${coords.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#407b6e" stroke="#fff" stroke-width="2"/>`).join('')}
    </svg><div class="chart-legend"><span>${dateDisplay(weights[0].observed_at)}</span><span>${dateDisplay(weights[weights.length-1].observed_at)}</span></div>
  </div>`;
}
function overview() {
  const latestWeight=samples.find(s=>s.kind==='weight');
  const latestFat=samples.find(s=>s.kind==='body_fat_percent');
  const injections=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return `<div class="page-title"><div><div class="eyebrow">GENEL BAKIŞ</div><h1>İlerlemeni keşfet.</h1><p>Her küçük adım, büyük bir değişimin parçası.</p></div><button class="secondary-button" data-nav="measurements">+ Ölçüm ekle</button></div>
    <div class="stats-grid">
      ${stat('Güncel kilo',latestWeight?`${number(Number(latestWeight.value))} kg`:'—','En son kaydedilen ölçüm','⚖')}
      ${stat('Vücut yağ oranı',latestFat?`${number(Number(latestFat.value))}%`:'—','Güncel vücut kompozisyonu','◌')}
      ${stat('Son enjeksiyon',injections.length?dateDisplay(injections[0].at):'—','Kullanıcının kayıt ettiği doz','◷')}
      ${stat('Ölçüm sayısı',String(samples.length),'Kişisel sağlık kayıtların','✦')}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-top"><div><h2>Kilo yolculuğu</h2><p>Son 12 ölçüm</p></div><span class="tag">kg</span></div>${weightGraph()}</section>
      <section class="panel tip-panel"><div class="eyebrow">SANA ÖZEL</div><h2>İlerlemek için<br/>bir adım daha.</h2><p>Düzenli kayıt tutmak, zaman içindeki değişimleri doktorunla değerlendirmeni kolaylaştırabilir.</p><button data-nav="injections" class="secondary-button">Tedavi günlüğüne git →</button><div class="tip-decoration">✳</div></section>
    </div>`;
}
function measurements() {
  const items=samples.slice(0,60);
  return `<div class="page-title"><div><div class="eyebrow">VÜCUT ANALİZİ</div><h1>Ölçümlerim.</h1><p>Değişimleri tarihleriyle kaydet ve izle.</p></div></div>
  <div class="two-col"><section class="panel"><h2>Yeni ölçüm</h2><form data-form="measurement" class="form-stack">
    <label for="kind">Ölçüm türü</label><select id="kind" name="kind">${Object.entries(kinds).map(([key,meta])=>`<option value="${key}">${esc(meta.name)}</option>`).join('')}</select>
    <label for="value">Değer</label><input id="value" name="value" type="number" required min="0.01" max="650" step="0.01" placeholder="Örn. 85,5 yerine 85.5" />
    <label for="observed">Ölçüm tarihi</label><input id="observed" name="observed" type="datetime-local" required max="${localDateTime()}" value="${localDateTime()}" />
    <p class="helper">Geçmiş bir gün ve saat seçebilirsin; gelecekteki tarihler kabul edilmez.</p>
    <p class="helper">Girdiğin değer kaydedilir; herhangi bir tedavi önerisi oluşturulmaz.</p>
    <button class="primary-button" type="submit">Ölçümü kaydet →</button>
  </form></section>
  <section class="panel"><div class="panel-top"><h2>Ölçüm geçmişi</h2><span class="tag">${samples.length} kayıt</span></div>
  <div class="record-list">${items.length?items.map(s=>`<div class="record-row"><div class="record-dot"></div><div class="record-info"><b>${esc(kinds[s.kind]?.name??s.kind)}</b><small>${dateDisplay(s.observed_at)} · ${esc(s.source==='healthkit'?s.origin_app||'Apple Sağlık':'Elle girildi')}</small></div><strong>${number(Number(s.value),2)} ${esc(kinds[s.kind]?.short??s.unit)}</strong></div>`).join(''):'<p class="empty-state">Henüz bir ölçüm eklenmedi.</p>'}</div></section></div>`;
}
function localDateTime() {
  const d=new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function injectionsPage() {
  const items=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return `<div class="page-title"><div><div class="eyebrow">TEDAVİ GÜNLÜĞÜ</div><h1>Doz kayıtlarım.</h1><p>Yalnızca doktorunun önerdiği tedaviyi kayıt altına al.</p></div></div>
    <div class="two-col"><section class="panel"><h2>Enjeksiyon kaydet</h2>
    <form data-form="injection" class="form-stack">
      <label for="drug">İlaç adı</label><input id="drug" name="drug" required maxlength="80" value="Mounjaro" />
      <label for="dose">Uyguladığın doz (mg)</label><input id="dose" name="dose" type="number" required min="0.01" max="100" step="0.01" placeholder="Örn. 2.5" />
      <label for="at">Uygulama tarihi ve saati</label><input id="at" name="at" type="datetime-local" required max="${localDateTime()}" value="${localDateTime()}" />
      <p class="helper">Önceki dozları da kaydedebilirsin; gelecekteki uygulama tarihleri kabul edilmez.</p>
      <label for="note">Not (isteğe bağlı)</label><textarea name="note" id="note" rows="3" maxlength="400" placeholder="Nasıl hissettiğin…"></textarea>
      <button class="primary-button" type="submit">Kaydı güvenle sakla →</button>
      <p class="helper">WellDose doz değişikliği ya da tıbbi karar önermez.</p></form></section>
      <section class="panel"><div class="panel-top"><h2>Uygulama geçmişi</h2><span class="tag">${items.length} kayıt</span></div>
      <div class="record-list">${items.length?items.map(item=>`<div class="record-row"><div class="record-dot dose-dot"></div><div class="record-info"><b>${esc(item.drug)}</b><small>${dateDisplay(item.at)}${item.note?' · '+esc(item.note):''}</small></div><strong>${number(item.doseMg,2)} mg</strong></div>`).join(''):'<p class="empty-state">Henüz enjeksiyon kaydı yok.</p>'}</div></section></div>`;
}
function documentsPage() {
  const entries = Object.entries(documentKinds) as [DocumentCategory, typeof documentKinds[DocumentCategory]][];
  const items = documentFilter === 'all' ? documents : documents.filter(item=>item.category===documentFilter);
  const editing = editingDocumentId && documentFilter !== 'all'
    ? documents.find(item=>item.id===editingDocumentId && item.category===documentFilter && item.user_id===session?.user.id)
    : null;
  return `<div class="page-title"><div><div class="eyebrow">KİŞİSEL SAĞLIK ARŞİVİN</div><h1>Sağlık Belgelerim.</h1>
    <p>Raporlarını, reçetelerini ve notlarını tarihleriyle güvenle sakla.</p></div><span class="tag">${documents.length} belge</span></div>
    ${documentsLoadError ? `<div class="notice notice-error">Sağlık belgelerine ulaşılamadı: ${esc(documentsLoadError)}. Diğer kayıtların etkilenmedi.</div>` : `
    <div class="document-categories" aria-label="Belge kategorileri">
      <button class="document-category ${documentFilter==='all'?'active':''}" data-doc-filter="all"><span class="document-category-icon">▤</span><strong>Tüm Belgeler</strong><small>${documents.length} kayıt</small></button>
      ${entries.map(([id,kind])=>`<button class="document-category ${documentFilter===id?'active':''}" data-doc-filter="${id}">
        <span class="document-category-icon">${kind.icon}</span><strong>${kind.label}</strong><small>${documents.filter(d=>d.category===id).length} kayıt</small></button>`).join('')}
    </div>
    <div class="document-layout ${documentFilter==='all'?'document-layout-full':''}">
      ${documentFilter==='all'?'':`<section class="panel"><h2>${editing?'Belgeyi düzenle':'Yeni belge veya not ekle'}</h2><form data-form="health-document" class="form-stack">
        <div class="document-locked-category"><span>Kategori</span><strong>${esc(documentKinds[documentFilter].icon)} ${esc(documentKinds[documentFilter].label)}</strong><small>Bu bölümde kategori otomatik belirlenir.</small></div>
        <label for="document-title">Başlık</label><input id="document-title" name="title" maxlength="160" required placeholder="Örn. Ekim 2026 kan tahlili" value="${esc(editing?.title??'')}" />
        <label for="document-date">Belge tarihi</label><input id="document-date" name="document_date" type="date" required max="${localDateTime().slice(0,10)}" value="${esc(editing?.document_date??localDateTime().slice(0,10))}" />
        <p class="helper">Geçmiş tarihli belgeler eklenebilir; gelecekteki tarihler kabul edilmez.</p>
        <label for="document-provider">Hastane / laboratuvar (isteğe bağlı)</label><input id="document-provider" name="provider_name" maxlength="160" placeholder="Kurum adı" value="${esc(editing?.provider_name??'')}" />
        <label for="document-doctor">Doktor (isteğe bağlı)</label><input id="document-doctor" name="doctor_name" maxlength="120" placeholder="Doktorun adı" value="${esc(editing?.doctor_name??'')}" />
        <label for="document-notes">Açıklama / not</label><textarea id="document-notes" name="notes" rows="4" maxlength="10000" placeholder="Şikâyetler, doktorun açıklaması veya senin notların…">${esc(editing?.notes??'')}</textarea>
        <label for="document-file">PDF veya fotoğraf (isteğe bağlı)</label><input id="document-file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
        ${editing?.file_path?`<p class="document-existing-file">Mevcut dosya: <strong>${esc(editing.file_name??'Belge')}</strong>. Yeni dosya seçersen mevcut dosya değiştirilir.</p>`:''}
        <p class="helper">PDF, JPG, PNG veya WebP · En fazla <strong>5 MB</strong>. Dosya eklemiyorsan açıklama yazmalısın. Belgeler yalnızca hesabında görünür.</p>
        <div class="upload-progress" data-doc-progress hidden role="status" aria-live="polite">
          <div class="upload-progress-caption"><span data-doc-progress-label>Dosya yükleniyor…</span><strong data-doc-progress-value>0%</strong></div>
          <progress max="100" value="0" data-doc-progress-bar></progress>
        </div>
        <button class="primary-button" type="submit">${editing?'Değişiklikleri kaydet':'Belgeyi kaydet'} <span aria-hidden="true">→</span></button>
        ${editing?'<button type="button" class="secondary-button" data-action="cancel-doc-edit">Düzenlemeyi iptal et</button>':''}
      </form></section>`}
      <section class="panel"><div class="panel-top"><div><h2>${documentFilter==='all'?'Kayıtlı belgeler':esc(documentKinds[documentFilter].label)}</h2><p>En yeni tarihli belgeler üstte</p></div><span class="tag">${items.length} kayıt</span></div>
        <div class="document-list">${items.length ? items.map(item=>{
          const kind=documentKinds[item.category]??{icon:'▤',label:item.category};
          return `<article class="document-item"><div class="document-item-head"><span class="document-type-icon">${kind.icon}</span><div><strong>${esc(item.title)}</strong><small>${esc(kind.label)} · ${dateDisplay(item.document_date)}${item.provider_name?' · '+esc(item.provider_name):''}</small></div></div>
            ${item.doctor_name?`<p class="document-by">Doktor: ${esc(item.doctor_name)}</p>`:''}
            ${item.notes?`<p class="document-note">${esc(item.notes.length>300?item.notes.slice(0,300)+'…':item.notes)}</p>`:''}
            <div class="document-actions">${item.file_path?`<button class="secondary-button" data-doc-action="download" data-doc-id="${esc(item.id)}">↓ ${esc(item.file_name??'Dosyayı indir')}</button>`:'<span class="note-only-tag">Yazılı not</span>'}
              <button class="secondary-button" data-doc-action="edit" data-doc-id="${esc(item.id)}">Düzenle</button>
              <button class="document-delete" data-doc-action="delete" data-doc-id="${esc(item.id)}" aria-label="${esc(item.title)} kaydını sil">Sil</button></div></article>`;
        }).join(''):`<div class="empty-state">${documentFilter==='all'?'Henüz kaydedilmiş belge yok. Eklemek için yukarıdan bir kategori seç.':'Bu kategoride henüz belge bulunmuyor. İlk kaydını soldan ekleyebilirsin.'}</div>`}</div>
      </section>
    </div>`}`;
}
function settings() {
  return `<div class="page-title"><div><div class="eyebrow">HESAP VE BAĞLANTILAR</div><h1>Kontrol sende.</h1><p>Verilerin, cihazların ve güvenlik seçeneklerin.</p></div></div>
  <div class="settings-grid"><section class="panel"><h2>Hesabım</h2><p class="setting-label">Giriş yaptığın e-posta</p><p class="setting-value">${esc(session?.user.email??'')}</p>
  <button data-action="export" class="secondary-button">↓ Kayıt bilgilerini indir (JSON)</button>
  <p class="helper">PDF ve fotoğraf dosyaları JSON yedeğine eklenmez; Sağlık Belgelerim bölümünden ayrıca indirilebilir.</p>
  <button data-action="sign-out-all" class="secondary-button">Tüm cihazlardan çıkış yap</button>
  <button data-action="erase-data" class="danger-button">Sağlık kayıtlarımı ve belgelerimi kalıcı sil</button>
  <p class="fine">Hesabın bütünüyle silinmesi için ayrıca destek süreci oluşturulacak.</p></section>
  <section class="panel connection-panel"><div class="eyebrow">AKILLI BAĞLANTILAR</div><h2>Apple Sağlık & Zepp Life</h2>
  <div class="connection-line"><span class="connection-icon">⚖</span><div><b>Mi Body Composition Scale 2</b><small>Zepp Life → Apple Sağlık</small></div><span class="pending">Henüz bağlı değil</span></div>
  <div class="connection-line"><span class="connection-icon">♥</span><div><b>Apple Sağlık ve Apple Watch</b><small>HealthKit ile izinli veri aktarımı</small></div><span class="pending">iPhone gerekli</span></div>
  <p class="helper">WellDose web sürümü iPhone Sağlık verilerini kendiliğinden okuyamaz. Bunun için ayrıca hazırlanacak iOS uygulamasına izin vermelisin. Tartı verilerinin aktarımı da Zepp Life ayarlarına bağlıdır.</p></section></div>`;
}
function appScreen() {
  const nav=[['overview','Genel Bakış','◫'],['measurements','Ölçümler','◉'],['injections','Tedavi Günlüğü','◷'],['documents','Sağlık Belgelerim','▤'],['settings','Ayarlar','⚙']] as const;
  const content=page==='overview'?overview():page==='measurements'?measurements():page==='injections'?injectionsPage():page==='documents'?documentsPage():settings();
  app.innerHTML=`<div class="app-shell"><aside class="sidebar">
    <div class="brand"><span class="brand-mark">✳</span><span>well<span class="brand-light">dose</span></span></div>
    <p class="menu-label">MENÜ</p><nav aria-label="Ana menü">${nav.map(([id,label,symbol])=>`<button data-nav="${id}" class="nav-link ${page===id?'active':''}"><span>${symbol}</span>${label}</button>`).join('')}</nav>
    <div class="side-bottom"><span class="avatar">${esc((session?.user.email??'K')[0].toUpperCase())}</span><div><strong>Benim hesabım</strong><small>${esc(session?.user.email??'')}</small></div><button data-action="sign-out" aria-label="Çıkış yap" class="logout">⇥</button></div>
  </aside><div class="main-area"><header class="topbar"><div class="mobile-brand">✳ well<span>dose</span></div><div class="topbar-right"><span class="status-dot"></span> Güvenli oturum</div></header>
  <main class="content">${banner()}${content}</main>
  <nav class="mobile-nav" aria-label="Mobil menü">${nav.map(([id,label,symbol])=>`<button data-nav="${id}" class="${page===id?'active':''}"><span>${symbol}</span><small>${label}</small></button>`).join('')}</nav>
  </div></div>`;
}
function render() {
  if (loading) { app.innerHTML='<div class="loader">✳ <span>WellDose yükleniyor…</span></div>'; return; }
  if (!session) return loginScreen();
  if (dataLoadFailed) return loadingErrorScreen();
  if (!consent) return consentScreen();
  appScreen();
}
function clearPrivateData() {
  consent = false;
  samples = [];
  journal = null;
  documents = [];
  documentsLoadError = '';
  editingDocumentId = null;
  dataLoadFailed = false;
}
async function readAllSamples(userId: string) {
  const all: HealthSample[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await api.from('health_samples')
      .select('id,user_id,kind,value,unit,source,origin_app,observed_at')
      .eq('user_id', userId)
      .order('observed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    all.push(...(data ?? []).map(x => ({ ...x, value: Number(x.value) }) as HealthSample));
    if ((data?.length ?? 0) < batchSize) return all;
  }
}
async function readAllDocuments(userId: string) {
  const all: HealthDocument[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const {data,error} = await api.from('health_documents')
      .select('id,user_id,category,title,document_date,provider_name,doctor_name,notes,file_path,file_name,file_mime,file_size_bytes,created_at')
      .eq('user_id',userId)
      .order('document_date',{ascending:false})
      .order('created_at',{ascending:false})
      .range(offset,offset+batchSize-1);
    if (error) throw error;
    all.push(...(data??[]) as HealthDocument[]);
    if ((data?.length??0)<batchSize) return all;
  }
}
async function refreshData() {
  if (!session) return;
  const run=++generation;
  // Clear user-specific state before any asynchronous request. This also
  // prevents a failed load after switching accounts from exposing old data.
  clearPrivateData();
  loading=true;render();
  const userId=session.user.id;
  try {
    const [c,s,j,d]=await Promise.all([
      api.from('user_consents').select('health_storage_accepted_at').eq('user_id',userId).maybeSingle(),
      readAllSamples(userId),
      api.from('journal_records').select('user_id,payload,revision').eq('user_id',userId).maybeSingle(),
      readAllDocuments(userId).then(data=>({data,error:null as string|null})).catch(error=>({data:[] as HealthDocument[],error:error instanceof Error?error.message:'Belge bağlantı hatası'})),
    ]);
    if (run!==generation) return;
    if (c.error || j.error) throw c.error || j.error;
    consent=Boolean(c.data?.health_storage_accepted_at);
    samples=s;
    journal=j.data ? {...j.data,payload:normalizeJournal(j.data.payload)} : null;
    documents=d.data;
    documentsLoadError=d.error??'';
    loading=false;
    if (flashError) flash='';
    flashError=false;
    render();
  } catch (error) {
    if (run!==generation) return;
    loading=false;
    dataLoadFailed=true;
    flash='Kişisel verilerin yüklenemedi: '+(error instanceof Error ? error.message : 'Bağlantı hatası');
    flashError=true;
    render();
  }
}
async function sendLink(form: HTMLFormElement) {
  const data=new FormData(form);const email=String(data.get('email')??'').trim();
  if (!email || email.length>255) return show('Geçerli bir e-posta yaz.',true);
  const {error}=await api.auth.signInWithOtp({email,options:{emailRedirectTo:loginReturnUrl(),shouldCreateUser:true}});
  if (error) return show('Giriş kodu gönderilemedi: '+error.message,true);
  pendingEmail=email;
  flash='Kod gönderildiyse e-postanı kontrol et. Spam klasörüne de bakabilirsin.';
  flashError=false;
  render();
}
async function resendCode() {
  if (!pendingEmail) return;
  const {error}=await api.auth.signInWithOtp({email:pendingEmail,options:{emailRedirectTo:loginReturnUrl(),shouldCreateUser:true}});
  show(error?'Yeni kod gönderilemedi: '+error.message:'Yeni kod istendi. E-postandaki en son kodu kullan.',Boolean(error));
}
async function verifyCode(form: HTMLFormElement) {
  if (!pendingEmail) return show('Önce e-posta adresini yaz.',true);
  const token=String(new FormData(form).get('token')??'').trim();
  if (!/^\d{6,8}$/.test(token)) return show('Lütfen e-postandaki 6 ila 8 haneli doğrulama kodunu yaz.',true);
  const {data,error}=await api.auth.verifyOtp({email:pendingEmail,token,type:'email'});
  if (error) return show('Kod doğrulanamadı: '+error.message,true);
  if (!data.session) return show('Kod doğrulandı ancak oturum oluşturulamadı. Yeni kod isteyip tekrar dene.',true);
  pendingEmail='';
  flash='';
  flashError=false;
  // verifyOtp normally triggers SIGNED_IN. This also handles a delayed event.
  if (!session) { session=data.session; void refreshData(); }
}
function loginReturnUrl() {
  // GitHub Pages often runs under /repository-name/, not the domain root.
  // Do not send a user to the wrong page after clicking their magic link.
  return new URL(import.meta.env.BASE_URL, window.location.href).href;
}
async function oauth(provider: 'apple'|'google') {
  if ((provider==='apple'&&!APPLE_LOGIN_READY)||(provider==='google'&&!GOOGLE_LOGIN_READY)) return;
  const {error}=await api.auth.signInWithOAuth({provider,options:{redirectTo:loginReturnUrl()}});
  if(error)show(provider+' ile giriş başarısız: '+error.message,true);
}
async function acceptConsent() {
  if (!session) return;
  if (!(document.querySelector<HTMLInputElement>('#health-consent')?.checked)) return show('Devam etmek için onay kutusunu işaretlemelisin.',true);
  const now=new Date().toISOString();
  const {error}=await api.from('user_consents').upsert({user_id:session.user.id,health_storage_accepted_at:now,consent_version:'beta-2026-10',updated_at:now},{onConflict:'user_id'});
  if(error)return show('Onay kaydedilemedi: '+error.message,true);
  consent=true;flash='Onayın kaydedildi. Hoş geldin!';flashError=false;render();
}
async function saveMeasurement(form: HTMLFormElement) {
  if(!session||!consent)return;
  const data=new FormData(form),kind=String(data.get('kind')) as Kind;
  const value=Number(data.get('value')),rawDate=String(data.get('observed')??'');
  if(!kinds[kind]||!Number.isFinite(value)||value<=0||value>650||!rawDate)return show('Ölçüm bilgilerini kontrol et.',true);
  if(!validPastOrPresentDateTime(rawDate))return show('Ölçüm için yalnızca geçmişteki bir tarih veya şu an seçilebilir. Gelecek tarih ve saatlere izin verilmez.',true);
  if(kind==='body_fat_percent'&&value>100)return show('Yağ yüzdesi 100’ü aşamaz.',true);
  if(kind==='bmi'&&value>120)return show('BKİ değerini kontrol et.',true);
  const {error}=await api.from('health_samples').insert({user_id:session.user.id,kind,value,unit:kinds[kind].unit,source:'manual',observed_at:new Date(rawDate).toISOString()});
  if(error)return show('Kayıt yapılamadı: '+error.message,true);
  flash='Ölçümün kaydedildi.';flashError=false;await refreshData();
}
async function saveInjection(form: HTMLFormElement) {
  if(!session||!consent)return;
  const data=new FormData(form);
  const drug=String(data.get('drug')??'').trim(),doseMg=Number(data.get('dose')),rawDate=String(data.get('at')??''),note=String(data.get('note')??'').trim();
  if(!drug||drug.length>80||!Number.isFinite(doseMg)||doseMg<=0||doseMg>100||note.length>400)return show('Tedavi kaydındaki değerleri kontrol et.',true);
  if(!validPastOrPresentDateTime(rawDate))return show('Tedavi günü için gelecek tarih veya saat kaydedilemez. Gerçek uygulama tarihini seç.',true);
  const entry:Injection={id:crypto.randomUUID(),drug,doseMg,at:new Date(rawDate).toISOString(),note};
  const payload={...normalizeJournal(journal?.payload),injections:[...normalizeJournal(journal?.payload).injections,entry]};
  const now=new Date().toISOString();
  if(!journal) {
    const {error}=await api.from('journal_records').insert({user_id:session.user.id,payload,revision:1,updated_at:now});
    if(error)return show('Kaydedilemedi. Başka cihazda yeni kayıt oluşturulmuş olabilir. Sayfayı yenileyip tekrar kontrol et.',true);
  } else {
    const {data:updated,error}=await api.from('journal_records').update({payload,revision:journal.revision+1,updated_at:now})
      .eq('user_id',session.user.id).eq('revision',journal.revision).select('revision');
    if(error||!updated?.length)return show('Başka cihazda değişiklik algılandı. Kayıt üzerine yazılmadı; önce sayfayı yenile.',true);
  }
  flash='Tedavi kaydın saklandı.';flashError=false;await refreshData();
}
function normalizeDocumentFile(file: File): {file: File;mime: string;extension: string}|null {
  const ext=file.name.split('.').pop()?.toLowerCase()??'';
  const mimeByExt: Record<string,string> = {
    pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',
  };
  const mime=mimeByExt[ext];
  if (!mime || (file.type && file.type!=='application/octet-stream' && file.type!=='application/x-pdf' && file.type!==mime)) return null;
  // Some macOS browsers report PDFs with an empty or generic MIME type.
  const normalized=file.type===mime ? file : new File([file],file.name,{type:mime,lastModified:file.lastModified});
  return {file:normalized,mime,extension:documentMimes[mime]};
}
function documentUploadStatus(form: HTMLFormElement, label: string, percent: number|null) {
  const container=form.querySelector<HTMLElement>('[data-doc-progress]');
  if (!container) return;
  container.hidden=false;
  const caption=container.querySelector<HTMLElement>('[data-doc-progress-label]');
  const value=container.querySelector<HTMLElement>('[data-doc-progress-value]');
  const bar=container.querySelector<HTMLProgressElement>('[data-doc-progress-bar]');
  if (caption) caption.textContent=label;
  if (value) value.textContent=percent===null?'':`${percent}%`;
  if (bar) {
    if (percent===null) bar.removeAttribute('value');
    else bar.value=percent;
  }
}
async function uploadDocumentFile(file: File,path: string,form: HTMLFormElement): Promise<void> {
  const {data:{session:current},error:sessionError}=await api.auth.getSession();
  if (sessionError || !current || current.user.id!==session?.user.id) throw new Error('Oturumun süresi dolmuş olabilir. Tekrar giriş yap.');
  return new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    const safePath=path.split('/').map(encodeURIComponent).join('/');
    const url=`${SUPABASE_URL.replace(/\/+$/,'')}/storage/v1/object/${DOCUMENTS_BUCKET}/${safePath}`;
    xhr.open('POST',url,true);
    xhr.timeout=90000;
    xhr.setRequestHeader('Authorization',`Bearer ${current.access_token}`);
    xhr.setRequestHeader('apikey',SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader('x-upsert','false');
    xhr.upload.onprogress=event=>{
      if (!event.lengthComputable || !event.total) return;
      const percent=Math.min(99,Math.floor(event.loaded/event.total*100));
      documentUploadStatus(form,'Dosya yükleniyor…',percent);
    };
    xhr.onerror=()=>reject(new Error('Bağlantı kesildi. İnternetini kontrol edip yeniden dene.'));
    xhr.ontimeout=()=>reject(new Error('Yükleme 90 saniyede tamamlanamadı. Tekrar deneyebilirsin.'));
    xhr.onabort=()=>reject(new Error('Dosya yüklemesi iptal edildi.'));
    xhr.onload=()=>{
      if (xhr.status>=200 && xhr.status<300) {
        documentUploadStatus(form,'Dosya aktarıldı. Kayıt doğrulanıyor…',100);
        resolve();
        return;
      }
      let detail=`Sunucu yanıtı: ${xhr.status}`;
      try {
        const error=JSON.parse(xhr.responseText) as {message?:string;error?:string};
        detail=String(error.message||error.error||detail);
      } catch { /* Preserve the HTTP status if the response is not JSON. */ }
      reject(new Error(detail));
    };
    const body=new FormData();
    // Same multipart field ordering as supabase/storage-js standard upload.
    body.append('cacheControl','0');
    body.append('',file,file.name);
    xhr.send(body);
  });
}
async function saveDocument(form: HTMLFormElement) {
  if (!session || !consent || documentsLoadError) return show('Önce belge erişimini kontrol et.',true);
  if (documentFilter==='all') return show('Belge eklemek için önce bir kategori seçmelisin.',true);
  const userId=session.user.id;
  const category=documentFilter;
  const editing=editingDocumentId
    ? documents.find(item=>item.id===editingDocumentId && item.user_id===userId && item.category===category)
    : null;
  if (editingDocumentId && !editing) return show('Düzenlenecek belge bulunamadı. Sayfayı yenile.',true);
  const fields=new FormData(form);
  const title=String(fields.get('title')??'').trim();
  const documentDate=String(fields.get('document_date')??'');
  const providerName=String(fields.get('provider_name')??'').trim();
  const doctorName=String(fields.get('doctor_name')??'').trim();
  const notes=String(fields.get('notes')??'').trim();
  const input=form.querySelector<HTMLInputElement>('input[name="file"]');
  const original=input?.files?.[0]??null;
  const prepared=original?normalizeDocumentFile(original):null;
  if (!validPastOrPresentDate(documentDate)) {
    return show('Belge tarihi gelecekte olamaz. Bugünü veya geçmişteki bir tarihi seç.',true);
  }
  if (!title || title.length>160 || !/^\d{4}-\d{2}-\d{2}$/.test(documentDate)
    || providerName.length>160 || doctorName.length>120 || notes.length>10000 || (!notes && !original && !editing?.file_path)) {
    return show('Belge başlığını, tarihini ve açıklamasını kontrol et. Dosya veya açıklama gerekli.',true);
  }
  if (original && (!prepared || original.size<1 || original.size>MAX_DOCUMENT_BYTES || original.name.length>255)) {
    return show('PDF, JPG, PNG veya WebP yükle. Dosya boyutu en fazla 5 MB olmalı.',true);
  }
  const id=editing?.id??crypto.randomUUID();
  // Never overwrite a file: unique paths only need the existing INSERT policy.
  const newPath=prepared?`${userId}/${crypto.randomUUID()}.${prepared.extension}`:null;
  if (prepared && newPath) {
    documentUploadStatus(form,'Dosya yükleniyor…',0);
    try {
      await uploadDocumentFile(prepared.file,newPath,form);
    } catch (error) {
      documentUploadStatus(form,'Yükleme başarısız.',null);
      return show('Belge yüklenemedi: '+(error instanceof Error?error.message:String(error)),true);
    }
  } else {
    documentUploadStatus(form,'Belge bilgileri kaydediliyor…',null);
  }
  const metadata={
    title,document_date:documentDate,
    provider_name:providerName||null,doctor_name:doctorName||null,notes:notes||null,
    file_path:newPath??editing?.file_path??null,
    file_name:original?.name??editing?.file_name??null,
    file_mime:prepared?.mime??editing?.file_mime??null,
    file_size_bytes:original?.size??editing?.file_size_bytes??null,
    updated_at:new Date().toISOString(),
  };
  const {data:savedRows,error}=editing
    ? await api.from('health_documents').update(metadata).eq('id',id).eq('user_id',userId).select('id')
    : await api.from('health_documents').insert({id,user_id:userId,category,...metadata}).select('id');
  if (error || !savedRows?.length) {
    if (newPath) {
      const cleanup=await api.storage.from(DOCUMENTS_BUCKET).remove([newPath]);
      if (cleanup.error) return show('Kayıt yapılamadı; yüklenen dosya da temizlenemedi: '+cleanup.error.message,true);
    }
    documentUploadStatus(form,'Kayıt başarısız.',null);
    return show('Belge kaydedilemedi: '+(error?.message??'Kayıt bulunamadı veya başka bir cihazda silindi.'),true);
  }
  let cleanupWarning='';
  if (editing?.file_path && newPath) {
    const cleanup=await api.storage.from(DOCUMENTS_BUCKET).remove([editing.file_path]);
    if (cleanup.error) cleanupWarning='Değişiklikler kaydedildi ancak eski dosya temizlenemedi: '+cleanup.error.message;
  }
  editingDocumentId=null;
  flash=editing?'Belge güncellendi.':'Sağlık belgen güvenle kaydedildi.';
  flashError=false;
  await refreshData();
  if (cleanupWarning) show(cleanupWarning,true);
}
async function downloadDocument(id: string) {
  if (!session) return;
  const target=documents.find(item=>item.id===id && item.user_id===session?.user.id);
  if (!target?.file_path) return show('Bu kayda ait indirilebilir dosya yok.',true);
  const {data,error}=await api.storage.from(DOCUMENTS_BUCKET).download(target.file_path);
  if (error || !data) return show('Dosya indirilemedi: '+(error?.message??'Bağlantı hatası'),true);
  const url=URL.createObjectURL(data);
  const link=document.createElement('a');
  link.href=url;link.download=target.file_name??'welldose-belge';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function deleteDocument(id: string) {
  if (!session) return;
  const target=documents.find(item=>item.id===id && item.user_id===session?.user.id);
  if (!target || !confirm('“'+target.title+'” kaydını kalıcı olarak silmek istiyor musun?')) return;
  const {error}=await api.from('health_documents').delete().eq('id',target.id).eq('user_id',session.user.id);
  if (error) return show('Belge silinemedi: '+error.message,true);
  if (target.file_path) {
    const {error:storageError}=await api.storage.from(DOCUMENTS_BUCKET).remove([target.file_path]);
    if (storageError) {
      flash='Kayıt silindi ancak dosya temizleme işlemi tamamlanamadı: '+storageError.message;
      flashError=true;
      await refreshData();
      return;
    }
  }
  flash='Belge silindi.';flashError=false;await refreshData();
}
async function exportData() {
  if(!session)return;
  const data={exportedAt:new Date().toISOString(),userEmail:session.user.email,health_samples:samples,
    journal:journal?.payload??{injections:[]},health_documents:documents,
    note:'PDF ve fotoğraflar bu JSON dosyasına dahil değildir; ayrıca indirilmelidir.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='welldose-kisisel-yedek.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function eraseData() {
  if(!session||prompt('Ölçümlerini, tedavi günlüğünü ve sağlık belgelerini geri dönüşsüz silmek için SİL yaz:')!=='SİL')return;
  const id=session.user.id;
  const filePaths=documents.filter(item=>item.file_path).map(item=>item.file_path!);
  const [s,j,d]=await Promise.all([api.from('health_samples').delete().eq('user_id',id),
    api.from('journal_records').delete().eq('user_id',id),api.from('health_documents').delete().eq('user_id',id)]);
  if(s.error||j.error||d.error)return show('Kısmi silme hatası. Verileri yeniden yükleyip kontrol et: '+(s.error?.message??j.error?.message??d.error?.message),true);
  for (let i=0;i<filePaths.length;i+=100) {
    const {error}=await api.storage.from(DOCUMENTS_BUCKET).remove(filePaths.slice(i,i+100));
    if (error) return show('Veri kayıtları silindi, ancak dosyalar tamamen temizlenemedi: '+error.message,true);
  }
  flash='Sağlık kayıtların silindi. Hesabın açık kalıyor.';flashError=false;await refreshData();
}
async function signOut(global=false) {
  const {error}=await api.auth.signOut({scope:global?'global':'local'});
  if(error)return show('Çıkış yapılamadı: '+error.message,true);
  session=null;pendingEmail='';clearPrivateData();flash='';render();
}

// Keep the upper limit current even when a form stays open for a long time.
document.addEventListener('focusin',event=>{
  const input=event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.type==='datetime-local') input.max=localDateTime();
  if (input.type==='date') input.max=localDateTime().slice(0,10);
});
document.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;
  const kind=form.dataset.form;
  if(!kind)return;
  event.preventDefault();
  const submit=form.querySelector<HTMLButtonElement>('[type=submit]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const action=kind==='email'?sendLink(form):kind==='otp'?verifyCode(form):kind==='measurement'?saveMeasurement(form):kind==='injection'?saveInjection(form):kind==='health-document'?saveDocument(form):Promise.resolve();
  void action.catch(err=>show('İşlem tamamlanamadı: '+String(err),true)).finally(()=>{if(submit?.isConnected)submit.disabled=false;});
});
document.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-nav],button[data-action],button[data-doc-filter],button[data-doc-action]');
  if(!button||button.disabled)return;
  if (button.dataset.docFilter) {
    const chosen=button.dataset.docFilter;
    if (chosen==='all'||Object.prototype.hasOwnProperty.call(documentKinds,chosen)) {
      documentFilter=chosen as DocumentCategory|'all';editingDocumentId=null;flash='';render();
    }
    return;
  }
  if (button.dataset.docAction && button.dataset.docId) {
    if(button.dataset.docAction==='download')void downloadDocument(button.dataset.docId);
    if(button.dataset.docAction==='delete')void deleteDocument(button.dataset.docId);
    if(button.dataset.docAction==='edit') {
      const target=documents.find(item=>item.id===button.dataset.docId && item.user_id===session?.user.id);
      if (target) {
        documentFilter=target.category;
        editingDocumentId=target.id;
        flash='';render();
        app.querySelector<HTMLInputElement>('#document-title')?.focus();
      }
    }
    return;
  }
  if(button.dataset.nav){page=button.dataset.nav as Page;flash='';render();return;}
  const action=button.dataset.action;
  if(action==='apple'||action==='google')void oauth(action);
  if(action==='resend-otp')void resendCode();
  if(action==='change-email'){pendingEmail='';flash='';flashError=false;render();}
  if(action==='cancel-doc-edit'){editingDocumentId=null;flash='';render();}
  if(action==='accept-consent')void acceptConsent();
  if(action==='sign-out')void signOut();
  if(action==='sign-out-all')void signOut(true);
  if(action==='export')void exportData();
  if(action==='erase-data')void eraseData();
  if(action==='retry-loading')void refreshData();
});
api.auth.onAuthStateChange((event,newSession)=>{
  if(event==='TOKEN_REFRESHED')return;
  if(session?.user.id===newSession?.user.id && event!=='SIGNED_OUT')return;
  session=newSession;
  if(newSession)pendingEmail='';
  generation++;
  clearPrivateData();
  if(!session){loading=false;flash='';render();return;}
  flash='';
  setTimeout(()=>void refreshData(),0);
});
api.auth.getSession().then(({data,error})=>{
  if(error){loading=false;show('Oturum doğrulanamadı. Tekrar deneyebilirsin.',true);return;}
  if(!data.session){loading=false;render();}
  else if(!session){session=data.session;void refreshData();}
}).catch(()=>{loading=false;show('Bağlantı kurulamadı. Daha sonra tekrar dene.',true);});
