import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APPLE_LOGIN_READY, GOOGLE_LOGIN_READY } from './config';
import { PUSH_VAPID_PUBLIC_KEY } from './push-config';
import './styles.css';

type Kind = 'weight' | 'bmi' | 'body_fat_percent' | 'lean_body_mass';
type Page = 'overview' | 'measurements' | 'injections' | 'documents' | 'report' | 'profile' | 'settings';
type UserProfile = {
  user_id: string;
  display_name: string | null;
  birth_date: string | null;
  height_cm: number | null;
  medical_conditions: string | null;
  allergies: string | null;
  regular_medications: string | null;
  surgeries: string | null;
  health_notes: string | null;
  target_weight_kg: number | null;
  goal_notes: string | null;
};
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
type MedicationReminder = {
  id: string;
  drug: string;
  startAt: string;
  repeatDays: 0 | 1 | 7 | 14 | 28;
  note: string;
  enabled: boolean;
};
type JournalPayload = { injections: Injection[]; reminders: MedicationReminder[] };
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
let mobileMenuOpen = false;
let loading = true;
let consent = false;
let samples: HealthSample[] = [];
let journal: JournalRecord | null = null;
let documents: HealthDocument[] = [];
let profile: UserProfile | null = null;
let profileLoadError = '';
let editingProfile = false;
let profileShareConfirm = false;
let documentsLoadError = '';
let documentFilter: DocumentCategory | 'all' = 'all';
let editingDocumentId: string | null = null;
let documentSearch = '';
let chartKind: Kind = 'weight';
let chartWindowDays: 0 | 30 | 90 | 365 = 90;
let doseChartDrug = '';
let reportSelection = new Set<string>();
let reportIncludeProfile = false;
let documentPreviewUrl: string | null = null;
const sentReminderNotifications = new Set<string>();
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
  if (typeof payload !== 'object' || !payload) return { injections: [],reminders:[] };
  const value = payload as { injections?: unknown;reminders?: unknown };
  const injections: Injection[] = (Array.isArray(value.injections)?value.injections:[]).filter(item => item && typeof item === 'object'
    && typeof item.at === 'string' && Number.isFinite(Number(item.doseMg))
    && typeof item.drug === 'string').map(item => ({
    id: String(item.id ?? crypto.randomUUID()),
    drug: String(item.drug),
    doseMg: Number(item.doseMg),
    at: String(item.at),
    note: String(item.note ?? ''),
  }));
  const reminders:MedicationReminder[]=(Array.isArray(value.reminders)?value.reminders:[])
    .filter(item=>item && typeof item==='object' && typeof item.drug==='string' && typeof item.startAt==='string'
      && Number.isFinite(Date.parse(item.startAt)) && [0,1,7,14,28].includes(Number(item.repeatDays)))
    .map(item=>({id:String(item.id??crypto.randomUUID()),drug:String(item.drug).slice(0,80),startAt:String(item.startAt),
      repeatDays:Number(item.repeatDays) as MedicationReminder['repeatDays'],note:String(item.note??'').slice(0,400),enabled:item.enabled!==false}));
  return { injections,reminders };
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
function metricChart(kind:Kind,days:0|30|90|365):string {
  const since=days?Date.now()-days*86400000:0;
  const points=samples.filter(s=>s.kind===kind && Date.parse(s.observed_at)>=since)
    .slice().sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at)).slice(-80);
  const label=kinds[kind].name,unit=kinds[kind].short;
  if(points.length<2)return `<div class="empty-chart">${esc(label)} için bu aralıkta en az iki ölçüm gerekli.</div>`;
  const vals=points.map(x=>Number(x.value));
  const first=vals[0],last=vals[vals.length-1],change=last-first;
  const low=Math.min(...vals),high=Math.max(...vals),span=Math.max(high-low,0.1);
  const start=Date.parse(points[0].observed_at),end=Date.parse(points[points.length-1].observed_at);
  const coords=vals.map((val,i)=>({x:23+(Date.parse(points[i].observed_at)-start)/Math.max(end-start,1)*553,
    y:166-(val-low)/span*117}));
  const difference=(change>0?'+':'')+number(change,2);
  return `<div class="trend-metrics"><div><span>İlk değer</span><strong>${number(first,2)} ${esc(unit)}</strong></div>
    <div><span>Son değer</span><strong>${number(last,2)} ${esc(unit)}</strong></div>
    <div><span>Değişim</span><strong>${difference} ${esc(unit)}</strong></div></div>
    <div class="graph-wrap" role="img" aria-label="${esc(label)} için ${points.length} kaydın tarihsel değişimi">
      <svg viewBox="0 0 600 200" preserveAspectRatio="none" class="line-chart">
        <line x1="23" y1="166" x2="577" y2="166" stroke="#dce9e1"/>
        <line x1="23" y1="100" x2="577" y2="100" stroke="#edf3ef"/>
        <path d="M${coords.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')}" fill="none" stroke="#407b6e" stroke-width="3.5" stroke-linecap="round"/>
        ${coords.map(p=>`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5" fill="#407b6e"/>`).join('')}
      </svg><div class="chart-legend"><span>${dateDisplay(points[0].observed_at)}</span><span>${dateDisplay(points[points.length-1].observed_at)}</span></div>
    </div><p class="helper">Kayıtlarına göre değişim gösterilir. Grafik tıbbi değerlendirme yerine geçmez.</p>`;
}
function doseChart():string {
  const all=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const drugs=[...new Set(all.map(item=>item.drug))];
  if(!drugs.length)return '<p class="empty-state">Doz grafiği için en az bir tedavi kaydı ekle.</p>';
  const selected=drugs.includes(doseChartDrug)?doseChartDrug:drugs[drugs.length-1];
  const relevant=all.filter(item=>item.drug===selected).slice(-12),largest=Math.max(...relevant.map(item=>item.doseMg));
  return `<label class="chart-select-label" for="dose-chart-drug">İlaç seç</label>
    <select id="dose-chart-drug" data-chart-drug>${drugs.map(drug=>`<option value="${esc(drug)}" ${drug===selected?'selected':''}>${esc(drug)}</option>`).join('')}</select>
    <div class="dose-chart" role="img" aria-label="${esc(selected)} için son ${relevant.length} kayıtlı doz">
      ${relevant.map(item=>`<div class="dose-bar-item"><strong>${number(item.doseMg,2)} mg</strong><div class="dose-bar-track"><div class="dose-bar" style="height:${Math.max(5,item.doseMg/largest*100).toFixed(2)}%"></div></div><small>${dateDisplay(item.at)}</small></div>`).join('')}
    </div><p class="helper">Yalnızca aynı ilacın kayıtlı dozları gösterilir; uygulama doz önermez.</p>`;
}
function overview() {
  const latestWeight=samples.find(s=>s.kind==='weight');
  const latestFat=samples.find(s=>s.kind==='body_fat_percent');
  const injections=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const targetWeight=profile?.target_weight_kg;
  const nextReminder=normalizeJournal(journal?.payload).reminders.filter(r=>r.enabled)
    .map(reminder=>({reminder,next:nextReminderAt(reminder)})).sort((a,b)=>a.next.getTime()-b.next.getTime())[0];
  return `<div class="page-title"><div><div class="eyebrow">GENEL BAKIŞ</div><h1>İlerlemeni keşfet.</h1><p>Her küçük adım, büyük bir değişimin parçası.</p></div><button class="secondary-button" data-nav="measurements">+ Ölçüm ekle</button></div>
    <div class="stats-grid">
      ${stat('Güncel kilo',latestWeight?`${number(Number(latestWeight.value))} kg`:'—','En son kaydedilen ölçüm','⚖')}
      ${stat('Vücut yağ oranı',latestFat?`${number(Number(latestFat.value))}%`:'—','Güncel vücut kompozisyonu','◌')}
      ${stat('Son enjeksiyon',injections.length?dateDisplay(injections[0].at):'—','Kullanıcının kayıt ettiği doz','◷')}
      ${stat('Ölçüm sayısı',String(samples.length),'Kişisel sağlık kayıtların','✦')}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-top"><div><h2>Kilo yolculuğu</h2><p>Son 12 ölçüm</p></div><span class="tag">kg</span></div>${weightGraph()}</section>
      <section class="panel tip-panel"><div class="eyebrow">SANA ÖZEL</div><h2>${targetWeight!=null?'Kişisel hedefin':'İlerlemek için'}<br/>${targetWeight!=null?`${number(targetWeight)} kg`:'bir adım daha.'}</h2>
        <p>${targetWeight!=null && latestWeight ? `Son kilon ${number(Number(latestWeight.value))} kg. Hedefini profilinden güncelleyebilir, ilerlemeni ölçüm kayıtlarından izleyebilirsin.` : 'Düzenli kayıt tutmak, zaman içindeki değişimleri doktorunla değerlendirmeni kolaylaştırabilir.'}</p>
        <button data-nav="profile" class="secondary-button">${targetWeight!=null?'Profilimi ve hedeflerimi düzenle':'Kişisel profilimi oluştur'} →</button><div class="tip-decoration">✳</div></section>
    </div>
    ${nextReminder?`<section class="panel overview-reminder"><div><div class="eyebrow">PLANLI HATIRLATMAM</div><h2>${esc(nextReminder.reminder.drug)}</h2>
      <p>${esc(new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(nextReminder.next))} · ${nextReminder.next.getTime()<Date.now()?'Zamanı geçti':'Yaklaşan zaman'}</p></div>
      <button type="button" class="secondary-button" data-nav="injections">Hatırlatmaları yönet →</button></section>`:''}`;
}
function measurements() {
  const items=samples.slice(0,60);
  return `<div class="page-title"><div><div class="eyebrow">VÜCUT ANALİZİ</div><h1>Ölçümlerim.</h1><p>Değişimleri tarihleriyle kaydet ve izle.</p></div></div>
  <section class="panel tracking-chart-panel"><div class="panel-top"><div><h2>Ölçüm grafikleri</h2><p>Seçtiğin zaman aralığındaki değişim</p></div><span class="tag">Kişisel takip</span></div>
    <div class="chart-filters"><div class="chart-metric-buttons">${(Object.keys(kinds) as Kind[]).map(id=>`<button type="button" data-chart-kind="${id}" class="chart-filter ${chartKind===id?'active':''}">${esc(kinds[id].name)}</button>`).join('')}</div>
      <div class="chart-period-buttons">${([30,90,365,0] as const).map(days=>`<button type="button" data-chart-days="${days}" class="chart-filter ${chartWindowDays===days?'active':''}">${days===0?'Tümü':days===365?'1 yıl':days+' gün'}</button>`).join('')}</div></div>
    ${metricChart(chartKind,chartWindowDays)}</section>
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
function localDateTime(minutesFromNow=0) {
  const d=new Date(Date.now()+minutesFromNow*60000);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function nextReminderAt(reminder:MedicationReminder):Date {
  const first=new Date(reminder.startAt).getTime();
  if(!reminder.repeatDays || first>Date.now())return new Date(first);
  const interval=reminder.repeatDays*86400000;
  return new Date(first+Math.ceil((Date.now()-first)/interval)*interval);
}
function remindersPanel():string {
  const reminders=normalizeJournal(journal?.payload).reminders;
  return `<section class="panel"><div class="panel-top"><div><h2>İlaç hatırlatmalarım</h2><p>Zamanı ve tekrarını kendin belirle</p></div><span class="tag">${reminders.length} plan</span></div>
    <form data-form="reminder" class="reminder-form">
      <div><label for="reminder-drug">İlaç / hatırlatma adı</label><input id="reminder-drug" name="drug" maxlength="80" required placeholder="İlaç adı" /></div>
      <div><label for="reminder-start">İlk hatırlatma</label><input id="reminder-start" name="startAt" type="datetime-local" required min="${localDateTime()}" value="${localDateTime(10)}" /></div>
      <div><label for="reminder-repeat">Tekrar</label><select id="reminder-repeat" name="repeatDays"><option value="0">Bir defa</option><option value="1">Her gün</option><option value="7">Her 7 gün</option><option value="14">Her 14 gün</option><option value="28">Her 28 gün</option></select></div>
      <button type="submit" class="primary-button">Hatırlatma ekle →</button>
    </form>
    <div class="reminder-list">${reminders.length?reminders.map(reminder=>{
      const next=nextReminderAt(reminder),missed=next.getTime()<Date.now();
      const when=new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(next);
      return `<div class="reminder-item"><div><strong>${esc(reminder.drug)}</strong><small>${reminder.repeatDays?`Her ${reminder.repeatDays} gün`:'Tek sefer'} · ${esc(when)}${missed?' · Süresi geçti':''} · ${reminder.enabled?'Etkin':'Kapalı'}</small></div>
        <button type="button" class="secondary-button" data-reminder-action="toggle" data-reminder-id="${esc(reminder.id)}">${reminder.enabled?'Duraklat':'Etkinleştir'}</button>
        <button type="button" class="document-delete" data-reminder-action="delete" data-reminder-id="${esc(reminder.id)}">Sil</button></div>`;
    }).join(''):'<p class="empty-state">Planlanmış hatırlatman yok.</p>'}</div>
    <p class="helper">Planlı tarihler, ilacın alındığı anlamına gelmez. Telefonunda ana ekrana eklediğin WellDose'a bildirim izni vererek uygulama kapalıyken de genel bir hatırlatma alabilirsin. Bildirimler internet ve telefon ayarlarına bağlıdır; kesin zamanlı tıbbi alarm değildir.</p>
    <div class="reminder-notification-tools">
      <button type="button" class="secondary-button" data-action="enable-notifications">🔔 Bu cihazda bildirimleri aç</button>
      <button type="button" class="secondary-button" data-action="disable-notifications">Bildirimleri bu cihazda kapat</button>
    </div>
    <p class="helper">iPhone/iPad: Safari'de Paylaş → Ana Ekrana Ekle; ardından WellDose simgesinden uygulamayı açıp bildirim izni ver. Android: Chrome'da yükle/ana ekrana ekle. Kilit ekranı bildirimi gizliliğin için ilaç adını veya dozunu içermez.</p>
  </section>`;
}
function injectionsPage() {
  const items=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return `<div class="page-title"><div><div class="eyebrow">TEDAVİ GÜNLÜĞÜ</div><h1>Doz kayıtlarım.</h1><p>Yalnızca doktorunun önerdiği tedaviyi kayıt altına al.</p></div></div>
    <section class="panel tracking-chart-panel"><div class="panel-top"><div><h2>İlaç dozu grafiği</h2><p>Son 12 kayıtlı uygulama</p></div><span class="tag">mg</span></div>${doseChart()}</section>
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
      <div class="record-list">${items.length?items.map(item=>`<div class="record-row"><div class="record-dot dose-dot"></div><div class="record-info"><b>${esc(item.drug)}</b><small>${dateDisplay(item.at)}${item.note?' · '+esc(item.note):''}</small></div><strong>${number(item.doseMg,2)} mg</strong></div>`).join(''):'<p class="empty-state">Henüz enjeksiyon kaydı yok.</p>'}</div></section></div>${remindersPanel()}`;
}
function documentsPage() {
  const entries = Object.entries(documentKinds) as [DocumentCategory, typeof documentKinds[DocumentCategory]][];
  const items = documentFilter === 'all' ? documents : documents.filter(item=>item.category===documentFilter);
  const editing = editingDocumentId && documentFilter !== 'all'
    ? documents.find(item=>item.id===editingDocumentId && item.category===documentFilter && item.user_id===session?.user.id)
    : null;
  return `<div class="page-title"><div><div class="eyebrow">KİŞİSEL SAĞLIK ARŞİVİN</div><h1>Sağlık Belgelerim.</h1>
    <p>Raporlarını, reçetelerini ve notlarını tarihleriyle güvenle sakla.</p></div><button type="button" class="secondary-button" data-nav="report">Doktor raporu hazırla →</button></div>
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
      <section class="panel"><div class="panel-top"><div><h2>${documentFilter==='all'?'Kayıtlı belgeler':esc(documentKinds[documentFilter].label)}</h2><p>En yeni tarihli belgeler üstte</p></div><span class="tag" data-document-count>${items.length} kayıt</span></div>
        <label class="document-search-label" for="document-search">Başlık, doktor, kurum veya not içinde ara</label>
        <input id="document-search" class="document-search" data-document-search type="search" maxlength="120" placeholder="Örn. kan tahlili, MR, doktor adı..." value="${esc(documentSearch)}" />
        <div class="document-list">${items.length ? items.map(item=>{
          const kind=documentKinds[item.category]??{icon:'▤',label:item.category};
          return `<article class="document-item" data-document-id="${esc(item.id)}"><div class="document-item-head"><span class="document-type-icon">${kind.icon}</span><div><strong>${esc(item.title)}</strong><small>${esc(kind.label)} · ${dateDisplay(item.document_date)}${item.provider_name?' · '+esc(item.provider_name):''}</small></div></div>
            ${item.doctor_name?`<p class="document-by">Doktor: ${esc(item.doctor_name)}</p>`:''}
            ${item.notes?`<p class="document-note">${esc(item.notes.length>300?item.notes.slice(0,300)+'…':item.notes)}</p>`:''}
            <div class="document-actions">${item.file_path?`<button class="secondary-button" data-doc-action="download" data-doc-id="${esc(item.id)}">↓ ${esc(item.file_name??'Dosyayı indir')}</button>`:'<span class="note-only-tag">Yazılı not</span>'}
              ${item.file_path?`<button class="secondary-button" data-doc-action="preview" data-doc-id="${esc(item.id)}">◉ Önizle</button>`:''}
              <button class="secondary-button" data-doc-action="edit" data-doc-id="${esc(item.id)}">Düzenle</button>
              <button class="document-delete" data-doc-action="delete" data-doc-id="${esc(item.id)}" aria-label="${esc(item.title)} kaydını sil">Sil</button></div></article>`;
        }).join(''):`<div class="empty-state">${documentFilter==='all'?'Henüz kaydedilmiş belge yok. Eklemek için yukarıdan bir kategori seç.':'Bu kategoride henüz belge bulunmuyor. İlk kaydını soldan ekleyebilirsin.'}</div>`}
        <div class="empty-state" data-document-no-results hidden>Aramana uygun kayıt bulunamadı.</div></div>
      </section>
    </div>`}`;
}
function filterDocumentList() {
  if(page!=='documents')return;
  const query=documentSearch.toLocaleLowerCase('tr-TR').trim();
  let count=0;
  for(const row of app.querySelectorAll<HTMLElement>('.document-item[data-document-id]')) {
    const found=documents.find(doc=>doc.id===row.dataset.documentId);
    const text=found?[found.title,found.notes,found.doctor_name,found.provider_name,documentKinds[found.category]?.label].join(' ').toLocaleLowerCase('tr-TR'):'';
    row.hidden=Boolean(query && !text.includes(query));
    if(!row.hidden)count++;
  }
  const label=app.querySelector<HTMLElement>('[data-document-count]');
  if(label)label.textContent=`${count} kayıt`;
  const noResults=app.querySelector<HTMLElement>('[data-document-no-results]');
  if(noResults)noResults.hidden=count!==0 || !Boolean(query) || !app.querySelector('.document-item');
}
function profilePage() {
  if (profileLoadError) return `<div class="page-title"><div><div class="eyebrow">KİŞİSEL PROFİL</div><h1>Profilim.</h1></div></div>
    <section class="panel"><div class="notice notice-error">Profil bilgileri yüklenemedi: ${esc(profileLoadError)}. Yanlışlıkla üzerine yazmamak için düzenleme geçici olarak kapatıldı.</div>
    <button class="secondary-button" data-action="retry-loading">Yeniden dene</button></section>`;
  const p=profile;
  const value=(key: keyof UserProfile)=>esc(p?.[key]??'');
  if(p && !editingProfile) {
    const item=(label:string,raw:unknown)=>`<div class="profile-summary-item"><span>${esc(label)}</span><strong>${raw==null||String(raw).trim()===''?'Belirtilmedi':esc(raw)}</strong></div>`;
    const multiline=(label:string,raw:unknown)=>`<div class="profile-summary-item profile-summary-note"><span>${esc(label)}</span><p>${raw==null||String(raw).trim()===''?'Belirtilmedi':esc(raw)}</p></div>`;
    return `<div class="page-title profile-screen-title"><div><div class="eyebrow">KİŞİSEL SAĞLIK ÖZETİN</div><h1>Profilim ve hedeflerim.</h1>
      <p>Kaydettiğin bilgilerin tamamı tek sayfada. Yalnızca hesabına aittir.</p></div><span class="tag">Güncel profil</span></div>
      <div class="profile-toolbar" aria-label="Profil işlemleri">
        <button class="secondary-button" data-action="profile-edit">✎ Düzenle</button>
        <button class="secondary-button" data-action="profile-print">▤ Yazdır / PDF</button>
        <button class="secondary-button" data-action="profile-share">↗ Gönder</button>
        <button class="secondary-button" data-action="profile-download">↓ İndir (JSON)</button>
        <button class="document-delete" data-action="profile-delete">Sil</button>
      </div>
      ${profileShareConfirm?`<section class="profile-share-confirm" role="region" aria-label="Paylaşım onayı"><strong>Hassas sağlık bilgilerini paylaşmak üzeresin.</strong>
        <p>Ad-soyadın, doğum tarihin, sağlık geçmişin, ilaçların ve hedeflerin cihazının paylaşım menüsüne aktarılacak. Alıcıyı sen seçeceksin.</p>
        <div><button class="primary-button" data-action="profile-share-now">Paylaşım ekranını aç →</button><button class="secondary-button" data-action="profile-share-cancel">Vazgeç</button></div></section>`:''}
      <article class="profile-report" id="profile-report">
        <header class="profile-report-header"><div><div class="eyebrow">WELLDOSE • KİŞİSEL KAYIT</div><h2>${esc(p.display_name||'Sağlık Profilim')}</h2>
          <p>Bilgiler kullanıcının kendi beyanıdır; resmi tıbbi rapor değildir.</p></div><span>✳ well<span>dose</span></span></header>
        <div class="profile-grid">
          <section class="panel profile-panel"><div class="profile-heading"><span class="profile-icon">◉</span><div><h2>Kişisel bilgiler</h2><p>Temel bilgiler</p></div></div>
            <div class="profile-summary-grid">${item('Ad ve soyad',p.display_name)}${item('Doğum tarihi',p.birth_date?dateDisplay(p.birth_date+'T12:00:00'):null)}
              ${item('Boy',p.height_cm==null?null:`${number(Number(p.height_cm))} cm`)}</div></section>
          <section class="panel profile-panel"><div class="profile-heading"><span class="profile-icon">✦</span><div><h2>Hedeflerim</h2><p>Kişisel takip hedeflerim</p></div></div>
            <div class="profile-summary-grid">${item('Hedef kilo',p.target_weight_kg==null?null:`${number(Number(p.target_weight_kg))} kg`)}
              ${multiline('Hedef / motivasyon notum',p.goal_notes)}</div></section>
        </div>
        <section class="panel profile-panel profile-history"><div class="profile-heading"><span class="profile-icon">♡</span><div><h2>Sağlık geçmişim</h2><p>Kendi kaydettiğim bilgiler</p></div></div>
          <div class="profile-summary-grid">${multiline('Hastalıklar / tanılar',p.medical_conditions)}${multiline('Bilinen alerjiler',p.allergies)}
            ${multiline('Düzenli ilaçlarım',p.regular_medications)}${multiline('Ameliyatlar / işlemler',p.surgeries)}
            ${multiline('Diğer sağlık notları',p.health_notes)}</div></section>
        <footer class="profile-report-footer">WellDose kişisel kayıt özeti • Otomatik sağlık önerisi veya tanı içermez.</footer>
      </article>`;
  }
  return `<div class="page-title"><div><div class="eyebrow">SAĞLIK YOLCULUĞUNUN MERKEZİ</div><h1>Profilim ve hedeflerim.</h1>
    <p>${p?'Mevcut bilgilerini düzenle ve kaydet.':'İlk profilini oluştur; ardından tek sayfadan görüntüle, düzenle ve paylaş.'}</p></div><span class="tag">Yalnızca sana özel</span></div>
    <form data-form="profile" class="profile-form">
      <div class="profile-grid">
        <section class="panel profile-panel"><div class="profile-heading"><span class="profile-icon">◉</span><div><h2>Kişisel bilgiler</h2><p>Temel bilgilerin ve ölçüm bağlamın</p></div></div>
          <div class="profile-fields">
            <div class="profile-field profile-field-wide"><label for="profile-name">Ad ve soyad</label><input id="profile-name" name="display_name" maxlength="80" autocomplete="name" placeholder="Adın ve soyadın" value="${value('display_name')}" /></div>
            <div class="profile-field"><label for="profile-birth">Doğum tarihi</label><input id="profile-birth" name="birth_date" type="date" min="1900-01-01" max="${localDateTime().slice(0,10)}" value="${value('birth_date')}" /></div>
            <div class="profile-field"><label for="profile-height">Boy (cm)</label><input id="profile-height" name="height_cm" type="number" min="40" max="260" step="0.1" placeholder="Örn. 175" value="${value('height_cm')}" /></div>
          </div><p class="helper">Bu alanlar isteğe bağlıdır. Gelecekteki doğum tarihleri kabul edilmez.</p>
        </section>
        <section class="panel profile-panel"><div class="profile-heading"><span class="profile-icon">✦</span><div><h2>Kişisel hedefler</h2><p>İlerlemek istediğin noktayı belirle</p></div></div>
          <div class="profile-fields"><div class="profile-field profile-field-wide"><label for="profile-target">Hedef kilo (kg)</label><input id="profile-target" name="target_weight_kg" type="number" min="20" max="650" step="0.1" placeholder="Örn. 75" value="${value('target_weight_kg')}" /></div>
            <div class="profile-field profile-field-wide"><label for="profile-goal-notes">Hedeflerim / motivasyon notum</label><textarea id="profile-goal-notes" name="goal_notes" rows="5" maxlength="2000" placeholder="Kendin için belirlediğin hedefleri yazabilirsin…">${value('goal_notes')}</textarea></div></div>
          <p class="helper">Hedefler kişisel takip içindir, tıbbi tedavi veya kilo önerisi değildir.</p>
        </section>
      </div>
      <section class="panel profile-panel profile-history"><div class="profile-heading"><span class="profile-icon">♡</span><div><h2>Sağlık geçmişim</h2><p>Doktorunla paylaşmak isteyebileceğin önemli bilgileri kendin kaydedebilirsin</p></div></div>
        <div class="profile-fields">
          <div class="profile-field"><label for="profile-conditions">Kronik hastalıklar / tanılar</label><textarea id="profile-conditions" name="medical_conditions" rows="4" maxlength="4000" placeholder="Örn. doktor tarafından tanı konulan rahatsızlıklar…">${value('medical_conditions')}</textarea></div>
          <div class="profile-field"><label for="profile-allergies">Bilinen alerjiler</label><textarea id="profile-allergies" name="allergies" rows="4" maxlength="2000" placeholder="Biliniyorsa ilaç, gıda veya diğer alerjiler…">${value('allergies')}</textarea></div>
          <div class="profile-field"><label for="profile-medicines">Düzenli kullandığım ilaçlar</label><textarea id="profile-medicines" name="regular_medications" rows="4" maxlength="4000" placeholder="İlaç adı ve doktorun belirttiği kullanım bilgileri…">${value('regular_medications')}</textarea></div>
          <div class="profile-field"><label for="profile-surgeries">Ameliyatlar / önemli işlemler</label><textarea id="profile-surgeries" name="surgeries" rows="4" maxlength="4000" placeholder="Geçirdiğin işlemler ve varsa tarihleri…">${value('surgeries')}</textarea></div>
          <div class="profile-field profile-field-wide"><label for="profile-health-notes">Diğer sağlık notları</label><textarea id="profile-health-notes" name="health_notes" rows="4" maxlength="5000" placeholder="Doktor görüşmesinde hatırlamak istediğin diğer bilgiler…">${value('health_notes')}</textarea></div>
        </div><p class="helper">Yazdıkların kendi beyanındır; tıbbi kayıt veya doktor değerlendirmesi yerine geçmez. Bu bilgileri değiştirebilir ya da silebilirsin.</p>
      </section>
      <div class="profile-actions"><span>Değişiklikler yalnızca "Kaydet" dediğinde hesabına işlenir.</span>
        ${p?'<button class="secondary-button" type="button" data-action="profile-cancel">Vazgeç</button>':''}
        <button class="primary-button" type="submit">${p?'Değişiklikleri kaydet':'Profilimi oluştur'} →</button></div>
    </form>`;
}
function selectedDoctorReportHtml():string {
  const date=new Intl.DateTimeFormat('tr-TR',{dateStyle:'long',timeStyle:'short'}).format(new Date());
  const chosenSamples=samples.filter(sample=>reportSelection.has('sample:'+sample.id))
    .slice().sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
  const chosenInjections=normalizeJournal(journal?.payload).injections.filter(item=>reportSelection.has('dose:'+item.id))
    .slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const chosenDocs=documents.filter(doc=>reportSelection.has('doc:'+doc.id))
    .slice().sort((a,b)=>a.document_date.localeCompare(b.document_date));
  const td=(contents:string)=>`<td>${contents}</td>`;
  const table=(headers:string[],rows:string[][])=>`<table class="doctor-table"><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr>${row.map(td).join('')}</tr>`).join('')}</tbody></table>`;
  const section=(heading:string,content:string)=>`<section class="doctor-report-section"><h2>${esc(heading)}</h2>${content}</section>`;
  const profileSection=reportIncludeProfile&&profile?section('Kişisel bilgiler ve sağlık geçmişi',`<div class="doctor-profile-grid">
    ${([['Ad ve soyad',profile.display_name],['Doğum tarihi',profile.birth_date],['Boy',profile.height_cm==null?null:`${number(profile.height_cm)} cm`],
      ['Hastalıklar / tanılar',profile.medical_conditions],['Alerjiler',profile.allergies],['Düzenli ilaçlar',profile.regular_medications],
      ['Ameliyatlar / işlemler',profile.surgeries],['Sağlık notları',profile.health_notes],
      ['Hedef kilo',profile.target_weight_kg==null?null:`${number(profile.target_weight_kg)} kg`],['Hedef notları',profile.goal_notes]] as [string,string|number|null][])
      .map(([label,value])=>`<div><strong>${esc(label)}</strong><p>${value==null||String(value).trim()===''?'Belirtilmedi':esc(value)}</p></div>`).join('')}
    </div>`):'';
  const sampleSection=chosenSamples.length?section('Seçilen ölçümler',table(['Tarih','Ölçüm','Değer'],chosenSamples.map(s=>[
    esc(new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short'}).format(new Date(s.observed_at))),esc(kinds[s.kind]?.name??s.kind),
    esc(`${number(Number(s.value),2)} ${kinds[s.kind]?.short??s.unit}`)]))):'';
  const doseSection=chosenInjections.length?section('Seçilen tedavi uygulamaları',table(['Tarih','İlaç','Doz','Kişisel not'],chosenInjections.map(item=>[
    esc(new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.at))),esc(item.drug),esc(`${number(item.doseMg,2)} mg`),esc(item.note||'—')]))):'';
  const docSection=chosenDocs.length?section('Seçilen sağlık belgeleri',chosenDocs.map(doc=>`<article class="doctor-report-document">
    <h3>${esc(doc.title)}</h3><p><strong>${esc(documentKinds[doc.category]?.label??doc.category)}</strong> · ${dateDisplay(doc.document_date)}
    ${doc.provider_name?' · '+esc(doc.provider_name):''}${doc.doctor_name?' · Doktor: '+esc(doc.doctor_name):''}</p>
    ${doc.notes?`<p class="doctor-report-notes">${esc(doc.notes)}</p>`:''}
    ${doc.file_path?`<p class="doctor-report-attachment">Orijinal ek: ${esc(doc.file_name??'Dosya')} (PDF rapora dahil edilmedi)</p>`:''}</article>`).join('')):'';
  return `<div class="doctor-report-sheet"><header class="doctor-report-heading"><span>✳ welldose</span><p>KİŞİSEL SAĞLIK KAYDI ÖZETİ</p><h1>Doktor Görüşmesi İçin Kayıtlarım</h1>
    <small>Hazırlanma: ${esc(date)}</small></header>
    ${profileSection}${sampleSection}${doseSection}${docSection}
    <footer>Bu belge hasta tarafından seçilen kişisel kayıtlardan oluşturulmuştur. Laboratuvarın veya doktorun imzalı/onaylı raporu değildir.
      Orijinal dosya ekleri bu özete dahil edilmez. Sağlık bilgilerini yalnızca güvendiğin alıcıya gönder.</footer></div>`;
}
function reportPage():string {
  const shots=normalizeJournal(journal?.payload).injections.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const check=(key:string,title:string,detail:string)=>`<label class="report-choice"><input type="checkbox" data-report-choice="${esc(key)}" ${reportSelection.has(key)?'checked':''}/>
    <span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></label>`;
  const count=reportSelection.size+(reportIncludeProfile&&profile?1:0);
  return `<div class="page-title"><div><div class="eyebrow">PAYLAŞIM KONTROLÜ SENDE</div><h1>Doktor raporum.</h1>
    <p>Yalnızca seçtiğin kayıtları yazdırılabilir PDF özeti olarak hazırla.</p></div><span class="tag">İsteğe bağlı paylaşım</span></div>
    <div class="report-selection-grid">
      <section class="panel"><h2>1. Kayıtları seç</h2><p class="helper">Başlangıçta hiçbir kayıt işaretli değildir. Kimlik bilgileri de sadece seçersen eklenir.</p>
        ${profile?`<label class="report-choice report-choice-profile"><input type="checkbox" data-report-profile ${reportIncludeProfile?'checked':''}/>
          <span><strong>Profilim ve sağlık geçmişim</strong><small>Kişisel bilgiler, ilaçlar, notlar ve hedefler</small></span></label>`:''}
        <h3 class="report-group-heading">Ölçümler (${samples.length})</h3><div class="report-choice-list">${samples.length?samples.slice(0,300).map(s=>check('sample:'+s.id,kinds[s.kind]?.name??s.kind,`${dateDisplay(s.observed_at)} · ${number(Number(s.value),2)} ${kinds[s.kind]?.short??s.unit}`)).join(''):'<p class="empty-state">Ölçüm kaydı yok.</p>'}</div>
        <h3 class="report-group-heading">Tedavi uygulamaları (${shots.length})</h3><div class="report-choice-list">${shots.length?shots.slice(0,300).map(s=>check('dose:'+s.id,s.drug,`${dateDisplay(s.at)} · ${number(s.doseMg,2)} mg`)).join(''):'<p class="empty-state">Tedavi kaydı yok.</p>'}</div>
        <h3 class="report-group-heading">Sağlık belgeleri (${documents.length})</h3><div class="report-choice-list">${documents.length?documents.slice(0,300).map(d=>check('doc:'+d.id,d.title,`${documentKinds[d.category]?.label??d.category} · ${dateDisplay(d.document_date)}`)).join(''):'<p class="empty-state">Belge kaydı yok.</p>'}</div>
      </section>
      <section class="panel report-build-panel"><h2>2. PDF raporunu oluştur</h2><span class="report-count" data-report-count>${count} bölüm / kayıt seçildi</span>
        <p class="helper">Rapora seçili ölçüm değerleri, doz kayıtları ve belgelerin açıklamaları eklenir. Yüklediğin orijinal PDF/fotoğrafların kendisi raporun içine gömülmez.</p>
        <button type="button" class="primary-button" data-action="report-print">Yazdır / PDF oluştur →</button>
        <button type="button" class="secondary-button" data-action="report-clear">Seçimi temizle</button>
        <div class="report-privacy"><strong>Gizliliğin sende</strong><p>Rapor tarayıcıda hazırlanır, bir doktora veya sunucuya otomatik gönderilmez. Yazdırma ekranında <strong>PDF olarak kaydet</strong> seçip dosyayı güvenli bir yolla kendin iletebilirsin. PDF şifrelenmiş değildir.</p></div>
      </section>
    </div>
    <div class="report-mobile-cta"><span data-report-mobile-count>${count} seçili bölüm / kayıt</span>
      <button type="button" class="primary-button" data-action="report-print">PDF oluştur →</button></div>`;
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
  const nav=[['overview','Genel Bakış','◫'],['measurements','Ölçümler','◉'],['injections','Tedavi Günlüğü','◷'],['documents','Sağlık Belgelerim','▤'],['report','Doktor Raporu','⎙'],['profile','Profilim','♙'],['settings','Ayarlar','⚙']] as const;
  const mobileLabels:Record<string,string>={overview:'Genel',measurements:'Ölçüm',injections:'Tedavi',documents:'Belgeler'};
  const content=page==='overview'?overview():page==='measurements'?measurements():page==='injections'?injectionsPage():page==='documents'?documentsPage():page==='report'?reportPage():page==='profile'?profilePage():settings();
  app.innerHTML=`<div class="app-shell"><aside class="sidebar">
    <div class="brand"><span class="brand-mark">✳</span><span>well<span class="brand-light">dose</span></span></div>
    <p class="menu-label">MENÜ</p><nav aria-label="Ana menü">${nav.map(([id,label,symbol])=>`<button data-nav="${id}" class="nav-link ${page===id?'active':''}"><span>${symbol}</span>${label}</button>`).join('')}</nav>
    <div class="side-bottom"><span class="avatar">${esc((profile?.display_name||session?.user.email||'K')[0].toUpperCase())}</span><div><strong>${esc(profile?.display_name||'Benim hesabım')}</strong><small>${esc(session?.user.email??'')}</small></div><button data-action="sign-out" aria-label="Çıkış yap" class="logout">⇥</button></div>
  </aside><div class="main-area"><header class="topbar"><div class="mobile-brand">✳ well<span>dose</span></div><div class="topbar-right"><span class="status-dot"></span> Güvenli oturum</div></header>
  <main class="content">${banner()}${content}</main>
  <nav class="mobile-nav" aria-label="Mobil menü">${nav.slice(0,4).map(([id,,symbol])=>`<button type="button" data-nav="${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}><span aria-hidden="true">${symbol}</span><small>${mobileLabels[id]}</small></button>`).join('')}
    <button type="button" data-action="mobile-more-toggle" class="${['report','profile','settings'].includes(page)?'active':''}" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-more-menu"><span aria-hidden="true">☷</span><small>Diğer</small></button></nav>
  ${mobileMenuOpen?`<button type="button" class="mobile-more-scrim" data-action="mobile-more-close" aria-label="Menüyü kapat"></button>
    <section class="mobile-more-panel" id="mobile-more-menu" role="dialog" aria-modal="true" aria-label="Diğer bölümler">
      <div class="mobile-more-heading"><strong>Diğer bölümler</strong><button type="button" data-action="mobile-more-close" aria-label="Menüyü kapat">✕</button></div>
      ${nav.slice(4).map(([id,label,symbol])=>`<button type="button" data-nav="${id}" class="mobile-more-item ${page===id?'active':''}" ${page===id?'aria-current="page"':''}><span aria-hidden="true">${symbol}</span>${label}<span class="mobile-more-chevron" aria-hidden="true">›</span></button>`).join('')}
    </section>`:''}
  </div></div>`;
  if(page==='documents')filterDocumentList();
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
  mobileMenuOpen = false;
  samples = [];
  journal = null;
  documents = [];
  profile = null;
  profileLoadError = '';
  editingProfile = false;
  profileShareConfirm = false;
  documentsLoadError = '';
  editingDocumentId = null;
  documentSearch = '';
  chartKind = 'weight';chartWindowDays = 90;doseChartDrug = '';
  reportSelection = new Set();reportIncludeProfile = false;
  sentReminderNotifications.clear();closeDocumentPreview();
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
    const [c,s,j,d,p]=await Promise.all([
      api.from('user_consents').select('health_storage_accepted_at').eq('user_id',userId).maybeSingle(),
      readAllSamples(userId),
      api.from('journal_records').select('user_id,payload,revision').eq('user_id',userId).maybeSingle(),
      readAllDocuments(userId).then(data=>({data,error:null as string|null})).catch(error=>({data:[] as HealthDocument[],error:error instanceof Error?error.message:'Belge bağlantı hatası'})),
      api.from('user_profiles').select('user_id,display_name,birth_date,height_cm,medical_conditions,allergies,regular_medications,surgeries,health_notes,target_weight_kg,goal_notes')
        .eq('user_id',userId).maybeSingle(),
    ]);
    if (run!==generation) return;
    if (c.error || j.error) throw c.error || j.error;
    consent=Boolean(c.data?.health_storage_accepted_at);
    samples=s;
    journal=j.data ? {...j.data,payload:normalizeJournal(j.data.payload)} : null;
    documents=d.data;
    documentsLoadError=d.error??'';
    profile=p.error?null:(p.data as UserProfile|null);
    profileLoadError=p.error?.message??'';
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
  if(!await saveJournalPayload(payload))return;
  flash='Tedavi kaydın saklandı.';flashError=false;await refreshData();
}
async function saveJournalPayload(payload:JournalPayload):Promise<boolean> {
  if(!session||!consent)return false;
  const userId=session.user.id;
  const now=new Date().toISOString();
  if(!journal) {
    const {error}=await api.from('journal_records').insert({user_id:userId,payload,revision:1,updated_at:now});
    if(error){show('Kaydedilemedi. Başka cihazda yeni kayıt oluşturulmuş olabilir. Sayfayı yenileyip tekrar kontrol et.',true);return false;}
  } else {
    const {data:updated,error}=await api.from('journal_records').update({payload,revision:journal.revision+1,updated_at:now})
      .eq('user_id',userId).eq('revision',journal.revision).select('revision');
    if(error||!updated?.length){show('Başka cihazda değişiklik algılandı. Kayıt üzerine yazılmadı; önce sayfayı yenile.',true);return false;}
  }
  return session?.user.id===userId;
}
async function saveReminder(form:HTMLFormElement) {
  if(!session||!consent)return;
  const fields=new FormData(form),drug=String(fields.get('drug')??'').trim();
  const startAt=String(fields.get('startAt')??''),repeatDays=Number(fields.get('repeatDays'));
  const rawDate=new Date(startAt),matched=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(startAt);
  if(!drug||drug.length>80||!matched||![0,1,7,14,28].includes(repeatDays)||!Number.isFinite(rawDate.getTime())
     ||rawDate.getFullYear()!==Number(matched[1])||rawDate.getMonth()+1!==Number(matched[2])
     ||rawDate.getDate()!==Number(matched[3])||rawDate.getHours()!==Number(matched[4])
     ||rawDate.getMinutes()!==Number(matched[5])||rawDate.getTime()<Date.now()-60000)
    return show('Hatırlatma için geçerli ve gelecekteki bir tarih ile ilaç adı seç.',true);
  const old=normalizeJournal(journal?.payload);
  if(old.reminders.length>=30)return show('Bir hesapta en fazla 30 hatırlatma oluşturabilirsin.',true);
  const reminder:MedicationReminder={id:crypto.randomUUID(),drug,startAt:rawDate.toISOString(),
    repeatDays:repeatDays as MedicationReminder['repeatDays'],enabled:true,note:''};
  if(!await saveJournalPayload({...old,reminders:[...old.reminders,reminder]}))return;
  flash='Hatırlatman kaydedildi. Bu plan uygulanmış bir ilaç dozu değildir.';flashError=false;await refreshData();
}
async function changeReminder(id:string,action:'toggle'|'delete') {
  if(!session||!consent)return;
  const payload=normalizeJournal(journal?.payload),reminder=payload.reminders.find(item=>item.id===id);
  if(!reminder)return show('Hatırlatma bulunamadı.',true);
  if(action==='delete'&&!confirm('“'+reminder.drug+'” hatırlatmasını silmek istiyor musun?'))return;
  const reminders=action==='delete'?payload.reminders.filter(item=>item.id!==id)
    :payload.reminders.map(item=>item.id===id?{...item,enabled:!item.enabled}:item);
  if(!await saveJournalPayload({...payload,reminders}))return;
  flash=action==='delete'?'Hatırlatma silindi.':'Hatırlatma güncellendi.';flashError=false;await refreshData();
}
function vapidBytes(value:string):ArrayBuffer {
  const padded=(value.replace(/-/g,'+').replace(/_/g,'/')+'===').slice(0,value.length+((4-value.length%4)%4));
  const bytes=Uint8Array.from(atob(padded),char=>char.charCodeAt(0));
  const buffer=new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
async function enableNotifications() {
  if(!session||!consent)return;
  if(!PUSH_VAPID_PUBLIC_KEY)return show('Sunucu bildirim anahtarı henüz kurulmadı. Kurulum tamamlandığında etkinleştirilebilir.',true);
  if(!window.isSecureContext||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))
    return show('Bu tarayıcı arka plan bildirimlerini desteklemiyor. iPhone’da WellDose’u Ana Ekrana ekleyip oradan aç.',true);
  if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.matchMedia('(display-mode: standalone)').matches)
    return show('iPhone’da Safari → Paylaş → Ana Ekrana Ekle adımını uygula ve WellDose’u ana ekran simgesinden aç.',true);
  // iOS requires the permission prompt to start from the user's direct tap.
  try {
    const permission=await Notification.requestPermission();
    if(permission!=='granted')return show('Bildirim izni verilmedi. Telefonun bildirim ayarlarından WellDose’a izin vermelisin.',true);
    const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
    const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(PUSH_VAPID_PUBLIC_KEY)});
    const value=subscription.toJSON(),keys=value.keys;
    if(!value.endpoint||!keys?.p256dh||!keys.auth)throw new Error('Cihaz bildirim anahtarı oluşturulamadı.');
    const {error}=await api.from('push_subscriptions').upsert({user_id:session.user.id,endpoint:value.endpoint,
      p256dh:keys.p256dh,auth_secret:keys.auth,expiration_time:value.expirationTime??null,
      updated_at:new Date().toISOString()},{onConflict:'endpoint'});
    if(error)throw error;
    show('Bildirimler bu cihazda açıldı. Test için birkaç dakika sonrasına yeni bir hatırlatma planlayabilirsin.');
  }catch(error){
    show('Bildirim kurulamadı: '+(error instanceof Error?error.message:String(error))+'. Gerekirse uygulamayı ana ekrandan aç.',true);
  }
}
async function disableNotifications() {
  if(!session)return;
  try{
    if(!('serviceWorker' in navigator))return show('Bu cihazda aktif bildirim hizmeti yok.');
    const registration=await navigator.serviceWorker.getRegistration('/');
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription){
      const {error}=await api.from('push_subscriptions').delete().eq('user_id',session.user.id).eq('endpoint',subscription.endpoint);
      if(error)throw error;
      await subscription.unsubscribe();
    }
    show('Bu cihaz için arka plan bildirimleri kapatıldı. Diğer cihazların etkilenmez.');
  }catch(error){show('Bildirim kapatılamadı: '+(error instanceof Error?error.message:String(error)),true);}
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
function closeDocumentPreview() {
  document.querySelector('[data-document-preview]')?.remove();
  if(documentPreviewUrl)URL.revokeObjectURL(documentPreviewUrl);
  documentPreviewUrl=null;
}
async function previewDocument(id:string) {
  if(!session)return;
  const userId=session.user.id,target=documents.find(doc=>doc.id===id && doc.user_id===userId);
  if(!target?.file_path)return show('Önizlenecek bir dosya bulunamadı.',true);
  const {data,error}=await api.storage.from(DOCUMENTS_BUCKET).download(target.file_path);
  if(session?.user.id!==userId)return;
  if(error||!data)return show('Önizleme açılamadı: '+(error?.message??'Dosyaya erişilemiyor.'),true);
  closeDocumentPreview();
  const kind=target.file_mime||data.type;
  if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(kind))return show('Bu dosya türü tarayıcıda önizlenemiyor; indirerek açabilirsin.',true);
  documentPreviewUrl=URL.createObjectURL(new Blob([data],{type:kind}));
  const shade=document.createElement('div');shade.className='document-preview-backdrop';shade.setAttribute('data-document-preview','');
  shade.setAttribute('role','dialog');shade.setAttribute('aria-modal','true');shade.setAttribute('aria-label','Sağlık belgesi önizleme');
  shade.innerHTML=`<div class="document-preview-dialog"><header><div><strong>${esc(target.title)}</strong><small>${dateDisplay(target.document_date)} · Bu dosya yalnızca bu oturumda açılır.</small></div>
    <button class="secondary-button" type="button" data-action="preview-close">Kapat ✕</button></header><div class="document-preview-stage"></div></div>`;
  const stage=shade.querySelector('.document-preview-stage')!;
  if(kind==='application/pdf'){
    const frame=document.createElement('iframe');frame.title=target.title;frame.setAttribute('sandbox','allow-downloads');frame.src=documentPreviewUrl;stage.appendChild(frame);
  }else{
    const img=document.createElement('img');img.alt=target.title;img.src=documentPreviewUrl;stage.appendChild(img);
  }
  shade.addEventListener('click',event=>{if(event.target===shade)closeDocumentPreview();});
  document.body.appendChild(shade);
  shade.querySelector<HTMLButtonElement>('[data-action="preview-close"]')?.focus();
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
async function saveProfile(form: HTMLFormElement) {
  if (!session || !consent) return show('Profilini kaydetmek için güvenli oturum açmalısın.',true);
  if (profileLoadError) return show('Profil önce yeniden yüklenmeli. Değişiklikler kaydedilmedi.',true);
  const fields=new FormData(form);
  const textField=(key: string,max: number): string|null => {
    const value=String(fields.get(key)??'').trim();
    if(value.length>max)throw new Error(`${key} alanı izin verilen uzunluğu aşıyor.`);
    return value||null;
  };
  const birthDate=String(fields.get('birth_date')??'').trim();
  if(birthDate && (!validPastOrPresentDate(birthDate)||birthDate<'1900-01-01'))
    return show('Doğum tarihi gelecekte olamaz. Geçerli bir geçmiş tarih seç.',true);
  const numericField=(key:string,min:number,max:number):number|null=>{
    const raw=String(fields.get(key)??'').trim();
    if(!raw)return null;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${key} için ${min}-${max} arası bir değer gir.`);
    return Math.round(value*10)/10;
  };
  const userId=session.user.id;
  const changes={
    user_id:userId,
    display_name:textField('display_name',80),
    birth_date:birthDate||null,
    height_cm:numericField('height_cm',40,260),
    medical_conditions:textField('medical_conditions',4000),
    allergies:textField('allergies',2000),
    regular_medications:textField('regular_medications',4000),
    surgeries:textField('surgeries',4000),
    health_notes:textField('health_notes',5000),
    target_weight_kg:numericField('target_weight_kg',20,650),
    goal_notes:textField('goal_notes',2000),
    updated_at:new Date().toISOString(),
  };
  const {data,error}=await api.from('user_profiles').upsert(changes,{onConflict:'user_id'})
    .select('user_id,display_name,birth_date,height_cm,medical_conditions,allergies,regular_medications,surgeries,health_notes,target_weight_kg,goal_notes').single();
  if(session?.user.id!==userId)return;
  if(error)return show('Profil kaydedilemedi: '+error.message,true);
  profile=data as UserProfile;
  editingProfile=false;
  profileShareConfirm=false;
  flash='Profilin ve kişisel hedeflerin güvenle kaydedildi.';flashError=false;render();
}
function profileTextReport():string {
  if(!profile)return '';
  const p=profile;
  const row=(label:string,value:unknown)=>`${label}: ${value==null||String(value).trim()===''?'Belirtilmedi':String(value)}`;
  return [
    'WELLDOSE — KİŞİSEL PROFİL VE HEDEFLER',
    'Kullanıcının kendi beyanıdır; resmi tıbbi rapor değildir.',
    '', 'KİŞİSEL BİLGİLER',
    row('Ad ve soyad',p.display_name),row('Doğum tarihi',p.birth_date),
    row('Boy',p.height_cm==null?null:`${number(Number(p.height_cm))} cm`),
    '', 'HEDEFLERİM',
    row('Hedef kilo',p.target_weight_kg==null?null:`${number(Number(p.target_weight_kg))} kg`),
    row('Hedef / motivasyon notu',p.goal_notes),
    '', 'SAĞLIK GEÇMİŞİM',
    row('Hastalıklar / tanılar',p.medical_conditions),row('Bilinen alerjiler',p.allergies),
    row('Düzenli ilaçlar',p.regular_medications),row('Ameliyatlar / işlemler',p.surgeries),
    row('Diğer sağlık notları',p.health_notes),
  ].join('\n');
}
function downloadProfile() {
  if(!session||!profile)return show('İndirilecek kayıtlı profil bulunamadı.',true);
  const data={type:'welldose-user-profile',exportedAt:new Date().toISOString(),userEmail:session.user.email,profile};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='welldose-profilim.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function shareProfile() {
  if(!profile || !session || !profileShareConfirm)return;
  if(typeof navigator.share!=='function')return show('Bu tarayıcıda paylaşım menüsü yok. İndir (JSON) veya Yazdır / PDF ile dosyanı oluşturup kendin gönderebilirsin.',true);
  try {
    // The share sheet is opened only by this second explicit user click.
    await navigator.share({title:'WellDose — Kişisel Sağlık Profilim',text:profileTextReport()});
    if(session) {profileShareConfirm=false;render();}
  } catch(error) {
    // User dismissing the native share sheet is not an application error.
    if((error as {name?:string})?.name!=='AbortError')show('Paylaşım menüsü açılamadı. Dosyayı indirerek kendin paylaşabilirsin.',true);
  }
}
async function deleteProfile() {
  if(!session||!profile)return;
  const answer=prompt('Yalnızca Profilim ve Hedeflerim bilgilerinin tamamı silinecek. Ölçümler ve sağlık belgeleri kalacak. Onaylamak için PROFİL SİL yaz:');
  if(answer!=='PROFİL SİL')return;
  const userId=session.user.id;
  const {data,error}=await api.from('user_profiles').delete().eq('user_id',userId).select('user_id');
  if(session?.user.id!==userId)return;
  if(error)return show('Profil silinemedi: '+error.message,true);
  if(!data?.length)return show('Profil kaydı silinemedi. Sayfayı yenileyip yeniden dene.',true);
  profile=null;editingProfile=false;profileShareConfirm=false;
  flash='Profilin silindi. Ölçümlerin, tedavi günlüğün ve belgelerin korundu.';flashError=false;render();
}
function printDoctorReport() {
  if(!session||!consent)return;
  const availableIds=new Set([
    ...samples.map(sample=>'sample:'+sample.id),
    ...normalizeJournal(journal?.payload).injections.map(item=>'dose:'+item.id),
    ...documents.map(doc=>'doc:'+doc.id),
  ]);
  const selected=[...reportSelection].filter(key=>availableIds.has(key)).length+(reportIncludeProfile&&profile?1:0);
  if(!selected)return show('PDF hazırlamak için en az bir kayıt veya profil bölümünü işaretle.',true);
  document.querySelector('.doctor-print-root')?.remove();
  const report=document.createElement('div');report.className='doctor-print-root';
  report.innerHTML=selectedDoctorReportHtml();
  document.body.appendChild(report);document.body.classList.add('report-printing');
  const cleanup=()=>{report.remove();document.body.classList.remove('report-printing');};
  window.addEventListener('afterprint',cleanup,{once:true});
  try{window.print();}catch(error){cleanup();show('Yazdırma ekranı açılamadı. Tarayıcının yazdırma iznini kontrol et.',true);}
}
function updateReportCount() {
  const label=app.querySelector<HTMLElement>('[data-report-count]');
  const count=reportSelection.size+(reportIncludeProfile&&profile?1:0);
  if(label)label.textContent=`${count} bölüm / kayıt seçildi`;
  const mobileLabel=app.querySelector<HTMLElement>('[data-report-mobile-count]');
  if(mobileLabel)mobileLabel.textContent=`${count} seçili bölüm / kayıt`;
}
async function exportData() {
  if(!session)return;
  const data={exportedAt:new Date().toISOString(),userEmail:session.user.email,health_samples:samples,
    journal:journal?.payload??{injections:[],reminders:[]},health_documents:documents,user_profile:profile,
    note:'PDF ve fotoğraflar bu JSON dosyasına dahil değildir; ayrıca indirilmelidir.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='welldose-kisisel-yedek.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function eraseData() {
  if(!session||prompt('Ölçümlerini, profil bilgilerini, tedavi günlüğünü ve sağlık belgelerini geri dönüşsüz silmek için SİL yaz:')!=='SİL')return;
  const id=session.user.id;
  const filePaths=documents.filter(item=>item.file_path).map(item=>item.file_path!);
  const [s,j,d,p]=await Promise.all([api.from('health_samples').delete().eq('user_id',id),
    api.from('journal_records').delete().eq('user_id',id),api.from('health_documents').delete().eq('user_id',id),
    api.from('user_profiles').delete().eq('user_id',id)]);
  if(s.error||j.error||d.error||p.error)return show('Kısmi silme hatası. Verileri yeniden yükleyip kontrol et: '+(s.error?.message??j.error?.message??d.error?.message??p.error?.message),true);
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
  if (input.type==='datetime-local') {
    if(input.id==='reminder-start'){input.min=localDateTime();input.removeAttribute('max');}
    else input.max=localDateTime();
  }
  if (input.type==='date') input.max=localDateTime().slice(0,10);
  if(['observed','at','document-date','profile-birth'].includes(input.id)) input.dataset.lastValid=input.value;
});
document.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;
  const kind=form.dataset.form;
  if(!kind)return;
  event.preventDefault();
  const submit=form.querySelector<HTMLButtonElement>('[type=submit]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const action=kind==='email'?sendLink(form):kind==='otp'?verifyCode(form):kind==='measurement'?saveMeasurement(form):kind==='injection'?saveInjection(form):kind==='reminder'?saveReminder(form):kind==='health-document'?saveDocument(form):kind==='profile'?saveProfile(form):Promise.resolve();
  void action.catch(err=>show('İşlem tamamlanamadı: '+String(err),true)).finally(()=>{if(submit?.isConnected)submit.disabled=false;});
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(input instanceof HTMLInputElement && input.matches('[data-document-search]')){
    documentSearch=input.value;filterDocumentList();
  }
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input instanceof HTMLInputElement && ['observed','at','document-date','profile-birth'].includes(input.id)){
    const isDateOnly=input.type==='date';
    const valid=!input.value||(isDateOnly?validPastOrPresentDate(input.value):validPastOrPresentDateTime(input.value));
    if(!valid){
      const previous=input.dataset.lastValid??'';
      input.value=previous && (isDateOnly?validPastOrPresentDate(previous):validPastOrPresentDateTime(previous))?previous:'';
      show('Gelecek tarih veya saat seçilemez. Yalnızca bugün ya da geçmiş bir tarih kullanabilirsin.',true);
    }else input.dataset.lastValid=input.value;
    return;
  }
  if(input instanceof HTMLInputElement && input.dataset.reportChoice){
    if(input.checked)reportSelection.add(input.dataset.reportChoice);
    else reportSelection.delete(input.dataset.reportChoice);
    updateReportCount();
  }
  if(input instanceof HTMLInputElement && input.hasAttribute('data-report-profile')){
    reportIncludeProfile=input.checked;updateReportCount();
  }
  if(input instanceof HTMLSelectElement && input.hasAttribute('data-chart-drug')){
    doseChartDrug=input.value;render();
  }
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(documentPreviewUrl)closeDocumentPreview();
  else if(mobileMenuOpen){mobileMenuOpen=false;render();app.querySelector<HTMLButtonElement>('[data-action="mobile-more-toggle"]')?.focus();}
});
document.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-nav],button[data-action],button[data-doc-filter],button[data-doc-action],button[data-reminder-action],button[data-chart-kind],button[data-chart-days]');
  if(!button||button.disabled)return;
  if(button.dataset.chartKind){
    if(button.dataset.chartKind in kinds){chartKind=button.dataset.chartKind as Kind;flash='';render();}return;
  }
  if(button.dataset.chartDays!==undefined){
    const days=Number(button.dataset.chartDays);
    if([0,30,90,365].includes(days)){chartWindowDays=days as typeof chartWindowDays;flash='';render();}return;
  }
  if(button.dataset.reminderAction && button.dataset.reminderId){
    if(button.dataset.reminderAction==='toggle'||button.dataset.reminderAction==='delete')
      void changeReminder(button.dataset.reminderId,button.dataset.reminderAction);
    return;
  }
  if (button.dataset.docFilter) {
    const chosen=button.dataset.docFilter;
    if (chosen==='all'||Object.prototype.hasOwnProperty.call(documentKinds,chosen)) {
      documentFilter=chosen as DocumentCategory|'all';editingDocumentId=null;flash='';render();
    }
    return;
  }
  if (button.dataset.docAction && button.dataset.docId) {
    if(button.dataset.docAction==='download')void downloadDocument(button.dataset.docId);
    if(button.dataset.docAction==='preview')void previewDocument(button.dataset.docId);
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
  if(button.dataset.nav){page=button.dataset.nav as Page;mobileMenuOpen=false;profileShareConfirm=false;flash='';render();return;}
  const action=button.dataset.action;
  if(action==='mobile-more-toggle'){mobileMenuOpen=!mobileMenuOpen;render();if(mobileMenuOpen)app.querySelector<HTMLButtonElement>('[data-action="mobile-more-close"]')?.focus();return;}
  if(action==='mobile-more-close'){mobileMenuOpen=false;render();app.querySelector<HTMLButtonElement>('[data-action="mobile-more-toggle"]')?.focus();return;}
  if(action==='apple'||action==='google')void oauth(action);
  if(action==='resend-otp')void resendCode();
  if(action==='change-email'){pendingEmail='';flash='';flashError=false;render();}
  if(action==='cancel-doc-edit'){editingDocumentId=null;flash='';render();}
  if(action==='preview-close')closeDocumentPreview();
  if(action==='report-print')printDoctorReport();
  if(action==='report-clear'){reportSelection.clear();reportIncludeProfile=false;flash='';render();}
  if(action==='enable-notifications')void enableNotifications();
  if(action==='disable-notifications')void disableNotifications();
  if(action==='profile-edit'){editingProfile=true;profileShareConfirm=false;flash='';render();app.querySelector<HTMLInputElement>('#profile-name')?.focus();}
  if(action==='profile-cancel'){editingProfile=false;profileShareConfirm=false;flash='';render();}
  if(action==='profile-print' && profile){profileShareConfirm=false;render();window.print();}
  if(action==='profile-share'){profileShareConfirm=true;flash='';render();}
  if(action==='profile-share-cancel'){profileShareConfirm=false;render();}
  if(action==='profile-share-now')void shareProfile();
  if(action==='profile-download')downloadProfile();
  if(action==='profile-delete')void deleteProfile();
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

// Foreground-only, generic notifications. No background push or medication
// information is sent to third parties or exposed on the lock screen.
window.setInterval(()=>{
  if(!session||!consent||document.visibilityState!=='visible'||typeof Notification==='undefined'||Notification.permission!=='granted')return;
  const now=Date.now();
  for(const reminder of normalizeJournal(journal?.payload).reminders.filter(item=>item.enabled)){
    const start=Date.parse(reminder.startAt),every=reminder.repeatDays*86400000;
    if(start>now)continue;
    const occurrence=every?start+Math.floor((now-start)/every)*every:start;
    if(now-occurrence>60000)continue;
    const key=reminder.id+':'+occurrence;
    if(sentReminderNotifications.has(key))continue;
    sentReminderNotifications.add(key);
    try{new Notification('WellDose hatırlatması',{body:'Planladığın bir hatırlatmanın zamanı geldi. WellDose’u kontrol et.',tag:'welldose-'+reminder.id});}
    catch{/* Some mobile browsers support permission but not page notifications. */}
  }
},30000);
