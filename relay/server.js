#!/usr/bin/env node
/**
 * 포켓몬카드모아(PokemonCardMoa) — 집 태블릿 실재고 조회 서버
 * ---------------------------------------------------------------
 * 태블릿(Termux)에서 `node server.js` 한 줄로 실행하는 무의존 단일 파일 서버입니다.
 * 외부 npm 패키지 없이 Node 18+ 내장 모듈(http, crypto, fetch)만 씁니다.
 *
 *   GET  /health    → { ok, service: "pokemoa-relay", version, time }
 *   GET  /api/nearby?lat=36.07&lng=129.39&keyword=포켓몬카드&radius=3000
 *                   → 이마트24 · CU · 세븐일레븐의 점포별 실재고를 모아 돌려줍니다.
 *   GET  /api/diag  → 체인별로 어디까지 됐는지(응답 코드·차단 여부)만 모아 보여 줍니다.
 *   GET  /api/seven?lat=&lng=&q= → 세븐일레븐만 따로(검색어 후보·점포·재고) 확인합니다.
 *   GET  /api/gs25-grid?lat=&lng=&radius=3000&items=바코드,바코드
 *                   → (v2.2) GS25 상품 지정 3km 격자 조회 — 카드가 아닌 피규어 같은 상품도
 *                     점포별 실재고를 17지점 격자로 합쳐 돌려줍니다.
 *   GET  /api/kream-movers → (준비 중 · 501) KREAM 시세를 사이트 「시세·팝수」 탭에 공급하는 자리
 *   GET  /api/pop?q=      → (준비 중 · 501) PSA·BRG 팝수를 공급하는 자리
 *   POST /admin/update    → (어드민 전용 · v2.0) 이 파일을 GitHub main 의 최신 판으로 교체·재시작
 *
 * 실행 예:
 *   node server.js                       # 127.0.0.1:3100
 *   PORT=3100 HOST=0.0.0.0 node server.js # 같은 와이파이의 다른 기기에서도 접속
 *   cloudflared tunnel --url http://127.0.0.1:3100   # 밖에서 쓸 주소 만들기
 *
 * 환경 변수(선택)
 *   PORT / HOST              리슨 포트·주소 (기본 3100 / 127.0.0.1)
 *   RELAY_TIMEOUT_MS         체인별 조회 제한 (기본 8000)
 *   RELAY_CACHE_MS           같은 좌표 응답 캐시 (기본 60000, 0이면 끔)
 *   EMART24_BASE / CU_BASE / SEVEN_BASE   업체 주소가 바뀌었을 때 덮어쓰기
 *   EMART24_COOKIE           이마트24 웹뷰 세션 쿠키(있으면 그대로 사용)
 *   CU_COOKIE                포켓CU 쿠키(지금은 없어도 매장별 수량이 내려옵니다 — 예전 호환용)
 *   GS25_ACCESS_TOKEN        우리동네GS 로그인 access 토큰(재고 조회에 필요)
 *   GS25_REFRESH_TOKEN       우리동네GS refresh 토큰(있으면 만료 시 자동 갱신)
 *   GS25_SESSION_FILE        위 두 토큰·deviceId 를 담은 세션 파일 경로(0600) — 있으면 이 파일을 씁니다
 *   GS25_DEVICE_ID           세션을 만들 때 쓴 기기 ID(파일에 없을 때만)
 *   GS25_RADIUS              GS25 재고 조회 반경(m, 기본 1000 · 앱 기본값과 같게)
 *   SEVEN_AREA               세븐일레븐 점포 검색에 쓸 지역명(예: "포항" — 시/군 이름 하나가 잘 걸립니다)
 *   SEVEN_ITEM_CDS           세븐일레븐에 물어볼 상품 바코드(쉼표 구분, 없으면 자동)
 *   EMART24_AREA             이마트24 공개 매장 API 에 넣을 지역명(비우면 좌표를 주소로 바꿔 자동)
 *   GEO_PROVIDER             주소 찾기 우선순위 (기본 nominatim → bigdatacloud, "off"면 끔)
 *   SEVEN_SM_CD / SEVEN_RSA_KEY_B64   예전 방식(암호화 경로) 수동 지정 — 지금은 쓰지 않음
 *
 * 2026-11-18 개정(v1.1)에서 바뀐 점
 *   · 이마트24: 점포 조회 전에 재고 페이지를 한 번 열어 세션 쿠키를 받아 두고,
 *     실패하면 v2/v3 재고 경로를 차례로 시도합니다. 차단(403/500)이면 그 사실을
 *     sources에 그대로 적어 「재고 0」과 구분합니다.
 *   · CU: 검색어가 '포켓몬'이면 과자(빼빼로)만 잡혀 카드가 0건이었습니다.
 *     '포켓몬카드'로 먼저 찾고 카드 상품만 골라 씁니다(상품 확인은 실제로 됨).
 *     매장별 수량(stock)은 로그인 세션에서만 내려오므로, 없으면 0으로 속이지 않고
 *     note로 알립니다(CU_COOKIE를 주면 수량까지 시도).
 *   · 세븐일레븐: 앱 전용 암호화 경로 대신 공개 경로를 씁니다.
 *     상품 메타 `GET /api/v1/open/product/search/stock?itemCd=바코드`
 *     → 매장별 실재고 `POST /api/v1/open/real-stock/multi/01/stocks`(점포 1곳씩).
 *     상품 코드와 지역명은 실행할 때 자동으로 찾습니다.
 *
 * 2026-11-18 개정(v1.2)에서 바뀐 점 — 세븐일레븐 점포 검색
 *   · 점포 검색 응답이 `SearchQueryResult.Collection[0].Documentset.Document[].field`
 *     안에 들어 있는데 예전 파서가 껍데기(row.storeCd)를 읽어 늘 0건으로 봤습니다.
 *     신세븐일레븐 웹뷰 JS 번들에서 확인한 실제 모양으로 고쳤습니다.
 *   · 지역명을 "포항시 북구"처럼 두 토큰으로 넣으면 0건이 나옵니다. 주소에서 뽑은
 *     후보(포항 → 포항시 → 포항북구 → 북구 → 동 이름)를 차례로 시도하고, 반경 안에
 *     점포가 잡히면 거기서 멈춥니다.
 *   · 재고는 앱이 쓰는 `multi/02/stocks`(점포 1곳 + 상품 여러 개)로 한 번에 받고,
 *     막히면 예전 `multi/01/stocks`(점포×상품)로 돌아갑니다.
 *   · `/api/seven` 으로 세븐일레븐만 따로 확인할 수 있게 했습니다.
 *
 * 2026-11-19 개정(v1.5) — 이마트24 점포 조회 500 제거·지역명 자동 확보
 *   · 이마트24 `POST /store/getNearStoreList` 는 이제 500(또는 차단 403)을 돌려줍니다.
 *     재고조회 화면(mapUtil.js)도 점포 목록을 이 API 가 아니라 앱 브리지에서 받아 옵니다.
 *     즉 이 경로는 사실상 폐기됐습니다. 그래서 점포는 공개 매장 API
 *     `GET https://emart24.co.kr/api1/store?page=N&search=지역명` 을 첫 순서로 씁니다.
 *     예전 폴백은 지역명이 비면 전국 5,690곳을 1~2페이지만 훑어 늘 0곳이었고,
 *     그 지역명을 CU 점포 주소에서만 얻어 CU 응답이 비면(청림동) 500이 그대로 올라갔습니다.
 *     이제 좌표를 역지오코딩(Nominatim→BigDataCloud)해 동/구/시 이름을 만들고,
 *     동→시+구→구→시 순으로 좁게 훑으며, 페이지도 count 에 맞춰 끝까지 읽습니다.
 *   · 재고는 그대로 `GET /api/stock/v3/stock-search/store` 를 씁니다(무로그인, 실측 확인).
 *     수량 행이 하나도 없을 때는 '생수'로 대조 조회를 한 번 해 보고, 그때도 0이면
 *     점포만 알려 주고 0으로 단정하지 않습니다(차단과 품절을 구분).
 *   · 세븐일레븐 지역명도 같은 역지오코딩 결과를 먼저 씁니다(CU 점포 목록이 비어도 동작).
 *   · `GET /api/emart24`, `GET /api/geo` 진단 경로 추가.
 *
 * 2026-11-19 개정(v1.6) — GS25 연동 + CU 매장별 수량 개통
 *   · CU: 앱 점포 조회 `POST /api/store` 에 `jipCd`(상품코드)·`recommendId:"stock"` 을 넣어야
 *     `storeList[].stock` 에 매장별 수량이 실려 옵니다(태블릿 밖에서 실측 확인: 같은 조건에서
 *     이 두 값이 없으면 stock=null, 넣으면 '0'·'12' 같은 실제 수량). 로그인 쿠키는 필요 없습니다.
 *     그래서 이제 CU도 상품별로 점포 수량을 모두 물어 「없음/미조회」를 구분합니다.
 *   · GS25: 상품은 공개 검색 `POST https://b2c-apigw.woodongs.com/search/v3/totalSearch`
 *     (본문 {"query":"…"}, 인증 없음)로 찾고, 매장별 수량은 우리동네GS 앱이 쓰는
 *     `GET https://b2c-bff.woodongs.com/api/bff/v2/store/stock?…&itemCode=바코드&…` 에
 *     정상 네이버 로그인으로 받은 `Authorization: Bearer <GS 토큰>` + `appinfo_*` 헤더를
 *     붙여 받습니다. 토큰이 없으면 401 `인증키가 제공되지 않음` 이므로, 세션이 없을 때는
 *     오류 대신 sources.gs25 = { ok:true, count:0, note:"GS25 로그인 세션(GS25_ACCESS_TOKEN) 필요" }
 *     로 조용히 알립니다.
 *   · 토큰 만료 1분 전이거나 재고가 401/403이면 `POST /api/bff/v4/auth/tokenReissue`
 *     (헤더 `Refresh: <refresh 토큰>`, 본문 없음)로 한 번 갱신하고 재시도합니다.
 *     `GS25_SESSION_FILE` 을 주면 회전된 두 토큰을 같은 파일에 0600으로 되씁니다.
 *   · 새 진단 경로 `GET /api/gs25?...` — 상품 검색·세션 상태·매장별 수량을 한 번에 보여 줍니다.
 *
 * 2026-11-18 개정(v1.3) — 세븐일레븐 재고 경로
 *   · 점포 검색은 v1.2에서 정상 동작(태블릿 실측: 포항 84건·반경 3km 17곳)하지만
 *     재고 경로가 403 `Access Denied: Invalid Access Token or Agent Information` 로 막힙니다.
 *     앱 웹뷰가 UA에 `app:k7app` 표식을 달고 요청하는 점(앱 코드도 이 값으로 앱 안을 판별)을 근거로
 *     재고 호출만 UA 후보 3종을 차례로 시도하고, 통한 UA를 기억합니다.
 *   · UA가 모두 막히면 점포마다 같은 요청을 되풀이하지 않고 한 번에 멈추고 사유를 note 에 남깁니다.
 *
 * 2026-11-19 개정(v1.7) — 3km 안 네 체인을 최대한 빠짐없이
 *   · 응답 점포 상한 MAX_STORES 40 → 200 (지도 마커 상한 180과 맞춤).
 *   · 이마트24: 공개 매장 API 를 페이지 끝까지 읽습니다(예전엔 3페이지·전국 검색어 1페이지에서 끊겨
 *     도심에서 뒤쪽 점포가 통째로 빠졌습니다). 반경 안 후보가 충분히 모이면 다음 검색어는 건너뜁니다.
 *   · CU: 한 번의 `POST /api/store` 가 가까운 순 10곳 안팎만 주므로, 반경 1.5km 이상이면
 *     중심 + 8방위(반경 2km 이상) 격자로 병렬 조회해 매장코드로 합칩니다.
 *     (환호동 3km 실측: 중심 9곳 → 9점 격자 39곳)
 *   · GS25: `radiusCondition` 은 1500 이 상한(2000 부터 엣지가 403)이라 중심 + 8방위 1500m 격자로
 *     조회해 합칩니다. (환호동 3km 실측: 중심 10곳 → 9점 격자 40곳)
 *   · 세븐일레븐: 점포 검색 `POST /api/v1/open/search/store` 가 2026-11-19 저녁부터
 *     `403 Access Denied: Invalid Access Token or Agent Information` 만 돌려줍니다(상품 메타 GET 은 정상).
 *     그래서 앱 웹뷰가 실제로 쓰는 경로 `POST /api/v1/stock/search/stores` 를 씁니다 —
 *     위경도를 앱 공개키(RSA-OAEP SHA-256)로 암호화해 보내면 점포와 실재고가 함께 옵니다.
 *     이 경로도 막히면 예전 점포 검색 경로를 세션 쿠키를 먼저 받아 두고(cookie prime) 재시도하고,
 *     그래도 안 되면 왜 막혔는지 `/api/seven` 의 `strategies` 에 그대로 남깁니다.
 *
 * 2026-11-19 개정(v1.8) — "로딩이 더 걸려도 더 많이" 요청에 맞춘 시간 예산 확대
 *   · 사이트가 응답을 32초까지 기다리므로, 체인별 소프트 마감 23초 · 전체 마감 27초로 늘렸습니다
 *     (예전 18초 안에 맞추려고 6~8초에서 끊던 것을 풀었습니다). 마감 직전에는 새 요청을 시작하지 않고,
 *     이미 나간 요청도 남은 시간만큼만 기다리므로 최악의 경우에도 30초를 넘지 않습니다.
 *   · CU·GS25 격자를 9점(중심 + 8방위 1.5km)에서 **17점(중심 + 내링 8방위 + 외링 8방위)** 로 늘렸습니다.
 *     3km 는 내링 1.1km · 외링 2.2km 라 3km 모서리까지 덮습니다. 동시 요청은 4로 유지해 403/429 를 피합니다.
 *   · 응답 점포 상한 200 → 470(거리순 정렬 후 상한). 지도도 같은 상한을 받습니다.
 *   · 이마트24 페이지 예산 18 → 36회(검색어당 최대 12페이지)로 늘려 도심에서도 끝까지 읽습니다.
 *   · 세븐일레븐은 CU 결과(바코드)를 기다려 시작하므로 남은 시간 안에서만 돌고, 늦으면 부분 결과를 냅니다.
 *
 * 2026-11-20 개정(v1.9) — CU 수량 복구(요청 조절)
 *   · 증상: v1.8 에서 CU 만 "점포는 찾았지만 매장별 수량이 비어 있습니다"(sources.cu.count 0).
 *   · 원인(실측 2026-11-20): CU `POST /api/store` 는 서버 응답 시작(TTFB)이 6.3~6.6초, 완료 6.7~7.1초입니다
 *     (단건·순차·동시 4 모두 같음 = 회선이 아니라 CU 서버 처리 시간). 그런데 v1.8 은 요청마다
 *     `sliceTms(stopAt, 4500)` 으로 4.5초에서 잘라, 37회 전부 AbortError → 빈 배열이 되어
 *     점포도 수량도 통째로 비었습니다. 같은 시각 1km 경로(5회)도 같은 이유로 0곳이었습니다.
 *     요청 본문·헤더·상품 선택은 v1.6 과 같아 되돌릴 payload 회귀는 없습니다.
 *   · 고친 것: ① 요청 타임아웃을 CU_TIMEOUT_MS(기본 12초, 실측 6.5초의 약 1.8배)까지 주되
 *     전체 27초 마감 안에서만 자릅니다.
 *     ② 격자는 17지점 37회 → 최대 5지점(중심 + 동서남북 1.5km) × 중심 상품 2종·격자 1종 = 6회.
 *     ③ 시작 간격 CU_PACE_MS(기본 400ms), 동시성은 1(직렬)로 시작하고, 잰 지연으로 27초 안에 못 끝날
 *        때만 필요한 만큼 올립니다(최대 3). 지연이 낮은 회선에서는 지정대로 직렬로만 돕니다.
 *     실측(같은 좌표): 중심 1지점 9곳 → 5지점 28곳, 5지점 직렬 34.1초(그래서 동시성 보정이 필요합니다).
 *   · GS25(17지점)·이마트24(전체 페이지)·27초 전체 마감은 v1.8 그대로입니다.
 *
 * 2026-11-20 개정(v2.0)에서 바뀐 점 — 어드민 원클릭 자가 업데이트
 *   · 어드민(모아 어드민 웹)이 `POST /admin/update` + `X-Admin-Token` 으로 로그인 토큰을
 *     보내면, 복지모아 서버(`bokjimoa.onrender.com/api/admin/session`)에 그 토큰이 아직
 *     유효한지 물어 통과한 요청만 실행합니다. RELAY_ADMIN_TOKEN 을 지정해 두면 그 키
 *     하나로도 됩니다(복지모아 서버가 잠들었을 때의 대비).
 *   · 내려받는 곳은 아래 UPDATER.sourceUrl **한 곳으로 고정**했습니다. 요청 본문·쿼리로
 *     주소나 셸 명령을 받지 않으므로, 이 서버로 임의 코드를 실행할 길은 없습니다.
 *   · 순서: server.next.js 로 저장 → "pokemoa-relay" 표식 확인 → `node --check` →
 *     server.js 를 server.js.bak 으로 백업 → 교체 → JSON 응답(res.end) → 300ms 뒤
 *     새 프로세스(출력은 server.log) → 기존 프로세스 종료. gs25-session.json 은 건드리지
 *     않습니다(같은 폴더의 파일만 읽습니다).
 *   · 포트가 아직 물려 있으면(EADDRINUSE) 새 프로세스가 250ms 부터 조금씩 늘려 가며
 *     다시 listen 합니다(최대 20회). 기존 프로세스도 server.close() 로 연결을 정리한
 *     뒤에 새 프로세스를 띄우므로 두 프로세스가 포트를 다투지 않습니다.
 *   · v1.9 의 CU 타임아웃 12초·5지점 격자, GS25 gs25-session.json 자동 로드/갱신,
 *     이마트24·세븐일레븐 조회는 그대로입니다(코드 변경 없음).
 *
 * 2026-11-20 개정(v2.1) — 오픈 전 마무리
 *   · 동네 결과 캐시: 좌표 소수점 3자리(~100m)·반경·검색어가 같으면 300초 동안 메모리 값을
 *     그대로 돌려줍니다(cached:true). 같은 동네를 여러 명이 열어도 업체 서버에는 한 번만 묻습니다.
 *   · 과다 요청 방어: 캐시에 없는 요청만 IP당 분당 15회 · 전체 동시 5건으로 제한하고,
 *     넘으면 HTTP 429 + { code: "rate_limited", retryAfterSec: 90 } 로 돌려보냅니다.
 *   · 기본 좌표 제거: lat·lng 를 주지 않으면 400(lat_lng_required). 예전 기본값은 운영자
 *     자택 근처 좌표였습니다. GS25 세션 만료시각 같은 개인 정보도 응답에서 뺐습니다.
 *   · CORS: `*` 대신 https://moa-kr.github.io · http(s)://localhost · 127.0.0.1 만 허용합니다.
 *   · /health: rateLimitedCount · lastRateLimitedAt · errorCount · lastErrorAt · cacheSize 추가
 *     (긴급 감시 스케줄이 이 값을 읽습니다).
 *
 * 2026-11-21 개정(v2.2) — GS25 상품 지정 3km 격자 조회(피규어)
 *   · 새 경로 `GET /api/gs25-grid?lat=&lng=&radius=&items=바코드,바코드`.
 *     v2.1 의 카드 조회(/api/nearby)는 GS25 상품을 카드 상품만 골라 내므로(looksLikeCard),
 *     GS25 팜사이즈 원더 피규어(바코드 6970834313420·6970834313864·6971680453339) 같은
 *     상품은 조회되지 않았습니다. 상품을 바코드로 직접 지정해 받는 경로입니다.
 *   · 좌표 생성은 v1.8 의 3km 격자 로직(ringPlan·ringPoints — 중심 + 내링·외링 8방위 17지점)을
 *     그대로 재사용하고, 격자 지점마다 `radiusCondition` 을 1500(엣지 상한)까지 넓혀
 *     1km 조회보다 빈틈이 적습니다. 점포는 매장코드로 합치고 중심에서 radius 밖은 뺍니다.
 *   · items 를 주지 않으면 피규어 1·2·3탄 바코드를 씁니다. 상품은 최대 6종(GS25_GRID_MAX_ITEMS).
 *   · v2.1 과 같은 캐시(좌표 3자리·반경·바코드 목록, 300초)·레이트리밋(IP 분당 15회·동시 5건)을
 *     적용합니다. 캐시 적중은 세지 않습니다.
 *   · v2.1 의 기존 경로·동작은 바꾸지 않았습니다(gs25StockForItem 은 조회 반경 인자만 선택적으로
 *     받게 했고, 주지 않으면 예전과 똑같이 GS25_RADIUS 를 씁니다).
 *
 * 2026-11-26 개정(v2.3) — 롯데마트·토이저러스 점포별 실시간 재고
 *   · 새 경로 `GET /api/lottemart/stores?area=서울` — 롯데마트 모바일 도와센터
 *     (company.lottemart.com/mobiledowa)가 돌려주는 지역별 매장 목록(코드·이름). 6시간 캐시.
 *   · 새 경로 `GET /api/lottemart/stock?area=서울&market=2302&q=포켓몬&page=1` —
 *     그 점포의 상품명·가격·재고 수량/품절(`11 개` / `품절`). 3분 캐시.
 *   · 왜 중계가 필요한가: 도와센터는 로그인·토큰은 없지만 해외 IP 를 막고(미국 리전 서버에서
 *     연결 타임아웃), 브라우저에서 직접 부르면 CORS 로 막힙니다. 한국 IP 인 이 태블릿이
 *     대신 읽어 사이트에 넘깁니다.
 *   · 이 경로만 따로 분당 90회 제한(RELAY_LOTTE_RATE_LIMIT_PER_MIN). 기존 편의점 조회
 *     제한(분당 15회)과 섞지 않습니다. 캐시 적중은 세지 않습니다.
 *
 * 주의: 이 서버는 조회만 합니다. 주문·결제·선점 같은 쓰기 요청은 없습니다
 *       (자기 파일을 바꾸는 /admin/update 만 예외).
 */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const VERSION = '2.3';
const SERVICE = 'pokemoa-relay';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS || 8000);

/* ── v2.1 동네 결과 캐시 ──
   좌표 소수점 3자리(≈100m)·반경·검색어가 같은 요청은 5분 동안 메모리 값을 그대로 돌려줍니다.
   같은 동네를 여러 사람이 동시에 열어도 업체 서버에는 한 번만 묻습니다(cached:true). */
const CACHE_MS = Number(process.env.RELAY_CACHE_MS || 300000);
const CACHE_MAX = Math.max(20, Number(process.env.RELAY_CACHE_MAX || 200));

/* ── v2.1 과다 요청 방어 ──
   캐시에 없는 요청만 셉니다. IP당 분당 15회, 전체 동시 5건을 넘으면 429 로 돌려보내고
   사이트는 「잠시 후 다시 조회」 안내를 띄웁니다. */
const RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.RELAY_RATE_LIMIT_PER_MIN || 15));
const RATE_WINDOW_MS = 60000;
const MAX_CONCURRENT = Math.max(1, Number(process.env.RELAY_MAX_CONCURRENT || 5));
const RATE_LIMITED_MESSAGE = '현재 이용자가 많아 잠시 대기 중입니다. 약 1~2분 뒤에 다시 조회해 주세요.';

/* ── 자가 업데이트(v2.0) — 어드민 「최신 버전 업데이트」 버튼이 부르는 경로 ──
   내려받는 주소는 이 상수 하나뿐입니다. 요청이 보낸 URL·명령은 절대 쓰지 않습니다. */
const UPDATER = {
  sourceUrl: process.env.RELAY_UPDATE_URL || 'https://raw.githubusercontent.com/moa-kr/pokemoa/main/relay/server.js',
  verifyUrl: process.env.RELAY_ADMIN_VERIFY_URL || 'https://bokjimoa.onrender.com/api/admin/session',
  sharedKey: String(process.env.RELAY_ADMIN_TOKEN || '').trim(),
  marker: 'pokemoa-relay',
  fetchMs: Math.max(3000, Number(process.env.RELAY_UPDATE_FETCH_MS || 20000)),
  verifyMs: Math.max(2000, Number(process.env.RELAY_UPDATE_VERIFY_MS || 12000)),
  minIntervalMs: Math.max(0, Number(process.env.RELAY_UPDATE_MIN_INTERVAL_MS || 60000)),
  restartDelayMs: 300,
  restartDrainMs: 5000
};
const updateGuard = { running: false, lastAt: 0, lastResult: null, fails: 0, failWindowAt: 0 };

const BASE = {
  emart24: process.env.EMART24_BASE || 'https://everse.emart24.co.kr',
  emart24Open: process.env.EMART24_OPEN_BASE || 'https://emart24.co.kr',
  cu: process.env.CU_BASE || 'https://www.pocketcu.co.kr',
  seven: process.env.SEVEN_BASE || 'https://new.7-elevenapp.co.kr',
  gs25Bff: (process.env.GS25_BFF_BASE || 'https://b2c-bff.woodongs.com').replace(/\/+$/, ''),
  gs25Apigw: (process.env.GS25_APIGW_BASE || 'https://b2c-apigw.woodongs.com').replace(/\/+$/, '')
};

/* v2.1 — 기본 좌표를 두지 않습니다. lat·lng 를 주지 않은 요청은 400 으로 돌려보냅니다
   (예전 기본값은 운영자 자택 근처 좌표라 공개 서버에 남길 값이 아니었습니다). */
const DEFAULT_KEYWORD = '포켓몬카드';
const DEFAULT_RADIUS = 3000;   // m — 사이트가 ?radius= 로 덮어쓸 수 있다
const SEVEN_RSA_PUBLIC_KEY =
  process.env.SEVEN_RSA_PUBLIC_KEY ||
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7n9T9y2rflLzbudMjm+PslBSQTGGCPaySE5ayghbr6lRZ4QDA+WTf2SDxjBWh91J7C2NkTQ6FSHHxdFemvHBIKZtACNOBgsQaO7Q0Sh5nrl34XSVrq53hMIHC7OmP98Wqjqdz6c6BQFicyefGZffOtyG4eBjWtu0oAd0/wW902X0sVnzn/g30V6r1IvvE3ov8Nq49W2F7g1goh1IMPtay2lSvc1259vviV1ONOsqyzmrDY+q9kkEW6bXckZH53Soihhgf+bUA36qagV7EbQKorNwNHYyICHZRRxiFem7Y/vlYWIOamJNSdlPHRdl4epAPMHDVvRxGpteNWkVbr3ybQIDAQAB';

const MAX_PRODUCTS = 5;        // 체인당 재고를 물어볼 상품 수 (요청 예산 보호)
const GS25_MAX_ITEMS = (() => {
  const n = Number(process.env.GS25_MAX_ITEMS || 3);      // GS25는 상품 1개당 요청 1번
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.trunc(n))) : 3;
})();
const GS25_RADIUS = Number(process.env.GS25_RADIUS || 1000);       // m — 우리동네GS 앱 기본 반경
const GEO_TTL_MS = 6 * 3600e3; // 좌표→주소 캐시 (같은 동네를 다시 물을 때 외부 호출을 아낀다)
const MAX_STORES = Number(process.env.RELAY_MAX_STORES || 470);    // 응답에 담는 점포 수(4사 합산, 거리순 상한)
const SEVEN_STORE_LIMIT = 40;  // 세븐일레븐 점포 상한(점포 1곳당 요청 1번인 폴백에서만 의미)
const SEVEN_MAX_ITEMS = 4;     // 세븐일레븐에서 점포마다 물어볼 상품 수(02 경로는 한 번에)

/* 격자 조회 설정 — 사이트가 32초까지 기다리므로 GS25 는 요청 수를 넉넉히 두되, 동시 요청은 4로 묶어
   편의점 API 가 단시간 과다 요청으로 403/429 를 걸지 않게 한다. */
/* v1.9 — CU 는 요청 수를 줄이고 시작 간격을 둔다(위 개정 주석 참조).
   CU /api/store 는 서버 처리만 약 6.5초라, 요청 하나의 시간 제한이 그보다 짧으면 수량이 통째로 빈다. */
const CU_CENTER_ITEMS = envClamp('CU_CENTER_ITEMS', 2, 1, 5);        // 중심 지점에서 물어볼 상품 수
const CU_RING_ITEMS = envClamp('CU_RING_ITEMS', 1, 1, 3);            // 격자 지점에서 물어볼 상품 수
const CU_RING_RADIUS_M = envClamp('CU_RING_RADIUS_M', 1500, 1400, 2500); // 격자 지점 거리(1.4km 이상)
const CU_PACE_MS = (() => {
  const n = Number(process.env.CU_PACE_MS);
  return Number.isFinite(n) && n >= 0 ? Math.min(3000, Math.trunc(n)) : 400; // 요청 시작 간격
})();
const CU_MAX_CONCURRENCY = envClamp('CU_MAX_CONCURRENCY', 3, 1, 5);  // 지연이 클 때만 올리는 동시성 상한
const CU_TIMEOUT_MS = envClamp('CU_TIMEOUT_MS', Math.max(TIMEOUT_MS, 12000), 3000, 20000);
const GS25_RING_CONCURRENCY = envClamp('GS25_RING_CONCURRENCY', 4, 1, 8);
/* v2.2 — 피규어 3km 격자. 격자 지점마다 묻는 반경은 1500(엣지 상한)까지 넓혀 빈틈을 줄인다. */
const GS25_GRID_QUERY_RADIUS = envClamp('GS25_GRID_QUERY_RADIUS', 1500, 300, 1500);
const GS25_GRID_MAX_ITEMS = envClamp('GS25_GRID_MAX_ITEMS', 3, 1, 6);
/* items 없이 부를 때 쓰는 기본 상품 — GS25 포켓몬스터 팜사이즈 원더 피규어 1·2·3탄(2026-11-20 출시).
   이름은 우리동네GS 상품 검색이 돌려주는 표기 그대로다(2026-11-21 확인). */
const FIGURE_ITEMS = [
  { code: '6970834313420', name: '퍼니즘)포켓몬스터팜사이즈원더1' },
  { code: '6970834313864', name: '퍼니즘)포켓몬스터팜사이즈원더2' },
  { code: '6971680453339', name: '퍼니즘)포켓몬스터팜사이즈원더3' }
];
const EMART24_MAX_PAGES = Number(process.env.EMART24_MAX_PAGES || 12); // 검색어당 최대 페이지
const EMART24_QUERY_BUDGET = Number(process.env.EMART24_QUERY_BUDGET || 36); // 이마트24 점포 요청 총량

/* v1.8 — 응답 시간 예산. 전체 마감(27초) 안에서 체인은 23초까지만 새 요청을 시작하고,
   마감 1.2초 전부터는 정리에 들어간다. 프론트엔드 요청 타임아웃은 32초다. */
function envClamp(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}
const NEARBY_DEADLINE_MS = envClamp('RELAY_NEARBY_DEADLINE_MS', 27000, 8000, 45000);
const CHAIN_SOFT_DEADLINE_MS = envClamp('RELAY_CHAIN_SOFT_DEADLINE_MS', 23000, 4000, 40000);
const RESPONSE_RESERVE_MS = 1200;   // 마감 직전 정리·직렬화 시간
const MIN_SLICE_MS = 1200;          // 요청 하나에 최소한 주는 시간

/* ------------------------------------------------------------ 공통 도구 */

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 12; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function num(v, fallback) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------- v2.1 요청 보호 · 감시 값 */
/* 좌표는 반드시 요청이 보내야 합니다(기본값 없음). */
function readPoint(url, res) {
  const latRaw = String(url.searchParams.get('lat') ?? '').trim();
  const lngRaw = String(url.searchParams.get('lng') ?? '').trim();
  const lat = Number.parseFloat(latRaw);
  const lng = Number.parseFloat(lngRaw);
  if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJson(res, 400, {
      ok: false,
      code: 'lat_lng_required',
      error: 'lat·lng 좌표가 필요합니다. 예) /api/nearby?lat=37.5665&lng=126.9780&radius=3000'
    });
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    sendJson(res, 400, { ok: false, code: 'lat_lng_range', error: 'lat/lng 범위를 확인해 주세요' });
    return null;
  }
  return { lat, lng };
}

const guard = {
  perIp: new Map(),          /* ip → [요청 시각…] */
  inflight: 0,               /* 지금 돌고 있는 실시간 조회 수 */
  rateLimitedCount: 0,
  lastRateLimitedAt: '',
  errorCount: 0,
  lastErrorAt: ''
};

function clientIp(req) {
  const h = (req && req.headers) || {};
  const cf = String(h['cf-connecting-ip'] || '').trim();
  if (cf) return cf;
  const fwd = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  if (fwd) return fwd;
  return String((req && req.socket && req.socket.remoteAddress) || 'unknown');
}

/* IP 한 곳의 1분 창을 정리하고, 이번 요청을 셀 수 있는지 본다. */
function countRate(ip) {
  const now = Date.now();
  const list = (guard.perIp.get(ip) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT_PER_MIN) {
    guard.perIp.set(ip, list);
    return false;
  }
  list.push(now);
  guard.perIp.set(ip, list);
  if (guard.perIp.size > 5000) {
    /* 오래된 IP 기록이 쌓이지 않게 가끔 청소한다 */
    for (const [key, times] of guard.perIp) {
      if (!times.length || now - times[times.length - 1] > RATE_WINDOW_MS) guard.perIp.delete(key);
      if (guard.perIp.size <= 2000) break;
    }
  }
  return true;
}

function markRateLimited() {
  guard.rateLimitedCount += 1;
  guard.lastRateLimitedAt = new Date().toISOString();
}

function sendRateLimited(res) {
  markRateLimited();
  res.setHeader('retry-after', '90');
  sendJson(res, 429, {
    ok: false,
    code: 'rate_limited',
    retryAfterSec: 90,
    message: RATE_LIMITED_MESSAGE
  });
}

