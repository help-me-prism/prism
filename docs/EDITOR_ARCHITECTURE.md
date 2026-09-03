# Notes 편집기 기술 결정

## 결정

Prism Notes의 편집 기반은 CodeMirror 6을 사용한다. Markdown 문자열을 유일한 편집 상태로 유지하고, 시각 편집 경험은 syntax tree와 decoration으로 점진적으로 추가한다.

## 이유

- 사용자 Markdown의 공백, HTML 주석, YAML frontmatter, Obsidian callout과 `[[링크]]`를 파싱·직렬화 과정 없이 그대로 보존한다.
- 읽기와 분할 모드는 동일한 원문 문자열을 별도 renderer로 표시하므로 저장 형식이 화면 모드에 종속되지 않는다.
- 이후 Live Edit는 커서 밖의 문법 기호를 감추고 블록을 꾸미는 decoration으로 확장할 수 있다.
- 실행 취소, 선택, 붙여넣기, Windows/macOS 키보드 동작을 검증된 편집기 상태 모델 위에서 구현할 수 있다.

## 검토한 대안

ProseMirror와 Milkdown은 구조화된 WYSIWYG 블록과 플러그인 생태계가 강점이다. 하지만 Markdown을 내부 스키마로 변환하고 다시 직렬화하므로 스키마 밖 문법과 원문 표기가 정규화될 수 있다. Prism의 원본 보호 원칙상 이 위험을 편집 편의보다 우선했다.

## 단계적 범위

1. 정확한 Markdown 문자열을 편집하는 기반과 읽기/Live Edit/분할 모드
2. 툴바와 `/` 명령을 통한 블록 삽입
3. 커서 밖 Markdown 표식을 숨기는 Live Edit decoration
4. 근거 카드, 내부 링크와 관계 카드의 원자적 widget
5. 외부 파일 변경 감지, hash 비교와 충돌 해결

1~3은 구현되었다. 기본 Live Edit에서는 frontmatter와 보존 주석을 숨기고 제목, 강조, callout, 인라인 코드·수식과 내부 링크를 문서 형태로 표시한다. 커서가 있는 구조의 Markdown 표식은 다시 보여 직접 수정할 수 있다. 분할 모드의 왼쪽은 전체 Markdown 원문을 계속 제공한다.

CodeMirror 문서는 편집 상태의 `doc`이 문자열 표현을 제공하고 모든 변경이 transaction으로 적용된다고 설명한다. decoration은 문서 내용을 바꾸지 않고 보이는 표현만 변경하므로 Prism의 Markdown-first 구조와 맞는다.
