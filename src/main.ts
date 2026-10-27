import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APPLE_LOGIN_READY, GOOGLE_LOGIN_READY } from './config';
import './styles.css';

type Kind = 'weight' | 'bmi' | 'body_fat_percent' | 'lean_body_mass';
type Page = 'overview' | 'measurements' | 'injections' | 'settings';
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
let session: Session | null = null;
let page: Page = 'overview';
let loading = true;
let consent = false;
let samples: HealthSample[] = [];
let journal: JournalRecord | null = null;
let flash = '';
let flashError = false;
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
        <form data-form="email" class="form-stack">
          <label for="email">E-posta adresin</label>
          <input id="email" type="email" name="email" autocomplete="email" placeholder="ad@ornek.com" required />
          <button class="primary-button" type="submit">Giriş bağlantısı gönder <span aria-hidden="true">→</span></button>
        </form>
        <p class="fine">Şifre gerektirmeyen tek kullanımlık bağlantı e-postana gönderilir. Bağlantı yalnızca WellDose hesabına erişmek içindir.</p>
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
    <p>WellDose; girdiğin kilo, vücut ölçümü ve tedavi günlüğü kayıtlarını hesabınla ilişkilendirip cihazlar arasında saklar.</p>
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
    <label for="observed">Ölçüm tarihi</label><input id="observed" name="observed" type="datetime-local" required value="${localDateTime()}" />
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
      <label for="at">Uygulama tarihi ve saati</label><input id="at" name="at" type="datetime-local" required value="${localDateTime()}" />
      <label for="note">Not (isteğe bağlı)</label><textarea name="note" id="note" rows="3" maxlength="400" placeholder="Nasıl hissettiğin…"></textarea>
      <button class="primary-button" type="submit">Kaydı güvenle sakla →</button>
      <p class="helper">WellDose doz değişikliği ya da tıbbi karar önermez.</p></form></section>
      <section class="panel"><div class="panel-top"><h2>Uygulama geçmişi</h2><span class="tag">${items.length} kayıt</span></div>
      <div class="record-list">${items.length?items.map(item=>`<div class="record-row"><div class="record-dot dose-dot"></div><div class="record-info"><b>${esc(item.drug)}</b><small>${dateDisplay(item.at)}${item.note?' · '+esc(item.note):''}</small></div><strong>${number(item.doseMg,2)} mg</strong></div>`).join(''):'<p class="empty-state">Henüz enjeksiyon kaydı yok.</p>'}</div></section></div>`;
}
function settings() {
  return `<div class="page-title"><div><div class="eyebrow">HESAP VE BAĞLANTILAR</div><h1>Kontrol sende.</h1><p>Verilerin, cihazların ve güvenlik seçeneklerin.</p></div></div>
  <div class="settings-grid"><section class="panel"><h2>Hesabım</h2><p class="setting-label">Giriş yaptığın e-posta</p><p class="setting-value">${esc(session?.user.email??'')}</p>
  <button data-action="export" class="secondary-button">↓ Tüm kayıtlarımı indir (JSON)</button>
  <button data-action="sign-out-all" class="secondary-button">Tüm cihazlardan çıkış yap</button>
  <button data-action="erase-data" class="danger-button">Sağlık kayıtlarımı kalıcı sil</button>
  <p class="fine">Hesabın bütünüyle silinmesi için ayrıca destek süreci oluşturulacak.</p></section>
  <section class="panel connection-panel"><div class="eyebrow">AKILLI BAĞLANTILAR</div><h2>Apple Sağlık & Zepp Life</h2>
  <div class="connection-line"><span class="connection-icon">⚖</span><div><b>Mi Body Composition Scale 2</b><small>Zepp Life → Apple Sağlık</small></div><span class="pending">Henüz bağlı değil</span></div>
  <div class="connection-line"><span class="connection-icon">♥</span><div><b>Apple Sağlık ve Apple Watch</b><small>HealthKit ile izinli veri aktarımı</small></div><span class="pending">iPhone gerekli</span></div>
  <p class="helper">WellDose web sürümü iPhone Sağlık verilerini kendiliğinden okuyamaz. Bunun için ayrıca hazırlanacak iOS uygulamasına izin vermelisin. Tartı verilerinin aktarımı da Zepp Life ayarlarına bağlıdır.</p></section></div>`;
}
function appScreen() {
  const nav=[['overview','Genel Bakış','◫'],['measurements','Ölçümler','◉'],['injections','Tedavi Günlüğü','◷'],['settings','Ayarlar','⚙']] as const;
  const content=page==='overview'?overview():page==='measurements'?measurements():page==='injections'?injectionsPage():settings();
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
async function refreshData() {
  if (!session) return;
  const run=++generation;
  // Clear user-specific state before any asynchronous request. This also
  // prevents a failed load after switching accounts from exposing old data.
  clearPrivateData();
  loading=true;render();
  const userId=session.user.id;
  try {
    const [c,s,j]=await Promise.all([
      api.from('user_consents').select('health_storage_accepted_at').eq('user_id',userId).maybeSingle(),
      readAllSamples(userId),
      api.from('journal_records').select('user_id,payload,revision').eq('user_id',userId).maybeSingle(),
    ]);
    if (run!==generation) return;
    if (c.error || j.error) throw c.error || j.error;
    consent=Boolean(c.data?.health_storage_accepted_at);
    samples=s;
    journal=j.data ? {...j.data,payload:normalizeJournal(j.data.payload)} : null;
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
  show(error?'Giriş bağlantısı gönderilemedi: '+error.message:'Giriş bağlantısı gönderildiyse lütfen e-postanı kontrol et.',Boolean(error));
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
  if(!kinds[kind]||!Number.isFinite(value)||value<=0||value>650||!rawDate||!Number.isFinite(Date.parse(rawDate)))return show('Ölçüm bilgilerini kontrol et.',true);
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
  if(!drug||drug.length>80||!Number.isFinite(doseMg)||doseMg<=0||doseMg>100||!Number.isFinite(Date.parse(rawDate))||note.length>400)return show('Tedavi kaydındaki değerleri kontrol et.',true);
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
async function exportData() {
  if(!session)return;
  const data={exportedAt:new Date().toISOString(),userEmail:session.user.email,health_samples:samples,journal:journal?.payload??{injections:[]}};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='welldose-kisisel-yedek.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function eraseData() {
  if(!session||prompt('Ölçümlerini ve tedavi günlüğünü geri dönüşsüz silmek için SİL yaz:')!=='SİL')return;
  const id=session.user.id;
  const [s,j]=await Promise.all([api.from('health_samples').delete().eq('user_id',id),api.from('journal_records').delete().eq('user_id',id)]);
  if(s.error||j.error)return show('Kısmi silme hatası. Verileri yeniden yükleyip kontrol et: '+(s.error?.message??j.error?.message),true);
  flash='Sağlık kayıtların silindi. Hesabın açık kalıyor.';flashError=false;await refreshData();
}
async function signOut(global=false) {
  const {error}=await api.auth.signOut({scope:global?'global':'local'});
  if(error)return show('Çıkış yapılamadı: '+error.message,true);
  session=null;clearPrivateData();flash='';render();
}

document.addEventListener('submit',event=>{
  const form=event.target as HTMLFormElement;
  const kind=form.dataset.form;
  if(!kind)return;
  event.preventDefault();
  const submit=form.querySelector<HTMLButtonElement>('[type=submit]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const action=kind==='email'?sendLink(form):kind==='measurement'?saveMeasurement(form):saveInjection(form);
  void action.catch(err=>show('İşlem tamamlanamadı: '+String(err),true)).finally(()=>{if(submit?.isConnected)submit.disabled=false;});
});
document.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-nav],button[data-action]');
  if(!button||button.disabled)return;
  if(button.dataset.nav){page=button.dataset.nav as Page;flash='';render();return;}
  const action=button.dataset.action;
  if(action==='apple'||action==='google')void oauth(action);
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