/** 문자열 키를 소문자·기호 제거 형태로 비교하기 위한 도우미 */
function normKey(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 객체에서 후보 키 이름들로 첫 값을 꺼낸다 (응답 스키마가 조금 바뀌어도 견디도록) */
function pick(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
  }
  const lower = {};
  for (const k of Object.keys(obj)) lower[normKey(k)] = obj[k];
  for (const name of names) {
    const v = lower[normKey(name)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** 깊이 중첩된 응답에서도 후보 키의 첫 값을 찾는다 (세븐일레븐 open API 대비) */
function pickDeep(obj, names, depth) {
  if (!obj || typeof obj !== 'object' || (depth || 0) > 6) return undefined;
  if (Array.isArray(obj)) {
    for (const row of obj) {
      const v = pickDeep(row, names, (depth || 0) + 1);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  const own = pick(obj, names);
  if (own !== undefined) return own;
  for (const key of Object.keys(obj)) {
    const v = pickDeep(obj[key], names, (depth || 0) + 1);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** 응답 JSON 안에서 "점포처럼 생긴" 배열을 찾는다 */
function findArrayWith(obj, predicate, depth) {
  if (!obj || typeof obj !== 'object' || (depth || 0) > 5) return null;
  if (Array.isArray(obj)) {
    const hitCount = obj.filter((row) => row && typeof row === 'object' && predicate(row)).length;
    if (hitCount && hitCount * 2 >= obj.length) return obj;
    for (const row of obj) {
      const hit = findArrayWith(row, predicate, (depth || 0) + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(obj)) {
    const hit = findArrayWith(obj[key], predicate, (depth || 0) + 1);
    if (hit) return hit;
  }
  return null;
}

function isStoreLike(row) {
  const f = docField(row) || {};
  const lat = pick(f, ['lat', 'latitude', 'wgs84Lat', 'y', 'latVal', 'LATITUDE', 'storeLat']);
  const lng = pick(f, ['lon', 'lng', 'longitude', 'wgs84Lon', 'x', 'longVal', 'LONGITUDE', 'storeLon']);
  const name = pick(f, ['storeNm', 'storeName', 'store_nm', 'TITLE', 'name', 'nm']);
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !!name;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간 초과(${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 쿠키 병 — 업체가 페이지를 한 번 열어야 세션을 주는 경우가 있어 아주 단순하게만 흉내 낸다 */
function newJar() {
  return { map: new Map() };
}

function jarCookie(jar) {
  if (!jar || !jar.map.size) return null;
  return Array.from(jar.map, ([k, v]) => `${k}=${v}`).join('; ');
}

function jarRemember(jar, res) {
  if (!jar) return;
  try {
    const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of lines) {
      const pair = String(line).split(';')[0];
      const at = pair.indexOf('=');
      if (at > 0) jar.map.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  } catch (err) {
    /* 쿠키를 못 읽어도 조회는 계속한다 */
  }
}

/** HTML 오류 페이지를 사람이 읽을 한 줄로 줄인다 (style·script 내용은 버린다) */
function plainBrief(text) {
  return String(text || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

/** 응답 본문에 섞여 오는 토큰(JWT·Bearer·Refresh 값)을 로그·진단에서 가린다.
    GS25 갱신 실패 응답은 `reqParams.Refresh` 에 refresh 토큰 일부를 되돌려 준다. */
function redactSecrets(text) {
  return String(text || '')
    .replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, 'eyJ…<가림>')
    .replace(
      /("(?:Refresh|refresh|refreshToken|accessToken|token|authorization|Authorization)"\s*:\s*")[^"]*(")/g,
      '$1<가림>$2'
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<가림>');
}

/** 오류 메시지용 한 줄본문 — 토큰을 먼저 가린 뒤 줄인다(가림 전에 잘리면 값이 남는다). */
function briefOf(text) {
  const flat = String(text || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return redactSecrets(flat).slice(0, 90);
}

/**
 * 업체 응답은 HTML 오류 페이지(403 등)일 수 있으므로 본문을 먼저 확인한다.
 * diag를 넘기면 마지막 응답 상태·본문 머리를 그 object에 남긴다.
 */
async function request(url, init, label, jar, diag) {
  const headers = Object.assign({}, (init && init.headers) || {});
  const cookie = jarCookie(jar);
  if (cookie) headers.cookie = cookie;

  const tms = (init && init.tms) || TIMEOUT_MS;
  const opts = Object.assign({}, init, { headers });
  delete opts.tms;
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(tms) }, opts));
  if (process.env.RELAY_DEBUG_HTTP) {
    console.log('[http]', label, res.status, url.slice(0, 150), '| server=' + (res.headers.get('server') || ''), '| cf=' + (res.headers.get('x-amz-cf-id') || ''));
    if (!res.ok && process.env.RELAY_DEBUG_HTTP === '2') console.log('[http-headers]', JSON.stringify([...res.headers]));
  }
  jarRemember(jar, res);
  const text = await res.text();
  if (diag) {
    diag.push({
      label,
      url: url.replace(/\?.*$/, ''),
      status: res.status,
      bytes: text.length,
      head: redactSecrets(text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120)
    });
  }
  if (!res.ok) {
    const brief = briefOf(text);
    const err = new Error(`${label} HTTP ${res.status}${brief ? ' · ' + brief : ''}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    const brief = briefOf(text);
    const e = new Error(`${label} JSON 아님${brief ? ' · ' + brief : ''}`);
    e.upstreamStatus = res.status;
    throw e;
  }
}

const FORM_HEADERS = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'x-requested-with': 'XMLHttpRequest',
  accept: 'application/json, text/javascript, */*; q=0.01',
  'accept-language': 'ko-KR,ko;q=0.9'
};

function formBody(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) sp.set(k, String(v));
  return sp.toString();
}

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/* 격자 조회 지점 — 업체 API 가 한 번에 가까운 몇 곳만 주므로, 중심과 주변 지점을 함께 물어 합친다.
   방향은 위도 기준 각도(북=0, 동=90, 남=180, 서=270)이다.
   v1.8 — 링을 둘로 늘려(내링 + 외링, 각 8방위) 3km 모서리 매장까지 덮는다. */
const DIR_STEPS_8 = [0, 45, 90, 135, 180, 225, 270, 315];
const DIR_STEPS_4 = [0, 90, 180, 270];

function ringPoints(lat, lng, rings) {
  const points = [{ lat, lng, tag: 'center' }];
  for (const ring of rings || []) {
    const offsetM = Number(ring && ring.offsetM);
    if (!(offsetM > 0)) continue;
    const dirs = ring && ring.dirs >= 8 ? 8 : ring && ring.dirs >= 4 ? 4 : 0;
    if (!dirs) continue;
    const dLat = offsetM / 111320;
    const dLng = offsetM / (111320 * Math.cos((lat * Math.PI) / 180));
    const steps = dirs === 8 ? DIR_STEPS_8 : DIR_STEPS_4;
    for (const deg of steps) {
      const rad = (deg * Math.PI) / 180;
      points.push({
        lat: lat + dLat * Math.cos(rad),
        lng: lng + dLng * Math.sin(rad),
        tag: 'ring' + Math.round(offsetM) + ':' + deg
      });
    }
  }
  return points;
}

/** 반경에 맞는 격자 크기 — 3km 이상은 내링·외링 17점.
    3km: 내링 1.1km · 외링 2.2km(요청 반경 1.5km 와 겹쳐 빈틈 없음)
    5km·20km: 내링 1.1km · 외링 2.6km — 기존 9점보다 촘촘하되 요청 수는 17점으로 묶는다. */
function ringPlan(radius, perQueryCoverM) {
  const r = Number(radius) || DEFAULT_RADIUS;
  const cover = Math.max(500, Number(perQueryCoverM) || 1500);
  if (r < 1400) return { rings: [], points: 1 };
  if (r < 2200) return { rings: [{ offsetM: Math.round(Math.min(cover, r * 0.55)), dirs: 8 }], points: 9 };
  const inner = Math.round(Math.min(cover * 0.75, r * 0.37));
  const outer =
    r >= 4200 ? Math.round(Math.min(2600, cover * 1.7)) : Math.round(Math.min(cover * 1.45, r * 0.72));
  return { rings: [{ offsetM: inner, dirs: 8 }, { offsetM: outer, dirs: 8 }], points: 17 };
}

/* v1.8 — 시간 예산 도우미.
   stopAtFor: 체인이 "새 요청을 시작해도 되는" 마지막 시각(체인 소프트 마감과 전체 마감 중 이른 쪽).
   sliceTms:  요청 하나에 줄 시간 — 남은 시간을 넘지 않게 잘라 마감을 넘기는 요청을 만들지 않는다. */
function stopAtFor(deadlineAt, softMs) {
  const hard = Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + NEARBY_DEADLINE_MS;
  const soft = Number(softMs) > 0 ? Number(softMs) : CHAIN_SOFT_DEADLINE_MS;
  return Math.max(Date.now(), Math.min(Date.now() + soft, hard - RESPONSE_RESERVE_MS));
}

function sliceTms(stopAt, cap) {
  const left = stopAt - Date.now();
  const limit = Number(cap) > 0 ? Number(cap) : TIMEOUT_MS;
  return Math.max(MIN_SLICE_MS, Math.min(limit, left));
}

/** 상품명이 포켓몬카드(TCG) 상품인지 — 과자·문구 콜라보와 구분한다 */
function looksLikeCard(name) {
  const s = String(name || '');
  if (/빼빼로|과자|음료|우유|아이스크림|젤리|초콜릿/.test(s)) return false;
  return /카드|card|tcg|확장팩|부스터|celebration|스타터|덱|이브이|피카츄|리자몽|파트너즈/i.test(s);
}

/* --------------------------------------------------- 좌표 → 주소(지역명)
   이마트24 공개 매장 API 와 세븐일레븐 점포 검색은 둘 다 '지역명 글자'가 있어야 하고,
   지역명을 CU 점포 응답에서만 만들면 CU 가 그 상품을 취급하는 점포를 안 줄 때(청림동)
   두 체인이 통째로 빈다. 그래서 좌표를 직접 주소로 바꾸어 동/구/시 이름을 만든다.
   (Nominatim 은 UA 를 요구하고 1초 1회 수준을 지키며, 실패하면 BigDataCloud 로 넘어간다) */
const GEO_CACHE = new Map();

function geoQueries(g) {
  const out = [];
  const push = (raw) => {
    const q = String(raw || '').replace(/\s+/g, ' ').trim();
    if (q.length >= 2 && !out.includes(q)) out.push(q);
  };
  const city = String(g.city || '').trim();
  const district = String(g.district || '').trim();
  const dong = String(g.dong || '').trim();
  const cityBare = city.replace(/(특별시|광역시|특별자치시|특별자치도|도|시|군)$/, '');
  const dongTok = String(dong || '').split(/\s+/).pop() || '';
  const dongBare = dongTok.replace(/(동|읍|면)$/, '');
  /* 좁은 이름부터 — 넓은 이름만 쓰면 옆 동네까지 훑어야 한다 */
  push(dongBare);
  push(dongTok);
  if (cityBare && district) push(cityBare + ' ' + district);
  push(district);
  push(cityBare);
  push(city);
  return out.slice(0, 5);
}

async function reverseGeocode(lat, lng, diag) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  const hit = GEO_CACHE.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return hit.value;

  const out = { source: '', city: '', district: '', dong: '', province: '', address: '', queries: [] };
  const provider = String(process.env.GEO_PROVIDER || 'nominatim').toLowerCase();

  if (provider !== 'off') {
    try {
      const body = await request(
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ko&lat=' +
          encodeURIComponent(lat) +
          '&lon=' +
          encodeURIComponent(lng),
        {
          method: 'GET',
          headers: {
            'user-agent': 'pokemoa-relay/' + VERSION + ' (home-tablet store lookup)',
            accept: 'application/json'
          },
          tms: 4500
        },
        '주소 찾기(Nominatim)',
        null,
        diag
      );
      const a = (body && body.address) || {};
      out.city = a.city || a.town || a.county || a.municipality || '';
      out.district = a.borough || a.city_district || a.county || '';
      out.dong = a.quarter || a.neighbourhood || a.suburb || a.village || a.hamlet || '';
      out.province = a.province || a.state || '';
      out.address = body && body.display_name ? String(body.display_name) : '';
      if (out.city) out.source = 'nominatim';
    } catch (err) {
      /* 아래 대체 제공자로 */
    }
  }

  if (!out.city) {
    try {
      const body = await request(
        'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=ko&latitude=' +
          encodeURIComponent(lat) +
          '&longitude=' +
          encodeURIComponent(lng),
        { method: 'GET', headers: { accept: 'application/json' }, tms: 4000 },
        '주소 찾기(BigDataCloud)',
        null,
        diag
      );
      const admin = (body && body.localityInfo && body.localityInfo.administrative) || [];
      out.city = (body && (body.city || body.locality)) || '';
      out.district =
        admin
          .filter((row) => row && /district|borough|county/i.test(row.adminLevelName || ''))
          .map((row) => row.name)
          .pop() || '';
      out.dong = (body && body.locality) || '';
      out.province = (body && body.principalSubdivision) || '';
      if (out.city) out.source = 'bigdatacloud';
    } catch (err) {
      /* 지역명 없이 진행 — 호출부가 알아서 넘어간다 */
    }
  }

  out.queries = geoQueries(out);
  GEO_CACHE.set(key, { at: Date.now(), value: out });
  if (GEO_CACHE.size > 200) GEO_CACHE.delete(GEO_CACHE.keys().next().value);
  return out;
}

/** 동시 실행 수를 제한하며 매핑한다 (업체 서버를 두드리는 양 조절) */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let index = 0;
  const workers = new Array(Math.min(limit, list.length || 1)).fill(0).map(async () => {
    while (index < list.length) {
      const i = index++;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function uniqBy(list, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/* --------------------------------------------------------- 이마트24 */
/* 점포: POST /store/getNearStoreList (lat, lon, pageCnt, order_by=distance)
   상품: POST /stock/stock/search  → Content-Type에 charset=UTF-8 이 없으면 한글이 0건
   점포별 수량: GET /api/stock/v3/stock-search/store (searchPluCode, bizNoArr)
              → 응답 { storeGoodsQty:[{BIZNO, PLU_CD, BIZQTY}] } (취급 점포만 행이 온다) */

const emart24Jar = newJar();
let emart24Primed = false;

const EMART24_HEADERS = () =>
  Object.assign(
    {
      'user-agent': UA_ANDROID,
      origin: BASE.emart24,
      referer: BASE.emart24 + '/stock/goods/search',
      'accept-language': 'ko-KR,ko;q=0.9'
    },
    FORM_HEADERS
  );

/** 재고 페이지를 한 번 열어 세션 쿠키를 받아 둔다(차단 판정도 여기서 드러난다) */
async function emart24Prime(diag) {
  if (emart24Primed) return;
  emart24Primed = true;
  if (process.env.EMART24_COOKIE) {
    for (const pair of process.env.EMART24_COOKIE.split(';')) {
      const at = pair.indexOf('=');
      if (at > 0) emart24Jar.map.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  try {
    await request(
      BASE.emart24 + '/stock/goods/search',
      { method: 'GET', headers: { 'user-agent': UA_ANDROID, 'accept-language': 'ko-KR,ko;q=0.9' } },
      '이마트24 세션',
      emart24Jar,
      diag
    );
  } catch (err) {
    /* 페이지가 막혀도 API가 열려 있는 경우가 있어 계속 진행한다 */
  }
}

async function emart24Stores(lat, lng, diag) {
  const body = await request(
    BASE.emart24 + '/store/getNearStoreList',
    {
      method: 'POST',
      headers: EMART24_HEADERS(),
      body: formBody({ lat, lon: lng, pageCnt: 50, order_by: 'distance' })
    },
    '이마트24 점포',
    emart24Jar,
    diag
  );
  const rows = findArrayWith(body, isStoreLike) || [];
  return uniqBy(
    rows
      .map((row) => {
        const code = String(pick(row, ['bizNo', 'bizno', 'BIZNO', 'storeCode', 'storeCd', 'CODE', 'smCd']) || '');
        const sLat = num(pick(row, ['lat', 'latitude', 'wgs84Lat', 'LATITUDE', 'y']), NaN);
        const sLng = num(pick(row, ['lon', 'lng', 'longitude', 'wgs84Lon', 'LONGITUDE', 'x']), NaN);
        if (!code || !Number.isFinite(sLat) || !Number.isFinite(sLng)) return null;
        return {
          id: code,
          name: String(pick(row, ['storeNm', 'storeName', 'store_nm', 'TITLE', 'name']) || ''),
          address: String(pick(row, ['storeAddr', 'roadAddr', 'addr', 'ADDRESS', 'address']) || ''),
          lat: sLat,
          lng: sLng,
          tel: String(pick(row, ['tel', 'phone', 'storeTel', 'PHONE']) || '')
        };
      })
      .filter(Boolean),
    (s) => s.id
  );
}

async function emart24Products(keyword, diag, tms) {
  const body = await request(
    BASE.emart24 + '/stock/stock/search',
    {
      method: 'POST',
      headers: EMART24_HEADERS(),
      body: formBody({
        currentPage: 1,
        pageCnt: 40,
        sortType: 'SALE',
        saleProductYn: 'N',
        searchWord: keyword
      }),
      tms: Number(tms) > 0 ? Number(tms) : undefined
    },
    '이마트24 상품',
    emart24Jar,
    diag
  );
  const list = (body && (body.productList || (body.data && body.data.productList))) || [];
  const rows = list
    .map((p) => ({
      code: String(pick(p, ['pluCd', 'PLU_CD', 'plu_cd']) || ''),
      name: String(pick(p, ['goodsNm', 'goodsName', 'GOODS_NM']) || '')
    }))
    .filter((p) => p.code && p.name);
  return rows;
}

/** 상품 1개를 재고 조회 화면에 올리는 준비 호출 — 실패해도 무시한다 */
async function emart24Prepare(plu, diag, tms) {
  try {
    await request(
      BASE.emart24 + '/api/stock/v1/search/keyword',
      {
        method: 'POST',
        headers: EMART24_HEADERS(),
        body: formBody({ pluCd: plu, searchPage: 'STOCK_SEARCH_SERVICE' }),
        tms: Number(tms) > 0 ? Number(tms) : undefined
      },
      '이마트24 준비',
      emart24Jar,
      diag
    );
  } catch (err) {
    /* 준비 호출은 실패해도 본 조회로 넘어간다 */
  }
}

async function emart24StockOne(plu, bizNos, diag, tms) {
  const query = 'searchPluCode=' + encodeURIComponent(plu) + '&bizNoArr=' + encodeURIComponent(bizNos.join(','));
  const headers = {
    'user-agent': UA_ANDROID,
    'x-requested-with': 'XMLHttpRequest',
    accept: 'application/json',
    referer: BASE.emart24 + '/stock/goods/search'
  };
  let body;
  try {
    body = await request(
      BASE.emart24 + '/api/stock/v3/stock-search/store?' + query,
      { method: 'GET', headers, tms: Number(tms) > 0 ? Number(tms) : undefined },
      '이마트24 재고',
      emart24Jar,
      diag
    );
  } catch (err) {
    /* v3가 막히거나 바뀌면 v2로 한 번 더 */
    body = await request(
      BASE.emart24 + '/api/stock/v2/stock-search/store?' + query,
      { method: 'GET', headers, tms: Number(tms) > 0 ? Number(tms) : undefined },
      '이마트24 재고(v2)',
      emart24Jar,
      diag
    );
  }
  /* v2는 본문이 문자열로 한 번 더 감싸져 오는 경우가 있다 */
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      body = {};
    }
  }
  const rows = (body && (body.storeGoodsQty || (body.data && body.data.storeGoodsQty))) || [];
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const biz = String(pick(row, ['BIZNO', 'bizNo', 'bizno']) || '');
    const qty = num(pick(row, ['BIZQTY', 'bizQty', 'qty']), null);
    if (!biz || qty === null) continue;
    out.push({ biz, qty });
  }
  return out;
}

async function collectEmart24(lat, lng, keyword, diag, ctx) {
  /* ① 점포 — 앱 재고 화면 API 는 지금 500/차단이라 공개 매장 API 를 먼저 쓴다.
     (재고조회 화면도 점포 목록을 이 API 가 아니라 앱 브리지에서 받는다 — 사실상 폐기 경로) */
  let stores = [];
  let storeVia = '';
  stores = await emart24StoresPublic(lat, lng, ctx, diag).catch(() => []);
  if (stores.length) storeVia = 'public';
  if (!stores.length) {
    try {
      await emart24Prime(diag);
      stores = await emart24Stores(lat, lng, diag);
      if (stores.length) storeVia = 'everse';
    } catch (err) {
      /* 아래에서 점포 없음으로 정리한다 — 이 실패를 500으로 올리지 않는다 */
    }
  }
  if (!stores.length)
    return {
      stores: [],
      products: [],
      hints: [],
      note: '이마트24 점포를 찾지 못했습니다(공개 매장 API 포함)'
    };

  const keywords = uniqBy([keyword, '포켓몬카드', '포켓몬'], (k) => k).slice(0, 3);
  let products = [];
  /* 점포를 끝까지 읽는 데 시간을 쓴 뒤에는 상품 검색까지하려다 체인 상한에 걸리지 않도록
     남은 시간을 보고 검색어 시도를 줄인다. */
  const productStopAt = stopAtFor(ctx && ctx.deadlineAt, CHAIN_SOFT_DEADLINE_MS - 3000);
  try {
    for (const kw of keywords) {
      if (Date.now() > productStopAt) break;
      products = await emart24Products(kw, diag, sliceTms(productStopAt, 6000));
      const cards = products.filter((p) => looksLikeCard(p.name));
      if (cards.length) {
        products = cards;
        break;
      }
    }
  } catch (err) {
    return {
      stores: [],
      products: [],
      hints: stores,
      note: '이마트24 점포 ' + stores.length + '곳은 찾았지만 상품 검색이 막혔습니다(' + (err.message || '').slice(0, 60) + ')'
    };
  }
  if (!products.length)
    return { stores: [], products: [], hints: stores, note: '이마트24 상품 검색 0건(점포 ' + stores.length + '곳)' };
  products = products.slice(0, MAX_PRODUCTS);

  const nameByCode = {};
  for (const p of products) nameByCode[p.code] = p.name;

  const bizNos = stores.map((s) => s.id);
  const qtyByBiz = new Map();
  let rowCount = 0;
  /* v1.8 — 점포를 끝까지 읽게 되었으므로 수량 조회도 체인 소프트 마감까지 쓴다.
     수량 조회는 점포 목록을 다 읽은 뒤에 시작하므로 마감보다 2초 일찍 끊어 부분 결과를 남긴다. */
  const stopAt = stopAtFor(ctx && ctx.deadlineAt, CHAIN_SOFT_DEADLINE_MS - 2000);
  for (const p of products) {
    if (Date.now() > stopAt) break;
    await emart24Prepare(p.code, diag, sliceTms(stopAt, 5000));
    let rows = [];
    try {
      rows = await emart24StockOne(p.code, bizNos, diag, sliceTms(stopAt, 6000));
    } catch (err) {
      rows = [];
    }
    rowCount += rows.length;
    for (const row of rows) {
      if (!qtyByBiz.has(row.biz)) qtyByBiz.set(row.biz, []);
      qtyByBiz.get(row.biz).push({ code: p.code, qty: row.qty });
    }
  }

  /* 수량 행이 하나도 없으면 '전 지점 품절'인지 'API 가 막힌 것'인지 구분해야 한다.
     상시 취급 품목(생수)으로 한 번 대조 조회를 해 보고, 그때도 0이면 점포만 알려 준다. */
  let verified = rowCount > 0;
  if (!verified) verified = await emart24StockControl(bizNos, diag, stopAt);
  if (!verified)
    return {
      stores: [],
      products,
      hints: stores,
      note: '이마트24 점포 ' + stores.length + '곳은 찾았지만 재고 API 가 수량을 주지 않았습니다(0으로 단정하지 않음)'
    };

  const out = [];
  for (const store of stores) {
    const rows = qtyByBiz.get(store.id) || [];
    /* 검색한 상품의 재고 행이 없는 점포는 '그 상품 0개'로 본다 — 점포를 빼면
       사이트에서 미조회로 보여 실제와 다르게 읽힌다. */
    const byCode = new Map(rows.map((r) => [r.code, r.qty]));
    const items = products.map((p) => ({
      name: nameByCode[p.code] || p.code,
      qty: byCode.has(p.code) ? byCode.get(p.code) : 0,
      code: p.code
    }));
    if (!items.length) continue;
    out.push(Object.assign({}, store, { brand: 'emart24', items }));
  }
  const note =
    '점포 ' + out.length + '곳 재고 확인(' +
    (storeVia === 'public' ? '공개 매장 API' : '앱 매장 API') +
    ' · 응답에 없는 상품은 0)';
  return { stores: out, products, hints: stores, note };
}

/** 재고 API 가 살아 있는지 확인하는 대조 조회 — 상시 취급 품목으로 한 번만(막히면 한 후보 더) */
async function emart24StockControl(bizNos, diag, stopAt) {
  for (const keyword of ['생수', '우유']) {
    if (Number.isFinite(stopAt) && Date.now() > stopAt) return false;
    try {
      const list = await emart24Products(keyword, diag, Number.isFinite(stopAt) ? sliceTms(stopAt, 4000) : undefined);
      const pickOne = list.find((p) => /생수|샘물|삼다수|수\)/.test(p.name)) || list[0];
      if (!pickOne) continue;
      await emart24Prepare(pickOne.code, diag, Number.isFinite(stopAt) ? sliceTms(stopAt, 4000) : undefined);
      const rows = await emart24StockOne(pickOne.code, bizNos, diag, Number.isFinite(stopAt) ? sliceTms(stopAt, 5000) : undefined);
      if (rows.some((r) => Number(r.qty) > 0)) return true;
    } catch (err) {
      /* 다음 후보 — 둘 다 안 되면 '수량 미확인'으로 남긴다 */
    }
  }
  return false;
}

/** 공개 매장 API(emart24.co.kr/api1/store) — 앱 재고 화면(getNearStoreList)이 500/차단일 때 쓴다.
 *  지역명(search)이 없으면 전국 5,690곳을 앞쪽 페이지만 훑어 늘 0곳이 되므로,
 *  호출부에서 반드시 지역명 후보를 만들어 넘긴다.
 *  v1.7 — 예전에는 검색어당 3페이지·전국 검색어 1페이지에서 끊어 도심에서 뒤쪽 점포가 빠졌다.
 *  이제 count 에 맞춰 끝까지 읽되(EMART24_MAX_PAGES), 총 요청량은 EMART24_QUERY_BUDGET 으로 막고,
 *  반경 안 후보가 충분히 모이면 다음 검색어는 건너뛴다. */
async function emart24StoresPublic(lat, lng, ctx, diag) {
  const radius = (ctx && ctx.radius) || DEFAULT_RADIUS;
  const queries = emart24Queries(ctx);
  const byId = new Map();
  let nearCount = 0;
  let budget = Math.max(2, Math.trunc(EMART24_QUERY_BUDGET));
  const stopAt = stopAtFor(ctx && ctx.deadlineAt, CHAIN_SOFT_DEADLINE_MS - 3000);
  /* 상한(470)에 가까운 후보가 모이면 다음 검색어는 건너뛴다 — v1.7 의 60에서 크게 올렸다. */
  const enough = Math.min(200, Math.max(60, Math.round(MAX_STORES * 0.4)));
  const add = (row) => {
    const code = String(pick(row, ['CODE', 'code', 'BIZNO']) || '');
    if (!code || byId.has(code)) return;
    const sLat = num(pick(row, ['LATITUDE', 'latitude', 'lat']), NaN);
    const sLng = num(pick(row, ['LONGITUDE', 'longitude', 'lng']), NaN);
    byId.set(code, row);
    if (Number.isFinite(sLat) && Number.isFinite(sLng) && distanceM(lat, lng, sLat, sLng) <= radius) nearCount++;
  };
  for (const q of queries) {
    if (budget <= 0 || Date.now() > stopAt) break;
    if (nearCount >= enough) break; /* 이미 반경 안 후보가 충분하다 */
    let total = null;
    for (let page = 1; page <= Math.max(1, Math.trunc(EMART24_MAX_PAGES)); page++) {
      if (budget <= 0 || Date.now() > stopAt) break;
      budget--;
      const url =
        BASE.emart24Open + '/api1/store?page=' + page + '&search=' + encodeURIComponent(q);
      let body;
      try {
        body = await request(
          url,
          {
            method: 'GET',
            headers: { 'user-agent': UA_ANDROID, accept: 'application/json' },
            tms: sliceTms(stopAt, 6000)
          },
          '이마트24 공개 매장("' + q + '" ' + page + 'p)',
          null,
          diag
        );
      } catch (err) {
        break; /* 다음 후보 지역명으로 */
      }
      const pageRows = Array.isArray(body && body.data) ? body.data : [];
      if (total === null && body && Number.isFinite(Number(body.count))) total = Number(body.count);
      for (const row of pageRows) add(row);
      if (pageRows.length < 40) break;
      if (total !== null && page * 40 >= total) break;
    }
  }
  return emart24PublicNear(Array.from(byId.values()), lat, lng, radius);
}

/** 공개 매장 행 → 점포 객체 (반경 안·가까운 순) */
function emart24PublicNear(rows, lat, lng, radius) {
  return uniqBy(
    rows
      .map((row) => {
        const code = String(pick(row, ['CODE', 'code', 'BIZNO']) || '');
        const sLat = num(pick(row, ['LATITUDE', 'latitude', 'lat']), NaN);
        const sLng = num(pick(row, ['LONGITUDE', 'longitude', 'lng']), NaN);
        if (!code || !Number.isFinite(sLat) || !Number.isFinite(sLng)) return null;
        const d = distanceM(lat, lng, sLat, sLng);
        if (d > radius) return null;
        const addr = [pick(row, ['ADDRESS']), pick(row, ['ADDRESS_DE'])].filter(Boolean).join(' ').trim();
        return {
          id: code,
          name: String(pick(row, ['TITLE', 'title']) || ''),
          address: addr,
          lat: sLat,
          lng: sLng,
          tel: String(pick(row, ['PHONE', 'phone']) || ''),
          distance: d
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance),
    (s) => s.id
  );
}

/** 이마트24 공개 매장 API 검색어 후보 — 좁은 이름(동)부터 넓은 이름(시) 순 */
function emart24Queries(ctx) {
  const out = [];
  const push = (raw) => {
    const q = String(raw || '').replace(/\s+/g, ' ').trim();
    if (q.length >= 2 && !out.includes(q)) out.push(q);
  };
  if (process.env.EMART24_AREA) push(process.env.EMART24_AREA);
  for (const q of (ctx && ctx.geoQueries) || []) push(q);
  const area = (ctx && ctx.area) || areaFromStores(ctx && ctx.addresses);
  if (area) {
    push(area);
    for (const token of String(area).split(/\s+/)) push(token.replace(/(시|군|구|동|읍|면)$/, ''));
  }
  return out.slice(0, 5);
}

/* --------------------------------------------------------------- CU */
/* 앱 웹뷰 API: 재고 검색 POST /api/search/rest/stock/main,
   좌표 기반 점포 POST /api/store. 앱 식별자(BGFCU) User-Agent가 있어야 응답한다.
   매장별 수량(storeList[].stock)은 `jipCd`(상품코드) + `recommendId:"stock"` 을 함께 넣어야
   내려온다. 이 두 값이 없으면 stock 은 null(미확인)이고, 넣으면 취급 점포마다 '0'·'12' 처럼
   실제 수량이 온다. 로그인 쿠키(CU_COOKIE)는 필요하지 않다 — 2026-11-19 실측. */

const CU_UA =
  'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36;BGFCU';

function cuHeaders() {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json, text/javascript, */*; q=0.01',
    'x-requested-with': 'XMLHttpRequest',
    AJAX: 'true',
    'user-agent': CU_UA,
    origin: BASE.cu,
    referer: BASE.cu + '/search/stock/main'
  };
  if (process.env.CU_COOKIE) h.cookie = process.env.CU_COOKIE;
  return h;
}

async function cuSearchOne(keyword, diag) {
  const body = await request(
    BASE.cu + '/api/search/rest/stock/main',
    {
      method: 'POST',
      headers: cuHeaders(),
      body: JSON.stringify({
        searchWord: keyword,
        prevSearchWord: '',
        spellModifyUseYn: 'Y',
        offset: 0,
        limit: 40,
        searchSort: 'recom'
      })
    },
    'CU 상품',
    null,
    diag
  );
  const rows = (body && body.data && body.data.stockResult && body.data.stockResult.result.rows) || [];
  return rows
    .map((row) => row && row.fields)
    .filter(Boolean)
    .map((f) => ({
      code: String(pick(f, ['item_cd', 'itemCd']) || ''),
      name: String(pick(f, ['item_nm', 'itemNm']) || ''),
      onItemNo: String(pick(f, ['on_item_no', 'onItemNo']) || '')
    }))
    .filter((p) => p.code && p.name);
}

async function cuSearch(keyword, diag) {
  const keywords = uniqBy([keyword, '포켓몬카드', '포켓몬'], (k) => k).slice(0, 3);
  let all = [];
  for (const kw of keywords) {
    let rows = [];
    try {
      rows = await cuSearchOne(kw, diag);
    } catch (err) {
      if (!all.length) throw err;
      break;
    }
    all = all.concat(rows);
    const cards = all.filter((p) => looksLikeCard(p.name));
    if (cards.length >= 3) return uniqBy(cards, (p) => p.code).slice(0, MAX_PRODUCTS);
  }
  const cards = all.filter((p) => looksLikeCard(p.name));
  return uniqBy(cards, (p) => p.code).slice(0, MAX_PRODUCTS);
}

async function cuStoresForItem(lat, lng, item, diag, tms) {
  const payload = {
    latVal: String(lat),
    longVal: String(lng),
    baseLatVal: String(lat),
    baseLongVal: String(lng),
    items: '',
    jipCd: item.code,
    voucher_cd: '',
    exPin: '',
    custId: '',
    isRecommend: 'Y',
    recommendId: 'stock',
    cateTyp: '',
    pageType: 'search_improve stock_sch_improve',
    item_cd: item.code,
    storeCd: '',
    isCoupon: '',
    target: '',
    firstRowNum: '',
    tabId: '2',
    filterSvcList: [],
    filterAdtList: [],
    stockCdcYn: 'N',
    alcProdYn: '',
    searchStock: false,
    pickupType: 'change',
    getRoute: 'IOS',
    areaTplNo: '0',
    itemCd: item.code,
    onItemNo: item.onItemNo || '',
    childMealPickUpYn: 'N',
    onlineType: '',
    searchWord: '',
    distanceLimitYn: 'N',
    stockChkYn: '',
    isCurrentSearch: 'N'
  };
  const body = await request(
    BASE.cu + '/api/store',
    {
      method: 'POST',
      headers: Object.assign(cuHeaders(), { referer: BASE.cu + '/search/stock?isRecommend=Y&item_cd=' + item.code }),
      body: JSON.stringify(payload),
      tms: Math.max(2000, Math.min(CU_TIMEOUT_MS, Number(tms) || CU_TIMEOUT_MS))
    },
    'CU 점포',
    null,
    diag
  );
  const list = (body && body.storeList) || [];
  const out = [];
  for (const raw of list) {
    const sLat = num(pick(raw, ['latVal', 'lat', 'latitude']), NaN);
    const sLng = num(pick(raw, ['longVal', 'lng', 'longitude']), NaN);
    const code = String(pick(raw, ['storeCd', 'storeCode', 'store_cd']) || '');
    if (!code || !Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
    const road = [pick(raw, ['doroStoreAddr1']), pick(raw, ['doroStoreAddr2'])].filter(Boolean).join(' ').trim();
    const jibun = [pick(raw, ['addrFst']), pick(raw, ['addrDetail'])].filter(Boolean).join(' ').trim();
    const qty = num(pick(raw, ['stock', 'stockQty']), null);
    out.push({
      id: code,
      name: String(pick(raw, ['storeNm', 'storeName', 'store_nm']) || ''),
      address: road || jibun,
      lat: sLat,
      lng: sLng,
      tel: String(pick(raw, ['storeTelNo', 'tel']) || ''),
      item: { name: item.name, qty, code: item.code }
    });
  }
  return out;
}

/** CU 요청 하나에 줄 시간 — 전체 마감(27초)을 넘기지 않는 선에서 CU_TIMEOUT_MS 까지.
    v1.8 처럼 4.5초로 자르면 CU(실측 6.5초)가 모두 시간 초과로 버려진다. */
function cuTimeoutFor(hardAt) {
  const hard = Number.isFinite(hardAt) ? hardAt : Date.now() + NEARBY_DEADLINE_MS;
  return Math.max(3000, Math.min(CU_TIMEOUT_MS, hard - Date.now() - 600));
}

async function collectCu(lat, lng, keyword, diag, radius, deadlineAt) {
  const products = await cuSearch(keyword, diag);
  if (!products.length) return { stores: [], products: [], note: '카드 상품 검색 0건' };

  /* 매장별 수량은 로그인 없이도 내려오므로(jipCd + recommendId:"stock") 카드 상품을 물어
     「0으로 확인된 점포」와 「수량 미확인 점포」를 나눈다.
     v1.7 — 한 번의 POST /api/store 는 가까운 순 10곳 안팎만 주므로(환호동 3km 실측: 중심 9곳),
     반경이 1.4km 이상이면 중심 + 주변 격자 지점을 함께 물어 매장코드로 합친다(같은 조건 실측 39곳).
     v1.8 — 9점 → 17점(내링·외링)으로 늘렸으나 요청 타임아웃을 4.5초로 잘라 CU 수량이 통째로 비었다.
     v1.9 — 5지점(중심 + 동서남북, 1.4km 이상) × 중심 2종·격자 1종 = 6회로 줄이고,
             요청 타임아웃은 CU_TIMEOUT_MS(기본 12초)까지, 시작 간격은 CU_PACE_MS(기본 400ms)로 둔다.
             동시성은 1(직렬)로 시작해, 잰 지연으로 마감 안에 못 끝날 때만 필요한 만큼 올린다(최대 3). */
  const targets = products.slice(0, MAX_PRODUCTS);
  const r = Number(radius) || DEFAULT_RADIUS;
  /* 반경 1.4km 미만이면 중심 1지점(한 번의 조회가 가까운 순 9곳 안팎을 준다).
     5km·20km 도 격자는 5지점까지만 — CU 지연(6.5초) 때문에 더 늘리면 마감 안에 못 끝난다. */
  const centers =
    r < 1400
      ? [{ lat, lng, tag: 'center' }]
      : ringPoints(lat, lng, [
          { offsetM: Math.min(CU_RING_RADIUS_M, Math.max(1400, Math.round(r * 0.5))), dirs: 4 }
        ]);
  const jobs = [];
  for (const center of centers) {
    const items =
      center.tag === 'center' ? targets.slice(0, CU_CENTER_ITEMS) : targets.slice(0, CU_RING_ITEMS);
    for (const item of items) jobs.push({ center, item });
  }

  /* CU 응답이 끝나야 세븐일레븐(바코드 공유)이 시작되므로 CU 는 체인 소프트 마감보다 조금 일찍 멈춘다. */
  const stopAt = stopAtFor(deadlineAt, CHAIN_SOFT_DEADLINE_MS - 1500);
  const hardAt = Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + NEARBY_DEADLINE_MS;

  const results = [];
  const latencies = [];
  let cursor = 0;
  let conc = 1;
  let usedConc = 1;
  let skipped = 0;

  while (cursor < jobs.length) {
    if (Date.now() >= stopAt) {
      skipped += jobs.length - cursor;
      break;
    }
    const batch = jobs.slice(cursor, cursor + conc);
    usedConc = Math.max(usedConc, batch.length);
    const wave = await Promise.all(
      batch.map(async (job, i) => {
        if (i) await sleep(CU_PACE_MS * i); /* 시작 간격 — 한꺼번에 몰아 보내지 않는다 */
        if (Date.now() >= hardAt - 4000) return { job, list: [], ms: 0, notSent: true };
        const t0 = Date.now();
        try {
          const list = await cuStoresForItem(job.center.lat, job.center.lng, job.item, diag, cuTimeoutFor(hardAt));
          return { job, list, ms: Date.now() - t0 };
        } catch (err) {
          return { job, list: [], ms: Date.now() - t0, error: (err && err.message) || String(err) };
        }
      })
    );
    for (const row of wave) {
      results.push(row);
      if (row.notSent) skipped++;
      else if (row.ms > 0) latencies.push(row.ms);
    }
    cursor += batch.length;

    /* 남은 요청이 소프트 마감 안에 끝나는 "가장 작은" 동시성을 고른다.
       지연이 낮으면 1(직렬) 그대로, 높으면 최대 CU_MAX_CONCURRENCY 까지. */
    const rest = jobs.length - cursor;
    const left = stopAt - Date.now();
    if (rest > 0 && left > 0 && latencies.length) {
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const projected = (k) => Math.ceil(rest / k) * (avg + CU_PACE_MS * (k - 1));
      let k = 1;
      while (k < CU_MAX_CONCURRENCY && projected(k) > left) k++;
      conc = k;
    }
  }

  const byStore = new Map();
  const hints = [];
  let withQty = 0;
  let withoutQty = 0;
  for (const res of results) {
    for (const row of res.list) {
      hints.push(row);
      if (row.item.qty === null) {
        withoutQty++;
        continue; // 수량 미확인 → 0으로 속이지 않는다
      }
      withQty++;
      const cur = byStore.get(row.id) || Object.assign({}, row, { items: [] });
      const idx = cur.items.findIndex((i) => i.code === row.item.code);
      if (idx >= 0) cur.items[idx] = row.item;
      else cur.items.push(row.item);
      byStore.set(row.id, cur);
    }
  }
  const stores = Array.from(byStore.values()).map((s) => Object.assign(s, { brand: 'cu' }));
  const failed = results.filter((x) => x.error && !x.notSent).length;
  const avgSec = latencies.length
    ? (latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1) + '초 평균'
    : '';
  let note;
  if (withQty) {
    note =
      centers.length > 1
        ? '점포 ' + stores.length + '곳 재고 확인(' + centers.length + '지점 · ' + jobs.length + '회 조회' +
          (usedConc > 1 ? ' · 동시 ' + usedConc : '') +
          (skipped ? ' · 시간 마감으로 ' + skipped + '회 생략' : '') + ')'
        : '';
  } else if (withoutQty) {
    /* 점포는 왔는데 수량 필드가 통째로 빈 경우 — 다음에 원인을 가릴 수 있게 따로 적는다. */
    note =
      'CU 점포 ' + hints.length + '곳이 응답했지만 매장별 수량이 비어 있습니다(수량 ' + jobs.length + '회 조회' +
      (skipped ? ' · 시간 마감으로 ' + skipped + '회 생략' : '') + '). 잠시 뒤 다시 조회하거나 매장에 확인해 주세요.';
  } else if (failed || skipped) {
    note =
      'CU 점포 수량 조회 ' + results.length + '회 중 ' + failed + '회가 응답하지 않았습니다' +
      (avgSec ? '(' + avgSec + ')' : '') +
      (skipped ? ' · 시간 마감으로 ' + skipped + '회 생략' : '') +
      ' — 잠시 뒤 다시 조회해 주세요.';
  } else {
    note = 'CU 점포는 찾았지만 매장별 수량이 비어 있습니다(상품 ' + products.length + '종 확인). 잠시 뒤 다시 조회해 주세요.';
  }
  return { stores, products, hints, note, queries: centers.length, requests: jobs.length, concurrency: usedConc };
}

/* ------------------------------------------------------- 세븐일레븐 */
/* 앱 재고 화면도 웹뷰다. 예전 /api/v1/stock/search/stores 는 좌표를 RSA로 암호화해
   보내야 하지만, 같은 데이터를 주는 공개 경로가 열려 있다.
   (2026-11-18, 신세븐일레븐 웹뷰 JS 번들을 직접 내려받아 확인한 실제 요청·응답 모양)

     ① 상품 메타   GET  /api/v1/open/product/search/stock?itemCd=바코드
                    → { itemCd, itemOnm, smCd, stokMngCd, stokMngQty, stockApplicationRate }
     ② 점포 검색   POST /api/v1/open/search/store
                    body { collection:"store", query:"포항", sort:"Date/desc", listCount:1000 }
                    → { SearchQueryResult: { Collection: [ { Documentset: {
                          totalCount, Document: [ { field: { storeCd, storeNm, storeLat, storeLon,
                                                             realAddr1, realAddr2, … } } ] } } ] } }
                    ※ 점포 한 건은 field 안에 들어 있다(row.storeCd 가 아니다).
                      지역명을 "포항시 북구"처럼 넣으면 0건이 나온다 — 시/군 이름이나
                      동 이름 하나로 넣어야 걸린다. 그래서 아래에서 후보를 차례로 시도한다.
     ③ 점포 한 곳의 여러 상품 재고 POST /api/v1/open/real-stock/multi/02/stocks
                    body { itemList:[ { smCd, stockApplicationRate } ], storeCd, stockGbn:"02" }
                    → { code:200, data:{ itemList:[ { smCd, stock } ] } }
     ④ 점포 한 곳의 상품 하나   POST /api/v1/open/real-stock/multi/01/stocks
                    body { smCd, stokMngCd, stokMngQty, stockApplicationRate, storeList:[점포 1곳] }
                    → { code:200, data:{ storeList:[ { storeCd, stock } ] } }
   로그인·암호화 없이 평문으로 동작한다. */

/* 재고 경로는 게이트웨이가 "Invalid Access Token or Agent Information"(403)으로
   막는다. 앱 웹뷰는 User-Agent 에 app:k7app 표식을 달고 있어서(앱 코드도 이 값을 보고
   앱 안인지 판별한다) 그 표식을 붙인 UA부터 차례로 시도한다. 한 번 통한 UA는 기억한다. */
const SEVEN_UA_VARIANTS = [
  'Mozilla/5.0 (Linux; Android 13; SM-X710 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 app:k7app',
  UA_ANDROID + ' app:k7app',
  /* 앱 패키지명 표식 — 페이지 런타임 설정의 androidPkg 값(확인 2026-11-19) */
  UA_ANDROID + ' app:kr.co.kork7app',
  UA_ANDROID
];
let sevenUaIndex = 0;

function sevenHeaders(extra, uaIndex) {
  return Object.assign(
    {
      accept: 'application/json',
      'user-agent': SEVEN_UA_VARIANTS[uaIndex == null ? sevenUaIndex : uaIndex] || UA_ANDROID,
      origin: BASE.seven,
      referer: BASE.seven + '/',
      'accept-language': 'ko-KR,ko;q=0.9'
    },
    extra || {}
  );
}

/** 검색엔진 응답의 한 건은 { field: { … } } 로 감싸여 온다 — 벗겨서 쓴다 */
function docField(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.field && typeof row.field === 'object') return row.field;
  if (row.fields && typeof row.fields === 'object') return row.fields;
  return row;
}

/** 재고 경로 POST — UA 후보를 차례로 시도하고, 한 번 통한 UA를 기억한다 */
async function sevenStockPost(path, payload, label, diag) {
  let lastErr = null;
  for (let i = sevenUaIndex; i < SEVEN_UA_VARIANTS.length; i++) {
    try {
      const body = await request(
        BASE.seven + path,
        {
          method: 'POST',
          headers: sevenHeaders({ 'content-type': 'application/json; charset=UTF-8' }, i),
          body: JSON.stringify(payload)
        },
        label + (i ? ' UA' + (i + 1) : ' UA1'),
        null,
        diag
      );
      sevenUaIndex = i;
      return body;
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || '');
      /* UA 문제로 보이는 403만 다음 후보로 넘어간다(그 밖의 오류는 그대로 올린다) */
      const agentIssue = /Access Token|Agent Information/i.test(msg) || (err && err.upstreamStatus === 403);
      if (!agentIssue || i + 1 >= SEVEN_UA_VARIANTS.length) throw err;
    }
  }
  throw lastErr || new Error(label + ' 실패');
}

/* ---------- 앱 실제 경로: 위경도를 RSA-OAEP(SHA-256)로 암호화해 점포+실재고를 한 번에 받는다 ----------
   2026-11-19 저녁부터 공개 점포 검색(/api/v1/open/search/store)이
   `403 Access Denied: Invalid Access Token or Agent Information` 만 돌려줘(상품 메타 GET 은 200)
   점포 목록을 받을 길이 막혔다. 앱 웹뷰가 실제로 쓰는 경로는 접두사 없는
   `POST /api/v1/stock/search/stores` 이고, 본문의 myLat/myLng 만 앱 설정에 박혀 있는
   공개키(rsaPublicKey)로 암호화하면 점포별 실재고(realStock)가 함께 온다.
   공개키는 공개 값이고(페이지 런타임 설정), 좌표만 암호화하므로 로그인은 필요 없다. */
const sevenJar = newJar();
const sevenPrimeState = { at: 0, status: '', html: false };
const sevenRsaState = { blockedUntil: 0 };
const sevenGate = { blockedUntil: 0 };

function sevenPublicKeyPem() {
  const b64 = String(SEVEN_RSA_PUBLIC_KEY || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (b64.length < 200) return '';
  const lines = b64.match(/.{1,64}/g) || [];
  return '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----\n';
}

/** 좌표(문자열) 1개를 RSA-OAEP-SHA256 → base64 ( 앱 번들의 encryptRSA 와 같은 방식 ) */
function sevenRsaEncrypt(value) {
  const pem = sevenPublicKeyPem();
  if (!pem) return '';
  try {
    return crypto
      .publicEncrypt(
        { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(String(value), 'utf8')
      )
      .toString('base64');
  } catch (err) {
    return '';
  }
}

/** 앱 페이지를 한 번 열어 세션 쿠키(incap_ses·visid_incap·WMONID 등)를 받아 둔다(30분 캐시) */
async function sevenPrime(diag) {
  if (Date.now() - sevenPrimeState.at < 30 * 60e3) return sevenPrimeState;
  sevenPrimeState.at = Date.now();
  try {
    await request(
      BASE.seven + '/',
      {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'user-agent': SEVEN_UA_VARIANTS[0],
          'accept-language': 'ko-KR,ko;q=0.9'
        },
        tms: 5000
      },
      '세븐일레븐 세션',
      sevenJar,
      diag
    );
    sevenPrimeState.status = 'ok';
  } catch (err) {
    sevenPrimeState.status = 'fail · ' + briefOf((err && err.message) || '');
  }
  sevenPrimeState.html = sevenJar.map.size > 0;
  return sevenPrimeState;
}

/** 점포처럼 생긴 행을 평평하게 — 응답이 { store: {...}, realStock } 처럼 감싸 오는 경우가 있다 */
function sevenFlatRow(row) {
  if (!row || typeof row !== 'object') return {};
  const f = docField(row) || {};
  const inner = f.store || f.storeInfo || f.shop || f.strInfo;
  return inner && typeof inner === 'object' ? Object.assign({}, inner, f) : f;
}

/** 앱 경로 응답에서 점포·재고 행 배열을 찾는다(이름이 조금 달라도 견디게) */
function sevenRsaRows(body) {
  const looksStore = (row) => {
    const f = sevenFlatRow(row);
    const code = pick(f, ['storeCd', 'storeCode', 'store_cd', 'strCd', 'shopCd', 'storeNo']);
    return !!code;
  };
  const rows = findArrayWith(body, looksStore) || [];
  if (rows.length) return rows;
  /* findArrayWith 는 점포 비율이 절반 이상인 배열만 고른다 — 섞여 있으면 직접 훑는다 */
  const out = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      for (const row of node) {
        if (looksStore(row)) out.push(row);
        else walk(row, depth + 1);
      }
      return;
    }
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(body, 0);
  return out;
}

/** 앱 경로 1회 — 상품 하나의 점포별 실재고 */
async function sevenStoresByRsa(lat, lng, metas, radius, diag, strategies, deadlineAt) {
  const encLat = sevenRsaEncrypt(lat);
  const encLng = sevenRsaEncrypt(lng);
  if (!encLat || !encLng) {
    strategies.push({ step: 'rsa', ok: false, note: '공개키 없음' });
    return { stores: [], note: 'RSA 공개키가 없습니다' };
  }
  /* 한 번 모두 거절당하면 10분간 다시 두드리지 않는다(같은 응답을 반복하는 것은 예의가 아니다). */
  if (Date.now() < sevenRsaState.blockedUntil) {
    strategies.push({ step: 'rsa', ok: false, note: '최근 거절 — 잠시 건너뜀' });
    return { stores: [], note: 'RSA 경로가 최근에 거절됐습니다' };
  }
  const results = await mapLimit(metas, 2, async (meta) => {
    try {
      const body = await request(
        BASE.seven + '/api/v1/stock/search/stores',
        {
          method: 'POST',
          headers: sevenHeaders({ 'content-type': 'application/json; charset=UTF-8' }),
          body: JSON.stringify({
            searchType: 'list',
            myLat: encLat,
            myLng: encLng,
            order: 'stock',
            smCd: meta.smCd,
            stockApplicationRate: meta.stockApplicationRate,
            stokMngCd: meta.stokMngCd,
            stokMngQty: meta.stokMngQty,
            ignoreRateYn: 'Y'
          }),
          tms: Number.isFinite(deadlineAt) ? sliceTms(deadlineAt, 4500) : 4500
        },
        '세븐일레븐 앱 재고(RSA)',
        sevenJar,
        diag
      );
      const rows = sevenRsaRows(body);
      strategies.push({ step: 'rsa', ok: true, smCd: meta.smCd, rows: rows.length });
      return { meta, rows };
    } catch (err) {
      strategies.push({ step: 'rsa', ok: false, smCd: meta.smCd, note: String((err && err.message) || '').slice(0, 120) });
      return { meta, rows: [] };
    }
  });

  const byStore = new Map();
  let noCoord = 0;
  for (const { meta, rows } of results) {
    for (const raw of rows) {
      const f = sevenFlatRow(raw);
      const code = String(pick(f, ['storeCd', 'storeCode', 'store_cd', 'strCd', 'shopCd', 'storeNo']) || '');
      if (!code) continue;
      const sLat = num(pick(f, ['storeLat', 'storeYCoordination', 'latitude', 'lat', 'yCoord', 'wgs84Lat', 'y']), NaN);
      const sLng = num(pick(f, ['storeLon', 'storeXCoordination', 'longitude', 'lng', 'xCoord', 'wgs84Lon', 'x']), NaN);
      if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) {
        noCoord++;
        continue;
      }
      const distance = distanceM(lat, lng, sLat, sLng);
      if (Number.isFinite(radius) && distance > radius) continue;
      const qtyRaw = pick(f, ['realStock', 'realStockQty', 'stock', 'stockQty', 'goodsStock', 'stockCnt', 'qty']);
      const qty = qtyRaw === undefined || qtyRaw === null || qtyRaw === '' ? null : Number(qtyRaw);
      if (qty === null || !Number.isFinite(qty)) continue;
      const addr = [pick(f, ['realAddr1', 'storeAddr', 'addr1', 'roadAddr', 'storeAddress']), pick(f, ['realAddr2', 'addr2', 'addrDetail'])]
        .filter(Boolean)
        .join(' ')
        .trim();
      const cur =
        byStore.get(code) ||
        {
          id: code,
          brand: 'seven',
          name: String(pick(f, ['storeNm', 'storeName', 'store_nm', 'strNm', 'shopNm']) || ''),
          address: addr,
          lat: sLat,
          lng: sLng,
          distance,
          items: []
        };
      if (!cur.items.some((i) => i.code === meta.smCd)) {
        cur.items.push({ name: meta.name, code: meta.smCd, qty });
      }
      byStore.set(code, cur);
    }
  }
  const stores = Array.from(byStore.values()).sort((a, b) => a.distance - b.distance).slice(0, SEVEN_STORE_LIMIT);
  const attempts = strategies.filter((s) => s.step === 'rsa');
  if (attempts.length && attempts.every((s) => !s.ok)) sevenRsaState.blockedUntil = Date.now() + 10 * 60e3;
  const note = noCoord ? '좌표가 없는 행 ' + noCoord + '건은 지도에 올릴 수 없어 제외' : '';
  return { stores, note };
}

async function sevenItemMeta(itemCd, diag) {
  const body = await request(
    BASE.seven + '/api/v1/open/product/search/stock?itemCd=' + encodeURIComponent(itemCd),
    { method: 'GET', headers: sevenHeaders(), tms: 4000 },
    '세븐일레븐 상품 메타',
    null,
    diag
  );
  const smCd = pickDeep(body, ['smCd', 'sm_cd']);
  const stokMngCd = pickDeep(body, ['stokMngCd', 'stok_mng_cd', 'stockMngCd']);
  const stokMngQty = pickDeep(body, ['stokMngQty', 'stok_mng_qty', 'stockMngQty']);
  const rate = pickDeep(body, ['stockApplicationRate', 'stock_application_rate']);
  if (!smCd) return null;
  return {
    itemCd,
    smCd: String(smCd),
    stokMngCd: String(stokMngCd || smCd),
    stokMngQty: Number(stokMngQty || 1) || 1,
    stockApplicationRate: String(rate || '100'),
    name: String(pickDeep(body, ['goodsNm', 'goodsNmKor', 'productNm', 'itemNm', 'smNm', 'itemOnm']) || itemCd)
  };
}

/** 점포 검색 한 번 — 응답에서 점포 문서 배열과 전체 건수를 꺼낸다 */
async function sevenStoreSearch(query, diag) {
  /* UA 후보를 차례로 — 게이트가 "Agent Information" 을 문제 삼을 때 표식을 하나씩 바꿔 본다.
     한 번 통한 UA 는 기억하고(sevenUaIndex), 모두 막히면 err.gate 로 알린다. */
  let lastErr = null;
  let body = null;
  for (let i = sevenUaIndex; i < SEVEN_UA_VARIANTS.length; i++) {
    try {
      body = await request(
        BASE.seven + '/api/v1/open/search/store',
        {
          method: 'POST',
          headers: sevenHeaders(
            {
              'content-type': 'application/json; charset=UTF-8',
              'sec-fetch-site': 'same-origin',
              'sec-fetch-mode': 'cors'
            },
            i
          ),
          body: JSON.stringify({ collection: 'store', query, sort: 'Date/desc', listCount: 1000 }),
          tms: 4500
        },
        '세븐일레븐 점포 UA' + (i + 1),
        sevenJar,
        diag
      );
      sevenUaIndex = i;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String((err && err.message) || '');
      const agentIssue = /Access Token|Agent Information/i.test(msg) || (err && err.upstreamStatus === 403);
      if (!agentIssue || i + 1 >= SEVEN_UA_VARIANTS.length) {
        if (/Access Token|Agent Information/i.test(msg)) err.gate = true;
        throw err;
      }
    }
  }
  if (!body) throw lastErr || new Error('세븐일레븐 점포 실패');

  const docs = [];
  const sq = pickDeep(body, ['SearchQueryResult']);
  const collections = sq && sq.Collection ? [].concat(sq.Collection) : [];
  for (const col of collections) {
    const ds = col && (col.Documentset || col.DocumentSet);
    if (!ds) continue;
    const rows = ds.Document || ds.Documents || [];
    if (Array.isArray(rows)) docs.push(...rows);
  }
  const total = num(pickDeep(body, ['totalCount']), docs.length);

  const stores = uniqBy(
    (docs.length ? docs : findArrayWith(body, isStoreLike) || [])
      .map((row) => {
        const f = docField(row);
        if (!f) return null;
        const code = String(pick(f, ['storeCd', 'storeCode', 'store_cd', 'storeNo']) || '');
        const sLat = num(pick(f, ['storeLat', 'lat', 'latitude', 'wgs84Lat', 'y', 'latVal']), NaN);
        const sLng = num(pick(f, ['storeLon', 'lon', 'lng', 'longitude', 'wgs84Lon', 'x', 'longVal']), NaN);
        if (!code) return null;
        const addr = [pick(f, ['realAddr1', 'addr', 'address', 'storeAddr', 'roadAddr']), pick(f, ['realAddr2', 'addrDetail'])]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          id: code,
          name: String(pick(f, ['storeNm', 'storeName', 'store_nm', 'name']) || ''),
          address: addr,
          lat: sLat,
          lng: sLng
        };
      })
      .filter(Boolean),
    (s) => s.id
  );

  return { stores, docs: (docs.length ? docs : []).length, total };
}

/** 점포 검색어 후보 — 역지오코딩 결과(동·구·시)를 먼저, 그다음 주소 문자열에서 뽑는다 */
function sevenAreaQueries(ctx) {
  const sources = []
    .concat((ctx && ctx.geoQueries) || [], ctx && ctx.addresses ? ctx.addresses : [], (ctx && ctx.area) || '')
    .filter(Boolean);
  const out = [];
  const push = (raw) => {
    const q = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length >= 2 && q.replace(/\s/g, '').length >= 2 && !out.includes(q)) out.push(q);
  };
  for (const src of sources) {
    const t = String(src).split(/\s+/).filter(Boolean);
    const PROVINCE_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;
    const province =
      t.find((x) => /(특별시|광역시|특별자치시|특별자치도|도)$/.test(x)) ||
      (t[0] && PROVINCE_RE.test(t[0]) ? t[0].slice(0, 2) : '');
    const city = t.find((x) => x !== province && /(시|군)$/.test(x)) || '';
    const district = t.find((x) => x !== city && x !== province && /(구|군)$/.test(x)) || '';
    const dong = t.find((x) => /(동|읍|면)$/.test(x)) || '';
    const cityBare = city.replace(/(시|군)$/, '');
    const dongBare = dong.replace(/(동|읍|면)$/, '');
    const provinceBare = province.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
    const before = out.length;
    /* 좁은 이름부터 — 반경 안에 점포가 잡히면 거기서 멈춘다(호출부) */
    push(dongBare);
    push(dong);
    push(cityBare);
    push(city);
    push(cityBare + district);
    push(district);
    push(provinceBare);
    push(province);
    /* "포항"·"강남"처럼 시/군/구/동 꼬리표가 없는 이름은 그대로 쓴다 */
    if (out.length === before) {
      push(src);
      for (const token of t) push(token);
    }
  }
  return out.slice(0, 5);
}

/** 점포 한 곳의 여러 상품 재고 (앱이 쓰는 02 경로) — 실패하면 null */
async function sevenRealStocksByStore(storeCd, metas, diag) {
  const body = await sevenStockPost(
    '/api/v1/open/real-stock/multi/02/stocks',
    {
      itemList: metas.map((m) => ({ smCd: m.smCd, stockApplicationRate: m.stockApplicationRate })),
      storeCd,
      stockGbn: '02'
    },
    '세븐일레븐 재고(02)',
    diag
  );
  const rows = pickDeep(body, ['itemList']);
  if (!Array.isArray(rows)) return null;
  const out = new Map();
  for (const row of rows) {
    const f = docField(row);
    const smCd = String(pick(f, ['smCd', 'sm_cd']) || '');
    const qty = num(pick(f, ['stock', 'realStock', 'stokMngQty', 'stockQty', 'qty']), null);
    if (smCd && qty !== null) out.set(smCd, qty);
  }
  /* 200 OK + itemList: [] 는 "그 상품 재고가 없다"는 정상 응답이다.
     빈 Map 을 그대로 돌려 주어 점포를 0(없음)으로 표시할 수 있게 한다. */
  return out;
}

/** 점포 한 곳의 상품 하나 재고 (01 경로) — 02가 막혔을 때 쓴다 */
async function sevenRealStock(storeCd, meta, diag) {
  const body = await sevenStockPost(
    '/api/v1/open/real-stock/multi/01/stocks',
    {
      smCd: meta.smCd,
      stokMngCd: meta.stokMngCd,
      stokMngQty: meta.stokMngQty,
      stockApplicationRate: meta.stockApplicationRate,
      storeList: [storeCd]
    },
    '세븐일레븐 재고(01)',
    diag
  );
  const qty = pickDeep(body, ['stock', 'realStock', 'stokMngQty', 'stockQty', 'qty', 'realStockQty']);
  return qty === undefined ? null : num(qty, null);
}

async function collectSeven(lat, lng, ctx, diag) {
  const strategies = [];
  const queries = sevenAreaQueries(ctx);
  /* v1.8 — 세븐일레븐은 CU 결과(바코드) 뒤에 시작해 늦을 수 있다. 남은 전체 시간 안에서만 돌고,
     시간이 없으면 부분 결과를 낸다. */
  const stopAt = stopAtFor(ctx && ctx.deadlineAt, CHAIN_SOFT_DEADLINE_MS);

  /* 상품 바코드는 CU 검색 결과(공용 바코드)를 먼저 쓰고, 없으면 환경변수 */
  let itemCodes = String(process.env.SEVEN_ITEM_CDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!itemCodes.length) itemCodes = (ctx.barcodes || []).slice(0, MAX_PRODUCTS);
  if (!itemCodes.length) return { stores: [], products: [], queries: [], strategies, note: '상품 바코드를 찾지 못했습니다' };

  const found = await mapLimit(itemCodes.slice(0, SEVEN_MAX_ITEMS), 3, async (code) => {
    try {
      return await sevenItemMeta(code, diag);
    } catch (err) {
      return null; /* 상품 하나가 실패해도 나머지를 계속 본다 */
    }
  });
  const metas = found.filter(Boolean);
  if (!metas.length)
    return {
      stores: [],
      products: [],
      queries: queries.map((q) => ({ query: q, ok: null, note: '상품 메타를 받지 못해 시도하지 않음' })),
      strategies,
      note: '상품 메타(smCd)를 받지 못했습니다 (앱 상품이 아니거나 차단)'
    };

  /* ① 앱이 실제로 쓰는 경로 — 좌표를 RSA 로 암호화해 점포와 실재고를 한 번에 받는다.
     공개 점포 검색이 403 게이트에 막혀도 이 길은 열려 있을 수 있다. */
  const rsa = await sevenStoresByRsa(lat, lng, metas, ctx.radius, diag, strategies, stopAt);
  if (rsa.stores.length) {
    return {
      stores: rsa.stores,
      products: metas,
      queries: [{ query: '(앱 경로 · RSA 좌표)', ok: true, stores: rsa.stores.length }],
      strategies,
      note: '점포 ' + rsa.stores.length + '곳 재고 확인(앱 재고 경로)' + (rsa.note ? ' · ' + rsa.note : '')
    };
  }

  /* ② 공개 점포 검색 + 점포별 재고 — 세션 쿠키를 먼저 받아 두고 시도한다 */
  if (!queries.length)
    return {
      stores: [],
      products: metas,
      queries: [],
      strategies,
      note:
        (rsa.note ? rsa.note + ' · ' : '') +
        '지역명을 찾지 못해 세븐일레븐 점포 검색을 건너뜁니다(SEVEN_AREA로 지정 가능)'
    };
  const primed = await sevenPrime(diag);
  strategies.push({ step: 'prime', ok: primed.status === 'ok', cookies: sevenJar.map.size, note: primed.status });
  if (Date.now() < sevenGate.blockedUntil) {
    strategies.push({ step: 'store-search', ok: false, note: '최근 게이트 거절 — 10분간 건너뜀' });
    return {
      stores: [],
      products: metas,
      queries: [],
      strategies,
      note:
        '세븐일레븐 점포 검색이 앱 토큰을 요구해 막혔습니다(403) — 잠시 뒤 다시 시도합니다' +
        (rsa.note ? ' · ' + rsa.note : '')
    };
  }

  /* 검색어 후보를 차례로 — 반경 안에 점포가 잡히면 거기서 멈춘다 */
  const report = [];
  let candidates = [];
  const searchDeadline = Math.min(Date.now() + 6000, stopAt);
  for (const query of queries) {
    if (Date.now() > searchDeadline) {
      report.push({ query, ok: false, error: '시간 안에 시도하지 못함' });
      break;
    }
    let res;
    try {
      res = await sevenStoreSearch(query, diag);
    } catch (err) {
      report.push({ query, ok: false, error: (err && err.message || '').slice(0, 120) });
      if (err && err.gate) {
        sevenGate.blockedUntil = Date.now() + 10 * 60e3;
        break;
      }
      continue;
    }
    const near = res.stores
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => Object.assign({}, s, { distanceM: distanceM(lat, lng, s.lat, s.lng) }))
      .filter((s) => s.distanceM <= ctx.radius);
    report.push({ query, ok: true, total: res.total, stores: res.stores.length, inRadius: near.length });
    candidates = candidates.concat(near);
    if (near.length) break;
  }
  strategies.push({
    step: 'store-search',
    ok: report.some((r) => r.ok && r.inRadius),
    tried: report.map((r) => r.query).join(','),
    note: report.map((r) => (r.ok ? r.total + '건' : (r.error || '실패').slice(0, 60))).join(' · ').slice(0, 200)
  });

  candidates = uniqBy(
    candidates.sort((a, b) => a.distanceM - b.distanceM),
    (s) => s.id
  ).slice(0, SEVEN_STORE_LIMIT);

  if (!candidates.length) {
    const tried = report.map((r) => '"' + r.query + '" ' + (r.ok ? r.total + '건' : '실패')).join(' · ');
    return {
      stores: [],
      products: metas,
      queries: report,
      strategies,
      note: '세븐일레븐 점포 검색 0곳 (' + tried + ')' + (rsa.note ? ' · ' + rsa.note : '')
    };
  }

  const nameByCode = {};
  for (const m of metas) nameByCode[m.smCd] = m.name;

  /* 02가 한 번 막히면 이후 점포는 01로. UA 후보까지 모두 막히면(게이트웨이 403)
     점포마다 같은 요청을 되풀이하지 않고 한 번에 멈춘다(요청 예산·응답 시간 보호). */
  const mode = { batch: true, blocked: false, lastError: '' };
  const storeStockDeadline = Math.min(Date.now() + 8000, stopAt);
  const built = await mapLimit(candidates, 3, async (store) => {
    if (mode.blocked || Date.now() > storeStockDeadline) return null;
    const items = [];
    let byStore = null;
    if (mode.batch) {
      try {
        byStore = await sevenRealStocksByStore(store.id, metas, diag);
      } catch (err) {
        mode.batch = false;
        const msg = String((err && err.message) || '');
        if (/Access Token|Agent Information/i.test(msg)) {
          mode.blocked = true;
          mode.lastError = msg.slice(0, 120);
          return null;
        }
      }
    }
    if (byStore) {
      /* 응답이 왔으면 목록에 없는 상품은 0으로 본다 — 점포를 「없음」으로 남기기 위해서다. */
      for (const meta of metas) {
        const qty = byStore.has(meta.smCd) ? byStore.get(meta.smCd) : 0;
        if (qty === null) continue;
        items.push({ name: nameByCode[meta.smCd] || meta.smCd, qty, code: meta.smCd });
      }
    } else {
      for (const meta of metas) {
        let qty = null;
        try {
          qty = await sevenRealStock(store.id, meta, diag);
        } catch (err) {
          /* 점포 하나·상품 하나 실패는 건너뛴다 */
        }
        if (qty === null) continue;
        items.push({ name: nameByCode[meta.smCd] || meta.smCd, qty, code: meta.smCd });
      }
    }
    if (!items.length) return null;
    return {
      id: store.id,
      brand: 'seven',
      name: store.name,
      address: store.address,
      lat: store.lat,
      lng: store.lng,
      items
    };
  });
  const out = built.filter(Boolean);
  let note = '';
  if (!out.length) {
    note = '점포 ' + candidates.length + '곳은 찾았지만 재고 응답을 받지 못했습니다';
    if (mode.lastError) note += ' (' + mode.lastError + ')';
  } else {
    note = '점포 ' + out.length + '곳 재고 확인(응답에 없는 상품은 0)';
  }
  return { stores: out, products: metas, queries: report, strategies, note };
}

/* ------------------------------------------------------------- GS25 */
/* 우리동네GS 앱이 재고를 볼 때 쓰는 두 경로.

   ① 상품 찾기(인증 없음)  POST https://b2c-apigw.woodongs.com/search/v3/totalSearch
                            본문 {"query":"포켓몬카드"}
        → SearchQueryResult.Collection[] 중 `offlineItem` 에 편의점 판매 상품이 옵니다
          (field.itemCode=바코드, itemName="포켓몬카드)닌자스피너", sellPrice).
   ② 매장별 수량(로그인 필요) GET https://b2c-bff.woodongs.com/api/bff/v2/store/stock
        serviceCode=01, realTimeStockYn=Y, itemCode=바코드,
        myPosition/centerPosition X·Y 좌표, radiusCondition(앱 기본 1000m), pickupStoreYn=N …
        헤더 Authorization: Bearer <GS access 토큰> + appinfo_* + request_id
        → { stores:[ { storeCode, storeName, storeAddress, storeX/YCoordination,
                       realStockQuantity, searchItemName, searchItemSellPrice, … } ] }
        토큰이 없거나 만료면 401 { "인증키가 제공되지 않음" }.
   ③ 토큰 갱신           POST https://b2c-bff.woodongs.com/api/bff/v4/auth/tokenReissue
        헤더 `Refresh: <refresh 토큰>` + 같은 appinfo_*, 본문 없음
        → { resultCode:"0000", data:{ access, refresh } } (두 토큰이 함께 교체된다)

   토큰은 정상 네이버 로그인으로 받은 GS 토큰입니다(네이버 토큰을 그대로 쓰는 것이 아님).
   발급 절차는 relay/GS25-로그인-안내.md 에 적어 두었습니다. */

const GS25_APP = {
  version: process.env.GS25_APP_VERSION || '5.3.61',
  build: process.env.GS25_APP_BUILD || '2132',
  model: process.env.GS25_APP_MODEL || 'sdk_gphone64_arm64',
  os: process.env.GS25_APP_OS || '14'
};

const gs25Session = {
  loaded: false,
  access: '',
  refresh: '',
  deviceId: '',
  accessExp: 0,
  refreshExp: 0,
  source: '',           // 'file' | 'env' | ''
  revoked: false,
  lastError: '',
  refreshing: null,
  refreshedAt: 0
};

/** JWT의 exp(ms). 형식이 아니면 0 — 서명 검증은 하지 않는다(GS 응답이 최종 판정). */
function jwtExpMs(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return 0;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = Number(JSON.parse(json).exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch (err) {
    return 0;
  }
}

function gs25ApplySession(access, refresh, deviceId, source) {
  gs25Session.access = String(access || '').replace(/^Bearer\s+/i, '').trim();
  gs25Session.refresh = String(refresh || '').replace(/^Bearer\s+/i, '').trim();
  gs25Session.deviceId = String(deviceId || '').trim() || gs25Session.deviceId || crypto.randomUUID();
  gs25Session.accessExp = jwtExpMs(gs25Session.access);
  gs25Session.refreshExp = jwtExpMs(gs25Session.refresh);
  gs25Session.source = source;
  gs25Session.revoked = false;
}

/** 세션 파일 길잡이 — 환경 변수가 없으면 server.js 옆의 gs25-session.json 을 찾는다. */
function gs25SessionPath() {
  const env = String(process.env.GS25_SESSION_FILE || '').trim();
  if (env) return env;
  try {
    const guess = path.join(__dirname, 'gs25-session.json');
    if (fs.existsSync(guess)) return guess;
  } catch (err) {
    /* 무시 */
  }
  return '';
}

function gs25Load() {
  if (gs25Session.loaded) return gs25Session;
  gs25Session.loaded = true;
  const file = gs25SessionPath();
  if (file) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      if (data && (data.accessToken || data.access) && (data.refreshToken || data.refresh)) {
        gs25ApplySession(
          data.accessToken || data.access,
          data.refreshToken || data.refresh,
          data.deviceId,
          'file'
        );
        return gs25Session;
      }
    } catch (err) {
      /* 파일이 없거나 깨졌으면 환경 변수로 넘어간다 */
    }
  }
  if (process.env.GS25_ACCESS_TOKEN) {
    gs25ApplySession(
      process.env.GS25_ACCESS_TOKEN,
      process.env.GS25_REFRESH_TOKEN || '',
      process.env.GS25_DEVICE_ID || '',
      'env'
    );
  }
  return gs25Session;
}

/** 회전된 토큰을 세션 파일에 다시 쓴다(같은 폴더 임시 파일 → rename, 0600). */
function gs25SaveSession() {
  const file = gs25SessionPath();
  if (!file || gs25Session.source !== 'file') return;
  const body = JSON.stringify({
    accessToken: gs25Session.access,
    refreshToken: gs25Session.refresh,
    deviceId: gs25Session.deviceId
  });
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (e2) {
      /* 무시 */
    }
    console.error('[gs25] 세션 파일 저장 실패:', (err && err.message) || err);
  }
}

function gs25Headers(extra) {
  const s = gs25Session;
  return Object.assign(
    {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': `woodongs-app/${GS25_APP.version} (Android; ${GS25_APP.os}; ${GS25_APP.model})`,
      'accept-language': 'ko-KR,ko;q=0.9',
      request_id: crypto.randomUUID(),
      appinfo_device_id: s.deviceId || crypto.randomUUID(),
      appinfo_model_name: GS25_APP.model,
      appinfo_os_version: GS25_APP.os,
      appinfo_app_version: GS25_APP.version,
      appinfo_app_build_number: GS25_APP.build,
      appinfo_os_type: 'android'
    },
    extra || {}
  );
}

/** access가 만료(1분 여유)됐거나 force면 refresh로 한 번 갱신한다. 동시 갱신은 하나로 합친다. */
async function gs25Ready(force, diag) {
  gs25Load();
  if (!gs25Session.access) {
    throw new Error('GS25 로그인 세션(GS25_ACCESS_TOKEN) 필요');
  }
  const fresh = gs25Session.accessExp && gs25Session.accessExp - Date.now() > 60000;
  if (!force && fresh) return gs25Session;
  if (gs25Session.revoked) throw new Error('GS25 토큰이 거절됐습니다 — 다시 로그인해 주세요');
  if (!gs25Session.refresh) {
    if (fresh) return gs25Session;
    throw new Error('GS25 access 토큰이 만료됐고 refresh 토큰이 없습니다 — 다시 로그인해 주세요');
  }
  if (gs25Session.refreshing) return gs25Session.refreshing;

  gs25Session.refreshing = (async () => {
    let body;
    try {
      body = await request(
        BASE.gs25Bff + '/api/bff/v4/auth/tokenReissue',
        { method: 'POST', headers: gs25Headers({ Refresh: gs25Session.refresh }) },
        'GS25 토큰 갱신',
        null,
        diag
      );
    } catch (err) {
      if (err && (err.upstreamStatus === 401 || err.upstreamStatus === 403)) {
        gs25Session.revoked = true;
        gs25Session.lastError = 'refresh 토큰이 거절됐습니다';
        throw new Error('GS25 로그인 세션이 만료됐습니다 — 다시 로그인해 세션을 발급해 주세요');
      }
      throw err;
    }
    const data = (body && body.data) || {};
    if (!body || body.resultCode !== '0000' || !data.access || !data.refresh) {
      gs25Session.revoked = true;
      gs25Session.lastError = 'resultCode=' + ((body && body.resultCode) || '?');
      throw new Error('GS25 토큰 갱신 응답이 올바르지 않습니다');
    }
    gs25ApplySession(data.access, data.refresh, gs25Session.deviceId, gs25Session.source);
    gs25Session.refreshedAt = Date.now();
    gs25SaveSession();
    return gs25Session;
  })()
    .catch((err) => {
      gs25Session.lastError = ((err && err.message) || String(err)).slice(0, 160);
      throw err;
    })
    .finally(() => {
      gs25Session.refreshing = null;
    });
  return gs25Session.refreshing;
}

/** ① 상품 검색 — 인증 없이 열려 있다. 편의점 판매 카드 상품만 추린다. */
async function gs25Search(keyword, diag) {
  const body = await request(
    BASE.gs25Apigw + '/search/v3/totalSearch',
    {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'accept-language': 'ko-KR,ko;q=0.9',
        origin: 'https://woodongs.com',
        referer: 'https://woodongs.com/',
        'user-agent':
          'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36'
      },
      body: JSON.stringify({ query: keyword })
    },
    'GS25 상품 검색',
    null,
    diag
  );

  const collections = (body && body.SearchQueryResult && body.SearchQueryResult.Collection) || [];
  const rows = [];
  for (const col of collections) {
    const docs = (col && col.Documentset && col.Documentset.Document) || [];
    for (const doc of docs) {
      const f = doc && doc.field;
      if (!f || !f.itemCode) continue;
      const name = String(f.itemName || f.itemNameSp || f.indItemNm || '').trim();
      if (!name) continue;
      rows.push({
        code: String(f.itemCode),
        name,
        price: num(f.sellPrice, null),
        collection: String(col.CollectionId || ''),
        stockCheck: String(f.stockCheckYn || '').toUpperCase() === 'Y'
      });
    }
  }

  /* 편의점에서 파는 포켓몬 카드만 — 교통카드(이즐·캐시비)·문구 콜라보는 뺀다. */
  const cards = rows.filter(
    (r) =>
      !/이즐|교통카드|캐시비|빼빼로|과자|음료|우유|아이스크림|젤리|초콜릿/.test(r.name) &&
      (/포켓몬\s*카드|포켓몬.*카드/i.test(r.name) || looksLikeCard(r.name))
  );

  /* 30주년 상품 → 포켓몬카드) 라인 → 나머지 순으로 앞세운다(앞의 것부터 재고를 묻는다). */
  const rank = (r) => (/(30\s*주년|celebration)/i.test(r.name) ? 0 : /^포켓몬\s*카드/.test(r.name) ? 1 : 2);
  return uniqBy(
    cards.sort((a, b) => rank(a) - rank(b)),
    (r) => r.code
  );
}

/** CloudFront 가 "Request blocked" 로 끊은 응답 — 토큰 문제가 아니라 일시 차단이다. */
function gs25Blocked(err) {
  const m = String((err && err.message) || '');
  return /Request could not be satisfied|Request blocked|cloudfront/i.test(m);
}

/** ② 매장별 수량 — 401/403이면 토큰을 한 번 갱신해 다시 시도한다. */
async function gs25StockOnce(url, diag, tms) {
  const session = await gs25Ready(false, diag);
  const t = Math.max(2000, Math.min(TIMEOUT_MS, Number(tms) || TIMEOUT_MS));
  const call = (token, label) =>
    request(
      url,
      { method: 'GET', headers: gs25Headers({ authorization: 'Bearer ' + token }), tms: t },
      label,
      null,
      diag
    );

  let first;
  try {
    first = await call(session.access, 'GS25 재고');
  } catch (err) {
    if (gs25Blocked(err)) {
      /* 아주 짧게 쉬었다 한 번만 더 — 반복하면 차단이 길어진다. */
      await new Promise((r) => setTimeout(r, 800));
      try {
        return await call(session.access, 'GS25 재고(차단 후 재시도)');
      } catch (err2) {
        if (gs25Blocked(err2)) {
          throw new Error('GS25 재고 요청이 잠시 차단됐습니다(CloudFront) — 조금 뒤 다시 시도해 주세요');
        }
        throw err2;
      }
    }
    const status = err && err.upstreamStatus;
    if (status !== 401 && status !== 403) throw err;
    const next = await gs25Ready(true, diag);
    try {
      return await call(next.access, 'GS25 재고(재시도)');
    } catch (err2) {
      if (gs25Blocked(err2)) {
        throw new Error('GS25 재고 요청이 잠시 차단됐습니다(CloudFront) — 조금 뒤 다시 시도해 주세요');
      }
      if (err2 && (err2.upstreamStatus === 401 || err2.upstreamStatus === 403)) {
        gs25Session.revoked = true;
        gs25Session.lastError = 'GS25 재고 401/403 — 로그인 세션을 다시 발급해 주세요';
      }
      throw err2;
    }
  }
  return first;
}

async function gs25StockForItem(lat, lng, item, radius, diag, tms, queryRadiusM) {
  /* 엣지가 radiusCondition 2000 이상인 요청을 403으로 끊는다(500·1000·1500은 통과, 2000부터 차단 — 2026-11-19 실측).
     앱 기본값도 1000이라 그 값을 쓴다. 지도 반경(radius)은 결과를 거르는 데만 쓴다.
     v2.2 — 격자 조회는 queryRadiusM 으로 1500까지 넓혀 빈틈을 줄인다(주지 않으면 예전과 같다). */
  const baseR = Number.isFinite(Number(queryRadiusM)) && Number(queryRadiusM) > 0 ? Number(queryRadiusM) : GS25_RADIUS;
  const r = Math.max(300, Math.min(1500, baseR || 1000));
  const params = new URLSearchParams({
    serviceCode: '01',
    realTimeStockYn: 'Y',
    itemCode: item.code,
    myPositionYCoordination: String(lat),
    centerPositionYCoordination: String(lat),
    myPositionXCoordination: String(lng),
    centerPositionXCoordination: String(lng),
    radiusCondition: String(r),
    pickupStoreYn: 'N',
    isSuperDlvyStoreSelected: 'N',
    isGs25DlvyStoreSelected: 'N'
  });
  const body = await gs25StockOnce(BASE.gs25Bff + '/api/bff/v2/store/stock?' + params.toString(), diag, tms);
  const rows = (body && body.stores) || [];
  const out = [];
  for (const raw of rows) {
    if (!raw) continue;
    const sLat = num(pick(raw, ['storeYCoordination', 'latitude', 'y']), NaN);
    const sLng = num(pick(raw, ['storeXCoordination', 'longitude', 'x']), NaN);
    const code = String(pick(raw, ['storeCode', 'shopCode']) || '');
    if (!code || !Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
    const qtyRaw = pick(raw, ['realStockQuantity', 'realStockQty']);
    const qty = qtyRaw === undefined || qtyRaw === null || qtyRaw === '' ? null : Number(qtyRaw);
    /* 수량이 비어 있으면 「미확인」 — 0으로 속이지 않고 점포도 넣지 않는다 */
    if (qty === null || !Number.isFinite(qty)) continue;
    out.push({
      id: code,
      name: String(pick(raw, ['storeName', 'shopName']) || ''),
      address: String(pick(raw, ['storeAddress', 'address']) || ''),
      lat: sLat,
      lng: sLng,
      tel: String(pick(raw, ['storeTelephoneNumber', 'tel']) || ''),
      item: { name: item.name, qty, code: item.code }
    });
  }
  return out;
}

async function collectGs25(lat, lng, keyword, radius, diag, deadlineAt) {
  gs25Load();
  if (!gs25Session.access) {
    /* 세션이 아직 없으면 오류가 아니라 「아직 연동 전」으로 조용히 알린다(사이트 UI 유지). */
    return {
      stores: [],
      products: [],
      note: 'GS25 로그인 세션(GS25_ACCESS_TOKEN) 필요',
      sessionNeeded: true
    };
  }

  const products = await gs25Search(keyword, diag);
  if (!products.length) return { stores: [], products: [], note: 'GS25 카드 상품 검색 0건' };

  const targets = products.slice(0, GS25_MAX_ITEMS);
  /* v1.7 — radiusCondition 은 1500 이 상한(2000 부터 403)이라 반경 3km 를 한 번에 덮지 못한다.
     중심 + 주변 격자 지점(각 1.5km)을 함께 조회해 매장코드로 합친다.
     (환호동 3km 실측: 중심 10곳 → 9점 격자 40곳)
     v1.8 — 9점 → 17점(내링 1.1km · 외링 2.2km). 격자당 상품 3종이라 51회를 동시 4로 나눠 돈다. */
  const plan = ringPlan(radius || GS25_RADIUS, 1500);
  const centers = ringPoints(lat, lng, plan.rings);
  const jobs = [];
  for (const center of centers) for (const item of targets) jobs.push({ center, item });
  const stopAt = stopAtFor(deadlineAt, CHAIN_SOFT_DEADLINE_MS);
  let skipped = 0;
  let lists;
  try {
    lists = await mapLimit(jobs, Math.max(1, Math.trunc(GS25_RING_CONCURRENCY)), async (job) => {
      if (Date.now() > stopAt) {
        skipped++;
        return [];
      }
      try {
        return await gs25StockForItem(job.center.lat, job.center.lng, job.item, radius, diag, sliceTms(stopAt, 4000));
      } catch (err) {
        if (err && (err.upstreamStatus === 401 || err.upstreamStatus === 403)) throw err;
        if (gs25Session.revoked) throw err;   // 세션 만료 사유를 note 로 올리기 위해
        return [];
      }
    });
  } catch (err) {
    /* 토큰 거절·응답 오류는 점포 0 + 사유로 돌려준다(화면을 비우지 않는다) */
    return {
      stores: [],
      products: targets,
      note: 'GS25 재고를 받지 못했습니다 — ' + ((err && err.message) || String(err)).slice(0, 120)
    };
  }

  const byStore = new Map();
  for (const list of lists) {
    for (const row of list) {
      const cur = byStore.get(row.id) || Object.assign({}, row, { items: [], brand: 'gs25' });
      const idx = cur.items.findIndex((i) => i.code === row.item.code);
      if (idx >= 0) cur.items[idx] = row.item;
      else cur.items.push(row.item);
      byStore.set(row.id, cur);
    }
  }

  const stores = Array.from(byStore.values());
  const note = stores.length
    ? centers.length > 1
      ? '점포 ' + stores.length + '곳 재고 확인(' + centers.length + '지점 격자 조회 · 반경 1.5km 단위' +
        (skipped ? ' · 시간 마감으로 ' + skipped + '회 생략' : '') + ')'
      : ''
    : 'GS25 점포 재고 응답이 비었습니다(상품 ' + targets.length + '종 · ' + centers.length + '지점 조회 · 반경 ' +
      Math.round(Math.max(300, Math.min(1500, Number(GS25_RADIUS) || 1000))) +
      'm). 반경 안에 재고가 잡힌 점포가 없을 수 있습니다.';
  return { stores, products: targets, note, queries: centers.length };
}

/* ── v2.2 GS25 상품 지정 3km 격자 ──
   카드 상품 검색(looksLikeCard)을 거치지 않고, 요청이 준 바코드를 그대로 물어봅니다.
   좌표는 collectGs25 와 같은 ringPlan·ringPoints(3km = 내링 1.1km · 외링 2.2km 17지점)를 씁니다. */
function parseGridItems(raw) {
  const known = new Map(FIGURE_ITEMS.map((it) => [it.code, it.name]));
  const codes = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9]{6,14}$/.test(s));
  const list = codes.length ? codes : FIGURE_ITEMS.map((it) => it.code);
  return uniqBy(list, (c) => c)
    .slice(0, GS25_GRID_MAX_ITEMS)
    .map((code) => ({ code, name: known.get(code) || '상품 ' + code }));
}

async function collectGs25Grid(lat, lng, items, radius, diag, deadlineAt) {
  gs25Load();
  if (!gs25Session.access) {
    return {
      stores: [],
      items,
      summary: [],
      points: 0,
      queries: 0,
      note: 'GS25 로그인 세션(GS25_ACCESS_TOKEN) 필요',
      sessionNeeded: true
    };
  }

  const plan = ringPlan(radius || DEFAULT_RADIUS, GS25_GRID_QUERY_RADIUS);
  const centers = ringPoints(lat, lng, plan.rings);
  const jobs = [];
  for (const center of centers) for (const item of items) jobs.push({ center, item });
  const stopAt = stopAtFor(deadlineAt, CHAIN_SOFT_DEADLINE_MS);
  let skipped = 0;
  let lists;
  try {
    lists = await mapLimit(jobs, Math.max(1, Math.trunc(GS25_RING_CONCURRENCY)), async (job) => {
      if (Date.now() > stopAt) {
        skipped++;
        return [];
      }
      try {
        return await gs25StockForItem(
          job.center.lat,
          job.center.lng,
          job.item,
          radius,
          diag,
          sliceTms(stopAt, 4000),
          GS25_GRID_QUERY_RADIUS
        );
      } catch (err) {
        if (err && (err.upstreamStatus === 401 || err.upstreamStatus === 403)) throw err;
        if (gs25Session.revoked) throw err;   // 세션 만료 사유를 note 로 올리기 위해
        return [];
      }
    });
  } catch (err) {
    return {
      stores: [],
      items,
      summary: [],
      points: centers.length,
      queries: jobs.length,
      note: 'GS25 재고를 받지 못했습니다 — ' + ((err && err.message) || String(err)).slice(0, 120),
      failed: true
    };
  }

  const byStore = new Map();
  for (const list of lists) {
    for (const row of list) {
      const cur = byStore.get(row.id) || Object.assign({}, row, { items: [], brand: 'gs25' });
      const idx = cur.items.findIndex((i) => i.code === row.item.code);
      if (idx >= 0) cur.items[idx] = row.item;
      else cur.items.push(row.item);
      byStore.set(row.id, cur);
    }
  }

  /* 격자 지점끼리 겹쳐 잡힌 점포가 반경 밖일 수 있으므로 중심에서 radius 로 한 번 더 거른다 */
  const maxM = Math.max(300, Number(radius) || DEFAULT_RADIUS);
  const stores = Array.from(byStore.values())
    .filter((s) => distanceM(lat, lng, s.lat, s.lng) <= maxM)
    .sort((a, b) => distanceM(lat, lng, a.lat, a.lng) - distanceM(lat, lng, b.lat, b.lng));

  const summary = items.map((it) => {
    let storesWithStock = 0;
    let qty = 0;
    for (const s of stores) {
      const hit = (s.items || []).find((i) => i.code === it.code);
      if (!hit) continue;
      const n = Number(hit.qty);
      if (Number.isFinite(n) && n > 0) {
        storesWithStock += 1;
        qty += n;
      }
    }
    return { code: it.code, name: it.name, storesWithStock, qty };
  });

  const note = stores.length
    ? '점포 ' + stores.length + '곳 재고 확인(' + centers.length + '지점 격자 조회 · 상품 ' + items.length + '종' +
      (skipped ? ' · 시간 마감으로 ' + skipped + '회 생략' : '') + ')'
    : 'GS25 점포 재고 응답이 비었습니다(상품 ' + items.length + '종 · ' + centers.length + '지점 조회 · 반경 ' +
      Math.round(maxM) + 'm). 반경 안에 재고가 잡힌 점포가 없을 수 있습니다.';
  return { stores, items, summary, points: centers.length, queries: jobs.length, skipped, note };
}

/* --------------------------------------------------------- 결과 조립 */

function mergeStores(stores, lat, lng, nowIso) {
  const out = [];
  for (const s of stores) {
    const distance = distanceM(lat, lng, s.lat, s.lng);
    const twin = out.find(
      (o) => o.brand === s.brand && distanceM(o.lat, o.lng, s.lat, s.lng) < 60
    );
    if (twin) {
      for (const item of s.items || []) if (!twin.items.some((i) => i.code === item.code)) twin.items.push(item);
      continue;
    }
    const items = (s.items || []).filter((i) => Number.isFinite(Number(i.qty)));
    /* 수량 0으로 확인된 점포도 남긴다(빈 items 만 버린다) */
    if (!items.length) continue;
    out.push({
      id: `${s.brand}-${s.id}`,
      brand: s.brand,
      name: s.name,
      address: s.address || '',
      lat: s.lat,
      lng: s.lng,
      distanceM: distance,
      status: items.some((i) => Number(i.qty) > 0) ? 'in_stock' : 'out_of_stock',
      items: items.map((i) => ({ name: i.name, code: String(i.code), qty: Number(i.qty) })),
      updatedAt: nowIso
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out.slice(0, MAX_STORES);
}

/** 점포 주소에서 세븐일레븐 점포검색에 쓸 지역명을 뽑는다 ("경북 포항시 북구 …" → "포항시 북구") */
function areaFromStores(stores) {
  for (const s of stores || []) {
    if (!s) continue;
    const addr = String(s.address || '').trim();
    if (!addr) continue;
    const tokens = addr.split(/\s+/).filter(Boolean);
    if (tokens.length >= 3) return tokens[1] + ' ' + tokens[2];
    if (tokens.length >= 2) return tokens[1];
  }
  return '';
}

const cache = new Map();

/* 좌표 소수점 3자리(≈100m) · 반경 · 검색어 — 같은 자리·같은 조건이면 같은 결과 */
function cacheKey(lat, lng, keyword, radius) {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)},${radius},${keyword}`;
}

/* v2.2 — 피규어 격자용 키. 같은 키가 카드 조회 캐시와 섞이지 않게 앞에 grid| 를 붙인다. */
function gridCacheKey(lat, lng, items, radius) {
  return `grid|${Number(lat).toFixed(3)},${Number(lng).toFixed(3)},${radius},${items.map((i) => i.code).join(',')}`;
}

function cacheRead(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheWrite(key, value) {
  cache.set(key, { at: Date.now(), value });
  /* 오래된 것부터 버린다(키 삽입 순서 = 저장 순서) */
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function cachePrune() {
  const now = Date.now();
  for (const [key, hit] of cache) {
    if (now - hit.at >= CACHE_MS) cache.delete(key);
  }
}
setInterval(cachePrune, 60000).unref();

async function runChain(name, task, diag, hardMs) {
  try {
    const budget = Number(hardMs) > 0 ? Number(hardMs) : TIMEOUT_MS + 6000;
    const value = await withTimeout(task(), budget, name);
    return { ok: true, value: value || { stores: [], products: [], note: '' } };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    return {
      ok: false,
      error: msg.slice(0, 200),
      upstreamStatus: err && err.upstreamStatus ? err.upstreamStatus : undefined,
      value: { stores: [], products: [], note: '' }
    };
  }
}

async function nearby(lat, lng, keyword, radius) {
  const key = cacheKey(lat, lng, keyword, radius);
  const hit = cacheRead(key);
  if (hit) return Object.assign({}, hit, { cached: true });

  const nowIso = new Date().toISOString();
  const diag = { emart24: [], cu: [], seven: [], gs25: [], geo: [] };

  /* v1.8 — 전체 마감(기본 27초)을 먼저 정해 두고 모든 체인에 전달한다.
     좌표→주소는 이마트24·세븐일레븐에만 필요하므로 **기다리지 않고 동시에 출발**시켜,
     역지오코딩이 느린 날에도 CU·GS25 시간을 깎지 않는다. */
  const deadlineAt = Date.now() + NEARBY_DEADLINE_MS;
  /* 체인 하나에 걸어 둘 상한 — 전체 마감을 넘기지 않게 남은 시간으로만 잡는다(최소 1.2초). */
  const remaining = () => Math.max(MIN_SLICE_MS, deadlineAt - Date.now() + 500);

  const geoP = reverseGeocode(lat, lng, diag.geo).catch(() => ({
    queries: [],
    address: '',
    city: '',
    district: '',
    dong: ''
  }));
  const cuP = runChain('cu', () => collectCu(lat, lng, keyword, diag.cu, radius, deadlineAt), diag.cu, remaining());
  const gsP = runChain('gs25', () => collectGs25(lat, lng, keyword, radius, diag.gs25, deadlineAt), diag.gs25, remaining());

  /* ① 좌표→주소(이마트24·세븐일레븐 점포 검색의 지역명)를 기다린다.
     ② CU·이마트24·GS25 는 서로의 결과를 쓰지 않으므로 동시에 돈다.
     ③ 세븐일레븐만 CU 상품 바코드를 쓰므로 마지막에 시작한다. */
  const geo = await geoP;
  const geoArea = (geo.queries && geo.queries[0]) || '';
  const baseAddresses = [geo.address || ''].filter(Boolean);
  const baseCtx = { radius, area: geoArea, addresses: baseAddresses, geoQueries: geo.queries || [], barcodes: [], deadlineAt };
  const emP = runChain('emart24', () => collectEmart24(lat, lng, keyword, diag.emart24, baseCtx), diag.emart24, remaining());

  const started = await Promise.all([cuP, emP, gsP]);
  const cu = started[0];
  let em = started[1];
  const gs = started[2];
  /* 좌표→주소가 실패해 지역명이 비었으면 이마트24 점포 검색이 빈다 — 그때만 CU 점포 주소로 보충해
     한 번 더 시도한다(지역명은 점포 주소에서만 만들 수 있다). */
  if (!baseCtx.geoQueries.length && !em.value.stores.length) {
    const retryCtx = Object.assign({}, baseCtx, {
      area: areaFromStores((cu.value && cu.value.hints) || []) || baseCtx.area,
      addresses: baseCtx.addresses
        .concat(((cu.value && cu.value.hints) || []).map((s) => (s && s.address) || ''))
        .filter(Boolean)
    });
    if (retryCtx.area) {
      const retried = await runChain(
        'emart24',
        () => collectEmart24(lat, lng, keyword, diag.emart24, retryCtx),
        diag.emart24,
        remaining()
      );
      if (retried.value.stores.length) em = retried;
    }
  }

  const addressRows = [].concat((cu.value && cu.value.hints) || [], (cu.value && cu.value.stores) || []);
  const ctx = {
    radius,
    area: areaFromStores(addressRows) || geoArea,
    addresses: [geo.address || '']
      .concat(addressRows.map((s) => (s && s.address) || ''))
      .filter(Boolean),
    geoQueries: geo.queries || [],
    barcodes: uniqBy(cu.value.products || [], (p) => p.code).map((p) => p.code),
    deadlineAt
  };

  /* 세븐일레븐은 CU 응답 뒤에 시작한다 — 남은 시간이 거의 없으면 시작하지 않고 사유를 남긴다
     (마감을 넘긴 응답보다 빨리 온 부분 결과가 낫다). */
  const se =
    deadlineAt - Date.now() > 2500
      ? await runChain('seven', () => collectSeven(lat, lng, ctx, diag.seven), diag.seven, remaining())
      : {
          ok: true,
          value: { stores: [], products: [], note: '시간 마감(27초)으로 세븐일레븐 조회를 건너뛰었습니다' }
        };

  const sources = {};
  const stores = [];
  for (const [name, res] of [['gs25', gs], ['emart24', em], ['cu', cu], ['seven', se]]) {
    const list = res.value.stores || [];
    const entry = { ok: res.ok, count: list.length };
    if (res.ok) {
      if (res.value.note) entry.note = res.value.note;
      const products = res.value.products || [];
      if (products.length) entry.products = products.length;
    } else {
      entry.error = res.error;
      if (res.upstreamStatus) entry.upstream = res.upstreamStatus;
    }
    sources[name] = entry;
    stores.push(...list);
  }

  const merged = mergeStores(stores, lat, lng, nowIso).filter((s) => s.distanceM <= radius);
  /* sources.count 를 실제로 돌려주는 점포 수로 다시 센다(수집 단계 수와 화면 표시가 어긋나지 않게) */
  for (const name of Object.keys(sources)) {
    sources[name].count = merged.filter((s) => s.brand === name).length;
  }

  const value = {
    ok: true,
    relay: 'home-tablet',
    version: VERSION,
    lat,
    lng,
    keyword,
    radius,
    generatedAt: nowIso,
    elapsedMs: Date.now() - (deadlineAt - NEARBY_DEADLINE_MS),
    limits: { version: VERSION, maxStores: MAX_STORES, chainSoftDeadlineMs: CHAIN_SOFT_DEADLINE_MS, nearbyDeadlineMs: NEARBY_DEADLINE_MS },
    geo: {
      source: geo.source || '',
      city: geo.city || '',
      district: geo.district || '',
      dong: geo.dong || '',
      queries: geo.queries || []
    },
    sources,
    stores: merged
  };

  cacheWrite(key, value);
  return value;
}

/* 체인별로 "어디까지 됐는지"만 보여 주는 진단 — 태블릿에서 원인 확인용 */
async function diagnose(lat, lng, keyword, radius) {
  const diag = { emart24: [], cu: [], seven: [], gs25: [], geo: [] };
  /* 진단은 네 체인을 순서대로 돌리므로 전체 40초 예산을 미리 잡아 둔다(체인끼리 나눠 쓴다). */
  const deadlineAt = Date.now() + 40000;
  const steps = {};
  const safe = async (name, task) => {
    try {
      steps[name] = { ok: true, detail: await task() };
    } catch (err) {
      steps[name] = { ok: false, error: ((err && err.message) || String(err)).slice(0, 200) };
    }
  };

  const geo = await reverseGeocode(lat, lng, diag.geo).catch(() => ({ queries: [], address: '' }));
  steps.geo = {
    ok: !!(geo.queries && geo.queries.length),
    detail: { source: geo.source || '', city: geo.city, district: geo.district, dong: geo.dong, queries: geo.queries || [] }
  };

  const cuValue = await (async () => {
    try {
      return await collectCu(lat, lng, keyword, diag.cu, radius, deadlineAt);
    } catch (err) {
      steps.cu = { ok: false, error: ((err && err.message) || String(err)).slice(0, 200) };
      return { stores: [], products: [], hints: [] };
    }
  })();

  const addressRows = [].concat(cuValue.hints || [], cuValue.stores || []);
  const ctx = {
    radius,
    area: areaFromStores(addressRows) || (geo.queries && geo.queries[0]) || '',
    addresses: [geo.address || ''].concat(addressRows.map((s) => (s && s.address) || '')).filter(Boolean),
    geoQueries: geo.queries || [],
    barcodes: uniqBy(cuValue.products || [], (p) => p.code).map((p) => p.code),
    deadlineAt
  };
  if (!steps.cu) {
    steps.cu = {
      ok: true,
      detail: { cards: (cuValue.products || []).length, stores: (cuValue.stores || []).length, note: cuValue.note || '' }
    };
  }

  await safe('emart24', async () => {
    const value = await collectEmart24(lat, lng, keyword, diag.emart24, ctx);
    const first = (value.stores || [])[0];
    return {
      stores: (value.stores || []).length,
      hints: (value.hints || []).length,
      products: (value.products || []).length,
      note: value.note || '',
      sampleStore: first ? { name: first.name, items: (first.items || []).slice(0, 2) } : null
    };
  });

  await safe('seven', async () => {
    const value = await collectSeven(lat, lng, ctx, diag.seven);
    const first = (value.stores || [])[0];
    return {
      area: ctx.area || '(주소에서 자동)',
      queries: value.queries || [],
      strategies: value.strategies || [],
      stores: (value.stores || []).length,
      sampleStore: first
        ? { name: first.name, distanceM: distanceM(lat, lng, first.lat, first.lng), items: (first.items || []).slice(0, 2) }
        : null,
      note: value.note || ''
    };
  });

  await safe('gs25', async () => {
    gs25Load();
    const value = await collectGs25(lat, lng, keyword, radius, diag.gs25, deadlineAt);
    const first = (value.stores || [])[0];
    return {
      session: gs25Session.access ? gs25Session.source || 'set' : 'none',
      revoked: gs25Session.revoked || false,
      products: (value.products || []).map((p) => ({ code: p.code, name: p.name })),
      stores: (value.stores || []).length,
      sampleStore: first ? { name: first.name, items: (first.items || []).slice(0, 2) } : null,
      note: value.note || ''
    };
  });

  return { ok: true, version: VERSION, lat, lng, keyword, radius, steps, upstream: diag };
}

/* --------------------------------------------------------------- HTTP */

function cors(res, req) {
  /* v2.1 — 아무 사이트나 부를 수 있던 `*` 를 없앴습니다. 사이트·로컬 개발 서버만 허용합니다.
     (허용 목록 밖의 출처에는 헤더를 붙이지 않으므로 브라우저가 응답을 읽지 못합니다.) */
  const origin = (req && req.headers && req.headers.origin) || '';
  const allowed = isAllowedOrigin(origin);
  if (allowed) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-requested-with, x-admin-token, authorization');
  res.setHeader('access-control-max-age', '86400');
}

function isAllowedOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return false;
  if (/^https:\/\/moa-kr\.github\.io$/.test(value)) return true;          /* 운영 사이트 */
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value)) return true; /* 로컬 확인 */
  return false;
}

function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

const HELP_HTML = `<!doctype html><html lang="ko"><meta charset="utf-8">
<title>포켓몬카드모아 실재고 조회 서버</title>
<body style="font:15px/1.6 -apple-system,system-ui,'Malgun Gothic',sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#16233c">
<h1 style="font-size:20px">포켓몬카드모아 실재고 조회 서버가 켜져 있습니다</h1>
<p>사이트(「동네에서 찾기」)가 이 주소로 주변 매장의 실제 재고를 조회합니다. 별도 설정 없이 자동 연결됩니다.</p>
<ul>
<li><code>GET /health</code> — 서버 상태</li>
<li><code>GET /api/nearby?lat=37.5665&amp;lng=126.9780&amp;keyword=포켓몬카드&amp;radius=3000</code> — 주변 점포 실재고 (lat·lng 필수)</li>
<li><code>GET /api/diag</code> — 체인별 조회 진단(어디서 막히는지)</li>
<li><code>GET /api/emart24</code> — 이마트24만 따로(점포 목록·점포별 수량)</li>
<li><code>GET /api/seven</code> — 세븐일레븐만 따로(지역명·점포·수량)</li>
<li><code>GET /api/gs25</code> — GS25만 따로(로그인 세션 상태·상품·매장별 수량)</li>
<li><code>GET /api/gs25-grid?lat=36.0733&amp;lng=129.3947&amp;radius=3000&amp;items=6970834313420,6970834313864</code> — GS25 상품 지정 3km 격자(팜사이즈 원더 피규어)</li>
<li><code>GET /api/lottemart/stores?area=서울</code> — 롯데마트·토이저러스 매장 목록(도와센터, 6시간 캐시)</li>
<li><code>GET /api/lottemart/stock?area=서울&amp;market=2302&amp;q=포켓몬</code> — 점포별 상품명·가격·재고 수량/품절(3분 캐시)</li>
</ul>
<p style="color:#5b6b85">조회 전용입니다. 주문·결제·선점 요청은 만들지 않습니다.</p>
</body></html>`;

/* ───────────────────────── 자가 업데이트(v2.0) ─────────────────────────
   어드민 버튼 → POST /admin/update(X-Admin-Token) → 토큰 확인 → 고정 주소에서 새 판
   내려받기 → 표식·문법 검사 → 백업·교체 → 응답 → 새 프로세스로 재시작.
   이 구역은 파일을 쓰지만 쓰는 대상이 자기 자신(server.js) 하나로 고정되어 있습니다. */
function secretEquals(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (!x.length || x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch (err) { return false; }
}

/* 토큰이 살아 있는지 확인한다. ① RELAY_ADMIN_TOKEN 과 같으면 통과(오프라인 대비),
   ② 아니면 복지모아 서버의 어드민 세션 확인 API 에 물어본다. */
async function verifyAdminToken(token) {
  if (UPDATER.sharedKey && secretEquals(token, UPDATER.sharedKey)) {
    return { ok: true, via: 'shared-key' };
  }
  let res;
  try {
    res = await fetch(UPDATER.verifyUrl, {
      headers: {
        authorization: 'Bearer ' + token,
        'x-sync-key': token,
        accept: 'application/json',
        'user-agent': 'pokemoa-relay/' + VERSION
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPDATER.verifyMs)
    });
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: '관리자 인증 서버(복지모아)에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      reason: (err && err.message) || 'verify-fetch-failed'
    };
  }
  if (res.status === 200) {
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (data && data.ok) return { ok: true, via: 'bokjimoa' };
    return { ok: false, status: 403, error: '관리자 토큰을 확인하지 못했습니다.', reason: 'verify-body' };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 403, error: '관리자 토큰이 올바르지 않거나 만료되었습니다. 어드민에서 다시 로그인해 주세요.', reason: 'verify-' + res.status };
  }
  return { ok: false, status: 502, error: '관리자 인증 확인 응답이 예상과 다릅니다(HTTP ' + res.status + ').', reason: 'verify-http-' + res.status };
}

/* 고정 주소에서 새 판을 받아 온다 — 받은 내용이 정말 우리 중계 서버인지 표식으로 본다. */
async function downloadLatestServerSource() {
  let res;
  try {
    res = await fetch(UPDATER.sourceUrl, {
      headers: { 'user-agent': 'pokemoa-relay-updater/' + VERSION, 'cache-control': 'no-cache' },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPDATER.fetchMs)
    });
  } catch (err) {
    throw new Error('최신 판을 내려받지 못했습니다(네트워크·시간 초과). ' + ((err && err.message) || ''));
  }
  if (!res.ok) throw new Error('최신 판을 내려받지 못했습니다(HTTP ' + res.status + ').');
  const text = await res.text();
  if (!text || text.length < 4000) throw new Error('내려받은 파일이 너무 작습니다(' + (text ? text.length : 0) + ' bytes).');
  if (text.indexOf(UPDATER.marker) === -1) throw new Error('"' + UPDATER.marker + '" 표식이 없어 다른 파일로 보고 중단했습니다.');
  if (!/const VERSION = '[^']+'/.test(text)) throw new Error('VERSION 선언이 없어 중단했습니다.');
  return text;
}

function versionOfSource(text) {
  const m = /const VERSION = '([^']+)'/.exec(String(text || ''));
  return m ? m[1] : '?';
}

/* 응답을 끝까지 보낸 뒤, 새 프로세스를 먼저 띄우고 기존 연결을 정리하며 스스로 종료한다.
   새 프로세스가 먼저 떠서 포트가 아직 물려 있으면 listen 재시도가 받아 주고,
   기존 프로세스는 server.close() 뒤 5초 안에 반드시 빠진다.
   새 프로세스를 아예 못 띄웠다면 기존 프로세스를 그대로 두고 멈추지 않는다(무서버 상태 방지). */
function scheduleRestart() {
  setTimeout(() => {
    const dir = path.dirname(__filename);
    let child = null;
    try {
      const logFd = fs.openSync(path.join(dir, 'server.log'), 'a');
      child = cp.spawn(process.execPath, [__filename], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: process.env
      });
      child.on('error', (err) => console.error('[update] 새 프로세스 오류:', (err && err.message) || err));
      child.unref();
      try { fs.closeSync(logFd); } catch (err) { /* 자식이 물고 있어도 된다 */ }
    } catch (err) {
      child = null;
      console.error('[update] 새 프로세스 시작 실패:', (err && err.message) || err);
    }
    if (!child || !child.pid) {
      console.error('[update] 새 프로세스를 띄우지 못했습니다 — 기존 프로세스(이 코드)로 계속 돌립니다. 태블릿에서 다시 시작해 주세요.');
      return;
    }
    console.log('[update] 새 프로세스 시작 pid=' + child.pid + ' — 기존 프로세스는 연결을 정리하고 종료합니다');
    const exitNow = () => { try { process.exit(0); } catch (err) { /* 무시 */ } };
    try { server.close(exitNow); } catch (err) { exitNow(); }
    /* 오래 붙어 있는 연결(최대 27초 조회)이 close 를 붙잡으면 여기서 끊고 넘어간다. */
    setTimeout(exitNow, UPDATER.restartDrainMs).unref();
  }, UPDATER.restartDelayMs);
}

async function handleAdminUpdate(req, res) {
  req.resume(); /* 본문은 쓰지 않는다(프록시가 남긴 본문을 흘려보낸다) */
  const now = Date.now();

  /* 인증 실패가 반복되면 잠시 잠근다(토큰 대입 시도를 늦추기 위한 최소한의 장치) */
  if (updateGuard.fails >= 8 && now - updateGuard.failWindowAt < 10 * 60e3) {
    sendJson(res, 429, { ok: false, error: '인증 실패가 반복되어 잠시 잠갔습니다. 10분 뒤에 다시 시도해 주세요.' });
    return;
  }
  if (!updateGuard.fails || now - updateGuard.failWindowAt >= 10 * 60e3) {
    updateGuard.fails = 0;
    updateGuard.failWindowAt = now;
  }

  const token = String(req.headers['x-admin-token'] || '').trim().slice(0, 4096);
  if (!token) {
    updateGuard.fails += 1;
    console.log('[update] 인증 실패: X-Admin-Token 헤더 없음');
    sendJson(res, 401, { ok: false, error: 'X-Admin-Token 헤더가 필요합니다.' });
    return;
  }
  const auth = await verifyAdminToken(token);
  if (!auth.ok) {
    updateGuard.fails += 1;
    console.log('[update] 인증 실패: ' + (auth.reason || 'unknown'));
    sendJson(res, auth.status || 403, { ok: false, error: auth.error });
    return;
  }

  if (updateGuard.running) {
    sendJson(res, 429, { ok: false, error: '업데이트가 이미 진행 중입니다. 잠시 뒤 상태를 확인해 주세요.' });
    return;
  }
  const sinceLast = updateGuard.lastAt ? now - updateGuard.lastAt : Infinity;
  if (sinceLast < UPDATER.minIntervalMs) {
    sendJson(res, 429, {
      ok: false,
      error: '방금 업데이트를 실행했습니다. ' + Math.ceil((UPDATER.minIntervalMs - sinceLast) / 1000) + '초 뒤에 다시 시도해 주세요.'
    });
    return;
  }

  updateGuard.running = true;
  const dir = path.dirname(__filename);
  const nextPath = path.join(dir, 'server.next.js');
  const bakPath = path.join(dir, 'server.js.bak');
  try {
    console.log('[update] 요청 인증 통과(' + (auth.via || 'token') + ') — ' + UPDATER.sourceUrl);
    const text = await downloadLatestServerSource();
    const nextVersion = versionOfSource(text);
    const current = fs.readFileSync(__filename, 'utf8');

    if (text === current) {
      updateGuard.lastAt = Date.now();
      sendJson(res, 200, {
        ok: true, previousVersion: VERSION, nextVersion, restarting: false, updated: false,
        note: '이미 같은 판입니다(내용이 같아 다시 시작하지 않았습니다).'
      });
      console.log('[update] 이미 같은 판(v' + VERSION + ') — 재시작하지 않음');
      return;
    }

    fs.writeFileSync(nextPath, text, { mode: 0o644 });
    const check = cp.spawnSync(process.execPath, ['--check', nextPath], { encoding: 'utf8', timeout: 20000 });
    if (check.status !== 0) {
      try { fs.rmSync(nextPath, { force: true }); } catch (err) { /* 무시 */ }
      const detail = String((check.stderr || (check.error && check.error.message) || '')).split('\n').filter(Boolean).slice(0, 3).join(' / ').slice(0, 300);
      console.error('[update] 문법 검사 실패 — 기존 server.js 유지:', detail);
      updateGuard.lastAt = Date.now();
      sendJson(res, 500, {
        ok: false,
        error: '내려받은 파일이 문법 검사를 통과하지 못해 기존 server.js 를 그대로 두었습니다.',
        detail, previousVersion: VERSION, nextVersion
      });
      return;
    }

    fs.copyFileSync(__filename, bakPath);   /* 직전 판 백업(server.js.bak) */
    fs.renameSync(nextPath, __filename);    /* 같은 폴더 안 이름 바꾸기 — 원자적 교체 */

    updateGuard.lastAt = Date.now();
    updateGuard.fails = 0;
    updateGuard.lastResult = { at: new Date().toISOString(), previousVersion: VERSION, nextVersion };
    console.log('[update] v' + VERSION + ' → v' + nextVersion + ' 교체 완료(백업 server.js.bak) — 재시작 예약');

    /* 응답을 완전히 보낸 뒤에 재시작한다(res.end 가 끝난 뒤 300ms). */
    sendJson(res, 200, {
      ok: true, previousVersion: VERSION, nextVersion, restarting: true, updated: true,
      backup: 'server.js.bak', at: updateGuard.lastResult.at
    });
    scheduleRestart();
  } catch (err) {
    console.error('[update] 실패:', (err && err.message) || err);
    try { fs.rmSync(nextPath, { force: true }); } catch (err2) { /* 무시 */ }
    if (!res.writableEnded) {
      sendJson(res, 500, { ok: false, error: (err && err.message) || '업데이트에 실패했습니다.', previousVersion: VERSION });
    }
  } finally {
    updateGuard.running = false;
  }
}

/* ───────────────── 롯데마트·토이저러스 도와센터 중계 (v2.3, 2026-11-26) ─────────────────
   포켓몬카드모아 지도가 롯데마트·토이저러스 점포별 실시간 재고를 받아 갈 수 있게,
   롯데마트 모바일 도와센터(company.lottemart.com/mobiledowa)의 공개 HTML 을 대신 읽어
   JSON 으로 돌려줍니다. 로그인·토큰은 쓰지 않습니다.
     GET /api/lottemart/stores?area=서울
     GET /api/lottemart/stock?area=서울&market=2302&q=포켓몬&page=1
   도와센터는 해외 IP 를 막아서(미국 리전 서버에서는 연결 자체가 안 됨) 집 태블릿처럼
   한국 IP 에서 도는 이 중계가 필요합니다. 매장 목록 6시간 · 재고 3분 캐시. */
const LOTTE_BASE = String(process.env.LOTTEMART_BASE_URL || 'https://company.lottemart.com/mobiledowa').replace(/\/+$/, '');
const LOTTE_TIMEOUT_MS = Number(process.env.LOTTEMART_TIMEOUT_MS || 9000);
const LOTTE_STORE_TTL_MS = 6 * 60 * 60 * 1000;
const LOTTE_STOCK_TTL_MS = 3 * 60 * 1000;
const LOTTE_AREAS = ['서울', '경기', '인천', '강원', '충북', '충남', '대전', '경북', '경남', '대구', '부산', '울산', '전북', '전남', '광주', '제주'];
const lotteCache = new Map();
const lottePending = new Map();

function lotteArea(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === '기타') return '제주';
  if (LOTTE_AREAS.indexOf(text) >= 0) return text;
  const short = text.replace(/(특별시|광역시|특별자치시|특별자치도|도|시)$/g, '').trim();
  return LOTTE_AREAS.indexOf(short) >= 0 ? short : '';
}

function lotteUpstreamArea(area) {
  return area === '제주' ? '기타' : area;
}

function lotteDecode(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function lotteNum(text) {
  const cleaned = String(text || '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function lotteStockState(text) {
  const raw = lotteDecode(text);
  if (!raw) return { stock: null, stockText: '', soldOut: false };
  if (/품절|없음/.test(raw)) return { stock: 0, stockText: '품절', soldOut: true };
  const n = lotteNum(raw);
  if (n === null) return { stock: null, stockText: raw, soldOut: false };
  return { stock: n, stockText: raw, soldOut: n <= 0 };
}

function lotteParseStores(html) {
  const out = [];
  const seen = {};
  const re = /<option\s+value="(\d{3,6})"\s*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const name = lotteDecode(m[2]);
    if (!name || seen[m[1]]) continue;
    seen[m[1]] = 1;
    out.push({ code: m[1], name: name });
  }
  return out;
}

function lotteParseStock(html) {
  const src = String(html || '');
  const totalMatch = /검색결과\s*:\s*([\d,]+)\s*건/.exec(src);
  const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
  const pagesMatch = /더보기\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/.exec(src);
  const items = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(src))) {
    const chunk = m[1];
    const nameMatch = /class="prod-name">([\s\S]*?)<\/div>/.exec(chunk);
    if (!nameMatch) continue;
    const name = lotteDecode(nameMatch[1]);
    if (!name) continue;
    const countMatch = /class="prod-count">([\s\S]*?)<\/div>/.exec(chunk);
    const barcodeMatch = /<!--\s*(\d{8,14})\s*-->/.exec(countMatch ? countMatch[1] : chunk);
    const priceMatch = /가격[^<]*<\/th>\s*<td>([\s\S]*?)<\/td>/i.exec(chunk);
    const stockMatch = /재고[^<]*<\/th>\s*<td>([\s\S]*?)<\/td>/i.exec(chunk);
    const priceText = priceMatch ? lotteDecode(priceMatch[1]) : '';
    const st = lotteStockState(stockMatch ? stockMatch[1] : '');
    items.push({
      name: name,
      spec: countMatch ? lotteDecode(countMatch[1].replace(/<!--[\s\S]*?-->/g, ' ')) : '',
      barcode: barcodeMatch ? barcodeMatch[1] : '',
      price: lotteNum(priceText),
      priceText: priceText,
      stock: st.stock,
      stockText: st.stockText,
      soldOut: st.soldOut
    });
  }
  return { total: total, pages: pagesMatch ? Number(pagesMatch[2]) : (total ? 1 : 0), items: items };
}

async function lotteFetchText(pathAndQuery) {
  const res = await fetch(LOTTE_BASE + pathAndQuery, {
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9',
      referer: LOTTE_BASE + '/'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(LOTTE_TIMEOUT_MS)
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error('lottemart HTTP ' + res.status);
    err.upstreamStatus = res.status;
    throw err;
  }
  return text;
}

function lotteCached(key, ttl) {
  const hit = lotteCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) { lotteCache.delete(key); return null; }
  return hit.value;
}

function lotteRemember(key, value) {
  if (lotteCache.size > 240) {
    const first = lotteCache.keys().next();
    if (!first.done) lotteCache.delete(first.value);
  }
  lotteCache.set(key, { at: Date.now(), value: value });
  return value;
}

/* 롯데마트 조회는 한 번의 지도 조회에 매장 목록 1건 + 점포 재고 6건 안팎을 부른다.
   기존 편의점 조회 제한(분당 15건)과 섞으면 사이트가 금방 링을 수 있으므로,
   이 경로만 따로 분당 제한을 둔다(캐시 응답은 세지 않는다). */
const LOTTE_RATE_PER_MIN = Math.max(10, Number(process.env.RELAY_LOTTE_RATE_LIMIT_PER_MIN || 90));
const lotteGuard = { perIp: new Map(), limitedCount: 0, lastLimitedAt: '' };
function countLotteRate(ip) {
  const now = Date.now();
  const list = (lotteGuard.perIp.get(ip) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (list.length >= LOTTE_RATE_PER_MIN) {
    lotteGuard.perIp.set(ip, list);
    lotteGuard.limitedCount += 1;
    lotteGuard.lastLimitedAt = new Date().toISOString();
    return false;
  }
  list.push(now);
  lotteGuard.perIp.set(ip, list);
  if (lotteGuard.perIp.size > 2000) {
    for (const [key, times] of lotteGuard.perIp) {
      if (!times.length || now - times[times.length - 1] > RATE_WINDOW_MS) lotteGuard.perIp.delete(key);
      if (lotteGuard.perIp.size <= 800) break;
    }
  }
  return true;
}

async function lotteStores(area) {
  const key = 'stores:' + area;
  const hit = lotteCached(key, LOTTE_STORE_TTL_MS);
  if (hit) return { ok: true, area: area, stores: hit, fetchedAt: new Date().toISOString(), cached: true };
  if (lottePending.has(key)) return lottePending.get(key);
  const job = (async () => {
    const html = await lotteFetchText('/inc/asp/search_market_list.asp?p_area=' + encodeURIComponent(lotteUpstreamArea(area)) + '&p_type=1');
    const stores = lotteParseStores(html);
    lotteRemember(key, stores);
    return { ok: true, area: area, stores: stores, fetchedAt: new Date().toISOString(), cached: false };
  })().finally(() => { lottePending.delete(key); });
  lottePending.set(key, job);
  return job;
}

async function lotteStock(query) {
  const area = lotteArea(query.area);
  const market = /^\d{3,6}$/.test(String(query.market || '').trim()) ? String(query.market).trim() : '';
  const q = String(query.q || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const page = Math.min(30, Math.max(1, Math.floor(Number(query.page) || 1)));
  if (!market) return { ok: false, status: 400, error: 'market_required' };
  if (q.replace(/\s/g, '').length < 2) return { ok: false, status: 400, error: 'query_too_short' };
  const key = 'stock:' + [area, market, q, page].join('|');
  const hit = lotteCached(key, LOTTE_STOCK_TTL_MS);
  if (hit) return Object.assign({}, hit, { cached: true });
  if (lottePending.has(key)) return lottePending.get(key);
  const job = (async () => {
    let path;
    if (page > 1) {
      path = '/inc/asp/search_product_list.asp?p_market=' + encodeURIComponent(market) +
        '&p_schWord=' + encodeURIComponent(q) + '&page=' + page;
    } else {
      path = '/product/search_product.asp?p_market=' + encodeURIComponent(market) +
        '&p_schWord=' + encodeURIComponent(q) +
        (area ? '&p_area=' + encodeURIComponent(lotteUpstreamArea(area)) : '');
    }
    const html = await lotteFetchText(path);
    const parsed = lotteParseStock(html);
    if (!parsed.items.length && parsed.total === null) {
      return { ok: false, status: 502, error: 'parse_failed' };
    }
    const payload = {
      ok: true,
      area: area,
      market: market,
      q: q,
      page: page,
      pages: parsed.pages,
      total: parsed.total,
      items: parsed.items,
      fetchedAt: new Date().toISOString(),
      cached: false
    };
    lotteRemember(key, payload);
    return payload;
  })().finally(() => { lottePending.delete(key); });
  lottePending.set(key, job);
  return job;
}

const server = http.createServer(async (req, res) => {
  cors(res, req);
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  /* v2.0 — 어드민 원클릭 자가 업데이트(인증이 필요한 유일한 POST) */
  if (path === '/admin/update') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '/admin/update 는 POST 로만 부를 수 있습니다.' });
      return;
    }
    try {
      await handleAdminUpdate(req, res);
    } catch (err) {
      console.error('[update] 처리 중 오류', (err && err.message) || err);
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: '업데이트 처리 중 오류가 났습니다.' });
    }
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: '조회 전용 서버입니다 (GET, OPTIONS, 그리고 /admin/update POST 만 지원)' });
    return;
  }

  try {
    if (path === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: SERVICE,
        version: VERSION,
        time: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        /* 주디 긴급 감시 스케줄이 읽는 값 — 과다 요청·오류·캐시 상태를 여기서 본다 */
        rateLimitedCount: guard.rateLimitedCount,
        lastRateLimitedAt: guard.lastRateLimitedAt,
        errorCount: guard.errorCount,
        lastErrorAt: guard.lastErrorAt,
        cacheSize: cache.size,
        cacheTtlSec: Math.round(CACHE_MS / 1000),
        inflight: guard.inflight,
        limits: {
          perIpPerMin: RATE_LIMIT_PER_MIN,
          maxConcurrent: MAX_CONCURRENT,
          cacheTtlSec: Math.round(CACHE_MS / 1000)
        }
      });
      return;
    }

    if (path === '/api/nearby') {
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const keyword = (url.searchParams.get('keyword') || DEFAULT_KEYWORD).trim().slice(0, 40) || DEFAULT_KEYWORD;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));

      /* ① 캐시에 있으면 그대로 돌려준다 — 셈에도 넣지 않는다(같은 동네 재방문은 무료) */
      const key = cacheKey(lat, lng, keyword, radius);
      const hit = cacheRead(key);
      if (hit) {
        sendJson(res, 200, Object.assign({}, hit, { cached: true }));
        console.log(`[nearby] ${lat.toFixed(3)},${lng.toFixed(3)} r=${radius} → cache ${hit.stores.length}곳`);
        return;
      }

      /* ② 캐시에 없는 요청만 IP 분당 횟수·동시 조회 수를 본다 */
      if (!countRate(clientIp(req))) {
        sendRateLimited(res);
        return;
      }
      if (guard.inflight >= MAX_CONCURRENT) {
        sendRateLimited(res);
        return;
      }

      guard.inflight += 1;
      try {
        const value = await nearby(lat, lng, keyword, radius);
        sendJson(res, 200, value);
        console.log(
          `[nearby] ${lat.toFixed(4)},${lng.toFixed(4)} "${keyword}" r=${radius} ` +
            `emart24=${value.sources.emart24.count} cu=${value.sources.cu.count} seven=${value.sources.seven.count} ` +
            `gs25=${(value.sources.gs25 || {}).count || 0} ` +
            `→ ${value.stores.length}곳 ${Date.now() - started}ms${value.cached ? ' (cache)' : ''}`
        );
      } finally {
        guard.inflight -= 1;
      }
      return;
    }

    if (path === '/api/diag') {
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const keyword = (url.searchParams.get('keyword') || DEFAULT_KEYWORD).trim().slice(0, 40) || DEFAULT_KEYWORD;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));
      const value = await diagnose(lat, lng, keyword, radius);
      sendJson(res, 200, value);
      console.log(`[diag] ${Date.now() - started}ms`);
      return;
    }

    if (path === '/api/seven') {
      /* 세븐일레븐만 따로 조회해 보는 진단 — 태블릿에서 한 줄로 확인할 때 씁니다.
         /api/seven?lat=36.0733&lng=129.3947&q=포항  (q 생략 시 주소에서 자동) */
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));
      const manual = (url.searchParams.get('q') || url.searchParams.get('area') || '').trim().slice(0, 40);
      const item = (url.searchParams.get('item') || '').trim();
      const barcodes = item
        ? [item]
        : String(process.env.SEVEN_ITEM_CDS || '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
      if (!barcodes.length) barcodes.push('8800286279372'); /* CU에서 확인한 포켓몬 카드 바코드 */
      const diag = [];
      const geo = manual
        ? { queries: [], address: '' }
        : await reverseGeocode(lat, lng, diag).catch(() => ({ queries: [], address: '' }));
      let value;
      try {
        value = await collectSeven(
          lat,
          lng,
          { radius, area: manual, addresses: manual ? [manual] : geo.address ? [geo.address] : [], geoQueries: geo.queries || [], barcodes },
          diag
        );
      } catch (err) {
        value = { stores: [], products: [], queries: [], note: '오류: ' + ((err && err.message) || String(err)).slice(0, 160) };
      }
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        lat,
        lng,
        radius,
        area: manual || '(주소에서 자동)',
        barcodes,
        products: (value.products || []).map((m) => ({ itemCd: m.itemCd, smCd: m.smCd, name: m.name })),
        queries: value.queries || [],
        strategies: value.strategies || [],
        stores: (value.stores || []).map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          distanceM: distanceM(lat, lng, s.lat, s.lng),
          items: s.items
        })),
        note: value.note || '',
        upstream: diag
      });
      console.log(`[seven] ${lat.toFixed(4)},${lng.toFixed(4)} → ${(value.stores || []).length}곳`);
      return;
    }

    if (path === '/api/gs25') {
      /* GS25만 따로 — 세션 상태·상품 검색·매장별 수량을 한 번에 확인합니다.
         /api/gs25?lat=36.0733&lng=129.3947&keyword=포켓몬카드&item=바코드 */
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));
      const keyword = (url.searchParams.get('keyword') || DEFAULT_KEYWORD).trim().slice(0, 40) || DEFAULT_KEYWORD;
      const item = (url.searchParams.get('item') || '').trim();
      const dg = [];
      gs25Load();
      let products = [];
      let stores = [];
      let note = '';
      try {
        products = item
          ? [{ code: item, name: '(직접 지정한 상품)', price: null }]
          : await gs25Search(keyword, dg);
        if (!gs25Session.access) {
          note = 'GS25 로그인 세션(GS25_ACCESS_TOKEN) 필요';
        } else if (products.length) {
          const lists = await mapLimit(products.slice(0, GS25_MAX_ITEMS), 1, (p) =>
            gs25StockForItem(lat, lng, p, radius, dg)
          );
          const byStore = new Map();
          for (const list of lists) {
            for (const row of list) {
              const cur = byStore.get(row.id) || Object.assign({}, row, { items: [] });
              cur.items.push(row.item);
              byStore.set(row.id, cur);
            }
          }
          stores = Array.from(byStore.values());
          if (!stores.length) note = '반경 안에서 수량이 확인된 GS25 점포가 없습니다';
        }
      } catch (err) {
        note = '오류: ' + ((err && err.message) || String(err)).slice(0, 160);
      }
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        lat,
        lng,
        radius,
        keyword,
        session: {
          configured: !!gs25Session.access,
          source: gs25Session.source || 'none',
          deviceIdSet: !!gs25Session.deviceId,
          revoked: gs25Session.revoked || false
        },
        products: products.map((p) => ({ code: p.code, name: p.name, price: p.price })),
        stores: stores.map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          distanceM: distanceM(lat, lng, s.lat, s.lng),
          items: s.items
        })),
        note,
        upstream: dg
      });
      console.log(`[gs25] ${lat.toFixed(4)},${lng.toFixed(4)} → ${stores.length}곳 (session ${gs25Session.access ? 'O' : 'X'})`);
      return;
    }

    if (path === '/api/gs25-grid') {
      /* v2.2 — GS25 상품 지정 3km 격자 조회(피규어).
         /api/gs25-grid?lat=36.0733&lng=129.3947&radius=3000&items=6970834313420,6970834313864
         items 를 생략하면 피규어 1·2·3탄 바코드를 씁니다. */
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));
      const items = parseGridItems(url.searchParams.get('items'));
      if (!items.length) {
        sendJson(res, 400, { ok: false, code: 'items_invalid', error: 'items 에 6~14짜리 숫자 상품코드(바코드)를 주세요.' });
        return;
      }

      /* ① 캐시 — 같은 자리·반경·바코드면 300초 동안 그대로 돌려준다(셈에 넣지 않는다) */
      const key = gridCacheKey(lat, lng, items, radius);
      const hit = cacheRead(key);
      if (hit) {
        sendJson(res, 200, Object.assign({}, hit, { cached: true }));
        console.log(`[gs25-grid] ${lat.toFixed(3)},${lng.toFixed(3)} r=${radius} → cache ${hit.stores.length}곳`);
        return;
      }

      /* ② 캐시에 없는 요청만 IP 분당 횟수·동시 조회 수를 본다(v2.1 과 같은 규칙) */
      if (!countRate(clientIp(req))) {
        sendRateLimited(res);
        return;
      }
      if (guard.inflight >= MAX_CONCURRENT) {
        sendRateLimited(res);
        return;
      }

      guard.inflight += 1;
      const startedAt = Date.now();
      try {
        const deadlineAt = Date.now() + NEARBY_DEADLINE_MS;
        const diag = [];
        const value = await collectGs25Grid(lat, lng, items, radius, diag, deadlineAt);
        const body = {
          ok: true,
          relay: 'home-tablet',
          version: VERSION,
          lat,
          lng,
          radius,
          items: value.items.map((i) => ({ code: i.code, name: i.name })),
          grid: { points: value.points || 0, queries: value.queries || 0, skipped: value.skipped || 0 },
          summary: value.summary || [],
          session: { configured: !!gs25Session.access, revoked: gs25Session.revoked || false },
          sources: {
            gs25: {
              ok: !value.sessionNeeded && !value.failed,
              count: value.stores.length,
              products: value.items.length,
              note: value.note || ''
            }
          },
          stores: value.stores.map((s) => ({
            brand: 'gs25',
            id: s.id,
            name: s.name,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            distanceM: distanceM(lat, lng, s.lat, s.lng),
            status: (s.items || []).some((i) => Number(i.qty) > 0) ? 'in_stock' : 'out_of_stock',
            items: (s.items || []).map((i) => ({ name: i.name, code: String(i.code), qty: Number(i.qty) })),
            updatedAt: new Date().toISOString()
          })),
          generatedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt
        };
        if (value.sessionNeeded) body.note = value.note;
        /* 세션 없음·업체 오류는 캐시에 남기지 않는다 — 세션을 붙인 뒤 다시 부르면 바로 조회된다 */
        if (!value.sessionNeeded && !/받지 못했습니다/.test(String(value.note || ''))) cacheWrite(key, body);
        sendJson(res, 200, body);
        console.log(
          `[gs25-grid] ${lat.toFixed(4)},${lng.toFixed(4)} r=${radius} items=${items.length} ` +
            `points=${body.grid.points} → ${body.stores.length}곳 ${body.elapsedMs}ms`
        );
      } catch (err) {
        guard.errorCount += 1;
        guard.lastErrorAt = new Date().toISOString();
        sendJson(res, 500, { ok: false, error: (err && err.message) || 'GS25 격자 조회 오류' });
      } finally {
        guard.inflight -= 1;
      }
      return;
    }

    if (path === '/api/emart24') {
      /* 이마트24만 따로 — 점포 목록이 어느 경로로 왔는지, 점포별 수량이 어떻게 나오는지 확인용.
         /api/emart24?lat=36.0016&lng=129.4028  (q 를 주면 그 지역명으로 공개 매장 API 조회) */
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const radius = Math.min(20000, Math.max(300, num(url.searchParams.get('radius'), DEFAULT_RADIUS)));
      const manual = (url.searchParams.get('q') || '').trim().slice(0, 40);
      const keyword = (url.searchParams.get('keyword') || DEFAULT_KEYWORD).trim().slice(0, 40) || DEFAULT_KEYWORD;
      const diag = [];
      const geo = await reverseGeocode(lat, lng, diag).catch(() => ({ queries: [], address: '' }));
      const ctx = {
        radius,
        area: manual || (geo.queries && geo.queries[0]) || '',
        addresses: manual ? [manual] : geo.address ? [geo.address] : [],
        geoQueries: manual ? [manual] : geo.queries || []
      };
      let value;
      try {
        value = await collectEmart24(lat, lng, keyword, diag, ctx);
      } catch (err) {
        value = { stores: [], products: [], hints: [], note: '오류: ' + ((err && err.message) || String(err)).slice(0, 160) };
      }
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        lat,
        lng,
        radius,
        geo: { source: geo.source || '', queries: geo.queries || [] },
        note: value.note || '',
        products: (value.products || []).map((p) => ({ code: p.code, name: p.name })),
        hints: (value.hints || []).map((s) => ({ id: s.id, name: s.name, distanceM: distanceM(lat, lng, s.lat, s.lng) })),
        stores: (value.stores || []).map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          distanceM: distanceM(lat, lng, s.lat, s.lng),
          items: s.items
        })),
        upstream: diag
      });
      console.log(`[emart24] ${lat.toFixed(4)},${lng.toFixed(4)} → ${(value.stores || []).length}곳`);
      return;
    }

    if (path === '/api/geo') {
      const point = readPoint(url, res);
      if (!point) return;
      const { lat, lng } = point;
      const diag = [];
      const geo = await reverseGeocode(lat, lng, diag);
      sendJson(res, 200, { ok: true, version: VERSION, lat, lng, geo, upstream: diag });
      return;
    }

    if (path === '/api/kream-movers') {
      /* 계약(안) — 사이트의 「시세·팝수」 탭이 이 응답이 있으면 정적 값을 대체합니다.
         KREAM은 로그인·검색 API 제한이 있어 수집기를 태블릿에서 따로 돌려 붙이는 단계입니다.
         그 전까지는 명확한 501로 답해 사이트가 정적 데이터를 그대로 쓰게 합니다. */
      sendJson(res, 501, {
        ok: false,
        error: 'kream_movers_not_configured',
        hint: 'KREAM 시세 수집기를 연결하면 이 경로가 items 배열을 돌려줍니다.'
      });
      return;
    }

    if (path === '/api/pop') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
      const company = (url.searchParams.get('company') || '').trim().slice(0, 12);
      sendJson(res, 501, {
        ok: false,
        error: 'pop_lookup_not_configured',
        query: q,
        company,
        hint: 'PSA·BRG 팝수 조회기를 연결하면 이 경로가 카드별 팝수를 돌려줍니다.'
      });
      return;
    }

    if (path === '/api/lottemart/stores') {
      const area = lotteArea(url.searchParams.get('area'));
      if (!area) {
        sendJson(res, 400, { ok: false, error: '지역(area)은 서울·경기·인천 등 17개 시·도 중 하나여야 합니다.' });
        return;
      }
      if (!lotteCached('stores:' + area, LOTTE_STORE_TTL_MS) && !countLotteRate(clientIp(req))) {
        sendRateLimited(res);
        return;
      }
      try {
        const value = await lotteStores(area);
        sendJson(res, 200, value);
        console.log(`[lottemart] ${area} 매장 ${value.stores.length}곳`);
      } catch (err) {
        sendJson(res, 502, {
          ok: false,
          error: err && err.upstreamStatus ? 'upstream_http_' + err.upstreamStatus : (/timeout|abort/i.test(String((err && err.message) || '')) ? 'upstream_timeout' : 'upstream_unreachable'),
          detail: (err && err.message) || ''
        });
      }
      return;
    }

    if (path === '/api/lottemart/stock') {
      if (!countLotteRate(clientIp(req))) {
        sendRateLimited(res);
        return;
      }
      const value = await lotteStock({
        area: url.searchParams.get('area'),
        market: url.searchParams.get('market'),
        q: url.searchParams.get('q'),
        page: url.searchParams.get('page')
      }).catch((err) => ({
        ok: false,
        status: 502,
        error: /timeout|abort/i.test(String((err && err.message) || '')) ? 'upstream_timeout' : 'upstream_unreachable',
        detail: (err && err.message) || ''
      }));
      if (!value.ok) {
        sendJson(res, value.status === 400 ? 400 : 502, { ok: false, error: value.error, detail: value.detail || '' });
        return;
      }
      sendJson(res, 200, value);
      return;
    }

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HELP_HTML);
      return;
    }

    sendJson(res, 404, { ok: false, error: '없는 경로입니다. /health, /api/nearby, /api/gs25-grid, /api/diag, /api/lottemart/stores 를 쓰세요.' });
  } catch (err) {
    guard.errorCount += 1;
    guard.lastErrorAt = new Date().toISOString();
    console.error('[error]', err && err.message);
    sendJson(res, 500, { ok: false, error: (err && err.message) || '서버 오류' });
  }
});

