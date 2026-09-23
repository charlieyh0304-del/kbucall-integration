# 복지콜 예약 API

브라우저 없이 터미널이나 서버에서 예약을 접수하기 위한 HTTP API입니다.
길찾기 앱의 CLI나 MCP 서버처럼 화면이 없는 환경을 위해 공개합니다.

화면을 열 수 있는 환경이라면 [딥링크 연동](README.md)을 쓰세요. 주소 확인과 최종 확인을
복지콜 앱이 대신 해주기 때문에 붙이기도 쉽고 사고 위험도 낮습니다.

**그대로 돌아가는 참조 구현이 [examples/book.mjs](examples/book.mjs)에 있습니다.**
아래 규칙을 전부 구현한 것이라, 순서가 헷갈리면 그 파일을 보세요. 의존성이 없고
Node 18 이상이면 바로 실행됩니다.

## 접수 전 확인 의무

복지콜은 실제로 차량이 배차되는 서비스입니다. 잘못된 좌표로 접수되면 사용자가 엉뚱한
곳에서 차를 기다립니다. 실제로 일어난 적이 있고(2026-05-20), 그 뒤로 복지콜 앱 화면에는
확인 단계가 들어가 있습니다. API로 접수하는 클라이언트는 같은 것을 직접 해야 합니다.

1. **주소 확인** — 사용자가 입력한 문자열을 그대로 접수하지 마세요.
   `/api/kbucall/place`로 확인한 결과를 씁니다.
2. **후보가 여러 개면 사용자가 고르게** — `ambiguous`가 `true`면 `candidates`를 전부
   읽어주고 명시적으로 선택받으세요. 첫 후보를 자동으로 고르면 안 됩니다. 같은 동 이름이
   여러 지역에 있어서 생기는 문제라, 임의로 고르면 다른 지역으로 차가 갑니다.
3. **번지가 없으면 접수하지 않기** — `hasAddressNumber`가 `false`면 접수하지 말고 번지를
   포함해 다시 입력받으세요. 번지 없이 접수되면 복지콜 콜센터가 사용자에게 전화해서 위치를
   다시 확인합니다. 복지콜 앱 화면도 같은 이유로 이 경우 접수를 막습니다.
4. **최종 확인** — 출발지, 도착지, 시각을 사용자에게 다시 확인받은 뒤 접수합니다.

**확인을 받을 수 없는 환경이면 접수하지 마세요.** 파이프로 실행되거나 AI 에이전트가
호출한 경우처럼 사람의 답을 받을 수 없다면, 2번과 4번이 불가능합니다. 그때는 접수하지 말고
후보 목록이나 확인할 내용을 호출한 쪽에 돌려주어 사람이 고르게 한 다음 다시 부르세요.
참조 구현은 `stdin.isTTY`로 이 상황을 감지해 멈춥니다.

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
그 자리에서 계정이 만들어지고, 워커가 접수할 때 쓸 복지콜 자격증명도 함께 보관됩니다.

```
POST /api/auth/kbucall-login
{ "memberName": "홍길동", "phone": "01012345678", "password": "복지콜 비밀번호" }
```

```json
{ "ok": true, "token": "...", "userId": "...", "memberName": "홍길동", "isNewUser": false }
```

| 상태 | 뜻 |
|---|---|
| `400` | 필수값 누락. 이 단계에서는 복지콜 서버에 접속하지 않습니다 |
| `401` | 인증 실패. `remainingAttempts`가 함께 올 수 있습니다 |
| `429` | 시도 제한. `lockedOut: true` |
| `502` | 복지콜 서버에 연결 실패 |

토큰은 90일 유효하고, 쓰는 동안 자동으로 연장됩니다.

**비밀번호를 저장하지 마세요.** 토큰만 보관하면 됩니다.

## 2. 주소 확인

```
GET /api/kbucall/place?query=둔촌동%201376-1
Authorization: Bearer <token>
```

```json
{
  "results": [
    { "name": "...", "address": "서울 강동구 둔촌동 1376-1", "jibun": "서울 강동구 둔촌동 1376-1", "x": "", "y": "", "category": "..." }
  ],
  "hasAddressNumber": true,
  "ambiguous": false
}
```

### 토큰을 반드시 붙이세요

토큰 유무로 동작이 완전히 달라집니다.

| | 토큰 있음 | 토큰 없음 |
|---|---|---|
| 검증 | 복지콜 세션으로 실제 접수 가능 여부까지 | 카카오 키워드 검색만 |
| 지번 입력 | 찾습니다 | **빈 결과**. 카카오는 키워드 검색이라 지번을 못 찾습니다 |
| `address` | 복지콜이 인정한 주소 | 도로명 우선. 복지콜 접수는 지번 기준이라 성공률이 떨어집니다 |
| `hasAddressNumber` | 옵니다 | **오지 않습니다** |

