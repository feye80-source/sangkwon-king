// sidepanel.js

let currentListing = null;
let savedListings = [];
let collectedListings = [];
let filteredListings = []; // 필터 적용된 목록
let activeFilters = {
  tradeType: 'all',
  saleMin: '', saleMax: '',
  monthlyMin: '', monthlyMax: '',
  areaMin: '', areaMax: '',
  pyeongMin: '', pyeongMax: '',
  floorText: '',
  floorLevels: new Set(), // 선택된 층 (비어있으면 전체)
  sortKey: 'default',
  sortDir: 'asc',
  filterOpen: false,
  deletedIds: new Set()
};
// 필터 입력 raw 값 보존 (콤마 포함 표시용)
let filterRawValues = {
  saleMin: '', saleMax: '',
  monthlyMin: '', monthlyMax: '',
  areaMin: '', areaMax: '',
  pyeongMin: '', pyeongMax: ''
};
let calcMode = 'monthly';
let isCollecting = false;
let _areaBandRows = { all: '', excl1F: '' }; // 1층 제외 체크박스용 캐시

document.addEventListener('DOMContentLoaded', () => {
  loadSavedListings();
  initFloorRows();
  listenForMessages();
  attachCommaFormat(MONEY_IDS);
  yiLoad();
  yiInitEvents();
  initAreaDualInputs();

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('.toggle-btn[data-calc-mode]').forEach(btn => btn.addEventListener('click', () => switchCalcMode(btn.dataset.calcMode)));
  // 매매분석은 면적탭으로 이동됨 - c_salePrice가 해당 탭에 있음
  ['c_salePrice','s_excArea','s_taxRate','s_etc'].forEach(id => document.getElementById(id)?.addEventListener('input', calcSale));

  // 대출 상환 입력
  ['l_amount','l_rate','l_years'].forEach(id => document.getElementById(id)?.addEventListener('input', calcLoanSchedule));
  document.getElementById('loanTypeEqual')?.addEventListener('click', () => { setLoanType('equal'); calcLoanSchedule(); });
  document.getElementById('loanTypePrincipal')?.addEventListener('click', () => { setLoanType('principal'); calcLoanSchedule(); });
  document.getElementById('loanTypeInterest')?.addEventListener('click', () => { setLoanType('interest'); calcLoanSchedule(); });

  // 세금 계산 서브탭
  document.querySelectorAll('.sub-tab-btn[data-tax-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn[data-tax-sub]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sub-tax-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      const panel = document.getElementById('tax-' + btn.dataset.taxSub);
      if (panel) panel.style.display = 'block';
    });
  });
  ['tax_acq_price','tax_acq_type'].forEach(id => document.getElementById(id)?.addEventListener('input', calcTaxAcquire));
  ['tax_hold_price','tax_hold_ratio'].forEach(id => document.getElementById(id)?.addEventListener('input', calcTaxHold));
  ['tax_tr_buy','tax_tr_sell','tax_tr_years','tax_tr_deduct'].forEach(id => document.getElementById(id)?.addEventListener('input', calcTaxTransfer));

  document.getElementById('manualScrapeBtn')?.addEventListener('click', manualScrape);
  document.getElementById('addFloorRowBtn')?.addEventListener('click', addFloorRow);
  document.getElementById('analyzeFloorBtn')?.addEventListener('click', analyzeFloor);
  document.getElementById('clearAllMemoBtn')?.addEventListener('click', clearAllMemo);
  document.getElementById('toggleCollectBtn')?.addEventListener('click', toggleCollect);
  document.getElementById('refreshListBtn')?.addEventListener('click', refreshList);
  // 계산기 탭 서브탭 (data-ctab) 이벤트
  document.querySelectorAll('.sub-tab-btn[data-ctab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.tab-panel');
      parent.querySelectorAll('.sub-tab-btn[data-ctab]').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelector('#ctab-' + btn.dataset.ctab)?.classList.add('active');
    });
  });
  document.getElementById('clearListBtn')?.addEventListener('click', clearList);

  // 다운로드 버튼 (탭 하단 배치)
  document.getElementById('downloadMarketBtn')?.addEventListener('click', downloadMarketCSV);
  document.getElementById('marketImgBtn')?.addEventListener('click', () => exportMarketCapture('png'));
  document.getElementById('marketPdfBtn')?.addEventListener('click', () => exportMarketCapture('pdf'));
  document.getElementById('downloadListBtn')?.addEventListener('click', downloadCSV);

  // 시장분석 서브탭 전환
  document.querySelectorAll('.sub-tab-btn[data-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn[data-sub]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sub-' + btn.dataset.sub)?.classList.add('active');
      if (btn.dataset.sub === 'listview') renderListView();
      if (btn.dataset.sub === 'yield') yiRender();
    });
  });

  document.getElementById('listingContent').addEventListener('click', (e) => {
    if (e.target.id === 'saveBtn') saveListing();
    if (e.target.classList.contains('scrape-btn')) manualScrape();
  });
  document.getElementById('memoList').addEventListener('click', (e) => {
    if (e.target.classList.contains('memo-delete')) deleteListing(e.target.dataset.id);
    if (e.target.classList.contains('memo-save-note')) saveNote(e.target.dataset.id, e.target.dataset.idx);
  });

  chrome.storage.local.get(['lastListing', 'lastListData'], (result) => {
    if (result.lastListing) { currentListing = result.lastListing; renderListing(result.lastListing); autoFillCalc(result.lastListing); }
    if (result.lastListData?.length > 0) { collectedListings = result.lastListData; renderMarket(collectedListings); }
  });
});

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LISTING_DATA' && message.data) {
      currentListing = message.data;
      renderListing(message.data);
      autoFillCalc(message.data);
      // 부동산 탭 자동갱신 (서브탭 위치 변경)
    }
    if (message.type === 'DEBUG_DATA') {
      // 디버그 메시지 무시 (프로덕션)
    }
    if (message.type === 'LIST_DATA' && message.listings) {
      collectedListings = message.listings;
      document.getElementById('marketCount').textContent = collectedListings.length;
      document.getElementById('sb_collected').textContent = collectedListings.length + '건';
      // 프로그레스 바 업데이트
      updateProgressBar(collectedListings.length);
      const marketTab = document.getElementById('tab-market');
      if (marketTab?.classList.contains('active')) {
        if (document.getElementById('sub-listview')?.classList.contains('active')) {
          renderListView();
        } else {
          renderMarket(collectedListings);
        }
      }
    }
    if (message.type === 'API_ERROR') {
      // statusDot 빨간색으로 변경
      const dot = document.getElementById('statusDot');
      if (dot) {
        dot.style.background = '#e05252';
        dot.style.boxShadow = '0 0 6px #e05252';
      }
      // 경고 툴팁 표시
      showApiErrorTooltip(message.errorType);
      // 5초 후 statusDot 원복
      setTimeout(() => {
        if (dot) { dot.style.background = ''; dot.style.boxShadow = ''; }
      }, 5000);
    }
  });
}

// ─────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// ─────────────────────────────────────────
// 원 단위 입력 헬퍼
// ─────────────────────────────────────────
// 입력값(원) → 만원 단위 숫자로 변환
function parseWon(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = el.value.replace(/,/g, '').trim();
  const n = parseFloat(raw);
  if (!n || isNaN(n)) return 0;
  return n / 10000; // 원→만원
}

// 콤마 자동 포매팅 (입력 중)
function attachCommaFormat(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function() {
      const pos = this.selectionStart;
      const before = this.value.length;
      const raw = this.value.replace(/[^0-9]/g, '');
      if (!raw) { this.value = ''; return; }
      const formatted = parseInt(raw, 10).toLocaleString('ko-KR');
      this.value = formatted;
      // 커서 위치 보정
      const diff = this.value.length - before;
      this.setSelectionRange(pos + diff, pos + diff);
    });
  });
}

// 계산 탭 금액 필드 (원 단위)
const MONEY_IDS = [
  'c_salePrice','c_deposit','c_monthly','c_loan','c_manage',
  's_etc',
  'l_amount',
  'tax_acq_price','tax_hold_price',
  'tax_tr_buy','tax_tr_sell','tax_tr_deduct',
  'tax_inc_revenue','tax_inc_expense','tax_inc_deduct','tax_inc_other'
];


function avgExcludeMinMax(arr) {
  if (arr.length <= 2) return avg(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return avg(sorted.slice(1, -1));
}

function fmtComma(num) {
  // 입력값은 만원 단위.
  // 예: 90000 → "9억", 93500 → "9억3천5백", 35000 → "3억5천", 500 → "500"
  if (num === null || num === undefined) return '-';
  let n = (typeof num === 'number') ? num : parseFloat(String(num).replace(/,/g, ''));
  if (!Number.isFinite(n)) return '-';

  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  if (abs >= 10000) {
    const eok = Math.floor(abs / 10000);
    const restMan = Math.round(abs % 10000); // 나머지 만원
    let restStr = '';
    if (restMan > 0) {
      const cheon = Math.floor(restMan / 1000);
      const baek  = Math.round(restMan % 1000);
      if (cheon > 0 && baek > 0) restStr = cheon + '천' + baek;
      else if (cheon > 0)        restStr = cheon + '천';
      else                       restStr = baek + '';
    }
    return sign + eok.toLocaleString() + '억' + restStr;
  }
  // 만원 단위 (억 미만): 천 단위 콤마
  return sign + Math.round(abs).toLocaleString();
}

// fmtComma + '만' — 억 단위면 '만' 생략, 만원 단위면 '만' 붙임
function fmtMan(num) {
  if (num === null || num === undefined) return '-';
  const s = fmtComma(num);
  if (s === '-') return '-';
  return s.includes('억') ? s : s + '만';
}

function fmtComma1(num) {
  // 소수점 1자리까지 표시 (임대 평당가용)
  if (num === null || num === undefined) return '-';
  let n = (typeof num === 'number') ? num : parseFloat(String(num).replace(/,/g, ''));
  if (!Number.isFinite(n)) return '-';
  return (Math.round(n * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function getExclusivePyeong(l) {
  if (l.area?.exclusivePyeong > 0) return l.area.exclusivePyeong;
  if (l.area?.contractPyeong > 0) return l.area.contractPyeong; // fallback
  return 0;
}

function makeUrl(l) {
  if (l.url && l.url.startsWith('http')) return l.url;
  if (l.id && !String(l.id).startsWith('anon_')) return 'https://new.land.naver.com/offices?articleNo=' + l.id;
  return null;
}

function formatPriceDisplay(data) { return data.priceRaw || '-'; }
function parsePriceNum(raw) {
  if (!raw) return 0;
  let t = 0;
  const eok = raw.match(/(\d+)억/), man = raw.match(/억\s*([\d,]+)/);
  if (eok) t += parseInt(eok[1]) * 10000;
  if (man) t += parseInt(man[1].replace(/,/g, ''));
  if (!eok) { const jn = raw.match(/^[\d,]+$/); if (jn) t = parseInt(raw.replace(/,/g, '')); }
  return t;
}

function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

// ─────────────────────────────────────────
// 탭
// ─────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName)?.classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tabName}"]`)?.classList.add('active');
  // 탭 진입 시 첫 번째 서브탭 패널이 확실히 보이도록 강제 초기화
  const panel = document.getElementById('tab-' + tabName);
  if (panel) {
    const firstSubBtn = panel.querySelector('.sub-tab-btn');
    if (firstSubBtn) {
      panel.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
      firstSubBtn.classList.add('active');
      const key = firstSubBtn.dataset.ytab || firstSubBtn.dataset.ctab || firstSubBtn.dataset.atab || firstSubBtn.dataset.stab || firstSubBtn.dataset.taxSub || firstSubBtn.dataset.sub || firstSubBtn.dataset.atab2;
      const prefix = firstSubBtn.dataset.ytab ? 'ytab-' : firstSubBtn.dataset.ctab ? 'ctab-' : firstSubBtn.dataset.atab ? 'atab-' : firstSubBtn.dataset.stab ? 'stab-' : firstSubBtn.dataset.taxSub ? 'tax-' : firstSubBtn.dataset.sub ? 'sub-' : 'atab2-';
      panel.querySelector('#' + prefix + key)?.classList.add('active');
    }
  }
}
function switchCalcMode(mode) {
  // 하위 호환성 유지 (레거시 참조용, 실제 UI는 stab 방식 사용)
}

// ─────────────────────────────────────────
// 수집 토글
// ─────────────────────────────────────────
function toggleCollect() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.[0]) return;
    if (!isCollecting) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_COLLECT' }, (res) => {
        if (chrome.runtime.lastError) { showToast('페이지를 새로고침해주세요'); return; }
        isCollecting = true;
        _progressTotal = 0;
        // 프로그레스 바 초기화
        const bar = document.getElementById('collectProgressBar');
        const lbl = document.getElementById('collectProgressLabel');
        const pct = document.getElementById('collectProgressPct');
        if (bar)  bar.style.width = '0%';
        if (lbl)  lbl.textContent = '수집 중...';
        if (pct)  pct.textContent = '0%';
        updateCollectBtn();
        showToast('수집 시작!');
      });
    } else {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_COLLECT' }, () => {});
      isCollecting = false; updateCollectBtn(); showToast('수집 중지');
    }
  });
}
function updateCollectBtn() {
  const btn = document.getElementById('toggleCollectBtn');
  if (!btn) return;
  if (isCollecting) {
    btn.textContent = '⏹ 수집 중지';
    btn.classList.add('collecting');
    // 프로그레스 바 표시
    const wrap = document.getElementById('collectProgressWrap');
    if (wrap) wrap.style.display = 'block';
  } else {
    btn.textContent = '▶ 수집 시작';
    btn.classList.remove('collecting');
    // 수집 완료 애니메이션 → 프로그레스 바 숨기기
    finishProgressBar();
  }
}

// ─────────────────────────────────────────
// 작업 2: API 에러 툴팁
// ─────────────────────────────────────────
function showApiErrorTooltip(errorType) {
  // 기존 툴팁 제거
  document.getElementById('apiErrorTooltip')?.remove();
  const msg = errorType === 'AUTH_REQUIRED'
    ? '⚠️ 네이버 부동산 로그인이 필요하거나 일시적인 오류입니다'
    : '⚠️ 네트워크 오류가 발생했습니다. 잠시 후 재시도합니다';
  const tip = document.createElement('div');
  tip.id = 'apiErrorTooltip';
  tip.style.cssText = `
    position:fixed;top:48px;left:50%;transform:translateX(-50%);
    background:#2a1111;border:1px solid #e05252;color:#f87878;
    font-size:11px;padding:7px 12px;border-radius:8px;
    z-index:9999;white-space:nowrap;box-shadow:0 4px 16px rgba(224,82,82,0.25);
    animation:fadeInDown 0.25s ease;
  `;
  tip.textContent = msg;
  document.body.appendChild(tip);
  setTimeout(() => { tip.style.opacity = '0'; tip.style.transition = 'opacity 0.4s'; setTimeout(() => tip.remove(), 400); }, 4000);
}

// ─────────────────────────────────────────
// 작업 3: 프로그레스 바
// ─────────────────────────────────────────
let _progressTotal = 0;

function updateProgressBar(collected) {
  const wrap = document.getElementById('collectProgressWrap');
  const bar  = document.getElementById('collectProgressBar');
  const label = document.getElementById('collectProgressLabel');
  const pct  = document.getElementById('collectProgressPct');
  if (!wrap || !bar) return;

  if (!isCollecting) return;
  wrap.style.display = 'block';

  // 전체 예상치: 수집이 늘어날 때마다 최대값 갱신
  if (collected > _progressTotal) _progressTotal = collected;
  // 최소 단위 추정: 첫 수집 기준으로 전체 예상 (현재 수집 × 1.5 또는 고정 상한)
  const estimated = Math.max(_progressTotal, 1);
  const ratio = Math.min(collected / estimated, 1);
  const pctVal = Math.round(ratio * 100);

  bar.style.width = pctVal + '%';
  if (label) label.textContent = `수집 중... ${collected}건`;
  if (pct)   pct.textContent   = pctVal + '%';
}

