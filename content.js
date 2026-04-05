// content.js - Smart Autofill Content Script
'use strict';

const FIELD_KEYWORDS = {
  firstName: ['first name','firstname','given name','fname','first_name','forename','first nm'],
  lastName: ['last name','lastname','surname','lname','last_name','family name','last nm'],
  fullName: ['full name','fullname','full_name','legal name','applicant name','candidate name','your name'],
  email: ['email address','email addr','e-mail address','e_mail','email','e-mail','confirm email','verify email'],
  phone: ['phone number','telephone number','mobile number','cell number','contact number','phone','telephone','mobile','cell'],
  street: ['street address','address line 1','address line1','address1','mailing address','street','addr1'],
  city: ['city','town','municipality','city/town'],
  state: ['state/province','state / province','province/state','state or province','state','province','region'],
  zip: ['zip code','postal code','post code','zip/postal','postcode','zip','postal'],
  country: ['country of residence','country name','country','nation'],
  linkedin: ['linkedin url','linkedin profile','linked in url','linkedin link','linkedin','linked-in','linked in'],
  github: ['github url','github profile','github link','git hub url','github','git hub'],
  website: ['personal website','personal site','portfolio url','portfolio link','personal url','website url','portfolio website','portfolio','website'],
  university: ['university name','school name','college name','institution name','alma mater','university','school','college','institution'],
  degree: ['degree type','degree level','highest degree','education level','qualification','degree'],
  major: ['field of study','area of study','area of concentration','major field','concentration','discipline','subject','major'],
  graduationDate: ['graduation date','grad date','expected graduation','graduation year','date of graduation','graduated','graduation'],
  gpa: ['grade point average','grade point','cumulative gpa','gpa'],
  currentJobTitle: ['current job title','current position','current role','current title','present job title','job title','title'],
  targetJobTitle: ['desired job title','desired position','desired role','target job title','position of interest','applying for position','position applying for'],
  yearsExperience: ['years of experience','years of relevant experience','total years experience','years experience','total experience','experience years','how many years of experience'],
  authorizedToWork: ['authorized to work in the united states','legally authorized to work','authorized to work in the us','work authorization','work eligibility','authorized to work','eligible to work','legally eligible'],
  requireSponsorship: ['require visa sponsorship','require sponsorship','need visa sponsorship','need sponsorship','will you require sponsorship','visa sponsorship required','sponsorship required','sponsorship','visa'],
  salaryExpectation: ['desired salary','expected salary','salary expectation','salary requirement','pay expectation','desired compensation','compensation expectation','salary','compensation','pay'],
  availability: ['earliest start date','available start date','when can you start','start date availability','availability date','start date','availability','available'],
  pronouns: ['preferred pronouns','gender pronouns','pronouns'],
  bio: ['tell us about yourself','tell us more about yourself','describe yourself','about yourself','cover letter','personal statement','professional summary','executive summary','about me','bio','summary','about'],
};

const AUTOCOMPLETE_MAP = {
  'given-name':'firstName','additional-name':'firstName','family-name':'lastName','name':'fullName',
  'email':'email','tel':'phone','tel-national':'phone','street-address':'street','address-line1':'street',
  'address-level2':'city','address-level1':'state','postal-code':'zip','country-name':'country',
  'country':'country','url':'website','organization-title':'currentJobTitle','bday':'availability',
};

const SKIP_INPUT_TYPES = new Set(['file','submit','reset','button','image','hidden','color','range']);
const CAPTCHA_CLUES = ['captcha','recaptcha','hcaptcha','i am not a robot','not a robot','human verification','bot detection'];
const MIN_SCORE = 4;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'fill') {
    chrome.storage.local.get(['profile','enabled'], (data) => {
      if (data.enabled === false) { sendResponse({ filled:0, detected:0, disabled:true }); return; }
      sendResponse(fillPage(data.profile || {}));
    });
    return true;
  }
  if (msg.action === 'ping') { sendResponse({ alive:true }); return true; }
});

function fillPage(profile) {
  const fields = collectFields(document);
  let filledCount = 0, detectedCount = 0;
  for (const { element, hints } of fields) {
    const key = detectFieldKey(hints, element);
    if (!key) continue;
    detectedCount++;
    const value = resolveValue(key, profile, element);
    if (value === null || value === undefined || String(value).trim() === '') continue;
    if (fillElement(element, value, key)) filledCount++;
  }
  watchDynamicFields(profile);
  return { filled:filledCount, detected:detectedCount, total:fields.length };
}

function collectFields(root) {
  const results = [], seen = new WeakSet();
  function visit(node) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const tag = node.tagName;
    if (!tag) { if (node.children) for (const c of node.children) visit(c); return; }
    if (node.shadowRoot) visit(node.shadowRoot);
    if (tag === 'IFRAME') { try { const d = node.contentDocument; if (d?.body) visitChildren(d.body); } catch(_e){} }
    if (['INPUT','TEXTAREA','SELECT'].includes(tag) && !seen.has(node)) {
      seen.add(node);
      if (!shouldSkipElement(node)) results.push({ element:node, hints:collectHints(node) });
    }
    visitChildren(node);
  }
  function visitChildren(parent) { if (!parent.children) return; for (const c of parent.children) visit(c); }
  visitChildren(root.body || root);
  return results;
}

