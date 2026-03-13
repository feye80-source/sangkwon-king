// content.js

// ─────────────────────────────────────────
// 네이버 매물 목록 API 직접 호출 → articleNo 맵 구축
// content script에서 직접 fetch 가능 (host_permissions 있음)
// ─────────────────────────────────────────
const apiArticleMap = new Map(); // articleNo → url

// ─────────────────────────────────────────
// 지수 백오프 유틸: 최대 maxRetries회 재시도
// ─────────────────────────────────────────
async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // 403: 인증 필요 → 재시도 없이 즉시 AUTH_REQUIRED 전달
      if (res.status === 403) {
        chrome.runtime.sendMessage({ type: 'API_ERROR', errorType: 'AUTH_REQUIRED', status: 403 }).catch(() => {});
        return null;
      }
      // 기타 HTTP 오류 → 재시도 대상
      if (!res.ok) {
        lastError = new Error('HTTP ' + res.status);
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 500; // 500ms, 1000ms, 2000ms
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  // 모든 재시도 실패 → NETWORK_ERROR 전달
  chrome.runtime.sendMessage({ type: 'API_ERROR', errorType: 'NETWORK_ERROR', detail: String(lastError) }).catch(() => {});
  return null;
}

async function fetchArticleNosFromApi() {
  try {
    const url = new URL(window.location.href);
    const ms = url.searchParams.get('ms') || '';
    const cortarNo = url.searchParams.get('cortarNo') || '';
    const rletTpCd = 'SG:SMS';
    const tradeType = 'RETAIL:RENT';

    const msParts = ms.split(',');
    const lat = msParts[0] || '';
    const lng = msParts[1] || '';
    const zoom = msParts[2] || '15';
    if (!lat || !lng) {
      chrome.runtime.sendMessage({ type: 'API_DEBUG', info: { error: 'lat/lng 없음', ms } }).catch(()=>{});
      return;
    }

    const apiUrl = `https://new.land.naver.com/api/articles?cortarNo=${cortarNo}&zoom=${zoom}&priceType=RETAIL&markerId=&markerType=&selectedComplexNo=&selectedComplexBuildingNo=&fakeComplexMarker=&realEstateType=${rletTpCd}&tradeType=${tradeType}&tag=&rentPriceMin=0&rentPriceMax=900000&priceMin=0&priceMax=900000&areaMin=0&areaMax=900000&oldBuildDate=&realtorId=&sortBy=rank&isNaver=true&lat=${lat}&lng=${lng}&btm=${parseFloat(lat)-0.015}&lft=${parseFloat(lng)-0.015}&top=${parseFloat(lat)+0.015}&rgt=${parseFloat(lng)+0.015}&showArticle=false&sameAddressGroup=false&minShouldMatch=75%25&directTrade=false`;

    const res = await fetchWithBackoff(apiUrl, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Referer': 'https://new.land.naver.com/' }
    }, 3);

    if (!res) return; // 에러는 fetchWithBackoff 내부에서 이미 전달됨

    const data = await res.json();
    const items = data?.body?.items || data?.articles || data?.result?.items || data?.body || [];
    const arr = Array.isArray(items) ? items : [];

    // 디버그: API 응답 샘플 3개 필드 확인
    const sample = arr.slice(0, 3).map(item => ({
      articleNo: item.articleNo,
      tradeTypeName: item.tradeTypeName,
      dealOrWarrantPrcInt: item.dealOrWarrantPrcInt,
      rentPrcInt: item.rentPrcInt,
      area1: item.area1,
      area2: item.area2,
      price: item.price || item.prc,
      rent: item.rent || item.rentPrc,
      excArea: item.exclusiveArea || item.privArea || item.supArea,
    }));

    const collectedSample = Array.from(listingMap.values()).slice(0, 3).map(item => ({
      id: item.id,
      tradeType: item.tradeType,
      dealPrc: item.price?.type === 'sale' ? Math.round((item.price?.amount||0)/10000) : 0,
      rentPrc: item.price?.type === 'monthly' ? Math.round((item.price?.monthly||0)/10000) : 0,
      area: Math.round(item.area?.exclusive || item.area?.contract || 0),
    }));

    chrome.runtime.sendMessage({ type: 'API_DEBUG', info: {
      apiCount: arr.length,
      collectedCount: listingMap.size,
      apiSample: sample,
      collectedSample,
      dataKeys: arr.length > 0 ? Object.keys(arr[0]) : [],
    }}).catch(()=>{});

    arr.forEach(item => {
      const no = String(item.articleNo || '');
      if (!no) return;
      apiArticleMap.set(no, no);

      const dealPrc = Math.round(item.dealOrWarrantPrcInt || 0);
      const rentPrc = Math.round(item.rentPrcInt || 0);
      const area = Math.round(parseFloat(item.area2 || item.area1 || 0));
      const tradeName = item.tradeTypeName || '';
      apiArticleMap.set([tradeName, dealPrc, rentPrc, area].join('|'), no);
      const k2 = [tradeName, dealPrc, area].join('|');
      if (!apiArticleMap.has(k2)) apiArticleMap.set(k2, no);
    });

    if (arr.length > 0) retryMatchAnonListings();
  } catch(e) {
    chrome.runtime.sendMessage({ type: 'API_ERROR', errorType: 'NETWORK_ERROR', detail: String(e) }).catch(()=>{});
  }
}

function retryMatchAnonListings() {
  let updated = false;
  for (const [key, item] of listingMap.entries()) {
    if (item.url) continue;
    const isSale = item.price?.type === 'sale';
    const tradeName = item.tradeType || '';
    const dealPrc = isSale ? Math.round((item.price?.amount || 0) / 10000) : 0;
    const rentPrc = !isSale ? Math.round((item.price?.monthly || 0) / 10000) : 0;
    const area = Math.round(item.area?.exclusive || item.area?.contract || 0);

    const no = apiArticleMap.get([tradeName, dealPrc, rentPrc, area].join('|'))
            || apiArticleMap.get([tradeName, dealPrc, area].join('|'));
    if (!no || no.startsWith('http')) continue;

    item.url = 'https://new.land.naver.com/offices?articleNo=' + no;
    item.id = no;
    if (key.startsWith('anon_')) {
      listingMap.delete(key);
      listingMap.set(no, item);
    }
    updated = true;
  }
  if (updated) {
    const all = Array.from(listingMap.values());
    chrome.runtime.sendMessage({ type: 'LIST_DATA', listings: all, count: all.length }).catch(() => {});
  }
}

let lastArticleNo = null;
let observer = null;
let listingMap = new Map();
let isCollecting = false;

function getArticleNoFromUrl(url) {
  const match = url.match(/articleNo=(\d+)/);
  return match ? match[1] : null;
}

