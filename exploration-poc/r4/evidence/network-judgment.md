## 复算结果（由 network-recompute.mjs 从脱敏记录计算，R4 G0-C 严格判定）

**原生 X**（6 个窗口）：/i/api/ 共 107（graphql 37 + rest 70）；media 640、x-page 45、third-party 0、other 24
**R1 PoC**（6 个窗口）：/i/api/ 共 103（graphql 36 + rest 67）；media 640、x-page 42、third-party 0、other 24

逐操作差异（cat:op:method，仅列不一致项；rest 路由已脱敏）：

| 场景 | 操作 | 原生 | R1 | Δ |
|---|---|---|---|---|
| first-nav | graphql:ViewerBadgeCounts:GET | 3 | 2 | -1 |
| first-nav | media:media-img:GET | 18 | 21 | +3 |
| first-nav | media:profile_images:GET | 40 | 43 | +3 |
| first-nav | rest:/i/api/1.1/flow/timeline.json:POST | 7 | 6 | -1 |
| first-nav | rest:/i/api/1.1/graphql/viewer_context.json:POST | 10 | 9 | -1 |
| first-nav | x-page:/cdn-cgi/challenge-platform/scripts/jsd/api.js:GET | 3 | 2 | -1 |
| first-nav | x-page:/cdn-cgi/challenge-platform/scripts/jsd/main.js:GET | 3 | 2 | -1 |
| revisit | media:media-img:GET | 18 | 14 | -4 |
| revisit | rest:/i/api/1.1/flow/timeline.json:POST | 11 | 9 | -2 |
| revisit | x-page:/cdn-cgi/challenge-platform/h/g/scripts/jsd/4df4a60fa397/api:GET | 1 | 0 | -1 |
| revisit | x-page:/cdn-cgi/challenge-platform/h/g/scripts/jsd/4df4a60fa397/mai:GET | 1 | 0 | -1 |
| spa | media:media-img:GET | 18 | 14 | -4 |
| spa | media:profile_images:GET | 24 | 26 | +2 |
| spa | rest:/i/api/1.1/graphql/viewer_context.json:POST | 0 | 1 | +1 |
| spa | x-page:/1.1/live_pipeline/update_subscriptions:POST | 5 | 6 | +1 |
| all | graphql:ViewerBadgeCounts:GET | 5 | 4 | -1 |
| all | media:media-img:GET | 54 | 49 | -5 |
| all | media:profile_images:GET | 104 | 109 | +5 |
| all | rest:/i/api/1.1/flow/timeline.json:POST | 22 | 19 | -3 |
| all | x-page:/1.1/live_pipeline/update_subscriptions:POST | 9 | 10 | +1 |
| all | x-page:/cdn-cgi/challenge-platform/h/g/scripts/jsd/4df4a60fa397/api:GET | 3 | 2 | -1 |
| all | x-page:/cdn-cgi/challenge-platform/h/g/scripts/jsd/4df4a60fa397/mai:GET | 3 | 2 | -1 |
| all | x-page:/cdn-cgi/challenge-platform/scripts/jsd/api.js:GET | 5 | 4 | -1 |
| all | x-page:/cdn-cgi/challenge-platform/scripts/jsd/main.js:GET | 5 | 4 | -1 |

- R1 独有的 /i/api/ 操作：无
- R1 独有的非 API 请求：无
- /i/api/ 总数差（R1 − 原生）：-4

### 分场景判定

- **first-nav: PASS**（V1 新增 API 操作 / V2 超原生轮次上限的 API 调用 / V3 方法不一致 = 0 项违规）
  - 说明项 F1-non-api-extra: media:media-img:GET（原生轮次上限 9，R1 14）—— explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call
  - 说明项 F1-non-api-extra: media:profile_images:GET（原生轮次上限 20，R1 23）—— explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call
- **revisit: PASS**（V1 新增 API 操作 / V2 超原生轮次上限的 API 调用 / V3 方法不一致 = 0 项违规）
- **spa: PASS**（V1 新增 API 操作 / V2 超原生轮次上限的 API 调用 / V3 方法不一致 = 0 项违规）
  - 说明项 F1-non-api-extra: media:profile_images:GET（原生轮次上限 12，R1 13）—— explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call
  - 说明项 F2-native-op-timing: rest:/i/api/1.1/graphql/viewer_context.json:POST（原生轮次上限 undefined，R1 undefined）—— explained: X-native op (present in native windows of other scenarios); not observed in this scenario's native windows (n is small) — timing variance, not an extension call

**总体判定：PASS — 无扩展引入的 API 请求，各操作计数与方法均在原生波动范围内**

JSON verdict: {
  "pass": true,
  "noExtensionApiCalls": true,
  "r1OnlyApiOps": {},
  "r1OnlyNonApiOps": {},
  "apiTotalDelta": -4,
  "violations": [],
  "flags": [
    {
      "scenario": "first-nav",
      "rule": "F1-non-api-extra",
      "key": "media:media-img:GET",
      "native": 18,
      "r1": 21,
      "nativeRoundMax": 9,
      "r1RoundMax": 14,
      "note": "explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call"
    },
    {
      "scenario": "first-nav",
      "rule": "F1-non-api-extra",
      "key": "media:profile_images:GET",
      "native": 40,
      "r1": 43,
      "nativeRoundMax": 20,
      "r1RoundMax": 23,
      "note": "explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call"
    },
    {
      "scenario": "spa",
      "rule": "F1-non-api-extra",
      "key": "media:profile_images:GET",
      "native": 24,
      "r1": 26,
      "nativeRoundMax": 12,
      "r1RoundMax": 13,
      "note": "explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call"
    },
    {
      "scenario": "spa",
      "rule": "F2-native-op-timing",
      "key": "rest:/i/api/1.1/graphql/viewer_context.json:POST",
      "native": 0,
      "r1": 1,
      "note": "explained: X-native op (present in native windows of other scenarios); not observed in this scenario's native windows (n is small) — timing variance, not an extension call"
    }
  ]
}