토큰 없이 부르면 3번 확인 의무를 지킬 수 없습니다.

### 응답 읽기

- `results`가 비어 있으면 접수하지 마세요. 더 구체적인 주소를 받으세요.
- `ambiguous: true`일 때만 `candidates`가 함께 옵니다. 각 항목은
  `{ name?, address, jibun? }`입니다. 전부 읽어주고 고르게 하세요.
- `hasAddressNumber`는 없을 수도 있습니다. `=== false`인 경우에만 차단하세요.
- 접수에는 `results[0].address`(또는 사용자가 고른 후보의 `address`)를 씁니다.
  사용자가 입력한 원본 문자열이 아닙니다.

건물명만 넘겨도 동작합니다. 지번 주소를 넘기면 성공률이 가장 높습니다.

## 3. 접수

```
POST /api/data/bookings
Authorization: Bearer <token>
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "runAt": "2026-09-24T05:30:00.000Z",
  "pickupQuery": "서울 강동구 둔촌동 1376-1",
  "pickupDetail": "101동 정문 앞",
  "dropoffQuery": "서울 영등포구 여의도동 2",
  "status": "pending",
  "source": "gildongmu-cli"
}
```

필수는 `id`, `runAt`, `pickupQuery`, `dropoffQuery` 넷입니다.

| 필드 | 설명 |
|---|---|
| `id` | 클라이언트가 만드는 UUID. 상태 조회·삭제에 씁니다 |
| `runAt` | 접수를 요청할 시각. ISO 8601 |
| `pickupQuery` / `dropoffQuery` | 2단계에서 확정한 주소 |
| `pickupDetail` / `dropoffDetail` | 동·호수 등. 선택 |
| `viaQuery` / `viaDetail` | 경유지. 선택 |
| `status` | `"pending"`. 생략해도 같게 동작합니다 |
| `source` | 클라이언트 식별자. 예: `"gildongmu-cli"` |
| `note` | 메모. 선택 |
| `confirmMode` | 복지콜 앱 호환용. 접수 동작에는 영향이 없습니다 |

`source`에 `voice`, `text`, `quick`, `favorite`, `manual`, `rebook`은 쓰지 마세요.
복지콜 앱 내부 값이고, 특히 `favorite`은 주소 재확인 단계를 건너뛰게 합니다.

`400`이 오는 경우는 `id`, `runAt`, `pickupQuery`, `dropoffQuery` 중 하나가 빠졌을 때입니다.

응답이 `200`이어도 아직 복지콜에 접수된 게 아닙니다. "예약이 등록됨"까지입니다.

- `runAt`이 지금부터 5분 이내면 서버가 즉시 접수를 시작합니다. 클라이언트가 따로 트리거를
  부를 필요가 없습니다.
- 그보다 미래면 매분 도는 크론이 그 시각에 접수합니다.
- 10분보다 더 과거인 `runAt`은 실행되지 않습니다.

## 4. 상태 확인

```
GET /api/data/bookings?id=<id>
Authorization: Bearer <token>
```

```json
{ "booking": { "id": "...", "status": "success", "callPhase": "dispatched" } }
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
접수할 수 있습니다. `복지콜 계정이 등록되지 않았습니다`가 오면 1번 로그인을 다시 하세요 —
그 과정에서 워커가 쓸 자격증명이 보관됩니다.

## 5. 취소와 삭제

이미 복지콜에 접수된 차량을 취소합니다.

```
POST /api/data/cancel-call
Authorization: Bearer <token>
```

본문은 없습니다. 서버가 그 사용자의 진행 중인 접수를 찾아 취소합니다.

아직 접수 전(`pending`)인 예약을 없애는 것은 취소가 아니라 삭제입니다.

```
DELETE /api/data/bookings?id=<id>
Authorization: Bearer <token>
```

복지콜에는 배차 후 취소와 하차 후 재접수에 대기 규정이 있습니다. 취소가 거부되면
그 내용이 응답에 옵니다.

## 전체 흐름

`examples/book.mjs`가 이 순서를 그대로 구현합니다.

```bash
# 접수 없이 로그인·주소 확인·시각 계산만 확인
KBUCALL_NAME=홍길동 KBUCALL_PHONE=01012345678 KBUCALL_PASSWORD=... \
  node examples/book.mjs --pickup "둔촌동 1376-1" --dropoff "여의도동 2" --at +10m --dry-run

# 실제 접수
KBUCALL_NAME=홍길동 KBUCALL_PHONE=01012345678 KBUCALL_PASSWORD=... \
  node examples/book.mjs --pickup "둔촌동 1376-1" --dropoff "여의도동 2" --at +10m
```

`--dry-run`은 접수 직전까지만 하고 멈춥니다. 연동을 붙이는 동안 실제 차량을 부르지 않고
확인할 때 쓰세요.

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