function shouldSkipElement(el) {
  const type = (el.type||'text').toLowerCase();
  if (SKIP_INPUT_TYPES.has(type) || el.disabled || el.readOnly) return true;
  if (el.getAttribute('aria-hidden')==='true' || el.closest('[aria-hidden="true"]')) return true;
  const ctx = getQuickHintText(el).toLowerCase();
  if (CAPTCHA_CLUES.some(c => ctx.includes(c))) return true;
  const s = window.getComputedStyle(el);
  return s.display==='none' || s.visibility==='hidden';
}

function collectHints(el) {
  const parts = [], add = v => { if (v && typeof v==='string' && v.trim()) parts.push(v.toLowerCase().trim()); };
  add(el.name); add(el.id); add(el.getAttribute('autocomplete')); add(el.placeholder);
  add(el.getAttribute('aria-label')); add(el.getAttribute('data-field')); add(el.getAttribute('data-name'));
  add(el.getAttribute('data-label')); add(el.getAttribute('data-placeholder')); add(el.title); add(el.className);
  const root = el.getRootNode();
  if (el.id) { try { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) add(l.textContent); } catch(_e){} }
  const lb = el.getAttribute('aria-labelledby');
  if (lb) { try { const l = root.querySelector(`#${CSS.escape(lb)}`); if (l) add(l.textContent); } catch(_e){} }
  const pl = el.closest('label'); if (pl) add(pl.textContent);
  const parent = el.parentElement;
  if (parent) {
    for (const s of parent.children) {
      if (s===el) continue;
      if (['LABEL','SPAN','DIV','P','LEGEND','H1','H2','H3','H4','STRONG','B','EM'].includes(s.tagName)) {
        const t = s.textContent.trim(); if (t.length>0 && t.length<120) add(t);
      }
    }
    const gp = parent.parentElement;
    if (gp) { const l = gp.querySelector(':scope > legend'); if (l) add(l.textContent); const ggp = gp.parentElement; if (ggp) { const l2 = ggp.querySelector(':scope > legend'); if (l2) add(l2.textContent); } }
  }
  return parts.join(' ');
}

function getQuickHintText(el) {
  return [el.name,el.id,el.placeholder,el.getAttribute('aria-label'),el.getAttribute('class')].filter(Boolean).join(' ');
}

function detectFieldKey(hints, el) {
  const ac = (el.getAttribute('autocomplete')||'').toLowerCase().trim();
  if (AUTOCOMPLETE_MAP[ac]) return AUTOCOMPLETE_MAP[ac];
  const h = hints.toLowerCase(); let bestKey=null, bestScore=0;
  for (const [key, keywords] of Object.entries(FIELD_KEYWORDS)) {
    let score = 0; for (const kw of keywords) if (h.includes(kw)) score += kw.length;
    if (score > bestScore) { bestScore=score; bestKey=key; }
  }
  return bestScore >= MIN_SCORE ? bestKey : null;
}

function resolveValue(key, profile, el) {
  const p = profile;
  switch(key) {
    case 'firstName': return p.firstName || (p.fullName ? p.fullName.split(' ')[0] : '');
    case 'lastName': if (p.lastName) return p.lastName; if (p.fullName) { const pts=p.fullName.split(' '); return pts.length>1 ? pts.slice(1).join(' ') : ''; } return '';
    case 'fullName': return p.fullName || [p.firstName,p.lastName].filter(Boolean).join(' ');
    case 'phone': return formatPhone(p.phone||'', el);
    case 'graduationDate': case 'availability': return formatDateField(p[key]||'', el);
    default: return p[key] || '';
  }
}

function fillElement(el, value, key) {
  try {
    const tag=el.tagName, type=(el.type||'text').toLowerCase();
    if (tag==='SELECT') return fillSelect(el, value);
    if (type==='radio') return fillRadio(el, value, key);
    if (type==='checkbox') return fillCheckbox(el, value);
    if (tag==='TEXTAREA' || ['text','email','tel','url','number','search','password',''].includes(type)) return fillText(el, value);
    return false;
  } catch(_e) { return false; }
}

function fillText(el, value) {
  try {
    const proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (ns) ns.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    return true;
  } catch(_e) { return false; }
}

function fillSelect(el, value) {
  if (!value) return false;
  const vl=value.toLowerCase().trim(); let best=null, bestScore=0;
  for (const o of el.options) {
    const ot=o.text.toLowerCase().trim(), ov=o.value.toLowerCase().trim(); let s=0;
    if (ot===vl||ov===vl) s=100; else if (ot.startsWith(vl)||vl.startsWith(ot)) s=60;
    else if (ot.includes(vl)||vl.includes(ot)) s=40; else if (ov.includes(vl)||vl.includes(ov)) s=30;
    if (s>bestScore) { bestScore=s; best=o; }
  }
  if (best && bestScore>0) { el.value=best.value; el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('blur',{bubbles:true})); return true; }
  return false;
}

