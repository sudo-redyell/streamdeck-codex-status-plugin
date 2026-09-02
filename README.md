# Codex Status & Token Usage for OpenDeck

Linux에서 실행 중인 로컬 Codex의 태스크 상태와 토큰 사용량을 Stream Deck 키 세 개로 표시하는 OpenDeck 플러그인입니다. 각 기능은 라이트·다크 액션을 별도로 제공합니다.

## 요구 사항

- Linux (`/proc` 마운트 필요)
- OpenDeck 2.13 이상
- 호스트에 설치된 Node.js 18 이상
- OpenDeck과 같은 Linux 사용자로 실행하는 로컬 Codex
- 기본 세션 위치: `${CODEX_HOME:-~/.codex}/sessions`

## 액션

### 버튼 1: Codex Status

- `WORKING`: 하나 이상의 세션이 작업 중
- `READY`: Codex 프로세스는 실행 중이지만 모든 세션이 유휴 상태
- `OFFLINE`: 로컬 `codex` 프로세스를 찾지 못함
- 모든 상태에서 현재 열린 rollout 세션 수 표시
- 키를 누르면 즉시 상태 새로고침

### 버튼 2: Token Summary

초기 화면은 이번 달 1일부터 현재까지의 전체 토큰과 Azure 예상 비용입니다. 키를 누르면 두 합계 화면이 교대로 표시됩니다.

1. 이번 달 전체 합계
2. 오늘 00:00부터 현재까지의 전체 합계

### 버튼 3: Session Usage

오늘 00:00부터 현재까지 토큰을 사용한 세션을 최근 사용 순서로 표시합니다. 키를 누르면 다음 세션으로 이동하며 마지막 세션 다음에는 가장 최근 세션으로 돌아옵니다. 당일 사용 세션이 없으면 `NO USAGE`를 표시합니다.

### 라이트·다크 액션

OpenDeck 액션 목록에는 다음 6개가 나타납니다.

- `1. Codex Status` / `1. Codex Status · Dark`
- `2. Token Summary` / `2. Token Summary · Dark`
- `3. Session Usage` / `3. Session Usage · Dark`

rollout 모델명이 알려진 GPT-5.6 SKU와 일치하지 않으면, 비용 계산에는 기본 SKU 단가를 적용합니다.

## 토큰 집계

rollout JSONL의 `event_msg.token_count`만 사용합니다. `total_token_usage` 누적 스냅샷의 차이를 계산하며, turn 경계에서 카운터가 초기화되면 `last_token_usage`를 사용합니다. 같은 누적 스냅샷이 반복되어도 중복 집계하지 않습니다.

- 일반 입력: `input_tokens - cached_input_tokens - cache_write_input_tokens`
- 캐시 입력: `cached_input_tokens`
- 캐시 쓰기: `cache_write_input_tokens`이며 Azure 일반 입력 단가 적용
- 출력: reasoning을 포함하는 `output_tokens` 전체를 출력 단가로 한 번만 계산

프로세스 실행 중에는 1초마다 열린 rollout과 오늘 생성된 파일만 확인하고, 이미 읽은 파일은 마지막 바이트 이후만 증분 분석합니다. 종료된 기존 파일은 30초 간격으로만 재확인합니다. 단일 파일은 기본 128MB까지만 분석합니다.

## 가격 기준

기본 단가는 Azure Retail Prices API에서 2026-08-31에 확인한 **Korea Central / Global Standard / Short Context / USD 1M tokens** 기준입니다.

| Azure GPT-5.6 SKU | Input | Cached input | Output | Effective date |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.6-sol` | $5.00 | $0.50 | $30.00 | 2026-07-01 |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 | 2026-08-01 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | 2026-08-01 |

- 가격 출처: [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview)
- 기본 환율: `1 USD = 1,447.35 KRW`
- 환율은 동일 Azure 카탈로그의 USD/KRW 가격 비율을 사용했습니다.
- 표시 금액은 공개 소매 가격 기반 추정치이며 실제 계약·청구 금액과 다를 수 있습니다.

환경변수로 기준을 조정할 수 있습니다.

```bash
export CODEX_STATUS_KRW_PER_USD=1447.35
export CODEX_STATUS_DEFAULT_AZURE_MODEL=gpt-5.6-terra
export CODEX_STATUS_MAX_FILE_BYTES=134217728
```

모델명에서 `sol`, `terra`, `luna`를 식별하지 못하면 `CODEX_STATUS_DEFAULT_AZURE_MODEL` 단가를 적용하고 화면에 `*`를 표시합니다.

## 빌드 및 설치

```bash
npm install
npm run check
npm test
npm run package
```

생성 파일:

```text
release/codex-status-usage-v1.1.1.streamDeckPlugin
```

OpenDeck의 **Settings → Plugins → Install plugin from file**에서 위 파일을 설치한 뒤, 원하는 테마의 상태·합계·세션 액션을 각각 키에 배치합니다.

## 개인정보 및 네트워크

- 프롬프트와 응답은 저장하거나 전송하지 않습니다.
- JSONL 바이트는 로컬 프로세스 메모리에서 읽지만 태스크 lifecycle과 token count 레코드만 상태에 반영합니다.
- 외부 네트워크 호출을 수행하지 않습니다. 가격은 빌드에 포함된 기준값입니다.
- OpenDeck 연결은 `127.0.0.1` WebSocket만 사용합니다.

## 화면 디자인

144×144 키 화면에 맞춰 Playful Tactile Flat 색상과 둥근 배지를 적용했습니다. 그림자·외곽선을 제거하고 화면 여백을 2px로 축소했으며, 토큰 숫자와 원화 비용의 글자 크기·명암 대비를 높였습니다. 다크 액션은 `#17181C` 캔버스와 `#24262B` 표면을 사용합니다.

## 검증

```bash
npm run check
npm test
npm run package
unzip -t release/*.streamDeckPlugin
```

## 라이선스

[MIT](LICENSE)