function finishProgressBar() {
  const wrap  = document.getElementById('collectProgressWrap');
  const bar   = document.getElementById('collectProgressBar');
  const label = document.getElementById('collectProgressLabel');
  const pct   = document.getElementById('collectProgressPct');
  if (!wrap) return;

  if (bar)   bar.style.width = '100%';
  if (label) label.textContent = '✅ 분석 완료';
  if (pct)   pct.textContent = '100%';

  // 1.2초 후 부드럽게 사라짐
  setTimeout(() => {
    wrap.style.transition = 'opacity 0.6s ease';
    wrap.style.opacity = '0';
    setTimeout(() => {
      wrap.style.display = 'none';
      wrap.style.opacity = '1';
      wrap.style.transition = '';
      _progressTotal = 0;
    }, 650);
  }, 1200);
}
function refreshList() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_LIST_NOW' }, (res) => {
      if (chrome.runtime.lastError) { showToast('페이지를 새로고침해주세요'); return; }
      if (res?.listings) { collectedListings = res.listings; renderMarket(collectedListings); showToast(collectedListings.length + '건 수집됨'); }
    });
  });
}
function clearList() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { if (tabs?.[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_LIST' }).catch(() => {}); });
  isCollecting = false; updateCollectBtn(); collectedListings = [];
  chrome.storage.local.remove('lastListData'); renderMarket([]); showToast('목록 초기화됨');
}

// ─────────────────────────────────────────
// 시장분석 메인
// ─────────────────────────────────────────
function applyFilters() {
  const f = activeFilters;
  let list = collectedListings.filter(l => !f.deletedIds.has(l.id));

  if (f.tradeType !== 'all') {
    const isSale = f.tradeType === '매매';
    list = list.filter(l => (l.price?.type === 'sale') === isSale);
  }

  list = list.filter(l => {
    const isSale = l.price?.type === 'sale';
    if (isSale) {
      const val = Math.round((l.price?.amount||0) / 10000); // 만원 단위로 변환
      if (f.saleMin !== '' && val < parseFloat(f.saleMin)) return false;
      if (f.saleMax !== '' && val > parseFloat(f.saleMax)) return false;
    } else {
      const val = Math.round((l.price?.monthly||0) / 10000); // 만원 단위로 변환
      if (f.monthlyMin !== '' && val < parseFloat(f.monthlyMin)) return false;
      if (f.monthlyMax !== '' && val > parseFloat(f.monthlyMax)) return false;
    }
    // 면적 필터 (㎡)
    const area = l.area?.exclusive || l.area?.contract || 0;
    if (f.areaMin !== '' && area < parseFloat(f.areaMin)) return false;
    if (f.areaMax !== '' && area > parseFloat(f.areaMax)) return false;
    // 평당가 필터 (만원 단위)
    const py = l.area?.exclusivePyeong || l.area?.contractPyeong || 0;
    if (py > 0) {
      const pp = isSale
        ? Math.round((l.price?.amount||0)/10000/py)
        : Math.round((l.price?.monthly||0)/10000/py*10)/10;
      if (f.pyeongMin !== '' && pp < parseFloat(f.pyeongMin)) return false;
      if (f.pyeongMax !== '' && pp > parseFloat(f.pyeongMax)) return false;
    }
    // 층 텍스트 필터
    if (f.floorText) {
      const floor = (l.floorInfo || '').toLowerCase();
      const query = f.floorText.toLowerCase();
      if (query.startsWith('!')) {
        if (floor.includes(query.slice(1))) return false;
      } else {
        if (!floor.includes(query)) return false;
      }
    }
    // 층 버튼 필터
    if (f.floorLevels && f.floorLevels.size > 0) {
      const fn = l.floorNum;
      if (fn === null || fn === undefined) return false;
      let key;
      if (fn < 0) key = 'B';
      else if (fn <= 6) key = String(fn);
      else key = '7+';
      if (!f.floorLevels.has(key)) return false;
    }
    return true;
  });

  // 정렬
  if (f.sortKey !== 'default') {
    list = list.slice().sort((a, b) => {
      let va = 0, vb = 0;
      const aSale = a.price?.type === 'sale';
      const bSale = b.price?.type === 'sale';
      if (f.sortKey === 'price') {
        va = aSale ? (a.price?.amount||0) : (a.price?.monthly||0);
        vb = bSale ? (b.price?.amount||0) : (b.price?.monthly||0);
      } else if (f.sortKey === 'area') {
        va = a.area?.exclusive || a.area?.contract || 0;
        vb = b.area?.exclusive || b.area?.contract || 0;
      } else if (f.sortKey === 'pyeong') {
        const aPy = a.area?.exclusivePyeong || a.area?.contractPyeong || 0;
        const bPy = b.area?.exclusivePyeong || b.area?.contractPyeong || 0;
        va = aPy > 0 ? (aSale ? (a.price?.amount||0)/10000/aPy : (a.price?.monthly||0)/10000/aPy) : 0;
        vb = bPy > 0 ? (bSale ? (b.price?.amount||0)/10000/bPy : (b.price?.monthly||0)/10000/bPy) : 0;
      } else if (f.sortKey === 'monthly') {
        // 월세 기준 정렬 (월세 매물만, 매매는 뒤로)
        const aIsMonthly = a.price?.type === 'monthly' && (a.price?.monthly || 0) > 0;
        const bIsMonthly = b.price?.type === 'monthly' && (b.price?.monthly || 0) > 0;
        if (aIsMonthly && !bIsMonthly) return -1;
        if (!aIsMonthly && bIsMonthly) return 1;
        va = aIsMonthly ? (a.price?.monthly || 0) : 0;
        vb = bIsMonthly ? (b.price?.monthly || 0) : 0;
      } else if (f.sortKey === 'floor') {
        va = a.floorNum || 0;
        vb = b.floorNum || 0;
      }
      return f.sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  filteredListings = list;
  return list;
}

function renderMarket(listings) {
  applyFilters();
  const container = document.getElementById('marketContent');
  document.getElementById('marketCount').textContent = filteredListings.length + (filteredListings.length < listings.length ? '/' + listings.length : '');
  document.getElementById('sb_collected').textContent = listings.length + '건';

  // 시세 추이 스냅샷 기록
  if (listings.length > 0) recordTrendSnapshot(listings);

  if (!listings?.length) {
    container.innerHTML = '<div class="no-listing"><div class="icon">🗺️</div><p>▶ 수집 시작 버튼을 누른 후<br>매물을 클릭하거나 스크롤하세요</p></div>';
    return;
  }
  const fl = filteredListings;
  const sales = fl.filter(l => l.price?.type === 'sale');
  const monthlies = fl.filter(l => l.price?.type === 'monthly' && l.price?.monthly > 0);
  const jeonseLst = fl.filter(l => l.price?.type === 'monthly' && !(l.price?.monthly > 0));
  container.innerHTML =
    buildSummaryCards(fl, sales, monthlies, jeonseLst) +
    buildFloorTwoTier(fl, sales, monthlies) +
    buildAreaBands(fl, sales, monthlies) +
    buildPyeongDistChart(monthlies) +
    buildSalePyeongDistChart(sales) +
    buildCombinedDist(sales, monthlies) +
    buildRepresentativeListings(sales, monthlies);

  // 1층 제외 체크박스 — innerHTML 주입 후 여기서 직접 리스너 부착
  const areaCb    = document.getElementById('areaBandExclude1F');
  const areaTbody = document.getElementById('areaBandTable_body');
  if (areaCb && areaTbody) {
    areaCb.addEventListener('change', function() {
      areaTbody.innerHTML = areaCb.checked ? _areaBandRows.excl1F : _areaBandRows.all;
    });
  }

  // 층별 분석 필터 초기화 버튼 바인딩
  const resetBtn = document.getElementById('floorFilterResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      const { deletedIds, filterOpen } = activeFilters;
      activeFilters = { tradeType:'all', saleMin:'', saleMax:'', monthlyMin:'', monthlyMax:'',
        areaMin:'', areaMax:'', pyeongMin:'', pyeongMax:'', floorText:'',
        sortKey:'default', sortDir:'asc', filterOpen, deletedIds };
      // 입력창도 초기화
      ['fSaleMin','fSaleMax','fMonthlyMin','fMonthlyMax','fAreaMin','fAreaMax','fPyeongMin','fPyeongMax'].forEach(function(id) {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const fl2 = document.getElementById('fFloor'); if (fl2) fl2.value = '';
      const ftypeBtns = document.querySelectorAll('.ftype-btn');
      ftypeBtns.forEach(function(b) {
        const on = b.dataset.type === 'all';
        b.style.background = on ? 'var(--primary)' : 'transparent';
        b.style.color = on ? 'white' : 'var(--text2)';
        b.style.fontWeight = on ? '700' : '400';
      });
      applyFilters();
      _updateListBody();
      renderMarket(collectedListings);
    });
  }

  // 매물목록 탭이 열려있으면 같이 갱신
  if (document.getElementById('sub-listview')?.classList.contains('active')) renderListView();

  // 부동산 TOP3 업데이트
  updateRealtorStats();
}

// ─────────────────────────────────────────
// 작업 1: 중개업소 TOP3 추출 및 시각화
// ─────────────────────────────────────────
function updateRealtorStats() {
  const container = document.getElementById('realtor-rank-container');
  if (!container) return;

  // realtorName 빈도 카운트
  const countMap = {};
  collectedListings.forEach(l => {
    const name = (l.realtorName || '').trim();
    if (!name) return;
    countMap[name] = (countMap[name] || 0) + 1;
  });

  const top3 = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (!top3.length) {
    container.innerHTML = '<div style="padding:10px 0;text-align:center;font-size:11px;color:var(--text3)">중개업소 정보 없음</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const maxCount = top3[0][1];

  container.innerHTML = `
    <div style="padding:10px 0 4px;font-size:11px;font-weight:700;color:var(--gold);letter-spacing:0.03em">🏢 활성 중개업소 TOP 3</div>
    ${top3.map(([name, count], i) => {
      const pct = Math.round(count / maxCount * 100);
      return `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:5px;">
              <span style="font-size:15px">${medals[i]}</span>
              <span style="font-size:11px;font-weight:700;color:var(--text);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
            </div>
            <span style="font-size:12px;font-weight:700;color:var(--gold)">${count}건</span>
          </div>
          <div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--gold),var(--gold-light,#e8c96b));border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
        </div>`;
    }).join('')}
  `;
}

// ─────────────────────────────────────────
// 전체 요약
// ─────────────────────────────────────────
function buildSummaryCards(all, sales, monthlies, jeonseLst) {
  // price.amount는 원 단위 → 만원으로 변환
  const saleAmounts = sales.map(l => l.price.amount / 10000).filter(v => v > 0);
  const monthlyAmounts = monthlies.map(l => l.price.monthly / 10000).filter(v => v > 0);
  const avgSale = saleAmounts.length ? Math.round(avgExcludeMinMax(saleAmounts)) : null;
  const avgMonthly = monthlyAmounts.length ? Math.round(avgExcludeMinMax(monthlyAmounts) * 10) / 10 : null;

  // 평당가
  const salePyeongs = sales.map(l => { const p=getExclusivePyeong(l); const v=l.price.amount/10000; return (p>0&&v>0)?Math.round(v/p):null; }).filter(v=>v!==null&&v>0&&v<100000);
  const avgSalePyeong = salePyeongs.length ? Math.round(avgExcludeMinMax(salePyeongs)) : null;
  const rentPyeongs = monthlies.map(l => { const p=getExclusivePyeong(l); const v=l.price.monthly/10000; return (p>0&&v>0)?Math.round(v/p*10)/10:null; }).filter(v=>v!==null&&v>0);
  const avgRentPyeong = rentPyeongs.length ? Math.round(avgExcludeMinMax(rentPyeongs)*10)/10 : null;

  // 매매/임대 비율 (시장 성격 파악)
  const totalRent = monthlies.length + (jeonseLst||[]).length;
  const saleRatio = all.length > 0 ? Math.round(sales.length / all.length * 100) : null;
  const rentRatio = all.length > 0 ? Math.round(totalRent / all.length * 100) : null;
  // 매매 비율이 높을수록 매도 압력, 임대 비율이 높을수록 임대 공급 우세
  const mktCharLabel = saleRatio === null ? null
    : saleRatio >= 60 ? '매도 우세' : saleRatio <= 30 ? '임대 우세' : '혼합';
  const mktCharColor = saleRatio === null ? '' : saleRatio >= 60 ? 'var(--blue)' : saleRatio <= 30 ? 'var(--green)' : 'var(--orange)';

  // 중위값
  const sortedSale = [...saleAmounts].sort((a,b)=>a-b);
  const sortedRent = [...monthlyAmounts].sort((a,b)=>a-b);
  const medSale = sortedSale.length ? sortedSale[Math.floor(sortedSale.length/2)] : null;
  const medRent = sortedRent.length ? sortedRent[Math.floor(sortedRent.length/2)] : null;

  // 전체 시장 수익률 추정
  const mktYr = (avgSale && avgSale > 0 && avgMonthly && avgMonthly > 0)
    ? Math.round(avgMonthly * 12 / avgSale * 1000) / 10 : null;
  const mktYrCol = mktYr ? (mktYr>=6?'var(--green)':mktYr>=4?'var(--orange)':'var(--text3)') : '';

  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">📌 전체 요약 <span style="font-size:10px;color:var(--text3);font-weight:400">(최소·최대 제외 평균)</span></div>
    <div class="result-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <div class="result-card"><div class="result-label">총 매물</div><div class="result-value" style="font-size:14px">${all.length}건</div></div>
      <div class="result-card"><div class="result-label">매매</div><div class="result-value" style="font-size:14px;color:var(--blue)">${sales.length}건</div></div>
      <div class="result-card"><div class="result-label">월세</div><div class="result-value" style="font-size:14px;color:var(--green)">${monthlies.length}건</div></div>
      <div class="result-card"><div class="result-label">전세</div><div class="result-value" style="font-size:14px;color:var(--orange)">${(jeonseLst||[]).length}건</div></div>
    </div>
    <div class="result-grid" style="margin-top:6px">
      ${avgSale ? `<div class="result-card highlight"><div class="result-label">평균매매가</div><div class="result-value" style="font-size:13px">${fmtComma(avgSale)}만</div><div class="result-sub">중위 ${medSale?fmtComma(medSale)+'만':'-'}</div></div>` : ''}
      ${avgSalePyeong ? `<div class="result-card"><div class="result-label">매매 평균평당</div><div class="result-value orange" style="font-size:13px">${fmtComma(avgSalePyeong)}만</div><div class="result-sub">전용기준</div></div>` : ''}
      ${avgMonthly ? `<div class="result-card highlight"><div class="result-label">평균임대료</div><div class="result-value" style="font-size:13px;color:var(--green)">${fmtComma(avgMonthly)}만</div><div class="result-sub">중위 ${medRent?fmtComma(medRent)+'만':'-'}</div></div>` : ''}
      ${avgRentPyeong ? `<div class="result-card"><div class="result-label">임대 평당가</div><div class="result-value" style="font-size:13px;color:var(--green)">${fmtComma1(avgRentPyeong)}만</div><div class="result-sub">전용기준</div></div>` : ''}
    </div>
    ${(mktYr || saleRatio !== null) ? `
    <div class="result-grid" style="margin-top:6px">
      ${mktYr ? `<div class="result-card"><div class="result-label">시장 평균수익률</div><div class="result-value" style="color:${mktYrCol};font-size:15px;font-weight:700">${mktYr}%</div><div class="result-sub">임대÷매매 단순추정</div></div>` : ''}
      ${saleRatio !== null ? `<div class="result-card"><div class="result-label">매매:임대 비율</div><div class="result-value" style="color:${mktCharColor};font-size:13px;font-weight:700">${saleRatio}:${rentRatio}</div><div class="result-sub" style="color:${mktCharColor}">${mktCharLabel}</div></div>` : ''}
    </div>` : ''}
  </div>`;
}

// ─────────────────────────────────────────
// 층별 분석 - 2단계 층위
// ─────────────────────────────────────────
function buildFloorTwoTier(all, sales, monthlies) {
  // 층번호 분류 헬퍼
  function getTier1(floorNum) {
    if (floorNum === null) return null;
    if (floorNum < 0) return 'B';   // 지하
    if (floorNum === 1) return '1';
    if (floorNum === 2) return '2';
    return 'U'; // 상층부
  }
  function getTier2(floorNum) {
    if (floorNum === null) return null;
    if (floorNum < 0) return 'B';
    if (floorNum <= 6) return String(floorNum);
    return '7+'; // 7층 이상
  }

  // 데이터 그루핑 (전세는 monthlies에서 제외)
  function groupBy(items, keyFn) {
    const groups = {};
    items.forEach(l => {
      const key = keyFn(l.floorNum);
      if (key === null) return;
      if (!groups[key]) groups[key] = { sales: [], monthlies: [] };
      if (l.price?.type === 'sale') groups[key].sales.push(l);
      if (l.price?.type === 'monthly' && l.price?.monthly > 0) groups[key].monthlies.push(l); // 전세 제외
    });
    return groups;
  }

  const tier1Groups = groupBy(all, getTier1);
  const tier2Groups = groupBy(all, getTier2);

  const hasFloorData = Object.keys(tier1Groups).length > 0;
  if (!hasFloorData) return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">🏢 층별 분석</div>
    <div style="color:var(--text3);font-size:11px;padding:8px 0">💡 매물을 클릭하면 층 정보가 수집됩니다</div>
  </div>`;

  // 층별 세분화 테이블만 생성
  function buildFloorTable(groups, tierOrder, labelFn) {
    const rows = tierOrder.filter(k => groups[k]).map(key => {
      const g = groups[key];
      const cnt = g.sales.length + g.monthlies.length;

      // 평균 면적 (전용, 평 기준)
      const allItems = g.sales.concat(g.monthlies);
      const areas = allItems.map(l => getExclusivePyeong(l)).filter(v => v > 0);
      const avgArea = areas.length ? Math.round(avgExcludeMinMax(areas) * 10) / 10 : null;

      // 매매 통계
      const salePrices = g.sales.map(l => l.price.amount / 10000).filter(v => v > 0);
      const salePyeongs = g.sales
        .map(l => { const p = getExclusivePyeong(l); const v = l.price.amount / 10000; return (p > 0 && v > 0) ? Math.round(v / p) : null; })
        .filter(v => v !== null && v > 0 && v < 100000);
      const avgSale = salePrices.length ? Math.round(avgExcludeMinMax(salePrices)) : null;
      const avgSalePP = salePyeongs.length ? Math.round(avgExcludeMinMax(salePyeongs)) : null;

      // 임대 통계
      const rentPrices = g.monthlies.map(l => l.price.monthly / 10000).filter(v => v > 0);
      const rentPyeongs = g.monthlies
        .map(l => { const p = getExclusivePyeong(l); const v = l.price.monthly / 10000; return (p > 0 && v > 0) ? Math.round(v / p * 10) / 10 : null; })
        .filter(v => v !== null && v > 0);
      const avgRent = rentPrices.length ? Math.round(avgExcludeMinMax(rentPrices) * 10) / 10 : null;
      const avgRentPP = rentPyeongs.length ? Math.round(avgExcludeMinMax(rentPyeongs) * 10) / 10 : null;

      // 수익률 (평균 매매가 + 평균 임대료 기준)
      let yieldCell = '-';
      if (avgSale && avgSale > 0 && avgRent && avgRent > 0) {
        const yr = Math.round(avgRent * 12 / avgSale * 1000) / 10;
        const col = yr >= 6 ? 'var(--green)' : yr >= 4 ? 'var(--orange)' : 'var(--text3)';
        yieldCell = `<span style="color:${col};font-weight:700;">${yr}%</span>`;
      }

      // 매매가(평당) 셀: "9억(@7,154만)"
      let saleCell = '-';
      if (avgSale !== null) {
        saleCell = '<span style="color:var(--blue)">' + fmtMan(avgSale) + '</span>'
          + (avgSalePP !== null ? '<span style="color:var(--orange);font-size:10px;">(@' + fmtMan(avgSalePP) + ')</span>' : '');
      }

      // 임대료(평당) 셀: "284만(@24만)"
      let rentCell = '-';
      if (avgRent !== null) {
        rentCell = '<span style="color:var(--green)">' + fmtMan(avgRent) + '</span>'
          + (avgRentPP !== null ? '<span style="color:var(--orange);font-size:10px;">(@' + fmtComma1(avgRentPP) + '만)</span>' : '');
      }

      return `
      <tr>
        <td style="font-weight:700;color:var(--primary-light);white-space:nowrap">${labelFn(key)}</td>
        <td style="font-size:10px;color:var(--text3);text-align:center">${cnt}건</td>
        <td style="text-align:right;color:var(--text2)">${avgArea !== null ? fmtComma1(avgArea)+'평' : '-'}</td>
        <td style="text-align:right;line-height:1.5">${saleCell}</td>
        <td style="text-align:right;line-height:1.5">${rentCell}</td>
        <td style="text-align:right">${yieldCell}</td>
      </tr>`;
    }).join('');

    if (!rows) return '';
    return `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="color:var(--text3);font-size:10px;border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 2px">층</th>
          <th style="text-align:center;padding:3px 2px">건수</th>
          <th style="text-align:right;padding:3px 2px">평균면적</th>
          <th style="text-align:right;padding:3px 2px">평균매매가<span style="color:var(--orange)">(@평당)</span></th>
          <th style="text-align:right;padding:3px 2px">평균임대료<span style="color:var(--orange)">(@평당)</span></th>
          <th style="text-align:right;padding:3px 2px">수익률</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const tier2Order = ['B','1','2','3','4','5','6','7+'];
  const tier2Labels = { B:'지하', '1':'1층', '2':'2층', '3':'3층', '4':'4층', '5':'5층', '6':'6층', '7+':'7층+' };

  const t2 = buildFloorTable(tier2Groups, tier2Order, k => tier2Labels[k] || k);

  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title" style="display:flex;align-items:center;justify-content:space-between;">
      <span>🏢 층별 분석 <span style="font-size:10px;color:var(--text3);font-weight:400">(최소·최대 제외 평균 / 전용기준)</span></span>
      <button id="floorFilterResetBtn" style="font-size:10px;padding:2px 8px;background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.25);color:#ff6b6b;border-radius:5px;cursor:pointer;">필터 초기화</button>
    </div>
    ${t2 || '<div style="color:var(--text3);font-size:11px">데이터 없음</div>'}
    <div style="font-size:10px;color:var(--text3);margin-top:6px">* 층 정보는 매물 클릭 시 수집됩니다</div>
  </div>`;
}

// ─────────────────────────────────────────
// 분포 차트들
// ─────────────────────────────────────────
function buildBarChart(title, labels, counts, color, headerHTML = '') {
  const maxC = Math.max(...counts, 1);
  const bars = labels.map((label, i) => {
    if (counts[i] === 0) return '';
    const pct = Math.round(counts[i] / maxC * 100);
    return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
      <div style="width:52px;font-size:9px;color:var(--text3);text-align:right;flex-shrink:0">${label}</div>
      <div style="flex:1;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:14px;width:${pct}%;background:${color};border-radius:3px;opacity:0.85;min-width:4px"></div>
      </div>
      <div style="width:22px;font-size:10px;color:var(--text2);font-weight:600;text-align:right">${counts[i]}</div>
    </div>`;
  }).join('');
  return `<div class="calc-section" style="margin-bottom:8px"><div class="calc-title">${title}</div>${headerHTML}${bars || '<div style="color:var(--text3);font-size:11px">데이터 없음</div>'}</div>`;
}

// ─────────────────────────────────────────
// 통합 분포표: 매매가 + 임대 분포
// ─────────────────────────────────────────
function buildCombinedDist(sales, monthlies) {
  const hasSale = sales.length > 0;
  const hasRent = monthlies.length > 0;
  if (!hasSale && !hasRent) return '';

  // 매매가 구간 (만원 단위)
  const saleBins   = [0, 5000, 10000, 20000, 30000, 50000, 80000, 999999999];
  const saleLabels = ['~5천', '~1억', '~2억', '~3억', '~5억', '~8억', '8억+'];
  const saleCounts = new Array(saleLabels.length).fill(0);
  sales.forEach(l => {
    const v = Math.round((l.price?.amount || 0) / 10000);
    for (let i = 0; i < saleBins.length - 1; i++) {
      if (v > saleBins[i] && v <= saleBins[i+1]) { saleCounts[i]++; break; }
    }
  });

  // 월세 구간 (만원)
  const rentBins   = [0, 50, 100, 150, 200, 300, 500, 999999];
  const rentLabels = ['~50만', '~100만', '~150만', '~200만', '~300만', '~500만', '500만+'];
  const rentCounts = new Array(rentLabels.length).fill(0);
  monthlies.forEach(l => {
    const v = Math.round((l.price?.monthly || 0) / 10000);
    for (let i = 0; i < rentBins.length - 1; i++) {
      if (v > rentBins[i] && v <= rentBins[i+1]) { rentCounts[i]++; break; }
    }
  });

  const maxSale = Math.max(...saleCounts, 1);
  const maxRent = Math.max(...rentCounts, 1);

  function bar(count, max, color) {
    const pct = Math.round(count / max * 100);
    return `<div style="display:flex;align-items:center;gap:4px;height:16px;">
      <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:3px;height:10px;overflow:hidden;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;transition:width 0.3s;"></div>
      </div>
      <span style="color:var(--text3);font-size:10px;min-width:16px;text-align:right;">${count || ''}</span>
    </div>`;
  }

  // 통합 라벨 (더 긴 쪽 기준)
  const saleRows = saleLabels.map((lbl, i) => `
    <tr>
      <td style="color:var(--blue);font-size:10px;white-space:nowrap;padding:2px 4px;">${lbl}</td>
      <td style="width:120px;padding:2px 2px;">${bar(saleCounts[i], maxSale, 'var(--blue)')}</td>
    </tr>`).join('');

  const rentRows = rentLabels.map((lbl, i) => `
    <tr>
      <td style="color:var(--green);font-size:10px;white-space:nowrap;padding:2px 4px;">${lbl}</td>
      <td style="width:120px;padding:2px 2px;">${bar(rentCounts[i], maxRent, 'var(--green)')}</td>
    </tr>`).join('');

  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">📊 가격 분포</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${hasSale ? `<div>
        <div style="font-size:10px;color:var(--blue);font-weight:600;margin-bottom:4px;">매매가 분포 (${sales.length}건)</div>
        <table style="width:100%;border-collapse:collapse;">${saleRows}</table>
      </div>` : ''}
      ${hasRent ? `<div>
        <div style="font-size:10px;color:var(--green);font-weight:600;margin-bottom:4px;">월세 분포 (${monthlies.length}건)</div>
        <table style="width:100%;border-collapse:collapse;">${rentRows}</table>
      </div>` : ''}
    </div>
  </div>`;
}

// ─────────────────────────────────────────
// 월세 평수 분포 차트
// ─────────────────────────────────────────
function buildPyeongDistChart(monthlies) {
  if (!monthlies.length) return '';
  const bins = [10,20,30,40,50,60,70,80,90,Infinity];
  const labels = ['10평','20평','30평','40평','50평','60평','70평','80평','90평','100+평'];
  const counts = new Array(bins.length).fill(0);
  monthlies.forEach(l => {
    const py = getExclusivePyeong(l);
    if (!py) return;
    for (let i = 0; i < bins.length; i++) {
      if (py <= bins[i]) { counts[i]++; break; }
    }
  });
  const maxC = Math.max(...counts, 1);
  const bars = counts.map((c, i) => {
    const pct = Math.round(c / maxC * 100);
    const isZero = c === 0;
    return `<div class="pyeong-bar-wrap">
      <div class="pyeong-bar-count${isZero?' zero':''}">${c}</div>
      <div class="pyeong-bar${isZero?' zero':''}" style="height:${Math.max(pct * 0.58, isZero?4:4)}px"></div>
      <div class="pyeong-bar-label">${labels[i]}</div>
    </div>`;
  }).join('');
  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">✏️ 월세 평수 분포 <span style="font-size:10px;color:var(--text3);font-weight:400">(${monthlies.length}건)</span></div>
    <div class="pyeong-chart">${bars}</div>
  </div>`;
}

// ─────────────────────────────────────────
// 매매 평수 분포 차트
// ─────────────────────────────────────────
function buildSalePyeongDistChart(sales) {
  if (!sales.length) return '';
  const bins = [10,20,30,40,50,60,70,80,90,Infinity];
  const labels = ['10평','20평','30평','40평','50평','60평','70평','80평','90평','100+평'];
  const counts = new Array(bins.length).fill(0);
  sales.forEach(l => {
    const py = getExclusivePyeong(l);
    if (!py) return;
    for (let i = 0; i < bins.length; i++) {
      if (py <= bins[i]) { counts[i]++; break; }
    }
  });
  const maxC = Math.max(...counts, 1);
  const bars = counts.map((c, i) => {
    const pct = Math.round(c / maxC * 100);
    const isZero = c === 0;
    return `<div class="pyeong-bar-wrap">
      <div class="pyeong-bar-count${isZero?' zero':''}">${c}</div>
      <div class="pyeong-bar${isZero?' zero':''}" style="height:${Math.max(pct * 0.58, isZero?4:4)}px;background:var(--blue)"></div>
      <div class="pyeong-bar-label">${labels[i]}</div>
    </div>`;
  }).join('');
  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">📐 매매 평수 분포 <span style="font-size:10px;color:var(--text3);font-weight:400">(${sales.length}건)</span></div>
    <div class="pyeong-chart">${bars}</div>
  </div>`;
}
function buildAreaBands(all, sales, monthlies) {
  if (!all.length) return '';

  // 20평 이하 5평 단위, 20평 초과 10평 단위
  const bands = [
    { label: '~5평',   min: 0,  max: 5  },
    { label: '5~10평', min: 5,  max: 10 },
    { label: '10~15평',min: 10, max: 15 },
    { label: '15~20평',min: 15, max: 20 },
    { label: '20~30평',min: 20, max: 30 },
    { label: '30~40평',min: 30, max: 40 },
    { label: '40~50평',min: 40, max: 50 },
    { label: '50평+',  min: 50, max: 9999 },
  ];

  function calcRows(listings, saleList, rentList) {
    return bands.map(band => {
      const items = listings.filter(l => { const py = getExclusivePyeong(l); return py > band.min && py <= band.max; });
      if (!items.length) return null;
      const bSales = saleList.filter(l => { const py = getExclusivePyeong(l); return py > band.min && py <= band.max; });
      const bRents = rentList.filter(l => { const py = getExclusivePyeong(l); return py > band.min && py <= band.max; });

      const salePrices = bSales.map(l => Math.round(l.price.amount/10000)).filter(v=>v>0);
      const salePPs    = bSales.map(l => { const py=getExclusivePyeong(l); return py>0?Math.round(l.price.amount/10000/py):null; }).filter(Boolean);
      const rentPrices = bRents.map(l => Math.round(l.price.monthly/10000)).filter(v=>v>0);
      const rentPPs    = bRents.map(l => { const py=getExclusivePyeong(l); return py>0?Math.round(l.price.monthly/10000/py*10)/10:null; }).filter(Boolean);

      const avgSale   = salePrices.length ? Math.round(avgExcludeMinMax(salePrices)) : null;
      const avgSalePP = salePPs.length    ? Math.round(avgExcludeMinMax(salePPs))    : null;
      const avgRent   = rentPrices.length ? Math.round(avgExcludeMinMax(rentPrices)*10)/10 : null;
      const avgRentPP = rentPPs.length    ? Math.round(avgExcludeMinMax(rentPPs)*10)/10    : null;

      let yieldStr = '-';
      if (avgSale && avgSale > 0 && avgRent && avgRent > 0) {
        const yr = Math.round(avgRent * 12 / avgSale * 1000) / 10;
        const col = yr >= 6 ? 'var(--green)' : yr >= 4 ? 'var(--orange)' : 'var(--text3)';
        const n = Math.min(bSales.length, bRents.length);
        yieldStr = `<span style="color:${col};font-weight:600;" title="${n}개 매물 기준">${yr}%</span><span style="color:var(--text3);font-size:9px;"> (${n}건)</span>`;
      }

      const saleCell = avgSale
        ? `<div style="color:var(--blue);font-size:11px;line-height:1.3">${fmtMan(avgSale)}</div>${avgSalePP?`<div style="color:var(--orange);font-size:9px">@${fmtMan(avgSalePP)}</div>`:''}`
        : '-';
      const rentCell = avgRent
        ? `<div style="color:var(--green);font-size:11px;line-height:1.3">${fmtMan(avgRent)}</div>${avgRentPP?`<div style="color:var(--orange);font-size:9px">@${fmtComma1(avgRentPP)}만</div>`:''}`
        : '-';

      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="font-weight:700;color:var(--primary-light);white-space:nowrap;padding:4px 2px;font-size:10px">${band.label}</td>
        <td style="text-align:center;color:var(--text3);font-size:10px;padding:4px 2px;">${items.length}</td>
        <td style="text-align:right;padding:4px 2px;">${saleCell}</td>
        <td style="text-align:right;padding:4px 2px;">${rentCell}</td>
        <td style="text-align:right;padding:4px 2px;">${yieldStr}</td>
      </tr>`;
    }).filter(Boolean);
  }

  // 1층 제외 필터
  function exclude1F(list) {
    return list.filter(l => l.floorNum === null || l.floorNum === undefined || l.floorNum !== 1);
  }

  const tableId = 'areaBandTable';
  const cbId    = 'areaBandExclude1F';

  const rows    = calcRows(all, sales, monthlies);
  const rows1f  = calcRows(exclude1F(all), exclude1F(sales), exclude1F(monthlies));

  // 전역에 저장 → renderMarket()에서 체크박스 리스너가 사용
  _areaBandRows.all    = rows.join('');
  _areaBandRows.excl1F = rows1f.join('');

  if (!rows.length) return '';

  const thead = `<thead><tr style="color:var(--text3);font-size:10px;border-bottom:1px solid var(--border);">
    <th style="text-align:left;padding:3px 2px;">면적</th>
    <th style="text-align:center;padding:3px 2px;">건수</th>
    <th style="text-align:right;padding:3px 2px;white-space:nowrap;">평균매매가<span style="color:var(--orange);font-size:9px">(@평당)</span></th>
    <th style="text-align:right;padding:3px 2px;white-space:nowrap;">평균월세<span style="color:var(--orange);font-size:9px">(@평당)</span></th>
    <th style="text-align:right;padding:3px 2px;">수익률</th>
  </tr></thead>`;

  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div class="calc-title" style="margin-bottom:0;">📐 면적대별 분석</div>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" id="${cbId}" style="cursor:pointer;accent-color:var(--primary);">
        1층 제외
      </label>
    </div>
    <table id="${tableId}" style="width:100%;border-collapse:collapse;font-size:11px;">
      ${thead}<tbody id="${tableId}_body">${rows.join('')}</tbody>
    </table>
    <div style="font-size:10px;color:var(--text3);margin-top:4px;">* 수익률 = 연간 월세 ÷ 평균 매매가 · 색상: <span style="color:var(--green)">6%↑</span> <span style="color:var(--orange)">4~6%</span> <span style="color:var(--text3)">4%↓</span></div>
  </div>`;
}

// ─────────────────────────────────────────
// 대표 매물 (중앙값 / 가성비 / 수익률 상위)
// ─────────────────────────────────────────
function buildRepresentativeListings(sales, monthlies) {
  if (!sales.length && !monthlies.length) return '';

  function card(label, labelColor, priceText, subLines, url) {
    const inner = `
      <div style="font-size:10px;color:${labelColor};font-weight:700;margin-bottom:3px;">${label}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text);">${priceText}</div>
      ${subLines.map(s => `<div style="font-size:10px;color:var(--text3);margin-top:1px;">${s}</div>`).join('')}`;
    return url
      ? `<a href="${url}" target="_blank" style="text-decoration:none;flex:1;">
           <div class="result-card" style="cursor:pointer;border-color:${labelColor};">${inner}</div></a>`
      : `<div class="result-card" style="flex:1;border-color:${labelColor};">${inner}</div>`;
  }

  const cards = [];

  // 1. 중앙값 매물 (매매)
  if (sales.length) {
    const sorted = [...sales].sort((a, b) => (a.price?.amount || 0) - (b.price?.amount || 0));
    const med = sorted[Math.floor(sorted.length / 2)];
    const py = getExclusivePyeong(med);
    const pp = py > 0 ? fmtMan(Math.round(med.price.amount / 10000 / py)) : null;
    cards.push(card(
      '📍 중앙값 매매', 'var(--blue)',
      fmtMan(Math.round(med.price.amount / 10000)),
      [py ? py + '평(전용)' + (med.floorInfo ? ' · ' + med.floorInfo : '') : '', pp ? '평당 ' + pp : ''].filter(Boolean),
      makeUrl(med)
    ));
  }

  // 2. 중앙값 매물 (월세)
  if (monthlies.length) {
    const sorted = [...monthlies].sort((a, b) => (a.price?.monthly || 0) - (b.price?.monthly || 0));
    const med = sorted[Math.floor(sorted.length / 2)];
    const py = getExclusivePyeong(med);
    const dep = Math.round((med.price.deposit || 0) / 10000);
    cards.push(card(
      '📍 중앙값 월세', 'var(--green)',
      fmtMan(Math.round(med.price.monthly / 10000)),
      ['보증금 ' + fmtMan(dep), py ? py + '평(전용)' + (med.floorInfo ? ' · ' + med.floorInfo : '') : ''].filter(Boolean),
      makeUrl(med)
    ));
  }

  // 3. 가성비 매물 (평당가 하위 25% 중 수익률 최고)
  const withPP = sales.filter(l => {
    const py = getExclusivePyeong(l); return py > 0 && l.price?.amount > 0;
  }).map(l => {
    const py = getExclusivePyeong(l);
    return { l, pp: Math.round(l.price.amount / 10000 / py) };
  }).sort((a, b) => a.pp - b.pp);

  if (withPP.length >= 2) {
    const cutoff = withPP[Math.floor(withPP.length * 0.35)].pp;
    const cheap = withPP.filter(x => x.pp <= cutoff);
    // 그 중 수익률 가장 높은 것
    const best = cheap.sort((a, b) => {
      // 같은 면적대 월세 매물과 비교
      const py_a = getExclusivePyeong(a.l), py_b = getExclusivePyeong(b.l);
      const rentA = monthlies.find(m => { const p = getExclusivePyeong(m); return Math.abs(p - py_a) < 5; });
      const rentB = monthlies.find(m => { const p = getExclusivePyeong(m); return Math.abs(p - py_b) < 5; });
      const yrA = rentA ? rentA.price.monthly * 12 / a.l.price.amount : 0;
      const yrB = rentB ? rentB.price.monthly * 12 / b.l.price.amount : 0;
      return yrB - yrA;
    })[0];
    if (best) {
      const py = getExclusivePyeong(best.l);
      cards.push(card(
        '💎 가성비 매물', 'var(--secondary)',
        fmtMan(Math.round(best.l.price.amount / 10000)),
        [py + '평(전용)' + (best.l.floorInfo ? ' · ' + best.l.floorInfo : ''), '평당 ' + fmtMan(best.pp) + ' (하위 35%)'],
        makeUrl(best.l)
      ));
    }
  }


  if (!cards.length) return '';

  // 2열 그리드
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) {
    rows.push(`<div style="display:flex;gap:6px;margin-bottom:6px;">${cards[i]}${cards[i+1] || '<div style="flex:1"></div>'}</div>`);
  }

  return `
  <div class="calc-section" style="margin-bottom:8px">
    <div class="calc-title">🔖 대표 매물</div>
    ${rows.join('')}
    <div style="font-size:10px;color:var(--text3);margin-top:2px;">* 수익률은 해당 매물에 임대 정보가 직접 포함된 경우만 표시</div>
  </div>`;
}


// ─────────────────────────────────────────
// 매물정보
// ─────────────────────────────────────────
function renderListing(data) {
  const container = document.getElementById('listingContent');
  const tradeType = data.tradeType || (data.priceRaw?.includes('/') ? '월세' : '매매');
  const isSaved = savedListings.some(l => l.id === data.id);

  // ── 금액 표시 (필수) ───────────────────────────────────────────
  let priceDisplay = '금액 정보 없음';
  let priceColor = 'var(--text3)';
  if (data.price?.type === 'monthly' && data.price?.monthly > 0) {
    const dep = data.price.deposit > 0 ? fmtMan(Math.round(data.price.deposit / 10000)) : '없음';
    const mon = fmtMan(Math.round(data.price.monthly / 10000));
    priceDisplay = `보증 ${dep} / 월세 ${mon}`;
    priceColor = 'var(--green)';
  } else if (data.price?.type === 'monthly' && data.price?.deposit > 0) {
    priceDisplay = '전세 ' + fmtMan(Math.round(data.price.deposit / 10000));
    priceColor = 'var(--orange)';
  } else if (data.price?.type === 'sale' && data.price?.amount > 0) {
    priceDisplay = fmtMan(Math.round(data.price.amount / 10000));
    priceColor = 'var(--secondary)';
  } else if (data.priceRaw && data.priceRaw !== '0' && data.priceRaw !== '-') {
    // priceRaw에서 직접 표시 (파싱 실패 시 fallback)
    priceDisplay = data.priceRaw;
    priceColor = 'var(--text2)';
  }
  // ── 면적 표시: area1=계약, area2=전용 ─────────────────────────
  let areaDisplay = '-', pyeongDisplay = '-', pyeongPrice = '';
  if (data.area?.contract) {
    const hasExclusive = data.area.exclusive && data.area.exclusive !== data.area.contract;
    const contractPy = data.area.contractPyeong || Math.round(data.area.contract / 3.3058 * 10) / 10;
    const excPy = data.area.exclusivePyeong || (hasExclusive ? Math.round(data.area.exclusive / 3.3058 * 10) / 10 : null);

    if (hasExclusive) {
      areaDisplay   = `계약 ${data.area.contract}㎡ / 전용 ${data.area.exclusive}㎡`;
      pyeongDisplay = `계약 ${contractPy}평 / 전용 ${excPy}평`;
    } else {
      areaDisplay   = `${data.area.contract}㎡`;
      pyeongDisplay = `${contractPy}평`;
    }

    const priceMan = data.price?.type === 'sale' ? Math.round(data.price.amount / 10000) : 0;
    const usePy = excPy || contractPy;
    if (usePy > 0 && priceMan > 0) {
      pyeongPrice = ` · 평단 ${fmtMan(Math.round(priceMan / usePy))}`;
    }
  }

  // ── 임대중 정보 ────────────────────────────────────────────────
  let rentInfo = '';
  if (data.rentPrice?.monthly > 0) {
    const rDep = fmtComma(Math.round(data.rentPrice.deposit / 10000));
    const rMon = fmtComma(Math.round(data.rentPrice.monthly / 10000));
    const isSaleRent = data.price?.type === 'sale';
    rentInfo = `<div style="margin-top:4px;padding:5px 8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;font-size:11px;color:var(--green)">
      🏪 ${isSaleRent ? '현재 임대중' : '임대정보'} · 보증 ${rDep}만 / 월 ${rMon}만
      ${isSaleRent && data.price?.amount > 0 ? `<span style="margin-left:6px;color:var(--primary-light)">수익률 ${(Math.round(data.rentPrice.monthly*12/data.price.amount*1000)/10)}%</span>` : ''}
    </div>`;
  }

  // ── 추가 정보 항목들 ──────────────────────────────────────────
  const fieldDefs = [
    ['입주가능일',  data.moveInType],
    ['현재업종',    data.currentUse],
    ['추천업종',    data.recommendUse],
    ['융자금',      data.loanable, 'var(--orange)'],
    ['권리금',      data.keyMoney,  'var(--orange)'],
    ['월 관리비',   data.manageFee],
    ['주차',        data.parking + (data.totalParkingCount ? ' (총 ' + data.totalParkingCount + '대)' : '')],
    ['난방',        data.heating],
    ['건축물 용도', data.buildingUse],
    ['용도지역',    data.zoneType],
    ['주구조',      data.structure],
    ['화장실',      data.toiletCount !== undefined ? data.toiletCount + '개' : null],
    ['사용승인일',  data.approvalDate],
    ['매물번호',    data.listingNo || data.articleNo],
  ];
  const extraFields = fieldDefs
    .filter(([,val]) => val && val !== 'null' && val !== 'undefined' && val !== 'false')
    .map(([label, val, color]) =>
      `<div class="info-item"><div class="info-label">${label}</div><div class="info-value"${color ? ` style="color:${color}"` : ''}>${val}</div></div>`
    ).join('');

  // ── 중개사 정보 (전화번호만 간단히) ─────────────────────────────
  let realtorSection = '';
  if (data.realtor) {
    // tel 필드 우선, 없으면 name 필드에서 전화번호 패턴 추출
    let tel = data.realtor.tel || '';
    if (!tel && data.realtor.name) {
      const match = data.realtor.name.match(/0\d{1,2}-\d{3,4}-\d{4}/);
      if (match) tel = match[0];
    }
    // 중개사명: name에서 전화번호/등록번호/주소 등 제거하고 첫 줄만
    let cleanName = (data.realtor.name || '').split(/전화|등록번호|소재지|최근|매매|전세|월세|\d{2,3}-\d{3,4}-\d{4}/)[0].trim();
    cleanName = cleanName.replace(/길찾기.*$/, '').replace(/\s+/g,' ').trim().substring(0, 30);
    const ceoName = data.realtor.ceoName || '';

    if (cleanName || tel) {
      realtorSection = `<div style="margin-top:8px;padding:6px 10px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.18);border-radius:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;color:#60a5fa;font-weight:600">🏢</span>
        ${cleanName ? `<span style="font-size:11px;color:var(--text2)">${cleanName}${ceoName?' · '+ceoName:''}</span>` : ''}
        ${tel ? `<a href="tel:${tel}" style="font-size:11px;color:#60a5fa;text-decoration:none;margin-left:auto">${tel}</a>` : ''}
      </div>`;
    }
  }

  // ── 보안시설 태그 ─────────────────────────────────────────────
  let facilityTags = '';
  if (data.facilities?.length) {
    const items = Array.isArray(data.facilities)
      ? data.facilities
      : Object.entries(data.facilities).filter(([,v]) => v).map(([k]) => k);
    if (items.length) {
      facilityTags = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">`
        + items.map(f => `<span style="padding:2px 7px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:10px;font-size:10px;color:#c4b5fd">${f}</span>`).join('')
        + '</div>';
    }
  }

  // ── 다운로드 버튼 ─────────────────────────────────────────────
  const downloadBtn = `<button id="listingDownloadBtn" style="padding:6px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text2);font-size:12px;cursor:pointer">⬇️ 저장</button>`;

  // ── 면적 상세 (계약/전용 각각) ──────────────────────────────────
  const contractPy = data.area?.contractPyeong || (data.area?.contract ? Math.round(data.area.contract / 3.3058 * 10) / 10 : null);
  const excPy2 = data.area?.exclusivePyeong || (data.area?.exclusive ? Math.round(data.area.exclusive / 3.3058 * 10) / 10 : null);
  const hasExcl = data.area?.exclusive && data.area.exclusive !== data.area.contract;

  let areaSection = '';
  if (data.area?.contract) {
    areaSection = `
      <div class="info-item"><div class="info-label">계약면적</div><div class="info-value">${data.area.contract}㎡ <span style="color:var(--primary-light)">(${contractPy}평)</span></div></div>
      ${hasExcl ? `<div class="info-item"><div class="info-label">전용면적</div><div class="info-value">${data.area.exclusive}㎡ <span style="color:var(--primary-light)">(${excPy2}평)</span></div></div>` : ''}
      ${pyeongPrice ? `<div class="info-item"><div class="info-label">전용 평단가</div><div class="info-value" style="color:var(--orange)">${pyeongPrice.replace(' · 평단 ','')}</div></div>` : ''}`;
  }

  // ── 가격 상세 (매매+보증+월세 모두 표시) ──────────────────────
  let priceBreakdown = '';
  if (data.price?.type === 'sale' && data.price?.amount > 0) {
    const saleMan = Math.round(data.price.amount / 10000);
    priceBreakdown = `<div class="info-item"><div class="info-label">매매가</div><div class="info-value" style="color:var(--secondary);font-weight:700">${fmtMan(saleMan)}</div></div>`;
    if (data.rentPrice?.deposit > 0 || data.rentPrice?.monthly > 0) {
      const rDep = Math.round((data.rentPrice.deposit||0)/10000);
      const rMon = Math.round((data.rentPrice.monthly||0)/10000);
      if (rDep > 0) priceBreakdown += `<div class="info-item"><div class="info-label">임대 보증금</div><div class="info-value" style="color:var(--orange)">${fmtMan(rDep)}</div></div>`;
      if (rMon > 0) priceBreakdown += `<div class="info-item"><div class="info-label">임대 월세</div><div class="info-value" style="color:var(--green)">${fmtMan(rMon)}</div></div>`;
    }
  } else if (data.price?.type === 'monthly') {
    const dep = Math.round((data.price.deposit||0)/10000);
    const mon = Math.round((data.price.monthly||0)/10000);
    // 전세/월세 구분 표시
    if (mon > 0) {
      priceBreakdown = `<div class="info-item"><div class="info-label">보증금</div><div class="info-value" style="color:var(--orange);font-weight:700">${dep > 0 ? fmtMan(dep) : '없음'}</div></div>`;
      priceBreakdown += `<div class="info-item"><div class="info-label">월세</div><div class="info-value" style="color:var(--green);font-weight:700">${fmtMan(mon)}</div></div>`;
    } else if (dep > 0) {
      priceBreakdown = `<div class="info-item"><div class="info-label">전세금</div><div class="info-value" style="color:var(--orange);font-weight:700">${fmtMan(dep)}</div></div>`;
    }
  }

  container.innerHTML = `
    <div class="current-listing">
      <div class="listing-header">
        <span class="listing-type-badge">${tradeType}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <a href="${data.url || '#'}" target="_blank" style="color:var(--text3);font-size:10px;text-decoration:none">🔗 원본</a>
        </div>
      </div>
      <div class="listing-title">${data.buildingName ? data.buildingName + ' · ' : ''}${data.title || data.address || '매물 정보'}</div>
      <div class="listing-price" style="color:${priceColor}">${priceDisplay}</div>
      ${rentInfo}
      <div class="listing-meta">
        ${data.floorInfo ? '<span>🏢 ' + data.floorInfo + '</span>' : ''}
        ${data.direction ? '<span>🧭 ' + data.direction + '</span>' : ''}
        ${data.address ? '<span>📍 ' + data.address + '</span>' : ''}
      </div>
      <div class="info-grid">
        ${priceBreakdown}
        ${areaSection}
        ${extraFields}
      </div>
      ${facilityTags}
      ${data.features ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:8px;">
        <div style="font-size:10px;color:var(--primary-light);font-weight:600;margin-bottom:4px">📝 매물 설명</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.6">${data.features}</div>
      </div>` : ''}
      ${realtorSection}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="save-btn ${isSaved ? 'saved' : ''}" id="saveBtn" style="flex:1">${isSaved ? '✅ 저장됨 (메모장)' : '⭐ 저장 (메모장)'}</button>
        ${downloadBtn}
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px;text-align:center">💡 수익률 분석은 시장분석 → 수익률 탭에서 관리하세요</div>
    </div>
    <button class="scrape-btn">🔄 현재 페이지 정보 다시 가져오기</button>`;

  // 다운로드 버튼 이벤트
  document.getElementById('listingDownloadBtn')?.addEventListener('click', () => downloadListingCSV(data));
  // 이미지/PDF 저장 버튼
  document.getElementById('listingDownloadArea').style.display = 'block';
  document.getElementById('listingImgBtn')?.addEventListener('click', () => exportListingCapture(data, 'png'));
  document.getElementById('listingPdfBtn')?.addEventListener('click', () => exportListingCapture(data, 'pdf'));
  updateSummaryBar();
}

function manualScrape() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.[0]) { showToast('활성 탭을 찾을 수 없습니다'); return; }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_NOW' }, (res) => {
      if (chrome.runtime.lastError) { showToast('페이지를 새로고침 후 다시 시도해주세요'); return; }
      if (res?.data) { currentListing = res.data; renderListing(res.data); autoFillCalc(res.data); showToast('매물 정보를 가져왔습니다!'); }
      else showToast('매물 상세 페이지를 먼저 열어주세요');
    });
  });
}

function autoFillCalc(data) {
  if (!data?.price) return;
  if (data.price.type === 'monthly') {
    setInputVal('c_deposit', Math.round(data.price.deposit / 10000));
    setInputVal('c_monthly', Math.round(data.price.monthly / 10000));
  } else if (data.price.type === 'sale') {
    const pn = Math.round(data.price.amount / 10000);
    setInputVal('c_salePrice', pn);
    if (data.area) {
      setInputVal('s_excArea', data.area.exclusive || data.area.contract);
      const excV = parseFloat(data.area.exclusive || data.area.contract) || 0;
      const pyEl = document.getElementById('s_excArea_py');
      if (pyEl && excV > 0) pyEl.value = (excV / 3.3058).toFixed(2);
    }
    calcSale();
  }
  if (data.manageFee) setInputVal('c_manage', parseInt(data.manageFee.replace(/[^0-9]/g, '')) || 0);
  calcYield();
}
function setInputVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }

// ─────────────────────────────────────────
// 수익계산
// ─────────────────────────────────────────
function calcYield() {
  const sp = parseWon('c_salePrice');
  const dp = parseWon('c_deposit');
  const mo = parseWon('c_monthly');
  const ln = parseWon('c_loan');
  const lr = parseFloat(document.getElementById('c_loanRate').value)||0;
  const mg = parseWon('c_manage');
  if (mo===0&&sp===0){document.getElementById('yieldResults').style.display='none';return;}
  const interest=(ln*lr/100)/12, net=mo-interest-mg, annual=net*12;
  const ri=Math.max(sp-dp-ln,0)||sp, yld=ri>0?(annual/ri)*100:0;
  const yc=yld>=6?'text-green':yld>=4?'orange':'red';
  document.getElementById('r_annualYield').textContent=yld.toFixed(2)+'%';
  document.getElementById('r_annualYield').className='result-value '+yc;
  document.getElementById('r_netMonthly').textContent=fmtMan(Math.round(net));
  document.getElementById('r_netMonthly').className='result-value '+(net>=0?'text-green':'red');
  document.getElementById('r_realInvest').textContent=fmtMan(Math.round(ri));
  document.getElementById('r_annualIncome').textContent=fmtMan(Math.round(annual));

  // 손익분기점 (취득비용 회수 기간)
  const acqCost = sp * 0.046; // 취득세+제비용 4.6% 가정
  const breakEvenMonths = net > 0 ? Math.ceil(acqCost / net) : null;
  const breakEvenStr = breakEvenMonths ? (breakEvenMonths < 12 ? breakEvenMonths+'개월' : Math.ceil(breakEvenMonths/12)+'년 '+((breakEvenMonths%12)||'')+'개월') : '계산불가';

  // 공실 민감도 (1개월 공실 시 수익률 영향)
  const yldNoVacancy = ri > 0 ? (annual / ri * 100) : 0;
  const yldWith1MoVacancy = ri > 0 ? ((annual - mo) / ri * 100) : 0;
  const vacancyImpact = Math.round((yldNoVacancy - yldWith1MoVacancy) * 100) / 100;

  document.getElementById('cashflowBody').innerHTML=[
    {label:'월세 수입',val:mo,cls:'positive'},
    {label:'대출 이자',val:-interest,cls:interest>0?'negative':''},
    {label:'월 관리비',val:-mg,cls:mg>0?'negative':''},
    {label:'월 순수익',val:net,cls:net>=0?'positive':'negative',bold:true},
    {label:'─────────────',val:null},
    {label:'취득비용 추정 (4.6%)',val:Math.round(acqCost),cls:'',gray:true},
    {label:'손익분기점',str:breakEvenStr,cls:'',gray:true},
    {label:'1개월 공실 시 수익률↓',str:'-'+vacancyImpact+'%p',cls:'',gray:true}
  ].filter(r=>r.val!==null||r.str||r.label.startsWith('─'))
   .map(r=> r.label.startsWith('─')
    ? `<tr><td colspan="2" style="color:rgba(255,255,255,0.1);padding:2px 0">────────────────</td></tr>`
    : `<tr><td style="${r.gray?'color:var(--text3)':''}">${r.bold?'<strong>'+r.label+'</strong>':r.label}</td><td style="text-align:right;${r.gray?'color:var(--text3);font-size:10px':''}" class="${r.cls}">${r.str !== undefined ? r.str : (r.val!==0||r.bold?fmtMan(Math.round(r.val)):'-')}</td></tr>`
   ).join('');
  document.getElementById('yieldResults').style.display='block';
}

function calcSale() {
  const price=parseWon('c_salePrice');
  const excArea=parseFloat(document.getElementById('s_excArea').value)||0;
  const taxRate=parseFloat(document.getElementById('s_taxRate').value)||0;
  const etc=parseWon('s_etc');
  if(price===0){document.getElementById('saleResults').style.display='none';return;}
  const ep=excArea/3.3058;
  const epP=ep>0?Math.round(price/ep):0;
  const tax=Math.round(price*taxRate/100), total=price+tax+etc;
  document.getElementById('sr_excPyeong').textContent=fmtMan(epP);
  document.getElementById('sr_excArea_display').textContent= excArea>0 ? excArea.toFixed(1)+'㎡ / '+(excArea/3.3058).toFixed(1)+'평' : '-';
  document.getElementById('sr_tax').textContent=fmtMan(tax);
  document.getElementById('sr_total').textContent=fmtMan(total);
  document.getElementById('saleResults').style.display='block';
  document.getElementById('sb_avgPyeong').textContent=fmtMan(epP);
}

// ─────────────────────────────────────────
// 평당가 탭
// ─────────────────────────────────────────
let floorRowCount = 0;
function initFloorRows() { for(let i=0;i<4;i++) addFloorRow(); }
function addFloorRow() {
  floorRowCount++;
  const frc = floorRowCount;
  const div = document.createElement('div');
  div.className='floor-row'; div.id='fr-'+frc;
  div.style.cssText='display:grid;grid-template-columns:35px 36px 1fr 1fr 1fr 1fr auto;gap:3px;align-items:center;margin-bottom:4px;';
  div.innerHTML=
    '<select style="padding:5px 2px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;outline:none;width:100%"><option value="월세">월세</option><option value="매매">매매</option></select>'+
    '<input type="text" placeholder="층" style="padding:5px 4px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;outline:none;width:100%">'+
    '<input type="number" class="fr-sqm" placeholder="㎡" step="0.1" style="padding:5px 4px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;outline:none;width:100%">'+
    '<input type="number" class="fr-py" placeholder="평" step="0.01" style="padding:5px 4px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--primary-light);font-size:11px;outline:none;width:100%">'+
    '<input type="number" class="fr-price" placeholder="가격(만)" style="padding:5px 4px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;outline:none;width:100%">'+
    '<input type="number" class="fr-pyeong" placeholder="평단" readonly style="padding:5px 4px;background:var(--bg4);border:1px solid var(--border);border-radius:5px;color:var(--orange);font-size:11px;outline:none;width:100%">'+
    '<button style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 2px">✕</button>';
  const sqmEl = div.querySelector('.fr-sqm');
  const pyEl = div.querySelector('.fr-py');
  const priceEl = div.querySelector('.fr-price');
  const pyeongEl = div.querySelector('.fr-pyeong');
  const SQM_PER_PY = 3.3058;
  const calcPyeong = () => {
    const a = parseFloat(sqmEl.value)||0;
    const p = parseFloat(priceEl.value)||0;
    pyeongEl.value = a>0 && p>0 ? Math.round(p/(a/SQM_PER_PY)) : '';
  };
  sqmEl.addEventListener('input', () => {
    const v = parseFloat(sqmEl.value);
    if (!isNaN(v) && v > 0) pyEl.value = (v / SQM_PER_PY).toFixed(2);
    else pyEl.value = '';
    calcPyeong();
  });
  pyEl.addEventListener('input', () => {
    const v = parseFloat(pyEl.value);
    if (!isNaN(v) && v > 0) sqmEl.value = (v * SQM_PER_PY).toFixed(2);
    else sqmEl.value = '';
    calcPyeong();
  });
  priceEl.addEventListener('input', calcPyeong);
  div.querySelector('button').addEventListener('click', () => document.getElementById('fr-'+frc)?.remove());
  document.getElementById('floorRows').appendChild(div);
}
function analyzeFloor() {
  const rows=document.querySelectorAll('#floorRows .floor-row'), data=[];
  rows.forEach(row=>{
    const sel=row.querySelector('select');
    const fi=row.querySelector('input[type="text"]');
    const sqmEl=row.querySelector('.fr-sqm');
    const priceEl=row.querySelector('.fr-price');
    const area=parseFloat(sqmEl?.value)||0, price=parseFloat(priceEl?.value)||0;
    if(area>0&&price>0){const py=area/3.3058; data.push({type:sel?.value||'월세',floor:fi?.value.trim()||'',area,price,pyeong:Math.round(py*10)/10,pyeongPrice:Math.round(price/py)});}
  });
  if(!data.length){showToast('데이터를 입력해주세요');return;}
  const prices=data.map(d=>d.pyeongPrice),minP=Math.min(...prices),maxP=Math.max(...prices),avgP=Math.round(avg(prices));
  document.getElementById('floorSummary').innerHTML=
    '<div class="result-card"><div class="result-label">최솟값</div><div class="result-value" style="color:var(--blue)">'+fmtComma(minP)+'만</div><div class="result-sub">만원/평</div></div>'+
    '<div class="result-card highlight"><div class="result-label">평균</div><div class="result-value">'+fmtComma(avgP)+'만</div><div class="result-sub">만원/평</div></div>'+
    '<div class="result-card"><div class="result-label">최댓값</div><div class="result-value orange">'+fmtComma(maxP)+'만</div><div class="result-sub">만원/평</div></div>'+
    '<div class="result-card"><div class="result-label">매물 수</div><div class="result-value">'+data.length+'건</div></div>';
  document.getElementById('floorTableBody').innerHTML=data.sort((a,b)=>a.pyeongPrice-b.pyeongPrice).map(d=>{
    const color=d.pyeongPrice===minP?'var(--blue)':d.pyeongPrice===maxP?'var(--orange)':'var(--green)';
    return '<tr><td><span style="font-size:10px;padding:1px 5px;background:var(--bg3);border-radius:3px">'+d.type+'</span></td><td>'+(d.floor||'-')+'층</td><td>'+d.area+'㎡<br><span style="color:var(--text3)">'+d.pyeong+'평</span></td><td style="color:'+color+';font-weight:600">'+fmtComma(d.pyeongPrice)+'만</td><td>'+fmtComma(d.price)+'만</td></tr>';
  }).join('');
  document.getElementById('floorAnalysisResult').style.display='block';
  document.getElementById('sb_avgPyeong').textContent=fmtMan(avgP);
}

// ─────────────────────────────────────────
// 저장/메모
// ─────────────────────────────────────────
function saveListing() {
  if(!currentListing) return;
  const listing={...currentListing,savedAt:new Date().toISOString(),calcYield:document.getElementById('r_annualYield')?.textContent||'-',note:''};
  chrome.runtime.sendMessage({type:'SAVE_LISTING',listing},(res)=>{
    if(res?.success){showToast('매물이 저장되었습니다');const btn=document.getElementById('saveBtn');if(btn){btn.textContent='✅ 저장됨';btn.classList.add('saved');}loadSavedListings();}
  });
}
function loadSavedListings() {
  chrome.runtime.sendMessage({type:'GET_LISTINGS'},(res)=>{savedListings=res?.listings||[];renderMemoList();updateSummaryBar();});
}
function renderMemoList() {
  const container = document.getElementById('memoList');
  document.getElementById('memoCount').textContent = savedListings.length;
  if (!savedListings.length) { container.innerHTML = '<div class="empty-memo">📦 저장된 매물이 없습니다.<br>매물정보 탭에서 저장해보세요!</div>'; return; }
  container.innerHTML = savedListings.map((l, idx) => {
    const yn = parseFloat(l.calcYield) || 0, yc = yn >= 6 ? 'good' : yn >= 4 ? 'mid' : yn > 0 ? 'bad' : '';
    const savedDate = l.savedAt ? new Date(l.savedAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';

    // 금액 표시
    let priceStr = '-';
    if (l.price?.type === 'monthly') {
      const depAmt = Math.round((l.price.deposit || 0) / 10000);
      priceStr = (depAmt > 0 ? fmtMan(depAmt) : '보없음') + ' / 월 ' + fmtMan(Math.round(l.price.monthly / 10000));
    } else if (l.price?.type === 'sale') {
      priceStr = fmtMan(Math.round(l.price.amount / 10000));
    } else if (l.priceRaw) {
      priceStr = l.priceRaw;
    }

    return '<div class="memo-card">' +
      '<div class="memo-card-header"><div><div class="memo-price">' + priceStr + '</div><div class="memo-address">' + (l.address || l.title || '주소 정보 없음') + '</div></div>' +
      '<button class="memo-delete" data-id="' + l.id + '">✕</button></div>' +
      '<div class="memo-tags">' +
      (l.floorInfo ? '<span class="memo-tag">🏢 ' + l.floorInfo + '</span>' : '') +
      (l.direction ? '<span class="memo-tag">🧭 ' + l.direction + '</span>' : '') +
      (l.buildingUse ? '<span class="memo-tag">' + l.buildingUse + '</span>' : '') +
      (l.tradeType ? '<span class="memo-tag">' + l.tradeType + '</span>' : '') +
      (savedDate ? '<span class="memo-tag">📅 ' + savedDate + '</span>' : '') +
      '</div>' +
      (yn > 0 ? '<span class="memo-yield ' + yc + '">수익률 ' + l.calcYield + '</span>' : '') +
      '<textarea class="memo-note-input" id="note-' + idx + '" placeholder="메모 (권리금, 인근시세, 특이사항 등)">' + (l.note || '') + '</textarea>' +
      '<button class="memo-save-note" data-id="' + l.id + '" data-idx="' + idx + '">메모 저장</button>' +
      (l.url ? '<a href="' + l.url + '" target="_blank" style="display:inline-block;margin-top:4px;margin-left:8px;font-size:11px;color:var(--primary-light);text-decoration:none">🔗 매물 보기</a>' : '') +
      '</div>';
  }).join('');
}
function saveNote(id,idx){const note=document.getElementById('note-'+idx)?.value||'';const l=savedListings.find(l=>l.id===id);if(l){l.note=note;chrome.runtime.sendMessage({type:'SAVE_LISTING',listing:l},()=>{showToast('메모 저장됨');loadSavedListings();});}}
function deleteListing(id){chrome.runtime.sendMessage({type:'DELETE_LISTING',id},()=>{loadSavedListings();showToast('삭제되었습니다');});}
function clearAllMemo(){if(!confirm('저장된 매물을 모두 삭제하시겠습니까?'))return;chrome.runtime.sendMessage({type:'CLEAR_LISTINGS'},()=>{savedListings=[];renderMemoList();updateSummaryBar();showToast('전체 삭제됨');});}

// ─────────────────────────────────────────
// 매물목록 탭
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 매물목록 탭 - 글자튕김 완전방지 버전
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 매물목록 탭
// ─────────────────────────────────────────
function renderListView() {
  const container = document.getElementById('listviewContent');
  if (!collectedListings.length) {
    container.innerHTML = '<div class="no-listing"><div class="icon">📋</div><p>수집된 매물이 없습니다</p></div>';
    return;
  }
  applyFilters();
  if (!document.getElementById('listingTbody')) {
    _buildListView(container);
  }
  _updateListBody();
}

function _sortIcon(key) {
  if (activeFilters.sortKey !== key) return '<span style="color:var(--text3);font-size:9px;margin-left:2px;">↕</span>';
  return activeFilters.sortDir === 'asc'
    ? '<span style="color:var(--primary-light);font-size:9px;margin-left:2px;">↑</span>'
    : '<span style="color:var(--primary-light);font-size:9px;margin-left:2px;">↓</span>';
}

function _buildListView(container) {
  const f = activeFilters;
  const thS = 'cursor:pointer;user-select:none;white-space:nowrap;padding:6px 5px;';

  function dispVal(v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = parseInt(String(v).replace(/,/g,''));
    return isNaN(n) ? '' : n.toLocaleString('ko-KR');
  }
  function inp(id, val, ph) {
    return '<input id="' + id + '" type="text" inputmode="numeric" placeholder="' + ph + '" value="' + dispVal(val) + '"'
      + ' style="width:100%;box-sizing:border-box;padding:5px 6px;background:var(--bg3);'
      + 'border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;outline:none;">';
  }

  const ftypeBtns = ['all','매매','월세'].map(function(t) {
    const on = f.tradeType === t;
    return '<button class="ftype-btn" data-type="' + t + '"'
      + ' style="flex:1;padding:5px 0;border-radius:6px;border:none;font-size:12px;font-weight:' + (on?700:400) + ';'
      + 'background:' + (on?'var(--primary)':'transparent') + ';color:' + (on?'white':'var(--text2)') + ';cursor:pointer;">'
      + (t==='all'?'전체':t) + '</button>';
  }).join('');

  container.innerHTML =
    // 유형탭 + CSV
    '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">'
    + '<div style="display:flex;flex:1;background:var(--bg3);border-radius:8px;padding:2px;" id="ftypeBtns">'
    + ftypeBtns + '</div>'
    + '<button id="csvDownloadBtn" title="CSV 다운로드"'
    + ' style="padding:5px 9px;background:var(--bg3);border:1px solid var(--border);'
    + 'border-radius:7px;color:var(--text3);font-size:11px;cursor:pointer;flex-shrink:0;">⬇️ CSV</button>'
    + '</div>'

    // 접는 상세필터
    + '<div id="filterPanel" style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden;">'
    + '<div id="filterToggle" style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;cursor:pointer;">'
    + '<span id="filterLabel" style="font-size:11px;font-weight:700;color:var(--text2);">🔍 상세 필터</span>'
    + '<div style="display:flex;gap:8px;align-items:center;">'
    + '<span id="filterCount" style="color:var(--text3);font-size:10px;"></span>'
    + '<span id="filterArrow" style="color:var(--text3);font-size:12px;">' + (f.filterOpen?'▲':'▼') + '</span>'
    + '</div></div>'
    + '<div id="filterBody" style="display:' + (f.filterOpen?'block':'none') + ';padding:0 12px 12px;border-top:1px solid var(--border);">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">'
    + '<div><div style="color:var(--text3);font-size:10px;margin-bottom:3px;">매매가 (만원)</div>'
    + '<div style="display:flex;gap:3px;align-items:center;">' + inp('fSaleMin',f.saleMin,'최소') + '<span style="color:var(--text3);flex-shrink:0;">~</span>' + inp('fSaleMax',f.saleMax,'최대') + '</div></div>'
    + '<div><div style="color:var(--text3);font-size:10px;margin-bottom:3px;">월세 (만원)</div>'
    + '<div style="display:flex;gap:3px;align-items:center;">' + inp('fMonthlyMin',f.monthlyMin,'최소') + '<span style="color:var(--text3);flex-shrink:0;">~</span>' + inp('fMonthlyMax',f.monthlyMax,'최대') + '</div></div>'
    + '<div><div style="color:var(--text3);font-size:10px;margin-bottom:3px;">전용면적 (㎡)</div>'
    + '<div style="display:flex;gap:3px;align-items:center;">' + inp('fAreaMin',f.areaMin,'최소') + '<span style="color:var(--text3);flex-shrink:0;">~</span>' + inp('fAreaMax',f.areaMax,'최대') + '</div></div>'
    + '<div><div style="color:var(--text3);font-size:10px;margin-bottom:3px;">평당가 (만원)</div>'
    + '<div style="display:flex;gap:3px;align-items:center;">' + inp('fPyeongMin',f.pyeongMin,'최소') + '<span style="color:var(--text3);flex-shrink:0;">~</span>' + inp('fPyeongMax',f.pyeongMax,'최대') + '</div></div>'
    + '<div style="grid-column:1/-1;"><div style="color:var(--text3);font-size:10px;margin-bottom:4px;">층 선택 <span style="font-size:9px;">(복수 선택 가능 · 없으면 전체)</span></div>'
    + '<div style="display:flex;gap:3px;flex-wrap:wrap;" id="floorLevelBtns">'
    + ['B','1','2','3','4','5','6','7+'].map(function(k) {
        var on = f.floorLevels && f.floorLevels.has(k);
        var label = k === 'B' ? '지하' : k === '7+' ? '7층+' : k + '층';
        return '<button class="floor-lvl-btn" data-key="' + k + '" style="padding:3px 7px;border-radius:5px;border:1px solid '
          + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'transparent')
          + ';color:' + (on ? 'white' : 'var(--text2)') + ';cursor:pointer;font-size:11px;">' + label + '</button>';
      }).join('')
    + '</div></div>'
    + '</div>'
    + '<button id="filterResetBtn" style="margin-top:8px;width:100%;padding:5px;background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.25);color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:11px;">필터 초기화</button>'
    + '</div></div>'

    // 테이블
    + '<div style="overflow:auto;max-height:calc(100vh - 290px);">'
    + '<table class="listing-table" style="min-width:100%;">'
    + '<thead style="position:sticky;top:0;z-index:10;background:var(--bg2);"><tr>'
    + '<th style="padding:6px 5px;">유형</th>'
    + '<th data-sort="price" style="' + thS + '">매매가' + _sortIcon('price') + '</th>'
    + '<th data-sort="monthly" style="' + thS + '">월세' + _sortIcon('monthly') + '</th>'
    + '<th data-sort="area" style="' + thS + '">면적' + _sortIcon('area') + '</th>'
    + '<th data-sort="pyeong" style="' + thS + '">평당가' + _sortIcon('pyeong') + '</th>'
    + '<th data-sort="floor" style="' + thS + '">층' + _sortIcon('floor') + '</th>'
    + '<th></th>'
    + '</tr></thead>'
    + '<tbody id="listingTbody"></tbody>'
    + '</table></div>';

  // 필터 토글
  document.getElementById('filterToggle').addEventListener('click', function() {
    activeFilters.filterOpen = !activeFilters.filterOpen;
    document.getElementById('filterBody').style.display = activeFilters.filterOpen ? 'block' : 'none';
    document.getElementById('filterArrow').textContent = activeFilters.filterOpen ? '▲' : '▼';
  });

  // 유형 버튼
  container.querySelectorAll('.ftype-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      activeFilters.tradeType = btn.dataset.type;
      container.querySelectorAll('.ftype-btn').forEach(function(b) {
        const on = b.dataset.type === btn.dataset.type;
        b.style.background = on ? 'var(--primary)' : 'transparent';
        b.style.color = on ? 'white' : 'var(--text2)';
        b.style.fontWeight = on ? '700' : '400';
      });
      applyFilters(); _updateListBody(); renderMarket(collectedListings);
    });
  });

  // 헤더 정렬
  container.querySelectorAll('th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      const key = th.dataset.sort;
      activeFilters.sortDir = activeFilters.sortKey === key ? (activeFilters.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      activeFilters.sortKey = key;
      container.querySelectorAll('th[data-sort]').forEach(function(t) {
        const sp = t.querySelector('span');
        if (!sp) return;
        if (activeFilters.sortKey !== t.dataset.sort) { sp.style.color='var(--text3)'; sp.textContent='↕'; }
        else { sp.style.color='var(--primary-light)'; sp.textContent = activeFilters.sortDir==='asc'?'↑':'↓'; }
      });
      applyFilters(); _updateListBody(); renderMarket(collectedListings);
    });
  });

  // 숫자 입력 - 글자 튕김 완전 방지 (innerHTML 절대 안 건드림)
  var numTimer = null;
  var numFields = [
    ['fSaleMin','saleMin'],['fSaleMax','saleMax'],
    ['fMonthlyMin','monthlyMin'],['fMonthlyMax','monthlyMax'],
    ['fAreaMin','areaMin'],['fAreaMax','areaMax'],
    ['fPyeongMin','pyeongMin'],['fPyeongMax','pyeongMax']
  ];
  numFields.forEach(function(pair) {
    var id = pair[0], key = pair[1];
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      // 만원 단위 저장
      activeFilters[key] = raw ? parseInt(raw) : '';
      // 콤마 포맷 + 커서 유지
      var pos = this.selectionStart;
      var oldLen = this.value.length;
      var formatted = raw ? parseInt(raw).toLocaleString('ko-KR') : '';
      this.value = formatted;
      var newPos = Math.max(0, pos + (formatted.length - oldLen));
      try { this.setSelectionRange(newPos, newPos); } catch(e) {}
      clearTimeout(numTimer);
      numTimer = setTimeout(function() { applyFilters(); _updateListBody(); renderMarket(collectedListings); }, 300);
    });
  });

  // 층 버튼 토글
  container.querySelectorAll('.floor-lvl-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var key = btn.dataset.key;
      if (!activeFilters.floorLevels) activeFilters.floorLevels = new Set();
      // DOM 상태를 기준으로 판단 (Set과 동기화 문제 방지)
      var isOn = btn.style.background === 'var(--primary)' || btn.style.background.includes('rgb(124');
      if (isOn) {
        activeFilters.floorLevels.delete(key);
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text2)';
        btn.style.borderColor = 'var(--border)';
      } else {
        activeFilters.floorLevels.add(key);
        btn.style.background = 'var(--primary)';
        btn.style.color = 'white';
        btn.style.borderColor = 'var(--primary)';
      }
      applyFilters(); _updateListBody(); renderMarket(collectedListings);
    });
  });

  // 필터 초기화
  document.getElementById('filterResetBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    // 누른 효과
    this.style.background = 'rgba(255,100,100,0.3)';
    var self = this;
    setTimeout(function() { self.style.background = 'rgba(255,100,100,0.1)'; }, 200);

    var deletedIds = activeFilters.deletedIds, filterOpen = activeFilters.filterOpen;
    activeFilters = { tradeType:'all', saleMin:'', saleMax:'', monthlyMin:'', monthlyMax:'',
      areaMin:'', areaMax:'', pyeongMin:'', pyeongMax:'', floorText:'',
      sortKey:'default', sortDir:'asc', filterOpen:filterOpen, deletedIds:deletedIds, floorLevels:new Set() };
    numFields.forEach(function(pair) { var el=document.getElementById(pair[0]); if(el) el.value=''; });
    // 층 버튼 초기화
    container.querySelectorAll('.floor-lvl-btn').forEach(function(b) {
      b.style.background = 'transparent';
      b.style.color = 'var(--text2)';
      b.style.borderColor = 'var(--border)';
    });
    // 유형 버튼 초기화
    container.querySelectorAll('.ftype-btn').forEach(function(b) {
      var on = b.dataset.type === 'all';
      b.style.background = on ? 'var(--primary)' : 'transparent';
      b.style.color = on ? 'white' : 'var(--text2)';
      b.style.fontWeight = on ? '700' : '400';
    });
    applyFilters(); _updateListBody(); renderMarket(collectedListings);
  });

  document.getElementById('csvDownloadBtn').addEventListener('click', downloadCSV);
}

function _updateListBody() {
  var tbody = document.getElementById('listingTbody');
  var countEl = document.getElementById('filterCount');
  var f = activeFilters;
  var del = f.deletedIds.size;

  if (countEl) {
    countEl.innerHTML = '표시 <b style="color:var(--primary-light)">' + filteredListings.length + '</b>/'
      + (collectedListings.length - del) + '건' + (del > 0 ? ' <span style="color:#ff6b6b;">🗑️' + del + '</span>' : '');
  }
  var lbl = document.getElementById('filterLabel');
  var hasF = f.tradeType!=='all'||f.saleMin!==''||f.saleMax!==''||f.monthlyMin!==''||f.monthlyMax!==''
    ||f.areaMin!==''||f.areaMax!==''||f.pyeongMin!==''||f.pyeongMax!==''||f.floorText;
  if (lbl) { lbl.style.color = hasF ? 'var(--primary-light)' : 'var(--text2)';
    lbl.textContent = hasF ? '🔍 상세 필터 ● 적용중' : '🔍 상세 필터'; }

  if (!tbody) return;

  tbody.innerHTML = filteredListings.map(function(l) {
    var isSale = l.price && l.price.type === 'sale';
    var badge = isSale
      ? '<span class="type-badge-sale">매매</span>'
      : '<span class="type-badge-monthly">월세</span>';

    // 매매가 컬럼
    var saleCell = '-';
    if (isSale && l.price.amount > 0) {
      saleCell = '<span style="color:var(--blue);font-weight:600;">' + fmtMan(Math.round(l.price.amount/10000)) + '</span>';
    }

    // 월세 컬럼
    var monthlyCell = '-';
    if (!isSale && l.price && l.price.monthly > 0) {
      var dep = Math.round((l.price.deposit||0)/10000);
      var mon = Math.round(l.price.monthly/10000);
      monthlyCell = '<span style="color:var(--green);font-weight:600;">' + fmtMan(mon) + '</span>'
        + (dep > 0 ? '<br><span style="color:var(--text3);font-size:10px;">보' + fmtMan(dep) + '</span>' : '');
    }

    // 면적
    var excM2 = (l.area && (l.area.exclusive || l.area.contract)) || '-';
    var excPy = (l.area && (l.area.exclusivePyeong || l.area.contractPyeong)) || '-';
    var areaCell = excM2 !== '-' ? excM2+'㎡<br><span style="color:var(--text3);font-size:10px;">'+excPy+'평</span>' : '-';

    // 평당가
    var pyeongCell = '-';
    var py = l.area && (l.area.exclusivePyeong || l.area.contractPyeong);
    if (py > 0) {
      if (isSale && l.price.amount > 0) {
        pyeongCell = '<span style="color:var(--orange);">' + fmtMan(Math.round(l.price.amount/10000/py)) + '</span>';
      } else if (!isSale && l.price && l.price.monthly > 0) {
        var rp = Math.round(l.price.monthly/10000/py*10)/10;
        pyeongCell = '<span style="color:var(--green);">' + fmtComma1(rp) + '만</span>';
      }
    }

    var floorCell = l.floorInfo || '-';
    var url = l.url || (l.id && !String(l.id).startsWith('anon_') ? 'https://new.land.naver.com/offices?articleNo='+l.id : null);
    return '<tr data-url="'+(url||'')+'" data-lid="'+(l.id||'')+'" style="'+(url?'cursor:pointer;':'')+'">'
      +'<td>'+badge+'</td>'
      +'<td>'+saleCell+'</td>'
      +'<td>'+monthlyCell+'</td>'
      +'<td>'+areaCell+'</td>'
      +'<td>'+pyeongCell+'</td>'
      +'<td style="color:var(--text2);">'+floorCell+'</td>'
      +'<td><button class="del-row-btn" data-lid="'+(l.id||'')+'" style="background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.3);color:#ff6b6b;border-radius:4px;padding:1px 5px;cursor:pointer;font-size:10px;">✕</button></td>'
      +'</tr>';
  }).join('');

  tbody.querySelectorAll('.del-row-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var lid = btn.dataset.lid;
      if (lid) {
        activeFilters.deletedIds.add(lid);
        applyFilters();
        _updateListBody();
        // 요약/차트 실시간 반영
        renderMarket(collectedListings);
      }
    });
  });
  tbody.querySelectorAll('tr[data-url]').forEach(function(tr) {
    if (tr.dataset.url) tr.addEventListener('click', function(e) {
      if (e.target.classList.contains('del-row-btn')) return;
      window.open(tr.dataset.url, '_blank');
    });
  });
}

function updateListTableAndCount() { _updateListBody(); }

function downloadCSV() {
  var headers = ['유형','매매가(만)','보증금(만)','월세(만)','전용면적(㎡)','전용면적(평)','평당가(만)','층','링크'];
  var rows = collectedListings.map(function(l) {
    var isSale = l.price && l.price.type === 'sale';
    var excPy = (l.area && (l.area.exclusivePyeong || l.area.contractPyeong)) || '';
    var pp = '';
    if (excPy > 0) {
      if (isSale && l.price.amount > 0) pp = Math.round(l.price.amount/10000/excPy);
      else if (!isSale && l.price && l.price.monthly > 0) pp = Math.round(l.price.monthly/10000/excPy*10)/10;
    }
    var url = l.url || (l.id && !String(l.id).startsWith('anon_') ? 'https://new.land.naver.com/offices?articleNo='+l.id : '');
    return [
      isSale?'매매':'월세',
      isSale ? Math.round(l.price.amount/10000) : '',
      !isSale ? Math.round((l.price&&l.price.deposit||0)/10000) : '',
      !isSale ? Math.round((l.price&&l.price.monthly||0)/10000) : '',
      (l.area&&(l.area.exclusive||l.area.contract))||'',
      excPy, pp, l.floorInfo||'', url
    ];
  });
  var csv = [headers].concat(rows).map(function(r) {
    return r.map(function(v) { return '"'+String(v).replace(/"/g,'""')+'"'; }).join(',');
  }).join('\n');
  var blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '상가매물목록_'+new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','')+ '.csv';
  a.click();
}


// ═══════════════════════════════════════════════════════
// ⚖️ 매물 비교 탭
// ═══════════════════════════════════════════════════════
let compareListings = [null, null, null];

function addToCompare(listing) {
  if (!listing) return;
  const empty = compareListings.findIndex(v => v === null);
  if (empty === -1) { showToast('비교 슬롯이 가득 찼습니다 (최대 3개)'); return; }
  compareListings[empty] = listing;
  showToast('비교에 추가됨');
  switchTab('compare');
  renderCompareTab();
}
function removeFromCompare(slot) {
  compareListings[slot] = null;
  renderCompareTab();
}
function clearCompare() {
  compareListings = [null, null, null];
  renderCompareTab();
}
function openComparePicker(slot) {
  // 저장 매물 + 수집 매물 통합 목록 팝업
  const all = [...savedListings, ...collectedListings.filter(l => !savedListings.some(s => s.id === l.id))];
  if (!all.length) { showToast('저장하거나 수집된 매물이 없습니다'); return; }
  const old = document.getElementById('comparePickerModal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'comparePickerModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:flex-end;';
  const inner = document.createElement('div');
  inner.style.cssText = 'background:var(--bg2);width:100%;max-height:60vh;overflow-y:auto;border-radius:12px 12px 0 0;padding:12px;';
  inner.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">매물 선택 (슬롯 ${slot+1})</div>`
    + all.map((l, i) => {
      let ps = '-';
      if (l.price?.type === 'monthly') ps = (l.price.deposit>0?fmtMan(Math.round(l.price.deposit/10000)):'보없음')+'/월'+fmtMan(Math.round(l.price.monthly/10000));
      else if (l.price?.type === 'sale') ps = fmtMan(Math.round(l.price.amount/10000));
      return `<div class="compare-pick-item" data-idx="${i}" style="padding:8px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:12px;font-weight:600;color:var(--text)">${ps}</div>
        <div style="font-size:10px;color:var(--text3)">${l.floorInfo||''} ${l.area?.exclusivePyeong||l.area?.contractPyeong||''}평 ${l.tradeType||''}</div></div>
        <span style="color:var(--primary-light);font-size:11px">선택 →</span></div>`;
    }).join('');
  modal.appendChild(inner);
  modal.addEventListener('click', e => {
    const item = e.target.closest('.compare-pick-item');
    if (item) {
      compareListings[slot] = all[parseInt(item.dataset.idx)];
      modal.remove();
      renderCompareTab();
    }
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}

function renderCompareTab() {
  const slotsEl = document.getElementById('compareSlots');
  const resultEl = document.getElementById('compareResult');
  if (!slotsEl) return;

  // 슬롯 렌더
  slotsEl.innerHTML = compareListings.map((l, i) => {
    if (!l) return `<div class="compare-slot" data-slot="${i}" style="background:var(--bg2);border:1px dashed var(--border);border-radius:10px;padding:16px;text-align:center">
      <div style="color:var(--text3);font-size:11px;margin-bottom:8px">슬롯 ${i+1}</div>
      <button class="compare-add-btn" data-slot="${i}" style="padding:5px 14px;background:var(--primary);border:none;border-radius:6px;color:white;font-size:11px;cursor:pointer">+ 매물 추가</button>
    </div>`;
    let ps = '-';
    if (l.price?.type === 'monthly') ps = (l.price.deposit>0?fmtMan(Math.round(l.price.deposit/10000)):'보없음')+' / 월 '+fmtMan(Math.round(l.price.monthly/10000));
    else if (l.price?.type === 'sale') ps = fmtMan(Math.round(l.price.amount/10000));
    const py = getExclusivePyeong(l);
    const pp = py > 0 && l.price?.type === 'sale' ? Math.round(l.price.amount/10000/py) : 0;
    return `<div class="compare-slot" data-slot="${i}" style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px;position:relative">
      <button class="compare-remove" data-slot="${i}" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px">✕</button>
      <div style="font-size:10px;color:var(--primary-light);font-weight:600;margin-bottom:4px">${l.tradeType||''} · 슬롯 ${i+1}</div>
      <div style="font-size:15px;font-weight:700;color:var(--secondary)">${ps}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${l.floorInfo||''} ${py?py+'평(전용)':''} ${l.direction||''}</div>
      ${pp>0?`<div style="font-size:10px;color:var(--orange)">평당 ${fmtMan(pp)}</div>`:''}
    </div>`;
  }).join('');

  // 비교 결과 테이블
  const filled = compareListings.filter(Boolean);
  if (filled.length < 2) { resultEl.innerHTML = ''; return; }

  const fields = [
    { label: '거래유형', fn: l => l.tradeType || '-' },
    { label: '매매가', fn: l => l.price?.type==='sale' ? fmtMan(Math.round(l.price.amount/10000)) : '-' },
    { label: '월세', fn: l => l.price?.monthly>0 ? fmtMan(Math.round(l.price.monthly/10000)) : '-' },
    { label: '보증금', fn: l => l.price?.deposit>0 ? fmtMan(Math.round(l.price.deposit/10000)) : '-' },
    { label: '전용면적', fn: l => l.area?.exclusive ? l.area.exclusive+'㎡ ('+l.area.exclusivePyeong+'평)' : '-' },
    { label: '계약면적', fn: l => l.area?.contract ? l.area.contract+'㎡ ('+l.area.contractPyeong+'평)' : '-' },
    { label: '층', fn: l => l.floorInfo || '-' },
    { label: '방향', fn: l => l.direction || '-' },
    { label: '관리비', fn: l => l.manageFee || '-' },
    { label: '전용평당가', fn: l => { const py=getExclusivePyeong(l); return (py>0&&l.price?.type==='sale') ? fmtMan(Math.round(l.price.amount/10000/py))+'만/평' : '-'; } },
    { label: '임대평당가', fn: l => { const py=getExclusivePyeong(l); return (py>0&&l.price?.monthly>0) ? fmtComma1(Math.round(l.price.monthly/10000/py*10)/10)+'만/평' : '-'; } },
    { label: '수익률', fn: l => {
      if (l.price?.type !== 'sale' || !l.price?.amount || !(l.rentPrice?.monthly > 0)) return '-';
      const yr = Math.round(l.rentPrice.monthly*12/l.price.amount*1000)/10;
      return `<span style="color:${yr>=6?'var(--green)':yr>=4?'var(--orange)':'var(--text3)'};font-weight:700">${yr}%</span>`;
    }},
    { label: '사용승인일', fn: l => l.approvalDate || '-' },
    { label: '매물번호', fn: l => l.articleNo || l.listingNo || (l.id&&!String(l.id).startsWith('anon_')?l.id:'-') },
  ];

  const tbody = fields.map(f => {
    const cells = compareListings.map((l, i) => l ? `<td style="padding:5px 6px;text-align:center;font-size:11px">${f.fn(l)}</td>` : `<td style="padding:5px 6px;color:var(--text3);text-align:center">-</td>`).join('');
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)"><td style="padding:5px 6px;font-size:10px;color:var(--text3);white-space:nowrap;font-weight:600">${f.label}</td>${cells}</tr>`;
  }).join('');

  const header = compareListings.map((l, i) => l
    ? `<th style="padding:6px;font-size:11px;color:var(--primary-light);text-align:center">슬롯 ${i+1}</th>`
    : `<th style="padding:6px;font-size:11px;color:var(--text3);text-align:center">-</th>`).join('');

  resultEl.innerHTML = `
  <div class="calc-section">
    <div class="calc-title">⚖️ 비교 결과</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="border-bottom:1px solid var(--border);background:var(--bg3)">
          <th style="padding:6px;font-size:10px;color:var(--text3);text-align:left">항목</th>${header}
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════
// 🏦 대출 상환 스케줄
// ═══════════════════════════════════════════════════════
let loanType = 'equal'; // equal / principal / interest
function setLoanType(t) {
  loanType = t;
  ['loanTypeEqual','loanTypePrincipal','loanTypeInterest'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  const map = { equal:'loanTypeEqual', principal:'loanTypePrincipal', interest:'loanTypeInterest' };
  document.getElementById(map[t])?.classList.add('active');
}

function calcLoanSchedule() {
  const amt   = parseWon('l_amount');
  const rate  = parseFloat(document.getElementById('l_rate')?.value) || 0;
  const years = parseInt(document.getElementById('l_years')?.value) || 0;
  const res   = document.getElementById('loanResults');
  if (!amt || !rate || !years) { if (res) res.style.display = 'none'; return; }

  const months   = years * 12;
  const mr       = rate / 100 / 12;
  const amtWon   = amt * 10000; // 만원→원

  let schedule = [];
  let totalInterest = 0;

  if (loanType === 'equal') {
    // 원리금균등
    const mp = amtWon * mr * Math.pow(1+mr, months) / (Math.pow(1+mr, months) - 1);
    let balance = amtWon;
    for (let m = 1; m <= months; m++) {
      const interest = balance * mr;
      const principal = mp - interest;
      balance -= principal;
      totalInterest += interest;
      schedule.push({ month: m, payment: mp, principal, interest, balance: Math.max(0, balance) });
    }
  } else if (loanType === 'principal') {
    // 원금균등
    const monthlyPrincipal = amtWon / months;
    let balance = amtWon;
    for (let m = 1; m <= months; m++) {
      const interest = balance * mr;
      const payment  = monthlyPrincipal + interest;
      balance -= monthlyPrincipal;
      totalInterest += interest;
      schedule.push({ month: m, payment, principal: monthlyPrincipal, interest, balance: Math.max(0, balance) });
    }
  } else {
    // 만기일시
    const monthlyInterest = amtWon * mr;
    totalInterest = monthlyInterest * months;
    for (let m = 1; m <= months; m++) {
      const isPrincipal = m === months;
      schedule.push({ month: m, payment: isPrincipal ? amtWon + monthlyInterest : monthlyInterest,
        principal: isPrincipal ? amtWon : 0, interest: monthlyInterest, balance: isPrincipal ? 0 : amtWon });
    }
  }

  // 연도별 요약
  const yearSummary = [];
  for (let y = 0; y < years; y++) {
    const ms = schedule.slice(y*12, (y+1)*12);
    const yPay  = ms.reduce((s, m) => s + m.payment, 0);
    const yPrin = ms.reduce((s, m) => s + m.principal, 0);
    const yInt  = ms.reduce((s, m) => s + m.interest, 0);
    const endBal = ms[ms.length-1].balance;
    yearSummary.push({ year: y+1, payment: yPay, principal: yPrin, interest: yInt, balance: endBal });
  }

  const firstPayment = Math.round(schedule[0].payment / 10000);
  const lastPayment  = Math.round(schedule[schedule.length-1].payment / 10000);
  const totalRepay   = Math.round((amtWon + totalInterest) / 10000);

  const summaryHTML = `<div class="result-grid">
    <div class="result-card highlight"><div class="result-label">첫달 납입금</div><div class="result-value">${fmtMan(firstPayment)}</div></div>
    <div class="result-card"><div class="result-label">총 이자</div><div class="result-value red">${fmtMan(Math.round(totalInterest/10000))}</div></div>
    <div class="result-card"><div class="result-label">총 상환액</div><div class="result-value orange">${fmtMan(totalRepay)}</div></div>
    <div class="result-card"><div class="result-label">이자/원금 비율</div><div class="result-value" style="font-size:13px">${Math.round(totalInterest/amtWon*1000)/10}%</div></div>
  </div>`;

  const scheduleRows = yearSummary.map(y => `<tr>
    <td>${y.year}년차</td>
    <td style="text-align:right">${fmtMan(Math.round(y.payment/10000/12))}</td>
    <td style="text-align:right;color:var(--blue)">${fmtMan(Math.round(y.principal/10000))}</td>
    <td style="text-align:right;color:var(--red)">${fmtMan(Math.round(y.interest/10000))}</td>
    <td style="text-align:right;color:var(--text3)">${fmtMan(Math.round(y.balance/10000))}</td>
  </tr>`).join('');

  document.getElementById('loanSummary').innerHTML = summaryHTML;
  document.getElementById('loanScheduleBody').innerHTML = scheduleRows;
  if (res) res.style.display = 'block';
}

// ═══════════════════════════════════════════════════════
// 📋 세금 계산
// ═══════════════════════════════════════════════════════
function calcTaxAcquire() {
  const price = parseWon('tax_acq_price');
  const rate  = parseFloat(document.getElementById('tax_acq_type')?.value) || 4.6;
  const res   = document.getElementById('taxAcqResult');
  if (!price || !res) return;
  const tax = Math.round(price * rate / 100);
  const edu = Math.round(price * 0.2 / 100); // 교육세 (취득세의 20% 단순계산)
  const total = tax + edu;
  res.style.display = 'block';
  res.innerHTML = `<div class="result-grid">
    <div class="result-card highlight"><div class="result-label">취득세 (${rate}%)</div><div class="result-value">${fmtMan(tax)}</div></div>
    <div class="result-card"><div class="result-label">교육세 (취득세×20%)</div><div class="result-value">${fmtMan(edu)}</div></div>
    <div class="result-card"><div class="result-label">합계</div><div class="result-value orange">${fmtMan(total)}</div></div>
    <div class="result-card"><div class="result-label">총 취득비용</div><div class="result-value red">${fmtMan(price+total)}</div></div>
  </div><div style="font-size:10px;color:var(--text3);margin-top:4px">* 농어촌특별세 등 제외 단순 계산</div>`;
}

function calcTaxHold() {
  const price = parseWon('tax_hold_price');
  const ratio = parseFloat(document.getElementById('tax_hold_ratio')?.value) || 70;
  const res   = document.getElementById('taxHoldResult');
  if (!price || !res) return;
  const base     = Math.round(price * ratio / 100); // 과세표준
  // 재산세율 (상가 기준 0.25%)
  const propTax  = Math.round(base * 0.0025 * 10000) / 10000 * 10000; // 만원 단위
  const cityTax  = Math.round(propTax * 0.14 / 100 * 10000) / 10000 * 10000; // 도시계획세 (재산세의 14%)
  const fireTax  = 2000; // 지방교육세 (고정 2만원 기준 단순화)
  const total    = Math.round((propTax + cityTax + fireTax) / 10000);
  res.style.display = 'block';
  res.innerHTML = `<div class="result-grid">
    <div class="result-card"><div class="result-label">과세표준 (${ratio}%)</div><div class="result-value" style="font-size:12px">${fmtMan(base)}</div></div>
    <div class="result-card highlight"><div class="result-label">재산세 (0.25%)</div><div class="result-value">${fmtMan(Math.round(propTax/10000))}</div></div>
    <div class="result-card"><div class="result-label">도시계획세</div><div class="result-value">${fmtMan(Math.round(cityTax/10000))}</div></div>
    <div class="result-card"><div class="result-label">연간 보유세</div><div class="result-value orange">${fmtMan(total)}</div></div>
  </div><div style="font-size:10px;color:var(--text3);margin-top:4px">* 상가 기준 단순 추정 / 실제 세액은 세무사 확인 필요</div>`;
}

function calcTaxTransfer(taxType = 'personal') {
  const buy     = parseWon('tax_tr_buy');
  const sell    = parseWon('tax_tr_sell');
  const years   = parseFloat(document.getElementById('tax_tr_years')?.value) || 0;
  const deduct  = parseWon('tax_tr_deduct') || 250;
  const res     = document.getElementById('taxTrResult');
  if (!buy || !sell || !res) { if(res) res.style.display='none'; return; }
  const gain    = sell - buy;
  if (gain <= 0) { res.style.display='block'; res.innerHTML=`<div style="color:var(--text3);font-size:12px;padding:8px">양도차익 없음 (손실: ${fmtMan(Math.abs(gain))}만)</div>`; return; }

  const longTermDeductRate = Math.min(Math.floor(years) * 2, 30) / 100;
  const longTermDeduct = years >= 2 ? Math.round(gain * longTermDeductRate) : 0;
  const taxableGain = Math.max(gain - longTermDeduct - deduct, 0);

  let tax = 0, taxLabel = '', note = '';

  if (taxType === 'corp') {
    // 법인세 (9~24%)
    const corpBrackets = [[20000, 9], [200000, 19], [300000, 21], [Infinity, 24]];
    let prev = 0, remaining = taxableGain;
    for (const [limit, rate] of corpBrackets) {
      const chunk = Math.min(remaining, limit - prev);
      tax += chunk * rate / 100;
      remaining -= chunk; prev = limit;
      if (remaining <= 0) break;
    }
    taxLabel = '법인세'; note = '법인세율(9~24%) 적용 · 지방소득세(10%) 별도';
    const localTax = Math.round(tax * 0.1);
    const total = Math.round(tax + localTax);
    res.style.display = 'block';
    res.innerHTML = renderTaxTrResult(gain, longTermDeduct, taxableGain, tax, localTax, total, buy, sell, deduct, years, taxLabel, note);
  } else {
    // 개인/개인사업자: 종합소득세 누진 (개인사업자는 사업소득으로 합산)
    const brackets = [
      [1400, 6], [5000, 15], [8800, 24], [15000, 35],
      [30000, 38], [50000, 40], [100000, 42], [Infinity, 45]
    ];
    let prev = 0, remaining = taxableGain;
    for (const [limit, rate] of brackets) {
      const chunk = Math.min(remaining, limit - prev);
      tax += chunk * rate / 100;
      remaining -= chunk; prev = limit;
      if (remaining <= 0) break;
    }
    taxLabel = taxType === 'business' ? '양도소득세(사업소득)' : '양도소득세';
    note = taxType === 'business' ? '개인사업자: 사업소득 합산 종합과세 · 부가세 신고 주의' : '지방소득세(10%) 포함';
    const localTax = Math.round(tax * 0.1);
    const total = Math.round(tax + localTax);
    res.style.display = 'block';
    res.innerHTML = renderTaxTrResult(gain, longTermDeduct, taxableGain, tax, localTax, total, buy, sell, deduct, years, taxLabel, note);
  }
}

function renderTaxTrResult(gain, longDeduct, taxable, tax, localTax, total, buy, sell, deduct, years, taxLabel, note) {
  return `<div class="result-grid">
    <div class="result-card"><div class="result-label">양도차익</div><div class="result-value" style="color:var(--green)">${fmtMan(gain)}</div></div>
    <div class="result-card"><div class="result-label">장기보유공제 (${years>=2?years+'년×2%':'-'})</div><div class="result-value" style="font-size:12px">${fmtMan(longDeduct)}</div></div>
    <div class="result-card"><div class="result-label">과세표준</div><div class="result-value orange">${fmtMan(taxable)}</div></div>
    <div class="result-card highlight"><div class="result-label">${taxLabel}+지방세</div><div class="result-value red">${fmtMan(total)}</div></div>
  </div>
  <table class="cashflow-table" style="margin-top:8px"><tbody>
    <tr><td>실수령액</td><td style="text-align:right;color:var(--green);font-weight:700">${fmtMan(sell - total)}</td></tr>
    <tr><td>세후 수익률</td><td style="text-align:right;color:var(--primary-light);font-weight:700">${Math.round((gain-total)/buy*1000)/10}%</td></tr>
  </tbody></table>
  <div style="font-size:10px;color:var(--text3);margin-top:4px">* 기본공제 ${deduct}만원 · ${note} · 단순 추정, 세무사 확인 필요</div>`;
}

// 임대소득세 (유형별)
function calcTaxIncome(taxType = 'personal') {
  const revenue = parseWon('tax_inc_revenue');
  const expense = parseWon('tax_inc_expense');
  const deduct  = parseWon('tax_inc_deduct');
  const other   = parseWon('tax_inc_other');
  const res     = document.getElementById('taxIncResult');
  if (!revenue || !res) { if(res) res.style.display='none'; return; }

  const noi = revenue - expense;
  const taxableBase = Math.max(noi + other - deduct, 0);
  let tax = 0, taxLabel = '', note = '';

  if (taxType === 'corp') {
    // 법인세
    const corpBrackets = [[20000, 9], [200000, 19], [300000, 21], [Infinity, 24]];
    let prev = 0, remaining = taxableBase;
    for (const [limit, rate] of corpBrackets) {
      const chunk = Math.min(remaining, limit - prev);
      tax += chunk * rate / 100;
      remaining -= chunk; prev = limit;
      if (remaining <= 0) break;
    }
    taxLabel = '법인세 (9~24%)';
    note = '법인: 법인세율 적용 · 배당소득세 별도';
  } else {
    // 개인/개인사업자: 종합소득세
    const brackets = [
      [1400, 6], [5000, 15], [8800, 24], [15000, 35],
      [30000, 38], [50000, 40], [100000, 42], [Infinity, 45]
    ];
    let prev = 0, remaining = taxableBase;
    for (const [limit, rate] of brackets) {
      const chunk = Math.min(remaining, limit - prev);
      tax += chunk * rate / 100;
      remaining -= chunk; prev = limit;
      if (remaining <= 0) break;
    }
    taxLabel = '종합소득세 (6~45%)';
    note = taxType === 'business' ? '개인사업자: 경비 처리 폭 넓음 · 부가세 신고 주의' : '개인: 2천만원 초과시 종합과세';
  }

  const localTax = Math.round(tax * 0.1);
  const total = Math.round(tax + localTax);
  const afterTax = noi - total;

  res.style.display = 'block';
  res.innerHTML = `<div class="result-grid">
    <div class="result-card"><div class="result-label">연 임대수입</div><div class="result-value">${fmtMan(revenue)}</div></div>
    <div class="result-card"><div class="result-label">필요경비 차감</div><div class="result-value" style="font-size:12px">${fmtMan(noi)}</div></div>
    <div class="result-card"><div class="result-label">과세표준</div><div class="result-value orange">${fmtMan(taxableBase)}</div></div>
    <div class="result-card highlight"><div class="result-label">${taxLabel}</div><div class="result-value red">${fmtMan(total)}</div></div>
  </div>
  <table class="cashflow-table" style="margin-top:8px"><tbody>
    <tr><td>세후 순수익</td><td style="text-align:right;color:var(--green);font-weight:700">${fmtMan(afterTax)}</td></tr>
    <tr><td>실효세율</td><td style="text-align:right;color:var(--primary-light);font-weight:700">${revenue > 0 ? (total/revenue*100).toFixed(1) : 0}%</td></tr>
  </tbody></table>
  <div style="font-size:10px;color:var(--text3);margin-top:4px">* ${note} · 단순 추정, 세무사 확인 필요</div>`;
}

// 세금 유형 변경 시 UI 업데이트
function updateTaxTypeUI(taxType) {
  const guide = {
    personal:  { income: '개인: 종합소득세 누진세율(6~45%) / 2천만원 이하 분리과세 선택 가능', transfer: '개인: 양도소득세(6~45%) + 지방소득세(10%)' },
    business:  { income: '개인사업자: 종합소득세 합산 과세 / 필요경비 폭 넓음 / 부가세 신고', transfer: '개인사업자: 양도차익 사업소득 합산 / 부가세 주의' },
    corp:      { income: '법인: 법인세(9~24%) / 임대수익 법인 귀속 / 배당시 추가 과세', transfer: '법인: 양도차익 법인세 과세 / 개인 대비 절세 검토 필요' }
  };
  const g = guide[taxType] || guide.personal;
  const incGuide = document.getElementById('tax_income_guide');
  const trGuide = document.getElementById('tax_tr_guide');
  if (incGuide) incGuide.textContent = g.income;
  if (trGuide) trGuide.textContent = g.transfer;
  // 법인은 타소득 합산 필드 숨김
  const otherWrap = document.getElementById('tax_inc_other_wrap');
  if (otherWrap) otherWrap.style.display = taxType === 'corp' ? 'none' : 'block';
}

// ═══════════════════════════════════════════════════════
// 📉 시세 추이 탭
// ═══════════════════════════════════════════════════════
let trendSnapshots = []; // { ts, count, avgSale, avgRent, medSale, medRent }

// 수집 시 스냅샷 저장 (renderMarket 호출마다)
function recordTrendSnapshot(listings) {
  const sales = listings.filter(l => l.price?.type === 'sale' && l.price?.amount > 0);
  const rents = listings.filter(l => l.price?.type === 'monthly' && l.price?.monthly > 0);
  if (!sales.length && !rents.length) return;
  const saleAmts = sales.map(l => Math.round(l.price.amount/10000)).sort((a,b)=>a-b);
  const rentAmts = rents.map(l => Math.round(l.price.monthly/10000)).sort((a,b)=>a-b);
  const med = arr => arr.length ? arr[Math.floor(arr.length/2)] : null;
  const avg = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;
  const snap = { ts: Date.now(), count: listings.length,
    avgSale: avg(saleAmts), medSale: med(saleAmts),
    avgRent: avg(rentAmts), medRent: med(rentAmts) };
  // 동일 분이면 덮어씀
  const lastMin = trendSnapshots.length ? Math.floor(trendSnapshots[trendSnapshots.length-1].ts/60000) : -1;
  if (Math.floor(snap.ts/60000) === lastMin) trendSnapshots[trendSnapshots.length-1] = snap;
  else trendSnapshots.push(snap);
  if (trendSnapshots.length > 60) trendSnapshots.shift(); // 최대 60개 유지
}

function renderTrend() {
  const container = document.getElementById('trendContent');
  if (!container) return;
  if (trendSnapshots.length < 2) {
    container.innerHTML = '<div class="no-listing"><div class="icon">📉</div><p>수집 중 시세 변화가 여기에 표시됩니다<br><span style="font-size:10px;color:var(--text3)">2개 이상 스냅샷이 필요합니다</span></p></div>';
    return;
  }
  const fmt = ts => { const d = new Date(ts); return (d.getHours()+'').padStart(2,'0')+':'+(d.getMinutes()+'').padStart(2,'0'); };
  const rows = trendSnapshots.map((s, i) => {
    const prev = i > 0 ? trendSnapshots[i-1] : null;
    const diffSale = prev && s.medSale && prev.medSale ? s.medSale - prev.medSale : null;
    const diffRent = prev && s.medRent && prev.medRent ? s.medRent - prev.medRent : null;
    const saleColor = diffSale === null ? '' : diffSale > 0 ? 'color:var(--red)' : diffSale < 0 ? 'color:var(--green)' : '';
    const rentColor = diffRent === null ? '' : diffRent > 0 ? 'color:var(--red)' : diffRent < 0 ? 'color:var(--green)' : '';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
      <td style="color:var(--text3);font-size:10px">${fmt(s.ts)}</td>
      <td style="text-align:center;color:var(--text2)">${s.count}</td>
      <td style="text-align:right;${saleColor}">${s.medSale?fmtMan(s.medSale):'-'}${diffSale?`<span style="font-size:9px"> ${diffSale>0?'▲':'▼'}${Math.abs(diffSale)}</span>`:''}</td>
      <td style="text-align:right;${rentColor}">${s.medRent?fmtMan(s.medRent):'-'}${diffRent?`<span style="font-size:9px"> ${diffRent>0?'▲':'▼'}${Math.abs(diffRent)}</span>`:''}</td>
    </tr>`;
  }).reverse().join(''); // 최신이 위로

  container.innerHTML = `
  <div class="calc-section">
    <div class="calc-title">📉 시세 추이 <span style="font-size:10px;color:var(--text3);font-weight:400">(${trendSnapshots.length}개 스냅샷)</span></div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:var(--text3);font-size:10px;border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:3px 2px">시간</th>
        <th style="text-align:center;padding:3px 2px">건수</th>
        <th style="text-align:right;padding:3px 2px">중위매매가</th>
        <th style="text-align:right;padding:3px 2px">중위월세</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:10px;color:var(--text3);margin-top:4px">▲빨강=상승 ▼초록=하락 · 1분 단위 기록</div>
  </div>`;
}
function updateSummaryBar(){
  document.getElementById('sb_saved').textContent=savedListings.length+'건';
  document.getElementById('sb_collected').textContent=collectedListings.length+'건';
}


// ═══════════════════════════════════════════════════════
// 누락 함수 보완
// ═══════════════════════════════════════════════════════
function downloadMarketCSV() {
  if (!collectedListings.length) { showToast('수집된 매물이 없습니다'); return; }
  const headers = ['유형','매매가(만)','보증금(만)','월세(만)','전용면적(㎡)','전용(평)','평당가(만)','층','링크'];
  const rows = collectedListings.map(l => {
    const isSale = l.price?.type === 'sale';
    const py = getExclusivePyeong(l);
    const pp = (py > 0 && isSale && l.price?.amount > 0) ? Math.round(l.price.amount / 10000 / py) : '';
    const url = l.url || (l.id && !String(l.id).startsWith('anon_') ? 'https://new.land.naver.com/offices?articleNo=' + l.id : '');
    return [
      isSale ? '매매' : '월세',
      isSale ? Math.round((l.price?.amount||0)/10000) : '',
      !isSale ? Math.round((l.price?.deposit||0)/10000) : '',
      !isSale ? Math.round((l.price?.monthly||0)/10000) : '',
      l.area?.exclusive || l.area?.contract || '',
      py || '', pp, l.floorInfo || '', url
    ];
  });
  const csv = [headers].concat(rows).map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'}));
  a.download = '시장분석_' + new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','') + '.csv';
  a.click();
}

// ─────────────────────────────────────────
// 시장분석 요약 탭 전체 캡처 (PNG / PDF)
// ─────────────────────────────────────────
async function exportMarketCapture(format) {
  const fl = filteredListings;
  if (!fl.length) { showToast('수집된 매물이 없습니다'); return; }
  showToast('이미지 생성 중...');

  const PAD  = 14;
  const W    = 400;
  const dpr  = 2;

  const canvas = document.createElement('canvas');
  canvas.width  = W * dpr;
  canvas.height = 9000 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0F0F1A';
  ctx.fillRect(0, 0, W, 9000);

  let y = PAD;

  // ── 헬퍼 ──
  function rr(x, yy, w, h, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(x+r,yy); ctx.lineTo(x+w-r,yy); ctx.quadraticCurveTo(x+w,yy,x+w,yy+r);
    ctx.lineTo(x+w,yy+h-r); ctx.quadraticCurveTo(x+w,yy+h,x+w-r,yy+h);
    ctx.lineTo(x+r,yy+h); ctx.quadraticCurveTo(x,yy+h,x,yy+h-r);
    ctx.lineTo(x,yy+r); ctx.quadraticCurveTo(x,yy,x+r,yy);
    ctx.closePath();
    if (fill)   { ctx.fillStyle=fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); }
  }
  function txt(str, x, yy, color, font) {
    ctx.font = font || '11px sans-serif';
    ctx.fillStyle = color || '#F0F0FF';
    ctx.fillText(String(str||''), x, yy);
  }
  function hline() {
    ctx.fillStyle='rgba(124,58,237,0.2)'; ctx.fillRect(PAD,y,W-PAD*2,1); y+=10;
  }
  function sectionTitle(label) {
    rr(PAD,y,W-PAD*2,22,5,'#1A1A2E','rgba(124,58,237,0.3)');
    txt(label, PAD+8, y+15, '#8B5CF6', 'bold 11px sans-serif');
    y += 30;
  }
  const yrcol = v => v>=6?'#10B981':v>=4?'#F59E0B':'#ff6b6b';
  const fmtM  = v => {
    if (!v && v!==0) return '-';
    if (v>=10000) {
      const eok=Math.floor(v/10000), rest=Math.round(v%10000);
      return eok.toLocaleString()+'억'+(rest>0?rest:'');
    }
    return Math.round(v).toLocaleString()+'만';
  };

  // ── 헤더 ──
  ctx.font='bold 16px sans-serif'; ctx.fillStyle='#8B5CF6';
  ctx.fillText('📊 시장분석 요약', PAD, y+15); y+=22;
  ctx.font='10px sans-serif'; ctx.fillStyle='#6060A0';
  ctx.fillText(new Date().toLocaleString('ko-KR') + '  ·  총 ' + fl.length + '건', PAD, y+10); y+=20;
  hline();

  // ── 집계 ──
  const sales     = fl.filter(l => l.price?.type==='sale');
  const monthlies = fl.filter(l => l.price?.type==='monthly' && l.price?.monthly>0);
  const jeonses   = fl.filter(l => l.price?.type==='monthly' && !(l.price?.monthly>0));

  const saleAmts  = sales.map(l=>l.price.amount/10000).filter(v=>v>0);
  const rentAmts  = monthlies.map(l=>l.price.monthly/10000).filter(v=>v>0);
  const avgSale   = saleAmts.length  ? Math.round(avgExcludeMinMax(saleAmts))          : null;
  const avgRent   = rentAmts.length  ? Math.round(avgExcludeMinMax(rentAmts)*10)/10    : null;
  const salePPs   = sales.map(l=>{const p=getExclusivePyeong(l),v=l.price.amount/10000;return(p>0&&v>0)?Math.round(v/p):null;}).filter(v=>v&&v>0&&v<100000);
  const rentPPs   = monthlies.map(l=>{const p=getExclusivePyeong(l),v=l.price.monthly/10000;return(p>0&&v>0)?Math.round(v/p*10)/10:null;}).filter(Boolean);
  const avgSalePP = salePPs.length   ? Math.round(avgExcludeMinMax(salePPs))           : null;
  const avgRentPP = rentPPs.length   ? Math.round(avgExcludeMinMax(rentPPs)*10)/10     : null;
  const mktYr     = (avgSale&&avgSale>0&&avgRent&&avgRent>0) ? Math.round(avgRent*12/avgSale*1000)/10 : null;
  const medSale   = saleAmts.length  ? [...saleAmts].sort((a,b)=>a-b)[Math.floor(saleAmts.length/2)]  : null;
  const medRent   = rentAmts.length  ? [...rentAmts].sort((a,b)=>a-b)[Math.floor(rentAmts.length/2)]  : null;

  // ── 전체 요약 카드 (4개) ──
  sectionTitle('📌 전체 요약');
  const cw4 = Math.floor((W-PAD*2-9)/4);
  [
    { label:'총 매물', val:fl.length+'건',      color:'#F0F0FF' },
    { label:'매매',    val:sales.length+'건',    color:'#3B82F6' },
    { label:'월세',    val:monthlies.length+'건',color:'#10B981' },
    { label:'전세',    val:jeonses.length+'건',  color:'#F59E0B' },
  ].forEach((c,i) => {
    const cx = PAD+i*(cw4+3);
    rr(cx,y,cw4,48,7,'#1A1A2E','rgba(124,58,237,0.2)');
    txt(c.label, cx+6, y+14, '#A0A0C0', '9px sans-serif');
    txt(c.val,   cx+6, y+34, c.color,   'bold 14px sans-serif');
  });
  y += 56;

  // 평균/중위 카드 (2열)
  const cw2 = Math.floor((W-PAD*2-6)/2);
  const row2 = [
    avgSale   ? { label:'평균 매매가',    val:fmtM(avgSale),   sub:'중위 '+fmtM(medSale), color:'#3B82F6' } : null,
    avgSalePP ? { label:'매매 평균평단',  val:fmtM(avgSalePP), sub:'전용기준',              color:'#F59E0B' } : null,
    avgRent   ? { label:'평균 임대료',    val:fmtM(avgRent),   sub:'중위 '+fmtM(medRent),  color:'#10B981' } : null,
    avgRentPP ? { label:'임대 평단가',    val:(Math.round(avgRentPP*10)/10).toLocaleString()+'만', sub:'전용기준', color:'#34d399' } : null,
    mktYr     ? { label:'시장 평균수익률',val:mktYr+'%',       sub:'임대÷매매 단순추정',   color:yrcol(mktYr) } : null,
  ].filter(Boolean);

  for (let i=0; i<row2.length; i+=2) {
    [row2[i], row2[i+1]].forEach((c, j) => {
      if (!c) return;
      const cx = PAD+j*(cw2+6);
      rr(cx,y,cw2,54,7,'#1A1A2E','rgba(124,58,237,0.2)');
      txt(c.label, cx+6, y+14, '#A0A0C0', '9px sans-serif');
      txt(c.val,   cx+6, y+35, c.color,   'bold 14px sans-serif');
      txt(c.sub,   cx+6, y+49, '#6060A0', '9px sans-serif');
    });
    y += 62;
  }
  hline();

  // ── 층별 분석 테이블 ──
  function groupByFloor(items) {
    const g = {};
    items.forEach(l => {
      const fn = l.floorNum;
      if (fn===null||fn===undefined) return;
      let key = fn<0?'B':fn<=6?String(fn):'7+';
      if (!g[key]) g[key]={sales:[],rents:[]};
      if (l.price?.type==='sale') g[key].sales.push(l);
      if (l.price?.type==='monthly'&&l.price?.monthly>0) g[key].rents.push(l);
    });
    return g;
  }
  const floorG = groupByFloor(fl);
  const floorOrder = ['B','1','2','3','4','5','6','7+'];
  const floorLabels = {B:'지하','1':'1층','2':'2층','3':'3층','4':'4층','5':'5층','6':'6층','7+':'7층+'};

  const hasFloorData = floorOrder.some(k => floorG[k]);
  if (hasFloorData) {
    sectionTitle('🏢 층별 분석');
    // 헤더행
    ctx.font='bold 9px sans-serif'; ctx.fillStyle='#6060A0';
    ['층','건','평균매매','평균임대','수익률'].forEach((h,i) => {
      const xs=[PAD+4,PAD+46,PAD+90,PAD+190,PAD+290];
      ctx.fillText(h, xs[i], y+9);
    });
    y+=14; ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(PAD,y,W-PAD*2,1); y+=6;

    floorOrder.filter(k=>floorG[k]).forEach((k,ri) => {
      const g = floorG[k];
      const cnt = g.sales.length+g.rents.length;
      const sp = g.sales.map(l=>l.price.amount/10000).filter(v=>v>0);
      const rp = g.rents.map(l=>l.price.monthly/10000).filter(v=>v>0);
      const spp = g.sales.map(l=>{const p=getExclusivePyeong(l),v=l.price.amount/10000;return(p>0&&v>0)?Math.round(v/p):null;}).filter(Boolean);
      const rpp = g.rents.map(l=>{const p=getExclusivePyeong(l),v=l.price.monthly/10000;return(p>0&&v>0)?Math.round(v/p*10)/10:null;}).filter(Boolean);
      const as = sp.length ? Math.round(avgExcludeMinMax(sp)) : null;
      const ar = rp.length ? Math.round(avgExcludeMinMax(rp)*10)/10 : null;
      const aspp = spp.length ? Math.round(avgExcludeMinMax(spp)) : null;
      const arpp = rpp.length ? Math.round(avgExcludeMinMax(rpp)*10)/10 : null;

      if (ri%2===0) { ctx.fillStyle='rgba(255,255,255,0.025)'; ctx.fillRect(PAD,y-1,W-PAD*2,22); }

      txt(floorLabels[k]||k, PAD+4, y+14, '#8B5CF6', 'bold 10px sans-serif');
      txt(cnt+'건', PAD+46, y+14, '#A0A0C0', '10px sans-serif');

      if (as!==null) {
        txt(fmtM(as), PAD+90, y+10, '#3B82F6', '10px sans-serif');
        if (aspp!==null) txt('@'+fmtM(aspp), PAD+90, y+20, '#F59E0B', '8px sans-serif');
      } else txt('-', PAD+90, y+14, '#404060', '10px sans-serif');

      if (ar!==null) {
        txt(fmtM(ar), PAD+190, y+10, '#10B981', '10px sans-serif');
        if (arpp!==null) txt('@'+(Math.round(arpp*10)/10).toLocaleString()+'만', PAD+190, y+20, '#F59E0B', '8px sans-serif');
      } else txt('-', PAD+190, y+14, '#404060', '10px sans-serif');

      if (as&&as>0&&ar&&ar>0) {
        const yr=Math.round(ar*12/as*1000)/10;
        txt(yr+'%', PAD+290, y+14, yrcol(yr), 'bold 11px sans-serif');
      } else txt('-', PAD+290, y+14, '#404060', '10px sans-serif');

      y+=22;
    });
    y+=6; hline();
  }

  // ── 면적대별 분석 ──
  const areaBands=[
    {label:'~5평',min:0,max:5},{label:'5~10평',min:5,max:10},{label:'10~15평',min:10,max:15},
    {label:'15~20평',min:15,max:20},{label:'20~30평',min:20,max:30},{label:'30~40평',min:30,max:40},
    {label:'40~50평',min:40,max:50},{label:'50평+',min:50,max:9999},
  ];
  const hasAreaData = areaBands.some(band => fl.some(l=>{const py=getExclusivePyeong(l);return py>band.min&&py<=band.max;}));
  if (hasAreaData) {
    sectionTitle('📐 면적대별 분석');
    ctx.font='bold 9px sans-serif'; ctx.fillStyle='#6060A0';
    ['면적','건','평균매매','평균임대','수익률'].forEach((h,i) => {
      const xs=[PAD+4,PAD+54,PAD+90,PAD+190,PAD+290];
      ctx.fillText(h, xs[i], y+9);
    });
    y+=14; ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(PAD,y,W-PAD*2,1); y+=6;

    areaBands.forEach((band,ri) => {
      const items = fl.filter(l=>{const py=getExclusivePyeong(l);return py>band.min&&py<=band.max;});
      if (!items.length) return;
      const bSales=items.filter(l=>l.price?.type==='sale');
      const bRents=items.filter(l=>l.price?.type==='monthly'&&l.price?.monthly>0);
      const sp=bSales.map(l=>Math.round(l.price.amount/10000)).filter(v=>v>0);
      const rp=bRents.map(l=>Math.round(l.price.monthly/10000)).filter(v=>v>0);
      const spp=bSales.map(l=>{const py=getExclusivePyeong(l);return py>0?Math.round(l.price.amount/10000/py):null;}).filter(Boolean);
      const rpp=bRents.map(l=>{const py=getExclusivePyeong(l);return py>0?Math.round(l.price.monthly/10000/py*10)/10:null;}).filter(Boolean);
      const as=sp.length?Math.round(avgExcludeMinMax(sp)):null;
      const ar=rp.length?Math.round(avgExcludeMinMax(rp)*10)/10:null;
      const aspp=spp.length?Math.round(avgExcludeMinMax(spp)):null;
      const arpp=rpp.length?Math.round(avgExcludeMinMax(rpp)*10)/10:null;

      if (ri%2===0) { ctx.fillStyle='rgba(255,255,255,0.025)'; ctx.fillRect(PAD,y-1,W-PAD*2,22); }

      txt(band.label, PAD+4, y+14, '#60a5fa', 'bold 10px sans-serif');
      txt(items.length+'건', PAD+54, y+14, '#A0A0C0', '10px sans-serif');
      if (as!==null) {
        txt(fmtM(as), PAD+90, y+10, '#3B82F6', '10px sans-serif');
        if (aspp) txt('@'+fmtM(aspp), PAD+90, y+20, '#F59E0B', '8px sans-serif');
      } else txt('-', PAD+90, y+14, '#404060', '10px sans-serif');
      if (ar!==null) {
        txt(fmtM(ar), PAD+190, y+10, '#10B981', '10px sans-serif');
        if (arpp) txt('@'+(Math.round(arpp*10)/10).toLocaleString()+'만', PAD+190, y+20, '#F59E0B', '8px sans-serif');
      } else txt('-', PAD+190, y+14, '#404060', '10px sans-serif');
      if (as&&as>0&&ar&&ar>0) {
        const yr=Math.round(ar*12/as*1000)/10;
        txt(yr+'%', PAD+290, y+14, yrcol(yr), 'bold 11px sans-serif');
      } else txt('-', PAD+290, y+14, '#404060', '10px sans-serif');
      y+=22;
    });
    y+=6; hline();
  }

  // ── 가격 분포 ──
  sectionTitle('📊 가격 분포');
  const cw2b = Math.floor((W-PAD*2-8)/2);

  function drawDistBar(title, labels, counts, color, ox) {
    const maxC = Math.max(...counts,1);
    const bw = cw2b-6;
    txt(title, ox, y+10, color, 'bold 9px sans-serif'); y+=14;
    labels.forEach((lbl,i) => {
      if (!counts[i]) return;
      const pct = counts[i]/maxC;
      const barW = Math.max(Math.round(pct*(bw-40)),4);
      txt(lbl, ox, y+10, '#A0A0C0', '8px sans-serif');
      rr(ox+36,y+2,bw-40,10,3,'#2D2D50',null);
      rr(ox+36,y+2,barW,10,3,color,null);
      txt(counts[i], ox+bw-8, y+10, '#A0A0C0', '8px sans-serif');
      y+=14;
    });
    y+=4;
  }

  const startY = y;
  // 매매가 분포
  if (sales.length) {
    const saleBins=[0,5000,10000,20000,30000,50000,80000,999999999];
    const saleLabels=['~5천','~1억','~2억','~3억','~5억','~8억','8억+'];
    const saleCounts=new Array(saleLabels.length).fill(0);
    sales.forEach(l=>{
      const v=Math.round((l.price?.amount||0)/10000);
      for(let i=0;i<saleBins.length-1;i++){if(v>saleBins[i]&&v<=saleBins[i+1]){saleCounts[i]++;break;}}
    });
    const savedY=y;
    drawDistBar('매매가 분포 ('+sales.length+'건)', saleLabels, saleCounts, '#3B82F6', PAD);
    const midY=y;
    y=savedY;

    if (monthlies.length) {
      const rentBins=[0,50,100,150,200,300,500,999999];
      const rentLabels=['~50만','~100만','~150만','~200만','~300만','~500만','500만+'];
      const rentCounts=new Array(rentLabels.length).fill(0);
      monthlies.forEach(l=>{
        const v=Math.round((l.price?.monthly||0)/10000);
        for(let i=0;i<rentBins.length-1;i++){if(v>rentBins[i]&&v<=rentBins[i+1]){rentCounts[i]++;break;}}
      });
      drawDistBar('월세 분포 ('+monthlies.length+'건)', rentLabels, rentCounts, '#10B981', PAD+cw2b+8);
      y=Math.max(midY, y);
    } else {
      y=midY;
    }
  } else if (monthlies.length) {
    const rentBins=[0,50,100,150,200,300,500,999999];
    const rentLabels=['~50만','~100만','~150만','~200만','~300만','~500만','500만+'];
    const rentCounts=new Array(rentLabels.length).fill(0);
    monthlies.forEach(l=>{
      const v=Math.round((l.price?.monthly||0)/10000);
      for(let i=0;i<rentBins.length-1;i++){if(v>rentBins[i]&&v<=rentBins[i+1]){rentCounts[i]++;break;}}
    });
    drawDistBar('월세 분포 ('+monthlies.length+'건)', rentLabels, rentCounts, '#10B981', PAD);
  }
  hline();

  // ── 대표 매물 ──
  function repCard(label, labelColor, priceText, subs, url, cx, cardW) {
    rr(cx,y,cardW,64,7,'#1A1A2E',labelColor+'44');
    txt(label,     cx+6, y+13, labelColor,  'bold 9px sans-serif');
    txt(priceText, cx+6, y+32, '#F0F0FF',   'bold 13px sans-serif');
    subs.filter(Boolean).forEach((s,i) => txt(s, cx+6, y+46+i*11, '#A0A0C0', '9px sans-serif'));
  }

  const repCards = [];
  if (sales.length) {
    const sorted=[...sales].sort((a,b)=>(a.price?.amount||0)-(b.price?.amount||0));
    const med=sorted[Math.floor(sorted.length/2)];
    const py=getExclusivePyeong(med);
    repCards.push({label:'📍 중앙값 매매',color:'#3B82F6',price:fmtM(Math.round(med.price.amount/10000)),subs:[py?py+'평(전용)':'',py?'평당 '+fmtM(Math.round(med.price.amount/10000/py)):'']});
  }
  if (monthlies.length) {
    const sorted=[...monthlies].sort((a,b)=>(a.price?.monthly||0)-(b.price?.monthly||0));
    const med=sorted[Math.floor(sorted.length/2)];
    const py=getExclusivePyeong(med);
    const dep=Math.round((med.price.deposit||0)/10000);
    repCards.push({label:'📍 중앙값 월세',color:'#10B981',price:fmtM(Math.round(med.price.monthly/10000)),subs:['보증금 '+fmtM(dep),py?py+'평(전용)':'']});
  }

  if (repCards.length) {
    sectionTitle('🔖 대표 매물');
    const cardW = repCards.length>=2 ? Math.floor((W-PAD*2-6)/2) : W-PAD*2;
    repCards.slice(0,2).forEach((c,i) => {
      repCard(c.label, c.color, c.price, c.subs, null, PAD+i*(cardW+6), cardW);
    });
    y+=72;
  }

  // ── 푸터 ──
  y+=8;
  ctx.font='9px sans-serif'; ctx.fillStyle='#404060';
  ctx.fillText('상가 분석기 Pro · 시장분석 요약 · ' + new Date().toLocaleString('ko-KR'), PAD, y+10);
  y+=20;

  // trim
  const trimCanvas=document.createElement('canvas');
  trimCanvas.width=W*dpr;
  trimCanvas.height=Math.ceil(y*dpr);
  trimCanvas.getContext('2d').drawImage(canvas,0,0);

  const dateStr=new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','');
  const fileName='시장분석_'+dateStr;

  if (format==='png') {
    trimCanvas.toBlob(b=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(b);
      a.download=fileName+'.png';
      a.click();
      showToast('✅ 이미지 저장 완료');
    },'image/png');
    return;
  }

  const dataUrl=trimCanvas.toDataURL('image/png');
  const win=window.open('');
  if (!win){showToast('팝업 차단됨 — 허용 후 재시도');return;}
  win.document.write(`<!DOCTYPE html><html><head><title>${fileName}</title>
    <style>*{margin:0;padding:0}body{background:#0F0F1A}img{width:100%;display:block}
    @media print{@page{size:A4;margin:0}img{width:100%;height:auto}}</style>
  </head><body><img src="${dataUrl}" onload="window.print()"></body></html>`);
  win.document.close();
  showToast('인쇄 다이얼로그에서 PDF로 저장하세요');
}

// ─────────────────────────────────────────
// 매물 탭 전체 캡처 (PNG / PDF)
// ─────────────────────────────────────────
async function exportListingCapture(data, format) {
  if (!data) { showToast('매물 정보가 없습니다'); return; }
  showToast('이미지 생성 중...');

  const PAD   = 16;
  const W     = 400;
  const lineH = 26;
  const dpr   = 2;

  const canvas = document.createElement('canvas');
  canvas.width  = W * dpr;
  canvas.height = 6000 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0F0F1A';
  ctx.fillRect(0, 0, W, 6000);

  let y = PAD;

  // ── 헬퍼 ──
  function rr(x, yy, w, h, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(x+r,yy); ctx.lineTo(x+w-r,yy); ctx.quadraticCurveTo(x+w,yy,x+w,yy+r);
    ctx.lineTo(x+w,yy+h-r); ctx.quadraticCurveTo(x+w,yy+h,x+w-r,yy+h);
    ctx.lineTo(x+r,yy+h); ctx.quadraticCurveTo(x,yy+h,x,yy+h-r);
    ctx.lineTo(x,yy+r); ctx.quadraticCurveTo(x,yy,x+r,yy);
    ctx.closePath();
    if (fill)   { ctx.fillStyle=fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=lw||1; ctx.stroke(); }
  }

  function txt(str, x, yy, color, font) {
    ctx.font = font || '12px sans-serif';
    ctx.fillStyle = color || '#F0F0FF';
    ctx.fillText(String(str||'').substring(0,55), x, yy);
  }

  function hline() {
    ctx.fillStyle='rgba(124,58,237,0.2)'; ctx.fillRect(PAD, y, W-PAD*2, 1); y+=8;
  }

  function sectionTitle(label) {
    rr(PAD, y, W-PAD*2, 22, 5, '#1A1A2E', 'rgba(124,58,237,0.3)');
    txt(label, PAD+8, y+15, '#8B5CF6', 'bold 11px sans-serif');
    y += 30;
  }

  function infoRow(label, value, valueColor) {
    txt(label, PAD+4, y+13, '#A0A0C0', '10px sans-serif');
    const maxW = W - PAD*2 - 80;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = valueColor || '#F0F0FF';
    // 긴 텍스트 자동 줄바꿈
    const words = String(value||'').split('');
    let line = '', lines = [];
    for (const ch of words) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch; }
      else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => {
      txt(l, PAD+90, y+13+(i*14), valueColor||'#F0F0FF', '11px sans-serif');
    });
    y += Math.max(lineH, lines.length * 14 + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(PAD, y-1, W-PAD*2, 1);
  }

  // ── 헤더 ──
  const tradeType = data.tradeType || (data.price?.type === 'monthly' ? '월세' : '매매');
  rr(PAD, y, 36, 18, 4, '#7c3aed', null);
  txt(tradeType, PAD+6, y+13, 'white', 'bold 11px sans-serif');
  y += 24;

  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#F0F0FF';
  ctx.fillText((data.buildingName ? data.buildingName + ' · ' : '') + (data.title || data.address || '매물 정보'), PAD, y+16);
  y += 24;

  // 금액 대표 표시
  let priceStr = '', priceColor = '#A0A0C0';
  if (data.price?.type === 'monthly' && data.price?.monthly > 0) {
    const dep = data.price.deposit > 0 ? fmtMan(Math.round(data.price.deposit/10000)) : '없음';
    priceStr = `보증 ${dep} / 월 ${fmtMan(Math.round(data.price.monthly/10000))}`;
    priceColor = '#34d399';
  } else if (data.price?.type === 'monthly' && data.price?.deposit > 0) {
    priceStr = '전세 ' + fmtMan(Math.round(data.price.deposit/10000));
    priceColor = '#F59E0B';
  } else if (data.price?.type === 'sale' && data.price?.amount > 0) {
    priceStr = fmtMan(Math.round(data.price.amount/10000));
    priceColor = '#a78bfa';
  } else priceStr = data.priceRaw || '-';

  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = priceColor;
  ctx.fillText(priceStr, PAD, y+20);
  y += 30;

  // 메타 (층/방향/주소)
  const metas = [data.floorInfo, data.direction, data.address].filter(Boolean);
  if (metas.length) {
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#A0A0C0';
    ctx.fillText(metas.join('  ·  '), PAD, y+10);
    y += 18;
  }
  y += 4; hline();

  // ── 가격 상세 ──
  sectionTitle('💰 가격 정보');
  if (data.price?.type === 'sale' && data.price?.amount > 0) {
    infoRow('매매가', fmtMan(Math.round(data.price.amount/10000)), '#a78bfa');
    if (data.rentPrice?.monthly > 0) {
      infoRow('임대 보증금', fmtMan(Math.round((data.rentPrice.deposit||0)/10000)), '#F59E0B');
      infoRow('임대 월세', fmtMan(Math.round(data.rentPrice.monthly/10000)), '#34d399');
      const yr = Math.round(data.rentPrice.monthly*12/data.price.amount*1000)/10;
      infoRow('예상 수익률', yr + '%', yr>=6?'#34d399':yr>=4?'#F59E0B':'#ff6b6b');
    }
  } else if (data.price?.type === 'monthly') {
    const dep = Math.round((data.price.deposit||0)/10000);
    const mon = Math.round((data.price.monthly||0)/10000);
    if (mon > 0) {
      infoRow('보증금', dep > 0 ? fmtMan(dep) : '없음', '#F59E0B');
      infoRow('월세', fmtMan(mon), '#34d399');
    } else if (dep > 0) {
      infoRow('전세금', fmtMan(dep), '#F59E0B');
    }
  }

  // ── 면적 정보 ──
  sectionTitle('📐 면적 정보');
  if (data.area?.contract) {
    const cpY = data.area.contractPyeong || Math.round(data.area.contract/3.3058*10)/10;
    infoRow('계약면적', `${data.area.contract}㎡ (${cpY}평)`);
    if (data.area.exclusive && data.area.exclusive !== data.area.contract) {
      const epY = data.area.exclusivePyeong || Math.round(data.area.exclusive/3.3058*10)/10;
      infoRow('전용면적', `${data.area.exclusive}㎡ (${epY}평)`);
      if (data.price?.type === 'sale' && data.price?.amount > 0) {
        const pp = Math.round(data.price.amount/10000/epY);
        infoRow('전용 평단가', fmtMan(pp), '#F59E0B');
      }
    }
  }

  // ── 상세 정보 ──
  const detailFields = [
    ['입주가능일', data.moveInType],
    ['현재업종',  data.currentUse],
    ['추천업종',  data.recommendUse],
    ['융자금',    data.loanable],
    ['권리금',    data.keyMoney],
    ['월 관리비', data.manageFee],
    ['주차',      data.parking + (data.totalParkingCount ? ` (총 ${data.totalParkingCount}대)` : '')],
    ['난방',      data.heating],
    ['건축물용도', data.buildingUse],
    ['용도지역',  data.zoneType],
    ['주구조',    data.structure],
    ['화장실',    data.toiletCount !== undefined ? data.toiletCount + '개' : null],
    ['사용승인일', data.approvalDate],
    ['매물번호',  data.listingNo || data.articleNo],
  ].filter(([,v]) => v && v !== 'null' && v !== 'undefined' && v !== 'false');

  if (detailFields.length) {
    sectionTitle('📋 상세 정보');
    detailFields.forEach(([l,v]) => infoRow(l, v));
  }

  // ── 매물 설명 ──
  if (data.features) {
    sectionTitle('📝 매물 설명');
    const desc = data.features.substring(0, 400);
    const descLines = [];
    let line = '';
    const maxW = W - PAD*2 - 8;
    ctx.font = '11px sans-serif';
    for (const ch of desc) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) { descLines.push(line); line = ch; }
      else { if (ch === '\n') { descLines.push(line); line = ''; } else line = test; }
    }
    if (line) descLines.push(line);
    descLines.forEach(l => {
      txt(l, PAD+4, y+12, '#C0C0D0', '11px sans-serif');
      y += 16;
    });
    y += 6;
  }

  // ── 중개사 정보 ──
  if (data.realtor?.name || data.realtor?.tel) {
    sectionTitle('🏢 중개사 정보');
    if (data.realtor.name) infoRow('중개사', data.realtor.name);
    if (data.realtor.ceoName) infoRow('대표', data.realtor.ceoName);
    if (data.realtor.tel) infoRow('전화', data.realtor.tel, '#60a5fa');
    if (data.realtor.address) infoRow('주소', data.realtor.address);
  }

  // ── 푸터 ──
  y += 8;
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#404060';
  ctx.fillText('상가 분석기 Pro · ' + new Date().toLocaleString('ko-KR'), PAD, y+10);
  if (data.url) ctx.fillText(data.url.substring(0,60), PAD, y+22);
  y += 28;

  // trim
  const trimCanvas = document.createElement('canvas');
  trimCanvas.width  = W * dpr;
  trimCanvas.height = Math.ceil(y * dpr);
  trimCanvas.getContext('2d').drawImage(canvas, 0, 0);

  const dateStr = new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','');
  const fileName = `매물정보_${data.id || dateStr}`;

  if (format === 'png') {
    trimCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = fileName + '.png';
      a.click();
      showToast('✅ 이미지 저장 완료');
    }, 'image/png');
    return;
  }

  // PDF
  const dataUrl = trimCanvas.toDataURL('image/png');
  const win = window.open('');
  if (!win) { showToast('팝업 차단됨 — 허용 후 재시도'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>${fileName}</title>
    <style>*{margin:0;padding:0}body{background:#0F0F1A}img{width:100%;display:block}
    @media print{@page{size:A4;margin:0}img{width:100%;height:auto}}</style>
  </head><body><img src="${dataUrl}" onload="window.print()"></body></html>`);
  win.document.close();
  showToast('인쇄 다이얼로그에서 PDF로 저장하세요');
}

function downloadListingCSV(data) {
  if (!data) { showToast('매물 정보가 없습니다'); return; }
  const isSale = data.price?.type === 'sale';
  const py = getExclusivePyeong(data);
  const pp = (py > 0 && isSale && data.price?.amount > 0) ? Math.round(data.price.amount / 10000 / py) : '';
  const headers = ['거래유형','매매가(만)','보증금(만)','월세(만)','계약면적(㎡)','전용면적(㎡)','전용(평)','평당가(만)','층','방향','관리비','권리금','사용승인일','매물번호','링크'];
  const row = [
    isSale?'매매':'월세',
    isSale?Math.round((data.price?.amount||0)/10000):'',
    !isSale?Math.round((data.price?.deposit||0)/10000):'',
    !isSale?Math.round((data.price?.monthly||0)/10000):'',
    data.area?.contract||'', data.area?.exclusive||'', py||'', pp,
    data.floorInfo||'', data.direction||'', data.manageFee||'',
    data.keyMoney||'', data.approvalDate||'',
    data.articleNo||data.listingNo||data.id||'',
    data.url||(data.id&&!String(data.id).startsWith('anon_')?'https://new.land.naver.com/offices?articleNo='+data.id:'')
  ];
  const csv = [headers,row].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download = '매물상세_'+(data.id||'listing')+'.csv';
  a.click();
}

// ═══════════════════════════════════════════════════════
// 📈 수익률 입력 탭
// ═══════════════════════════════════════════════════════
let yiItems = [];
let yiGroups = []; // [{id, name, color}]
let yiActiveGroup = 'all'; // 'all' or group id

function yiParseWon(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = el.value.replace(/,/g, '').trim();
  const n = parseFloat(raw);
  return (!n || isNaN(n)) ? 0 : n; // 입력값이 이미 만원 단위 → 그대로 반환
}

function yiLoad() {
  chrome.storage.local.get(['yieldItems', 'yiGroups'], (result) => {
    let items = result.yieldItems || [];
    // 마이그레이션: 기존 데이터가 원→만원 잘못 나눠진 값이면 복구
    // 판별 기준: sale이 100 미만이면 잘못된 단위 (실제 상가 매매가 100만원 미만은 없음)
    items = items.map(it => {
      if (it.sale > 0 && it.sale < 100) {
        // 기존 버그: 원값을 10000으로 나눔 → 10000 곱해서 복구
        const sale    = Math.round(it.sale    * 10000);
        const deposit = Math.round((it.deposit || 0) * 10000);
        const monthly = Math.round((it.monthly || 0) * 10000);
        const areaPy  = it.areaPy || 0;
        const salePP  = areaPy > 0 && sale > 0 ? Math.round(sale / areaPy) : 0;
        const { yr, yr2 } = yiCalc(sale, deposit, monthly);
        return { ...it, sale, deposit, monthly, salePP, yr, yr2, _migrated: true };
      }
      return it;
    });
    yiItems  = items;
    yiGroups = result.yiGroups || [];
    // 마이그레이션 있으면 저장
    if (items.some(it => it._migrated)) {
      chrome.storage.local.set({ yieldItems: yiItems });
    }
    yiRenderGroupTabs();
    yiRender();
  });
}

function yiSave() {
  chrome.storage.local.set({ yieldItems: yiItems, yiGroups });
}

function yiCalc(sale, deposit, monthly) {
  if (!sale || !monthly) return { yr: null, yr2: null };
  const yr = Math.round(monthly * 12 / sale * 1000) / 10;
  const invest = sale - (deposit || 0);
  const yr2 = invest > 0 ? Math.round(monthly * 12 / invest * 1000) / 10 : yr;
  return { yr, yr2 };
}

function yiUpdatePreview() {
  const sale    = yiParseWon('yi_sale');
  const deposit = yiParseWon('yi_deposit');
  const monthly = yiParseWon('yi_monthly');
  const prev = document.getElementById('yi_preview');
  if (!prev) return;
  if (!sale && !monthly) { prev.style.display = 'none'; return; }
  const { yr, yr2 } = yiCalc(sale, deposit, monthly);
  prev.style.display = 'block';
  const col = yr >= 6 ? 'var(--green)' : yr >= 4 ? 'var(--orange)' : 'var(--red)';
  document.getElementById('yi_yr').style.color = col;
  document.getElementById('yi_yr').textContent = yr !== null ? yr + '%' : '-';
  document.getElementById('yi_yr2').textContent = (yr2 !== null && deposit > 0) ? yr2 + '%' : '-';
}

// ═══════════════════════════════════════════════════════
// 그룹 관리
// ═══════════════════════════════════════════════════════
const GROUP_COLORS = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#ec4899','#0891b2','#65a30d'];

function yiRenderGroupTabs() {
  const container = document.getElementById('yi_groupTabs');
  if (!container) return;

  // 입력폼 그룹 select 동기화
  const sel = document.getElementById('yi_groupSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">그룹 없음</option>'
      + yiGroups.map(g => `<option value="${g.id}" ${g.id===cur?'selected':''}>${g.name}</option>`).join('');
  }

  const tabs = [{ id:'all', name:'전체', color:'var(--primary)' }, ...yiGroups];
  container.innerHTML = tabs.map(g => {
    const active = yiActiveGroup === g.id;
    const cnt = g.id==='all' ? yiItems.length : yiItems.filter(it=>it.groupId===g.id).length;
    const col = g.color || 'var(--primary)';
    return `<button data-grp="${g.id}" style="
      padding:4px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;flex-shrink:0;font-size:11px;
      border:1px solid ${active ? col : 'var(--border)'};
      background:${active ? col+'22' : 'transparent'};
      color:${active ? col : 'var(--text2)'};
      font-weight:${active?700:400};
    ">${g.name} <span style="font-size:9px;opacity:0.65">${cnt}</span></button>`;
  }).join('')
  + `<button id="yi_manageGroupBtn" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text3);font-size:11px;cursor:pointer;flex-shrink:0" title="그룹 관리">⚙️</button>`;

  container.querySelectorAll('[data-grp]').forEach(btn => {
    btn.addEventListener('click', () => {
      yiActiveGroup = btn.dataset.grp;
      yiRenderGroupTabs();
      yiRender();
    });
  });

  document.getElementById('yi_manageGroupBtn')?.addEventListener('click', yiOpenGroupManager);
}

// ── 그룹 관리 모달 ──
function yiOpenGroupManager() {
  document.getElementById('yi-grp-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'yi-grp-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10000;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  function renderModal() {
    const grpRows = yiGroups.map((g, i) => {
      const cnt = yiItems.filter(it=>it.groupId===g.id).length;
      return `<div class="grp-row" data-gid="${g.id}" style="
        display:flex;align-items:center;gap:6px;padding:7px 8px;
        background:var(--bg3);border-radius:8px;margin-bottom:5px;
      ">
        <!-- 색상 선택 -->
        <div class="grp-color-btn" data-gid="${g.id}" style="
          width:18px;height:18px;border-radius:50%;background:${g.color};
          cursor:pointer;flex-shrink:0;border:2px solid rgba(255,255,255,0.15);
        " title="색상 변경"></div>
        <!-- 이름 -->
        <input class="grp-name-input" data-gid="${g.id}" value="${g.name}"
          style="flex:1;background:var(--bg4);border:1px solid var(--border);border-radius:5px;
          color:var(--text);font-size:12px;padding:4px 7px;outline:none;">
        <!-- 건수 -->
        <span style="font-size:10px;color:var(--text3);flex-shrink:0">${cnt}건</span>
        <!-- 위/아래 -->
        <button class="grp-up" data-gidx="${i}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0 2px" ${i===0?'disabled':''}>▲</button>
        <button class="grp-dn" data-gidx="${i}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;padding:0 2px" ${i===yiGroups.length-1?'disabled':''}>▼</button>
        <!-- 삭제 -->
        <button class="grp-del" data-gid="${g.id}" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:14px;padding:0 2px" title="그룹 삭제">✕</button>
      </div>`;
    }).join('');

    modal.innerHTML = `<div style="
      background:var(--bg2);border:1px solid var(--border);border-radius:12px;
      padding:16px;width:100%;max-width:340px;max-height:85vh;overflow-y:auto;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:14px;font-weight:700;color:var(--primary-light)">⚙️ 그룹 관리</div>
        <button id="yi-grp-close" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;line-height:1">✕</button>
      </div>

      <div id="yi-grp-list">${grpRows}</div>

      <!-- 새 그룹 추가 -->
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">새 그룹 추가</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input id="yi-new-grp-name" placeholder="그룹 이름" style="
            flex:1;min-width:100px;background:var(--bg3);border:1px solid var(--border);
            border-radius:6px;color:var(--text);font-size:12px;padding:6px 8px;outline:none;
          ">
          <div id="yi-new-grp-colors" style="display:flex;gap:4px;flex-wrap:wrap">
            ${GROUP_COLORS.map((c,i)=>`<div class="new-color-opt" data-c="${c}" style="
              width:18px;height:18px;border-radius:50%;background:${c};cursor:pointer;
              border:2px solid ${i===0?'white':'transparent'};flex-shrink:0;
            "></div>`).join('')}
          </div>
          <button id="yi-grp-add-btn" style="
            padding:6px 12px;background:var(--primary);border:none;border-radius:6px;
            color:white;font-size:12px;font-weight:600;cursor:pointer;
          ">추가</button>
        </div>
      </div>

      <div style="margin-top:12px;font-size:10px;color:var(--text3)">
        💡 그룹 삭제 시 매물 처리 방법을 선택할 수 있습니다
      </div>
    </div>`;

    bindModalEvents();
  }

  function bindModalEvents() {
    document.getElementById('yi-grp-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // 이름 변경 (blur 시 저장)
    modal.querySelectorAll('.grp-name-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const g = yiGroups.find(x=>x.id===inp.dataset.gid);
        if (g && inp.value.trim()) { g.name = inp.value.trim(); yiSave(); yiRenderGroupTabs(); }
      });
    });

    // 색상 변경
    modal.querySelectorAll('.grp-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = yiGroups.find(x=>x.id===btn.dataset.gid);
        if (!g) return;
        yiOpenColorPicker(g, () => { yiSave(); yiRenderGroupTabs(); renderModal(); });
      });
    });

    // 순서 올리기
    modal.querySelectorAll('.grp-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.gidx);
        if (i>0) { [yiGroups[i-1],yiGroups[i]]=[yiGroups[i],yiGroups[i-1]]; yiSave(); yiRenderGroupTabs(); renderModal(); }
      });
    });

    // 순서 내리기
    modal.querySelectorAll('.grp-dn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.gidx);
        if (i<yiGroups.length-1) { [yiGroups[i],yiGroups[i+1]]=[yiGroups[i+1],yiGroups[i]]; yiSave(); yiRenderGroupTabs(); renderModal(); }
      });
    });

    // 그룹 삭제
    modal.querySelectorAll('.grp-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = yiGroups.find(x=>x.id===btn.dataset.gid);
        if (!g) return;
        const cnt = yiItems.filter(it=>it.groupId===g.id).length;
        yiConfirmGroupDelete(g, cnt, () => { renderModal(); yiRenderGroupTabs(); yiRender(); });
      });
    });

    // 새 그룹 색상 선택
    let selectedNewColor = GROUP_COLORS[0];
    modal.querySelectorAll('.new-color-opt').forEach(dot => {
      dot.addEventListener('click', () => {
        selectedNewColor = dot.dataset.c;
        modal.querySelectorAll('.new-color-opt').forEach(d => d.style.border='2px solid transparent');
        dot.style.border = '2px solid white';
      });
    });

    // 새 그룹 추가
    document.getElementById('yi-grp-add-btn')?.addEventListener('click', () => {
      const nameEl = document.getElementById('yi-new-grp-name');
      const name = nameEl?.value.trim();
      if (!name) { nameEl?.focus(); return; }
      yiGroups.push({ id:'grp_'+Date.now(), name, color: selectedNewColor });
      if (nameEl) nameEl.value = '';
      yiSave(); yiRenderGroupTabs(); renderModal();
    });
    document.getElementById('yi-new-grp-name')?.addEventListener('keydown', e => {
      if (e.key==='Enter') document.getElementById('yi-grp-add-btn')?.click();
    });
  }

  renderModal();
  document.body.appendChild(modal);
}

// ── 색상 선택 팝오버 ──
function yiOpenColorPicker(group, onDone) {
  document.getElementById('yi-color-pop')?.remove();
  const pop = document.createElement('div');
  pop.id = 'yi-color-pop';
  pop.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;
    display:flex;align-items:center;justify-content:center;
  `;
  pop.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;min-width:200px">
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">색상 선택 — ${group.name}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${GROUP_COLORS.map(c=>`<div class="cp-opt" data-c="${c}" style="
        width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
        border:3px solid ${c===group.color?'white':'transparent'};
      "></div>`).join('')}
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <input type="color" id="yi-custom-color" value="${group.color}" style="width:36px;height:28px;border:none;border-radius:4px;cursor:pointer;background:none;padding:0">
      <span style="font-size:10px;color:var(--text3)">직접 선택</span>
      <button id="yi-cp-ok" style="margin-left:auto;padding:5px 12px;background:var(--primary);border:none;border-radius:6px;color:white;font-size:12px;cursor:pointer">확인</button>
    </div>
  </div>`;

  let chosen = group.color;
  pop.querySelectorAll('.cp-opt').forEach(d => {
    d.addEventListener('click', () => {
      chosen = d.dataset.c;
      pop.querySelectorAll('.cp-opt').forEach(x=>x.style.border='3px solid transparent');
      d.style.border = '3px solid white';
      document.getElementById('yi-custom-color').value = chosen;
    });
  });
  document.getElementById('yi-custom-color')?.addEventListener('input', e => {
    chosen = e.target.value;
    pop.querySelectorAll('.cp-opt').forEach(d=>d.style.border='3px solid transparent');
  });
  document.getElementById('yi-cp-ok')?.addEventListener('click', () => {
    group.color = chosen; pop.remove(); onDone();
  });
  pop.addEventListener('click', e=>{ if(e.target===pop){ pop.remove(); } });
  document.body.appendChild(pop);
}

// ── 그룹 삭제 확인 다이얼로그 ──
function yiConfirmGroupDelete(group, cnt, onDone) {
  document.getElementById('yi-grp-del-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'yi-grp-del-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px';
  m.innerHTML = `<div style="background:var(--bg2);border:1px solid rgba(255,80,80,0.3);border-radius:12px;padding:18px;max-width:300px;width:100%">
    <div style="font-size:14px;font-weight:700;color:#ff6b6b;margin-bottom:10px">🗑️ 그룹 삭제</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.7">
      <b style="color:${group.color}">${group.name}</b> 그룹을 삭제합니다.<br>
      ${cnt>0 ? `이 그룹의 매물 <b style="color:var(--orange)">${cnt}건</b>은 어떻게 처리할까요?` : '이 그룹에는 매물이 없습니다.'}
    </div>
    ${cnt>0 ? `
    <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text2)">
        <input type="radio" name="del-action" value="ungroup" checked style="accent-color:var(--primary)">
        그룹만 삭제 (매물은 그룹 없음으로 이동)
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#ff6b6b">
        <input type="radio" name="del-action" value="delete-all" style="accent-color:#ff6b6b">
        그룹 + 매물 ${cnt}건 모두 삭제
      </label>
    </div>` : ''}
    <div style="display:flex;gap:8px">
      <button id="yi-del-cancel" style="flex:1;padding:8px;background:var(--bg3);border:1px solid var(--border);border-radius:7px;color:var(--text2);font-size:12px;cursor:pointer">취소</button>
      <button id="yi-del-confirm" style="flex:1;padding:8px;background:#dc2626;border:none;border-radius:7px;color:white;font-size:12px;font-weight:700;cursor:pointer">삭제</button>
    </div>
  </div>`;

  document.getElementById('yi-del-cancel')?.addEventListener('click', () => m.remove());
  document.getElementById('yi-del-confirm')?.addEventListener('click', () => {
    const action = m.querySelector('input[name="del-action"]:checked')?.value || 'ungroup';
    if (action === 'delete-all') {
      yiItems = yiItems.filter(it => it.groupId !== group.id);
    } else {
      yiItems.forEach(it => { if (it.groupId === group.id) it.groupId = ''; });
    }
    yiGroups = yiGroups.filter(g => g.id !== group.id);
    if (yiActiveGroup === group.id) yiActiveGroup = 'all';
    yiSave(); m.remove(); onDone();
  });
  document.body.appendChild(m);
}

function yiRender() {
  const list = document.getElementById('yi_list');
  const countEl = document.getElementById('yi_count');
  const summaryEl = document.getElementById('yi_summary');
  const summaryGrid = document.getElementById('yi_summaryGrid');
  if (!list) return;

  // 현재 그룹 필터
  const visibleItems = yiActiveGroup === 'all'
    ? yiItems
    : yiItems.filter(it => it.groupId === yiActiveGroup);

  if (countEl) countEl.textContent = visibleItems.length ? `(${visibleItems.length}건)` : '';

  if (!visibleItems.length) {
    list.innerHTML = '<div class="no-listing" style="padding:20px 0"><div class="icon" style="font-size:24px">📈</div><p style="font-size:11px">아직 입력된 매물이 없습니다</p></div>';
    if (summaryEl) summaryEl.style.display = 'none';
    return;
  }

  // 정렬 상태
  if (!yiRender._sortKey) { yiRender._sortKey = 'addedAt'; yiRender._sortDir = 'desc'; }
  function sortItems(items) {
    const key = yiRender._sortKey, dir = yiRender._sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      if (key === 'yr')    return dir * ((a.yr||0) - (b.yr||0));
      if (key === 'sale')  return dir * ((a.sale||0) - (b.sale||0));
      if (key === 'area')  return dir * ((a.areaPy||0) - (b.areaPy||0));
      if (key === 'floor') return dir * ((parseInt(a.floor)||0) - (parseInt(b.floor)||0));
      return 0;
    });
  }
  function sortIcon(key) {
    if (yiRender._sortKey !== key) return '<span style="color:var(--text3);font-size:9px;margin-left:1px">↕</span>';
    return yiRender._sortDir === 'asc'
      ? '<span style="color:var(--primary-light);font-size:9px;margin-left:1px">↑</span>'
      : '<span style="color:var(--primary-light);font-size:9px;margin-left:1px">↓</span>';
  }

  const sorted = sortItems(visibleItems);

  // 테이블 렌더
  const thS = 'cursor:pointer;user-select:none;padding:5px 4px;font-size:10px;color:var(--text3);font-weight:600;white-space:nowrap;';
  const rows = sorted.map((item) => {
    const origIdx = yiItems.indexOf(item);
    const col = item.yr >= 6 ? 'var(--green)' : item.yr >= 4 ? 'var(--orange)' : item.yr !== null ? '#ff6b6b' : 'var(--text3)';
    const yr2txt = (item.yr2 !== null && item.deposit > 0) ? `<div style="color:var(--text3);font-size:9px;line-height:1">실${item.yr2}%</div>` : '';
    const floorNum = parseInt(item.floor) || null;
    const floorBadge = floorNum !== null
      ? `<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;background:${floorNum===1?'rgba(124,58,237,0.2)':floorNum<=0?'rgba(255,170,0,0.2)':'rgba(59,130,246,0.15)'};color:${floorNum===1?'var(--primary-light)':floorNum<=0?'var(--orange)':'var(--blue)'}">${item.floor}</span>`
      : (item.floor ? `<span style="font-size:11px;color:var(--text2)">${item.floor}</span>` : '<span style="color:var(--text3)">-</span>');

    const memoAttr = item.memo ? `data-memo="${item.memo.replace(/"/g,'&quot;')}"` : '';
    const memoIcon = item.memo ? `<span class="yi-memo-trigger" ${memoAttr} style="display:inline-block;width:14px;height:14px;border-radius:50%;background:rgba(124,58,237,0.25);color:var(--primary-light);font-size:9px;line-height:14px;text-align:center;cursor:default;margin-left:3px;">✎</span>` : '';

    // 그룹 색상 점
    const grp = yiGroups.find(g => g.id === item.groupId);
    const grpDot = (grp && yiActiveGroup === 'all') ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${grp.color};margin-right:3px;flex-shrink:0"></span>` : '';

    const areaCell = item.areaPy > 0
      ? `<div style="font-size:10px;color:var(--text2)">${item.areaPy}평</div>${item.salePP>0?`<div style="font-size:9px;color:var(--orange)">@${fmtMan(item.salePP)}</div>`:''}`
      : '<span style="color:var(--text3)">-</span>';

    // 그룹 이동 버튼 (그룹이 있을 때만)
    const grpMoveBtn = yiGroups.length > 0
      ? `<button class="yi-grp-move" data-yi-idx="${origIdx}" style="
          background:none;border:none;cursor:pointer;padding:0 1px;font-size:10px;
          color:${grp ? grp.color : 'var(--text3)'};line-height:1;flex-shrink:0;
        " title="그룹 이동">◉</button>`
      : '';

    return `<tr data-yi-row="${origIdx}" style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.2s;">
      <td style="padding:5px 4px;max-width:75px;">
        <div style="display:flex;align-items:center;font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.name||''}">${grpDot}${item.name||'(미입력)'}${memoIcon}${grpMoveBtn}</div>
        ${item.direction ? `<div style="font-size:9px;color:var(--text3)">${item.direction}</div>` : ''}
      </td>
      <td style="padding:5px 4px;text-align:center">${floorBadge}</td>
      <td style="padding:5px 4px;text-align:right;white-space:nowrap;">
        <div style="font-size:10px;color:var(--blue)">${fmtMan(item.sale)}</div>
        ${item.deposit > 0 ? `<div style="font-size:9px;color:var(--text3)">보${fmtMan(item.deposit)}</div>` : ''}
        <div style="font-size:9px;color:var(--green)">월${fmtMan(item.monthly)}</div>
      </td>
      <td style="padding:5px 4px;text-align:center">${areaCell}</td>
      <td style="padding:5px 4px;text-align:right;">
        <div style="font-size:14px;font-weight:700;color:${col}">${item.yr !== null ? item.yr + '%' : '-'}</div>
        ${yr2txt}
      </td>
      <td style="padding:5px 4px;text-align:center;">
        <button data-yi-del="${origIdx}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 2px;line-height:1">✕</button>
      </td>
    </tr>`;
  }).join('');

  list.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead style="position:sticky;top:0;background:var(--bg2);z-index:5;">
      <tr>
        <th data-yi-sort="name" style="${thS}text-align:left">매물명</th>
        <th data-yi-sort="floor" style="${thS}text-align:center">층${sortIcon('floor')}</th>
        <th data-yi-sort="sale" style="${thS}text-align:right">금액${sortIcon('sale')}</th>
        <th data-yi-sort="area" style="${thS}text-align:center">면적${sortIcon('area')}</th>
        <th data-yi-sort="yr" style="${thS}text-align:right">수익률${sortIcon('yr')}</th>
        <th style="width:20px"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;

  // 정렬 클릭
  list.querySelectorAll('th[data-yi-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.yiSort;
      if (key === 'name') return;
      yiRender._sortDir = (yiRender._sortKey === key && yiRender._sortDir === 'desc') ? 'asc' : 'desc';
      yiRender._sortKey = key;
      yiRender();
    });
  });

  // 삭제 버튼
  list.querySelectorAll('[data-yi-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      yiItems.splice(parseInt(btn.dataset.yiDel), 1);
      yiSave(); yiRender(); yiRenderGroupTabs();
    });
  });

  // 그룹 이동 버튼
  list.querySelectorAll('.yi-grp-move').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.yiIdx);
      yiOpenGroupMovePopup(btn, idx);
    });
  });

  // 비고 툴팁
  list.querySelectorAll('.yi-memo-trigger').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const old = document.getElementById('yi-tooltip'); if (old) old.remove();
      const tip = document.createElement('div');
      tip.id = 'yi-tooltip';
      tip.textContent = el.dataset.memo;
      tip.style.cssText = 'position:fixed;background:#1e1b2e;border:1px solid var(--primary);color:var(--text);font-size:11px;padding:5px 9px;border-radius:6px;max-width:180px;word-break:keep-all;z-index:9999;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
      document.body.appendChild(tip);
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(r.left, window.innerWidth - 200) + 'px';
      tip.style.top  = (r.bottom + 4) + 'px';
    });
    el.addEventListener('mouseleave', () => document.getElementById('yi-tooltip')?.remove());
  });

  // ── 요약 렌더 ──
  const withYr = visibleItems.filter(it => it.yr !== null);
  if (!withYr.length) { if (summaryEl) summaryEl.style.display = 'none'; return; }
  if (summaryEl) summaryEl.style.display = 'block';

  const sortedYr = [...withYr].sort((a, b) => a.yr - b.yr);
  const minYr = sortedYr[0];
  const maxYr = sortedYr[sortedYr.length - 1];
  const med   = sortedYr[Math.floor(sortedYr.length / 2)];
  const avgAll = Math.round(withYr.reduce((s, it) => s + it.yr, 0) / withYr.length * 10) / 10;
  const yrcol = v => v >= 6 ? 'var(--green)' : v >= 4 ? 'var(--orange)' : '#ff6b6b';

  // ── 분포 바 (스펙트럼) ──
  const minV = minYr.yr, maxV = maxYr.yr;
  const range = maxV - minV || 1;
  const barItems = [...withYr].sort((a,b) => a.yr - b.yr);

  const spectrumDots = barItems.map((item) => {
    const origIdx = yiItems.indexOf(item);
    const pct = ((item.yr - minV) / range * 100).toFixed(1);
    const c = yrcol(item.yr);
    return `<div class="yi-dot" data-yi-row="${origIdx}" style="position:absolute;left:calc(${pct}% - 6px);top:50%;transform:translateY(-50%);
      width:12px;height:12px;border-radius:50%;background:${c};border:2px solid var(--bg1);cursor:pointer;transition:transform 0.15s;z-index:2;"
      title="${item.name||''} ${item.yr}%"></div>`;
  }).join('');

  // 평균/중위 마커
  const avgPct  = ((avgAll - minV) / range * 100).toFixed(1);
  const medPct  = ((med.yr - minV) / range * 100).toFixed(1);

  const spectrumHTML = `
  <div style="position:relative;margin:18px 4px 28px;height:4px;background:linear-gradient(to right,#ff6b6b,var(--orange),var(--green));border-radius:2px;">
    ${spectrumDots}
    <!-- 평균 마커 -->
    <div style="position:absolute;left:calc(${avgPct}% - 1px);top:-10px;width:2px;height:24px;background:rgba(255,255,255,0.5);border-radius:1px;" title="평균 ${avgAll}%">
      <div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--text3);white-space:nowrap">avg</div>
    </div>
    <!-- 중위 마커 -->
    <div style="position:absolute;left:calc(${medPct}% - 1px);top:-6px;width:2px;height:16px;background:rgba(255,255,255,0.3);border-radius:1px;" title="중위 ${med.yr}%"></div>
    <!-- 라벨 -->
    <div style="position:absolute;left:0;top:12px;font-size:10px;color:#ff6b6b;white-space:nowrap">${minV}%</div>
    <div style="position:absolute;right:0;top:12px;font-size:10px;color:var(--green);white-space:nowrap">${maxV}%</div>
    <div style="position:absolute;left:calc(${avgPct}% - 14px);top:12px;font-size:9px;color:var(--text3);white-space:nowrap">${avgAll}%</div>
  </div>`;

  // 층별 분석
  const floorGroups = {};
  withYr.forEach(it => {
    const fn = parseInt(it.floor);
    const grp = isNaN(fn) ? null : fn < 0 ? 'B(지하)' : fn === 1 ? '1층' : fn === 2 ? '2층' : fn <= 4 ? '3~4층' : '5층+';
    if (!grp) return;
    if (!floorGroups[grp]) floorGroups[grp] = [];
    floorGroups[grp].push(it.yr);
  });

  // 면적대별 분석
  const areaGroups = {};
  withYr.forEach(it => {
    const py = it.areaPy || 0;
    if (!py) return;
    const grp = py <= 10 ? '~10평' : py <= 20 ? '10~20평' : py <= 30 ? '20~30평' : py <= 50 ? '30~50평' : '50평+';
    if (!areaGroups[grp]) areaGroups[grp] = [];
    areaGroups[grp].push(it.yr);
  });

  // 금액대별 분석
  const saleGroups = {};
  withYr.forEach(it => {
    if (!it.sale) return;
    const grp = it.sale < 50000 ? '5억미만' : it.sale < 100000 ? '5~10억' : it.sale < 200000 ? '10~20억' : '20억+';
    if (!saleGroups[grp]) saleGroups[grp] = [];
    saleGroups[grp].push(it.yr);
  });

  function buildGroupTable(groups, order, labelColor) {
    const rows = order.filter(k => groups[k]?.length).map(k => {
      const arr = groups[k];
      const a = Math.round(arr.reduce((s,v)=>s+v,0)/arr.length*10)/10;
      const mx = Math.max(...arr), mn = Math.min(...arr);
      const barW = range > 0 ? Math.round((a - minV) / range * 100) : 50;
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
        <td style="padding:4px 4px;font-size:11px;color:${labelColor};font-weight:600;white-space:nowrap">${k}</td>
        <td style="padding:4px 4px;text-align:center;font-size:10px;color:var(--text3)">${arr.length}</td>
        <td style="padding:4px 6px;width:60px;">
          <div style="height:4px;background:var(--bg4);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${Math.max(barW,4)}%;background:${yrcol(a)};border-radius:2px;transition:width 0.3s"></div>
          </div>
        </td>
        <td style="padding:4px 4px;text-align:right;font-size:12px;font-weight:700;color:${yrcol(a)}">${a}%</td>
        <td style="padding:4px 4px;text-align:right;font-size:10px;color:var(--text3)">${mn===mx?'':mn+'~'+mx+'%'}</td>
      </tr>`;
    }).join('');
    if (!rows) return '';
    return `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="color:var(--text3);font-size:10px;border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:3px 4px">구분</th><th style="text-align:center;padding:3px 4px">건</th>
        <th style="padding:3px 6px"></th>
        <th style="text-align:right;padding:3px 4px">평균</th><th style="text-align:right;padding:3px 4px">범위</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  const floorTable  = buildGroupTable(floorGroups,  ['B(지하)','1층','2층','3~4층','5층+'], 'var(--primary-light)');
  const areaTable   = buildGroupTable(areaGroups,   ['~10평','10~20평','20~30평','30~50평','50평+'], '#60a5fa');
  const saleTable   = buildGroupTable(saleGroups,   ['5억미만','5~10억','10~20억','20억+'], 'var(--orange)');

  summaryGrid.innerHTML = `
    ${spectrumHTML}
    <div class="result-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">
      <div class="result-card yi-card-click" data-yi-mode="single" data-yi-row="${yiItems.indexOf(minYr)}" style="border-color:#ff6b6b33;cursor:pointer">
        <div class="result-label" style="color:var(--text3)">최저</div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${minYr.name||''}</div>
        <div class="result-value" style="color:#ff6b6b">${minYr.yr}%</div>
      </div>
      <div class="result-card yi-card-click" data-yi-mode="median" data-yi-row="${yiItems.indexOf(med)}" style="cursor:pointer">
        <div class="result-label" style="color:var(--text3)">중위</div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${med.name||''}</div>
        <div class="result-value" style="color:${yrcol(med.yr)}">${med.yr}%</div>
      </div>
      <div class="result-card yi-card-click" data-yi-mode="all" data-yi-row="-1" style="cursor:pointer">
        <div class="result-label" style="color:var(--text3)">평균</div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:2px">${withYr.length}건 전체</div>
        <div class="result-value" style="color:${yrcol(avgAll)}">${avgAll}%</div>
      </div>
      <div class="result-card highlight yi-card-click" data-yi-mode="single" data-yi-row="${yiItems.indexOf(maxYr)}" style="border-color:var(--green)33;cursor:pointer">
        <div class="result-label" style="color:var(--text3)">최고</div>
        <div style="font-size:9px;color:var(--text3);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${maxYr.name||''}</div>
        <div class="result-value" style="color:var(--green)">${maxYr.yr}%</div>
      </div>
    </div>
    ${floorTable ? `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">🏢 층별 수익률</div>${floorTable}</div>` : ''}
    ${areaTable  ? `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">📐 면적대별 수익률</div>${areaTable}</div>` : ''}
    ${saleTable  ? `<div><div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">💰 금액대별 수익률</div>${saleTable}</div>` : ''}`;

  // 카드 클릭 (카드 전체가 클릭 영역)
  summaryGrid.querySelectorAll('.yi-card-click').forEach(card => {
    card.addEventListener('click', () => {
      highlightYiRow(parseInt(card.dataset.yiRow), card.dataset.yiMode || 'single');
    });
  });

  // 스펙트럼 점 클릭
  summaryGrid.querySelectorAll('.yi-dot').forEach(dot => {
    dot.addEventListener('click', () => highlightYiRow(parseInt(dot.dataset.yiRow), 'single'));
    dot.addEventListener('mouseenter', () => { dot.style.transform = 'translateY(-50%) scale(1.6)'; });
    dot.addEventListener('mouseleave', () => { dot.style.transform = 'translateY(-50%) scale(1)'; });
  });

  // 행 클릭 → 역방향 점 하이라이트
  attachYiRowClickHandlers();
}

function highlightYiRow(origIdx, mode) {
  // mode: 'single'(기본) | 'all' | 'above-median'
  const listEl = document.getElementById('yi_list');
  if (!listEl) return;

  // 기존 하이라이트 제거
  listEl.querySelectorAll('tr[data-yi-row]').forEach(r => {
    r.style.background = '';
    r.style.outline = '';
  });
  // 스펙트럼 점 기존 효과 제거
  document.querySelectorAll('.yi-dot').forEach(d => {
    d.style.transform = 'translateY(-50%) scale(1)';
    d.style.boxShadow = '';
  });

  if (mode === 'all') {
    // 평균: 전체 행 은은하게 펄스
    listEl.querySelectorAll('tr[data-yi-row]').forEach(r => {
      r.style.background = 'rgba(124,58,237,0.12)';
    });
    document.querySelectorAll('.yi-dot').forEach(d => {
      d.style.boxShadow = '0 0 6px 3px rgba(124,58,237,0.5)';
    });
    setTimeout(() => {
      listEl.querySelectorAll('tr[data-yi-row]').forEach(r => r.style.background = '');
      document.querySelectorAll('.yi-dot').forEach(d => d.style.boxShadow = '');
    }, 2000);
    return;
  }

  if (mode === 'median') {
    // 중위: 중간값 기준 위아래 각 1개씩 + 중위값 강조
    const withYr = yiItems.filter(it => it.yr !== null).sort((a,b) => a.yr - b.yr);
    const midIdx = Math.floor(withYr.length / 2);
    [midIdx-1, midIdx, midIdx+1].forEach((i, pos) => {
      if (i < 0 || i >= withYr.length) return;
      const item = withYr[i];
      const rowIdx = yiItems.indexOf(item);
      const tr = listEl.querySelector(`tr[data-yi-row="${rowIdx}"]`);
      if (tr) {
        tr.style.background = pos === 1 ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.09)';
        if (pos === 1) tr.scrollIntoView({ behavior:'smooth', block:'nearest' });
      }
      const dot = document.querySelector(`.yi-dot[data-yi-row="${rowIdx}"]`);
      if (dot) {
        dot.style.transform = pos === 1 ? 'translateY(-50%) scale(1.8)' : 'translateY(-50%) scale(1.3)';
        dot.style.boxShadow = pos === 1 ? '0 0 8px 4px rgba(124,58,237,0.6)' : '';
      }
    });
    setTimeout(() => {
      listEl.querySelectorAll('tr[data-yi-row]').forEach(r => r.style.background = '');
      document.querySelectorAll('.yi-dot').forEach(d => {
        d.style.transform = 'translateY(-50%) scale(1)';
        d.style.boxShadow = '';
      });
    }, 2200);
    return;
  }

  // single: 특정 행 하이라이트 + 해당 점 확대
  const target = listEl.querySelector(`tr[data-yi-row="${origIdx}"]`);
  if (target) {
    target.style.background = 'rgba(124,58,237,0.22)';
    target.style.outline = '1px solid rgba(124,58,237,0.5)';
    target.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  const dot = document.querySelector(`.yi-dot[data-yi-row="${origIdx}"]`);
  if (dot) {
    dot.style.transform = 'translateY(-50%) scale(2)';
    dot.style.boxShadow = '0 0 8px 4px rgba(255,255,255,0.4)';
  }
  setTimeout(() => {
    if (target) { target.style.background = ''; target.style.outline = ''; }
    if (dot) { dot.style.transform = 'translateY(-50%) scale(1)'; dot.style.boxShadow = ''; }
  }, 2200);
}

// 행 클릭 → 스펙트럼 점 하이라이트 (역방향)
function attachYiRowClickHandlers() {
  const listEl = document.getElementById('yi_list');
  if (!listEl) return;
  listEl.querySelectorAll('tr[data-yi-row]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.yi-memo-trigger')) return;
      const idx = parseInt(tr.dataset.yiRow);
      // 점만 하이라이트 (행은 이미 클릭된 상태)
      document.querySelectorAll('.yi-dot').forEach(d => {
        d.style.transform = 'translateY(-50%) scale(1)';
        d.style.boxShadow = '';
      });
      const dot = document.querySelector(`.yi-dot[data-yi-row="${idx}"]`);
      if (dot) {
        dot.style.transform = 'translateY(-50%) scale(2)';
        dot.style.boxShadow = '0 0 8px 4px rgba(255,255,255,0.4)';
        setTimeout(() => { dot.style.transform = 'translateY(-50%) scale(1)'; dot.style.boxShadow = ''; }, 2200);
      }
      // 행 자체 배경 토글
      const prev = tr.dataset.highlighted;
      listEl.querySelectorAll('tr[data-yi-row]').forEach(r => { r.style.background = ''; r.dataset.highlighted = ''; });
      if (!prev) { tr.style.background = 'rgba(124,58,237,0.15)'; tr.dataset.highlighted = '1'; }
    });
  });
}


// ─────────────────────────────────────────
// Gemini 이미지 파싱
// ─────────────────────────────────────────
async function parseImageWithGemini(file) {
  const statusEl = document.getElementById('yi_parseStatus');
  const dropZone = document.getElementById('yi_dropZone');

  function showStatus(msg, type) {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    const bg     = { loading:'rgba(124,58,237,0.15)', error:'rgba(255,80,80,0.15)',   success:'rgba(16,185,129,0.15)' };
    const border = { loading:'rgba(124,58,237,0.3)',  error:'rgba(255,80,80,0.3)',    success:'rgba(16,185,129,0.3)'  };
    const color  = { loading:'var(--primary-light)',  error:'#ff6b6b',                success:'var(--green)'          };
    statusEl.style.background = bg[type]||bg.loading;
    statusEl.style.border     = '1px solid '+(border[type]||border.loading);
    statusEl.style.color      = color[type]||color.loading;
    statusEl.textContent      = msg;
  }

  // API 키 확인
  const stored = await new Promise(res => chrome.storage.local.get(['geminiApiKey'], r => res(r.geminiApiKey || '')));
  const apiKey = stored || document.getElementById('yi_apiKey')?.value.trim();
  if (!apiKey) {
    showStatus('❌ Gemini API 키를 먼저 입력하고 저장하세요', 'error');
    return;
  }

  showStatus('🔍 이미지 분석 중...', 'loading');
  dropZone.style.borderColor = 'var(--primary)';

  try {
    // 이미지 → base64
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    const prompt = `이 이미지는 한국 부동산 매물 정보 화면입니다.
다음 항목을 JSON으로만 추출하세요. 없는 항목은 빈 문자열로 두세요.
반드시 JSON만 응답하고 다른 텍스트는 절대 쓰지 마세요.

{
  "name": "건물명 또는 매물명 (예: 스타벅스, 복합상가, 강남빌딩)",
  "floor": "층 (숫자만, 예: 1, 5, -1)",
  "direction": "방향 (예: 남향, 동향)",
  "sale": "매매가 (원 단위 숫자만, 예: 910000000)",
  "deposit": "보증금 (원 단위 숫자만, 예: 60000000)",
  "monthly": "월세 (원 단위 숫자만, 예: 4100000)",
  "area": "전용면적 ㎡ (숫자만, 예: 33.5. 계약면적만 있으면 계약면적으로)",
  "memo": "특이사항 (현임차인 영업중, 권리금 등 간단히)"
}

금액 변환 규칙:
- "9억1천만원" → 910000000
- "6,000만원" → 60000000  
- "410만원" → 4100000`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: file.type, data: base64 } }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 512 }
        })
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || res.status;
      showStatus('❌ API 오류: ' + msg, 'error');
      dropZone.style.borderColor = 'var(--border)';
      return;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) { showStatus('❌ 파싱 실패 — 다시 시도하거나 직접 입력하세요', 'error'); dropZone.style.borderColor = 'var(--border)'; return; }

    // 폼에 채우기
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    setVal('yi_name', parsed.name);
    setVal('yi_floor', parsed.floor ? parsed.floor + '층' : '');
    setVal('yi_direction', parsed.direction);
    setVal('yi_memo', parsed.memo);
    // 전용면적
    if (parsed.area) {
      const areaEl = document.getElementById('yi_area');
      const areaPyEl = document.getElementById('yi_area_py');
      const v = parseFloat(parsed.area) || 0;
      if (areaEl) areaEl.value = v || '';
      if (areaPyEl && v > 0) areaPyEl.value = (v / 3.3058).toFixed(2);
    }

    // 금액은 만원 단위로 변환 후 콤마 포맷
    const fmtInput = (id, wonStr) => {
      if (!wonStr) return;
      const n = parseInt(String(wonStr).replace(/[^0-9]/g, ''));
      if (!n) return;
      const man = Math.round(n / 10000);
      const el = document.getElementById(id);
      if (el) el.value = man.toLocaleString('ko-KR');
    };
    fmtInput('yi_sale', parsed.sale);
    fmtInput('yi_deposit', parsed.deposit);
    fmtInput('yi_monthly', parsed.monthly);

    yiUpdatePreview();
    showStatus(`✅ 파싱 완료! 확인 후 "목록에 추가" 버튼을 누르세요`, 'success');
    dropZone.style.borderColor = 'var(--border)';

  } catch(e) {
    showStatus('❌ 네트워크 오류: ' + e.message, 'error');
    dropZone.style.borderColor = 'var(--border)';
  }
}

function yiInitEvents() {
  // ── Gemini API 키 로드/저장 ──
  chrome.storage.local.get(['geminiApiKey'], (r) => {
    if (r.geminiApiKey) {
      document.getElementById('yi_apiKey').value = r.geminiApiKey;
      document.getElementById('yi_apiKeyBar').style.borderColor = 'rgba(124,58,237,0.4)';
    }
  });
  document.getElementById('yi_apiKeySaveBtn')?.addEventListener('click', () => {
    const key = document.getElementById('yi_apiKey')?.value.trim();
    if (!key) { showToast('API 키를 입력하세요'); return; }
    chrome.storage.local.set({ geminiApiKey: key }, () => {
      showToast('API 키 저장됨');
      document.getElementById('yi_apiKeyBar').style.borderColor = 'rgba(124,58,237,0.4)';
    });
  });

  // ── 이미지 드래그앤드롭 / 클릭 ──
  const dropZone = document.getElementById('yi_dropZone');
  const imgInput = document.getElementById('yi_imgInput');

  dropZone?.addEventListener('click', () => imgInput?.click());
  imgInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) parseImageWithGemini(e.target.files[0]);
    e.target.value = '';
  });
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary)';
    dropZone.style.background = 'rgba(124,58,237,0.08)';
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background = 'var(--bg2)';
  });
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background = 'var(--bg2)';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) parseImageWithGemini(file);
    else showToast('이미지 파일만 지원됩니다');
  });

  // 콤마 포매팅
  attachCommaFormat(['yi_sale', 'yi_deposit', 'yi_monthly']);

  // 실시간 미리보기
  ['yi_sale', 'yi_deposit', 'yi_monthly'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', yiUpdatePreview);
  });

  // 추가 버튼
  document.getElementById('yi_addBtn')?.addEventListener('click', () => {
    const name      = document.getElementById('yi_name')?.value.trim() || '';
    const sale      = yiParseWon('yi_sale');
    const deposit   = yiParseWon('yi_deposit');
    const monthly   = yiParseWon('yi_monthly');
    const floor     = document.getElementById('yi_floor')?.value.trim() || '';
    const direction = document.getElementById('yi_direction')?.value.trim() || '';
    const memo      = document.getElementById('yi_memo')?.value.trim() || '';
    const area      = parseFloat(document.getElementById('yi_area')?.value) || 0; // 전용㎡
    const groupId   = document.getElementById('yi_groupSelect')?.value || '';

    if (!sale && !monthly) { showToast('매매가 또는 월세를 입력하세요'); return; }

    const { yr, yr2 } = yiCalc(sale, deposit, monthly);
    // 평당 매매가 (전용 기준)
    const areaPy = area > 0 ? Math.round(area / 3.3058 * 10) / 10 : 0;
    const salePP = (areaPy > 0 && sale > 0) ? Math.round(sale / areaPy) : 0;

    yiItems.unshift({ id: Date.now(), name, sale, deposit, monthly, floor, direction, memo, area, areaPy, salePP, groupId, yr, yr2, addedAt: new Date().toLocaleDateString('ko-KR') });
    yiSave();
    yiRender();

    // 입력 초기화
    ['yi_name','yi_sale','yi_deposit','yi_monthly','yi_floor','yi_direction','yi_memo','yi_area','yi_area_py'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('yi_preview').style.display = 'none';
    showToast('추가됐습니다');
  });

  // CSV 내보내기
  document.getElementById('yi_exportBtn')?.addEventListener('click', () => {
    if (!yiItems.length) { showToast('내보낼 데이터가 없습니다'); return; }
    const headers = ['그룹','매물명','매매가(만)','보증금(만)','월세(만)','전용면적(㎡)','전용(평)','평당가(만)','층','방향','비고','수익률(%)','실투자수익률(%)','입력일'];
    const rows = yiItems.map(it => {
      const grpName = yiGroups.find(g => g.id === it.groupId)?.name || '';
      return [grpName, it.name, it.sale, it.deposit||0, it.monthly,
        it.area||'', it.areaPy||'', it.salePP||'',
        it.floor, it.direction, it.memo,
        it.yr !== null ? it.yr : '',
        it.yr2 !== null && it.deposit > 0 ? it.yr2 : '',
        it.addedAt];
    });
    const csv = [headers, ...rows].map(r => r.map(v => '"' + String(v||'').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = '수익률목록_' + new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','') + '.csv';
    a.click();
  });

  // CSV 불러오기
  document.getElementById('yi_importBtn')?.addEventListener('click', () => {
    document.getElementById('yi_fileInput')?.click();
  });
  document.getElementById('yi_fileInput')?.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result.replace(/^\uFEFF/, '');
        const lines = text.split('\n').filter(l => l.trim());
        let imported = 0;
        lines.slice(1).forEach(line => {
          const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
          const clean = cols.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
          const [name, sale, deposit, monthly, floor, direction, memo] = clean;
          const s = parseFloat(sale) || 0;
          const d = parseFloat(deposit) || 0;
          const m = parseFloat(monthly) || 0;
          if (!s && !m) return;
          const { yr, yr2 } = yiCalc(s, d, m);
          yiItems.push({ id: Date.now() + imported, name: name||'', sale:s, deposit:d, monthly:m, floor:floor||'', direction:direction||'', memo:memo||'', yr, yr2, addedAt: new Date().toLocaleDateString('ko-KR') });
          imported++;
        });
        yiSave();
        yiRender();
        showToast(imported + '건 불러왔습니다');
      } catch(e) {
        showToast('CSV 형식이 올바르지 않습니다');
      }
      this.value = '';
    };
    reader.readAsText(file, 'UTF-8');
  });

  // 전체 삭제
  document.getElementById('yi_clearBtn')?.addEventListener('click', () => {
    if (!yiItems.length) return;
    if (!confirm(`수익률 목록 ${yiItems.length}건을 전부 삭제할까요?`)) return;
    yiItems = [];
    yiSave();
    yiRender();
  });

  // ── 하단 CSV (상단과 동일 동작) ──
  document.getElementById('yi_csvDownloadBtn')?.addEventListener('click', () => {
    document.getElementById('yi_exportBtn')?.click();
  });

  // ── 이미지/PDF 전체 캡처 ──
  document.getElementById('yi_pngDownloadBtn')?.addEventListener('click', () => yiExportCapture('png'));
  document.getElementById('yi_pdfDownloadBtn')?.addEventListener('click', () => yiExportCapture('pdf'));
}

// ── 그룹 이동 팝업 ──
function yiOpenGroupMovePopup(anchorEl, itemIdx) {
  document.getElementById('yi-grp-move-pop')?.remove();

  const item = yiItems[itemIdx];
  if (!item) return;

  const pop = document.createElement('div');
  pop.id = 'yi-grp-move-pop';

  const options = [
    { id: '', name: '그룹 없음', color: '#6060A0' },
    ...yiGroups
  ].map(g => `<div class="grp-move-opt" data-gid="${g.id}" style="
    display:flex;align-items:center;gap:7px;padding:6px 10px;cursor:pointer;border-radius:6px;
    background:${item.groupId===g.id ? 'rgba(124,58,237,0.15)' : 'transparent'};
    transition:background 0.15s;
  ">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};flex-shrink:0"></span>
    <span style="font-size:12px;color:${item.groupId===g.id ? 'var(--primary-light)' : 'var(--text2)'}">${g.name}</span>
    ${item.groupId===g.id ? '<span style="margin-left:auto;font-size:10px;color:var(--primary-light)">✓</span>' : ''}
  </div>`).join('');

  pop.style.cssText = `
    position:fixed;background:var(--bg2);border:1px solid var(--border);
    border-radius:10px;padding:8px;min-width:160px;z-index:9999;
    box-shadow:0 8px 24px rgba(0,0,0,0.5);
  `;
  pop.innerHTML = `
    <div style="font-size:10px;color:var(--text3);padding:2px 10px 6px;border-bottom:1px solid var(--border);margin-bottom:4px">
      그룹 이동 — <b style="color:var(--text2)">${(item.name||'').slice(0,10)}</b>
    </div>
    ${options}`;

  // 위치: 버튼 근처
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const popW = 180;
  let left = r.left - popW + 20;
  if (left < 4) left = 4;
  pop.style.left = left + 'px';
  pop.style.top  = (r.bottom + 4) + 'px';

  pop.querySelectorAll('.grp-move-opt').forEach(opt => {
    opt.addEventListener('mouseenter', () => opt.style.background = 'rgba(124,58,237,0.12)');
    opt.addEventListener('mouseleave', () => opt.style.background = item.groupId===opt.dataset.gid ? 'rgba(124,58,237,0.15)' : 'transparent');
    opt.addEventListener('click', () => {
      yiItems[itemIdx].groupId = opt.dataset.gid;
      yiSave(); yiRender(); yiRenderGroupTabs();
      pop.remove();
    });
  });

  // 외부 클릭 시 닫기
  setTimeout(() => {
    document.addEventListener('click', function closeP(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', closeP); }
    });
  }, 10);
}


// ─────────────────────────────────────────
// 수익률 탭 전체 캡처 (PNG / PDF)
// ─────────────────────────────────────────
async function yiExportCapture(format) {
  if (!yiItems.length) { showToast('내보낼 데이터가 없습니다'); return; }
  showToast('캡처 생성 중...');

  const PAD   = 14;
  const W     = 380;
  const lineH = 24;
  const dpr   = 2;

  // ★ 충분히 크게 — 나중에 실제 y 기준으로 trim
  const canvas = document.createElement('canvas');
  canvas.width  = W * dpr;
  canvas.height = 8000 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0F0F1A';
  ctx.fillRect(0, 0, W, 8000);

  let y = PAD;

  // ── 헬퍼 ──
  function rr(x, yy, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x+r,yy); ctx.lineTo(x+w-r,yy); ctx.quadraticCurveTo(x+w,yy,x+w,yy+r);
    ctx.lineTo(x+w,yy+h-r); ctx.quadraticCurveTo(x+w,yy+h,x+w-r,yy+h);
    ctx.lineTo(x+r,yy+h); ctx.quadraticCurveTo(x,yy+h,x,yy+h-r);
    ctx.lineTo(x,yy+r); ctx.quadraticCurveTo(x,yy,x+r,yy);
    ctx.closePath();
    if (fill)   { ctx.fillStyle=fill;   ctx.fill();   }
    if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke(); }
  }
  const yrcol = v => v>=6?'#10B981':v>=4?'#F59E0B':'#ff6b6b';
  const fmtM  = v => {
    if (!v) return '-';
    if (v>=10000) return (v/10000).toFixed(1).replace(/\.0$/,'')+'억';
    return v.toLocaleString('ko-KR')+'만';
  };
  function sectionHeader(label) {
    rr(PAD, y, W-PAD*2, 24, 6, '#1A1A2E', 'rgba(124,58,237,0.3)');
    ctx.font='bold 12px sans-serif'; ctx.fillStyle='#8B5CF6';
    ctx.fillText(label, PAD+8, y+16); y+=32;
  }
  function hline() {
    ctx.fillStyle='rgba(124,58,237,0.25)'; ctx.fillRect(PAD,y,W-PAD*2,1); y+=1;
  }

  // ── 헤더 ──
  const activeGrpName = yiActiveGroup==='all' ? '전체' : (yiGroups.find(g=>g.id===yiActiveGroup)?.name||'전체');
  ctx.font='bold 17px sans-serif'; ctx.fillStyle='#8B5CF6';
  ctx.fillText('📊 수익률 분석 — '+activeGrpName, PAD, y+15); y+=28;
  ctx.font='10px sans-serif'; ctx.fillStyle='#6060A0';
  ctx.fillText(new Date().toLocaleDateString('ko-KR'), PAD, y+10); y+=22;

  // ── 목록 ──
  const visItems = yiActiveGroup==='all' ? yiItems : yiItems.filter(it=>it.groupId===yiActiveGroup);
  const withYr   = visItems.filter(it=>it.yr!==null);

  sectionHeader(`📋 수익률 목록 (${visItems.length}건)`);

  // 컬럼 X 위치
  const CX = { grp:PAD+2, name:PAD+10, floor:PAD+120, area:PAD+158, price:PAD+196, yr:PAD+292 };

  // 헤더행
  ctx.font='bold 9px sans-serif'; ctx.fillStyle='#6060A0';
  ['매물명','층','면적','매매가','수익률'].forEach((t,i)=>{
    const xs=[CX.name,CX.floor,CX.area,CX.price,CX.yr];
    ctx.fillText(t, xs[i], y+9);
  });
  y+=12; hline(); y+=6;

  // 데이터 행
  visItems.forEach((item, i) => {
    const grp = yiGroups.find(g=>g.id===item.groupId);
    const hasGrpLabel = grp && yiActiveGroup==='all';
    const rowH = hasGrpLabel ? lineH+10 : lineH;

    // 짝수행 배경
    if (i%2===0) { ctx.fillStyle='rgba(255,255,255,0.025)'; ctx.fillRect(PAD,y-1,W-PAD*2,rowH+1); }

    let nameY = y + (hasGrpLabel ? lineH-2 : lineH/2+4);

    // 그룹 태그 (전체 보기일 때)
    if (hasGrpLabel) {
      rr(CX.name-2, y+2, ctx.measureText(grp.name).width+14, 13, 3, grp.color+'33', grp.color+'66');
      ctx.font='bold 8px sans-serif'; ctx.fillStyle=grp.color;
      ctx.fillText(grp.name, CX.name+4, y+11);
    }

    // 그룹 색점
    if (grp && yiActiveGroup==='all') {
      ctx.beginPath(); ctx.arc(CX.grp+3, nameY-4, 3, 0, Math.PI*2);
      ctx.fillStyle=grp.color; ctx.fill();
    }

    ctx.font='11px sans-serif'; ctx.fillStyle='#F0F0FF';
    ctx.fillText((item.name||'(미입력)').slice(0,14), CX.name+(grp&&yiActiveGroup==='all'?6:0), nameY);
    if (item.direction) { ctx.font='8px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText(item.direction, CX.name+(grp&&yiActiveGroup==='all'?6:0), nameY+9); }

    const midY = y+rowH/2+4;
    ctx.font='10px sans-serif'; ctx.fillStyle='#A0A0C0';
    ctx.fillText(item.floor||'-', CX.floor, midY);
    ctx.fillText(item.areaPy>0?item.areaPy+'평':'-', CX.area, midY);

    ctx.fillStyle='#3B82F6';
    ctx.fillText(fmtM(item.sale), CX.price, midY-4);
    if (item.deposit>0) { ctx.font='8px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText('보'+fmtM(item.deposit), CX.price, midY+6); }
    if (item.monthly>0) { ctx.font='8px sans-serif'; ctx.fillStyle='#10B981'; ctx.fillText('월'+fmtM(item.monthly), CX.price, midY+15); }

    if (item.yr!==null) {
      ctx.font='bold 13px sans-serif'; ctx.fillStyle=yrcol(item.yr);
      ctx.fillText(item.yr+'%', CX.yr, midY-3);
      if (item.yr2!==null&&item.deposit>0) { ctx.font='8px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText('실'+item.yr2+'%', CX.yr, midY+8); }
    }
    y+=rowH;
  });

  y+=16;

  // ── 요약 ──
  if (withYr.length) {
    sectionHeader('📊 수익률 분석 요약');

    const sortedYr=[...withYr].sort((a,b)=>a.yr-b.yr);
    const minIt=sortedYr[0], maxIt=sortedYr[sortedYr.length-1];
    const medIt=sortedYr[Math.floor(sortedYr.length/2)];
    const avg=Math.round(withYr.reduce((s,it)=>s+it.yr,0)/withYr.length*10)/10;
    const minV=minIt.yr, maxV=maxIt.yr, rng=maxV-minV||1;

    // 스펙트럼 바
    const barX=PAD+14, barW=W-PAD*2-28, barH=10;
    y+=14; // avg 라벨 공간
    const grad=ctx.createLinearGradient(barX,0,barX+barW,0);
    grad.addColorStop(0,'#ff6b6b'); grad.addColorStop(0.5,'#F59E0B'); grad.addColorStop(1,'#10B981');
    rr(barX,y,barW,barH,5,null,null); ctx.fillStyle=grad; ctx.fill();

    const dotX=v=>barX+((v-minV)/rng)*barW;

    // avg 라인
    const ax=dotX(avg);
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.fillRect(ax-1,y-10,2,barH+20);
    ctx.font='9px sans-serif'; ctx.fillStyle='#A0A0C0';
    ctx.fillText('avg', ax-10, y-12);
    ctx.fillText(avg+'%', ax-10, y+barH+16);

    // 매물 점
    withYr.forEach(it=>{
      ctx.beginPath(); ctx.arc(dotX(it.yr),y+barH/2,6,0,Math.PI*2);
      ctx.fillStyle=yrcol(it.yr); ctx.fill();
      ctx.strokeStyle='#0F0F1A'; ctx.lineWidth=2; ctx.stroke();
    });

    // 최저/최고 라벨
    ctx.font='10px sans-serif'; ctx.fillStyle='#ff6b6b'; ctx.fillText(minV+'%',barX,y+barH+16);
    ctx.fillStyle='#10B981';
    const mlw=ctx.measureText(maxV+'%').width;
    ctx.fillText(maxV+'%',barX+barW-mlw,y+barH+16);
    y+=barH+32;

    // 4 카드
    const cw=Math.floor((W-PAD*2-9)/4);
    [
      {label:'최저',sub:minIt.name,val:minIt.yr+'%',color:'#ff6b6b'},
      {label:'중위',sub:medIt.name,val:medIt.yr+'%',color:yrcol(medIt.yr)},
      {label:'평균',sub:withYr.length+'건',val:avg+'%',color:yrcol(avg)},
      {label:'최고',sub:maxIt.name,val:maxIt.yr+'%',color:'#10B981'},
    ].forEach((c,i)=>{
      const cx=PAD+i*(cw+3);
      rr(cx,y,cw,62,8,'#1A1A2E','rgba(124,58,237,0.22)');
      ctx.font='9px sans-serif'; ctx.fillStyle='#A0A0C0'; ctx.fillText(c.label,cx+7,y+13);
      ctx.font='9px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText((c.sub||'').slice(0,7),cx+7,y+25);
      ctx.font='bold 16px sans-serif'; ctx.fillStyle=c.color; ctx.fillText(c.val,cx+7,y+52);
    });
    y+=74;

    // 분석 테이블 그리기
    function drawTable(title, groups, order, labelColor) {
      if (!order.some(k=>groups[k]?.length)) return;
      ctx.font='bold 11px sans-serif'; ctx.fillStyle='#A0A0C0'; ctx.fillText(title,PAD,y+12); y+=18;
      ctx.fillStyle='rgba(124,58,237,0.2)'; ctx.fillRect(PAD,y,W-PAD*2,1); y+=7;
      order.filter(k=>groups[k]?.length).forEach(k=>{
        const arr=groups[k];
        const a=Math.round(arr.reduce((s,v)=>s+v,0)/arr.length*10)/10;
        const mn=Math.min(...arr), mx=Math.max(...arr);
        ctx.font='bold 11px sans-serif'; ctx.fillStyle=labelColor; ctx.fillText(k,PAD+4,y+12);
        ctx.font='10px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText(arr.length+'건',PAD+82,y+12);
        const bx=PAD+112,bw=72;
        rr(bx,y+4,bw,7,3,'#2D2D50',null);
        rr(bx,y+4,Math.max(5,Math.round((a-minV)/rng*bw)),7,3,yrcol(a),null);
        ctx.font='bold 12px sans-serif'; ctx.fillStyle=yrcol(a); ctx.fillText(a+'%',PAD+192,y+12);
        if (mn!==mx) { ctx.font='9px sans-serif'; ctx.fillStyle='#6060A0'; ctx.fillText(mn+'~'+mx+'%',PAD+242,y+12); }
        y+=lineH;
      });
      y+=10;
    }

    const floorG={}, areaG={}, saleG={};
    withYr.forEach(it=>{
      const fn=parseInt(it.floor);
      const fg=isNaN(fn)?null:fn<0?'B(지하)':fn===1?'1층':fn===2?'2층':fn<=4?'3~4층':'5층+';
      if(fg){floorG[fg]=floorG[fg]||[];floorG[fg].push(it.yr);}
      const py=it.areaPy||0;
      if(py){const ag=py<=10?'~10평':py<=20?'10~20평':py<=30?'20~30평':py<=50?'30~50평':'50평+';areaG[ag]=areaG[ag]||[];areaG[ag].push(it.yr);}
      if(it.sale){const sg=it.sale<50000?'5억미만':it.sale<100000?'5~10억':it.sale<200000?'10~20억':'20억+';saleG[sg]=saleG[sg]||[];saleG[sg].push(it.yr);}
    });
    drawTable('🏢 층별 수익률',    floorG, ['B(지하)','1층','2층','3~4층','5층+'],          '#8B5CF6');
    drawTable('📐 면적대별 수익률', areaG,  ['~10평','10~20평','20~30평','30~50평','50평+'], '#60a5fa');
    drawTable('💰 금액대별 수익률', saleG,  ['5억미만','5~10억','10~20억','20억+'],          '#F59E0B');
  }

  // ── canvas를 실제 그린 높이로 trim ──
  y += PAD;
  const trimCanvas = document.createElement('canvas');
  trimCanvas.width  = W * dpr;
  trimCanvas.height = Math.ceil(y * dpr);
  trimCanvas.getContext('2d').drawImage(canvas, 0, 0);

  const dateStr = new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','');

  if (format === 'png') {
    trimCanvas.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `수익률분석_${dateStr}.png`;
      a.click();
      showToast('✅ 이미지 저장 완료');
    }, 'image/png');
    return;
  }

  // PDF — 새 탭에서 이미지 전체 표시 후 인쇄
  const dataUrl = trimCanvas.toDataURL('image/png');
  const win = window.open('');
  if (!win) { showToast('팝업 차단됨 — 허용 후 재시도'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>수익률분석_${dateStr}</title>
    <style>
      *{margin:0;padding:0}
      body{background:#0F0F1A}
      img{width:100%;display:block}
      @media print{@page{size:A4;margin:0} img{width:100%;height:auto}}
    </style>
  </head><body><img src="${dataUrl}" onload="window.print()"></body></html>`);
  win.document.close();
  showToast('인쇄 다이얼로그에서 PDF로 저장하세요');
}

// ─────────────────────────────────────────
// 수익률 계산기 탭
// ─────────────────────────────────────────
function parseMoneyVal(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseInt(el.value.replace(/,/g, '')) || 0;
}
function fmtWon(val) {
  if (val >= 100000000) return (val / 100000000).toFixed(2) + '억';
  if (val >= 10000) return Math.round(val / 10000) + '만';
  return val.toLocaleString() + '원';
}

function calcYieldCalc() {
  const price = parseMoneyVal('yc_price');
  const deposit = parseMoneyVal('yc_deposit');
  const monthly = parseMoneyVal('yc_monthly');
  const expense = parseMoneyVal('yc_expense');
  if (!price || !monthly) return;
  const annualRent = monthly * 12;
  const noi = annualRent - expense;
  const noiYield = (noi / price * 100).toFixed(2);
  const realInvest = price - deposit;
  const realYield = realInvest > 0 ? (noi / realInvest * 100).toFixed(2) : '-';
  document.getElementById('yc_r_noi').textContent = noiYield + '%';
  document.getElementById('yc_r_noi_amt').textContent = fmtWon(noi) + ' / 년';
  document.getElementById('yc_r_realinvest').textContent = fmtWon(realInvest);
  document.getElementById('yc_r_realyield').textContent = realYield !== '-' ? realYield + '%' : '-';
  document.getElementById('yc_result1').style.display = 'block';
}

function calcYieldReverse() {
  const price = parseMoneyVal('yr_price');
  const deposit = parseMoneyVal('yr_deposit');
  const target = parseFloat(document.getElementById('yr_target')?.value) || 5;
  const expense = parseMoneyVal('yr_expense');
  if (!price) return;
  const needAnnual = price * target / 100 + expense;
  const needMonthly = Math.ceil(needAnnual / 12);
  const realInvest = price - deposit;
  const needMonthly2 = realInvest > 0 ? Math.ceil((realInvest * target / 100 + expense) / 12) : 0;
  document.getElementById('yr_r_monthly').textContent = fmtWon(needMonthly) + ' / 월';
  document.getElementById('yr_r_annual').textContent = fmtWon(needAnnual) + ' / 년';
  document.getElementById('yr_r_monthly2').textContent = needMonthly2 > 0 ? fmtWon(needMonthly2) + ' / 월' : '-';
  document.getElementById('yc_result2').style.display = 'block';
}

// 이벤트 바인딩
['yc_price','yc_deposit','yc_monthly','yc_expense'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', function() {
    // 콤마 포맷
    const raw = this.value.replace(/,/g,'');
    if (!isNaN(raw) && raw !== '') this.value = parseInt(raw).toLocaleString();
    calcYieldCalc();
  });
});
['yr_price','yr_deposit','yr_target','yr_expense'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', function() {
    if (id !== 'yr_target') {
      const raw = this.value.replace(/,/g,'');
      if (!isNaN(raw) && raw !== '') this.value = parseInt(raw).toLocaleString();
    }
    calcYieldReverse();
  });
});

