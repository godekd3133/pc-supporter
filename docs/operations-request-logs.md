# API 요청 로그

API는 각 응답에 무작위 `X-Request-Id`를 반환하고, health probe와 CORS preflight를 제외한 완료·중단 요청을 JSON 한 줄로 기록한다.

```json
{"event":"http.request","requestId":"...","method":"POST","route":"/api/compatibility/check","outcome":"completed","statusCode":200,"durationMs":4.2}
```

로그는 Express route template만 사용한다. 경로 값, query, body, 요청 헤더, IP 주소는 기록하지 않는다. 운영 장애를 조사할 때 사용자가 전달한 `X-Request-Id`와 서버 로그의 `requestId`를 맞춰 요청 흐름을 찾을 수 있다. 응답 본문에 request ID를 포함하지 않으므로 API payload 계약은 바뀌지 않는다.

로그 수집 플랫폼은 JSON 필드를 인덱싱하되 `requestId`는 trace lookup에만 사용하고 일반 집계는 `route`, `method`, `statusCode`, `outcome` 기준으로 구성한다.
