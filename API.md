# 복지콜 예약 API

브라우저 없이 터미널이나 서버에서 예약을 접수하기 위한 HTTP API입니다.
길찾기 앱의 CLI나 MCP 서버처럼 화면이 없는 환경을 위해 공개합니다.

화면을 열 수 있는 환경이라면 [딥링크 연동](README.md)을 쓰세요. 주소 확인과 최종 확인을
복지콜 앱이 대신 해주기 때문에 붙이기도 쉽고 사고 위험도 낮습니다.

## 접수 전 확인 의무

복지콜은 실제로 차량이 배차되는 서비스입니다. 잘못된 좌표로 접수되면 사용자가 엉뚱한
곳에서 차를 기다리게 됩니다. 실제로 일어난 적이 있고(2026-05-20), 그 뒤로 복지콜 앱
화면에는 세 단계가 들어가 있습니다. API로 접수하는 클라이언트는 같은 것을 직접 해야 합니다.

1. **주소 확인** — 사용자가 입력한 문자열을 그대로 접수하지 마세요.
   `/api/kbucall/place`로 확인한 결과를 씁니다.
2. **후보가 여러 개면 사용자가 고르게** — `ambiguous`가 `true`면 `candidates`를 전부
   읽어주고 명시적으로 선택받으세요. 첫 번째를 자동으로 고르면 안 됩니다. 같은 동 이름이
   여러 지역에 있어서 생기는 문제라, 임의로 고르면 다른 도시로 차가 갑니다.
3. **최종 확인** — 출발지, 도착지, 시각을 사용자에게 다시 확인받은 뒤 접수합니다.

AI 에이전트가 사용자 확인 없이 접수하지 않게 해주세요. 사람이 확인하는 단계를 건너뛰면
위 세 가지가 전부 무력해집니다.

## 기본

- Base URL: `https://kbucall.pages.dev`
- 요청·응답 모두 JSON (`Content-Type: application/json`)
- 인증: `Authorization: Bearer <token>`
- 오류: `{ "error": "사람이 읽을 메시지" }` + 해당 HTTP 상태. 메시지는 그대로 사용자에게
  읽어줘도 되는 한국어 문장입니다.
- 401에 `unauthorized: true`가 오면 토큰이 만료된 것입니다. 다시 로그인하세요.

브라우저에서 부를 수는 없습니다. CORS 허용 오리진이 복지콜 앱으로 제한돼 있습니다.
CLI, 서버, 네이티브 앱처럼 CORS가 적용되지 않는 환경에서 쓰세요.

## 1. 로그인

복지콜 계정으로 로그인합니다. 가입 절차가 따로 없습니다 — 복지콜 서버에 로그인이 되면
그 자리에서 계정이 만들어집니다.

```
POST /api/auth/kbucall-login
{ "memberName": "홍길동", "phone": "01012345678", "password": "복지콜 비밀번호" }
```

```json
{ "ok": true, "token": "...", "userId": "...", "memberName": "홍길동", "isNewUser": false }
```

- 실패: `401` + `{ "error": "...", "remainingAttempts": 3 }`
- 시도 제한 초과: `429` + `{ "error": "...", "lockedOut": true }`
- 복지콜 서버 연결 실패: `502`

토큰은 90일 유효하고, 쓰는 동안 자동으로 연장됩니다.

**비밀번호를 저장하지 마세요.** 토큰만 보관하면 됩니다. 비밀번호는 복지콜 서버 로그인에
필요해서 복지콜 앱 서버가 암호화해 보관합니다. 클라이언트까지 들고 있을 이유가 없습니다.

## 2. 주소 확인

```
GET /api/kbucall/place?query=둔촌동%201376-1
Authorization: Bearer <token>
```

```json
{
  "results": [{ "name": "둔촌동 1376-1", "address": "서울 강동구 둔촌동 1376-1", "jibun": "서울 강동구 둔촌동 1376-1", "x": "", "y": "" }],
  "hasAddressNumber": true,
  "ambiguous": false
}
```

- **토큰을 반드시 붙이세요.** 토큰이 있으면 복지콜 세션으로 실제 접수 가능 여부까지 검증합니다.
  없으면 카카오 검색 결과만 돌려주고 `ambiguous` 판정을 하지 않습니다.
- `results`가 비어 있으면 접수하지 마세요. 더 구체적인 주소를 받으세요.
- `ambiguous: true`면 `candidates` 배열이 함께 옵니다. 각 항목은 `{ name?, address, jibun? }`
  입니다. 사용자에게 전부 읽어주고 고르게 하세요.
- `hasAddressNumber: false`는 번지가 없는 주소입니다. 접수는 되지만 기사가 위치를 찾기
  어려우므로 사용자에게 알리고 더 구체적인 주소를 권하세요.
- 접수에는 `results[0].address`(또는 사용자가 고른 후보의 `address`)를 쓰세요. 사용자가
  입력한 원본 문자열이 아닙니다.

건물명만 넘겨도 동작합니다. 지번 주소를 넘기면 성공률이 가장 높습니다 — 복지콜 접수는
지번 기준으로 동작합니다.

## 3. 접수

```
POST /api/data/bookings
Authorization: Bearer <token>
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "runAt": "2026-09-24T14:30:00.000Z",
  "pickupQuery": "서울 강동구 둔촌동 1376-1",
  "pickupDetail": "101동 정문 앞",
  "dropoffQuery": "서울 영등포구 여의도동 2",
  "dropoffDetail": "",
  "status": "pending",
  "confirmMode": "auto",
  "source": "gildongmu-cli"
}
```

필수는 `id`, `runAt`, `pickupQuery`, `dropoffQuery` 넷입니다.