// ─────────────────────────────────────────
// ㎡ ↔ 평 양방향 자동변환 (정적 페어 전용)
// 페어 정의: [㎡ input ID, 평 input ID, 연결된 계산 함수]
// ─────────────────────────────────────────
const SQM_PY = 3.3058;
function sqmToPy(v){ return parseFloat((v / SQM_PY).toFixed(2)); }
function pyToSqm(v){ return parseFloat((v * SQM_PY).toFixed(2)); }

function bindAreaPair(sqmId, pyId, onChangeFn) {
  const sqmEl = document.getElementById(sqmId);
  const pyEl = document.getElementById(pyId);
  if (!sqmEl || !pyEl) return;
  let busy = false;
  sqmEl.addEventListener('input', () => {
    if (busy) return; busy = true;
    const v = parseFloat(sqmEl.value);
    pyEl.value = (!isNaN(v) && v > 0) ? sqmToPy(v) : '';
    busy = false;
    if (onChangeFn) onChangeFn();
  });
  pyEl.addEventListener('input', () => {
    if (busy) return; busy = true;
    const v = parseFloat(pyEl.value);
    sqmEl.value = (!isNaN(v) && v > 0) ? pyToSqm(v) : '';
    busy = false;
    if (onChangeFn) onChangeFn();
  });
}