// ─────────────────────────────────────────
// 금액 파싱: 표시용 문자열 → 원 단위
// "3억 7,000" → 370,000,000
// "5,000" (만원) → 50,000,000
// ─────────────────────────────────────────
function parseDisplayAmount(str) {
  if (!str) return 0;
  str = str.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  str = str.split('~')[0].trim();
  let total = 0;
  const eokMatch = str.match(/(\d+)억/);
  const manAfterEok = str.match(/억\s*(\d+)/);
  if (eokMatch) total += parseInt(eokMatch[1]) * 100000000;
  if (manAfterEok) total += parseInt(manAfterEok[1]) * 10000;
  if (!eokMatch) {
    const justNum = str.match(/^(\d+)만?$/);
    if (justNum) {
      const n = parseInt(justNum[1]);
      if (n > 0 && n <= 99999) total = n * 10000;
    }
  }
  return total;
}

// NEXT_DATA의 dealOrWarrantPrc, rentPrc 파싱
// 네이버 NEXT_DATA는 만원 단위 순수 숫자로 제공 (예: "37000" = 3억 7천만원)
// 억/만 한글 포함 → parseDisplayAmount
// 순수 숫자 → 만원 단위이므로 * 10000 하여 원 단위로 변환
function parseNextDataAmount(str) {
  if (!str) return 0;
  const s = str.replace(/,/g, '').trim();
  if (s.includes('억') || s.includes('만')) return parseDisplayAmount(str);
  const n = parseInt(s);
  if (isNaN(n) || n <= 0) return 0;
  return n * 10000;
}

// ─────────────────────────────────────────
// 면적 파싱 (상세페이지용)
// ─────────────────────────────────────────
function parseArea(str) {
  if (!str) return null;
  const isPyeong = str.includes('평');
  const match = str.match(/([\d.]+)\s*[\/·]\s*([\d.]+)/);
  if (match) {
    let c = parseFloat(match[1]), e = parseFloat(match[2]);
    if (isPyeong) return { contract: Math.round(c*3.3058*10)/10, exclusive: Math.round(e*3.3058*10)/10, contractPyeong: c, exclusivePyeong: e };
    return { contract: c, exclusive: e, contractPyeong: Math.round(c/3.3058*10)/10, exclusivePyeong: Math.round(e/3.3058*10)/10 };
  }
  const single = str.match(/([\d.]+)/);
  if (single) {
    const val = parseFloat(single[1]);
    const sqm = isPyeong ? Math.round(val*3.3058*10)/10 : val;
    const py = isPyeong ? val : Math.round(val/3.3058*10)/10;
    return { contract: sqm, exclusive: sqm, contractPyeong: py, exclusivePyeong: py };
  }
  return null;
}

// ─────────────────────────────────────────
// 층 파싱
// ─────────────────────────────────────────
function parseFloorNumber(str) {
  if (!str) return null;
  const slash = str.match(/^(-?\d+)\s*\/\s*\d+/);
  if (slash) return parseInt(slash[1]);
  const floor = str.match(/^(-?\d+)층/);
  if (floor) return parseInt(floor[1]);
  if (/지하/i.test(str)) { const n = str.match(/\d+/); return n ? -parseInt(n[0]) : -1; }
  const bare = str.match(/^(-?\d+)/);
  return bare ? parseInt(bare[1]) : null;
}