function start() {
  /* v2.0 — 자가 업데이트로 새 프로세스가 뜰 때 기존 프로세스가 포트를 놓는 순간이 있습니다.
     EADDRINUSE 면 조금씩 더 기다렸다가 다시 listen 합니다(최대 20회 ≈ 8초). */
  let attempts = 0;
  let listening = false;
  const onListening = () => {
    listening = true;
    console.log(`포켓몬카드모아 실재고 조회 서버 v${VERSION} — http://${HOST}:${PORT}`);
    console.log(`  상태 확인: curl http://${HOST}:${PORT}/health`);
    console.log(`  실재고:    curl "http://${HOST}:${PORT}/api/nearby?lat=37.5665&lng=126.9780&keyword=${encodeURIComponent(DEFAULT_KEYWORD)}&radius=3000"`);
    console.log('             (lat·lng 는 필수입니다 — 예: 서울시청 37.5665/126.9780)');
    console.log(`  진단:      curl "http://${HOST}:${PORT}/api/diag"`);
    console.log('  바깥에서 쓰려면: cloudflared tunnel --url http://' + HOST + ':' + PORT);
    console.log('  자가 업데이트: 모아 어드민 → ⑤ 저장·배포 → 🔌 태블릿 중계 서버 → 최신 버전 업데이트');
  };
  server.on('listening', onListening);
  server.on('error', (err) => {
    const code = err && err.code;
    if (code === 'EADDRINUSE' && !listening && attempts < 20) {
      attempts += 1;
      const wait = Math.min(2000, 250 * attempts);
      console.log(`[listen] 포트 ${PORT} 이(가) 아직 사용 중 — ${wait}ms 뒤 다시 시도 (${attempts}/20)`);
      setTimeout(() => { try { server.listen(PORT, HOST); } catch (e) { /* 다음 error 로 */ } }, wait);
      return;
    }
    console.error('[fatal]', (err && err.message) || err);
    process.exit(1);
  });
  server.listen(PORT, HOST);
}