function initAreaDualInputs() {
  // 매매분석 탭
  bindAreaPair('s_excArea', 's_excArea_py', calcSale);
  // 수익률 입력 탭 (시장분석 > 수익률 서브탭)
  bindAreaPair('yi_area', 'yi_area_py', () => {
    // yi_area 변경 시 수익률 미리보기 갱신 (yiPreview 함수가 있으면 호출)
    if (typeof yiCalcPreview === 'function') yiCalcPreview();
  });
  // 수익률 계산기 탭은 면적 없으므로 패스
}

// ═══════════════════════════════════════════════════
// 새 탭 구조 초기화
// ═══════════════════════════════════════════════════
// 새 탭 구조 초기화
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // 경매 서브탭
  document.querySelectorAll('.sub-tab-btn[data-atab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.tab-panel');
      parent.querySelectorAll('.sub-tab-btn[data-atab]').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelector('#atab-' + btn.dataset.atab)?.classList.add('active');
    });
  });
  // 상가 서브탭 (stab)
  document.querySelectorAll('.sub-tab-btn[data-stab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.tab-panel');
      parent.querySelectorAll('.sub-tab-btn[data-stab]').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('[id^="stab-"]').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('stab-' + btn.dataset.stab)?.classList.add('active');
    });
  });
  // 면적 서브탭
  document.querySelectorAll('.sub-tab-btn[data-atab2]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.tab-panel');
      parent.querySelectorAll('.sub-tab-btn[data-atab2]').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelector('#atab2-' + btn.dataset.atab2)?.classList.add('active');
    });
  });
  // 세금 유형 선택 (개인/개인사업자/법인)
  let taxType = 'personal';
  document.querySelectorAll('[data-tax-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tax-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      taxType = btn.dataset.taxType;
      updateTaxTypeUI(taxType);
    });
  });
  // 세금 서브탭 (취득세/임대소득세/양도세/보유세)
  document.querySelectorAll('.sub-tab-btn[data-tax-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn[data-tax-sub]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sub-tax-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      const panel = document.getElementById('tax-' + btn.dataset.taxSub);
      if (panel) panel.style.display = 'block';
    });
  });
  // 세금 입력 이벤트
  ['tax_acq_price','tax_acq_type'].forEach(id => document.getElementById(id)?.addEventListener('input', calcTaxAcquire));
  ['tax_hold_price','tax_hold_ratio'].forEach(id => document.getElementById(id)?.addEventListener('input', calcTaxHold));
  ['tax_tr_buy','tax_tr_sell','tax_tr_years','tax_tr_deduct'].forEach(id => document.getElementById(id)?.addEventListener('input', () => calcTaxTransfer(taxType)));
  ['tax_inc_revenue','tax_inc_expense','tax_inc_deduct','tax_inc_other'].forEach(id => document.getElementById(id)?.addEventListener('input', () => calcTaxIncome(taxType)));

  // ㎡↔평 추가 페어
  bindAreaPair('rt_area_sqm', 'rt_area_py', null);
  bindAreaPair('qp_sqm', 'qp_py', calcQuickPyeong);

  // 면적 변환기
  document.getElementById('conv_sqm')?.addEventListener('input', function() {
    const v = parseFloat(this.value);
    document.getElementById('conv_py').value = v > 0 ? (v / 3.3058).toFixed(2) : '';
  });
  document.getElementById('conv_py2')?.addEventListener('input', function() {
    const v = parseFloat(this.value);
    document.getElementById('conv_sqm2').value = v > 0 ? (v * 3.3058).toFixed(2) : '';
  });

  // 평당가 빠른계산
  ['qp_price','qp_sqm','qp_py'].forEach(id => document.getElementById(id)?.addEventListener('input', calcQuickPyeong));

  // 스마트 수익률 (통합)
  initSmartYield();

  // 경매 계산기 - 실시간
  initAuctionCalc();

  // 일반 계산기
  initBasicCalc();

});