function fillRadio(el, value, key) {
  const name=el.name; if (!name) return false;
  const vl=String(value).toLowerCase().trim();
  const ctx=el.closest('form')||el.getRootNode();
  let radios; try { radios=ctx.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`); } catch(_e) { return false; }
  let bestRadio=null, bestScore=0;
  const isYes=['yes','true','1','y'].includes(vl), isNo=['no','false','0','n'].includes(vl);
  for (const r of radios) {
    const lt=(getLabelText(r,ctx)||r.value||'').toLowerCase(); let s=0;
    if (lt===vl||r.value.toLowerCase()===vl) s=100; else if (lt.includes(vl)) s=50;
    if (key==='authorizedToWork'||key==='requireSponsorship') {
      if (isYes && ['yes','true','i am','authorized','i will not','eligible'].some(c=>lt.includes(c))) s=Math.max(s,80);
      if (isNo && ['no','false','not authorized','not eligible','i require','i will require','i need'].some(c=>lt.includes(c))) s=Math.max(s,80);
    }
    if (s>bestScore) { bestScore=s; bestRadio=r; }
  }
  if (bestRadio && bestScore>0) { bestRadio.checked=true; bestRadio.dispatchEvent(new Event('change',{bubbles:true})); bestRadio.dispatchEvent(new Event('click',{bubbles:true,cancelable:true})); return true; }
  return false;
}

function fillCheckbox(el, value) {
  const sc=['yes','true','1','y','checked','on'].includes(String(value).toLowerCase().trim());
  if (el.checked!==sc) { el.checked=sc; el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('click',{bubbles:true,cancelable:true})); }
  return true;
}

function getLabelText(el, ctx) {
  if (el.id) { try { const l=ctx.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.textContent.trim(); } catch(_e){} }
  const pl=el.closest('label'); if (pl) return pl.textContent.trim();
  const s=el.nextElementSibling;
  if (s && ['LABEL','SPAN','DIV'].includes(s.tagName)) return s.textContent.trim();
  return el.value||'';
}

function formatPhone(rawPhone, el) {
  if (!rawPhone) return '';
  const digits=rawPhone.replace(/\D/g,''); if (!digits) return rawPhone;
  const d10=digits.slice(-10), ph=(el.placeholder||'').toLowerCase(), ml=el.maxLength;
  if (ph.includes('+1')||(ph.startsWith('+')&&!ph.includes('('))) return `+1${d10}`;
  if (ml===11) return `1${d10}`;
  if (ph.includes('(')||ph.match(/\(\d/)) return `(${d10.slice(0,3)}) ${d10.slice(3,6)}-${d10.slice(6)}`;
  if (ph.includes('.')&&ph.match(/\d\.\d/)) return `${d10.slice(0,3)}.${d10.slice(3,6)}.${d10.slice(6)}`;
  return `${d10.slice(0,3)}-${d10.slice(3,6)}-${d10.slice(6)}`;
}

function formatDateField(rawDate, el) {
  if (!rawDate) return '';
  const ph=(el.placeholder||'').toUpperCase().replace(/\s+/g,''), df=(el.getAttribute('data-format')||'').toUpperCase().replace(/\s+/g,''), c=ph+' '+df;
  let fmt='MM/DD/YYYY';
  if (/YYYY[-\/]MM[-\/]DD/.test(c)) fmt='YYYY-MM-DD';
  else if (/DD[-\/]MM[-\/]YYYY/.test(c)) fmt='DD/MM/YYYY';
  else if (/MMMM|MONTHYYYY|MONTH/.test(c)) fmt='Month YYYY';
  else if (/^\s*YYYY\s*$/.test(c)||/YEAR/.test(c)) fmt='YYYY';
  return convertDate(rawDate, fmt);
}

function convertDate(raw, fmt) {
  if (!raw) return '';
  let year,month,day;
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/), us=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/), yrMo=raw.match(/^(\d{4})-(\d{2})$/), yr=raw.match(/^(\d{4})$/);
  if (iso) [,year,month,day]=iso;
  else if (us) [,month,day,year]=us;
  else if (yrMo) { year=yrMo[1]; month=yrMo[2]; day='01'; }
  else if (yr) { year=yr[1]; month='01'; day='01'; }
  else return raw;
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mm=String(month).padStart(2,'0'), dd=String(day).padStart(2,'0');
  switch(fmt) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${mm}-${dd}`;
    case 'DD/MM/YYYY': return `${dd}/${mm}/${year}`;
    case 'Month YYYY': return `${MONTHS[parseInt(month,10)-1]} ${year}`;
    case 'YYYY': return String(year);
    default: return raw;
  }
}

function watchDynamicFields(profile) {
  let timer=null, cycles=0;
  const obs=new MutationObserver(muts => {
    if (!muts.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(n.tagName==='INPUT'||n.tagName==='TEXTAREA'||n.tagName==='SELECT'||n.querySelector?.('input,textarea,select'))))) return;
    clearTimeout(timer);
    timer=setTimeout(()=>{ fillPage(profile); if(++cycles>=5) obs.disconnect(); },700);
  });
  obs.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>obs.disconnect(),300000);
}
