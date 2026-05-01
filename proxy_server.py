#!/usr/bin/env python3
"""
부동산 통합 프록시 서버
- 지원 사이트: 네이버 부동산 / 아싸점포거래소 / 점포라인 / 디스코 / 부동산플래닛
- 소상공인 API: 반경 분석만 사용
- 포트: 8080
- 실행: python3 proxy_server.py

★ 네이버 토큰 만료 시 (보통 1~2시간):
  Firefox → 네이버 부동산 → F12 → 네트워크 탭 → articles?... 클릭
  → 헤더 탭 → authorization / Cookie 값 복사 → 아래 TOKEN/COOKIE 교체 → 재실행
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.parse
import json
import re
import time
import random
import os
import math
import ssl
import base64
import mimetypes
import certifi

# SSL 인증서 전역 설정 (macOS Python 3.11에서 필요)
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())
def _urlopen(req, timeout=15):
    return urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)

PROXY_PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_UPLOAD_ROOT = os.path.join(BASE_DIR, '_proxy_uploads')
ALLOWED_STORAGE_BUCKETS = {'attachments', 'room-images', 'kcard-images'}

# 플래닛 쿠키 전역 캐시 (수집 시 자동 저장, 층수 조회 시 재사용)
BDS_COOKIE_CACHE = 'bdsp_usid=MTU0Y2Q1NTUtNGZmNC00YmZjLWFmNzktOGZhNDYzZTE1ZDM4; real=NTMwM2UzNDItZWFkOC00OTk3LWJlYzktNjA5NTcyMDgzNzYy; _gcl_au=1.1.1914616534.1771765987; _fbp=fb.1.1771765987807.808252917601495943; _gid=GA1.2.1315729604.1771765988; ckSsPpPopup=true; lastLoggedInSNS_b=naver; skele=Y; refresh=eyJhbGciOiJIUzI1NiJ9.eyJjYXRlZ29yeSI6Ijk3eW5XOGh1TDBtNThtR25PaW9UYlE9PSIsInVzZXJfY29kZSI6ImEzMndIYlFlNWM3dGpqbURyM1JkM0tjR3FUNjEzMStFcVpVNXZwOW5EVCtVdXJnckhhR3ZwQT09Iiwicm9sZSI6IkM3RlFkMzRwTnpDK1hLSGdBZEo3cktSUkdpczBDaHRzIiwiZW1haWwiOiJMNDZUWWxFaEtDZFpOZGlyMzlsR09CMDZhYml6R3ZucXZ1ZzBvTnV0SENJPSIsImF0ayI6Ik1OUVRUSGcvL1hwbzBJdHZ1bndxUjJMS3ZJZjVWVlNNNmZrZHdHTjA3Ykl2ZXQ3dEpScEhSV2pwVU8vanpxRURoNks0TGNuOG9HRXRGdEM2WURPUFBzVWY1YlA4K0lhTTgvd1dlY1lFbUp6cDdiYmFCSUROUFRxRGVRY21UZGhEaWF6NTNSK3Z6d3gwVHR4STc5Mnp0Z3JjV0tUcUx2cE1mS2ZnWUtibUtkSXY4T3h1VlNXcVErNGFVcXRMdDhoNXNGdS9QZ0hidS9XcTBYME9YZnRySFMzK3ZhdHhtQkQxRytYVFJvSWxTaDhTbzNEbjVVTzJaNVFYZmxsUjZQNFA3eThYUDhwWVNTQUdWbW1ZYnk3bXNRdDNJV25qTjlkOXVUNEs1SnQvWE1JWng0MmVTTWNKQ0tGc3plcEw5SHRwVXF1SzhzUEExbFNsV1R1WHd3b2FnWTZ3d3ZTeWMzZVZIYVpGMU1xR1ViaW1PREVMWTcxZ3g0eWtpMTY4dld0OURFVXc3cGlqYnF1M2ZINm00NFpRQzMwNkZ1em9wSTlHbk9lNVBibExlSEM5b3hGc2tkbDJZZjBNN0FuZ25jYjdsY2xkcjBWcjF4MTZpZkFyNE5DYzJoMlAvaHJNd2hyQ2ZaYW5YUTdGd2kwT2VJMzZYc2trNHZsaWRaSkxveVJPdlZtem5PZXJmeHZuNWZpbC9JR0NMUmxYcndFWXJ3Q2RlVERkeDk2dS9WYTdrZzBJaWZRNXFLekJwblFCSmhrS2dRcGNBYk9wK1JpRCtkZGVPakhLQXZxV2M0a1ppUWM2IiwiaWF0IjoxNzcxODYyMTM2LCJleHAiOjE3NzE5NDg1MzZ9.jKfkEmxCF7pQS6YTWGCqbBHu8-z_xwEKuDRmUVzvR5A; access=eyJhbGciOiJIUzI1NiJ9.eyJjYXRlZ29yeSI6ImRWbmdzajZOY0xXaG90OWYxYkhBbkE9PSIsInVzZXJfY29kZSI6IkRkeDBwc0t3eFQvR3pCbFFCQjdkY24xaHI4eEh6dTFwZ2x4bmtiSytlVVFlWXlaSnFMbW5yZz09Iiwicm9sZSI6IlRISlcyMTE1OG9Qc1pWcGFtVGE5MDh2TnpKSGxaRnE2IiwiZW1haWwiOiJtVXlqckZmRWI4UzRNTlp2ZzFaS21nQnJ5TUtoQ3o2ODltcktLaGpIV2pBPSIsImF0ayI6IlB3bkkvbmlpNVZLYy8renkrQ0wrTGtpZGxFaENMY05zIiwiaWF0IjoxNzcxODYyMTM2LCJleHAiOjE3NzE5MDUzMzZ9.u8AvZq6absVkp7BWp5u9iLx9_TOesPAq_TVCGWF_ObE; _ga_W0HCMCWKMZ=GS2.1.s1771861450$o6$g1$t1771862137$j60$l0$h0; mp_5c381f458032505385ed0973771610c7_mixpanel=%7B%22distinct_id%22%3A%22%24device%3Aa47863bf-15c2-490d-a7ce-80388027a301%22%2C%22%24device_id%22%3A%22a47863bf-15c2-490d-a7ce-80388027a301%22%2C%22%24initial_referrer%22%3A%22https%3A%2F%2Fproperty.bdsplanet.com%2F%22%2C%22%24initial_referring_domain%22%3A%22property.bdsplanet.com%22%2C%22__mps%22%3A%7B%7D%2C%22__mpso%22%3A%7B%22%24initial_referrer%22%3A%22https%3A%2F%2Fproperty.bdsplanet.com%2F%22%2C%22%24initial_referring_domain%22%3A%22property.bdsplanet.com%22%7D%2C%22__mpus%22%3A%7B%7D%2C%22__mpa%22%3A%7B%7D%2C%22__mpu%22%3A%7B%7D%2C%22__mpr%22%3A%5B%5D%2C%22__mpap%22%3A%5B%5D%2C%22user_code%22%3A%22USER_20250814174456000001%22%2C%22__alias%22%3A%22USER_20250814174456000001%22%2C%22%24user_id%22%3A%22USER_20250814174456000001%22%7D; _ga=GA1.2.2073191771.1771765985; _ga_ZMYFVJ62R4=GS2.1.s1771860671$o12$g1$t1771862827$j57$l0$h0; _gat_UA-72361022-1=1'

TOKEN  = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IlJFQUxFU1RBVEUiLCJpYXQiOjE3NzE4MzQ0NjgsImV4cCI6MTc3MTg0NTI2OH0.0JrIMhLcyMaiwG53ZCrWlQSJCYjBv7aU8CvBZVvwhRg'
COOKIE = 'nhn.realestate.article.trade_type_cd=""; nhn.realestate.article.ipaddress_city=1100000000; _fwb=181mH6x2wXJDj21u5GAHx4P.1771610345285; landHomeFlashUseYn=Y; NAC=PHbTB8QuizZH; NNB=XFGGRJ7JUCMGS; BUC=uuOcrBxBEVOhIzqj7sRxhTfUr72bhkrkpOycivPRMwQ=; nhn.realestate.article.rlet_type_cd=A01; REALESTATE=Mon%20Feb%2023%202026%2017%3A14%3A28%20GMT%2B0900%20(Korean%20Standard%20Time); PROP_TEST_KEY=1771834468230.b0106ce42c27dcd1b4a1d804e79d6b08ae096517f2981164c4ccf057c170ccb5; PROP_TEST_ID=a4861023da9c97cf6f3bcd9052feceb7b1ce4cac9539cab47f65e3fc1625cd8b; _fwb=181mH6x2wXJDj21u5GAHx4P.1771610345285; NACT=1; SHOW_FIN_BADGE=Y; bnb_tooltip_shown_finance_v1=true; SRT30=1771834421; SRT5=1771834421'

NAVER_FIN_HOME = 'https://fin.land.naver.com/home'
NAVER_FIN_ORIGIN = 'https://fin.land.naver.com'
NAVER_LEGACY_HOME = 'https://new.land.naver.com/'
NAVER_LEGACY_ORIGIN = 'https://new.land.naver.com'
NAVER_MOBILE_HOME = 'https://m.land.naver.com/'
NAVER_MOBILE_ORIGIN = 'https://m.land.naver.com'

def _naver_article_page_url(article_no):
    return f'https://fin.land.naver.com/articles/{article_no}'

def _naver_detail_api_url(article_no):
    return f'https://new.land.naver.com/api/articles/{article_no}'

def _extract_naver_article_no(url):
    m = re.search(r'(?:articleNo=|/articles/)(\d+)', str(url or ''))
    return m.group(1) if m else ''

def _build_naver_headers(target_url='', token='', cookie='', accept='application/json, text/plain, */*'):
    target_url = str(target_url or '')
    if 'm.land.naver.com' in target_url:
        referer = NAVER_MOBILE_HOME
        origin = NAVER_MOBILE_ORIGIN
    elif 'fin.land.naver.com' in target_url:
        referer = NAVER_FIN_HOME
        origin = NAVER_FIN_ORIGIN
    else:
        referer = NAVER_LEGACY_HOME
        origin = NAVER_LEGACY_ORIGIN

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': accept,
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': referer,
        'Origin': origin,
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
    }
    if token:
        headers['authorization'] = token
    if cookie:
        headers['Cookie'] = cookie
    return headers

def _naver_money_to_man(value):
    try:
        n = float(str(value or '').replace(',', '').strip())
    except Exception:
        return None
    if not n or n <= 0:
        return None
    # fin.land 프론트 API는 원 단위를 반환하고, 기존 앱 저장 포맷은 만원 기준이다.
    return int(round(n / 10000)) if n >= 100000 else int(round(n))

def _naver_direction_to_korean(value):
    raw = str(value or '').strip()
    if not raw:
        return None
    chars = []
    for ch in raw.replace('향', ''):
        upper = ch.upper()
        if upper == 'E' or ch == '동':
            chars.append('동')
        elif upper == 'W' or ch == '서':
            chars.append('서')
        elif upper == 'S' or ch == '남':
            chars.append('남')
        elif upper == 'N' or ch == '북':
            chars.append('북')
    if not chars:
        return raw
    uniq = []
    for ch in chars:
        if ch not in uniq:
            uniq.append(ch)
    ns = next((ch for ch in uniq if ch in ('남', '북')), '')
    ew = next((ch for ch in uniq if ch in ('동', '서')), '')
    if ns and ew:
        return f'{ns}{ew}향'
    if len(uniq) == 1:
        return f'{uniq[0]}향'
    return ''.join(uniq) + '향'

def _build_naver_item_from_detail(raw, article_no):
    if not isinstance(raw, dict):
        raise ValueError(f'상세 응답 형식 오류: {type(raw).__name__}')
    d = raw.get('articleDetail') or {}
    pr = raw.get('articlePrice') or {}
    sp = raw.get('articleSpace') or {}
    fl = raw.get('articleFloor') or {}
    rl = raw.get('articleRealtor') or {}
    af = raw.get('articleFacility') or {}

    trade = d.get('tradeTypeName', '')
    deal_price = _naver_money_to_man(pr.get('dealPrice', 0))
    warrant_price = _naver_money_to_man(pr.get('warrantPrice', 0))
    rent_price = _naver_money_to_man(pr.get('rentPrice', 0))
    premium = _naver_money_to_man(pr.get('premiumPrice', 0))
    item_type = '매매용' if trade == '매매' else '임대용'

    parking_yn = d.get('parkingPossibleYN', '')
    parking_cnt = d.get('parkingCount', '')
    if parking_yn == 'Y':
        parking_str = f'가능 ({parking_cnt}대)' if parking_cnt else '가능'
    elif parking_yn == 'N':
        parking_str = '불가'
    else:
        parking_str = ''

    mgmt_raw = (
        d.get('monthlyManagementCost') or
        d.get('managementCost') or
        d.get('mngtCost') or
        pr.get('manageCost') or
        pr.get('managementCost') or
        0
    )
    mgmt = round(mgmt_raw / 10000) if mgmt_raw and mgmt_raw > 0 else None

    aprv_ymd = af.get('buildingUseAprvYmd', '')
    if len(aprv_ymd) == 8:
        aprv_ymd = f'{aprv_ymd[:4]}.{aprv_ymd[4:6]}.{aprv_ymd[6:]}'

    return {
        '매물번호': article_no,
        '매물명': d.get('articleName', ''),
        '매물유형': item_type,
        '거래유형': trade or None,
        '매매가': deal_price if deal_price else None,
        '기보증금_만원': warrant_price if warrant_price else None,
        '월세_만원': rent_price if rent_price else None,
        '권리금_만원': premium if premium else None,
        '관리비_만원': mgmt if mgmt else None,
        '관리비포함': None,
        '계약면적_m2': sp.get('supplySpace') or None,
        '전용면적_m2': sp.get('exclusiveSpace') or None,
        '해당층': fl.get('correspondingFloorCount') or None,
        '총층': fl.get('totalFloorCount') or None,
        '방향': _naver_direction_to_korean(af.get('directionTypeName', '') or d.get('directionTypeName', '')),
        '주차': parking_str or None,
        '건축물용도': d.get('lawUsage') or None,
        '사용승인일': aprv_ymd or None,
        '입주가능일': d.get('moveInTypeName') or None,
        '중개사': rl.get('realtorName') or None,
        '전화번호': rl.get('representativeTelNo', '') or rl.get('cellPhoneNo', '') or None,
        '매물특징': d.get('articleFeatureDescription', '')[:300] or None,
        '수익률_퍼센트': (lambda t: float(m.group(1)) if (m := re.search(r'수익률[^\d]*([\d]+\.?[\d]*)\s*%', t)) else None)(d.get('articleFeatureDescription', '') or ''),
        '소재지': d.get('exposureAddress', '') or d.get('detailAddress', ''),
        'lat': d.get('latitude', ''),
        'lng': d.get('longitude', ''),
        '상세URL': _naver_article_page_url(article_no),
        '출처': '네이버부동산',
    }

NAVER_HEADERS = _build_naver_headers(NAVER_FIN_HOME, TOKEN, COOKIE)


class ProxyHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        path = args[0].split('"')[1] if '"' in args[0] else args[0]
        print(f"  [{args[1]}] {path[:100]}")

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        # ★ FIX: CORS preflight는 204 No Content가 표준
        # 200 + 빈 본문은 일부 브라우저에서 preflight 실패 유발
        self.send_response(204)
        self.send_cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == '/':
            self._ok('{"status":"ok"}')

        elif parsed.path == '/proxy':
            target_url = urllib.parse.unquote(qs.get('url', [''])[0])
            if not target_url:
                self._error(400, 'url 파라미터가 필요합니다')
                return
            self._fetch_and_return(target_url)

        elif parsed.path == '/search':
            query = qs.get('query', [''])[0]
            url = f'https://new.land.naver.com/api/search?query={urllib.parse.quote(query)}&all=true&useFilter=true&isListSearch=false'
            self._fetch_and_return(url)

        elif re.match(r'^/complex/(\d+)/articles$', parsed.path):
            m = re.match(r'^/complex/(\d+)/articles$', parsed.path)
            url = f'https://new.land.naver.com/api/articles/complex/{m.group(1)}?{parsed.query}'
            self._fetch_and_return(url)

        elif re.match(r'^/complex/(\d+)/info$', parsed.path):
            m = re.match(r'^/complex/(\d+)/info$', parsed.path)
            url = f'https://new.land.naver.com/api/complexes/{m.group(1)}?sameAddressGroup=false'
            self._fetch_and_return(url)

        elif parsed.path == '/regions':
            cortar = qs.get('cortarNo', [''])[0]
            url = f'https://new.land.naver.com/api/regions/complexes?cortarNo={cortar}&realEstateType=APT:ABYG:JGC:OPST&order='
            self._fetch_and_return(url)

        elif parsed.path == '/api/news':
            # ★ 네이버 뉴스 검색 API 프록시
            # GET /api/news?keyword=부동산경매&display=7&client_id=XXX&client_secret=YYY
            keyword     = qs.get('keyword', [''])[0]
            display     = qs.get('display', ['7'])[0]
            client_id   = qs.get('client_id', [''])[0]
            client_secret = qs.get('client_secret', [''])[0]

            if not keyword:
                self._error(400, 'keyword 파라미터가 필요합니다')
                return
            if not client_id or not client_secret:
                self._error(400, 'client_id, client_secret 파라미터가 필요합니다')
                return

            naver_url = (
                f'https://openapi.naver.com/v1/search/news.json'
                f'?query={urllib.parse.quote(keyword)}'
                f'&display={display}'
                f'&sort=date'
            )
            news_headers = {
                'X-Naver-Client-Id':     client_id,
                'X-Naver-Client-Secret': client_secret,
                'User-Agent': 'Mozilla/5.0',
            }
            try:
                req = urllib.request.Request(naver_url, headers=news_headers)
                with _urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/json; charset=utf-8')
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(data)
            except urllib.error.HTTPError as e:
                body = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self._error(500, f'네이버 뉴스 API 오류: {str(e)}')

        elif parsed.path == '/api/storage_list':
            bucket = urllib.parse.unquote(qs.get('bucket', [''])[0])
            prefix = urllib.parse.unquote(qs.get('prefix', [''])[0])
            self._handle_storage_list(bucket, prefix)

        elif parsed.path.startswith('/uploads/'):
            m = re.match(r'^/uploads/([^/]+)/(.+)$', parsed.path)
            if not m:
                self._error(404, '잘못된 업로드 경로입니다')
                return
            bucket = urllib.parse.unquote(m.group(1))
            rel_path = urllib.parse.unquote(m.group(2))
            self._serve_local_upload(bucket, rel_path)

        else:
            self._error(404, f'알 수 없는 경로: {parsed.path}')

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        def _read_max_n(payload, default=None):
            try:
                v = int(payload.get('max_n', 0))
                return v if v > 0 else default
            except Exception:
                return default

        # ★ 신규: HTML에서 토큰/쿠키를 실시간으로 서버에 적용 (py 재시작 불필요)
        if parsed.path == '/api/set_token':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            token  = payload.get('token', '').strip()
            cookie = payload.get('cookie', '').strip()
            if not token or not cookie:
                self._error(400, 'token과 cookie 모두 필요합니다')
                return
            # 전역 헤더에 즉시 반영
            NAVER_HEADERS['authorization'] = token
            NAVER_HEADERS['Cookie'] = cookie
            print(f"\n  🔑 토큰 갱신됨: {token[:40]}...")
            print(f"  🍪 쿠키 갱신됨: {cookie[:60]}...")
            self._ok(json.dumps({'status': 'ok', 'message': '토큰/쿠키 적용 완료'}, ensure_ascii=False))
            return

        if parsed.path == '/api/storage_upload':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            bucket = payload.get('bucket', '')
            path = payload.get('path', '')
            data_url = payload.get('data_url', '')
            content_type = payload.get('content_type', '')
            self._handle_storage_upload(bucket, path, data_url, content_type)
            return

        if parsed.path == '/api/storage_delete':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            bucket = payload.get('bucket', '')
            paths = payload.get('paths', [])
            self._handle_storage_delete(bucket, paths)
            return

        if parsed.path == '/api/assa':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            cisession      = payload.get('cisession', '')
            kakao_rest_key = payload.get('kakao_rest_key', '')
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            max_n = _read_max_n(payload)
            ids   = payload.get('ids', [])  # 구형 fallback
            if not cisession and not ids:
                self._error(400, 'cisession 쿠키 또는 ids가 필요합니다')
                return
            print(f"\n  🔵 아싸점포 수집 시작 (lat={lat}, lng={lng})...")
            self._collect_assa(
                cisession=cisession,
                kakao_rest_key=kakao_rest_key,
                lat=lat, lng=lng,
                nelat=nelat, swlat=swlat,
                nelng=nelng, swlng=swlng,
                ids=ids,
                max_n=max_n,
            )

        elif parsed.path == '/api/jumpo':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            jumpo_cookie   = payload.get('cookie', '')
            kakao_rest_key = payload.get('kakao_rest_key', '')
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            max_n = _read_max_n(payload)
            if not lat:
                self._error(400, '좌표(lat/lng)가 필요합니다')
                return
            print(f"\n  🟠 점포라인 수집 시작 (lat={lat}, lng={lng})...")
            self._collect_jumpo(
                cookie=jumpo_cookie,
                kakao_rest_key=kakao_rest_key,
                lat=lat, lng=lng,
                nelat=nelat, swlat=swlat,
                nelng=nelng, swlng=swlng,
                max_n=max_n,
            )

        elif parsed.path == '/api/nemo':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            kakao_rest_key = payload.get('kakao_rest_key', '')
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            max_n = _read_max_n(payload)
            if not lat:
                self._error(400, '좌표(lat/lng)가 필요합니다')
                return
            print(f"\n  🟢 네모 수집 시작 (lat={lat}, lng={lng})...")
            self._collect_nemo(
                kakao_rest_key=kakao_rest_key,
                lat=lat, lng=lng,
                nelat=nelat, swlat=swlat,
                nelng=nelng, swlng=swlng,
                max_n=max_n,
            )

        elif parsed.path == '/api/disco':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            kakao_rest_key = payload.get('kakao_rest_key', '')
            max_n = _read_max_n(payload)
            if not lat:
                self._error(400, '좌표(lat/lng)가 필요합니다')
                return
            print(f"\n  🟣 디스코 수집 시작 (lat={lat}, lng={lng})...")
            self._collect_disco(lat=lat, lng=lng, nelat=nelat, swlat=swlat, nelng=nelng, swlng=swlng, kakao_rest_key=kakao_rest_key, max_n=max_n)

        elif parsed.path == '/api/bds':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            cookie = payload.get('cookie', '')   # ★ 브라우저 쿠키 직접 수신
            request_url = payload.get('request_url', '')  # ★ F12 실제 getRealpriceMapMarker Request URL
            kakao_rest_key = payload.get('kakao_rest_key', '')
            max_n = _read_max_n(payload)
            if not lat:
                self._error(400, '좌표(lat/lng)가 필요합니다')
                return
            print(f"\n  🌍 부동산플래닛 수집 시작 (lat={lat}, lng={lng})...")
            self._collect_bds(lat=lat, lng=lng, nelat=nelat, swlat=swlat, nelng=nelng, swlng=swlng, cookie=cookie, request_url=request_url, kakao_rest_key=kakao_rest_key, max_n=max_n)

        elif parsed.path == '/api/naver_map':
            # ★ 신규: 토큰 없이 모바일 API로 지도 바운딩박스 수집
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            kakao_rest_key = payload.get('kakao_rest_key', '')
            lat   = payload.get('lat', '')
            lng   = payload.get('lng', '')
            nelat = payload.get('nelat', '')
            swlat = payload.get('swlat', '')
            nelng = payload.get('nelng', '')
            swlng = payload.get('swlng', '')
            kakao_level = payload.get('kakao_level', 4)
            rlet_tp  = payload.get('rletTpCd', 'SG:SMS:APTHGJ')
            trade_tp = payload.get('tradTpCd', 'A1:B1:B2')
            skip_detail = bool(payload.get('skip_detail', False))
            token = payload.get('token', '')
            cookie = payload.get('cookie', '')
            radius_m = payload.get('radius_m', None)
            max_n = int(payload.get('max_n', 100))  # ★ 최대 수집 개수 (기본 100)
            if not lat:
                self._error(400, '좌표(lat/lng)가 필요합니다')
                return
            print(f"\n  🟢 네이버 지도수집 시작 (lat={lat}, lng={lng}, kakao_level={kakao_level}, max_n={max_n})...")
            self._collect_naver_map(
                kakao_rest_key=kakao_rest_key,
                lat=lat, lng=lng,
                nelat=nelat, swlat=swlat,
                nelng=nelng, swlng=swlng,
                rlet_tp=rlet_tp, trade_tp=trade_tp,
                kakao_level=int(kakao_level),
                skip_detail=skip_detail,
                token=token,
                cookie=cookie,
                radius_m=radius_m,
                max_n=max_n,
            )

        elif parsed.path == '/api/naver':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return

            target_url = payload.get('target_val', '')
            token  = payload.get('token', '')
            cookie = payload.get('cookie', '')
            if not target_url.startswith('http'):
                self._error(400, '올바른 URL이 아닙니다')
                return

            print(f"\n  🟢 네이버 수집 시작: {target_url[:80]}...")
            kakao_rest_key = payload.get('kakao_rest_key', '')
            self._collect_naver(target_url, token, cookie, kakao_rest_key)

        elif parsed.path == '/api/floor_detail':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            source = payload.get('source', '')
            cookie = payload.get('cookie', '')

            import re as _re

            if source == 'bds':
                eais_pk      = payload.get('eais_pk', '')
                r_type       = payload.get('r_type', '')
                bldg_area_m2 = payload.get('bldg_area_m2', '')
                if not eais_pk:
                    self._ok(json.dumps({'floor': None, 'error': '필드 부족 (eais_pk 없음)'}, ensure_ascii=False))
                    return

                base_headers = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': f'https://www.bdsplanet.com/map/realprice_map/{eais_pk}/N/{r_type}/1/{bldg_area_m2}.ytp',
                }

                try:
                    # getBuildingInfo로 층수 조회 (로그인 쿠키 필요)
                    bldg_url = f'https://www.bdsplanet.com/map/getBuildingInfo.ytp?pnu_enc={eais_pk}'
                    print(f"  🏢 [플래닛 건물정보] {bldg_url}")

                    # 쿠키: 요청으로 전달된 cookie 우선, 없으면 캐시 사용
                    used_cookie = cookie or BDS_COOKIE_CACHE
                    bldg_headers = dict(base_headers)
                    if used_cookie:
                        bldg_headers['Cookie'] = used_cookie

                    req = urllib.request.Request(bldg_url, headers=bldg_headers)
                    with _urlopen(req, timeout=10) as resp:
                        raw = resp.read().decode('utf-8', errors='replace')

                    print(f"  📦 getBuildingInfo 응답 앞부분: {raw[:200]}")
                    bldg_data = json.loads(raw)

                    # eais_building_part_own_area에서 EAIS_KEY == eais_pk 인 "전유" 항목 찾기
                    detail = bldg_data.get('detail', {})
                    part_own_area = detail.get('eais_building_part_own_area', [])

                    floor_val = None
                    # 1순위: 전유 면적 항목에서 매칭
                    for item in part_own_area:
                        if item.get('EAIS_KEY') == eais_pk and item.get('EXPOS_PUB_CODE_NM') == '전유':
                            floor_val = item.get('FLOOR_NO_NM')
                            print(f"  ✅ 전유 항목 매칭: EAIS_KEY={item.get('EAIS_KEY')}, 층={floor_val}")
                            break

                    # 2순위: 전유 없으면 EAIS_KEY 매칭 첫 항목
                    if not floor_val:
                        for item in part_own_area:
                            if item.get('EAIS_KEY') == eais_pk:
                                floor_val = item.get('FLOOR_NO_NM')
                                print(f"  ✅ 일반 항목 매칭: EAIS_KEY={item.get('EAIS_KEY')}, 층={floor_val}")
                                break

                    # 3순위: EAIS_KEY 매칭 없으면 bldg_area_m2로 eais_building_floor에서 면적 근사 매칭
                    if not floor_val and bldg_area_m2:
                        building_floor = detail.get('eais_building_floor', [])
                        target_area = float(bldg_area_m2)
                        best_diff = float('inf')
                        best_floor = None
                        for item in building_floor:
                            try:
                                diff = abs(float(item.get('AREA_M2', 0)) - target_area)
                                if diff < best_diff:
                                    best_diff = diff
                                    best_floor = item.get('FLOOR_NM')
                            except:
                                pass
                        if best_floor and best_diff < target_area * 0.5:  # 50% 이내 근사
                            floor_val = best_floor
                            print(f"  ✅ 면적 근사 매칭: 층={floor_val}, 차이={best_diff:.1f}m²")

                    print(f"  🏢 [플래닛 층수] {floor_val}")
                    self._ok(json.dumps({'floor': floor_val}, ensure_ascii=False))

                except Exception as e:
                    print(f"  ⚠️ 플래닛 층수조회 실패: {e}")
                    self._ok(json.dumps({'floor': None, 'error': str(e)}, ensure_ascii=False))
                return

            elif source == 'disco':
                detail_url = payload.get('detail_url', '')
                if not detail_url:
                    self._ok(json.dumps({'floor': None, 'error': 'URL 없음'}, ensure_ascii=False))
                    return
                print(f"  🏢 [디스코 층수조회] {detail_url[:80]}")
                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,*/*',
                        'Referer': 'https://www.disco.re/',
                    }
                    req = urllib.request.Request(detail_url, headers=headers)
                    with _urlopen(req, timeout=10) as resp:
                        html = resp.read().decode('utf-8', errors='replace')
                    rows = _re.findall(r'class="trp-detail-table-row"[^>]*>(.*?)</div>\s*</div>', html, _re.DOTALL)
                    floor_val = None
                    for row in rows:
                        cells = _re.findall(r'class="trp-detail-table-cell2"[^>]*>([^<]*)', row)
                        if len(cells) >= 3:
                            cell = cells[2].strip()
                            if cell and cell != '-':
                                floor_val = cell.split()[0] if cell.split() else None
                                if floor_val:
                                    break
                    print(f"  🏢 [디스코 층수] {floor_val}")
                    self._ok(json.dumps({'floor': floor_val}, ensure_ascii=False))
                except Exception as e:
                    print(f"  ⚠️ 디스코 층수조회 실패: {e}")
                    self._ok(json.dumps({'floor': None, 'error': str(e)}, ensure_ascii=False))
                return

            else:
                self._error(400, 'source 미지원')
                return

        elif parsed.path == '/api/sbiz':
            # ★ 소상공인 상권분석 API 프록시 (CORS 우회)
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패')
                return
            api_key  = payload.get('serviceKey', '')
            lat      = payload.get('lat', '')
            lng      = payload.get('lng', '')
            radius   = payload.get('radius', '700')
            # ★ 클라이언트가 반경별로 조정한 numOfRows 사용 (기본값은 반경에 따라 자동 결정)
            radius_int = int(radius) if str(radius).isdigit() else 700
            default_rows = '100' if radius_int <= 300 else ('300' if radius_int <= 700 else '500')
            num_rows = payload.get('numOfRows', default_rows)
            if not api_key or not lat or not lng:
                self._error(400, 'serviceKey, lat, lng가 필요합니다')
                return
            print(f"\n  🏪 소상공인 상권분석 API 호출 (lat={lat}, lng={lng}, radius={radius}m)...")
            try:
                sk = api_key if '%' in api_key else urllib.parse.quote(api_key, safe='')
                import re as _re3
                CODE_DESC = {
                    '1': 'APPLICATION_ERROR', '4': 'HTTP_ERROR', '12': 'NO_OPENAPI_SERVICE_ERROR',
                    '20': 'SERVICE_ACCESS_DENIED_ERROR', '22': 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
                    '30': 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '31': 'DEADLINE_HAS_EXPIRED_ERROR',
                    '32': 'UNREGISTERED_IP_ERROR', '99': 'UNKNOWN_ERROR',
                }

                def _sbiz_parse_xml_err(text):
                    ret = _re3.search(r'<returnReasonCode>(.*?)</returnReasonCode>', text)
                    msg = _re3.search(r'<errMsg>(.*?)</errMsg>', text)
                    code_s = ret.group(1).strip() if ret else ''
                    msg_s  = msg.group(1).strip() if msg else text[:200]
                    desc   = CODE_DESC.get(code_s, '')
                    return f'code={code_s}{", "+desc if desc else ""}: {msg_s}' if code_s else msg_s

                # ★ sdsc2 먼저 시도, 실패 시 sdsc로 fallback
                endpoints = [
                    ('sdsc2', f'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius'),
                    ('sdsc',  f'https://apis.data.go.kr/B553077/api/open/sdsc/storeListInRadius'),
                ]
                raw = None
                last_err = ''
                for ep_name, ep_url in endpoints:
                    url = (f'{ep_url}?serviceKey={sk}'
                           f'&pageNo=1&numOfRows={num_rows}&radius={radius}'
                           f'&cx={lng}&cy={lat}&type=json')
                    print(f"  🌐 소상공인({ep_name}) URL: {url[:120]}")
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                        'Accept': 'application/json',
                    })
                    try:
                        with _urlopen(req, timeout=30) as resp:
                            raw = resp.read().decode('utf-8')
                        print(f"  ✅ 소상공인({ep_name}) 응답 {len(raw)}bytes")
                        break  # 성공하면 loop 종료
                    except urllib.error.HTTPError as he:
                        err_body = he.read().decode('utf-8', errors='replace')
                        last_err = f'소상공인({ep_name}) HTTP {he.code}: {_sbiz_parse_xml_err(err_body)}'
                        print(f"  ❌ {last_err}")
                        if ep_name == 'sdsc2':
                            print(f"  🔄 sdsc2 실패 → sdsc 재시도...")
                            continue
                        # sdsc도 실패
                        self._ok(json.dumps({'status': 'error', 'message': last_err, 'http_code': he.code}, ensure_ascii=False))
                        return
                    except Exception as ce:
                        last_err = f'소상공인({ep_name}) 연결 오류: {ce}'
                        print(f"  ❌ {last_err}")
                        if ep_name == 'sdsc2':
                            continue
                        self._ok(json.dumps({'status': 'error', 'message': last_err}, ensure_ascii=False))
                        return

                if raw is None:
                    self._ok(json.dumps({'status': 'error', 'message': last_err or '소상공인 API 응답 없음'}, ensure_ascii=False))
                    return

                # XML 응답 감지 (인증키 오류 등)
                if raw.strip().startswith('<'):
                    err_msg = f'API 인증 오류: {_sbiz_parse_xml_err(raw)}'
                    print(f"  ❌ 소상공인 XML 오류: {err_msg}")
                    self._ok(json.dumps({'status': 'error', 'message': err_msg}, ensure_ascii=False))
                    return

                # resultCode 체크 (JSON 공통 오류)
                try:
                    _chk = json.loads(raw)
                    _header = _chk.get('response', {}).get('header', {})
                    _rc = str(_header.get('resultCode', '00'))
                    _rm = _header.get('resultMsg', '')
                    if _rc not in ('00', '0', ''):
                        err_msg = f'API 오류 (resultCode={_rc}): {_rm}'
                        print(f"  ❌ 소상공인 resultCode={_rc}: {_rm}")
                        self._ok(json.dumps({'status': 'error', 'message': err_msg}, ensure_ascii=False))
                        return
                except Exception:
                    pass  # JSON 파싱 실패 시 raw 그대로 반환

                print(f"  ✅ 소상공인 API {len(raw)}bytes 수신 완료")
                self._ok(raw)
            except Exception as e:
                import traceback
                print(f"  ❌ 소상공인 오류: {e}\n{traceback.format_exc()}")
                self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

        elif parsed.path == '/api/sbiz/upjong':
            # ★ storeListInUpjong — 업종코드 기반 광역 수집
            # payload: {serviceKey, indsLclsCd or indsMclsCd or indsSmclsCd, pageNo, numOfRows}
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패'); return
            api_key = payload.get('serviceKey', '')
            if not api_key:
                self._error(400, 'serviceKey 필요'); return
            sk = api_key if '%' in api_key else urllib.parse.quote(api_key, safe='')
            page     = payload.get('pageNo', '1')
            num_rows = payload.get('numOfRows', '500')
            # 업종코드 파라미터 (셋 중 하나)
            lcls = payload.get('indsLclsCd', '')
            mcls = payload.get('indsMclsCd', '')
            smcls = payload.get('indsSmclsCd', '')
            code_param = ''
            if smcls:  code_param = f'&indsSmclsCd={urllib.parse.quote(smcls, safe="")}'
            elif mcls: code_param = f'&indsMclsCd={urllib.parse.quote(mcls, safe="")}'
            elif lcls: code_param = f'&indsLclsCd={urllib.parse.quote(lcls, safe="")}'
            else:
                self._error(400, 'indsLclsCd / indsMclsCd / indsSmclsCd 중 하나 필요'); return
            print(f"\n  🏷 소상공인 업종코드 수집 (code_param={code_param}, rows={num_rows})...")
            try:
                endpoints = [
                    ('sdsc2', 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInUpjong'),
                    ('sdsc',  'https://apis.data.go.kr/B553077/api/open/sdsc/storeListInUpjong'),
                ]
                raw = None; last_err = ''
                for ep_name, ep_url in endpoints:
                    url = (f'{ep_url}?serviceKey={sk}&pageNo={page}&numOfRows={num_rows}'
                           f'{code_param}&type=json')
                    print(f"  🌐 ({ep_name}) {url[:120]}")
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
                    try:
                        with _urlopen(req, timeout=30) as resp:
                            raw = resp.read().decode('utf-8')
                        print(f"  ✅ ({ep_name}) {len(raw)}bytes"); break
                    except urllib.error.HTTPError as he:
                        last_err = f'HTTP {he.code}'
                        if ep_name == 'sdsc2': continue
                        self._ok(json.dumps({'status':'error','message':last_err}, ensure_ascii=False)); return
                    except Exception as ce:
                        last_err = str(ce)
                        if ep_name == 'sdsc2': continue
                        self._ok(json.dumps({'status':'error','message':last_err}, ensure_ascii=False)); return
                if raw is None:
                    self._ok(json.dumps({'status':'error','message':last_err or '응답 없음'}, ensure_ascii=False)); return
                if raw.strip().startswith('<'):
                    self._ok(json.dumps({'status':'error','message':'API 인증 오류(XML 응답)'}, ensure_ascii=False)); return
                self._ok(raw)
            except Exception as e:
                self._ok(json.dumps({'status':'error','message':str(e)}, ensure_ascii=False))

        elif parsed.path == '/api/sbiz/upjong':
            # ★ storeListInUpjong — 업종코드 기반 광역 수집
            # payload: {serviceKey, indsLclsCd or indsMclsCd or indsSmclsCd, pageNo, numOfRows}
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except Exception:
                self._error(400, 'JSON 파싱 실패'); return
            api_key = payload.get('serviceKey', '')
            if not api_key:
                self._error(400, 'serviceKey 필요'); return
            sk = api_key if '%' in api_key else urllib.parse.quote(api_key, safe='')
            page     = payload.get('pageNo', '1')
            num_rows = payload.get('numOfRows', '500')
            # 업종코드 파라미터 (셋 중 하나)
            lcls = payload.get('indsLclsCd', '')
            mcls = payload.get('indsMclsCd', '')
            smcls = payload.get('indsSmclsCd', '')
            code_param = ''
            if smcls:  code_param = f'&indsSmclsCd={urllib.parse.quote(smcls, safe="")}'
            elif mcls: code_param = f'&indsMclsCd={urllib.parse.quote(mcls, safe="")}'
            elif lcls: code_param = f'&indsLclsCd={urllib.parse.quote(lcls, safe="")}'
            else:
                self._error(400, 'indsLclsCd / indsMclsCd / indsSmclsCd 중 하나 필요'); return
            print(f"\n  🏷 소상공인 업종코드 수집 (code_param={code_param}, rows={num_rows})...")
            try:
                endpoints = [
                    ('sdsc2', 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInUpjong'),
                    ('sdsc',  'https://apis.data.go.kr/B553077/api/open/sdsc/storeListInUpjong'),
                ]
                raw = None; last_err = ''
                for ep_name, ep_url in endpoints:
                    url = (f'{ep_url}?serviceKey={sk}&pageNo={page}&numOfRows={num_rows}'
                           f'{code_param}&type=json')
                    print(f"  🌐 ({ep_name}) {url[:120]}")
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
                    try:
                        with _urlopen(req, timeout=30) as resp:
                            raw = resp.read().decode('utf-8')
                        print(f"  ✅ ({ep_name}) {len(raw)}bytes"); break
                    except urllib.error.HTTPError as he:
                        last_err = f'HTTP {he.code}'
                        if ep_name == 'sdsc2': continue
                        self._ok(json.dumps({'status':'error','message':last_err}, ensure_ascii=False)); return
                    except Exception as ce:
                        last_err = str(ce)
                        if ep_name == 'sdsc2': continue
                        self._ok(json.dumps({'status':'error','message':last_err}, ensure_ascii=False)); return
                if raw is None:
                    self._ok(json.dumps({'status':'error','message':last_err or '응답 없음'}, ensure_ascii=False)); return
                if raw.strip().startswith('<'):
                    self._ok(json.dumps({'status':'error','message':'API 인증 오류(XML 응답)'}, ensure_ascii=False)); return
                self._ok(raw)
            except Exception as e:
                self._ok(json.dumps({'status':'error','message':str(e)}, ensure_ascii=False))


        elif parsed.path in ('/api/sbiz/stores', '/api/sbiz/age', '/api/sbiz/delivery', '/api/sbiz/sales'):
            # ★ bigdata.sbiz.or.kr 4종 통계 API
            # /api/sbiz/stores  → 업소현황  (storSttus)
            # /api/sbiz/age     → 업력현황  (stcarSttus)
            # /api/sbiz/delivery→ 배달현황  (delivery)
            # /api/sbiz/sales   → 매출추이  (slsIdex)
            # ★ certKey를 환경변수에서 읽기 (없으면 기존 기본값 fallback)
            _SBIZ_CERTKEY_DEFAULTS = {
                '/api/sbiz/stores':   '813c304e70f57196b34980f70e54a762bb67e6bdc70eee8f078233f67eb662ab',
                '/api/sbiz/age':      '935d760ae29a21c8a57cf2f22443161f8e792ba108e33ec644b65124610d2a7d',
                '/api/sbiz/delivery': 'aef1dbb354d2465c102c2841baec809e64c2966b25677601f4420094163568a7',
                '/api/sbiz/sales':    'c555e639b322c01c103fddf8d459f7fcbdb6eb79082d3bda68a42833cfe4b874',
            }
            _SBIZ_CERTKEY_ENVVARS = {
                '/api/sbiz/stores':   'SBIZ_CERTKEY_STORES',
                '/api/sbiz/age':      'SBIZ_CERTKEY_AGE',
                '/api/sbiz/delivery': 'SBIZ_CERTKEY_DELIVERY',
                '/api/sbiz/sales':    'SBIZ_CERTKEY_SALES',
            }
            SBIZ_ENDPOINTS = {
                '/api/sbiz/stores':   'storSttus',
                '/api/sbiz/age':      'stcarSttus',
                '/api/sbiz/delivery': 'delivery',
                '/api/sbiz/sales':    'slsIdex',
            }
            env_key = _SBIZ_CERTKEY_ENVVARS.get(parsed.path, '')
            certKey = os.environ.get(env_key, '') or _SBIZ_CERTKEY_DEFAULTS.get(parsed.path, '')
            endpoint = SBIZ_ENDPOINTS[parsed.path]

            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body) if length > 0 else {}
            except Exception:
                payload = {}

            # 파라미터: adongCd(행정동코드), pageIndex, pageSize, 기타
            areaCode = payload.get('adongCd', '')
            pageIndex = payload.get('pageIndex', '1')
            pageSize  = payload.get('pageSize', '10')
            # 매출추이/업력현황/배달현황은 추가 파라미터 가능
            extra_params = {k: v for k, v in payload.items()
                           if k not in ('adongCd', 'pageIndex', 'pageSize')}

            print(f"\n  📊 bigdata.sbiz.or.kr/{endpoint} 호출 (adongCd={areaCode}, page={pageIndex})...")
            try:
                base_url = f'https://bigdata.sbiz.or.kr/openapi/{endpoint}'
                params = f'certKey={certKey}&pageIndex={pageIndex}&pageSize={pageSize}'
                if areaCode:
                    params += f'&adongCd={areaCode}'
                for k, v in extra_params.items():
                    params += f'&{urllib.parse.quote(str(k))}={urllib.parse.quote(str(v))}'
                url = f'{base_url}?{params}'
                print(f"  🌐 URL: {url[:150]}")
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                    'Accept': 'application/json, application/xml, */*',
                    'Referer': 'https://bigdata.sbiz.or.kr/',
                })
                try:
                    with _urlopen(req, timeout=30) as resp:
                        raw = resp.read().decode('utf-8', errors='replace')
                    print(f"  ✅ bigdata.sbiz.or.kr/{endpoint} 응답 {len(raw)}bytes")
                except urllib.error.HTTPError as he:
                    err_body = he.read().decode('utf-8', errors='replace')
                    print(f"  ❌ HTTP {he.code}: {err_body[:200]}")
                    self._ok(json.dumps({'status': 'error', 'message': f'HTTP {he.code}: {err_body[:300]}'}, ensure_ascii=False))
                    return

                # JSON/XML 공통 처리
                if raw.strip().startswith('<'):
                    # XML 응답 (오류이거나 XML 포맷)
                    import xml.etree.ElementTree as _ET2
                    import re as _re2
                    try:
                        # BOM 및 XML 선언 제거 (파이썬 문자열은 이미 utf-8 디코딩됨)
                        clean_raw = raw.strip().lstrip('\ufeff')
                        clean_raw = _re2.sub(r'<\?xml[^?]*\?>', '', clean_raw, count=1).strip()
                        root2 = _ET2.fromstring(clean_raw)
                        # 인증 오류 응답 먼저 확인
                        auth_msg = root2.findtext('.//returnAuthMsg') or root2.findtext('.//errMsg') or ''
                        reason   = root2.findtext('.//returnReasonCode') or root2.findtext('.//returnCode') or ''
                        if auth_msg or reason:
                            msg = auth_msg or f'API 오류 코드: {reason}'
                            print(f'  ❌ bigdata.sbiz 인증 오류: {msg}')
                            self._ok(json.dumps({'status':'error','message':msg}, ensure_ascii=False))
                            return
                        items2 = []
                        for el in root2.findall('.//item'):
                            d = {}
                            for ch in el:
                                d[ch.tag] = (ch.text or '').strip()
                            items2.append(d)
                        total = root2.findtext('.//totalCount') or root2.findtext('.//total') or str(len(items2))
                        self._ok(json.dumps({'status':'success','endpoint':endpoint,'totalCount':total,'data':items2}, ensure_ascii=False))
                    except Exception as xe:
                        safe_preview = raw[:300].encode('utf-8', errors='replace').decode('utf-8', errors='replace')
                        print(f'  ❌ XML 파싱 실패: {xe} | 응답: {safe_preview}')
                        self._ok(json.dumps({'status':'error','message':'bigdata.sbiz 응답 파싱 실패 — certKey가 유효한지 확인해주세요.','detail':str(xe)}, ensure_ascii=False))
                    return

                # JSON 응답
                try:
                    jdata = json.loads(raw)
                    # 응답 구조 정규화
                    if isinstance(jdata, dict):
                        # 다양한 래퍼 구조 처리
                        data_list = (jdata.get('data') or jdata.get('items') or
                                     jdata.get('result') or jdata.get('list') or [])
                        total = jdata.get('totalCount') or jdata.get('total') or len(data_list)
                        self._ok(json.dumps({'status':'success','endpoint':endpoint,'totalCount':total,'data':data_list,'raw':jdata}, ensure_ascii=False))
                    elif isinstance(jdata, list):
                        self._ok(json.dumps({'status':'success','endpoint':endpoint,'totalCount':len(jdata),'data':jdata}, ensure_ascii=False))
                    else:
                        self._ok(raw)
                except Exception as je:
                    print(f"  ⚠️ JSON 파싱 실패: {je}")
                    self._ok(json.dumps({'status':'error','message':f'파싱 실패: {je}','raw':raw[:500]}, ensure_ascii=False))
            except Exception as e:
                import traceback
                print(f"  ❌ bigdata.sbiz/{endpoint} 오류: {e}\n{traceback.format_exc()}")
                self._ok(json.dumps({'status':'error','message':str(e)}, ensure_ascii=False))

        elif parsed.path == '/api/onbid':
            # 온비드 공공데이터 API 프록시
            # ★ v13: 올바른 URL/서비스명/파라미터로 전면 수정
            # 문서: openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc/getUnifyUsageCltr
            # serviceKey: Decoding 키 사용, 응답포맷: XML
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                service_key = body.get('serviceKey', '')
                ctgr_id     = body.get('ctgrId', '03')   # 03:부동산, 01:동산, 02:기타, 04:국유재산
                num_of_rows = body.get('numOfRows', '10')
                page_no     = body.get('pageNo', '1')
                region      = body.get('region', '')     # 예: 경기

                params = {
                    'serviceKey':  service_key,
                    'pageNo':      page_no,
                    'numOfRows':   num_of_rows,
                    'DPSL_MTD_CD': '0001',
                }
                if region:
                    params['ADDR_NM'] = region

                api_url = 'http://openapi.onbid.co.kr/newopenapi/services/ThingInfoInquireSvc/getUnifyUsageCltr?' + urllib.parse.urlencode(params)
                print(f'  🛡️ 온비드 API 호출: {api_url[:150]}')
                req = urllib.request.Request(api_url, headers={'User-Agent': 'curl/8.4.0'})

                with _urlopen(req, timeout=15) as r:
                    raw = r.read().decode('utf-8')
                    print(f'  📥 응답 길이={len(raw)}, 앞부분: {raw[:200]}')

                # XML 파싱
                import xml.etree.ElementTree as ET
                root = ET.fromstring(raw)

                # 에러 코드 확인
                result_code = root.findtext('.//resultCode') or root.findtext('.//errCode') or '00'
                result_msg  = root.findtext('.//resultMsg') or root.findtext('.//errMsg') or ''
                if result_code not in ('00', '0000', ''):
                    print(f'  ❌ API 오류: [{result_code}] {result_msg}')
                    self._ok(json.dumps({'status': 'error', 'message': f'API 오류: [{result_code}] {result_msg}'}, ensure_ascii=False))
                    return

                # items 파싱 → dict 리스트로 변환
                items_raw = []
                for item in root.findall('.//item'):
                    d = {child.tag: child.text for child in item}
                    items_raw.append(d)

                print(f'  ✅ 온비드 {len(items_raw)}건 수집')
                self._ok(json.dumps({'status': 'ok', 'data': items_raw}, ensure_ascii=False))

            except Exception as e:
                import traceback
                print(f'  ❌ /api/onbid 오류: {e}\n{traceback.format_exc()}')
                self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

        elif parsed.path == '/fetch':
            # URL → HTML 가져오기 (옥션원 공유링크 등 CORS 우회용)
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                target_url = body.get('url', '').strip()
                extra_cookie = body.get('cookie', '').strip()  # ★ v14: 로그인 쿠키 수신
                # BOM 및 latin-1 범위 밖 문자 제거 (복사할 때 딸려오는 유니코드 문자 방지)
                extra_cookie = extra_cookie.encode('ascii', errors='ignore').decode('ascii')
                # %3D, %7E 등 URL 인코딩된 쿠키 값을 실제 문자로 디코딩 (브라우저 복사 시 인코딩된 채로 옴)
                import urllib.parse as _uparse
                extra_cookie = _uparse.unquote(extra_cookie)

                if not target_url:
                    self._ok(json.dumps({'status': 'error', 'message': 'url 파라미터 없음'}, ensure_ascii=False))
                else:
                    # ★ v14: 쿠키가 있으면 ca_view_sns.php → ca_view.php 자동 전환
                    # ca_view_sns.php : 로그인 무관, 기본정보만 제공 (공유전용)
                    # ca_view.php     : 로그인 쿠키 필요, 말소기준권리/임차인현황 포함
                    if extra_cookie and 'ca_view_sns.php' in target_url:
                        pid_m = re.search(r'product_id=(\d+)', target_url)
                        if pid_m:
                            pid = pid_m.group(1)
                            target_url = f'https://auction1.co.kr/auction/ca_view.php?product_id={pid}'
                            print(f'  🔀 공유URL → 로그인URL 자동 전환: product_id={pid}')

                    # ★ v14: 쿠키 유무에 따라 User-Agent 분기
                    # ca_view.php 는 데스크탑 UA 로 요청해야 전체 HTML 반환
                    if extra_cookie:
                        ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                    else:
                        ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

                    headers = {
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                        # ★ v17: Accept-Encoding 제거 → urllib이 gzip 자동 해제 못 하는 버그 방지
                        # (gzip 헤더 보내면 서버가 gzip 응답 주는데 urllib은 자동 해제 안 함 → 빈/깨진 HTML)
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Referer': 'https://auction1.co.kr/',
                        'Cache-Control': 'max-age=0',
                    }
                    if extra_cookie:
                        headers['Cookie'] = extra_cookie
                        print(f'  🍪 쿠키 적용: {extra_cookie[:60]}...')

                    req = urllib.request.Request(target_url, headers=headers)
                    with _urlopen(req, timeout=15) as r:
                        raw_bytes = r.read()
                        ce = r.headers.get('Content-Encoding', '')
                        # ★ v17: gzip/deflate 응답 자동 해제 (Accept-Encoding 없이도 서버가 보낼 수 있음)
                        import gzip as _gzip, zlib as _zlib
                        if 'gzip' in ce:
                            try: raw_bytes = _gzip.decompress(raw_bytes)
                            except Exception: pass
                        elif 'deflate' in ce:
                            try: raw_bytes = _zlib.decompress(raw_bytes)
                            except Exception:
                                try: raw_bytes = _zlib.decompress(raw_bytes, -_zlib.MAX_WBITS)
                                except Exception: pass
                        # 1. Content-Type 헤더에서 charset 감지
                        ct = r.headers.get('Content-Type', '')
                        charset = None
                        if 'charset=' in ct.lower():
                            charset = ct.lower().split('charset=')[-1].strip().split(';')[0].strip()
                        # 2. 헤더에 없으면 HTML meta 태그에서 감지
                        if not charset:
                            meta_sniff = raw_bytes[:2000].decode('ascii', errors='ignore')
                            m = re.search(r'charset=["\'\']?([a-zA-Z0-9\-]+)', meta_sniff, re.IGNORECASE)
                            if m:
                                charset = m.group(1).strip()
                        # 3. 감지된 인코딩으로 디코딩 (기본 utf-8)
                        if not charset:
                            charset = 'utf-8'
                        try:
                            html = raw_bytes.decode(charset, errors='replace')
                        except LookupError:
                            html = raw_bytes.decode('utf-8', errors='replace')
                    self._ok(json.dumps({'status': 'ok', 'html': html, 'charset': charset}, ensure_ascii=False))
            except Exception as e:
                import traceback
                print(f'  ❌ /fetch 오류: {e}\n{traceback.format_exc()}')
                self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

        else:
            self._error(404, f'알 수 없는 경로: {parsed.path}')

    def _collect_naver_map(self, kakao_rest_key='',
                           lat='', lng='', nelat='', swlat='', nelng='', swlng='',
                           rlet_tp='SG:SMS:APTHGJ', trade_tp='A1:B1:B2',
                           kakao_level=4, skip_detail=False, token='', cookie='', radius_m=None, max_n=100):
        """
        fin.land 지도 클러스터 API 기반 지도 바운딩박스 수집.
        1차: articleClusters로 클러스터/총개수 확보
        2차: clusteredArticles로 각 클러스터를 실제 매물 목록으로 확장
        실패 시 m.land clusterList를 마지막 fallback으로 사용
        """
        FIN_CLUSTER_URL = 'https://fin.land.naver.com/front-api/v1/article/map/articleClusters'
        FIN_CLUSTERED_URL = 'https://fin.land.naver.com/front-api/v1/article/clusteredArticles'
        LEGACY_BASE = 'https://m.land.naver.com'

        try:
            max_n = max(1, min(int(max_n or 100), 2000))
        except Exception:
            max_n = 100
        try:
            radius_m = float(radius_m) if radius_m not in (None, '', 0, '0') else None
        except Exception:
            radius_m = None

        resolved_auth = (token or NAVER_HEADERS.get('authorization') or '').strip()
        resolved_cookie = (cookie or NAVER_HEADERS.get('Cookie') or '').strip()
        if resolved_auth:
            NAVER_HEADERS['authorization'] = resolved_auth
        if resolved_cookie:
            NAVER_HEADERS['Cookie'] = resolved_cookie

        # 카카오 레벨 → 네이버 z 레벨 변환 (높을수록 확대)
        # 카카오: 1=가장 확대, 14=가장 축소 / 네이버: 높을수록 확대
        kakao_to_naver_z = {1: 20, 2: 19, 3: 18, 4: 17, 5: 16, 6: 15, 7: 14, 8: 13}
        naver_z = kakao_to_naver_z.get(int(kakao_level), 16)
        precision = max(13, min(20, naver_z))

        def distance_meters(lat1, lng1, lat2, lng2):
            lat1_r = math.radians(lat1)
            lat2_r = math.radians(lat2)
            dlat = math.radians(lat2 - lat1)
            dlng = math.radians(lng2 - lng1)
            a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
            return 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        def clean(v):
            if v is None or v == '' or v == '0':
                return None
            try:
                n = float(str(v).replace(',', '').replace('만', '').strip())
                return n if n != 0 else None
            except Exception:
                return None

        def parse_naver_price_man(raw_value):
            txt = str(raw_value or '').strip().replace(' ', '').replace(',', '')
            if not txt or txt in ('-', '0'):
                return None
            try:
                if '억' in txt:
                    left, right = txt.split('억', 1)
                    total = float(left or 0) * 10000
                    right = right.replace('만', '').strip()
                    if right:
                        total += float(right)
                    return int(round(total)) if total else None
                txt = txt.replace('만', '')
                return int(round(float(txt))) if float(txt) else None
            except Exception:
                return None

        def split_floor_info(raw_value):
            if raw_value is None or raw_value == '':
                return None, None
            text = str(raw_value).strip()
            if not text:
                return None, None
            if '/' not in text:
                try:
                    return int(text), None
                except Exception:
                    return text, None
            left, right = text.split('/', 1)
            left = left.strip()
            right = right.strip()
            try:
                left = int(left)
            except Exception:
                pass
            try:
                right = int(right)
            except Exception:
                pass
            return left or None, right or None

        def join_fin_address(addr):
            if not isinstance(addr, dict):
                return ''
            parts = []
            for key in ('city', 'division', 'sector', 'section', 'village', 'detailAddress'):
                val = str(addr.get(key) or '').strip()
                if val and val not in parts:
                    parts.append(val)
            return ' '.join(parts).strip()

        def post_json(url, payload, headers, retries=3, wait_base=1.2):
            data_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            last_err = None
            for attempt in range(retries):
                try:
                    req = urllib.request.Request(url, data=data_bytes, headers=headers, method='POST')
                    with _urlopen(req, timeout=18) as resp:
                        raw_bytes = resp.read()
                        content_type = resp.headers.get('Content-Type', '')
                    raw_text = raw_bytes.decode('utf-8', errors='replace').lstrip('\ufeff').strip()
                    if not raw_text:
                        return None
                    if content_type and 'json' not in content_type.lower() and raw_text[:1] not in '{[' and raw_text != 'null':
                        preview = raw_text[:160].replace('\n', ' ')
                        raise ValueError(f'JSON이 아닌 응답 반환 ({content_type}): {preview}')
                    return json.loads(raw_text)
                except urllib.error.HTTPError as he:
                    last_err = he
                    if he.code == 429 and attempt < retries - 1:
                        wait_s = wait_base * (attempt + 1)
                        print(f"  ⏸  네이버 front-api 429 — {wait_s:.1f}s 대기 후 재시도 ({attempt+1}/{retries})")
                        time.sleep(wait_s)
                        continue
                    raise
            if last_err:
                raise last_err
            return None

        def build_fin_seed(info, cluster_coords=None):
            if not isinstance(info, dict):
                return None
            article_no = str(info.get('articleNumber') or info.get('articleNo') or info.get('atclNo') or '').strip()
            if not article_no:
                return None
            trade_tp_code = str(info.get('tradeType') or info.get('tradTpCd') or '').strip()
            trade_name = info.get('tradeTypeName') or info.get('tradTpNm') or {'A1': '매매', 'B1': '전세', 'B2': '월세'}.get(trade_tp_code, trade_tp_code)
            price_info = info.get('priceInfo') or {}
            space_info = info.get('spaceInfo') or info.get('spaceInfoDto') or {}
            article_detail = info.get('articleDetail') or {}
            address = info.get('address') or {}
            coords = address.get('coordinates') or cluster_coords or {}
            lat_v = coords.get('yCoordinate') or coords.get('lat') or coords.get('latitude')
            lng_v = coords.get('xCoordinate') or coords.get('lng') or coords.get('longitude')
            floor_info = article_detail.get('floorInfo') or ''

            if trade_tp_code == 'A1':
                prc = _naver_money_to_man(price_info.get('dealPrice'))
            else:
                prc = _naver_money_to_man(price_info.get('warrantyPrice') or price_info.get('warrantPrice'))

            seed = {
                'atclNo': article_no,
                'articleNo': article_no,
                'atclNm': info.get('articleName') or info.get('atclNm') or info.get('realEstateTypeName') or '',
                'rletTpNm': info.get('realEstateType') or info.get('buildingType') or '',
                'tradTpCd': trade_tp_code,
                'tradTpNm': trade_name,
                'prc': prc,
                'rentPrc': _naver_money_to_man(price_info.get('rentPrice')),
                'spc1': clean(space_info.get('supplySpace')),
                'spc2': clean(space_info.get('exclusiveSpace')),
                'flrInfo': floor_info,
                'direction': _naver_direction_to_korean(article_detail.get('direction') or '') or '',
                'exposureAddress': join_fin_address(address),
                'lat': lat_v,
                'lng': lng_v,
            }
            return seed if article_in_bounds(seed) else None

        FIN_HEADERS = _build_naver_headers(FIN_CLUSTER_URL, resolved_auth, resolved_cookie)
        FIN_HEADERS['Content-Type'] = 'application/json'
        MOBILE_HEADERS = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'ko-KR,ko;q=0.9',
            'Referer': 'https://m.land.naver.com/',
            'Origin': 'https://m.land.naver.com',
        }
        if resolved_cookie:
            MOBILE_HEADERS['Cookie'] = resolved_cookie

        def fetch_mobile_json(url):
            req = urllib.request.Request(url, headers=MOBILE_HEADERS)
            with _urlopen(req, timeout=15) as resp:
                raw_bytes = resp.read()
                content_encoding = resp.headers.get('Content-Encoding', '')
                content_type = resp.headers.get('Content-Type', '')
                if content_encoding == 'gzip' or raw_bytes[:2] == b'\x1f\x8b':
                    import gzip
                    raw_bytes = gzip.decompress(raw_bytes)
                raw_text = raw_bytes.decode('utf-8', errors='replace').lstrip('\ufeff')
            return raw_text, content_type

        def article_in_bounds(art):
            try:
                art_lat = float(art.get('lat') or art.get('latitude'))
                art_lng = float(art.get('lng') or art.get('lon') or art.get('longitude'))
            except Exception:
                return False
            if radius_m is not None:
                dist_m = distance_meters(_lat, _lng, art_lat, art_lng)
                if dist_m > radius_m + 1:
                    return False
                art['_distance_m'] = round(dist_m, 1)
                return True
            return (_swlat <= art_lat <= _nelat) and (_swlng <= art_lng <= _nelng)

        def build_result_item_from_seed(art):
            no = str(art.get('atclNo') or art.get('articleNo') or '').strip()
            if not no:
                return None
            trade_tp_code = art.get('tradTpCd', '')
            trade_name = art.get('tradTpNm') or {'A1': '매매', 'B1': '전세', 'B2': '월세'}.get(trade_tp_code, trade_tp_code)
            item_type = '매매용' if trade_tp_code == 'A1' else '임대용'
            floor_now, floor_total = split_floor_info(art.get('flrInfo'))
            return {
                '매물번호': no,
                '매물명': art.get('atclNm', '') or art.get('rletTpNm', ''),
                '매물유형': item_type,
                '거래유형': trade_name,
                '매매가': art.get('prc') if trade_tp_code == 'A1' else None,
                '기보증금_만원': art.get('prc') if trade_tp_code in ('B1', 'B2') else None,
                '월세_만원': art.get('rentPrc') if trade_tp_code == 'B2' else None,
                '권리금_만원': None,
                '관리비_만원': None,
                '관리비포함': None,
                '계약면적_m2': art.get('spc1') or None,
                '전용면적_m2': art.get('spc2') or None,
                '해당층': floor_now,
                '총층': floor_total,
                '방향': _naver_direction_to_korean(art.get('direction') or ''),
                '주차': None,
                '소재지': art.get('exposureAddress', ''),
                'lat': art.get('lat', ''),
                'lng': art.get('lng', ''),
                '거리_m': art.get('_distance_m') or None,
                '상세URL': _naver_article_page_url(no),
                '출처': '네이버부동산',
            }

        def collect_articles_from_clusterlist():
            cluster_items = []
            local_seen = set()

            def request_cluster_list(cortar_no):
                params = urllib.parse.urlencode({
                    'view': 'atcl',
                    'rletTpCd': rlet_tp,
                    'tradTpCd': trade_tp,
                    'z': str(naver_z),
                    'lat': _lat,
                    'lon': _lng,
                    'btm': _swlat,
                    'lft': _swlng,
                    'top': _nelat,
                    'rgt': _nelng,
                    'cortarNo': cortar_no or '',
                })
                url = f'{LEGACY_BASE}/cluster/clusterList?{params}'
                print(f"  🌐 네이버 clusterList 호출: {url[:140]}")
                txt, ctype = fetch_mobile_json(url)
                print(f"  🔍 clusterList Content-Type: {ctype}, len={len(txt)}")
                return json.loads(txt.strip()) if txt.strip() else None

            seed_raw = request_cluster_list('')
            if not isinstance(seed_raw, dict):
                return []
            cortar_no = (((seed_raw.get('cortar') or {}).get('detail') or {}).get('cortarNo') or '').strip()
            cluster_raw = request_cluster_list(cortar_no) if cortar_no else seed_raw
            if not isinstance(cluster_raw, dict):
                return []

            article_nodes = ((cluster_raw.get('data') or {}).get('ARTICLE') or [])
            if not isinstance(article_nodes, list):
                return []

            for node in article_nodes:
                if not isinstance(node, dict):
                    continue
                aid = str(node.get('itemId') or '').strip()
                if not aid or aid in local_seen:
                    continue
                seed = {
                    'atclNo': aid,
                    'articleNo': aid,
                    'atclNm': node.get('rletNm') or '',
                    'rletTpNm': node.get('rletNm') or '',
                    'tradTpCd': node.get('tradTpCd') or '',
                    'tradTpNm': node.get('tradNm') or '',
                    'lat': node.get('lat'),
                    'lng': node.get('lon'),
                }
                if seed['tradTpCd'] == 'A1':
                    seed['prc'] = node.get('prc') or parse_naver_price_man(node.get('priceTtl'))
                elif seed['tradTpCd'] == 'B1':
                    seed['prc'] = node.get('prc') or parse_naver_price_man(node.get('priceTtl'))
                elif seed['tradTpCd'] == 'B2':
                    dep_txt, _, rent_txt = str(node.get('priceTtl') or '').partition('/')
                    seed['prc'] = node.get('prc') or parse_naver_price_man(dep_txt)
                    seed['rentPrc'] = node.get('rentPrc') or parse_naver_price_man(rent_txt)
                else:
                    seed['prc'] = node.get('prc') or parse_naver_price_man(node.get('priceTtl'))

                if not article_in_bounds(seed):
                    continue

                local_seen.add(aid)
                cluster_items.append(seed)
                if len(cluster_items) >= max_n:
                    break

            print(f"  📍 clusterList fallback 매물 {len(cluster_items)}개 확보")
            return cluster_items

        def collect_articles_from_fin():
            rlet_codes = [code.strip() for code in str(rlet_tp or '').split(':') if code.strip()]
            trade_codes = [code.strip() for code in str(trade_tp or '').split(':') if code.strip()]
            if not trade_codes:
                trade_codes = ['A1', 'B1', 'B2']

            # fin.land는 상업용 목록을 현재 D02 버킷으로 내려준다.
            fin_real_estate_types = []
            if any(code in ('SG', 'SMS', 'APTHGJ') for code in rlet_codes):
                fin_real_estate_types.append('D02')
            if not fin_real_estate_types:
                fin_real_estate_types.append('D02')

            filter_payload = {
                'tradeTypes': trade_codes,
                'realEstateTypes': fin_real_estate_types,
                'roomCount': [],
                'bathRoomCount': [],
                'optionTypes': [],
                'oneRoomShapeTypes': [],
                'moveInTypes': [],
                'filtersExclusiveSpace': False,
                'floorTypes': [],
                'directionTypes': [],
                'hasArticlePhoto': False,
                'isAuthorizedByOwner': False,
                'parkingTypes': [],
                'entranceTypes': [],
                'hasArticle': False,
            }
            cluster_payload = {
                'filter': filter_payload,
                'boundingBox': {
                    'left': _swlng,
                    'right': _nelng,
                    'top': _nelat,
                    'bottom': _swlat,
                },
                'precision': precision,
                'userChannelType': 'PC',
            }
            print(f"  🌐 네이버 fin cluster 호출: precision={precision}, trade={trade_codes}, types={fin_real_estate_types}")
            cluster_raw = post_json(FIN_CLUSTER_URL, cluster_payload, FIN_HEADERS, retries=3, wait_base=1.5)
            if not isinstance(cluster_raw, dict):
                raise ValueError(f'fin cluster 응답 형식 오류: {type(cluster_raw).__name__}')
            if cluster_raw.get('isSuccess') is False:
                raise ValueError(cluster_raw.get('message') or cluster_raw.get('detailCode') or 'fin cluster 실패')

            result = cluster_raw.get('result') or {}
            clusters = result.get('clusters') or []
            total_count = int(result.get('totalCount') or 0)
            if not isinstance(clusters, list):
                clusters = []

            article_list = []
            seen_ids = set()

            cluster_states = []
            cluster_count_for_fetch = max(1, len([c for c in clusters if isinstance(c, dict)]))
            cluster_page_size = max(4, min(12, int(math.ceil(max_n / cluster_count_for_fetch))))

            def fetch_cluster_page(state):
                cluster_id = state.get('clusterId') or ''
                if not cluster_id or not state.get('hasNext', True):
                    return 0
                page_payload = {
                    'clusterId': cluster_id,
                    'filter': filter_payload,
                    'articlePagingRequest': {
                        'size': min(30, cluster_page_size),
                        'userChannelType': 'PC',
                        'articleSortType': 'RANKING_DESC',
                        'lastInfo': state.get('lastInfo') or [],
                    }
                }
                page_raw = post_json(FIN_CLUSTERED_URL, page_payload, FIN_HEADERS, retries=3, wait_base=1.2)
                if not isinstance(page_raw, dict):
                    state['hasNext'] = False
                    return 0
                if page_raw.get('isSuccess') is False:
                    raise ValueError(page_raw.get('message') or page_raw.get('detailCode') or 'clusteredArticles 실패')

                page_result = page_raw.get('result') or {}
                page_rows = page_result.get('list') or []
                if not isinstance(page_rows, list):
                    page_rows = []

                new_count = 0
                for row in page_rows:
                    info = (row or {}).get('representativeArticleInfo') if isinstance(row, dict) else None
                    if not info and isinstance(row, dict):
                        info = row
                    seed = build_fin_seed(info, state.get('coordinates') or {})
                    aid = str(seed.get('atclNo') or '') if seed else ''
                    if seed and aid and aid not in seen_ids:
                        seen_ids.add(aid)
                        state['buffer'].append(seed)
                        new_count += 1

                state['hasNext'] = bool(page_result.get('hasNextPage'))
                state['lastInfo'] = page_result.get('lastInfo') or []
                if not state['hasNext'] or not state['lastInfo']:
                    state['hasNext'] = False
                print(f"  📋 cluster {cluster_id}: 버퍼 {new_count}개 추가 (buffer={len(state['buffer'])}, hasNext={state['hasNext']})")
                return new_count

            for cluster in clusters:
                if not isinstance(cluster, dict):
                    continue
                cluster_id = str(cluster.get('clusterId') or '').strip()
                cluster_coords = cluster.get('coordinates') or {}
                cluster_state = {
                    'clusterId': cluster_id,
                    'coordinates': cluster_coords,
                    'buffer': [],
                    'lastInfo': [],
                    'hasNext': False,
                }

                inline_article = cluster.get('article')
                if isinstance(inline_article, dict):
                    seed = build_fin_seed(inline_article, cluster_coords)
                    aid = str(seed.get('atclNo') or '') if seed else ''
                    if seed and aid and aid not in seen_ids:
                        seen_ids.add(aid)
                        cluster_state['buffer'].append(seed)

                if cluster_id:
                    cluster_state['hasNext'] = int(cluster.get('articleCount') or 0) > len(cluster_state['buffer'])
                    if cluster_state['hasNext']:
                        fetch_cluster_page(cluster_state)
                        time.sleep(0.06)

                if cluster_state['buffer'] or cluster_state['hasNext']:
                    cluster_states.append(cluster_state)

            while len(article_list) < max_n and cluster_states:
                added_this_round = 0

                for state in cluster_states:
                    if len(article_list) >= max_n:
                        break
                    if state['buffer']:
                        article_list.append(state['buffer'].pop(0))
                        added_this_round += 1

                if len(article_list) >= max_n:
                    break

                refill_happened = 0
                for state in cluster_states:
                    if len(article_list) >= max_n:
                        break
                    if not state['buffer'] and state.get('hasNext'):
                        refill_happened += fetch_cluster_page(state)
                        time.sleep(0.06)

                cluster_states = [state for state in cluster_states if state['buffer'] or state.get('hasNext')]
                if added_this_round == 0 and refill_happened == 0:
                    break
                if added_this_round > 0:
                    print(f"  📋 균등수집 라운드: {added_this_round}개 추가 (누적 {len(article_list)}개)")

            return article_list, total_count

        try:
            # 바운딩박스 기본값 (입력 없으면 중심 ±0.01도)
            _lat  = float(lat)
            _lng  = float(lng)
            _nelat = float(nelat) if nelat else _lat + 0.01
            _swlat = float(swlat) if swlat else _lat - 0.01
            _nelng = float(nelng) if nelng else _lng + 0.01
            _swlng = float(swlng) if swlng else _lng - 0.01

            article_list = []
            total_hint = None
            fin_error = None

            try:
                article_list, total_hint = collect_articles_from_fin()
                print(f"  📋 fin.land에서 {len(article_list)}개 매물 확보 (totalCount={total_hint})")
            except Exception as fin_err:
                fin_error = fin_err
                print(f"  ⚠️ fin.land 수집 실패 → m.land fallback 시도: {fin_err}")
                article_list = []

            if not article_list:
                article_list = collect_articles_from_clusterlist()
                if article_list:
                    total_hint = total_hint or len(article_list)

            if radius_m is not None:
                article_list.sort(key=lambda art: float(art.get('_distance_m', 10**9)))
            radius_total = len(article_list)
            if len(article_list) > max_n:
                article_list = article_list[:max_n]

            print(f"  📋 {len(article_list)}개 매물 발견")

            if not article_list:
                if total_hint:
                    msg = f'클러스터 총 {total_hint}건은 확인됐지만 실제 매물 상세 목록을 풀지 못했습니다. 최신 쿠키로 다시 시도해 주세요.'
                elif fin_error:
                    msg = f'네이버 지도 수집 실패: {fin_error}'
                else:
                    msg = '해당 지역에서 수집 가능한 매물을 찾지 못했습니다.'
                self._ok(json.dumps({'status': 'warn', 'message': msg, 'data': []}, ensure_ascii=False))
                return

            result_items = []
            skipped_residential = 0

            for i, art in enumerate(article_list):
                if not isinstance(art, dict):
                    continue
                no = str(art.get('atclNo') or art.get('articleNo') or '')
                if not no:
                    continue

                if skip_detail:
                    item = build_result_item_from_seed(art)
                    if item:
                        result_items.append(item)
                    continue

                delay = 3.5 + random.uniform(0, 2.5)
                print(f"  ⏳ {i+1}/{len(article_list)} 상세 수집 중 (대기 {delay:.1f}s)...")
                time.sleep(delay)

                try:
                    detail = self._fetch_json(
                        _naver_detail_api_url(no),
                        headers=_build_naver_headers(_naver_detail_api_url(no), resolved_auth, resolved_cookie)
                    )
                    detail_item = _build_naver_item_from_detail(detail, no)
                    if not detail_item.get('소재지'):
                        detail_item['소재지'] = art.get('exposureAddress', '')
                    if not detail_item.get('lat'):
                        detail_item['lat'] = art.get('lat', '')
                    if not detail_item.get('lng'):
                        detail_item['lng'] = art.get('lng', '')
                    detail_item['거리_m'] = art.get('_distance_m') or None
                    result_items.append(detail_item)
                except Exception as e2:
                    print(f"  ⚠️  매물 {no} 상세 실패, 목록 데이터 사용: {e2}")
                    fallback_item = build_result_item_from_seed(art)
                    if fallback_item:
                        result_items.append(fallback_item)

            # 역지오코딩
            if kakao_rest_key:
                print(f"  📍 주소 변환 중 (카카오 REST API)...")
                converted = 0
                for item in result_items:
                    lat_v = item.get('lat')
                    lng_v = item.get('lng')
                    if not lat_v or not lng_v:
                        continue
                    try:
                        geo_url = f'https://dapi.kakao.com/v2/local/geo/coord2address.json?x={lng_v}&y={lat_v}'
                        geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                        with _urlopen(geo_req, timeout=5) as r:
                            geo_data = json.loads(r.read())
                        docs = geo_data.get('documents', []) if isinstance(geo_data, dict) else []
                        if docs:
                            road = (docs[0].get('road_address') or {})
                            jibun = (docs[0].get('address') or {})
                            road_addr = (road.get('address_name') or '').strip()
                            jibun_addr = (jibun.get('address_name') or '').strip()
                            addr = road_addr or jibun_addr
                            if road_addr:
                                item['도로명주소'] = road_addr
                            if jibun_addr:
                                item['지번주소'] = jibun_addr
                            if addr:
                                item['소재지'] = addr
                                converted += 1
                        time.sleep(0.05)
                    except:
                        pass
                print(f"  ✅ 주소 변환 완료: {converted}건")

            if skipped_residential > 0:
                print(f"  🏠 주거용 {skipped_residential}건 제외 (아파트/연립/다가구 등)")
            msg_parts = []
            if radius_m is not None:
                msg_parts.append(f'반경 {int(radius_m)}m 내 {radius_total}건')
                msg_parts.append(f'최대 {max_n}건 적용')
            if total_hint and total_hint > len(result_items):
                msg_parts.append(f'클러스터 총 {total_hint}건')
            if skipped_residential > 0:
                msg_parts.append(f'주거용 {skipped_residential}건 제외')
            msg = f'{len(result_items)}개 수집 완료'
            if msg_parts:
                msg += ' (' + ', '.join(msg_parts) + ')'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except urllib.error.HTTPError as e:
            msg = f'HTTP {e.code} 오류 — 네이버 접근 제한일 수 있습니다'
            print(f"  ❌ {msg}")
            self._ok(json.dumps({'status': 'error', 'message': msg, 'data': []}, ensure_ascii=False))
        except Exception as e:
            import traceback
            print(f"  ❌ 네이버 지도수집 실패: {e}\n{traceback.format_exc()}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))

    def _collect_naver(self, url, token=None, cookie=None, kakao_rest_key=None):
        # HTML에서 받은 토큰/쿠키로 헤더 동적 업데이트
        resolved_token = (token or NAVER_HEADERS.get('authorization') or '').strip()
        resolved_cookie = (cookie or NAVER_HEADERS.get('Cookie') or '').strip()
        if resolved_token:
            NAVER_HEADERS['authorization'] = resolved_token
        if resolved_cookie:
            NAVER_HEADERS['Cookie'] = resolved_cookie
        try:
            article_no = _extract_naver_article_no(url)
            is_list_api = ('/api/' in str(url or '')) and ('articleList' in str(url or '') or '/api/articles/complex/' in str(url or ''))

            if article_no and not is_list_api:
                print(f"  🔎 네이버 단건 매물 직접 수집: articleNo={article_no}")
                raw = self._fetch_json(
                    _naver_detail_api_url(article_no),
                    headers=_build_naver_headers(_naver_detail_api_url(article_no), resolved_token, resolved_cookie)
                )
                item = _build_naver_item_from_detail(raw, article_no)
                msg = '1개 수집 완료'
                print(f"  ✅ {msg}")
                self._ok(json.dumps({'status': 'success', 'message': msg, 'data': [item]}, ensure_ascii=False))
                return

            if 'fin.land.naver.com' in str(url or '') and not is_list_api and not article_no:
                self._ok(json.dumps({
                    'status': 'warn',
                    'message': '일반 fin.land 페이지 URL만으로는 목록 수집이 어렵습니다. 매물 상세 URL(articleNo 포함) 또는 F12 네트워크의 목록 API URL을 넣어주세요.',
                    'data': []
                }, ensure_ascii=False))
                return

            list_data = self._fetch_json(url, headers=_build_naver_headers(url, resolved_token, resolved_cookie))
            if not isinstance(list_data, dict):
                print(f"  ⚠️ 네이버 목록 응답 이상: {type(list_data).__name__}")
                self._ok(json.dumps({'status': 'warn', 'message': '네이버 매물 목록 응답이 비어있거나 형식이 잘못되었습니다', 'data': []}, ensure_ascii=False))
                return
            article_list = list_data.get('articleList', []) or []

            if not article_list:
                self._ok(json.dumps({'status': 'warn', 'message': '매물 없음 또는 토큰 만료', 'data': []}, ensure_ascii=False))
                return

            print(f"  📋 매물 {len(article_list)}개 발견, 상세 수집 시작...")
            result_items = []

            for i, art in enumerate(article_list):
                no = art.get('articleNo') or art.get('atclNo')
                if not no:
                    continue

                delay = 1.2 + random.uniform(0, 0.5)
                print(f"  ⏳ {i+1}/{len(article_list)} 수집 중 (대기 {delay:.1f}s)...")
                time.sleep(delay)

                try:
                    raw = self._fetch_json(
                        _naver_detail_api_url(no),
                        headers=_build_naver_headers(_naver_detail_api_url(no), resolved_token, resolved_cookie)
                    )
                    result_items.append(_build_naver_item_from_detail(raw, no))
                except Exception as e:
                    print(f"  ⚠️  매물 {no} 실패: {e}")

            # ── 카카오 REST API로 역지오코딩 (동 단위 주소 → 도로명) ──
            if kakao_rest_key:
                print(f"  📍 주소 변환 중 (카카오 REST API)...")
                converted = 0
                for item in result_items:
                    lat = item.get('lat')
                    lng = item.get('lng')
                    if not lat or not lng:
                        continue
                    try:
                        geo_url = f'https://dapi.kakao.com/v2/local/geo/coord2address.json?x={lng}&y={lat}'
                        geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                        with _urlopen(geo_req, timeout=5) as r:
                            geo_data = json.loads(r.read())
                        docs = geo_data.get('documents', [])
                        if docs:
                            d = docs[0]
                            road = d.get('road_address') or {}
                            jibun = d.get('address') or {}
                            road_addr = (road.get('address_name') or '').strip()
                            jibun_addr = (jibun.get('address_name') or '').strip()
                            addr = road_addr or jibun_addr
                            if road_addr:
                                item['도로명주소'] = road_addr
                            if jibun_addr:
                                item['지번주소'] = jibun_addr
                            if addr:
                                item['소재지'] = addr
                                converted += 1
                        time.sleep(0.05)
                    except Exception as eg:
                        pass
                print(f"  ✅ 주소 변환 완료: {converted}건")

            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except urllib.error.HTTPError as e:
            if e.code == 401:
                msg = '토큰 만료 — fin.land.naver.com 또는 m.land.naver.com에서 새 토큰/쿠키를 복사해 다시 적용해주세요'
            elif e.code == 403:
                msg = '접근 거부(403) — 쿠키가 잘못됐거나 IP 차단일 수 있습니다'
            elif e.code == 429:
                msg = '네이버가 429로 차단했습니다. 잠시 후 다시 시도하거나 최신 토큰/쿠키로 재적용해주세요'
            else:
                msg = f'HTTP {e.code} 오류'
            print(f"  ❌ {msg}")
            self._ok(json.dumps({'status': 'error', 'message': msg}, ensure_ascii=False))

        except Exception as e:
            print(f"  ❌ 오류: {e}")
            self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

    def _collect_assa(self, cisession='', kakao_rest_key='',
                       lat='', lng='', nelat='', swlat='', nelng='', swlng='',
                       ids=None, max_n=None):
        """
        아싸점포거래소 수집.
        - 신규 방식: cisession 쿠키 + 바운딩박스 → /item/get_item_json/map/0/0/0
        - 구형 fallback: ids 배열 → /item/get_item_json/ (ids= 방식)
        """
        ASSA_BASE = 'https://xn--v69ap5so3hsnb81e1wfh6z.com'

        def make_headers(extra_cookie=''):
            base = (
                f'cisession={cisession}' if cisession else ''
            )
            cookie_str = f'{base}; {extra_cookie}'.strip('; ') if extra_cookie else base
            return {
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'origin': ASSA_BASE,
                'referer': ASSA_BASE + '/map',
                'x-requested-with': 'XMLHttpRequest',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'cookie': cookie_str,
            }

        def clean(v):
            if v is None or v == '' or v == '0': return None
            try:
                n = float(str(v).replace(',', ''))
                return n if n != 0 else None
            except:
                return None

        def strip_html(s):
            return re.sub(r'<[^>]+>', '', s or '').replace('&nbsp;', ' ').strip()

        def parse_items(raw_list):
            result = []
            for idx, d in enumerate(raw_list):
                # ★ 첫 아이템 전체 키 출력 (상세URL ID 문제 진단용)
                if idx == 0:
                    key_sample = sorted(list(d.keys()))[:20]
                    print(f"  🔍 [아싸 디버그] 키 {len(d.keys())}개, 샘플={key_sample}")
                    print(f"  🔍 [아싸 디버그] id={d.get('id')}, item_id={d.get('item_id')}, seq={d.get('seq')}, item_code={d.get('item_code')}, code={d.get('code')}")
                wid = str(d.get('id', ''))
                addr_road   = (d.get('address_name_road') or d.get('address_user') or '').strip()
                addr_jibun  = (d.get('address_name') or '').strip()
                addr_detail = (d.get('address_detail') or '').strip()
                addr = addr_road or addr_jibun
                full_addr = f'{addr} ({addr_detail})' if addr_detail else addr

                deposit     = clean(d.get('p_deposit_price') or d.get('price_month_deposit'))
                rent        = clean(d.get('p_monthly_rent_price') or d.get('price_month_rent'))
                premium_raw = clean(d.get('price_premium'))
                if not premium_raw:
                    premium_raw = (
                        (clean(d.get('gw1_price')) or 0) +
                        (clean(d.get('gw2_price')) or 0) +
                        (clean(d.get('gw3_price')) or 0)
                    ) or None
                mgmt = clean(d.get('p_manage_price') or d.get('price_manager'))
                if mgmt and mgmt > 1000: mgmt = round(mgmt / 10000)

                실투입 = (deposit or 0) + (premium_raw or 0)
                yield율 = round(rent * 12 / 실투입 * 100, 2) if rent and 실투입 > 0 else None

                # 아싸 전용면적: 평→m2 변환
                전용평 = clean(d.get('area_real_py'))
                전용m2 = round(전용평 * 3.3058, 2) if 전용평 else None

                result.append({
                    '매물번호':      wid,
                    '매물명':        (d.get('title') or '').strip(),
                    '매물유형':      '임대용',
                    '가게상호':      (d.get('title') or '').strip() or None,
                    '업종':          d.get('category_name') or None,
                    '업종상세':      d.get('category_name_step2') or None,
                    '프랜차이즈':    d.get('franchise_name') or None,
                    '기보증금_만원': deposit,
                    '월세_만원':     rent,
                    '권리금_만원':   premium_raw,
                    '관리비_만원':   mgmt,
                    '관리비포함':    None,
                    '월수익_만원':   clean(d.get('p_monthly_sale')) or None,
                    '월매출_만원':   clean(d.get('p_monthly_sale')) or None,
                    '마진율':        None,
                    '사용기간':      None,
                    '계약면적_m2':   clean(d.get('area_real')) or None,
                    '전용면적_m2':   전용m2,
                    '해당층':        clean(d.get('floor_current')) or None,
                    '총층':          clean(d.get('floor_total')) or None,
                    '방향':          None,
                    '주차':          d.get('park') or None,
                    '소재지':        full_addr,
                    '도로명주소':    f'{addr_road} ({addr_detail})' if (addr_road and addr_detail) else (addr_road or None),
                    '지번주소':      f'{addr_jibun} ({addr_detail})' if (addr_jibun and addr_detail) else (addr_jibun or None),
                    '등록일':        (d.get('regdate') or '')[:10] or None,
                    '매물특징':      strip_html(d.get('content') or '')[:300] or None,
                    '시설권리금설명': strip_html(d.get('gw2_text') or '') or None,
                    '영업권리금설명': strip_html(d.get('gw1_text') or '') or None,
                    '수익설명':      strip_html(d.get('soon_text') or '') or None,
                    'lat':           float(d['lat']) if d.get('lat') else None,
                    'lng':           float(d['lng']) if d.get('lng') else None,
                    '상세URL':       f'{ASSA_BASE}/item/view/{wid}',
                    '출처':          '점포거래소',
                })
            return result

        try:
            all_items_raw = []

            # ── 신규 방식: 바운딩박스로 지도 API 직접 호출 ──────────────
            if cisession and lat and nelat:
                # 쿠키에 lat/lng/level 포함 (사이트 방식 그대로)
                extra_cookie = f'lat={lat}; lng={lng}; level=2'
                headers = make_headers(extra_cookie)
                offset = 30
                start = 0
                max_target = max_n if (max_n and max_n > 0) else None
                map_ids = []
                seen_ids = set()
                map_fallback_items = []

                while True:
                    body_params = urllib.parse.urlencode({
                        'lat':          lat,
                        'lng':          lng,
                        'nelat':        nelat,
                        'swlat':        swlat,
                        'nelng':        nelng,
                        'swlng':        swlng,
                        'offset':       str(offset),
                        'start':        str(start),
                        'level':        '2',
                        'franchise_id': '',
                    }).encode('utf-8')

                    req = urllib.request.Request(
                        ASSA_BASE + '/item/get_item_json/map/0/0/0',
                        data=body_params,
                        headers=headers,
                        method='POST'
                    )
                    print(f"  🌐 지도 API 호출: /item/get_item_json/map/0/0/0 (start={start}, offset={offset})")
                    with _urlopen(req, timeout=15) as resp:
                        raw = json.loads(resp.read().decode('utf-8'))

                    item_map = raw.get('item_map', []) if isinstance(raw, dict) else []
                    item_detail_one = raw.get('item', []) if isinstance(raw, dict) else []
                    if item_detail_one:
                        if isinstance(item_detail_one, list):
                            map_fallback_items.extend(item_detail_one)
                        else:
                            map_fallback_items.append(item_detail_one)

                    added_this_page = 0
                    for it in item_map:
                        iid = str(it.get('id', '')).strip()
                        if not iid or iid in seen_ids:
                            continue
                        seen_ids.add(iid)
                        map_ids.append(iid)
                        added_this_page += 1
                        if max_target and len(map_ids) >= max_target:
                            break
                    print(f"  📍 item_map 누적 ID: {len(map_ids)}개")

                    if max_target and len(map_ids) >= max_target:
                        break
                    if added_this_page < offset:
                        break
                    start += offset
                    if start > 3000:
                        break

                # item_map의 ID 목록으로 상세 조회 (chunk)
                if map_ids:
                    if max_target:
                        map_ids = map_ids[:max_target]
                    print(f"  📦 상세 조회 대상 ID: {len(map_ids)}개")
                    chunk_size = 80
                    detail_rows = []
                    for i in range(0, len(map_ids), chunk_size):
                        chunk = map_ids[i:i + chunk_size]
                        ids_str = ','.join(chunk) + ','
                        body2 = f'ids={urllib.parse.quote(ids_str)}'.encode('utf-8')
                        req2 = urllib.request.Request(
                            ASSA_BASE + '/item/get_item_json/',
                            data=body2,
                            headers=make_headers(),
                            method='POST'
                        )
                        with _urlopen(req2, timeout=20) as resp2:
                            raw2 = resp2.read().decode('utf-8')
                        detail_raw = json.loads(raw2)
                        if isinstance(detail_raw, list):
                            detail_rows.extend(detail_raw)
                        elif isinstance(detail_raw, dict):
                            rows = detail_raw.get('data') or detail_raw.get('list') or detail_raw.get('items') or []
                            if isinstance(rows, list):
                                detail_rows.extend(rows)
                    all_items_raw = detail_rows

                # 결과가 없으면 지도 응답에 포함된 단건 fallback 사용
                if not all_items_raw and map_fallback_items:
                    all_items_raw = map_fallback_items

            # ── 구형 fallback: ids 배열로 직접 상세 조회 ────────────────
            elif ids:
                print(f"  📦 구형 ids= 방식으로 {len(ids)}개 조회")
                ids_str = ','.join(str(i) for i in ids) + ','
                body = f'ids={urllib.parse.quote(ids_str)}'.encode('utf-8')
                req = urllib.request.Request(
                    ASSA_BASE + '/item/get_item_json/',
                    data=body,
                    headers=make_headers(),
                    method='POST'
                )
                with _urlopen(req, timeout=15) as resp:
                    raw = json.loads(resp.read().decode('utf-8'))
                all_items_raw = raw if isinstance(raw, list) else (
                    raw.get('data') or raw.get('list') or raw.get('items') or []
                )
            else:
                self._ok(json.dumps({'status': 'error', 'message': 'cisession과 좌표, 또는 ids가 필요합니다', 'data': []}, ensure_ascii=False))
                return

            if max_n and max_n > 0 and isinstance(all_items_raw, list):
                all_items_raw = all_items_raw[:max_n]

            print(f"  📋 {len(all_items_raw)}개 매물 수신")

            if not all_items_raw:
                self._ok(json.dumps({'status': 'warn', 'message': '매물 데이터 없음 (cisession 만료 또는 해당 지역 매물 없음)', 'data': []}, ensure_ascii=False))
                return

            result_items = parse_items(all_items_raw)
            if max_n and max_n > 0:
                result_items = result_items[:max_n]
                print(f"  🎯 상권킹 최대 개수 적용: {len(result_items)}개")

            # 역지오코딩 (소재지가 없는 매물만)
            if kakao_rest_key:
                no_addr = [it for it in result_items if not it.get('소재지') and it.get('lat') and it.get('lng')]
                if no_addr:
                    print(f"  📍 주소 변환 중... {len(no_addr)}건")
                    converted = 0
                    for item in no_addr:
                        try:
                            geo_url = f"https://dapi.kakao.com/v2/local/geo/coord2address.json?x={item['lng']}&y={item['lat']}"
                            geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                            with _urlopen(geo_req, timeout=5) as r:
                                geo = json.loads(r.read())
                            docs = geo.get('documents', [])
                            if docs:
                                rd = docs[0].get('road_address') or {}
                                jb = docs[0].get('address') or {}
                                road_addr = (rd.get('address_name') or '').strip()
                                jibun_addr = (jb.get('address_name') or '').strip()
                                addr = road_addr or jibun_addr
                                if road_addr:
                                    item['도로명주소'] = road_addr
                                if jibun_addr:
                                    item['지번주소'] = jibun_addr
                                if addr:
                                    item['소재지'] = addr
                                    converted += 1
                            time.sleep(0.05)
                        except:
                            pass
                    print(f"  ✅ 주소 변환 완료: {converted}건")

            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"  ❌ 아싸점포 수집 실패: {e}\n{tb}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))


    def _collect_disco(self, lat='', lng='', nelat='', swlat='', nelng='', swlng='', kakao_rest_key='', max_n=None):
        """디스코 실거래가 수집: /home/hello/ API"""
        try:
            ts = int(time.time() * 1000)
            try:
                a = swlat if swlat else float(lat) - 0.005
                b = swlng if swlng else float(lng) - 0.007
                c = nelat if nelat else float(lat) + 0.005
                d_v = nelng if nelng else float(lng) + 0.007
            except:
                a, b, c, d_v = lat, lng, lat, lng

            # i 파라미터: 건물 용도 코드
            # 1=아파트, 2=연립/다세대, 3=단독/다가구, 4=근린생활, 5=판매, 6=숙박,
            # 7=업무, 8=오피스텔, 9=공장/창고, 10=기타
            # ★ 4,5,6,7 포함 (상업·업무·숙박), 오피스텔(8) 제외
            # ★ current 파라미터 제거 — 해당 파라미터가 건물당 1건만 반환하는 원인일 수 있음
            url = (
                f'https://www.disco.re/home/hello/'
                f'?a={a}&b={b}&c={c}&d={d_v}'
                f'&clat={lat}&clng={lng}'
                f'&mlv=2&mt=0&at=0&ct=1&st=0&h=400'
                f'&i=4%2C5%2C6%2C7&j=1&k=2006&l=2026&m=0&n=99999999999&o=0&p=0&q=0'
                f'&sale_first=false&_={ts}'
            )
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'ko-KR,ko;q=0.9',
                'Referer': 'https://www.disco.re/',
                'Origin': 'https://www.disco.re',
                'X-Requested-With': 'XMLHttpRequest',
            }
            req = urllib.request.Request(url, headers=headers)
            print(f"  🌐 디스코 hello API 호출: {url[:120]}")
            with _urlopen(req, timeout=15) as resp:
                raw = json.loads(resp.read().decode('utf-8'))

            if isinstance(raw, list):
                items_raw = raw
            elif isinstance(raw, dict):
                # dict 응답일 경우 data/list 키 탐색
                for _k in ('data', 'list', 'result', 'items'):
                    if isinstance(raw.get(_k), list):
                        items_raw = raw[_k]
                        break
                else:
                    items_raw = []
            else:
                items_raw = []
            print(f"  📋 {len(items_raw)}개 건물 수신")
            if not items_raw:
                print(f"  ⚠️ 응답 타입: {type(raw).__name__}, 미리보기: {str(raw)[:200]}")

            if bds_cookie and all_raw_items and cookie_source in ('user', 'cache'):
                BDS_COOKIE_CACHE = bds_cookie

            def clean(v):
                if v is None or v == '' or v == '0': return None
                try:
                    n = float(str(v).replace(',', ''))
                    return n if n != 0 else None
                except: return None

            # t값: 1=매매, 2=전세, 3=월세, 4=임대, 5=단기임대, 7=매매
            # 매매(t=1,7)만 수집 - 임대/전세/월세/-1 등 제외
            DISCO_TRADE_OK = {1, 7}
            # ★ 디스코 건물 유형(bt 또는 bt_nm)으로 오피스텔 제외
            DISCO_EXCLUDE_BT = {'오피스텔', 'officetel'}
            result_items = []
            disco_skipped = 0

            for d in items_raw:
                t = d.get('t')
                if t not in DISCO_TRADE_OK:
                    continue
                # ★ 오피스텔 제외
                bt_nm = str(d.get('bt_nm') or d.get('building_type') or '').lower()
                if '오피스텔' in bt_nm or 'officetel' in bt_nm:
                    disco_skipped += 1
                    continue
                # 디스코 p필드는 만원 단위 그대로 사용 (변환 없음)
                p = clean(d.get('p'))
                uuid = d.get('u') or ''
                pnu  = d.get('pnu') or ''
                # 매물번호: 개별거래 uuid 우선, 없으면 pnu
                매물번호 = uuid if uuid else pnu

                result_items.append({
                    '매물번호':      매물번호,
                    '매물명':        '',
                    '매물유형':      '실거래',
                    '거래유형':      '매매',
                    '매매가':        p,
                    '기보증금_만원': None,
                    '월세_만원':     None,
                    '전용면적_m2':   clean(d.get('ea')),
                    '공급면적_m2':   clean(d.get('sa')),
                    '토지면적_m2':   clean(d.get('la')),
                    '해당층':        clean(d.get('fl')) or d.get('fl_nm') or d.get('floor') or None,
                    '소재지':        '',
                    '거래년월':      str(d.get('y') or ''),
                    'lat':           float(d['lat']) if d.get('lat') else None,
                    'lng':           float(d['lng']) if d.get('lng') else None,
                    '상세URL':       f"https://www.disco.re/l/{uuid}" if uuid else f"https://www.disco.re/buildings/{pnu}",
                    '출처':          '디스코',
                })

            if max_n and max_n > 0:
                result_items = result_items[:max_n]
                print(f"  🎯 상권킹 최대 개수 적용: {len(result_items)}개")

            # ★ 역지오코딩: 카카오 REST API로 좌표→주소 변환
            if kakao_rest_key:
                to_geo = [it for it in result_items if it.get('lat') and it.get('lng') and not it.get('소재지')]
                if to_geo:
                    print(f"  📍 디스코 주소 변환 중... {len(to_geo)}건")
                    converted = 0
                    for item in to_geo:
                        try:
                            geo_url = f"https://dapi.kakao.com/v2/local/geo/coord2address.json?x={item['lng']}&y={item['lat']}"
                            geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                            with _urlopen(geo_req, timeout=5) as r:
                                geo = json.loads(r.read())
                            docs = geo.get('documents', [])
                            if docs:
                                rd = docs[0].get('road_address') or {}
                                jb = docs[0].get('address') or {}
                                road_addr = (rd.get('address_name') or '').strip()
                                jibun_addr = (jb.get('address_name') or '').strip()
                                addr = road_addr or jibun_addr
                                if road_addr:
                                    item['도로명주소'] = road_addr
                                if jibun_addr:
                                    item['지번주소'] = jibun_addr
                                if addr:
                                    item['소재지'] = addr
                                    converted += 1
                            time.sleep(0.05)
                        except:
                            pass
                    print(f"  ✅ 디스코 주소 변환 완료: {converted}건")

            if disco_skipped:
                print(f"  🏢 오피스텔 {disco_skipped}건 제외")
            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except Exception as e:
            import traceback
            print(f"  ❌ 디스코 수집 실패: {e}\n{traceback.format_exc()}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))

    def _collect_bds(self, lat='', lng='', nelat='', swlat='', nelng='', swlng='', cookie='', request_url='', kakao_rest_key='', max_n=None):
        """부동산플래닛 실거래가 수집: getRealpriceMapMarker.ytp
        
        ★ v120 변경사항:
        - 브라우저에서 직접 복사한 쿠키(cookie 파라미터)를 우선 사용
        - 쿠키 없을 때만 자동취득 시도 (폴백)
        - F12로 확인한 실제 파라미터 구조 완전 반영
          · search_price_bldg_from/to, search_price_land_from/to 등 누락 파라미터 추가
          · zoom=18 (실제 요청과 동일)
          · limit_cnt=150 (실제 요청과 동일)
        - 좌표 파라미터명 확정: x1=swlat, x2=nelat, y1=swlng, y2=nelng
        """
        def sanitize_cookie(raw):
            """쿠키 문자열을 HTTP 헤더에 안전하게 사용할 수 있도록 정제.
            
            F12 복사 시 발생하는 문제들:
            - 개행(\n) 뒤에 'host' 등 다음 헤더가 딸려오는 경우 → 첫 줄만 취함
            - \r\n, \n, \r 모두 처리
            - 앞뒤 공백/탭 제거
            - HTTP 헤더값 불가 문자(\x00~\x1f, \x7f~) 제거 (단, \t는 허용)
            - Python 3.15+ urllib의 엄격한 헤더 검증 통과
            """
            import re
            # 1) 개행 이후 잘라내기 (다음 헤더가 붙은 경우 제거)
            clean = re.split(r'[\r\n]', raw)[0]
            # 2) 앞뒤 공백/탭 제거
            clean = clean.strip()
            # 3) HTTP 헤더에 사용 불가한 제어문자 제거 (0x00-0x1f 중 탭(0x09) 제외, 0x7f~)
            clean = re.sub(r'[\x00-\x08\x0a-\x1f\x7f-\xff]', '', clean)
            return clean

        try:
            _lat  = float(lat)
            _lng  = float(lng)
            _nelat = float(nelat) if nelat else _lat + 0.008
            _swlat = float(swlat) if swlat else _lat - 0.008
            _nelng = float(nelng) if nelng else _lng + 0.008
            _swlng = float(swlng) if swlng else _lng - 0.008

            # ★ [BDS v15] 프론트에서 bbox가 점 하나로 들어오는 경우 서버에서도 안전 보정.
            # 부동산플래닛 getRealpriceMapMarker는 x1/x2/y1/y2 면적이 없으면 200/빈 응답을 반환할 수 있다.
            if _swlat > _nelat:
                _swlat, _nelat = _nelat, _swlat
            if _swlng > _nelng:
                _swlng, _nelng = _nelng, _swlng
            if abs(_nelat - _swlat) < 0.002:
                _nelat = _lat + 0.01
                _swlat = _lat - 0.01
                print(f"  🧭 BDS bbox 위도 보정: swlat={_swlat}, nelat={_nelat}")
            if abs(_nelng - _swlng) < 0.002:
                _nelng = _lng + 0.01
                _swlng = _lng - 0.01
                print(f"  🧭 BDS bbox 경도 보정: swlng={_swlng}, nelng={_nelng}")

            request_limit = max_n if (max_n and max_n > 0) else 150
            request_limit = max(50, min(int(request_limit), 150))

            print(f"  🌍 부동산플래닛 수집 시작 (lat={_lat}, lng={_lng})...")

            # ★ 쿠키 우선순위: (1) 브라우저 직접 전달 → (2) 이전에 성공/저장된 캐시 → (3) 자동취득
            # 자동취득 쿠키는 bdsp_usid 정도만 잡히는 경우가 있어 실거래 API가 200/빈 응답을 줄 수 있다.
            global BDS_COOKIE_CACHE
            bds_cookie = sanitize_cookie(cookie) if cookie and cookie.strip() else ''
            cookie_source = ''
            if bds_cookie:
                BDS_COOKIE_CACHE = bds_cookie
                cookie_source = 'user'
                print(f"  🍪 브라우저 쿠키 사용: {bds_cookie[:80]}...")
            else:
                cached_cookie = sanitize_cookie(BDS_COOKIE_CACHE) if BDS_COOKIE_CACHE else ''
                if cached_cookie:
                    bds_cookie = cached_cookie
                    cookie_source = 'cache'
                    print(f"  🍪 캐시 쿠키 사용: {bds_cookie[:80]}...")
                else:
                    print(f"  🔄 쿠키 미입력/캐시 없음 — 자동 취득 시도...")
                    try:
                        import http.cookiejar
                        cj = http.cookiejar.CookieJar()
                        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
                        init_req = urllib.request.Request(
                            'https://www.bdsplanet.com/map/realprice_map',
                            headers={
                                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                                'Accept-Language': 'ko-KR,ko;q=0.9',
                            }
                        )
                        opener.open(init_req, timeout=10)
                        bds_cookie = '; '.join([f'{c.name}={c.value}' for c in cj])
                        cookie_source = 'auto'
                        print(f"  🍪 자동취득 쿠키: {bds_cookie[:80]}...")
                        # 자동취득 쿠키는 권한이 부족할 수 있으므로 성공 전까지 전역 캐시를 덮어쓰지 않는다.
                    except Exception as ce:
                        cookie_source = 'none'
                        print(f"  ⚠️ 쿠키 자동취득 실패: {ce} — 쿠키 없이 시도")

            # ★ F12에서 확인한 실제 공통 헤더
            base_headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.bdsplanet.com/map/realprice_map',
                'Origin': 'https://www.bdsplanet.com',
                'X-Requested-With': 'XMLHttpRequest',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Connection': 'keep-alive',
            }
            if bds_cookie:
                base_headers['Cookie'] = bds_cookie

            def _build_bds_url_from_template(template_url, t_type_val):
                """브라우저에서 복사한 실제 Request URL을 기준으로 좌표/limit만 현재 값으로 교체."""
                raw_url = str(template_url or '').strip()
                if not raw_url or 'getRealpriceMapMarker.ytp' not in raw_url:
                    return ''
                try:
                    parsed_u = urllib.parse.urlsplit(raw_url)
                    # 호스트는 항상 www.bdsplanet.com으로 고정하되, 기존 query 구조는 최대 보존
                    q = urllib.parse.parse_qs(parsed_u.query, keep_blank_values=True)
                    def set1(k, v): q[k] = [str(v)]
                    set1('x1', _swlat)
                    set1('x2', _nelat)
                    set1('y1', _swlng)
                    set1('y2', _nelng)
                    set1('zoom', '18')
                    set1('limit_cnt', request_limit)
                    set1('t_type', t_type_val)
                    set1('search_t_type', t_type_val)
                    if 'search_erasure_status' not in q: set1('search_erasure_status', 'N')
                    # doseq=True로 기존 다중값/빈값 보존
                    query = urllib.parse.urlencode(q, doseq=True)
                    return 'https://www.bdsplanet.com/map/getRealpriceMapMarker.ytp?' + query
                except Exception as te:
                    print(f"  ⚠️ BDS 요청 URL 템플릿 파싱 실패: {te}")
                    return ''

            all_raw_items = []
            empty_response_seen = False
            parse_error_seen = False
            unknown_structure_seen = False
            for t_type_val in ('1',):  # 매매만 수집 (임대 제외)
                # ★ F12 실제 URL 파라미터 완전 반영 (누락 항목 추가)
                params = urllib.parse.urlencode({
                    'search_r_type': 'B,G,F',
                    'search_t_type': t_type_val,
                    'search_year': '',
                    'search_price_tab': 'C0',
                    'search_price_unit': 'py',
                    'search_price_from': '',
                    'search_price_to': '',
                    'search_price_bldg_from': '',       # ★ 추가
                    'search_price_bldg_to': '',         # ★ 추가
                    'search_price_land_from': '',       # ★ 추가
                    'search_price_land_to': '',         # ★ 추가
                    'search_price_supply_from': '',     # ★ 추가
                    'search_price_supply_to': '',       # ★ 추가
                    'search_price_exclusive_from': '',  # ★ 추가
                    'search_price_exclusive_to': '',    # ★ 추가
                    'search_area_tab': 'A1',
                    'search_area_set_tab': 'supply',
                    'search_area_unit': 'py',
                    'search_area_bldg_from': '',        # ★ 추가
                    'search_area_bldg_to': '',          # ★ 추가
                    'search_area_land_from': '',        # ★ 추가
                    'search_area_land_to': '',          # ★ 추가
                    'search_area_set_from': '',
                    'search_area_set_to': '',
                    'search_area_land_right_from': '',  # ★ 추가
                    'search_area_land_right_to': '',    # ★ 추가
                    'search_land_purpose': '',
                    'search_main_use': '',
                    'search_main_use_none_add': '',     # ★ 추가
                    'search_use_district': '',
                    'search_completion_year_from': '',
                    'search_completion_year_to': '',
                    'x1': str(_swlat),   # swlat (남서 위도)
                    'x2': str(_nelat),   # nelat (북동 위도)
                    'y1': str(_swlng),   # swlng (남서 경도)
                    'y2': str(_nelng),   # nelng (북동 경도)
                    'zoom': '18',        # ★ 실제 요청과 동일하게 18
                    'limit_cnt': str(request_limit),
                    't_type': t_type_val,
                    'search_erasure_status': 'N',
                })
                url = _build_bds_url_from_template(request_url, t_type_val) or f'https://www.bdsplanet.com/map/getRealpriceMapMarker.ytp?{params}'
                print(f"  🌐 부동산플래닛 API 호출 (t_type={t_type_val})...")
                if request_url and 'getRealpriceMapMarker.ytp' in str(request_url):
                    print('     실제 Request URL 템플릿 사용')
                print(f"     URL: {url[:120]}...")
                try:
                    req = urllib.request.Request(url, headers=base_headers)
                    with _urlopen(req, timeout=20) as resp:
                        raw_text = resp.read().decode('utf-8').strip()
                except urllib.error.HTTPError as e:
                    err_body = ''
                    try: err_body = e.read().decode('utf-8')[:200]
                    except: pass
                    print(f"  ⚠️ HTTP {e.code} 오류 (t_type={t_type_val}) — {err_body}")
                    continue

                print(f"  🔍 응답 미리보기 (t_type={t_type_val}): {raw_text[:200]}")
                if not raw_text:
                    empty_response_seen = True
                    print(f"  ⚠️ 빈 응답 (t_type={t_type_val}) — 쿠키/세션 부족 가능성이 큼")
                    continue

                try:
                    raw = json.loads(raw_text)
                except Exception as je:
                    parse_error_seen = True
                    print(f"  ⚠️ JSON 파싱 실패 (t_type={t_type_val}): {je}")
                    print(f"     응답 원문: {raw_text[:500]}")
                    continue

                def _find_bds_items(obj, depth=0):
                    if depth > 5 or obj is None:
                        return []
                    if isinstance(obj, list):
                        # 실거래 row는 dict 배열인 경우가 대부분이다.
                        if not obj:
                            return []
                        if any(isinstance(x, dict) for x in obj):
                            return obj
                        return []
                    if isinstance(obj, dict):
                        # 부동산플래닛 응답 구조 변경 대비: 실거래 목록 후보 키 우선 탐색
                        priority_keys = (
                            'realpriceDealList', 'realPriceDealList', 'realpriceMapMarkerList',
                            'markerList', 'dealList', 'list', 'items', 'contents', 'data', 'result',
                            'body', 'payload', 'rows'
                        )
                        for key in priority_keys:
                            if key in obj:
                                found = _find_bds_items(obj.get(key), depth + 1)
                                if found:
                                    return found
                        for val in obj.values():
                            found = _find_bds_items(val, depth + 1)
                            if found:
                                return found
                    return []

                items_raw = _find_bds_items(raw)
                if isinstance(raw, dict) and not items_raw:
                    unknown_structure_seen = True
                    print(f"  ⚠️ 알 수 없는 응답 구조 — 키 목록: {list(raw.keys())}")

                print(f"  📋 t_type={t_type_val}: {len(items_raw)}개 수신")
                all_raw_items.extend(items_raw)

            if not all_raw_items:
                if empty_response_seen:
                    msg = '부동산플래닛 API가 빈 응답을 반환했습니다. 자동취득/캐시 쿠키로는 권한이 부족할 수 있으니 브라우저 Cookie를 입력해 주세요.'
                    if cookie_source == 'user':
                        msg = '입력한 부동산플래닛 Cookie로도 빈 응답이 왔습니다. Cookie가 만료됐거나 다른 요청의 Cookie일 수 있습니다.'
                    self._ok(json.dumps({'status': 'cookie_required', 'message': msg, 'data': [], 'cookie_source': cookie_source}, ensure_ascii=False))
                    return
                if parse_error_seen or unknown_structure_seen:
                    self._ok(json.dumps({'status': 'warn', 'message': '부동산플래닛 응답 구조를 읽지 못했습니다. proxy_server.py 파서 업데이트가 필요합니다.', 'data': []}, ensure_ascii=False))
                    return
                self._ok(json.dumps({'status': 'warn', 'message': '해당 지도 범위의 부동산플래닛 실거래 데이터가 없습니다.', 'data': []}, ensure_ascii=False))
                return

            if bds_cookie and all_raw_items and cookie_source in ('user', 'cache'):
                BDS_COOKIE_CACHE = bds_cookie

            def clean(v):
                if v is None or v == '' or v == '0': return None
                try:
                    n = float(str(v).replace(',', ''))
                    return n if n != 0 else None
                except: return None

            # ★ 상가/업무용만 포함 - 아파트/빌라/주거용 제외
            # r_type_nm: '근린생활', '업무', '판매', '숙박', '공장', '창고' 등 포함
            # 제외: '아파트', '연립다세대', '단독다가구', '단독주택' 등 주거용
            # ★ 오피스텔 명시적 제외 추가 (기존에 EXCLUDE에 없어서 그대로 통과되던 문제 수정)
            EXCLUDE_R_TYPES = {'아파트', '연립다세대', '단독다가구', '다세대', '단독주택', '다가구', '오피스텔'}
            # '오피스' 키워드는 오피스텔과 겹치므로 제거, 대신 '오피스(건물)' 처리는 r_type 코드로
            INCLUDE_KEYWORDS = ['근린', '업무', '판매', '숙박', '상가']  # 공장/창고/토지/오피스텔 제외

            def bds_addr_key(d):
                addr = str(d.get('addr_nm') or '').strip()
                if addr:
                    return 'addr:' + ' '.join(addr.split())
                pnu = str(d.get('pnu') or '').strip()
                if pnu:
                    return 'pnu:' + pnu
                eais_pk = str(d.get('eais_pk') or '').strip()
                if eais_pk:
                    return 'eais:' + eais_pk
                lat_v = d.get('lat')
                lng_v = d.get('lng')
                if lat_v and lng_v:
                    return f"coord:{lat_v},{lng_v}"
                return ''

            def bds_trade_rank(d):
                try:
                    year = int(str(d.get('t_year') or '0').strip() or '0')
                except:
                    year = 0
                try:
                    month = int(str(d.get('t_month') or '0').strip() or '0')
                except:
                    month = 0
                try:
                    t_no_num = int(str(d.get('t_no') or '0').strip() or '0')
                except:
                    t_no_num = 0
                info_score = 0
                for k in ('excl_area_m2', 'pvt_area_m2', 'exclusive_area_m2', 'exclusiveArea', 'spc2', 'bldg_area_m2', 'obj_amt', 't_floor', 'floor_level', 'flr', 'floor', 'f_nm', 'bldg_flr'):
                    if d.get(k) not in (None, '', '0', 0):
                        info_score += 1
                return (year, month, info_score, t_no_num)

            latest_by_addr = {}
            skipped_residential = 0
            for d in all_raw_items:
                # r_type_nm으로 주거용/오피스텔 필터링
                r_nm = str(d.get('r_type_nm') or '').strip()
                if r_nm:
                    if r_nm in EXCLUDE_R_TYPES:
                        skipped_residential += 1
                        continue
                    # 오피스텔이 r_type_nm에 부분 포함되는 경우도 제외
                    if '오피스텔' in r_nm:
                        skipped_residential += 1
                        continue
                    has_residential = any(kw in r_nm for kw in ['아파트', '연립', '다가구', '다세대', '단독주택'])
                    has_include = any(kw in r_nm for kw in INCLUDE_KEYWORDS)
                    if has_residential and not has_include:
                        skipped_residential += 1
                        continue
                else:
                    # ★ r_type_nm 비어있으면: r_type 코드로 주거 판단 시도
                    # r_type: 1=아파트, 2=연립다세대, 3=단독, 7=오피스텔 (플래닛 기준 추정)
                    r_type_code = str(d.get('r_type') or '').strip()
                    if r_type_code in ('1', '2', '3', '7'):
                        skipped_residential += 1
                        continue
                    # r_type_nm도 없고 코드도 없으면 일단 수집 (주소로 사후 판단)

                addr_key = bds_addr_key(d)
                if addr_key:
                    prev = latest_by_addr.get(addr_key)
                    if prev is None or bds_trade_rank(d) > bds_trade_rank(prev):
                        latest_by_addr[addr_key] = d
                    continue
                anon_key = f"anon:{len(latest_by_addr)}"
                latest_by_addr[anon_key] = d

            if latest_by_addr and len(latest_by_addr) < len(all_raw_items):
                print(f"  🧹 주소 기준 최신거래만 유지: {len(all_raw_items)}개 → {len(latest_by_addr)}개")

            result_items = []
            for d in latest_by_addr.values():

                obj_amt = clean(d.get('obj_amt'))  # 원 단위
                obj_amt_만 = round(obj_amt / 10000) if obj_amt and obj_amt >= 10000 else obj_amt

                t_type = str(d.get('t_type', ''))
                t_type_nm = d.get('t_type_nm') or ('매매' if t_type == '1' else '임대')
                monthly = clean(d.get('monthly'))  # 월세(만원)

                거래년월 = f"{d.get('t_year','')}.{str(d.get('t_month','')).zfill(2)}" if d.get('t_year') else ''
                exclusive_area_m2 = (
                    clean(d.get('excl_area_m2'))
                    or clean(d.get('pvt_area_m2'))
                    or clean(d.get('exclusive_area_m2'))
                    or clean(d.get('exclusiveArea'))
                    or clean(d.get('spc2'))
                    or clean(d.get('bldg_area_m2'))
                )

                result_items.append({
                    '매물번호':      str(d.get('t_no') or d.get('pnu') or d.get('eais_pk') or ''),
                    '매물명':        d.get('r_type_nm') or '',
                    '매물유형':      '실거래',
                    '거래유형':      t_type_nm,
                    '매매가':        obj_amt_만 if t_type == '1' else None,
                    '기보증금_만원': None,  # 매매만 수집하므로 보증금 없음
                    '월세_만원':     monthly,
                    '계약면적_m2':   clean(d.get('contract_area_m2')),
                    '전용면적_m2':   exclusive_area_m2,
                    '공급면적_m2':   clean(d.get('supply_area_m2')) or clean(d.get('supplyArea')),
                    '건물면적_m2':   clean(d.get('bldg_area_m2')),
                    '건축연도':      d.get('build_year') or None,
                    '해당층':        d.get('t_floor') or d.get('floor_level') or d.get('flr') or d.get('floor') or d.get('f_nm') or d.get('bldg_flr') or d.get('obj_floor') or d.get('floor_no') or None,
                    '소재지':        (d.get('addr_nm') or (str(d.get('sigungu_nm','')) + ' ' + str(d.get('dong_nm') or d.get('dongnm') or '')).strip() or ''),
                    '지번주소':      (d.get('addr_nm') or '').strip() or None,
                    '거래년월':      거래년월,
                    'lat':           float(d['lat']) if d.get('lat') else None,
                    'lng':           float(d['lng']) if d.get('lng') else None,
                    '출처':          '부동산플래닛',
                    '_eais_pk':       d.get('eais_pk') or '',
                    '_r_type':        d.get('r_type') or '',
                    '_bldg_area_m2':  float(d['bldg_area_m2']) if d.get('bldg_area_m2') else None,
                })

            if max_n and max_n > 0:
                result_items = result_items[:max_n]
                print(f"  🎯 상권킹 최대 개수 적용: {len(result_items)}개")

            # ★ 역지오코딩: 플래닛은 원본 지번주소를 대표 소재지로 유지하고, 도로명주소만 보조로 채움
            if kakao_rest_key:
                to_geo = [it for it in result_items if it.get('lat') and it.get('lng')]
                if to_geo:
                    print(f"  📍 부동산플래닛 주소 변환 중... {len(to_geo)}건")
                    converted = 0
                    for item in to_geo:
                        try:
                            geo_url = f"https://dapi.kakao.com/v2/local/geo/coord2address.json?x={item['lng']}&y={item['lat']}"
                            geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                            with _urlopen(geo_req, timeout=5) as r:
                                geo = json.loads(r.read())
                            docs = geo.get('documents', [])
                            if docs:
                                rd = docs[0].get('road_address') or {}
                                jb = docs[0].get('address') or {}
                                road_addr = (rd.get('address_name') or '').strip()
                                jibun_addr = (jb.get('address_name') or '').strip()
                                addr = road_addr or jibun_addr
                                if road_addr:
                                    item['도로명주소'] = road_addr
                                if jibun_addr:
                                    item['지번주소'] = jibun_addr
                                if not item.get('소재지') and addr:
                                    item['소재지'] = addr
                                    converted += 1
                            time.sleep(0.05)
                        except:
                            pass
                    print(f"  ✅ 부동산플래닛 주소 변환 완료: {converted}건")

            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except Exception as e:
            import traceback
            print(f"  ❌ 부동산플래닛 수집 실패: {e}\n{traceback.format_exc()}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))


    def _collect_nemo(self, kakao_rest_key='',
                      lat='', lng='', nelat='', swlat='', nelng='', swlng='', max_n=None):
        """네모 수집: www.nemoapp.kr/api/store/search-list"""
        NEMO_API = 'https://www.nemoapp.kr/api/store/search-list'

        def clean(v):
            if v is None or v == '' or v == 0: return None
            try:
                n = float(str(v).replace(',', ''))
                return n if n != 0 else None
            except:
                return None

        def clean_floor(v):
            if v is None or v == '' or v == 0:
                return None
            s = str(v).strip()
            m = re.search(r'B?\d+', s, re.I)
            if not m:
                return clean(v)
            token = m.group(0).upper()
            if token.startswith('B'):
                try:
                    return -int(token[1:])
                except:
                    return token
            try:
                return int(token)
            except:
                return clean(v)

        def is_specific_addr(v):
            s = (v or '').strip()
            if not s or not re.search(r'\d', s):
                return False
            return bool(re.search(r'(로|길)\s*\d|동\s*\d+[-\d]*|번길\s*\d', s))

        detail_cache = {}

        def fetch_nemo_detail(wid):
            wid = str(wid or '').strip()
            if not wid:
                return None
            if wid in detail_cache:
                return detail_cache[wid]
            detail_cache[wid] = None
            try:
                detail_url = f'https://www.nemoapp.kr/share/store/{urllib.parse.quote(wid)}'
                req = urllib.request.Request(detail_url, headers={
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'ko-KR,ko;q=0.9',
                    'referer': 'https://www.nemoapp.kr/',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                })
                with _urlopen(req, timeout=10) as resp:
                    html = resp.read().decode('utf-8', errors='ignore')

                info = {'road': '', 'jibun': '', 'lat': None, 'lng': None}

                def pick_specific_addr(cands):
                    best = ''
                    for cand in cands or []:
                        s = str(cand or '').strip()
                        if not s:
                            continue
                        if best and is_specific_addr(best) and not is_specific_addr(s):
                            continue
                        if (is_specific_addr(s) and not is_specific_addr(best)) or len(s) > len(best):
                            best = s
                    return best

                marker = '"building"'
                idx = html.find(marker)
                if idx >= 0:
                    colon = html.find(':', idx + len(marker))
                    brace = html.find('{', colon)
                    if colon >= 0 and brace >= 0:
                        try:
                            data, _ = json.JSONDecoder().raw_decode(html[brace:])
                            if isinstance(data, dict):
                                info['road'] = (data.get('roadAddress') or data.get('road_address') or '').strip()
                                info['jibun'] = (data.get('jibunAddress') or data.get('jibun_address') or '').strip()
                                info['lat'] = clean(data.get('latitude') or data.get('lat'))
                                info['lng'] = clean(data.get('longitude') or data.get('lng'))
                        except Exception:
                            pass

                road_matches = re.findall(r'\\?"roadAddress\\?"\s*:\s*\\?"([^"\\]+)\\?"', html)
                jibun_matches = re.findall(r'\\?"jibunAddress\\?"\s*:\s*\\?"([^"\\]+)\\?"', html)
                road_matches.extend(re.findall(r'\\?"road_address\\?"\s*:\s*\\?"([^"\\]+)\\?"', html))
                jibun_matches.extend(re.findall(r'\\?"jibun_address\\?"\s*:\s*\\?"([^"\\]+)\\?"', html))
                jibun_matches.extend(re.findall(r'\\?"address_name\\?"\s*:\s*\\?"([^"\\]+)\\?"', html))
                part1_matches = re.findall(r'\\?"roadAddressPart1\\?"\s*:\s*\\?"([^"\\]+)\\?"', html)
                part2_matches = re.findall(r'\\?"roadAddressPart2\\?"\s*:\s*\\?"([^"\\]+)\\?"', html)
                if part1_matches or part2_matches:
                    for i, p1 in enumerate(part1_matches or ['']):
                        p2 = part2_matches[i] if i < len(part2_matches) else ''
                        merged_road = (str(p1 or '').strip() + ' ' + str(p2 or '').strip()).strip()
                        if merged_road:
                            road_matches.append(merged_road)
                if road_matches:
                    info['road'] = pick_specific_addr([info['road']] + road_matches)
                if jibun_matches:
                    info['jibun'] = pick_specific_addr([info['jibun']] + jibun_matches)
                if not info['lat'] or not info['lng']:
                    m = re.search(r'\\?"location\\?"\s*:\s*\{\\?"latitude\\?"\s*:\s*([0-9.]+)\s*,\s*\\?"longitude\\?"\s*:\s*([0-9.]+)', html)
                    if m:
                        info['lat'] = info['lat'] or clean(m.group(1))
                        info['lng'] = info['lng'] or clean(m.group(2))
                if not info['road'] and not info['jibun']:
                    addr_matches = re.findall(r'\\?"address\\?"\s*:\s*\\?"([^"\\]+)\\?"', html)
                    if addr_matches:
                        info['jibun'] = pick_specific_addr(addr_matches)

                if not (info['road'] or info['jibun'] or info['lat'] or info['lng']):
                    return None

                detail_cache[wid] = info
                time.sleep(0.03)
                return info
            except Exception:
                return None

        try:
            _lat  = float(lat)
            _lng  = float(lng)
            _nelat = float(nelat) if nelat else _lat + 0.005
            _swlat = float(swlat) if swlat else _lat - 0.005
            _nelng = float(nelng) if nelng else _lng + 0.005
            _swlng = float(swlng) if swlng else _lng - 0.005

            headers = {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'ko-KR,ko;q=0.9',
                'origin': 'https://www.nemoapp.kr',
                'referer': 'https://www.nemoapp.kr/',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            }
            target_n = max_n if (max_n and max_n > 0) else None
            items = []
            page_index = 0
            while True:
                params = urllib.parse.urlencode({
                    'CompletedOnly': 'false',
                    'NELat': _nelat,
                    'NELng': _nelng,
                    'SWLat': _swlat,
                    'SWLng': _swlng,
                    'Zoom': 17,
                    'SortBy': 29,
                    'PageIndex': page_index,
                })
                url = f'{NEMO_API}?{params}'
                req = urllib.request.Request(url, headers=headers)
                print(f"  🌐 네모 API 호출... (page={page_index})")
                with _urlopen(req, timeout=15) as resp:
                    raw = json.loads(resp.read().decode('utf-8'))
                page_items = raw.get('items', []) if isinstance(raw, dict) else []
                if not page_items:
                    break
                items.extend(page_items)
                if target_n and len(items) >= target_n:
                    break
                if len(page_items) < 20:
                    break
                page_index += 1
                if page_index > 50:
                    break
            if target_n:
                items = items[:target_n]
                print(f"  🎯 상권킹 최대 개수 적용: {len(items)}개")
            print(f"  📋 {len(items)}개 매물 수신")

            if not items:
                self._ok(json.dumps({'status': 'warn', 'message': '매물 없음 (해당 지역 매물 없음)', 'data': []}, ensure_ascii=False))
                return

            result_items = []
            now_ts = int(time.time())
            for d in items:
                wid     = str(d.get('number') or d.get('id') or '')
                deposit = clean(d.get('deposit'))
                rent    = clean(d.get('monthlyRent'))
                premium = clean(d.get('premium'))
                mgmt    = clean(d.get('maintenanceFee'))
                sale    = clean(d.get('sale'))
                실투입  = (deposit or 0) + (premium or 0)
                yield율 = round(rent * 12 / 실투입 * 100, 2) if rent and 실투입 > 0 else None

                price_type = d.get('priceTypeName', '임대')

                # 네모 API는 x(경도), y(위도), address_name(주소)를 직접 제공
                _lng_val = clean(d.get('x'))
                _lat_val = clean(d.get('y'))
                _road_addr = (
                    d.get('address_name_road')
                    or d.get('roadAddress')
                    or d.get('road_address')
                    or d.get('roadAddr')
                    or ''
                ).strip()
                _jibun_addr = (
                    d.get('address_name')
                    or d.get('jibunAddress')
                    or d.get('jibun_address')
                    or d.get('parcelAddress')
                    or ''
                ).strip()
                _addr = _road_addr or _jibun_addr
                if not is_specific_addr(_addr):
                    detail_info = fetch_nemo_detail(wid)
                    if detail_info:
                        _road_addr = detail_info.get('road') or _road_addr
                        _jibun_addr = detail_info.get('jibun') or _jibun_addr
                        _addr = _road_addr or _jibun_addr or _addr
                        _lat_val = _lat_val or detail_info.get('lat')
                        _lng_val = _lng_val or detail_info.get('lng')

                result_items.append({
                    '매물번호':      wid,
                    '매물명':        (d.get('title') or '').strip(),
                    '매물유형':      price_type,
                    '업종':          (d.get('businessLargeCodeName') or '').strip(),
                    '업종상세':      (d.get('businessMiddleCodeName') or '').strip() or None,
                    '프랜차이즈':    None,
                    '가게상호':      None,
                    '기보증금_만원': deposit,
                    '월세_만원':     rent,
                    '권리금_만원':   premium,
                    '관리비_만원':   mgmt,
                    '관리비포함':    None,
                    '매매가_만원':   sale if price_type == '매매' else None,
                    '수익률':        yield율,
                    '계약면적_m2':   None,
                    '전용면적_m2':   clean(d.get('size')),
                    '해당층':        clean_floor(d.get('floor')),
                    '총층':          clean(d.get('groundFloor')),
                    '방향':          None,
                    '주차':          None,
                    '소재지':        _addr or None,
                    '도로명주소':    _road_addr or None,
                    '지번주소':      _jibun_addr or None,
                    'address_name_road': _road_addr or None,
                    'address_name':   _jibun_addr or None,
                    '등록일':        (d.get('createdDateUtc') or '')[:10] or None,
                    '매물특징':      None,
                    'lat':           _lat_val,
                    'lng':           _lng_val,
                    '상세URL':       f'https://www.nemoapp.kr/share/store/{wid}',
                    '출처':          '네모',
                })

            # 역지오코딩 — 주소가 비었거나 너무 거친 항목은 좌표 기준 주소로 보완
            if kakao_rest_key:
                to_geo = [
                    it for it in result_items
                    if it.get('lat') and it.get('lng') and not is_specific_addr(it.get('소재지'))
                ]
                if to_geo:
                    print(f"  📍 네모 주소 보완 중... {len(to_geo)}건")
                    converted = 0
                    for item in to_geo:
                        try:
                            geo_url = f"https://dapi.kakao.com/v2/local/geo/coord2address.json?x={item['lng']}&y={item['lat']}"
                            geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                            with _urlopen(geo_req, timeout=5) as r:
                                geo = json.loads(r.read())
                            docs = geo.get('documents', [])
                            if docs:
                                rd = docs[0].get('road_address') or {}
                                jb = docs[0].get('address') or {}
                                road_addr  = (rd.get('address_name') or '').strip()
                                jibun_addr = (jb.get('address_name') or '').strip()
                                if road_addr: item['도로명주소'] = road_addr
                                if jibun_addr: item['지번주소'] = jibun_addr
                                if road_addr or jibun_addr:
                                    item['소재지'] = road_addr or jibun_addr
                                    item['address'] = road_addr or jibun_addr
                                    converted += 1
                            time.sleep(0.05)
                        except: pass
                    print(f"  ✅ 네모 주소 보완 완료: {converted}건")

            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except Exception as e:
            import traceback
            print(f"  ❌ 네모 수집 실패: {e}\n{traceback.format_exc()}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))

    def _collect_jumpo(self, cookie='', kakao_rest_key='',
                        lat='', lng='', nelat='', swlat='', nelng='', swlng='', max_n=None):
        """점포라인 수집: api.jumpoline.com/Api/Maps/findrt"""
        JUMPO_API = 'https://api.jumpoline.com/Api/Maps/findrt'

        def clean(v):
            if v is None or v == '' or v == '0': return None
            try:
                n = float(str(v).replace(',', ''))
                return n if n != 0 else None
            except:
                return None

        try:
            headers = {
                'content-type': 'application/json;charset=UTF-8',
                'origin': 'https://map.jumpoline.com',
                'referer': 'https://map.jumpoline.com/',
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            }
            if cookie:
                headers['cookie'] = cookie

            body = json.dumps({
                'sortField': 'ad',
                'mcode': 'all',
                'scode': 'all',
                'floor': 'all',
                'extent': 'all',
                'budget': 'all',
                'lat': float(lat),
                'lng': float(lng),
                'nelat': float(nelat) if nelat else float(lat) + 0.005,
                'swlat': float(swlat) if swlat else float(lat) - 0.005,
                'nelng': float(nelng) if nelng else float(lng) + 0.005,
                'swlng': float(swlng) if swlng else float(lng) - 0.005,
                'rad': 0.5,
                'sortMethod': '',
                'sortOpt': False,
                'align': 'new',
            }, ensure_ascii=False).encode('utf-8')

            req = urllib.request.Request(JUMPO_API, data=body, headers=headers, method='POST')
            print(f"  🌐 점포라인 API 호출...")
            with _urlopen(req, timeout=15) as resp:
                raw = json.loads(resp.read().decode('utf-8'))

            items = raw.get('contents', [])
            print(f"  📋 {len(items)}개 매물 수신")
            if max_n and max_n > 0:
                items = items[:max_n]
                print(f"  🎯 상권킹 최대 개수 적용: {len(items)}개")

            if not items:
                self._ok(json.dumps({'status': 'warn', 'message': '매물 없음 (해당 지역 매물 없거나 쿠키 필요)', 'data': []}, ensure_ascii=False))
                return

            result_items = []
            now_ts = int(time.time())
            for d in items:
                wid = str(d.get('idx') or d.get('number') or '')
                number = str(d.get('number') or wid)
                mgmt = clean(d.get('MngFee'))
                if mgmt and mgmt > 10000: mgmt = round(mgmt / 10000)  # 원→만원

                deposit = clean(d.get('deposit'))
                premium = clean(d.get('premium'))
                입점비용 = clean(d.get('monthlyCost') or d.get('input_cost'))

                rent = clean(d.get('rent'))
                if not rent and 입점비용:
                    rent = max((입점비용 or 0) - (mgmt or 0), 0) or 입점비용

                실투입 = (deposit or 0) + (premium or 0)
                yield율 = round(rent * 12 / 실투입 * 100, 2) if rent and 실투입 > 0 else clean(d.get('profitRate'))

                # 점포라인 관리비포함 여부 판단
                rent_raw   = clean(d.get('rent'))
                mgmt_raw2  = clean(d.get('MngFee'))
                관리비포함 = None
                if mgmt_raw2 and mgmt_raw2 > 10000: mgmt_raw2 = round(mgmt_raw2/10000)
                if rent_raw and mgmt_raw2:
                    관리비포함 = False  # 월세/관리비 각각 있음
                elif 입점비용 and not mgmt_raw2:
                    관리비포함 = True   # 입점비용=관리비포함

                result_items.append({
                    '매물번호':      number,
                    '매물명':        (d.get('subject') or '').strip(),
                    '매물유형':      '임대용',
                    '업종':          (d.get('title') or '').strip(),
                    '업종상세':      None,
                    '프랜차이즈':    d.get('frncName') or None,
                    '가게상호':      None,
                    '기보증금_만원': deposit,
                    '월세_만원':     rent,
                    '권리금_만원':   premium,
                    '관리비_만원':   mgmt,
                    '관리비포함':    관리비포함,
                    '월수익_만원':   clean(d.get('profit')) or None,
                    '월매출_만원':   None,
                    '마진율':        None,
                    '사용기간':      d.get('useperiod') or None,
                    '계약면적_m2':   clean(d.get('size')) or None,
                    '전용면적_m2':   None,
                    '해당층':        clean(d.get('floor')) or None,
                    '총층':          None,
                    '방향':          None,
                    '주차':          None,
                    '소재지':        (d.get('addr') or '').strip(),
                    '등록일':        d.get('date') or None,
                    '매물특징':      (d.get('WebTrait') or '').strip() or None,
                    'lat':           float(d['lat']) if d.get('lat') else None,
                    'lng':           float(d['lng']) if d.get('lng') else None,
                    '상세URL':       f'https://jumpoline.com/_jumpo/jumpo_view.asp?webjofrsid={wid}',
                    '출처':          '점포라인',
                })

            # 역지오코딩 — 소재지가 동 단위인 것만 변환
            if kakao_rest_key:
                to_geo = [it for it in result_items if it.get('lat') and it.get('lng')
                          and not any(c in (it.get('소재지') or '') for c in ['로 ', '길 ', '로	'])]
                if to_geo:
                    print(f"  📍 주소 변환 중... {len(to_geo)}건")
                    converted = 0
                    for item in to_geo:
                        try:
                            geo_url = f"https://dapi.kakao.com/v2/local/geo/coord2address.json?x={item['lng']}&y={item['lat']}"
                            geo_req = urllib.request.Request(geo_url, headers={'Authorization': f'KakaoAK {kakao_rest_key}'})
                            with _urlopen(geo_req, timeout=5) as r:
                                geo = json.loads(r.read())
                            docs = geo.get('documents', [])
                            if docs:
                                rd = docs[0].get('road_address') or {}
                                jb = docs[0].get('address') or {}
                                road_addr = (rd.get('address_name') or '').strip()
                                jibun_addr = (jb.get('address_name') or '').strip()
                                addr = road_addr or jibun_addr
                                if road_addr:
                                    item['도로명주소'] = road_addr
                                if jibun_addr:
                                    item['지번주소'] = jibun_addr
                                if addr:
                                    item['소재지'] = addr
                                    converted += 1
                            time.sleep(0.05)
                        except: pass
                    print(f"  ✅ 주소 변환 완료: {converted}건")

            if max_n and max_n > 0:
                result_items = result_items[:max_n]
            msg = f'{len(result_items)}개 수집 완료'
            print(f"  ✅ {msg}")
            self._ok(json.dumps({'status': 'success', 'message': msg, 'data': result_items}, ensure_ascii=False))

        except Exception as e:
            import traceback
            print(f"  ❌ 점포라인 수집 실패: {e}\n{traceback.format_exc()}")
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))

    def _normalize_storage_path(self, path):
        clean = str(path or '').replace('\\', '/').strip().lstrip('/')
        clean = re.sub(r'/+', '/', clean)
        parts = [part for part in clean.split('/') if part not in ('', '.')]
        if not parts or any(part == '..' for part in parts):
            raise ValueError('잘못된 파일 경로입니다')
        return '/'.join(parts)

    def _storage_abs_path(self, bucket, path):
        bucket = str(bucket or '').strip()
        if bucket not in ALLOWED_STORAGE_BUCKETS:
            raise ValueError('허용되지 않은 bucket입니다')
        rel_path = self._normalize_storage_path(path)
        abs_path = os.path.abspath(os.path.join(LOCAL_UPLOAD_ROOT, bucket, *rel_path.split('/')))
        bucket_root = os.path.abspath(os.path.join(LOCAL_UPLOAD_ROOT, bucket))
        if not abs_path.startswith(bucket_root + os.sep) and abs_path != bucket_root:
            raise ValueError('잘못된 파일 경로입니다')
        return rel_path, abs_path

    def _decode_data_url(self, data_url):
        if not isinstance(data_url, str) or ',' not in data_url:
            raise ValueError('data_url 형식이 올바르지 않습니다')
        meta, payload = data_url.split(',', 1)
        if ';base64' in meta:
            return base64.b64decode(payload)
        return urllib.parse.unquote_to_bytes(payload)

    def _handle_storage_upload(self, bucket, path, data_url, content_type):
        try:
            rel_path, abs_path = self._storage_abs_path(bucket, path)
            raw = self._decode_data_url(data_url)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, 'wb') as f:
                f.write(raw)
            public_url = f'http://localhost:{PROXY_PORT}/uploads/{urllib.parse.quote(bucket)}/' + '/'.join(
                urllib.parse.quote(part) for part in rel_path.split('/')
            )
            print(f"  💾 로컬 업로드 저장: {bucket}/{rel_path} ({len(raw)} bytes)")
            self._ok(json.dumps({
                'status': 'success',
                'bucket': bucket,
                'path': rel_path,
                'fullPath': f'{bucket}/{rel_path}',
                'publicUrl': public_url,
                'contentType': content_type or mimetypes.guess_type(abs_path)[0] or 'application/octet-stream',
            }, ensure_ascii=False))
        except Exception as e:
            self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

    def _handle_storage_delete(self, bucket, paths):
        removed = []
        missing = []
        try:
            if not isinstance(paths, list):
                raise ValueError('paths 배열이 필요합니다')
            for path in paths:
                rel_path, abs_path = self._storage_abs_path(bucket, path)
                if os.path.exists(abs_path):
                    os.remove(abs_path)
                    removed.append(rel_path)
                else:
                    missing.append(rel_path)
            self._ok(json.dumps({
                'status': 'success',
                'removed': removed,
                'missing': missing,
            }, ensure_ascii=False))
        except Exception as e:
            self._ok(json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False))

    def _handle_storage_list(self, bucket, prefix):
        try:
            if bucket not in ALLOWED_STORAGE_BUCKETS:
                raise ValueError('허용되지 않은 bucket입니다')
            clean_prefix = ''
            if prefix:
                clean_prefix = self._normalize_storage_path(prefix)
            bucket_root = os.path.join(LOCAL_UPLOAD_ROOT, bucket)
            items = []
            if os.path.isdir(bucket_root):
                for root, _, files in os.walk(bucket_root):
                    for name in files:
                        abs_path = os.path.join(root, name)
                        rel_path = os.path.relpath(abs_path, bucket_root).replace('\\', '/')
                        if clean_prefix and not rel_path.startswith(clean_prefix):
                            continue
                        items.append({
                            'name': name,
                            'path': rel_path,
                            'fullPath': f'{bucket}/{rel_path}',
                        })
            self._ok(json.dumps({'status': 'success', 'data': items}, ensure_ascii=False))
        except Exception as e:
            self._ok(json.dumps({'status': 'error', 'message': str(e), 'data': []}, ensure_ascii=False))

    def _serve_local_upload(self, bucket, path):
        try:
            _, abs_path = self._storage_abs_path(bucket, path)
            if not os.path.exists(abs_path) or not os.path.isfile(abs_path):
                self._error(404, '파일을 찾을 수 없습니다')
                return
            content_type = mimetypes.guess_type(abs_path)[0] or 'application/octet-stream'
            with open(abs_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'public, max-age=31536000')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self._error(500, str(e))

    def _fetch_json(self, target_url, headers=None):
        req = urllib.request.Request(target_url, headers=headers or _build_naver_headers(target_url, NAVER_HEADERS.get('authorization', ''), NAVER_HEADERS.get('Cookie', '')))
        with _urlopen(req, timeout=15) as resp:
            raw_bytes = resp.read()
            content_type = resp.headers.get('Content-Type', '')
        raw_text = raw_bytes.decode('utf-8', errors='replace').lstrip('\ufeff').strip()
        if not raw_text:
            return None
        if content_type and 'json' not in content_type.lower() and raw_text[:1] not in '{[' and raw_text != 'null':
            preview = raw_text[:160].replace('\n', ' ')
            raise ValueError(f'JSON이 아닌 응답 반환 ({content_type}): {preview}')
        return json.loads(raw_text)

    def _fetch_and_return(self, target_url):
        try:
            # ★ v9: 옥션원만 모바일 헤더로 요청 (나머지는 기존 NAVER_HEADERS 그대로)
            if 'auction1.co.kr' in target_url:
                use_headers = {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                    'Referer': 'https://m.auction1.co.kr/',
                }
            else:
                use_headers = NAVER_HEADERS
            req = urllib.request.Request(target_url, headers=use_headers)
            with _urlopen(req, timeout=15) as resp:
                data = resp.read()
                content_type = resp.headers.get('Content-Type', 'text/html; charset=utf-8')
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self._error(500, str(e))

    def _ok(self, body_str):
        body = body_str.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        body = json.dumps({'error': msg}, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PROXY_PORT), ProxyHandler)
    print(f"""
╔══════════════════════════════════════════════════════╗
║   🏢 부동산 수집 프록시 서버 v17                         ║
║   포트: {PROXY_PORT}  /  상태: 실행 중 ✅                   ║
╠══════════════════════════════════════════════════════╣
║  ★ v17: 옥션원 403 수정 (gzip 자동해제 + 헤더 정리)        ║
║  ★ v16: /api/news 엔드포인트 추가 (네이버 뉴스 API)        ║
║  ★ v13: 온비드 URL/서비스명/파라미터 전면 수정 (문서 기준)  ║
║  1. HTML 파일을 브라우저에서 열기 (더블클릭)            ║
║  2-A. 네이버 ⚡방식1: 지역 입력 → 자동 수집 (토큰 불필요) ║
║  2-B. 네이버 방식2: F12 토큰/쿠키 + URL 붙여넣기       ║
║  3. 아싸 / 점포라인: 지역 입력 → 자동 수집             ║
║  4. 소상공인 반경 분석 (건물/상권 탭 제거됨)            ║
║  5. 뉴스 클리핑: GET /api/news?keyword=...&client_id=...║
║  Ctrl+C 로 종료                                      ║
╚══════════════════════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n프록시 서버 종료됨')
