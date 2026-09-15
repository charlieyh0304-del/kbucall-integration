# 복지콜 예약 연동 가이드

외부 앱에서 복지콜 예약 화면을 여는 방법입니다. 네비게이션 앱이 도보 안내 중 목적지를
그대로 넘겨 예약을 시작하는 용도로 만들어졌습니다.

연동 방식은 딥링크입니다. 외부 앱은 URL 하나만 열면 되고, 별도 SDK나 API 키가 필요 없습니다.
예약 확정은 복지콜 앱 화면에서 사용자가 직접 합니다.

## 기본 형식

```
https://kbucall.pages.dev/booking/new?pickup=<출발지>&dropoff=<목적지>
```

모든 값은 URL 인코딩해서 넘깁니다.

## 파라미터

전부 선택 사항입니다. 넘기지 않은 항목은 빈 값으로 열리고 사용자가 직접 입력합니다.

| 이름 | 형식 | 설명 |
|---|---|---|
| `pickup` | 문자열 | 출발지 주소 |
| `pickupDetail` | 문자열 | 출발지 상세주소 (동·호수 등) |
| `dropoff` | 문자열 | 도착지 주소 |
| `dropoffDetail` | 문자열 | 도착지 상세주소 |
| `via` | 문자열 | 경유지 주소. 값이 있으면 경유지 입력이 자동으로 켜집니다 |
| `viaDetail` | 문자열 | 경유지 상세주소 |
| `date` | `YYYY-MM-DD` | 이용 날짜. 생략하면 오늘 |
| `time` | `HH:mm` (24시간) | 이용 시각. 생략하면 사용자가 선택 |

예시:

```
https://kbucall.pages.dev/booking/new?pickup=%EC%84%9C%EC%B4%88%EB%8F%99%201376-1&dropoff=%EC%97%AC%EC%9D%98%EB%8F%84%EB%8F%99%202&time=14%3A30
```

## 주소 형식

**지번 주소를 넘겨주세요.** 복지콜 접수는 지번 기준으로 동작합니다.
도로명 주소를 넘겨도 복지콜 앱이 변환을 시도하지만, 실패하면 사용자가 직접 고쳐야 합니다.
네비앱이 지번을 가지고 있다면 그쪽이 성공률이 높습니다.

건물명만 넘기는 것도 동작합니다. 복지콜 앱이 주소 검색으로 후보를 찾아 사용자에게 확인을 받습니다.

## 여는 방법

**앱 내장 웹뷰를 쓰지 마세요.** 안드로이드 `WebView`, iOS `WKWebView`는 브라우저와 저장소가
분리돼 있어 로그인 정보가 공유되지 않습니다. 예약할 때마다 복지콜 계정으로 다시 로그인해야 합니다.

### 안드로이드 — Chrome Custom Tabs

```kotlin
val url = Uri.parse("https://kbucall.pages.dev/booking/new")
    .buildUpon()
    .appendQueryParameter("pickup", currentAddress)
    .appendQueryParameter("dropoff", destinationAddress)
    .build()

CustomTabsIntent.Builder()
    .build()
    .launchUrl(context, url)
```

### iOS — SFSafariViewController

```swift
var components = URLComponents(string: "https://kbucall.pages.dev/booking/new")!
components.queryItems = [
    URLQueryItem(name: "pickup", value: currentAddress),
    URLQueryItem(name: "dropoff", value: destinationAddress),
]

let safari = SFSafariViewController(url: components.url!)
present(safari, animated: true)
```

## 전환 직전에 안내 음성을 멈춰주세요

복지콜 앱은 화면이 열리면 제목에 포커스를 잡아 스크린리더가 읽기 시작합니다.
네비게이션 안내 음성이 계속 나오는 상태로 전환하면 두 음성이 겹쳐서 양쪽 다 들리지 않습니다.

Custom Tabs나 SFSafariViewController를 띄우기 직전에 안내 음성을 정지하거나 일시정지해 주세요.
사용자가 돌아왔을 때 다시 시작하면 됩니다.

## 로그인

복지콜 예약에는 복지콜 계정이 필요합니다.
처음 연동 경로로 들어온 사용자는 로그인 화면을 한 번 거치고, 그 뒤로는 유지됩니다.

참고로 사용자가 복지콜 앱을 홈 화면에 설치해 쓰고 있어도, iOS는 설치된 앱과 Safari의 저장소가
분리됩니다. 브라우저 경로에서 최초 한 번은 별도로 로그인해야 합니다.

## 이용 대상

복지콜은 지역 기반 서비스이며 등록된 이용 자격이 있는 사용자만 접수할 수 있습니다.
네비게이션 앱 사용자 전부가 대상은 아닙니다.
자격이 없는 사용자가 진입하면 복지콜 앱이 안내합니다.

## 아직 없는 것

- **네비앱으로 복귀**: 예약을 마친 뒤 호출한 앱으로 돌아가는 딥링크는 아직 없습니다.
  현재는 사용자가 뒤로 가기로 돌아갑니다. 필요하면 이슈로 논의해 주세요.
- **앱 안에서 예약 완결**: 복지콜 계정 정보를 외부 앱이 직접 다루지 않도록,
  예약 확정은 복지콜 앱 화면에서만 이뤄집니다.

## 문의

이 저장소의 이슈로 남겨 주세요.