// ─────────────────────────────────────────
// 카드 span.spec에서 면적 파싱
// 실제 형태: "84/42m², 6/8층, 서향"
// m² 또는 ㎡ 모두 대응
// ─────────────────────────────────────────
function parseAreaFromSpec(specText) {
  if (!specText) return null;
  const match = specText.match(/([\d.]+)\s*\/\s*([\d.]+)\s*(?:m²|㎡|m2)/);
  if (match) {
    const c = parseFloat(match[1]), e = parseFloat(match[2]);
    if (c > 0 && e > 0) {
      return {
        contract: c, exclusive: e,
        contractPyeong: Math.round(c / 3.3058 * 10) / 10,
        exclusivePyeong: Math.round(e / 3.3058 * 10) / 10
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────
// 카드 span.spec에서 층 파싱
// 실제 형태: "84/42m², 6/8층, 서향"
// ─────────────────────────────────────────
function parseFloorFromSpec(specText) {
  if (!specText) return { floorNum: null, floorText: '' };
  const match = specText.match(/(\d+)\s*\/\s*(\d+)층/);
  if (match) {
    return { floorNum: parseInt(match[1]), floorText: match[1] + '/' + match[2] + '층' };
  }
  const single = specText.match(/(\d+)층/);
  if (single) {
    return { floorNum: parseInt(single[1]), floorText: single[1] + '층' };
  }
  return { floorNum: null, floorText: '' };
}

// ─────────────────────────────────────────
// 단일 매물 상세 스크래핑
// ─────────────────────────────────────────
function scrapeListing() {
  const data = {};
  data.articleNo = getArticleNoFromUrl(window.location.href);
  data.url = window.location.href;

  // ── __NEXT_DATA__ 파싱 ──────────────────────────────
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (nextDataEl) {
    try {
      const nd = JSON.parse(nextDataEl.textContent);
      // 네이버 부동산은 버전에 따라 NEXT_DATA 경로가 다름 — 넓게 탐색
      const pp = nd?.props?.pageProps;
      function findArticleObj(obj, depth) {
        if (depth > 5 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
        if (obj.tradeTypeName !== undefined && obj.articleNo !== undefined) return obj;
        for (const v of Object.values(obj)) { const r = findArticleObj(v, depth+1); if (r) return r; }
        return null;
      }
      const d = pp?.articleDetail || pp?.article || findArticleObj(pp, 0);
      if (d) {
        if (d.articleNo)          data.articleNo     = d.articleNo.toString();
        if (d.articleName)        data.title         = d.articleName;
        if (d.tradeTypeName)      data.tradeType     = d.tradeTypeName;
        if (d.articleFeatureDesc) data.features      = d.articleFeatureDesc;
        if (d.tagList)            data.tags          = d.tagList;
        if (d.floorInfo)          data.floorInfo     = d.floorInfo;
        if (d.direction)          data.direction     = d.direction;
        if (d.buildingName)       data.buildingName  = d.buildingName;
        if (d.detailAddress || d.address) data.address = d.detailAddress || d.address;
        if (d.cortarAddress)      data.address       = data.address || d.cortarAddress;

        // 디버그: 실제 금액 필드값 확인
        console.log('[상가Pro] NEXT_DATA price fields:', {tradeTypeName:d.tradeTypeName, dealOrWarrantPrc:d.dealOrWarrantPrc, dealOrWarrantPrcInt:d.dealOrWarrantPrcInt, rentPrc:d.rentPrc, rentPrcInt:d.rentPrcInt, warrantPrice:d.warrantPrice, dealPrice:d.dealPrice, price:d.price, prc:d.prc});
        // 금액 파싱 - 네이버 API 여러 필드명 순차 fallback
        const wPrcRaw = d.dealOrWarrantPrc
          || (d.dealOrWarrantPrcInt > 0 ? String(d.dealOrWarrantPrcInt) : '')
          || d.warrantPrice || d.warrantyPrc || d.dealPrice
          || (d.price > 0 ? String(d.price) : '')
          || (d.prc > 0 ? String(d.prc) : '')
          || '';
        const wPrc = wPrcRaw.toString().replace(/,/g, '');
        const rPrcRaw = d.rentPrc
          || (d.rentPrcInt > 0 ? String(d.rentPrcInt) : '')
          || d.rentPrice || d.monthlyRent
          || '';
        const rPrc = rPrcRaw.toString().replace(/,/g, '');
        if (d.tradeTypeName === '월세' && wPrc && rPrc && rPrc !== '0') {
          const deposit = parseNextDataAmount(wPrc);
          const monthly = parseNextDataAmount(rPrc);
          data.priceRaw = wPrc + '/' + rPrc;
          data.price = { type: 'monthly', deposit, monthly };
        } else if (d.tradeTypeName === '전세' && wPrc) {
          const deposit = parseNextDataAmount(wPrc);
          data.priceRaw = wPrc;
          data.price = { type: 'monthly', deposit, monthly: 0 };
        } else if (wPrc) {
          const amount = parseNextDataAmount(wPrc);
          data.priceRaw = wPrc;
          data.price = { type: 'sale', amount };
          // 매매물건이지만 임대중인 경우: rentPrc(월세) + warrantyPrc(임대보증금) 즉시 완성
          if (rPrc && rPrc !== '0') {
            const monthly = parseNextDataAmount(rPrc);
            if (monthly > 0) {
              // warrantyPrc: 임대 보증금 (매매가와 별도 필드)
              const warPrc = (d.warrantyPrc || '').replace(/,/g, '');
              const depositAmt = warPrc && warPrc !== '0' ? parseNextDataAmount(warPrc) : 0;
              data.rentPrice = { type: 'monthly', deposit: depositAmt, monthly };
            }
          }
        }

        // 면적: area1=계약면적(㎡), area2=전용면적(㎡)
        if (d.area1) {
          const c = parseFloat(String(d.area1).replace(/[^\d.]/g, ''));
          const e = d.area2 ? parseFloat(String(d.area2).replace(/[^\d.]/g, '')) : null;
          data.area = {
            contract: c,
            exclusive: e || null,
            contractPyeong: Math.round(c / 3.3058 * 10) / 10,
            exclusivePyeong: e ? Math.round(e / 3.3058 * 10) / 10 : null
          };
          data.areaRaw = c + (e && e !== c ? '/' + e : '') + '㎡';
        }

        // 중개사 정보
        if (d.realtorInfo) {
          data.realtor = {
            name:     d.realtorInfo.realtorName   || d.realtorInfo.companyName || '',
            tel:      d.realtorInfo.representativeTelNo || d.realtorInfo.cellPhoneNo || '',
            address:  d.realtorInfo.address        || '',
            ceoName:  d.realtorInfo.representativeName || '',
            id:       d.realtorInfo.realtorId      || '',
          };
        }

        // 추가 상세 필드
        if (d.manageCostAmount)   data.manageFee    = d.manageCostAmount + '만원';
        if (d.loanable)           data.loanable     = d.loanable;
        if (d.currentUsage)       data.currentUse   = d.currentUsage;
        if (d.recommendedUsage)   data.recommendUse = d.recommendedUsage;
        if (d.parkingCount !== undefined) data.parkingCount = d.parkingCount;
        if (d.totalParkingCount !== undefined) data.totalParkingCount = d.totalParkingCount;
        if (d.isParking !== undefined) data.parking = d.isParking ? '가능' : '불가';
        if (d.buildingUse)        data.buildingUse  = d.buildingUse;
        if (d.structureTypeName)  data.structure    = d.structureTypeName;
        if (d.heatingTypeName)    data.heating      = d.heatingTypeName;
        if (d.toiletCount !== undefined) data.toiletCount = d.toiletCount;
        if (d.approveYmd)         data.approvalDate = d.approveYmd;
        if (d.moveInTypeName)     data.moveInType   = d.moveInTypeName;
        if (d.keyMoney)           data.keyMoney     = d.keyMoney;
        if (d.zoneTypeName)       data.zoneType     = d.zoneTypeName;
        if (d.facilityList)       data.facilities   = d.facilityList; // CCTV, 엘리베이터 등
      }
    } catch(e) {}
  }

  // ── DOM 테이블 파싱 (NEXT_DATA 누락분 보완) ──────────
  const infoRows = document.querySelectorAll('.detail_info tr, table tr, [class*="item_table"] tr, [class*="ArticleDetail"] tr, dl.info_list dt, dl.info_list dd');
  const dls = document.querySelectorAll('dl.info_list');
  dls.forEach(dl => {
    const dts = dl.querySelectorAll('dt');
    const dds = dl.querySelectorAll('dd');
    dts.forEach((dt, i) => {
      if (!dds[i]) return;
      applyLabelValue(dt.textContent.trim(), dds[i].textContent.trim(), data);
    });
  });
  infoRows.forEach(row => {
    const th = row.querySelector('th, td:first-child');
    const td = row.querySelector('td:last-child, td:nth-child(2)');
    if (!th || !td) return;
    applyLabelValue(th.textContent.trim(), td.textContent.trim(), data);
  });

  // ── 중개사 DOM 파싱 (NEXT_DATA 누락시 보완) ──────────
  if (!data.realtor) {
    const realtorSection = document.querySelector('[class*="realtor"], [class*="Realtor"], .agent_info, .agent-info');
    if (realtorSection) {
      const nameEl = realtorSection.querySelector('[class*="name"], strong, h3, h4');
      const telEl  = realtorSection.querySelector('[class*="tel"], [class*="phone"], a[href^="tel"]');
      const addrEl = realtorSection.querySelector('[class*="address"], [class*="addr"]');
      if (nameEl || telEl) {
        data.realtor = {
          name: nameEl?.textContent.trim() || '',
          tel:  telEl?.textContent.trim().replace(/[^0-9-]/g,'') || telEl?.href?.replace('tel:','') || '',
          address: addrEl?.textContent.trim() || ''
        };
      }
    }
  }

  // ── 보안시설 DOM 파싱 ──────────────────────────────
  if (!data.facilities) {
    const facilityEls = document.querySelectorAll('[class*="facility"] li, [class*="security"] li, [class*="Facility"] li');
    if (facilityEls.length > 0) {
      data.facilities = Array.from(facilityEls).map(el => el.textContent.trim()).filter(Boolean);
    }
  }

  // ── 매물 설명 텍스트 DOM 파싱 ──────────────────────
  if (!data.description) {
    const descEl = document.querySelector('[class*="ArticleDetail__description"], [class*="article_desc"], .desc, [class*="description"]');
    if (descEl) data.description = descEl.textContent.trim().substring(0, 500);
  }

  // ── 가격 DOM fallback (NEXT_DATA에 금액 없을 때) ──────────────
  if (!data.price) {
    // 네이버 상세 페이지의 가격 영역: span.price_type, div.price_area, [class*="price"]
    const priceAreaSels = [
      '[class*="ArticleDetail__price"]',
      '[class*="price_area"] [class*="price"]',
      'span.price_type',
      '[class*="trade_price"]',
      'em.price',
      '[class*="Price"]',
      '[class*="dealOrWarrant"]',
      'dd.price',
      '.info_article_price',
    ];
    for (const sel of priceAreaSels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = el.textContent.trim();
      // 거래유형 텍스트 찾기 (근처 span.type 또는 형제)
      const typeEl = el.closest('[class*="price"]')?.querySelector('[class*="type"]') ||
                     el.previousElementSibling ||
                     document.querySelector('span.type, [class*="trade_type"]');
      const tradeText = typeEl?.textContent.trim() || data.tradeType || '';
      const amount = parseDisplayAmount(t);
      if (amount > 0) {
        if (tradeText.includes('월세')) {
          const slash = t.indexOf('/');
          if (slash !== -1) {
            const dep = parseDisplayAmount(t.substring(0, slash));
            const mon = parseDisplayAmount(t.substring(slash+1));
            if (mon > 0) { data.price = { type:'monthly', deposit:dep, monthly:mon }; data.priceRaw = t; }
          }
        } else if (tradeText.includes('전세')) {
          data.price = { type:'monthly', deposit:amount, monthly:0 }; data.priceRaw = t;
        } else {
          data.price = { type:'sale', amount }; data.priceRaw = t;
        }
        if (data.price) break;
      }
    }
    // 2차 fallback: 페이지 내 텍스트에서 가격 패턴 탐색
    if (!data.price) {
      const bodyText = document.body.innerText || '';
      // "매매가" 또는 "보증금/월세" 패턴 탐색
      const salePat = /매매\s*가\s*[:：]?\s*([\d,]+억[\d,]*만?|[\d,]+만)/;
      const rentPat = /([\d,]+억[\d,]*만?|[\d,]+만)\s*\/\s*([\d,]+만)/;
      const saleM = bodyText.match(salePat);
      const rentM = bodyText.match(rentPat);
      if (saleM) {
        const amount = parseDisplayAmount(saleM[1]);
        if (amount > 0) { data.price = { type:'sale', amount }; data.priceRaw = saleM[1]; }
      } else if (rentM) {
        const dep = parseDisplayAmount(rentM[1]);
        const mon = parseDisplayAmount(rentM[2]);
        if (mon > 0) { data.price = { type:'monthly', deposit:dep, monthly:mon }; data.priceRaw = rentM[1]+'/'+rentM[2]; }
      }
    }
  }


  data.id = data.articleNo || data.listingNo || Date.now().toString();
  data.floorNum = parseFloorNumber(data.floorInfo);
  return data;
}

// 라벨-값 매핑 헬퍼
function applyLabelValue(label, value, data) {
  if (!label || !value || value === '-') return;
  if ((label.includes('소재지') || label.includes('주소')) && !data.address)      data.address     = value;
  if (label.includes('매물특징') && !data.features)                               data.features    = value;
  if (label.includes('면적') && !data.areaRaw)    { data.areaRaw = value; if(!data.area) data.area = parseArea(value); }
  if ((label.includes('해당층') || label.includes('층/총층')) && !data.floorInfo) data.floorInfo   = value;
  if (label.includes('방향') && !data.direction)                                  data.direction   = value;
  if ((label.includes('월관리비') || label.includes('관리비')) && !data.manageFee) data.manageFee  = value;
  if (label.includes('주차가능여부') && !data.parking)                            data.parking     = value;
  if (label.includes('총주차대수') && !data.totalParkingCount)                    data.totalParkingCount = value;
  if ((label.includes('매물번호') || label.includes('매물 번호')) && !data.listingNo) data.listingNo = value;
  if (label.includes('사용승인') && !data.approvalDate)                           data.approvalDate = value;
  if (label.includes('입주가능') && !data.moveInType)                             data.moveInType  = value;
  if (label.includes('융자금') && !data.loanable)                                 data.loanable    = value;
  if (label.includes('현재업종') && !data.currentUse)                             data.currentUse  = value;
  if (label.includes('추천업종') && !data.recommendUse)                           data.recommendUse = value;
  if (label.includes('난방') && !data.heating)                                    data.heating     = value;
  if (label.includes('용도지역') && !data.zoneType)                               data.zoneType    = value;
  if (label.includes('건축물 용도') && !data.buildingUse)                         data.buildingUse = value;
  if (label.includes('주구조') && !data.structure)                                data.structure   = value;
  if (label.includes('화장실') && !data.toiletCount)                              data.toiletCount = value;
  if (label.includes('권리금') && !data.keyMoney)                                 data.keyMoney    = value;
  // 매매 물건에 임대중 정보 (기보증금/월세) 파싱
  if (label.includes('기보증금') || label.includes('보증금/월세') || label.includes('임대보증') || label.includes('임차보증')) {
    // 값 형식: "4,000/350만원" 또는 "4,000만원/350만원" 또는 "-/-" 또는 "1억/78만원"
    if (value !== '-' && value !== '-/-' && value.includes('/')) {
      const cleaned = value.replace(/만원/g, '').replace(/,/g, '');
      const parts = cleaned.split('/');
      const depRaw = (parts[0] || '').trim();
      const monRaw = (parts[1] || '').trim().match(/^[\d.]+/)?.[0] || '';
      const mon = monRaw ? parseFloat(monRaw) * 10000 : 0;
      let dep = 0;
      if (depRaw) {
        if (depRaw.includes('억')) {
          dep = parseDisplayAmount(depRaw);
        } else {
          dep = parseFloat(depRaw) * 10000;
        }
      }
      if (mon > 0 && data.price?.type === 'sale') {
        data.rentPrice = { type: 'monthly', deposit: Math.round(dep) || 0, monthly: Math.round(mon) };
      }
    }
  }
  if (label.includes('중개사') || label.includes('개업공인')) {
    if (!data.realtor) data.realtor = { name: value };
    else if (!data.realtor.name) data.realtor.name = value;
  }
  if (label.includes('전화') || label.includes('연락처')) {
    if (!data.realtor) data.realtor = { tel: value };
    else if (!data.realtor.tel) data.realtor.tel = value;
  }
}

// ─────────────────────────────────────────
// 목록 카드 스크래핑
// 실제 네이버 카드 구조:
//   a.item_link
//     div.price_line > span.type("매매"|"월세") + span.price("3억 7,000"|"2,000/100")
//     div.info_area > span.spec("84/42m², 6/8층, 서향")
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// 카드 DOM에서 articleNo 직접 추출 시도
// 네이버 카드의 다양한 속성에서 articleNo를 찾음
// ─────────────────────────────────────────
function extractArticleNoFromCard(card) {
  // 1. 이미 태깅된 값
  if (card.dataset.sanggaNo) return card.dataset.sanggaNo;

  // 2. href에서 (간혹 직접 포함된 경우)
  const href = card.getAttribute('href') || '';
  const hrefMatch = href.match(/articleNo=(\d+)/);
  if (hrefMatch) return hrefMatch[1];

  // 3. 카드 자신 또는 부모의 data-* 속성
  const attrs = ['data-id', 'data-article-no', 'data-article', 'data-no', 'data-item-id'];
  for (const attr of attrs) {
    const val = card.getAttribute(attr) || card.closest('[' + attr + ']')?.getAttribute(attr);
    if (val && /^\d{7,}$/.test(val)) return val;
  }

  // 4. 카드 내부 자식 요소의 data-* 속성
  const inner = card.querySelector('[data-id],[data-article-no],[data-article],[data-no]');
  if (inner) {
    for (const attr of attrs) {
      const val = inner.getAttribute(attr);
      if (val && /^\d{7,}$/.test(val)) return val;
    }
  }

  // 5. 부모 li/div 의 data 속성 (네이버는 li.item에 articleNo를 넣기도 함)
  const parentItem = card.closest('li[data-id], li[data-article-no], div[data-id], div[data-article-no]');
  if (parentItem) {
    for (const attr of attrs) {
      const val = parentItem.getAttribute(attr);
      if (val && /^\d{7,}$/.test(val)) return val;
    }
  }

  // 6. onclick/data-url 등 문자열에서 articleNo 패턴 추출
  const onclickStr = card.getAttribute('onclick') || '';
  const onclickMatch = onclickStr.match(/articleNo[=:](\d+)/);
  if (onclickMatch) return onclickMatch[1];

  return null;
}

// 카드에 mouseenter 이벤트를 달아 호버 시 articleNo 태깅
// → DOM 직접 파싱 우선, 없으면 호버 후 URL 변경 감지로 보완
function attachCardHoverTagging() {
  document.querySelectorAll('a.item_link').forEach(card => {
    if (card.dataset.sanggaHooked) return;
    card.dataset.sanggaHooked = '1';

    // 즉시 DOM에서 추출 시도
    const noFromDom = extractArticleNoFromCard(card);
    if (noFromDom) card.dataset.sanggaNo = noFromDom;

    card.addEventListener('mouseenter', () => {
      // DOM 재시도 (동적으로 속성이 추가될 수 있음)
      const no = extractArticleNoFromCard(card);
      if (no) {
        card.dataset.sanggaNo = no;
        // 수집 중이면 즉시 listingMap url 보완
        if (isCollecting) enrichListingUrlByArticleNo(no, card);
      } else {
        // fallback: URL 감지 (mouseenter 직후 네이버가 URL 바꾸는 경우)
        setTimeout(() => {
          const urlNo = getArticleNoFromUrl(window.location.href);
          if (urlNo) {
            card.dataset.sanggaNo = urlNo;
            if (isCollecting) enrichListingUrlByArticleNo(urlNo, card);
          }
        }, 100);
      }
    });

    card.addEventListener('click', () => {
      setTimeout(() => {
        const no = extractArticleNoFromCard(card) || getArticleNoFromUrl(window.location.href);
        if (no) {
          card.dataset.sanggaNo = no;
          if (isCollecting) enrichListingUrlByArticleNo(no, card);
        }
      }, 400);
    });
  });
}

// 호버로 얻은 articleNo를 기존 anon_ 매물에 매핑
function enrichListingUrlByArticleNo(articleNo, card) {
  if (!articleNo || listingMap.has(articleNo)) return;

  // 이 카드의 가격/면적 정보 추출해서 anon_ 매물과 매칭
  const clone = card.cloneNode(true);
  clone.querySelectorAll('.sangga-overlay').forEach(el => el.remove());

  const typeEl = clone.querySelector('span.type');
  const tradeText = typeEl ? typeEl.textContent.trim() : '';
  clone.querySelectorAll('span.price--highest').forEach(el => el.remove());
  const priceEl = clone.querySelector('span.price');
  const priceText = priceEl ? priceEl.textContent.trim().split('~')[0].trim() : '';

  let area = null;
  clone.querySelectorAll('span.spec').forEach(specEl => {
    if (!area) area = parseAreaFromSpec(specEl.textContent.trim());
  });

  // anon_ 매물 중 거래유형 + 면적이 일치하는 것 찾기
  for (const [key, item] of listingMap.entries()) {
    if (!key.startsWith('anon_')) continue;
    if (item.tradeType && tradeText && item.tradeType !== tradeText) continue;
    const itemArea = item.area?.exclusive || item.area?.contract || 0;
    const cardArea = area?.exclusive || area?.contract || 0;
    if (cardArea > 0 && itemArea > 0 && Math.abs(itemArea - cardArea) > 3) continue;

    // 매칭 성공: anon_ 키를 articleNo로 교체
    item.id = articleNo;
    item.url = 'https://new.land.naver.com/offices?articleNo=' + articleNo;
    listingMap.delete(key);
    listingMap.set(articleNo, item);

    const all = Array.from(listingMap.values());
    chrome.runtime.sendMessage({ type: 'LIST_DATA', listings: all, count: all.length }).catch(() => {});
    break;
  }
}


function scrapeListingList() {
  attachCardHoverTagging();
  const collected = [];
  const cards = document.querySelectorAll('a.item_link');
  if (!cards.length) return collected;

  cards.forEach(card => {
    try {
      const clone = card.cloneNode(true);
      clone.querySelectorAll('.sangga-overlay').forEach(el => el.remove());

      // articleNo: DOM 직접 파싱 → data-sangga-no → href 순
      const articleNo = extractArticleNoFromCard(card);

      // ── 거래유형 ──
      const typeEl = clone.querySelector('span.type');
      const tradeText = typeEl ? typeEl.textContent.trim() : '';

      // ── 가격: span.price 첫 번째 (범위 매물의 최고가 span 제외 후 취득)
      clone.querySelectorAll('span.price--highest, span.price.price--highest').forEach(el => el.remove());
      const priceEl = clone.querySelector('span.price');
      const priceText = priceEl ? priceEl.textContent.trim().split('~')[0].trim() : '';
      if (!priceText || !tradeText) return;

      let price = null;
      let priceRaw = '';

      if (tradeText === '매매') {
        // "3억 7,000" 형태
        const amount = parseDisplayAmount(priceText);
        if (amount > 0) {
          price = { type: 'sale', amount };
          priceRaw = priceText;
        }
      } else if (tradeText === '전세') {
        // "5,000" 형태 (만원)
        const amount = parseDisplayAmount(priceText);
        if (amount > 0) {
          price = { type: 'monthly', deposit: amount, monthly: 0 };
          priceRaw = priceText;
        }
      } else if (tradeText === '월세') {
        // "2,000/100" 또는 "1억/640" 형태 → 보증금/월세
        // 보증금에 "억" 포함 가능하므로 parseInt 대신 parseDisplayAmount 사용
        const slashIdx = priceText.indexOf('/');
        if (slashIdx !== -1) {
          const depositStr = priceText.substring(0, slashIdx).trim();
          const monthlyStr = priceText.substring(slashIdx + 1).trim().match(/^([\d,억만]+)/)?.[1] || '';
          // 억/만 한글 포함 가능 → parseDisplayAmount 사용
          const depositParsed = (depositStr.includes('억') || depositStr.includes('만'))
            ? parseDisplayAmount(depositStr)
            : (parseInt(depositStr.replace(/,/g, '')) || 0) * 10000;
          // 보증금 10000원(=1만원) 이하는 0 처리 (네이버가 보증금 없는 매물을 "1"로 표기)
          const deposit = depositParsed <= 10000 ? 0 : depositParsed;
          const monthly = (monthlyStr.includes('억') || monthlyStr.includes('만'))
            ? parseDisplayAmount(monthlyStr)
            : (parseInt(monthlyStr.replace(/,/g, '')) || 0) * 10000;
          if (monthly > 0) {
            price = { type: 'monthly', deposit, monthly };
            priceRaw = depositStr + '/' + monthlyStr;
          }
        }
      }

      if (!price) return;

      // ── 면적 + 층: span.spec ("84/42m², 6/8층, 서향") ──
      let area = null;
      let floorNum = null;
      let floorText = '';

      const specEls = clone.querySelectorAll('span.spec');
      specEls.forEach(specEl => {
        const specText = specEl.textContent.trim();
        if (!area) area = parseAreaFromSpec(specText);
        if (floorNum === null) {
          const floorResult = parseFloorFromSpec(specText);
          floorNum = floorResult.floorNum;
          floorText = floorResult.floorText;
        }
      });

      // articleNo 없을 때 안정적 id: 가격+면적+층+거래유형 조합 (Date.now() 제거 → 중복 수집 방지)
      const stableId = articleNo || ('anon_' + [tradeText, priceRaw, area?.contractPyeong || '', area?.exclusivePyeong || '', floorText].join('_').replace(/[\s,]/g, ''));
      const listingUrl = articleNo ? 'https://new.land.naver.com/offices?articleNo=' + articleNo : null;
      // 중개사명: 카드 내 중개사 요소 (더 많은 셀렉터 시도)
      let realtorName = '';
      const realtorEl = clone.querySelector(
        '[class*="realtor_name"], [class*="realtorName"], [class*="realtor-name"], ' +
        '.realtor, .agent_name, [class*="agent"], [class*="broker"], ' +
        'span.realtor, div.realtor, [class*="Realtor"]'
      );
      if (realtorEl) realtorName = realtorEl.textContent.trim().replace(/\s+/g,' ');

      collected.push({
        id: stableId,
        url: listingUrl,
        priceRaw, price, area,
        floorInfo: floorText, floorNum,
        tradeType: tradeText,
        realtorName,
        collectedAt: Date.now()
      });
    } catch(e) {}
  });
  return collected;
}

// ─────────────────────────────────────────
// 오버레이 (전용면적 기준)
// ─────────────────────────────────────────
function injectOverlays() {
  document.querySelectorAll('.sangga-overlay').forEach(el => el.remove());
  const cards = document.querySelectorAll('a.item_link');
  if (!cards.length) return;

  cards.forEach(card => {
    try {
      const clone = card.cloneNode(true);
      clone.querySelectorAll('.sangga-overlay').forEach(el => el.remove());

      // 면적
      let area = null;
      clone.querySelectorAll('span.spec').forEach(specEl => {
        if (!area) area = parseAreaFromSpec(specEl.textContent.trim());
      });
      if (!area) return;

      const excPyeong = area.exclusivePyeong;
      if (!excPyeong || excPyeong <= 0) return;

      // 가격 (범위 최고가 span 제거 후 취득)
      const typeEl = clone.querySelector('span.type');
      clone.querySelectorAll('span.price--highest, span.price.price--highest').forEach(el => el.remove());
      const priceEl = clone.querySelector('span.price');
      const tradeText = typeEl ? typeEl.textContent.trim() : '';
      const priceText = priceEl ? priceEl.textContent.trim().split('~')[0].trim() : '';

      let saleAmount = 0, monthlyAmount = 0, depositAmount = 0;

      if (tradeText === '매매') {
        saleAmount = parseDisplayAmount(priceText);
      } else if (tradeText === '월세') {
        const slashIdx = priceText.indexOf('/');
        if (slashIdx !== -1) {
          depositAmount = parseInt(priceText.substring(0, slashIdx).replace(/,/g, '')) * 10000;
          monthlyAmount = parseInt(priceText.substring(slashIdx + 1).replace(/,/g, '')) * 10000;
        }
      }

      const tags = [];
      if (saleAmount > 0) {
        const pp = Math.round(saleAmount / 10000 / excPyeong);
        tags.push({ text: '매매평단 ' + pp.toLocaleString() + '만', bg: 'rgba(124,58,237,0.15)', border: 'rgba(124,58,237,0.5)', color: '#a78bfa' });
      }
      if (monthlyAmount > 0) {
        const rp = Math.round(monthlyAmount / 10000 / excPyeong * 10) / 10;
        const rpStr = Number.isInteger(rp) ? rp.toLocaleString() : rp.toFixed(1);
        tags.push({ text: '임대평단 ' + rpStr + '만', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.5)', color: '#60a5fa' });
      }
      if (saleAmount > 0 && monthlyAmount > 0) {
        const invest = saleAmount - depositAmount;
        if (invest > 0) {
          const yld = (monthlyAmount * 12 / invest * 100).toFixed(1);
          tags.push({ text: '수익률 ' + yld + '%', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', color: '#34d399' });
        }
      }

      const priceLine = card.querySelector('div.price_line');
      if (!priceLine) return;

      const areaTag = document.createElement('span');
      areaTag.className = 'sangga-overlay';
      areaTag.style.cssText = 'display:inline-flex;align-items:center;margin-left:4px;font-size:11px;font-weight:600;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:4px;padding:1px 5px;color:#c4b5fd;vertical-align:middle;white-space:nowrap;';
      areaTag.textContent = '전용 ' + excPyeong + '평';
      priceLine.appendChild(areaTag);

      let insertAfter = areaTag;
      tags.forEach(tag => {
        const el = document.createElement('span');
        el.className = 'sangga-overlay';
        el.style.cssText = `display:inline-flex;align-items:center;margin-left:3px;font-size:11px;font-weight:600;background:${tag.bg};border:1px solid ${tag.border};border-radius:4px;padding:1px 5px;color:${tag.color};vertical-align:middle;white-space:nowrap;`;
        el.textContent = tag.text;
        insertAfter.after(el);
        insertAfter = el;
      });
    } catch(e) {}
  });
}

// ─────────────────────────────────────────
// 수집
// ─────────────────────────────────────────
let lastCollectPathKey = '';
let apiPollTimer = null;      // 주기적 API 폴링 타이머
let lastApiCallUrl = '';      // 마지막 API 호출 URL (중복 방지)
let mapMoveTimer = null;      // 지도 이동 디바운스 타이머

function getPathKey() {
  const url = new URL(window.location.href);
  const cortarNo = url.searchParams.get('cortarNo') || '';
  const rletTpCd = url.searchParams.get('rletTpCd') || '';
  return url.pathname + '|' + cortarNo + '|' + rletTpCd;
}

// 지도 중심좌표 추출 (ms 파라미터)
function getMapKey() {
  const ms = new URL(window.location.href).searchParams.get('ms') || '';
  const parts = ms.split(',');
  if (parts.length < 2) return '';
  // 소수점 2자리까지만 비교 (너무 민감하지 않게)
  return parseFloat(parts[0]).toFixed(2) + ',' + parseFloat(parts[1]).toFixed(2) + ',' + (parts[2] || '');
}

// 수집 시작: API 폴링 루프 시작
function startApiPolling() {
  stopApiPolling();
  // 즉시 1회 호출
  fetchArticleNosFromApi();
  // 이후 3초마다 반복 (지도 이동 감지 포함)
  apiPollTimer = setInterval(() => {
    if (!isCollecting) { stopApiPolling(); return; }
    const curMapKey = getMapKey();
    // 지도가 이동했거나 항상 호출 (매물 URL 보완)
    if (curMapKey !== lastApiCallUrl) {
      lastApiCallUrl = curMapKey;
      fetchArticleNosFromApi();
    }
    // DOM 카드도 재스캔
    doCollectQuiet();
  }, 3000);
}

function stopApiPolling() {
  if (apiPollTimer) { clearInterval(apiPollTimer); apiPollTimer = null; }
}

// 조용히 수집 (LIST_DATA 메시지 발송 포함, 오버레이 갱신)
function doCollectQuiet() {
  const items = scrapeListingList();
  let changed = false;
  items.forEach(item => {
    if (listingMap.has(item.id)) return;
    if (!item.id.startsWith('anon_')) { listingMap.set(item.id, item); changed = true; return; }
    const isDup = [...listingMap.values()].some(ex => {
      if (ex.tradeType !== item.tradeType) return false;
      const priceSame = ex.price?.type === item.price?.type &&
        Math.abs((ex.price?.amount||ex.price?.monthly||0)-(item.price?.amount||item.price?.monthly||0)) < 10000;
      const areaSame = Math.abs((ex.area?.exclusive||ex.area?.contract||0)-(item.area?.exclusive||item.area?.contract||0)) < 2;
      return priceSame && areaSame && ex.floorNum === item.floorNum;
    });
    if (!isDup) { listingMap.set(item.id, item); changed = true; }
  });
  if (changed) {
    const all = Array.from(listingMap.values());
    chrome.runtime.sendMessage({ type: 'LIST_DATA', listings: all, count: all.length }).catch(() => {});
  }
  injectOverlays();
  if (isCollecting) enqueueRentFetch();
}

function tagActiveCardWithArticleNo(articleNo) {
  const activeCard =
    document.querySelector('a.item_link.is-active') ||
    document.querySelector('a.item_link[aria-expanded="true"]') ||
    document.querySelector('.item.is-selected a.item_link') ||
    document.querySelector('.item--selected a.item_link') ||
    document.querySelector('.item_inner.is-active a.item_link');
  if (activeCard && articleNo) {
    activeCard.dataset.sanggaNo = articleNo;
  }
  attachCardHoverTagging();
}

function doCollect() {
  const curKey = getPathKey();
  if (lastCollectPathKey && curKey !== lastCollectPathKey) {
    listingMap.clear();
    lastApiCallUrl = '';
    if (isCollecting) startApiPolling();
  }
  lastCollectPathKey = curKey;

  const items = scrapeListingList();
  items.forEach(item => {
    if (listingMap.has(item.id)) return;
    if (!item.id.startsWith('anon_')) { listingMap.set(item.id, item); return; }
    const isDup = [...listingMap.values()].some(ex => {
      if (ex.tradeType !== item.tradeType) return false;
      const priceSame = ex.price?.type === item.price?.type &&
        Math.abs((ex.price?.amount||ex.price?.monthly||0)-(item.price?.amount||item.price?.monthly||0)) < 10000;
      const areaSame = Math.abs((ex.area?.exclusive||ex.area?.contract||0)-(item.area?.exclusive||item.area?.contract||0)) < 2;
      return priceSame && areaSame && ex.floorNum === item.floorNum;
    });
    if (!isDup) listingMap.set(item.id, item);
  });
  const all = Array.from(listingMap.values());
  chrome.runtime.sendMessage({ type: 'LIST_DATA', listings: all, count: all.length }).catch(() => {});
  injectOverlays();
  return all.length;
}


// ─────────────────────────────────────────
// 상세 스크랩 결과를 listingMap에 머지
// ─────────────────────────────────────────
function mergeScrapedListing(data) {
  if (!data?.id) return;
  if (listingMap.has(data.id)) {
    // articleNo 직접 매칭
    const ex = listingMap.get(data.id);
    if (data.floorInfo) ex.floorInfo = data.floorInfo;
    if (data.floorNum !== null && data.floorNum !== undefined) ex.floorNum = data.floorNum;
    if (data.area) ex.area = data.area;
    if (data.price) ex.price = data.price;
    if (data.direction) ex.direction = data.direction;
    if (data.tradeType) ex.tradeType = data.tradeType;
    if (data.url) ex.url = data.url;
    // rentPrice: 상세페이지에서 가져온 임대중 정보 병합 (없으면 명시적으로 null)
    ex.rentPrice = data.rentPrice || null;
    listingMap.set(data.id, ex);
  } else {
    // anon_ 매물 중 면적+가격 일치하는 것 탐색 (허용오차 넓힘)
    let matched = null;
    const scraped_area = data.area?.exclusive || data.area?.contract || 0;
    for (const [key, item] of listingMap.entries()) {
      if (!key.startsWith('anon_')) continue;
      const item_area = item.area?.exclusive || item.area?.contract || 0;
      // 면적 허용오차: 3㎡ 이내 (이전 2㎡에서 넓힘)
      if (scraped_area > 0 && item_area > 0 && Math.abs(item_area - scraped_area) > 3) continue;
      // 가격 매칭 (허용오차 1억원 이내)
      if (data.price && item.price?.type === data.price.type) {
        const priceMatch = data.price.type === 'sale'
          ? Math.abs((item.price.amount || 0) - (data.price.amount || 0)) < 100000000
          : Math.abs((item.price.monthly || 0) - (data.price.monthly || 0)) < 1000000;
        if (!priceMatch) continue;
      }
      matched = item;
      break;
    }
    if (matched) {
      const oldKey = matched.id;
      matched.id = data.id;
      matched.url = data.url;
      if (data.floorInfo) matched.floorInfo = data.floorInfo;
      if (data.floorNum !== null && data.floorNum !== undefined) matched.floorNum = data.floorNum;
      if (data.area) matched.area = data.area;
      if (data.direction) matched.direction = data.direction;
      if (data.tradeType) matched.tradeType = data.tradeType;
      // rentPrice: 상세페이지에서 가져온 임대중 정보 병합 (없으면 명시적으로 null)
      matched.rentPrice = data.rentPrice || null;
      listingMap.delete(oldKey);
      listingMap.set(data.id, matched);
    } else {
      // 새 매물로 추가
      listingMap.set(data.id, {
        id: data.id, priceRaw: data.priceRaw, price: data.price,
        area: data.area, floorInfo: data.floorInfo, floorNum: data.floorNum,
        direction: data.direction, tradeType: data.tradeType,
        title: data.title, url: data.url, collectedAt: Date.now()
      });
    }
  }
  // 카드 목록도 재스캔해서 놓친 것 없는지 확인
  doCollect();
}

function watchForListingChanges() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    const cur = getArticleNoFromUrl(window.location.href);
    if (cur && cur !== lastArticleNo) {
      lastArticleNo = cur;
      tagActiveCardWithArticleNo(cur);
      // 여러 번 재시도해서 누락 방지 (500ms, 1200ms, 2500ms)
      const tryCollect = (delay) => setTimeout(() => {
        const data = scrapeListing();
        if (!data.id) return;
        chrome.runtime.sendMessage({ type: 'LISTING_DATA', data }).catch(() => {});
        if (isCollecting) {
          mergeScrapedListing(data);
        }
      }, delay);
      tryCollect(500);
      tryCollect(1200);
      tryCollect(2500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      const cur = getArticleNoFromUrl(window.location.href);
      if (cur && cur !== lastArticleNo) {
        lastArticleNo = cur;
        const data = scrapeListing();
        if (data.id) chrome.runtime.sendMessage({ type: 'LISTING_DATA', data }).catch(() => {});
        if (isCollecting) doCollect();
      }
    }, 1000);
  });
}

setTimeout(() => {
  const a = getArticleNoFromUrl(window.location.href);
  if (a) { lastArticleNo = a; const data = scrapeListing(); if (data.id) chrome.runtime.sendMessage({ type: 'LISTING_DATA', data }).catch(() => {}); }
  watchForListingChanges();
  injectOverlays();
}, 1500);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE_NOW') sendResponse({ data: scrapeListing() });
  if (message.type === 'START_COLLECT') { isCollecting = true; startApiPolling(); sendResponse({ success: true, count: doCollect() }); }
  if (message.type === 'STOP_COLLECT') { isCollecting = false; stopApiPolling(); sendResponse({ success: true }); }
  if (message.type === 'GET_LIST_NOW') { sendResponse({ listings: Array.from(listingMap.values()), count: doCollect() }); }
  if (message.type === 'CLEAR_LIST') { listingMap.clear(); isCollecting = false; stopApiPolling(); lastApiCallUrl = ''; sendResponse({ success: true }); }
  return true;
});


// ─────────────────────────────────────────
// 백그라운드 자동 rentPrice 수집
// 매매 매물 상세 페이지 HTML fetch → NEXT_DATA + 기보증금/월세 파싱
// ─────────────────────────────────────────
const rentFetchQueue = [];
const rentFetchDone = new Set();
let rentFetchRunning = false;

function enqueueRentFetch() {
  for (const [key, item] of listingMap.entries()) {
    if (item.price?.type !== 'sale') continue;
    if (item.rentPrice) continue;
    const no = key.startsWith('anon_') ? null : key;
    if (!no) continue;
    if (rentFetchDone.has(no)) continue;
    if (rentFetchQueue.includes(no)) continue;
    rentFetchQueue.push(no);
  }
  if (!rentFetchRunning) processRentFetchQueue();
}

async function processRentFetchQueue() {
  rentFetchRunning = true;
  while (rentFetchQueue.length > 0) {
    if (!isCollecting) break;
    const no = rentFetchQueue.shift();
    if (!no || rentFetchDone.has(no)) continue;
    rentFetchDone.add(no);
    try { await fetchRentPriceForArticle(no); } catch(e) {}
    await new Promise(r => setTimeout(r, 400));
  }
  rentFetchRunning = false;
}

async function fetchRentPriceForArticle(articleNo) {
  // 네이버 부동산은 SPA이므로 HTML fetch로는 데이터를 얻을 수 없음.
  // 상세 API를 직접 호출: /api/articles/{articleNo}
  const apiUrl = `https://new.land.naver.com/api/articles/${articleNo}`;
  let d = null;
  try {
    const res = await fetchWithBackoff(apiUrl, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Referer': 'https://new.land.naver.com/' }
    }, 3);
    if (!res) return;
    const json = await res.json();
    // 응답 구조: { articleDetail: {...}, ... } 또는 직접 상세 객체
    d = json?.articleDetail || json?.result?.articleDetail || json;
    if (!d?.tradeTypeName && !d?.dealOrWarrantPrc) return;
  } catch(e) { return; }

  // 매매 물건이 아니면 skip
  if (d.tradeTypeName && d.tradeTypeName !== '매매') return;

  // 월세 (rentPrc)
  const rPrc = (d.rentPrc || '').replace(/,/g, '');
  if (!rPrc || rPrc === '0') return;
  const monthly = parseNextDataAmount(rPrc);
  if (!(monthly > 0)) return;

  // 임대 보증금: warrantyPrc (임대중 매매물건 전용 필드)
  // 없으면 dealOrWarrantPrc는 매매가이므로 보증금 0으로 처리
  const warPrc = (d.warrantyPrc || '').replace(/,/g, '');
  const deposit = (warPrc && warPrc !== '0') ? parseNextDataAmount(warPrc) : 0;

  const rentPriceObj = { type: 'monthly', deposit: deposit || 0, monthly };
  if (listingMap.has(articleNo)) {
    const item = listingMap.get(articleNo);
    item.rentPrice = rentPriceObj;
    listingMap.set(articleNo, item);
    const all = Array.from(listingMap.values());
    chrome.runtime.sendMessage({ type: 'LIST_DATA', listings: all, count: all.length }).catch(() => {});
  }
}