// ═══════════════════════════════════════════════════
// 스마트 수익률 계산기
// ═══════════════════════════════════════════════════
let smPinned = 'yield'; // 기본: 수익률 계산

function initSmartYield() {
  document.querySelectorAll('.smart-pin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.smart-pin-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      smPinned = btn.dataset.field;
      // 고정된 필드 입력 비활성화
      ['price','deposit','monthly','yield'].forEach(f => {
        const el = document.getElementById('sm_' + f);
        if (!el) return;
        el.readOnly = (f === smPinned);
        el.style.background = (f === smPinned) ? 'var(--bg4)' : '';
        el.style.color = (f === smPinned) ? 'var(--primary-light)' : '';
      });
      calcSmartYield();
    });
  });
  ['sm_price','sm_deposit','sm_monthly','sm_yield','sm_expense'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', function() {
      if (id !== 'sm_yield' && id !== 'sm_expense') {
        const raw = this.value.replace(/,/g,'');
        if (/^\d+$/.test(raw)) this.value = parseInt(raw).toLocaleString();
      }
      calcSmartYield();
    });
  });
  // 초기: 수익률 필드 읽기전용
  const yieldEl = document.getElementById('sm_yield');
  if (yieldEl) { yieldEl.readOnly = true; yieldEl.style.background = 'var(--bg4)'; yieldEl.style.color = 'var(--primary-light)'; }
}