/* 멈출 때는 열린 연결을 먼저 닫는다(다음 판이 포트를 바로 쓸 수 있게). */
function shutdown(signal) {
  console.log(`[${signal}] 서버를 정리하고 종료합니다`);
  try { server.close(() => process.exit(0)); } catch (err) { process.exit(0); }
  setTimeout(() => process.exit(0), 1500).unref();
}
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => process.on(signal, () => shutdown(signal)));

if (require.main === module) start();

module.exports = {
  start,
  server,
  UPDATER,
  verifyAdminToken,
  downloadLatestServerSource,
  versionOfSource,
  nearby,
  diagnose,
  mergeStores,
  distanceM,
  cuTimeoutFor,
  ringPoints,
  ringPlan,
  looksLikeCard,
  areaFromStores,
  collectSeven,
  sevenStoreSearch,
  sevenAreaQueries,
  sevenRsaEncrypt,
  sevenStoresByRsa,
  sevenFlatRow,
  sevenRsaRows,
  collectEmart24,
  collectCu,
  collectGs25,
  collectGs25Grid,
  parseGridItems,
  gs25Search,
  gs25StockForItem,
  gs25Session,
  gs25Load,
  emart24StoresPublic,
  emart24Queries,
  reverseGeocode,
  geoQueries
};