| 필드 | 설명 |
|---|---|
| `id` | 클라이언트가 만드는 UUID. 상태 조회·취소에 씁니다 |
| `runAt` | 접수를 요청할 시각. ISO 8601 |
| `pickupQuery` / `dropoffQuery` | 2단계에서 확인한 주소 |
| `pickupDetail` / `dropoffDetail` | 동·호수 등. 선택 |
| `viaQuery` / `viaDetail` | 경유지. 선택 |
| `status` | 새 예약은 `"pending"` |
| `confirmMode` | `"auto"` — 시각이 되면 자동 접수 |
| `source` | 클라이언트 식별자. 예: `"gildongmu-cli"` |
| `note` | 메모. 선택 |

`source`에 `voice`, `text`, `quick`, `favorite`, `manual`, `rebook`은 쓰지 마세요.
복지콜 앱 내부 값이고, 특히 `favorite`은 주소 재확인 단계를 건너뛰게 합니다.

응답은 `200`입니다. 이 시점에는 "예약이 등록됨"일 뿐 아직 복지콜에 접수된 게 아닙니다.

- `runAt`이 지금부터 5분 이내면 서버가 즉시 접수를 시작합니다.
- 그보다 미래면 매분 도는 크론이 그 시각에 접수합니다.
- 10분보다 더 과거인 `runAt`은 실행되지 않습니다.

접수 결과는 4단계로 확인합니다.

## 4. 상태 확인

```
GET /api/data/bookings?id=<id>
Authorization: Bearer <token>
```

```json
{ "booking": { "id": "...", "status": "success", "callPhase": "dispatched", "errorMessage": null } }
```

`id` 없이 부르면 `{ "bookings": [...] }`로 전부 옵니다.

**status**

| 값 | 뜻 |
|---|---|
| `pending` | 등록됨. 아직 접수 시각 전 |
| `running` | 복지콜 서버에 접수 요청 중 |
| `success` | 접수 완료 |
| `failed` | 접수 실패. `errorMessage`에 이유 |
| `cancelled` | 취소됨 |
| `done` | 이용 완료 |

**callPhase** (`success`일 때 갱신)

| 값 | 뜻 |
|---|---|
| `submitted` | 접수됨, 차량 검색 전 |
| `searching` | 차량 검색 중 |
| `dispatched` | 차량 배정, 이동 중 |
| `boarding` | 탑승 후 운행 중 |
| `disembarked` | 하차 완료 |

즉시 접수는 보통 몇 초에서 30초 안에 `success` 또는 `failed`로 확정됩니다. 1초 간격으로
30초까지 폴링하다가 확정되지 않으면 "평소보다 오래 걸린다"고 알리고 나중에 다시 확인하세요.
복지콜 앱 화면이 쓰는 방식과 같습니다.

`failed`면 `errorMessage`를 사용자에게 그대로 읽어주세요. 대부분 주소 문제라 고쳐서 다시
접수할 수 있습니다.

## 5. 취소

이미 복지콜에 접수된 차량을 취소합니다.

```
POST /api/data/cancel-call
Authorization: Bearer <token>
```

본문은 없습니다. 서버가 그 사용자의 진행 중인 접수를 찾아 취소합니다.

아직 접수 전(`pending`)인 예약을 없애려면 취소가 아니라 삭제입니다.

```
DELETE /api/data/bookings?id=<id>
Authorization: Bearer <token>
```

복지콜에는 배차 후 취소와 하차 후 재접수에 대기 규정이 있습니다. 취소가 거부되면
`errorMessage`에 그 내용이 옵니다.

## 전체 흐름

```bash
BASE=https://kbucall.pages.dev

# 1. 로그인
TOKEN=$(curl -s -X POST "$BASE/api/auth/kbucall-login" \
  -H 'Content-Type: application/json' \
  -d '{"memberName":"홍길동","phone":"01012345678","password":"..."}' \
  | jq -r .token)

# 2. 주소 확인 — ambiguous면 여기서 사용자에게 고르게 한다
curl -s "$BASE/api/kbucall/place?query=$(printf %s '둔촌동 1376-1' | jq -sRr @uri)" \
  -H "Authorization: Bearer $TOKEN" | jq

# 3. 사용자 최종 확인을 받은 뒤 접수
ID=$(uuidgen)
curl -s -X POST "$BASE/api/data/bookings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID\",\"runAt\":\"$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)\",
       \"pickupQuery\":\"서울 강동구 둔촌동 1376-1\",
       \"dropoffQuery\":\"서울 영등포구 여의도동 2\",
       \"status\":\"pending\",\"confirmMode\":\"auto\",\"source\":\"gildongmu-cli\"}"

# 4. 결과 확인
curl -s "$BASE/api/data/bookings?id=$ID" -H "Authorization: Bearer $TOKEN" | jq .booking.status
```

## 제한과 주의

- **이용 자격** — 복지콜은 지역 기반 서비스이고 등록된 이용 자격이 있어야 접수됩니다.
  자격이 없으면 로그인 단계에서 막힙니다.
- **시간대** — `runAt`은 ISO 8601이라 시간대가 명시됩니다. 사용자가 "오후 2시 반"이라고
  말한 것을 변환할 때 기기 시간대를 확인하세요.
- **로그인 시도 제한** — 복지콜 서버 쪽 제한이라 반복 실패하면 잠깁니다.
  `remainingAttempts`를 사용자에게 알려주세요.
- **명세 변경** — 이 저장소에 커밋으로 남습니다. Watch를 켜두면 알림을 받습니다.
  깨지는 변경이 필요하면 미리 이슈로 알리겠습니다.

## 문의

이 저장소의 이슈로 남겨 주세요.