function smParseWon(id) { return parseInt((document.getElementById(id)?.value||'').replace(/,/g,''))||0; }

function calcSmartYield() {
  const price = smParseWon('sm_price');
  const deposit = smParseWon('sm_deposit');
  const monthly = smParseWon('sm_monthly');
  const yieldPct = parseFloat(document.getElementById('sm_yield')?.value)||0;
  const expense = smParseWon('sm_expense');
  const realInvest = price - deposit;
  let calcVal = null, label = '', detail = '';

  if (smPinned === 'yield') {
    if (!price || !monthly) { document.getElementById('sm_result').style.display='none'; return; }
    const yr = realInvest > 0 ? (monthly*12/realInvest*100) : 0;
    const el = document.getElementById('sm_yield');
    if (el) el.value = yr.toFixed(2);
    calcVal = yr; label = '수익률';
    detail = `실투자금 ${fmtMan(realInvest)} | 연 임대수익 ${fmtMan(monthly*12)}`;
  } else if (smPinned === 'price') {
    if (!monthly || !yieldPct) { document.getElementById('sm_result').style.display='none'; return; }
    const p = (monthly*12 / (yieldPct/100)) + deposit;
    document.getElementById('sm_price').value = Math.round(p).toLocaleString();
    calcVal = p; label = '적정 매매가';
    detail = `보증금 포함 실투자금 기준`;
  } else if (smPinned === 'deposit') {
    if (!price || !monthly || !yieldPct) { document.getElementById('sm_result').style.display='none'; return; }
    const d = price - (monthly*12/(yieldPct/100));
    document.getElementById('sm_deposit').value = Math.max(0,Math.round(d)).toLocaleString();
    calcVal = d; label = '적정 보증금';
    detail = `매매가 ${fmtMan(price)} 기준`;
  } else if (smPinned === 'monthly') {
    if (!price || !yieldPct) { document.getElementById('sm_result').style.display='none'; return; }
    const m = realInvest * (yieldPct/100) / 12;
    document.getElementById('sm_monthly').value = Math.round(m).toLocaleString();
    calcVal = m; label = '필요 월세';
    detail = `실투자금 ${fmtMan(realInvest)} × ${yieldPct}% ÷ 12`;
  }

  if (calcVal === null) return;
  const currentMonthly = smParseWon('sm_monthly');
  const yr = smPinned === 'yield' ? calcVal : (realInvest > 0 ? currentMonthly*12/realInvest*100 : 0);
  const color = yr >= 6 ? 'var(--green)' : yr >= 4 ? 'var(--orange)' : 'var(--red)';
  const grade = yr >= 6 ? '🟢 우수' : yr >= 4 ? '🟡 양호' : '🔴 주의';
  document.getElementById('sm_resultGrid').innerHTML =
    `<div class="result-card highlight"><div class="result-label">${label}</div><div class="result-value" style="color:${color}">${smPinned==='yield'?calcVal.toFixed(2)+'%':fmtMan(Math.round(calcVal))}</div></div>` +
    `<div class="result-card"><div class="result-label">수익률 등급</div><div class="result-value" style="font-size:13px">${grade}</div></div>` +
    `<div class="result-card"><div class="result-label">실투자금</div><div class="result-value orange">${fmtMan(smParseWon('sm_price')-smParseWon('sm_deposit'))}</div></div>` +
    `<div class="result-card"><div class="result-label">연 임대수익</div><div class="result-value">${fmtMan(currentMonthly*12)}</div></div>`;
  document.getElementById('sm_resultDetail').innerHTML = detail;

  // NOI 계산 (연비용 입력시)
  const noiWrap = document.getElementById('sm_noi_wrap');
  if (expense > 0 && currentMonthly > 0 && price > 0) {
    const annualRev = currentMonthly * 12;
    const noi = annualRev - expense;
    const noiRate = realInvest > 0 ? (noi / realInvest * 100) : 0;
    const realYield = price > 0 ? (noi / price * 100) : 0;
    document.getElementById('yc_r_noi').textContent = noiRate.toFixed(2) + '%';
    document.getElementById('yc_r_noi_amt').textContent = fmtMan(noi);
    document.getElementById('yc_r_realyield').textContent = realYield.toFixed(2) + '%';
    if (noiWrap) noiWrap.style.display = 'block';
  } else {
    if (noiWrap) noiWrap.style.display = 'none';
  }

  // 목표수익률별 필요 월세 역산 테이블
  const reverseRates = [4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0];
  const reverseEl = document.getElementById('sm_reverse_table');
  if (reverseEl && realInvest > 0) {
    reverseEl.innerHTML = `<table class="cashflow-table"><thead><tr><th>목표 수익률</th><th style="text-align:right">필요 월세</th><th style="text-align:right">필요 연세</th></tr></thead><tbody>` +
      reverseRates.map(r => {
        const needMonthly = realInvest * (r/100) / 12;
        const isCurrent = currentMonthly > 0 && Math.abs(r - yr) < 0.5;
        const rowStyle = isCurrent ? 'background:rgba(124,58,237,0.12);font-weight:700' : '';
        return `<tr style="${rowStyle}"><td style="color:var(--primary-light)">${r.toFixed(1)}%</td><td style="text-align:right">${fmtMan(Math.round(needMonthly))}</td><td style="text-align:right">${fmtMan(Math.round(needMonthly*12))}</td></tr>`;
      }).join('') + '</tbody></table>';
  }

  document.getElementById('sm_result').style.display = 'block';
}

