# 논문 검색·번역·추출 품질 점검

점검일: 2026-09-10  
브랜치: `codex/fix-paper-search-pdf`

## 결론과 원인

문제는 특정 논문이 아니라 공급자와 구조 경계를 혼동한 데서 발생했다.

1. 검색이 arXiv 한 곳과 제목 유사도에 지나치게 의존해 DOI 논문이 누락되거나 숫자 제목 결과가 정확한 식별자보다 앞섰다. Semantic Scholar, Crossref, Europe PMC, arXiv 결과를 정규화·중복 제거하고 정확한 arXiv/DOI 식별자를 최우선으로 정렬했다.
2. 메타데이터 링크와 검증된 PDF 링크가 같은 동작처럼 보였다. `원문`, `PDF 저장`, `내 PDF 가져오기`를 분리하고 PDF가 없는 결과는 저장 버튼으로 위장하지 않는다.
3. arXiv LaTeX만 구조 원문으로 취급했다. Europe PMC의 JATS XML을 같은 구조 인터페이스로 변환하되, 좌표와 원문 크롭은 항상 PDF를 기준으로 유지한다.
4. 다운로드 후 구조·인용 IPC가 arXiv 문자 규칙만 허용해 `doi:`/`pmc:` 논문을 거부했다. 저장 논문 ID를 공급자 중립의 불투명 식별자로 검증한다.
5. 피겨 근거 크롭에 캡션이 들어가면 지면 유지 번역에서 유효한 캡션 번역까지 제거됐다. 결합된 피겨 근거는 유지하고, 번역된 캡션은 별도 논리 블록으로 배치한다.

논문 ID, 페이지, 식 번호에 따른 예외 처리는 추가하지 않았다.

## 자동 검사 방식

`electron/paperQualityAudit.ts`는 구조 원문(LaTeX/JATS)과 PDF 세그먼트를 공급자와 무관하게 비교한다. 위험 레코드는 페이지, 구조 블록 ID, PDF 세그먼트 ID, 예상/실제 구조, 태그 범위, 원인, 결과, 회귀 테스트 이름을 보존한다. 다음을 보수적으로 경고한다.

- 인라인 수식 밀집 문단, 복잡한 수식 환경, theorem 계열 블록
- 표/피겨 인접, 다중 패널 피겨
- PDF/구조 원문의 식 개수 차이, 복잡한 식의 미매칭, 중복 식 번호
- 번역 누락이 연속된 구간

`scripts/audit-paper-structure.mjs <paper-directory>`로 전체 페이지를 먼저 검사한다. LaTeX 매칭 신뢰도가 낮으면 PDF 원문을 유지하며, 위험 레코드가 곧 오류 확정이라는 뜻은 아니다.

## 교차 논문 실측

실제 검색 → 다운로드 → PDF 검증 → 전 페이지 텍스트 계층 추출을 Electron IPC로 수행했다. 총 96쪽을 검사했다.

| 분야/형식 | 논문 | 페이지 | 구조 원문 | 전 페이지 추출 문자 | 결과 |
|---|---|---:|---|---:|---|
| 생물학·의학, 1단, PDF-only | Jinek et al., CRISPR-Cas9, DOI `10.1126/science.1225829` | 14 | 없음 | 31,338 | 통과 |
| ML/수학, 1단 | Attention Is All You Need, `1706.03762` | 15 | LaTeX 158블록 | 38,767 | 통과 |
| 공학·CV, 2단 | Deep Residual Learning, `1512.03385` | 12 | LaTeX 152블록 | 58,098 | 통과 |
| 입자물리, 2단 | ATLAS Higgs, `1207.7214` | 38 | LaTeX 362블록 | 180,994 | 통과 |
| 의학, 1단·대형 표 | Dexamethasone/COVID-19, DOI `10.1056/NEJMoa2021436` | 11 | JATS 77블록 | 44,788 | 통과 |
| 기후경제, 2단·피겨 | Global warming and inequality, DOI `10.1073/pnas.1816020116` | 6 | JATS 69블록 | 43,177 | 통과 |

코드 경고를 기준으로 Transformer 4쪽, ResNet 6쪽, CRISPR 2쪽, NEJM 5쪽만 렌더링해 최종 확인했다. 각각 다중 패널 피겨+캡션+인라인 수식, 연속 표+피겨+2단 경계, 회전된 저널 장식, 큰 표의 캡션·선·음수/백분율·각주가 잘리지 않음을 확인했다.

## 회귀 테스트 대응

- 번역: `test-translation-request`, `test-scientific-translation`, `test-translation-scope`, `test-translation-retranslate`가 수치·단위·비교 방향·인용·부분 실패 보존·참고문헌 제외를 검사한다.
- 수식: `test-pdf-text-extraction`, `test-latex-structure`, `test-equation-alignment`가 인라인 문장, 중앙 수식, 분수/큰 괄호, 행렬 사이 설명문, `matrix/cases/aligned/split/multline/array`, 앞 식 누락 후 순서 복구를 검사한다.
- 표/피겨: `test-figure-geometry`, `test-figure-caption-matching`, `test-preserved-regions`가 위·아래 캡션, 실제 선, 인접 차트 종료, 다중 패널, 페이지 배경 제외를 검사한다.
- 원문 크롭/UI: `test-excerpt-geometry`, `test-reading-blocks`, `test-anchor-popover`, `test-product-ui`가 문장 범위, 원문 글리프, 네 모서리 배치, 이미지 로드 후 재배치, 호버 전 비표시, 큰 이미지 뷰어를 검사한다.
- 위험 감사: `test-paper-quality-audit`가 모든 위험 레코드의 추적 필드와 보수적 미매칭을 검사한다.

## 모델과 구조 문제의 분리

문단·수식·표·피겨·참고문헌 경계, PDF 좌표, 구조 원문 매칭 순서는 코드가 결정한다. 모델은 코드가 정한 번역 가능 문장만 받는다. 모델 출력의 숫자·수식·인용 보존 검사가 실패하면 해당 문장만 원문으로 남기고 정상 문장은 저장한다. 따라서 모델을 바꾸어 구조 오류를 숨기지 않는다.

실제 유료 모델의 문체·용어 선택은 결정적 자동 테스트로 완전히 보증할 수 없다. 남은 보수적 경고는 다음과 같다.

- 스캔 PDF처럼 텍스트 계층이 없는 문서는 OCR 전까지 원문 읽기·피겨 캡처만 제공한다.
- 구조 원문과 PDF 식 개수가 크게 다른 경우 자동으로 억지 매칭하지 않고 PDF 원문을 표시한다.
- 다운로드 권한이 없는 논문은 원문 링크 또는 사용자의 로컬 PDF 연결이 필요하다.
- 라이브 교차 검증에서 번역 모델 호출은 비용과 비결정성을 피하기 위해 비활성화했다. 구조·보존·부분 실패 경로는 고정 회귀 테스트로 검증했다.

## 검증 명령

- `npm run test:core`
- `npm run test:ui`
- `npm run test:product`
- `npm run test:papers-live`
- `git diff --check`