// ═══════════════════════════════════════════════════
// 경매 - 실시간 엑셀 스타일 계산기
// ═══════════════════════════════════════════════════
const WON_FMT = v => Math.round(v).toLocaleString('ko-KR');
const pWon = id => parseInt((document.getElementById(id)?.value||'').replace(/,/g,''))||0;
const pNum = id => parseFloat(document.getElementById(id)?.value)||0;
const setXl = (id, val, isAmt=true) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = isAmt ? (val !== 0 ? WON_FMT(val) : '0') : val;
};

// 콤마 포맷 헬퍼
function xlComma(el) {
  if (!el) return;
  el.addEventListener('input', function() {
    const raw = this.value.replace(/,/g,'');
    if (/^\d+$/.test(raw) && raw !== '') this.value = parseInt(raw).toLocaleString();
  });
}


function saveAuctionDefaults() {
  const ids = ['fl_bid_rate','fl_loan_rate','fl_acq_tax','fl_legal_rate',
               'rt_bid_rate','rt_reg_rate','rt_loan_rate','rt_interest'];
  const defaults = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value) defaults[id] = el.value;
  });
  chrome.storage.local.set({ auctionDefaults: defaults });
}
function initAuctionCalc() {
  // ── 요율 기본값 로드 (저장된 값 우선, 없으면 HTML default) ──
  const FLIP_RATE_IDS = ['fl_bid_rate','fl_loan_rate','fl_acq_tax','fl_legal_rate'];
  const RENT_RATE_IDS = ['rt_bid_rate','rt_reg_rate','rt_loan_rate','rt_interest'];
  const ALL_RATE_IDS = [...FLIP_RATE_IDS, ...RENT_RATE_IDS];
  chrome.storage.local.get(['auctionDefaults'], r => {
    const defaults = r.auctionDefaults || {};
    ALL_RATE_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && defaults[id] !== undefined) el.value = defaults[id];
    });
  });
  // 단타매도 입력 콤마
  ['fl_appraisal','fl_bid','fl_mgmt','fl_repair','fl_evict','fl_sellprice','fl_memo_amt'].forEach(id => xlComma(document.getElementById(id)));
  // 임대 입력 콤마
  ['rt_bid','rt_evict','rt_demolish','rt_mgmt_monthly','rt_reserve','rt_deposit','rt_monthly','rt_memo_amt'].forEach(id => xlComma(document.getElementById(id)));

  // 단타매도: 모든 입력에 실시간 계산 연결
  const flipIds = ['fl_appraisal','fl_bid','fl_bid_rate','fl_loan_rate',
    'fl_acq_tax','fl_legal_rate','fl_prepay_rate','fl_interest_rate',
    'fl_agent_rate','fl_mgmt','fl_repair','fl_evict','fl_sellprice','fl_transfer_tax','fl_memo_amt'];
  flipIds.forEach(id => document.getElementById(id)?.addEventListener('input', calcFlipLive));

  // 입찰가율 변경 → 입찰가 자동계산
  ['fl_appraisal','fl_bid_rate'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const ap = pWon('fl_appraisal');
      const r  = pNum('fl_bid_rate');
      if (ap && r) {
        const bidEl = document.getElementById('fl_bid');
        if (bidEl && !bidEl._manualEdit) bidEl.value = WON_FMT(Math.round(ap * r / 100));
      }
      calcFlipLive();
    });
  });
  // 입찰가 직접 수정 감지
  document.getElementById('fl_bid')?.addEventListener('focus', function() { this._manualEdit = true; });

  // 임대: 모든 입력에 실시간 계산 연결
  const rentIds = ['rt_bid','rt_reg_rate','rt_loan_rate','rt_interest',
    'rt_evict','rt_demolish','rt_mgmt_months','rt_mgmt_monthly','rt_reserve',
    'rt_deposit','rt_monthly','rt_memo_amt'];
  rentIds.forEach(id => document.getElementById(id)?.addEventListener('input', calcRentLive));

  // 사용자 지정 수익률 변경 시 재계산
  ['rt_cust_rate1','rt_cust_rate2','rt_cust_rate3'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', calcRentLive)
  );

  // 면적 자동변환
  bindAreaPair('rt_area_sqm', 'rt_area_py', null);

  // ── 경매 저장/불러오기 ──
  initAuctionSave();
}

function initAuctionSave() {
  // 주택경매 저장
  document.getElementById('fl_saveBtn')?.addEventListener('click', () => {
    const name = document.getElementById('fl_save_name')?.value.trim() || ('주택경매_' + new Date().toLocaleDateString('ko-KR'));
    const data = collectFlipData();
    // 요율 기본값 저장
    saveAuctionDefaults();
    chrome.storage.local.get(['savedAuctionFlip'], r => {
      const list = r.savedAuctionFlip || [];
      list.unshift({ id: Date.now(), name, data, savedAt: new Date().toLocaleDateString('ko-KR') });
      chrome.storage.local.set({ savedAuctionFlip: list }, () => {
        showToast('저장됐습니다');
        renderAuctionSavedList('flip');
      });
    });
  });

  // 상가경매 저장
  document.getElementById('rt_saveBtn')?.addEventListener('click', () => {
    const name = document.getElementById('rt_save_name')?.value.trim() || ('상가경매_' + new Date().toLocaleDateString('ko-KR'));
    const data = collectRentData();
    // 요율 기본값 저장
    saveAuctionDefaults();
    chrome.storage.local.get(['savedAuctionRent'], r => {
      const list = r.savedAuctionRent || [];
      list.unshift({ id: Date.now(), name, data, savedAt: new Date().toLocaleDateString('ko-KR') });
      chrome.storage.local.set({ savedAuctionRent: list }, () => {
        showToast('저장됐습니다');
        renderAuctionSavedList('rent');
      });
    });
  });

  // 다운로드 버튼 - 주택경매
  document.getElementById('fl_pngBtn')?.addEventListener('click', () => exportAuctionCapture('flip', 'png'));
  document.getElementById('fl_pdfBtn')?.addEventListener('click', () => exportAuctionCapture('flip', 'pdf'));
  document.getElementById('fl_csvBtn')?.addEventListener('click', () => exportAuctionCSV('flip'));

  // 다운로드 버튼 - 상가경매
  document.getElementById('rt_pngBtn')?.addEventListener('click', () => exportAuctionCapture('rent', 'png'));
  document.getElementById('rt_pdfBtn')?.addEventListener('click', () => exportAuctionCapture('rent', 'pdf'));
  document.getElementById('rt_csvBtn')?.addEventListener('click', () => exportAuctionCSV('rent'));

  // 저장 목록 초기 렌더
  renderAuctionSavedList('flip');
  renderAuctionSavedList('rent');
}

function collectFlipData() {
  const ids = ['fl_case','fl_appraisal','fl_bid_rate','fl_bid','fl_loan_rate',
    'fl_acq_tax','fl_legal_rate','fl_prepay_rate','fl_interest_rate','fl_memo_amt',
    'fl_agent_rate','fl_mgmt','fl_repair','fl_evict','fl_sellprice','fl_transfer_tax',
    'fl_mgmt_memo','fl_evict_memo','fl_repair_memo','fl_memo_label'];
  const result = {};
  ids.forEach(id => { result[id] = document.getElementById(id)?.value || ''; });
  ['fl_r_loan','fl_r_acq','fl_r_legal','fl_r_prepay','fl_r_interest','fl_r_agent',
   'fl_r_total_cost','fl_r_total_invest','fl_r_real_invest','fl_r_gain','fl_r_income_tax',
   'fl_r_net_profit','fl_r_roi'].forEach(id => {
    result[id] = document.getElementById(id)?.textContent || '';
  });
  return result;
}

function collectRentData() {
  const ids = ['rt_area_sqm','rt_area_py','rt_bid','rt_reg_rate','rt_loan_rate','rt_interest','rt_memo_amt',
    'rt_evict','rt_demolish','rt_mgmt_months','rt_mgmt_monthly','rt_reserve','rt_deposit','rt_monthly',
    'rt_cust_rate1','rt_cust_rate2','rt_cust_rate3',
    'rt_evict_memo','rt_demolish_memo','rt_reserve_memo','rt_memo_label'];
  const result = {};
  ids.forEach(id => { result[id] = document.getElementById(id)?.value || ''; });
  ['rt_r_reg','rt_r_loan','rt_r_interest','rt_r_real','rt_r_cashflow','rt_r_yield'].forEach(id => {
    result[id] = document.getElementById(id)?.textContent || '';
  });
  return result;
}

function renderAuctionSavedList(type) {
  const key = type === 'flip' ? 'savedAuctionFlip' : 'savedAuctionRent';
  const listEl = document.getElementById(type === 'flip' ? 'fl_saved_list' : 'rt_saved_list');
  if (!listEl) return;
  chrome.storage.local.get([key], r => {
    const list = r[key] || [];
    if (!list.length) { listEl.style.display = 'none'; return; }
    listEl.style.display = 'block';
    listEl.innerHTML = list.map((item, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div>
          <span style="font-size:11px;font-weight:600;color:var(--text)">${item.name}</span>
          <span style="font-size:9px;color:var(--text3);margin-left:6px">${item.savedAt}</span>
        </div>
        <div style="display:flex;gap:4px;">
          <button data-load-type="${type}" data-load-idx="${i}" style="font-size:10px;padding:2px 6px;background:var(--primary);border:none;border-radius:4px;color:white;cursor:pointer">불러오기</button>
          <button data-del-type="${type}" data-del-idx="${i}" style="font-size:10px;padding:2px 6px;background:rgba(255,100,100,0.15);border:none;border-radius:4px;color:#ff6b6b;cursor:pointer">삭제</button>
        </div>
      </div>`).join('');

    // 불러오기/삭제 이벤트
    listEl.querySelectorAll('[data-load-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.loadIdx);
        chrome.storage.local.get([key], r2 => {
          const saved = (r2[key] || [])[idx];
          if (!saved) return;
          if (type === 'flip') loadFlipData(saved.data);
          else loadRentData(saved.data);
          showToast('불러왔습니다');
        });
      });
    });
    listEl.querySelectorAll('[data-del-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.delIdx);
        chrome.storage.local.get([key], r2 => {
          const list2 = r2[key] || [];
          list2.splice(idx, 1);
          chrome.storage.local.set({ [key]: list2 }, () => renderAuctionSavedList(type));
        });
      });
    });
  });
}

function loadFlipData(data) {
  Object.keys(data).forEach(id => {
    const el = document.getElementById(id);
    if (el && !id.startsWith('fl_r_')) el.value = data[id];
  });
  calcFlipLive();
}

function loadRentData(data) {
  Object.keys(data).forEach(id => {
    const el = document.getElementById(id);
    if (el && !id.startsWith('rt_r_')) el.value = data[id];
  });
  calcRentLive();
}

function exportAuctionCapture(type, format) {
  const panelId = type === 'flip' ? 'atab-flip' : 'atab-rent';
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const name = document.getElementById(type === 'flip' ? 'fl_case' : 'rt_save_name')?.value || (type === 'flip' ? '주택경매' : '상가경매');

  if (typeof html2canvas === 'undefined') {
    // html2canvas 동적 로드
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => doAuctionCapture(panel, name, format);
    document.head.appendChild(s);
  } else {
    doAuctionCapture(panel, name, format);
  }
}

function doAuctionCapture(panel, name, format) {
  html2canvas(panel, { backgroundColor: '#1a1a2e', scale: 2 }).then(canvas => {
    if (format === 'png') {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = name + '_' + new Date().toLocaleDateString('ko-KR').replace(/\.\s*/g,'-').replace(/\.$/,'') + '.png';
      a.click();
    } else {
      // PDF
      if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = () => savePdfFromCanvas(canvas, name);
        document.head.appendChild(s);
      } else {
        savePdfFromCanvas(canvas, name);
      }
    }
  });
}

function savePdfFromCanvas(canvas, name) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const imgW = 190, imgH = canvas.height * imgW / canvas.width;
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, imgH);
  pdf.save(name + '_' + new Date().toLocaleDateString('ko-KR').replace(/\.\s*/g,'-').replace(/\.$/,'') + '.pdf');
}

function exportAuctionCSV(type) {
  let rows, filename;
  if (type === 'flip') {
    const d = collectFlipData();
    const name = d['fl_case'] || '주택경매';
    rows = [
      ['항목','요율','금액'],
      ['사건번호','',d['fl_case']],
      ['감정가','',d['fl_appraisal']],
      ['입찰가',d['fl_bid_rate']+'%',d['fl_bid']],
      ['대출금',d['fl_loan_rate']+'%',d['fl_r_loan']],
      ['취득세',d['fl_acq_tax']+'%',d['fl_r_acq']],
      ['법무비/채권',d['fl_legal_rate']+'%',d['fl_r_legal']],
      ['중도상환수수료',d['fl_prepay_rate']+'%',d['fl_r_prepay']],
      ['대출이자',d['fl_interest_rate']+'%',d['fl_r_interest']],
      ['중개료',d['fl_agent_rate']+'%',d['fl_r_agent']],
      ['미납관리비','',d['fl_mgmt']],
      ['수리비','',d['fl_repair']],
      ['명도비','',d['fl_evict']],
      ['기타비용','',d['fl_etc']],
      ['총 비용','',d['fl_r_total_cost']],
      ['매도가','',d['fl_sellprice']],
      ['총투자금','',d['fl_r_total_invest']],
      ['실투자금','',d['fl_r_real_invest']],
      ['양도차익','',d['fl_r_gain']],
      ['종합소득세',d['fl_transfer_tax']+'%',d['fl_r_income_tax']],
      ['세후이익','',d['fl_r_net_profit']],
      ['순투자수익률','',d['fl_r_roi']],
    ];
    filename = name;
  } else {
    const d = collectRentData();
    const name = document.getElementById('rt_save_name')?.value || '상가경매';
    rows = [
      ['No.','항목','요율','금액'],
      ['1','입찰가','',d['rt_bid']],
      ['2','등록세 및 법무사',d['rt_reg_rate']+'%',d['rt_r_reg']],
      ['3','대출',d['rt_loan_rate']+'%',d['rt_r_loan']],
      ['4','대출금리',d['rt_interest']+'%',d['rt_r_interest']],
      ['5','명도비','',d['rt_evict']],
      ['6','철거비','',d['rt_demolish']],
      ['7','미납관리비',d['rt_mgmt_months']+'개월',d['rt_mgmt_monthly']],
      ['8','예비비','',d['rt_reserve']],
      ['9','보증금','',d['rt_deposit']],
      ['10','월세','',d['rt_monthly']],
      ['11','실투자금','',d['rt_r_real']],
      ['12','순현금흐름(월)','',d['rt_r_cashflow']],
      ['13','매매수익률','',d['rt_r_yield']],
      ['','','',''],
      ['','',`${d['rt_cust_rate1']}% 매도시 투자수익`,'',`월세×12÷${d['rt_cust_rate1']}%-총비용`],
      ['','',`${d['rt_cust_rate2']}% 매도시 투자수익`,'',`월세×12÷${d['rt_cust_rate2']}%-총비용`],
      ['','',`${d['rt_cust_rate3']}% 매도시 투자수익`,'',`월세×12÷${d['rt_cust_rate3']}%-총비용`],
    ];
    filename = name;
  }
  const csv = rows.map(r => r.map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename + '_' + new Date().toLocaleDateString('ko-KR').replace(/\.\s*/g,'-').replace(/\.$/,'') + '.csv';
  a.click();
}

function calcFlipLive() {
  const appraisal = pWon('fl_appraisal');
  const bidRate   = pNum('fl_bid_rate');
  const bidRaw    = pWon('fl_bid');
  const bid       = bidRaw || Math.round(appraisal * bidRate / 100);
  const loanRate  = pNum('fl_loan_rate');
  const loan      = Math.round(bid * loanRate / 100);

  // 비용 계산
  const acqTax   = Math.round(bid * pNum('fl_acq_tax') / 100);
  const legal    = Math.round(bid * pNum('fl_legal_rate') / 100);
  const prepay   = Math.round(loan * pNum('fl_prepay_rate') / 100);
  const interest = Math.round(loan * pNum('fl_interest_rate') / 100 / 12 * 3); // 고정 3개월
  const agent    = Math.round(bid * pNum('fl_agent_rate') / 100);
  const mgmt     = pWon('fl_mgmt');
  const repair   = pWon('fl_repair');
  const evict    = pWon('fl_evict');
  const memoAmt  = pWon('fl_memo_amt');
  const totalCost = acqTax + legal + prepay + interest + agent + mgmt + repair + evict + memoAmt;

  // 수익 계산
  const sell        = pWon('fl_sellprice');
  const totalInvest = bid + totalCost;
  const realInvest  = bid - loan + totalCost;
  const gain        = sell > 0 ? sell - bid - totalCost : 0;
  const taxRate     = pNum('fl_transfer_tax');
  const incomeTax   = gain > 0 ? Math.round(gain * taxRate / 100) : 0;
  const netProfit   = sell > 0 ? sell - totalInvest - incomeTax : 0;
  const roi         = realInvest > 0 && sell > 0 ? netProfit / realInvest * 100 : 0;

  // 화면 업데이트
  setXl('fl_r_loan',         loan);
  setXl('fl_r_acq',          acqTax);
  setXl('fl_r_legal',        legal);
  setXl('fl_r_prepay',       prepay);
  setXl('fl_r_interest',     interest);
  setXl('fl_r_agent',        agent);
  setXl('fl_r_total_cost',   totalCost);
  setXl('fl_r_total_invest', totalInvest);
  setXl('fl_r_real_invest',  realInvest);
  setXl('fl_r_gain',         gain > 0 ? gain : 0);
  setXl('fl_r_income_tax',   incomeTax);
  setXl('fl_r_net_profit',   sell > 0 ? netProfit : 0);
  setXl('fl_r_roi',          sell > 0 ? roi.toFixed(1) + '%' : '-', false);

  // 색상
  const npEl = document.getElementById('fl_r_net_profit');
  if (npEl) npEl.style.color = netProfit >= 0 ? 'var(--gold-light)' : 'var(--red)';
  const roiEl = document.getElementById('fl_r_roi');
  if (roiEl) roiEl.style.color = roi >= 20 ? 'var(--green)' : roi >= 10 ? 'var(--gold-light)' : 'var(--red)';
  const gainEl = document.getElementById('fl_r_gain');
  if (gainEl) gainEl.style.color = gain >= 0 ? 'var(--text2)' : 'var(--red)';
  const taxEl = document.getElementById('fl_r_income_tax');
  if (taxEl) taxEl.style.color = 'var(--red)';

  // 적정 매도가 수익률 테이블
  const tbody = document.getElementById('fl_yield_body');
  if (tbody && realInvest > 0) {
    const rates = [10, 15, 20, 25, 30];
    tbody.innerHTML = rates.map(targetRoi => {
      // 세후이익 = roi/100 * realInvest
      // netProfit = sell - totalInvest - incomeTax
      // sell - totalInvest - (sell-bid-totalCost)*taxRate/100 = targetNet
      // sell(1 - taxRate/100) - totalInvest + (bid+totalCost)*taxRate/100 = targetNet
      const targetNet = realInvest * targetRoi / 100;
      const taxFactor = taxRate / 100;
      const sellNeeded = (targetNet + totalInvest - (bid + totalCost) * taxFactor) / (1 - taxFactor);
      const profitAtTarget = targetNet;
      const isHighlight = targetRoi === 20;
      return `<tr style="${isHighlight ? 'background:rgba(201,168,76,0.08);' : ''}">
        <td style="padding:4px 6px;font-weight:700;color:${targetRoi >= 20 ? 'var(--gold-light)' : 'var(--text2)'}">${targetRoi}%</td>
        <td style="text-align:right;padding:4px 6px;color:var(--text)">${sellNeeded > 0 ? WON_FMT(Math.round(sellNeeded)) : '-'}</td>
        <td style="text-align:right;padding:4px 6px;color:var(--gold)">${profitAtTarget > 0 ? WON_FMT(Math.round(profitAtTarget)) : '-'}</td>
      </tr>`;
    }).join('');
  } else if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:8px;color:var(--text3);font-size:10px">입찰가와 실투자금을 입력하면 적정 매도가가 계산됩니다</td></tr>';
  }
}

function calcRentLive() {
  const bid        = pWon('rt_bid');
  const regRate    = pNum('rt_reg_rate');
  const loanRate   = pNum('rt_loan_rate');
  const intRate    = pNum('rt_interest');
  const evict      = pWon('rt_evict');
  const demolish   = pWon('rt_demolish');
  const mgmtMonths = pNum('rt_mgmt_months');
  const mgmtMon    = pWon('rt_mgmt_monthly');
  const reserve    = pWon('rt_reserve');
  const memoAmt    = pWon('rt_memo_amt');
  const deposit    = pWon('rt_deposit');
  const monthly    = pWon('rt_monthly');

  const reg        = Math.round(bid * regRate / 100);
  const loan       = Math.round(bid * loanRate / 100);
  const annualInt  = Math.round(loan * intRate / 100);
  const mgmtTotal  = Math.round(mgmtMonths * mgmtMon);

  // 실투자금 = 1+2-3+4+5+6+7-8 + 기타메모 (등록세+대출금리+명도비+철거비+미납관리비+예비비 - 보증금)
  const realInvest  = bid + reg - loan + evict + demolish + mgmtTotal + reserve + memoAmt - deposit;
  // 순현금흐름 = 월세 - 월 대출이자
  const netCashflow = monthly - Math.round(annualInt / 12);
  // 매매수익률 = (월세×12) / (입찰가+보증금) × 100
  const saleYield   = (bid + deposit) > 0 ? monthly * 12 / (bid + deposit) * 100 : 0;
  // 총비용(매도시 투자수익 계산용)
  const totalCost   = bid + reg + evict + demolish + mgmtTotal + reserve + memoAmt;

  setXl('rt_r_reg',      reg);
  setXl('rt_r_loan',     loan);
  setXl('rt_r_interest', annualInt);
  setXl('rt_r_real',     realInvest);
  setXl('rt_r_cashflow', netCashflow);
  setXl('rt_r_yield', saleYield.toFixed(2) + '%', false);

  // 색상
  const cfEl = document.getElementById('rt_r_cashflow');
  if (cfEl) cfEl.style.color = netCashflow >= 0 ? 'var(--green)' : 'var(--red)';
  const riEl = document.getElementById('rt_r_real');
  if (riEl) riEl.style.color = 'var(--orange)';

  // 수익률별 적정 매도가 테이블 (오른쪽)
  const yieldRates = [4.0, 4.3, 4.5, 4.8, 5.0, 5.3, 5.5, 6.0, 6.2];
  const tbody = document.getElementById('rt_yield_body');
  if (tbody) {
    tbody.innerHTML = yieldRates.map(yr => {
      const sellPrice = monthly > 0 ? Math.round(monthly * 12 / (yr / 100)) : 0;
      const profit    = sellPrice > 0 ? sellPrice - totalCost : 0;
      const pColor    = profit > 0 ? 'var(--green)' : profit < 0 ? 'var(--red)' : 'var(--text3)';
      return `<tr>
        <td style="padding:4px 6px;font-weight:700;color:var(--primary-light)">${yr.toFixed(1)}%</td>
        <td style="text-align:right;padding:4px 6px">${sellPrice > 0 ? WON_FMT(sellPrice) : '-'}</td>
        <td style="text-align:right;padding:4px 6px;color:${pColor}">${profit !== 0 ? WON_FMT(profit) : '-'}</td>
      </tr>`;
    }).join('');
  }

  // 매도시 투자수익 요약 테이블 (하단, 사용자 지정 3개 수익률)
  const summaryWrap = document.getElementById('rt_sell_summary_wrap');
  const summaryBody = document.getElementById('rt_sell_summary_body');
  if (summaryWrap && summaryBody && monthly > 0) {
    const r1 = parseFloat(document.getElementById('rt_cust_rate1')?.value) || 4.0;
    const r2 = parseFloat(document.getElementById('rt_cust_rate2')?.value) || 4.3;
    const r3 = parseFloat(document.getElementById('rt_cust_rate3')?.value) || 5.0;
    const summaryRates = [r1, r2, r3];
    summaryBody.innerHTML = summaryRates.map(yr => {
      const sellPrice = Math.round(monthly * 12 / (yr / 100));
      const profit = sellPrice - totalCost;
      const pColor = profit > 0 ? 'var(--green)' : 'var(--red)';
      return `<tr>
        <td style="padding:5px 8px;font-weight:700;color:var(--primary-light)">${yr.toFixed(1)}% 매도시</td>
        <td style="text-align:right;padding:5px 8px;font-weight:700;color:${pColor}">${WON_FMT(profit)}</td>
      </tr>`;
    }).join('');
    summaryWrap.style.display = 'block';
  } else if (summaryWrap) {
    summaryWrap.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════
// 면적탭 - 평당가 빠른계산
// ═══════════════════════════════════════════════════
function calcQuickPyeong() {
  const price = parseInt((document.getElementById('qp_price')?.value||'').replace(/,/g,''))||0;
  const sqm = parseFloat(document.getElementById('qp_sqm')?.value)||0;
  if (!price || !sqm) { document.getElementById('qp_result').style.display='none'; return; }
  const py = sqm / 3.3058;
  const pp = Math.round(price / py);
  const pm = Math.round(price / sqm);
  document.getElementById('qp_r_pp').textContent = fmtMan(pp) + '/평';
  document.getElementById('qp_r_pm').textContent = fmtMan(pm) + '/㎡';
  document.getElementById('qp_result').style.display = 'block';
}
document.getElementById('qp_price')?.addEventListener('input', function() {
  const raw = this.value.replace(/,/g,'');
  if (/^\d+$/.test(raw)) this.value = parseInt(raw).toLocaleString();
  calcQuickPyeong();
});

// ═══════════════════════════════════════════════════
// 일반 계산기
// ═══════════════════════════════════════════════════
function initBasicCalc() {
  let cur = '0', prev = '', op = '', justCalc = false;
  const valEl = document.getElementById('basic_val');
  const exprEl = document.getElementById('basic_expr');
  const histEl = document.getElementById('basic_history');
  if (!valEl) return;

  function updateDisplay() { valEl.textContent = parseFloat(cur).toLocaleString('ko-KR', {maximumFractionDigits:8}); }
  function addHistory(expr, result) {
    const div = document.createElement('div');
    div.textContent = expr + ' = ' + parseFloat(result).toLocaleString('ko-KR', {maximumFractionDigits:8});
    histEl?.prepend(div);
  }

  document.querySelectorAll('.bcalc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'num') {
        const n = btn.dataset.num;
        if (justCalc) { cur = n; justCalc = false; }
        else cur = cur === '0' ? n : cur + n;
        updateDisplay();
      } else if (action === 'dot') {
        if (!cur.includes('.')) cur += '.';
        updateDisplay();
      } else if (action === 'op') {
        document.querySelectorAll('.bcalc-btn.op').forEach(b => b.classList.remove('active-op'));
        btn.classList.add('active-op');
        prev = cur; op = btn.dataset.op; justCalc = false; cur = '0';
        exprEl.textContent = prev + ' ' + op;
      } else if (action === 'eq') {
        if (!op || !prev) return;
        document.querySelectorAll('.bcalc-btn.op').forEach(b => b.classList.remove('active-op'));
        const a = parseFloat(prev), b2 = parseFloat(cur);
        let res = 0;
        if (op === '+') res = a + b2;
        else if (op === '−') res = a - b2;
        else if (op === '×') res = a * b2;
        else if (op === '÷') res = b2 !== 0 ? a / b2 : 0;
        addHistory(prev + ' ' + op + ' ' + cur, res);
        exprEl.textContent = prev + ' ' + op + ' ' + cur + ' =';
        cur = String(res); prev = ''; op = ''; justCalc = true;
        updateDisplay();
      } else if (action === 'clear') {
        cur = '0'; prev = ''; op = ''; justCalc = false;
        exprEl.textContent = ''; updateDisplay();
        document.querySelectorAll('.bcalc-btn.op').forEach(b => b.classList.remove('active-op'));
      } else if (action === 'sign') {
        cur = String(-parseFloat(cur)); updateDisplay();
      } else if (action === 'pct') {
        cur = String(parseFloat(cur)/100); updateDisplay();
      }
    });
  });
}
